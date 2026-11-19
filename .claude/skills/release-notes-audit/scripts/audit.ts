// Release notes audit (tickets/T-032): compares the notes tracenotes renders for a git range
// with the range itself. Used by the release-notes-audit skill (../SKILL.md).
//
// Usage: node .claude/skills/release-notes-audit/scripts/audit.ts <dir> <repo-url>
//   <dir> holds rev-list.txt, group.json, notes.json, notes.md and check.txt, written by the
//   skill's steps. Prints one PASS/FAIL line per check and the verdict; exit 0 PASS, 1 FAIL,
//   2 for bad input or usage (one error line on stderr).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { checkRepoUrl } from '../../../../src/render.ts';

export interface AuditInput {
  /** `git rev-list <range>`: one full lowercase SHA per line. */
  revList: string;
  /** stdout of `tracenotes group`. */
  group: string;
  /** stdout of `tracenotes render --origin --format json`. */
  notesJson: string;
  /** stdout of `tracenotes render --origin`. */
  notesMarkdown: string;
  /** stdout of `tracenotes check`. */
  check: string;
  /** The link base the notes must use, `https://<host>/<owner>/<repo>`. */
  repoUrl: string;
}

export interface AuditCheck {
  id: 'exactly-once' | 'counts' | 'json-links' | 'markdown-links' | 'check-agrees';
  ok: boolean;
  /** What was compared, and on failure what differed (short SHAs). */
  detail: string;
}

export interface AuditResult {
  checks: AuditCheck[];
  /** True when every check is ok. */
  passed: boolean;
}

const SHA_RE = /^[0-9a-f]{40}$/;
const short = (s: string) => s.slice(0, 7);
const list = (shas: string[]) => (shas.length === 0 ? 'none' : shas.map(short).join(', '));

function parseJson(text: string, name: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new RangeError(`${name} is not valid JSON`);
  }
}

function field<T>(value: unknown, key: string, name: string, kind: 'array' | 'number' | 'object'): T {
  const v = (value as Record<string, unknown> | null)?.[key];
  const ok = kind === 'array' ? Array.isArray(v) : kind === 'number' ? Number.isInteger(v) : typeof v === 'object' && v !== null;
  if (!ok) throw new RangeError(`${name}: "${key}" is missing or not ${kind === 'array' ? 'an array' : `a ${kind}`}`);
  return v as T;
}

function shaOf(value: unknown, name: string): string {
  const s = (value as { sha?: unknown } | null)?.sha;
  if (typeof s !== 'string' || !SHA_RE.test(s)) throw new RangeError(`${name}: an entry has no full sha`);
  return s;
}

/** Items of `a` not in `b`, in order. */
function difference(a: string[], b: Set<string>): string[] {
  return a.filter(x => !b.has(x));
}
/** Items that occur more than once in `a`, each named once. */
function duplicates(a: string[]): string[] {
  const seen = new Set<string>();
  return [...new Set(a.filter(x => (seen.has(x) ? true : (seen.add(x), false))))];
}

/**
 * Audit the notes rendered for a git range against the range.
 *
 * @param input The saved outputs of the skill's steps (see `AuditInput`).
 * @returns Five checks in a fixed order (exactly-once, counts, json-links, markdown-links,
 *          check-agrees), each with what was compared and, on failure, what differed; `passed`
 *          when all hold. Pure.
 * @throws RangeError when an input cannot be read: a rev-list line that is not a full lowercase
 *         SHA, an empty range, JSON that does not parse or lacks a field, no `checked <n>:` line in
 *         the check output, no footer in the Markdown, or a repository URL `checkRepoUrl()` rejects
 *         (the URL is never quoted). Nothing is guessed.
 */
export function auditNotes(input: AuditInput): AuditResult {
  try {
    checkRepoUrl(input.repoUrl);
  } catch (error) {
    // checkRepoUrl quotes the value, and a URL may carry credentials (PR 30 review, finding
    // e1492647): the message names the expected shape only.
    if (error instanceof RangeError) throw new RangeError('the repository URL is not https://<host>/<owner>/<repo> (the value is not shown: it may hold credentials)');
    throw error;
  }
  const lines = input.revList.split('\n');
  if (lines.at(-1) === '') lines.pop();
  for (const line of lines) {
    if (!SHA_RE.test(line)) throw new RangeError(`rev-list.txt: ${JSON.stringify(line)} is not a full lowercase SHA`);
  }
  if (lines.length === 0) throw new RangeError('rev-list.txt is empty: the range has no commits');
  const range = lines;
  const rangeSet = new Set(range);
  const n = range.length;

  const group = parseJson(input.group, 'group.json');
  const sections = field<unknown[]>(group, 'sections', 'group.json', 'array');
  // group's entries in order, each with its section title, subject and scope: what the notes must show.
  const expected = sections.flatMap(s => {
    if (typeof s !== 'object' || s === null) throw new RangeError('group.json: a section is not an object');
    const title = (s as { title?: unknown }).title;
    if (typeof title !== 'string') throw new RangeError('group.json: a section has no title');
    return field<unknown[]>(s, 'entries', 'group.json', 'array').map(e => {
      if (typeof e !== 'object' || e === null) throw new RangeError('group.json: an entry is not an object');
      const { subject, scope, prNumber, breakingNotes } = e as { subject?: unknown; scope?: unknown; prNumber?: unknown; breakingNotes?: unknown };
      if (typeof subject !== 'string' || (scope !== null && typeof scope !== 'string')) throw new RangeError('group.json: an entry has no subject or scope');
      if (prNumber !== null && !Number.isSafeInteger(prNumber)) throw new RangeError('group.json: an entry has an invalid prNumber');
      // PR 30 review, finding 8f818660: a breaking entry's notes are part of what the notes show.
      const notesList = breakingNotes === undefined ? [] : breakingNotes;
      if (!Array.isArray(notesList) || !notesList.every(n => typeof n === 'string')) throw new RangeError('group.json: breakingNotes is not a list of strings');
      return { title, sha: shaOf(e, 'group.json'), subject, scope, prNumber: prNumber as number | null, breakingNotes: notesList as string[] };
    });
  });
  const sectionShas = expected.map(e => e.sha);
  const ignored = field<unknown[]>(group, 'ignored', 'group.json', 'array');
  const ignoredShas = ignored.map(e => shaOf(e, 'group.json'));
  const mergeShas = ignored.filter(e => (e as { reason?: unknown }).reason === 'merge commit').map(e => shaOf(e, 'group.json'));
  const groupMalformed = field<unknown[]>(group, 'malformed', 'group.json', 'array').length;
  const groupTotal = field<number>(group, 'total', 'group.json', 'number');

  const notes = parseJson(input.notesJson, 'notes.json');
  const counts = field<Record<string, unknown>>(notes, 'counts', 'notes.json', 'object');
  const [shown, total, ignoredCount, malformed] = (['shown', 'total', 'ignored', 'malformed'] as const).map(k =>
    field<number>(counts, k, 'notes.json counts', 'number'),
  ) as [number, number, number, number];
  const entries = field<unknown[]>(notes, 'sections', 'notes.json', 'array').flatMap(s => {
    if (typeof s !== 'object' || s === null) throw new RangeError('notes.json: a section is not an object');
    return field<unknown[]>(s, 'entries', 'notes.json', 'array').map(e => {
      if (typeof e !== 'object' || e === null) throw new RangeError('notes.json: an entry is not an object');
      const source = field<Record<string, unknown>>(e, 'source', 'notes.json', 'object');
      const { subject, scope } = e as { subject?: unknown; scope?: unknown };
      return {
        title: (s as { title?: unknown }).title,
        subject,
        scope,
        sha: shaOf(source, 'notes.json'),
        commitUrl: source['commitUrl'],
        prNumber: source['prNumber'],
        prUrl: source['prUrl'],
        breakingNotes: (e as { breakingNotes?: unknown }).breakingNotes,
      };
    });
  });

  const summary = /^checked (\d+): (\d+) passed, (\d+) failed, (\d+) skipped, (\d+) malformed$/m.exec(input.check);
  if (summary === null) throw new RangeError('check.txt has no "checked <n>: ..." summary line');
  const [checkTotal, checkPassed, checkFailed, checkSkipped, checkMalformed] = summary.slice(1).map(Number) as [number, number, number, number, number];
  const skipShorts = [...input.check.matchAll(/^skip ([0-9a-f]{7}) merge commit$/gm)].map(m => m[1]!);

  // The Markdown footer (render: `_<shown> of <total> commits shown; <m> merge commits ignored;
  // [<c> ignored by config; ]<k> malformed records skipped._`), compared below (finding be79ef1c).
  const footer = /^_(\d+) of (\d+) commits shown; (\d+) merge commits ignored; (?:(\d+) ignored by config; )?(\d+) malformed records skipped\._$/m.exec(input.notesMarkdown);
  if (footer === null) throw new RangeError('notes.md has no "_<shown> of <total> commits shown; ..._" footer');
  const [fShown, fTotal, fMerges, fConfig, fMalformed] = footer.slice(1).map(v => (v === undefined ? 0 : Number(v))) as [number, number, number, number, number];

  const checks: AuditCheck[] = [];

  // exactly-once: every commit of the range in group's output once, nothing else.
  const placed = [...sectionShas, ...ignoredShas];
  const missing = difference(range, new Set(placed));
  const extra = difference(placed, rangeSet);
  const twice = [...duplicates(placed), ...duplicates(range)];
  checks.push({
    id: 'exactly-once',
    ok: missing.length === 0 && extra.length === 0 && twice.length === 0 && groupMalformed === 0,
    detail: `${n} commits in the range, ${placed.length} in the notes; missing: ${list(missing)}; extra: ${list(extra)}; twice: ${list(twice)}; malformed records: ${groupMalformed}`,
  });

  // counts: every tool agrees with the range's size.
  const countProblems: string[] = [];
  if (groupTotal !== n) countProblems.push(`group total ${groupTotal}`);
  if (total !== n) countProblems.push(`notes.json total ${total}`);
  if (shown + ignoredCount !== total) countProblems.push(`notes.json shown ${shown} + ignored ${ignoredCount} is not total ${total}`);
  if (malformed !== 0) countProblems.push(`notes.json malformed ${malformed}`);
  if (checkTotal !== n) countProblems.push(`check checked ${checkTotal}`);
  if (checkMalformed !== 0) countProblems.push(`check malformed ${checkMalformed}`);
  const mergeCount = mergeShas.length;
  if (fShown !== shown || fTotal !== n || fMerges !== mergeCount || fConfig !== ignored.length - mergeCount || fMalformed !== 0) {
    countProblems.push(`notes.md footer says ${fShown} shown of ${fTotal}, ${fMerges} merges, ${fConfig} by config, ${fMalformed} malformed; expected ${shown} of ${n}, ${mergeCount}, ${ignored.length - mergeCount}, 0`);
  }
  // Qodo local review finding 4f944bf8: check's own verdicts must add up to its total.
  if (checkPassed + checkFailed + checkSkipped + checkMalformed !== checkTotal) {
    countProblems.push(`check passed ${checkPassed} + failed ${checkFailed} + skipped ${checkSkipped} + malformed ${checkMalformed} is not checked ${checkTotal}`);
  }
  checks.push({
    id: 'counts',
    ok: countProblems.length === 0,
    detail: countProblems.length === 0 ? `group, notes.json and check all count ${n}` : `range has ${n}; ${countProblems.join('; ')}`,
  });

  // json-links: each shown entry links to its own commit, and the entries are group's sections.
  const wrongLink = entries.filter(e => e.commitUrl !== `${input.repoUrl}/commit/${e.sha}`).map(e => e.sha);
  const outside = entries.filter(e => !rangeSet.has(e.sha)).map(e => e.sha);
  const entryShas = entries.map(e => e.sha);
  const notInGroup = difference(entryShas, new Set(sectionShas));
  const notInNotes = difference(sectionShas, new Set(entryShas));
  // Qodo local review finding 44bb76a4: entry k must be group's entry k (render keeps group's
  // order), so two entries cannot trade sources while the set of SHAs stays the same.
  const outOfPlace = entryShas.filter((s, k) => s !== sectionShas[k]);
  // Qodo local review findings 7dc5829e, f9b538b4: entry k must also show group's section,
  // subject and scope for entry k; the right link next to the wrong text is a wrong note.
  const wrongContent = entries.flatMap((e, k) => {
    const x = expected[k];
    const prUrl = x === undefined || x.prNumber === null ? null : `${input.repoUrl}/pull/${x.prNumber}`;
    return x !== undefined && e.sha === x.sha && (e.title !== x.title || e.subject !== x.subject || e.scope !== x.scope || e.prNumber !== x.prNumber || e.prUrl !== prUrl || JSON.stringify(e.breakingNotes) !== JSON.stringify(x.breakingNotes)) ? [e.sha] : [];
  });
  checks.push({
    id: 'json-links',
    ok: wrongLink.length === 0 && outside.length === 0 && notInGroup.length === 0 && notInNotes.length === 0 && outOfPlace.length === 0 && wrongContent.length === 0 && entries.length === shown,
    detail: `${entries.length} entries (shown ${shown}); wrong link: ${list(wrongLink)}; not in range: ${list(outside)}; not in group: ${list(notInGroup)}; group entry missing: ${list(notInNotes)}; not in group's order: ${list(outOfPlace)}; wrong section, subject, scope, PR link or breaking notes: ${list(wrongContent)}`,
  });

  // markdown-links: one "- " line per shown entry, each with exactly one commit link of its own.
  const base = input.repoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const linkRe = new RegExp(`(?<!\\\\)\\]\\(${base}/commit/([0-9a-f]{40})\\)`, 'g');
  // render backslash-escapes Markdown characters and adds nothing else, so removing the escapes
  // gives the text back. Each entry line is read with the heading it sits under.
  const unescape = (text: string) => text.replace(/\\(.)/g, '$1');
  let heading: string | null = null;
  // An entry's breaking notes follow it as `  - <note>` lines, a note's further lines indented
  // by four spaces (render); they are kept with the entry line above them.
  const placedLines: { line: string; title: string | null; notes: string[] }[] = [];
  for (const line of input.notesMarkdown.split('\n')) {
    if (line.startsWith('### ')) heading = unescape(line.slice(4));
    else if (line.startsWith('- ')) placedLines.push({ line, title: heading, notes: [] });
    else if (line.startsWith('  ') && placedLines.length > 0) placedLines.at(-1)!.notes.push(line);
  }
  const entryLines = placedLines.map(p => p.line);
  const linked = entryLines.map(line => [...line.matchAll(linkRe)].map(m => m[1]!));
  // Every commit link on the line counts, whatever its base (finding 4b2ac78e): a correct link
  // plus a second one to another repository is two links. A `](` whose `]` is escaped is
  // subject text, not a link (render escapes brackets in subjects; finding 5638c83e).
  const anyCommitLink = /(?<!\\)\]\([^)\s]*\/commit\/[0-9a-f]{7,40}\)/g;
  const badLines = entryLines.filter((line, k) => linked[k]!.length !== 1 || [...line.matchAll(anyCommitLink)].length !== 1).length;
  const mdShas = linked.filter(shas => shas.length === 1).map(shas => shas[0]!);
  const mdMissing = difference(entryShas, new Set(mdShas));
  const mdExtra = [...difference(mdShas, new Set(entryShas)), ...duplicates(mdShas)];
  // Qodo local review finding 7f66a5e3: line k must link to group's entry k.
  const mdOutOfPlace = linked.flatMap((shas, k) => (shas.length === 1 && shas[0] !== sectionShas[k] ? [shas[0]!] : []));
  const mdWrongContent = placedLines.flatMap((p, k) => {
    const x = expected[k];
    if (x === undefined || linked[k]!.length !== 1 || linked[k]![0] !== x.sha) return [];
    // PR 30 review, finding 633aace6: the whole line, not its start; render's exact form.
    const pr = x.prNumber === null ? '' : `, [#${x.prNumber}](${input.repoUrl}/pull/${x.prNumber})`;
    const text = `- ${x.scope === null ? '' : `**${x.scope}:** `}${x.subject} ([${short(x.sha)}](${input.repoUrl}/commit/${x.sha})${pr})`;
    const notesText = x.breakingNotes.map(note => `  - ${note.split('\n').join('\n    ')}`).join('\n');
    return p.title !== x.title || unescape(p.line) !== text || unescape(p.notes.join('\n')) !== notesText ? [x.sha] : [];
  });
  checks.push({
    id: 'markdown-links',
    ok: entryLines.length === shown && badLines === 0 && mdMissing.length === 0 && mdExtra.length === 0 && mdOutOfPlace.length === 0 && mdWrongContent.length === 0,
    detail: `${entryLines.length} entry lines (shown ${shown}); lines without exactly one commit link: ${badLines}; entry not linked: ${list(mdMissing)}; unexpected link: ${list(mdExtra)}; not in group's order: ${list(mdOutOfPlace)}; not the expected line (heading, scope, subject, links, breaking notes): ${list(mdWrongContent)}`,
  });

  // check-agrees: check skips exactly group's merge commits.
  // Short SHAs can repeat (finding d457935f), so the two lists are compared as multisets: each
  // prefix must occur as often in check's skip lines as among group's merge commits.
  const mergeShorts = mergeShas.map(short);
  const tally = (xs: string[]) => xs.reduce((m, x) => m.set(x, (m.get(x) ?? 0) + 1), new Map<string, number>());
  const mergeTally = tally(mergeShorts);
  const skipTally = tally(skipShorts);
  const skipMissing = [...mergeTally].flatMap(([p, k]) => Array<string>(Math.max(0, k - (skipTally.get(p) ?? 0))).fill(p));
  const skipExtra = [...skipTally].flatMap(([p, k]) => Array<string>(Math.max(0, k - (mergeTally.get(p) ?? 0))).fill(p));
  // The summary must describe the lines check printed (finding 624dd0de): a total can otherwise be
  // moved from one verdict to another while the sum stays right.
  const failLines = [...input.check.matchAll(/^fail [0-9a-f]{7} /gm)].length;
  const malformedLines = [...input.check.matchAll(/^malformed /gm)].length;
  const lineProblems: string[] = [];
  if (skipShorts.length !== checkSkipped) lineProblems.push(`${skipShorts.length} skip lines, summary says ${checkSkipped} skipped`);
  if (failLines !== checkFailed) lineProblems.push(`${failLines} fail lines, summary says ${checkFailed} failed`);
  if (malformedLines !== checkMalformed) lineProblems.push(`${malformedLines} malformed lines, summary says ${checkMalformed} malformed`);
  checks.push({
    id: 'check-agrees',
    ok: skipMissing.length === 0 && skipExtra.length === 0 && lineProblems.length === 0,
    detail: `${mergeShorts.length} merge commits in group, ${skipShorts.length} skip lines in check; not skipped: ${skipMissing.length === 0 ? 'none' : skipMissing.join(', ')}; unexpected skip: ${skipExtra.length === 0 ? 'none' : skipExtra.join(', ')}; summary vs lines: ${lineProblems.length === 0 ? 'agree' : lineProblems.join('; ')}`,
  });

  return { checks, passed: checks.every(c => c.ok) };
}

/**
 * One line of text with nothing a reader cannot see: JSON escapes for C0 controls, quotes and
 * backslashes, then a `\uXXXX` escape for what JSON leaves raw (C1, format characters, odd
 * spaces, line separators, characters displayed as nothing, U+2800, U+FFFD), the set src/cli.ts
 * oneLine() escapes (PR 30 review, finding 2a84cc4a).
 */
function escapeLine(text: string): string {
  return JSON.stringify(text)
    .slice(1, -1)
    .replace(/(?! )[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Zs}\p{Default_Ignorable_Code_Point}\u2800\ufffd]/gu, ch =>
      [...Array(ch.length).keys()].map(i => `\\u${ch.charCodeAt(i).toString(16).padStart(4, '0')}`).join(''),
    );
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * The entry's work: read the five files from `dir`, audit, and format the report.
 *
 * @returns exit 0 and the report on PASS, 1 on FAIL, 2 with one `error:` line on stderr when an
 *          argument is missing, a file cannot be read, or `auditNotes` throws RangeError.
 */
export function run(args: string[]): RunResult {
  const [dir, repoUrl] = args;
  if (dir === undefined || repoUrl === undefined || args.length !== 2) {
    return { code: 2, stdout: '', stderr: 'error: usage: audit.ts <dir> <repo-url>\n' };
  }
  try {
    const read = (name: string) => readFileSync(path.join(dir, name), 'utf8');
    const result = auditNotes({
      revList: read('rev-list.txt'),
      group: read('group.json'),
      notesJson: read('notes.json'),
      notesMarkdown: read('notes.md'),
      check: read('check.txt'),
      repoUrl,
    });
    const failedCount = result.checks.filter(c => !c.ok).length;
    const text =
      result.checks.map(c => `${c.ok ? 'PASS' : 'FAIL'} ${c.id}: ${c.detail}\n`).join('') +
      (result.passed ? 'audit: PASS\n' : `audit: FAIL (${failedCount} of ${result.checks.length} checks failed)\n`);
    return { code: result.passed ? 0 : 1, stdout: text, stderr: '' };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { code: 2, stdout: '', stderr: `error: ${escapeLine(message)}\n` };
  }
}

const invokedDirectly = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  const result = run(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.code;
}

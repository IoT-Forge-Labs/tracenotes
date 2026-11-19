import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from '../src/cli.ts';
import { FIELD_SEPARATOR as FS, RECORD_SEPARATOR as RS } from '../src/gitlog.ts';
import { auditNotes } from '../.claude/skills/release-notes-audit/scripts/audit.ts';
import type { AuditInput } from '../.claude/skills/release-notes-audit/scripts/audit.ts';

// T-032. Inputs are built with the real CLI from a synthetic stream, the way the skill builds
// them from `git log`; no test runs git (rule 5).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const scriptPath = path.join(repoRoot, '.claude', 'skills', 'release-notes-audit', 'scripts', 'audit.ts');
const repoUrl = 'https://github.com/o/r';
const sha = (digit: string) => digit.repeat(40);
const record = (s: string, message: string) => `${s}${FS}Ada${FS}2026-11-18T10:00:00Z${FS}${message}${RS}\n`;

const commits: [string, string][] = [
  [sha('a'), 'feat(cli): add check (#28)\n'],
  [sha('b'), 'fix: escape more\n'],
  [sha('c'), 'Merge pull request #28 from o/b\n'],
  [sha('d'), 'Journl day 11 update\n'],
  [sha('e'), 'feat!: drop old syntax\n\nBREAKING CHANGE: the old syntax is gone\n'],
];

async function run(argv: string[], stream: string): Promise<string> {
  let out = '';
  await main(argv, { stdinIsTTY: false, readStdin: async () => stream, stdout: t => { out += t; }, stderr: () => {} });
  return out;
}

async function inputsFor(list: [string, string][], revList = list.map(([s]) => s)): Promise<AuditInput> {
  const stream = list.map(([s, m]) => record(s, m)).join('');
  return {
    revList: revList.map(s => `${s}\n`).join(''),
    group: await run(['group'], stream),
    notesJson: await run(['render', '--repo-url', repoUrl, '--format', 'json'], stream),
    notesMarkdown: await run(['render', '--repo-url', repoUrl], stream),
    check: await run(['check'], stream),
    repoUrl,
  };
}

const failed = (input: AuditInput) => auditNotes(input).checks.filter(c => !c.ok).map(c => c.id);

describe('auditNotes (T-032)', () => {
  test('a clean range passes every check (criteria 2, 3)', async () => {
    const result = auditNotes(await inputsFor(commits));
    assert.deepEqual(result.checks.map(c => c.id), ['exactly-once', 'counts', 'json-links', 'markdown-links', 'check-agrees']);
    assert.deepEqual(result.checks.filter(c => !c.ok), []);
    assert.equal(result.passed, true);
  });

  test('a commit in the range but not in the notes fails exactly-once and counts, naming it', async () => {
    const input = await inputsFor(commits.slice(1), commits.map(([s]) => s));
    const result = auditNotes(input);
    assert.deepEqual(failed(input), ['exactly-once', 'counts']);
    assert.match(result.checks[0]!.detail, new RegExp(`missing: ${sha('a').slice(0, 7)}`));
    assert.equal(result.passed, false);
  });

  test('a commit in the notes but not in the range fails exactly-once and json-links', async () => {
    const input = await inputsFor(commits, commits.slice(1).map(([s]) => s));
    assert.deepEqual(failed(input), ['exactly-once', 'counts', 'json-links']);
    assert.match(auditNotes(input).checks[0]!.detail, new RegExp(`extra: ${sha('a').slice(0, 7)}`));
  });

  test('a commit listed twice in the range fails exactly-once', async () => {
    const input = await inputsFor(commits, [...commits.map(([s]) => s), sha('b')]);
    assert.ok(failed(input).includes('exactly-once'));
  });

  test('a Markdown entry without its commit link fails markdown-links', async () => {
    const input = await inputsFor(commits);
    input.notesMarkdown = input.notesMarkdown.replace(`(${repoUrl}/commit/${sha('b')})`, '(https://example.com)');
    assert.deepEqual(failed(input), ['markdown-links']);
  });

  test('a JSON entry with a wrong link fails json-links', async () => {
    const input = await inputsFor(commits);
    input.notesJson = input.notesJson.replace(`${repoUrl}/commit/${sha('d')}`, `${repoUrl}/commit/${sha('f')}`);
    assert.deepEqual(failed(input), ['json-links']);
  });

  test('a malformed record fails exactly-once and counts', async () => {
    const list = commits.map(([s, m]) => record(s, m)).join('') + `NOTASHA${FS}x${FS}y${FS}chore: z${RS}\n`;
    const input: AuditInput = {
      revList: commits.map(([s]) => `${s}\n`).join(''),
      group: await run(['group'], list),
      notesJson: await run(['render', '--repo-url', repoUrl, '--format', 'json'], list),
      notesMarkdown: await run(['render', '--repo-url', repoUrl], list),
      check: await run(['check'], list),
      repoUrl,
    };
    assert.deepEqual(failed(input), ['exactly-once', 'counts']);
  });

  // Qodo local review finding 44bb76a4: a set comparison let two entries trade sources.
  test('two JSON entries with swapped sources fail json-links (finding 44bb76a4)', async () => {
    const input = await inputsFor(commits);
    const doc = JSON.parse(input.notesJson) as { sections: { entries: { source: unknown }[] }[] };
    const all = doc.sections.flatMap(s => s.entries);
    [all[0]!.source, all[1]!.source] = [all[1]!.source, all[0]!.source];
    input.notesJson = JSON.stringify(doc);
    assert.deepEqual(failed(input), ['json-links']);
  });

  // Qodo local review finding 7f66a5e3: the same for two Markdown lines.
  test('two Markdown lines with swapped links fail markdown-links (finding 7f66a5e3)', async () => {
    const input = await inputsFor(commits);
    const a = `/commit/${sha('a')})`;
    const b = `/commit/${sha('b')})`;
    input.notesMarkdown = input.notesMarkdown.replace(a, '@A@').replace(b, a).replace('@A@', b);
    assert.deepEqual(failed(input), ['markdown-links']);
  });

  // Qodo local review findings 7dc5829e and f9b538b4: the right links with the wrong subject,
  // or the right order in the wrong section, are wrong notes.
  test('a JSON entry with another entry\'s subject fails json-links (finding 7dc5829e)', async () => {
    const input = await inputsFor(commits);
    const doc = JSON.parse(input.notesJson) as { sections: { entries: { subject: string }[] }[] };
    const all = doc.sections.flatMap(s => s.entries);
    [all[0]!.subject, all[1]!.subject] = [all[1]!.subject, all[0]!.subject];
    input.notesJson = JSON.stringify(doc);
    assert.deepEqual(failed(input), ['json-links']);
  });

  test('a Markdown line with another entry\'s subject fails markdown-links (finding 7dc5829e)', async () => {
    const input = await inputsFor(commits);
    assert.ok(input.notesMarkdown.includes('add check'));
    input.notesMarkdown = input.notesMarkdown.replace('add check', 'escape more');
    assert.deepEqual(failed(input), ['markdown-links']);
  });

  test('a JSON entry moved to another section, same order, fails json-links (finding f9b538b4)', async () => {
    const input = await inputsFor(commits);
    const doc = JSON.parse(input.notesJson) as { sections: { title: string; entries: unknown[] }[] };
    const features = doc.sections.findIndex(s => s.title === 'Features');
    const fixes = doc.sections.findIndex(s => s.title === 'Bug fixes');
    assert.equal(fixes, features + 1);
    doc.sections[fixes]!.entries.unshift(...doc.sections[features]!.entries);
    doc.sections.splice(features, 1);
    input.notesJson = JSON.stringify(doc);
    assert.deepEqual(failed(input), ['json-links']);
  });

  test('a Markdown entry under the wrong heading fails markdown-links (finding f9b538b4)', async () => {
    const input = await inputsFor(commits);
    assert.ok(input.notesMarkdown.includes('### Bug fixes\n\n'));
    input.notesMarkdown = input.notesMarkdown.replace('### Bug fixes\n\n', '');
    assert.deepEqual(failed(input), ['markdown-links']);
  });

  // Qodo local review finding 5638c83e: render escapes a subject's brackets, so link-shaped text
  // in a subject is not a link and must not count as one.
  test('commit-link text inside a subject does not fail a clean audit (finding 5638c83e)', async () => {
    const subject = `feat: see [abc1234](https://example.com/o/r/commit/${sha('f')}) and [x](${repoUrl}/commit/${sha('a')})\n`;
    const input = await inputsFor([[sha('1'), subject], ...commits]);
    assert.ok(input.notesMarkdown.includes(`commit/${sha('f')})`), input.notesMarkdown);
    assert.deepEqual(failed(input), []);
  });

  // Qodo local review finding 4f944bf8: check's own totals were not added up.
  test('check totals that do not add up fail counts (finding 4f944bf8)', async () => {
    const input = await inputsFor(commits);
    assert.match(input.check, /checked 5: 3 passed, 1 failed, 1 skipped, 0 malformed/);
    input.check = input.check.replace('3 passed', '2 passed');
    assert.deepEqual(failed(input), ['counts']);
  });

  // Qodo local review finding 624dd0de: the summary's counts must match the lines check printed.
  test('a skip count offset by extra passes fails check-agrees (finding 624dd0de)', async () => {
    const input = await inputsFor(commits);
    input.check = input.check.replace('3 passed, 1 failed, 1 skipped', '4 passed, 1 failed, 0 skipped');
    assert.deepEqual(failed(input), ['check-agrees']);
    const fails = await inputsFor(commits);
    fails.check = fails.check.replace('3 passed, 1 failed', '2 passed, 2 failed');
    assert.deepEqual(failed(fails), ['check-agrees']);
  });

  // Qodo local review finding 4b2ac78e: a second commit link to another base went unnoticed.
  test('an entry line with a second commit link to another repository fails markdown-links (finding 4b2ac78e)', async () => {
    const input = await inputsFor(commits);
    const own = `(${repoUrl}/commit/${sha('a')})`;
    input.notesMarkdown = input.notesMarkdown.replace(own, `${own}, [x](https://example.com/o/r/commit/${sha('f')})`);
    assert.deepEqual(failed(input), ['markdown-links']);
  });

  // Qodo local review finding d457935f: skip lines carry short SHAs, which two merges can share.
  test('two merges with the same short SHA still pass check-agrees (finding d457935f)', async () => {
    const twin = `${'c'.repeat(7)}${'d'.repeat(33)}`;
    const input = await inputsFor([...commits, [twin, 'Merge branch \'x\'\n']]);
    assert.equal(input.check.split('\n').filter(line => line === `skip ${'c'.repeat(7)} merge commit`).length, 2);
    assert.deepEqual(failed(input), []);
    input.check = input.check.replace(`skip ${'c'.repeat(7)} merge commit\n`, '');
    assert.deepEqual(failed(input), ['check-agrees']);
  });

  test('a check total that disagrees fails counts; a missing skip line fails check-agrees', async () => {
    const input = await inputsFor(commits);
    input.check = input.check.replace('checked 5:', 'checked 4:');
    assert.deepEqual(failed(input), ['counts']);
    const noSkip = await inputsFor(commits);
    noSkip.check = noSkip.check.replace(`skip ${sha('c').slice(0, 7)} merge commit\n`, '');
    assert.deepEqual(failed(noSkip), ['check-agrees']);
  });

  // PR 30 review, finding 633aace6: each Markdown line must be exactly the expected line, and the
  // JSON PR link must match too; extra text or a wrong PR link is a wrong note.
  test('extra text on a Markdown line, or a wrong PR link, fails (finding 633aace6)', async () => {
    const extra = await inputsFor(commits);
    extra.notesMarkdown = extra.notesMarkdown.replace('add check (', 'add check, and more (');
    assert.deepEqual(failed(extra), ['markdown-links']);
    const after = await inputsFor(commits);
    after.notesMarkdown = after.notesMarkdown.replace(`/pull/28))`, `/pull/28)) trailing`);
    assert.deepEqual(failed(after), ['markdown-links']);
    const pr = await inputsFor(commits);
    pr.notesMarkdown = pr.notesMarkdown.replace(`[#28](${repoUrl}/pull/28)`, `[#29](${repoUrl}/pull/29)`);
    assert.deepEqual(failed(pr), ['markdown-links']);
    const json = await inputsFor(commits);
    json.notesJson = json.notesJson.replace(`"${repoUrl}/pull/28"`, '"https://example.com/o/r/pull/28"');
    assert.deepEqual(failed(json), ['json-links']);
  });

  // PR 30 review, finding 8f818660: the BREAKING CHANGE notes are part of the entry too.
  test('a lost or changed breaking-change note fails (finding 8f818660)', async () => {
    const base = await inputsFor(commits);
    assert.ok(base.notesJson.includes('"the old syntax is gone"'));
    assert.ok(base.notesMarkdown.includes('\n  - the old syntax is gone\n'));
    const json = await inputsFor(commits);
    json.notesJson = json.notesJson.replace('"the old syntax is gone"', '"something else"');
    assert.deepEqual(failed(json), ['json-links']);
    const lost = await inputsFor(commits);
    lost.notesMarkdown = lost.notesMarkdown.replace('\n  - the old syntax is gone\n', '\n');
    assert.deepEqual(failed(lost), ['markdown-links']);
    const changed = await inputsFor(commits);
    changed.notesMarkdown = changed.notesMarkdown.replace('  - the old syntax is gone', '  - the old syntax stays');
    assert.deepEqual(failed(changed), ['markdown-links']);
    const added = await inputsFor(commits);
    added.notesMarkdown = added.notesMarkdown.replace(`/commit/${sha('b')}))\n`, `/commit/${sha('b')}))\n  - an invented note\n`);
    assert.deepEqual(failed(added), ['markdown-links']);
  });

  // PR 30 review, finding 234d5143: the skill runs without --config, so a commit in `ignored` that
  // is not a merge is a commit missing from the notes, even when every output agrees about it.
  test('a non-merge commit in ignored fails exactly-once, even with consistent outputs (finding 234d5143)', async () => {
    const config = path.join(repoRoot, 'tests', 'fixtures', 'config-ignore-fix.json');
    const stream = commits.map(([s, m]) => record(s, m)).join('');
    const input: AuditInput = {
      revList: commits.map(([s]) => `${s}\n`).join(''),
      group: await run(['group', '--config', config], stream),
      notesJson: await run(['render', '--repo-url', repoUrl, '--format', 'json', '--config', config], stream),
      notesMarkdown: await run(['render', '--repo-url', repoUrl, '--config', config], stream),
      check: await run(['check'], stream),
      repoUrl,
    };
    assert.match(input.group, /"reason": "ignore pattern: \^feat"/);
    const result = auditNotes(input);
    assert.deepEqual(failed(input), ['exactly-once']);
    assert.match(result.checks[0]!.detail, new RegExp(`ignored but not a merge: ${sha('a').slice(0, 7)}`));
  });

  // PR 30 review, finding be79ef1c: the Markdown footer's counts must agree too.
  test('a Markdown footer with a wrong count fails counts (finding be79ef1c)', async () => {
    const input = await inputsFor(commits);
    assert.match(input.notesMarkdown, /_4 of 5 commits shown; 1 merge commits ignored; 0 malformed records skipped\._/);
    input.notesMarkdown = input.notesMarkdown.replace('1 merge commits ignored', '0 merge commits ignored');
    assert.deepEqual(failed(input), ['counts']);
  });

  // PR 30 review, finding e1492647: a rejected URL may carry credentials; it is never quoted.
  test('a rejected repository URL is not quoted in the error (finding e1492647)', async () => {
    const good = await inputsFor(commits);
    assert.throws(
      () => auditNotes({ ...good, repoUrl: 'https://user:SECRET@github.com/o/r' }),
      (error: unknown) => error instanceof RangeError && !error.message.includes('SECRET') && !error.message.includes('user'),
    );
  });

  test('unreadable input throws RangeError, nothing is guessed (criterion 4)', async () => {
    const good = await inputsFor(commits);
    const cases: Partial<AuditInput>[] = [
      { revList: 'abc\n' },
      { revList: `${sha('A')}\n` },
      { revList: '' },
      { group: '{' },
      { notesJson: 'not json' },
      { check: 'fail x\n' },
      { repoUrl: 'https://github.com/o/r/' },
      // PR 30 review, finding 9d61dab6: null members are input errors, not script crashes.
      { group: '{"sections":[null],"ignored":[],"malformed":[],"total":0}' },
      { group: '{"sections":[{"title":"Features","entries":[null]}],"ignored":[],"malformed":[],"total":0}' },
      { notesJson: '{"sections":[{"title":"Features","entries":[null]}],"counts":{"shown":0,"total":0,"ignored":0,"malformed":0}}' },
      // be79ef1c: notes without the footer cannot be checked.
      { notesMarkdown: '## Unreleased\n' },
    ];
    for (const change of cases) {
      assert.throws(() => auditNotes({ ...good, ...change }), RangeError, JSON.stringify(change));
    }
  });
});

describe('release-notes-audit entry as a child process (criterion 5)', () => {
  const base = mkdtempSync(path.join(os.tmpdir(), 'tracenotes-audit-'));
  after(() => rmSync(base, { recursive: true, force: true }));

  const write = (dir: string, input: AuditInput) => {
    writeFileSync(path.join(dir, 'rev-list.txt'), input.revList);
    writeFileSync(path.join(dir, 'group.json'), input.group);
    writeFileSync(path.join(dir, 'notes.json'), input.notesJson);
    writeFileSync(path.join(dir, 'notes.md'), input.notesMarkdown);
    writeFileSync(path.join(dir, 'check.txt'), input.check);
  };
  const runScript = (args: string[]) => {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };

  test('PASS: exit 0, one line per check and the verdict', async () => {
    const dir = mkdtempSync(path.join(base, 'pass-'));
    write(dir, await inputsFor(commits));
    const { code, stdout, stderr } = runScript([dir, repoUrl]);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    const lines = stdout.trimEnd().split('\n');
    assert.equal(lines.length, 6, stdout);
    assert.ok(lines.slice(0, 5).every(line => line.startsWith('PASS ')), stdout);
    assert.equal(lines[5], 'audit: PASS');
  });

  test('FAIL: exit 1 and the count of failed checks', async () => {
    const dir = mkdtempSync(path.join(base, 'fail-'));
    write(dir, await inputsFor(commits.slice(1), commits.map(([s]) => s)));
    const { code, stdout } = runScript([dir, repoUrl]);
    assert.equal(code, 1);
    assert.match(stdout, /^FAIL exactly-once: /m);
    assert.match(stdout, /\naudit: FAIL \(2 of 5 checks failed\)\n$/);
  });

  test('bad input or usage: exit 2, one error line, nothing on stdout', async () => {
    const dir = mkdtempSync(path.join(base, 'bad-'));
    write(dir, { ...(await inputsFor(commits)), revList: 'abc\n' });
    for (const args of [[dir, repoUrl], [dir], [path.join(base, 'missing'), repoUrl]]) {
      const { code, stdout, stderr } = runScript(args);
      assert.equal(code, 2, args.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: [^\n]+\n$/);
    }
  });

  // PR 30 review, finding 2a84cc4a: the error line escapes what JSON leaves raw.
  test('an error message with a bidi override or a line separator stays one escaped line (finding 2a84cc4a)', async () => {
    const dir = mkdtempSync(path.join(base, 'bidi-'));
    const odd = [String.fromCodePoint(0x202e), String.fromCodePoint(0x2028), String.fromCodePoint(0x85)];
    write(dir, { ...(await inputsFor(commits)), revList: `ab${odd.join('')}cd\n` });
    const { code, stderr } = runScript([dir, repoUrl]);
    assert.equal(code, 2);
    for (const ch of odd) assert.ok(!stderr.includes(ch), JSON.stringify(stderr));
    assert.ok(stderr.includes('ab' + ['202e', '2028', '0085'].map(c => String.fromCharCode(92) + 'u' + c).join('') + 'cd'), stderr);
  });

  test('a rejected repository URL is not printed by the entry either (finding e1492647)', async () => {
    const dir = mkdtempSync(path.join(base, 'token-'));
    write(dir, await inputsFor(commits));
    const { code, stderr } = runScript([dir, 'https://user:SECRET@github.com/o/r']);
    assert.equal(code, 2);
    assert.ok(!stderr.includes('SECRET'), stderr);
  });
});

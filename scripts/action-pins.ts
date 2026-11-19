/**
 * Action pins (T-034): every `uses:` in a workflow names a full commit SHA and, in a comment,
 * the release it was taken from. A moving tag (`@v1`) runs whatever it points to on the day of
 * the run; in the agent workflows that code runs with the Anthropic key and write tokens.
 *
 * Usage: `node scripts/action-pins.ts [dir]` (default `.github/workflows`). Prints one line per
 * problem and exits 1, or exits 0 when every `uses:` is pinned.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One `uses:` line that is not pinned, with a reason a person can act on. */
export interface PinProblem {
  file: string;
  line: number;
  action: string;
  reason: string;
}

// The one supported spelling: a block key `uses:` at the start of the line or after `- `.
const USES = /^\s*(?:-\s+)?uses:\s*(.*)$/;
// Anything else where `uses` could be a key: a space before the colon, a quoted key, a flow
// mapping, anywhere on the line, comments included. A line regex cannot parse YAML, so the
// check fails closed: such a line is reported, never skipped (human decision, Nov 19, after
// Qodo local review findings 64a7ab3d, cb8ef482 and ccd2f27a). Text that only looks like the
// key (in a `run:` string) is reported too; that false alarm is accepted (finding da3acbde).
const USES_ANYWHERE = /(?:^|[\s{,"'])uses["']?\s*:/;
// A double-quoted key with a backslash escape: YAML reads `"\u0075ses"` as `uses`, which no
// text match sees (Qodo local review finding 5fa32f55). Any such key is reported. GitHub's
// repository setting `sha_pinning_required` is the control; this check is the early warning.
const ESCAPED_KEY = /"[^"\n]*\\[^"\n]*"\s*:/;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s@]+)?@[0-9a-f]{40}$/;
// The exact release tag the SHA was taken from: `v1.2.3`, `1.2.3`, `v1.2.3-rc.1`, `v1.2.3+b`.
// Not a moving tag or a note (Qodo local review findings af5d2700, a42b757b).
const RELEASE_COMMENT = /^#\s*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Finds the `uses:` lines in one workflow file that are not pinned.
 *
 * Input: the file's text and the name to report it under. Output: one problem per line where
 * `uses` can stand as a key, unless the line is exactly `uses: <owner>/<repo>[/<path>]@<40
 * lowercase hex> # <release tag>` (as a block key, optionally after `- `). Every other spelling
 * (a flow mapping, a quoted key, a space before the colon, a local `./` action, a `docker://`
 * image, a quoted value, the word in other text, or any double-quoted key with a backslash
 * escape) is reported as unsupported: the check fails closed. Other lines are ignored. Never
 * throws. This is an early warning; GitHub's `sha_pinning_required` setting enforces the rule.
 */
export function unpinnedUses(text: string, file: string): PinProblem[] {
  const problems: PinProblem[] = [];
  text.split('\n').forEach((raw, index) => {
    const line = raw.replace(/\r$/, '');
    if (!USES_ANYWHERE.test(line) && !ESCAPED_KEY.test(line)) return;
    const match = USES.exec(line);
    if (!match) {
      problems.push({
        file,
        line: index + 1,
        action: line.trim(),
        reason: 'unsupported form: write the step as `uses: <owner>/<repo>@<sha> # <release tag>`, and keep `uses:` out of other text',
      });
      return;
    }
    const rest = match[1]!.trim();
    const hash = rest.indexOf(' #');
    const action = (hash === -1 ? rest : rest.slice(0, hash)).trim();
    const comment = hash === -1 ? '' : rest.slice(hash + 1).trim();
    const report = (reason: string) => problems.push({ file, line: index + 1, action, reason });
    if (action.startsWith('./') || action.startsWith('docker://') || /^["']/.test(action)) {
      report('unsupported form: only <owner>/<repo>@<sha> is checked');
    } else if (!PINNED.test(action)) {
      report('not pinned to a full commit SHA (40 lowercase hex characters)');
    } else if (!RELEASE_COMMENT.test(comment)) {
      report('pinned, but no "# <release tag>" comment (such as # v1.2.3) names the release the SHA was taken from');
    }
  });
  return problems;
}

/**
 * Checks every `.yml` and `.yaml` file directly in `dir`. Output: all problems, files in name
 * order. Throws the system error when the directory or a file cannot be read.
 */
export function workflowPinProblems(dir: string): PinProblem[] {
  return readdirSync(dir)
    .filter(name => /\.ya?ml$/.test(name))
    .sort()
    .flatMap(name => unpinnedUses(readFileSync(path.join(dir, name), 'utf8'), name));
}

/** One report line: `file:line: action: reason`. */
export function describePinProblem(p: PinProblem): string {
  return `${p.file}:${p.line}: ${JSON.stringify(p.action)}: ${p.reason}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = workflowPinProblems(process.argv[2] ?? '.github/workflows');
  for (const p of problems) process.stdout.write(`${describePinProblem(p)}\n`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

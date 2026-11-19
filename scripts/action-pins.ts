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

// The one supported spelling, matched on the raw line with ASCII space and tab only, nothing
// trimmed first (rule 6; Qodo PR 34 review finding 28bcc7c0): a block key `uses:` at the start
// of the line or after `- `, the action, then optionally the release comment.
const STEP = /^[ \t]*(?:-[ \t]+)?uses:[ \t]+([^ \t#]+)(?:[ \t]+(#.*?))?[ \t]*$/;
// A line regex cannot parse YAML, so the check fails closed (human decisions, Nov 19): every
// line with the word `uses` anywhere (a flow mapping or sequence, a quoted or tagged key, a
// space before the colon, a comment, text in a `run:` string) is reported unless it is exactly
// a pinned STEP. Qodo local review findings 64a7ab3d, cb8ef482, ccd2f27a; PR 34 review finding
// 2dab9c1b. The false alarm on text is accepted (finding da3acbde).
const USES_WORD = /(?<![A-Za-z0-9_-])uses(?![A-Za-z0-9_-])/;
// An explicit key (`? key` with the value on a later line) is reported whatever the key says,
// so a key spelled across lines is never skipped (Qodo PR 34 review finding 3a2670fe).
const EXPLICIT_KEY = /^[ \t]*(?:-[ \t]+)?\?(?:[ \t]|$)/;
// A double-quoted key with a backslash escape: YAML reads `"\u0075ses"` as `uses`, which no
// text match sees (Qodo local review finding 5fa32f55). Any such key is reported. GitHub's
// repository setting `sha_pinning_required` is the control; this check is the early warning.
const ESCAPED_KEY = /"[^"\n]*\\[^"\n]*"\s*:/;
const PINNED = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\/[^\s@]+)?@[0-9a-f]{40}$/;
// The exact release tag the SHA was taken from: `v1.2.3`, `1.2.3`, `v1.2.3-rc.1`, `v1.2.3+b`.
// Not a moving tag or a note (Qodo local review findings af5d2700, a42b757b).
const RELEASE_COMMENT = /^#[ \t]*v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

/**
 * Finds the `uses:` lines in one workflow file that are not pinned.
 *
 * Input: the file's text and the name to report it under. Output: one problem per line that
 * holds the word `uses`, an explicit key (`? …`) or a double-quoted key with a backslash
 * escape, unless the line is exactly `uses: <owner>/<repo>[/<path>]@<40 lowercase hex>
 * # <release tag>` as a block key (optionally after `- `), with only ASCII spaces and tabs
 * around the parts. Nothing is trimmed before the match. Every other form is reported: the
 * check fails closed. Other lines are ignored. Never throws. This is an early warning;
 * GitHub's `sha_pinning_required` setting enforces the rule.
 */
export function unpinnedUses(text: string, file: string): PinProblem[] {
  const problems: PinProblem[] = [];
  text.split('\n').forEach((raw, index) => {
    // The line ending is framing, not content: only the `\r` of a CRLF file is removed.
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (!USES_WORD.test(line) && !EXPLICIT_KEY.test(line) && !ESCAPED_KEY.test(line)) return;
    const match = STEP.exec(line);
    if (!match) {
      problems.push({
        file,
        line: index + 1,
        action: line,
        reason: 'unsupported form: write the step as `uses: <owner>/<repo>@<sha> # <release tag>`, and keep `uses` out of other text',
      });
      return;
    }
    const action = match[1]!;
    const comment = match[2] ?? '';
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

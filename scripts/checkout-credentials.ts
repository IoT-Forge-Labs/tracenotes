/**
 * Checkout credentials (T-035): every `actions/checkout` step sets `persist-credentials: false`.
 * By default the action leaves the job's token in `.git/config`, where every later step of the
 * job can read it. Found by Arnica on Day 16 (rule "GitHub actions artipacked vulnerability").
 *
 * Usage: `node scripts/checkout-credentials.ts [dir]` (default `.github/workflows`). Prints one
 * line per problem and exits 1, or exits 0 when every checkout step sets the option.
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** One checkout step that keeps its credential, or a line this check cannot read. */
export interface CredentialProblem {
  file: string;
  line: number;
  reason: string;
}

// A line regex cannot parse YAML, so the check fails closed, like the pin check (T-034): every
// line that mentions the action must be exactly a block step, indented with spaces only.
// GitHub reads action names without regard to case, so the mention is matched that way; the
// step itself must still be spelled in lower case (Qodo local review finding 4397bda9).
const MENTION = /actions\/checkout/i;
// A `uses` key or value written with a quote or a backslash can spell the action without its
// name appearing: YAML reads `"actions/\u0063heckout"` as `actions/checkout`. Such a line is
// reported whatever it spells (Qodo local review finding 5dcf1618). The pin check
// (`action-pins.ts`) reports the same lines; this check does not rely on it.
const QUOTED_USES = /(?<![A-Za-z0-9_-])uses(?![A-Za-z0-9_-]).*["'\\]|["'\\].*(?<![A-Za-z0-9_-])uses(?![A-Za-z0-9_-])/;
const STEP = /^( *)(- +)?uses:[ \t]+actions\/checkout@[^ \t#"'\\]+(?:[ \t]+#[^"'\\]*)?[ \t]*$/;
const WITH = /^with:[ \t]*$/;
// One line of the step's `with:` block: `key: plain value`. No comment, no quote, no value that
// can continue on the next line (block scalar, flow collection, anchor, alias, tag). A line
// regex cannot tell the text of a multi-line value from a key, so such a block is reported
// (Qodo local review finding ea881e83).
const ENTRY = /^( +)[A-Za-z0-9_-]+:[ \t]+[^ \t"'#|>[\]{}&*!%@`\\][^"'#\\]*$/;
const OPTION = /^ +persist-credentials:[ \t]+false[ \t]*$/;
const OPTION_KEY = /persist-credentials/;
const BLANK = /^[ \t]*$/;

/**
 * Finds the checkout steps in one workflow file that do not set `persist-credentials: false`.
 *
 * Input: the file's text and the name to report it under. Output: one problem per line that
 * mentions `actions/checkout`, or holds the word `uses` together with a quote or a backslash,
 * unless that line is a block `uses:` step for the action, the next line is `with:` at the same
 * column as `uses`, every line of that block (the following lines indented deeper than
 * `with:`, up to the last one that is not blank) is `key: plain value` at one indentation, and
 * exactly one of them is `persist-credentials: false`. Nothing is trimmed before a match
 * except the `\r` of a CRLF line ending. Never throws.
 */
export function persistedCredentials(text: string, file: string): CredentialProblem[] {
  const lines = text.split('\n').map(raw => (raw.endsWith('\r') ? raw.slice(0, -1) : raw));
  const problems: CredentialProblem[] = [];
  lines.forEach((line, index) => {
    if (!MENTION.test(line) && !QUOTED_USES.test(line)) return;
    const report = (reason: string) => problems.push({ file, line: index + 1, reason });
    const step = STEP.exec(line);
    if (!step) {
      report('unsupported form: write the step as a block `uses: actions/checkout@<sha> # <release tag>`, and keep the action name out of other text');
      return;
    }
    const key = ' '.repeat(step[1]!.length + (step[2]?.length ?? 0));
    const next = lines[index + 1] ?? '';
    if (!next.startsWith(key) || !WITH.test(next.slice(key.length))) {
      report('the line after the step must be its `with:` block, holding `persist-credentials: false`');
      return;
    }
    // The block: every following line that is blank or indented deeper than `with:`. Blank
    // lines at its end belong to the gap before the next step; one inside it does not end it.
    const block: string[] = [];
    for (let i = index + 2; i < lines.length && (BLANK.test(lines[i]!) || lines[i]!.startsWith(`${key} `)); i += 1) {
      block.push(lines[i]!);
    }
    while (block.length > 0 && BLANK.test(block[block.length - 1]!)) block.pop();
    const indent = ENTRY.exec(block[0] ?? '')?.[1];
    if (indent === undefined || block.some(entry => ENTRY.exec(entry)?.[1] !== indent)) {
      report('unsupported form: every line of the checkout step\'s `with:` block must be `key: plain value` at one indentation, with no comment, quote, blank line or multi-line value');
      return;
    }
    const set = block.filter(entry => OPTION.test(entry)).length;
    const mentioned = block.filter(entry => OPTION_KEY.test(entry)).length;
    if (set !== 1 || mentioned !== 1) {
      report('`with:` must hold `persist-credentials: false` exactly once, on a line of its own');
    }
  });
  return problems;
}

/**
 * Checks every `.yml` and `.yaml` file directly in `dir`. Output: all problems, files in name
 * order. Throws the system error when the directory or a file cannot be read.
 */
export function workflowCredentialProblems(dir: string): CredentialProblem[] {
  return readdirSync(dir)
    .filter(name => /\.ya?ml$/.test(name))
    .sort()
    .flatMap(name => persistedCredentials(readFileSync(path.join(dir, name), 'utf8'), name));
}

/** One report line: `file:line: reason`. */
export function describeCredentialProblem(p: CredentialProblem): string {
  return `${p.file}:${p.line}: ${p.reason}`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const problems = workflowCredentialProblems(process.argv[2] ?? '.github/workflows');
  for (const p of problems) process.stdout.write(`${describeCredentialProblem(p)}\n`);
  process.exitCode = problems.length === 0 ? 0 : 1;
}

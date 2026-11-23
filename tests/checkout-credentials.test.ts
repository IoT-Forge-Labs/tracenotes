import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  describeCredentialProblem,
  persistedCredentials,
  workflowCredentialProblems,
} from '../scripts/checkout-credentials.ts';

// tickets/T-035-checkout-credentials.md
// The check fails closed, like the pin check: a checkout step in any form other than a block
// step followed by its own `with:` holding `persist-credentials: false` once is reported.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const checkout = 'actions/checkout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09 # v5.1.0';
const lines = (text: string[]) => persistedCredentials(text.join('\n'), 'w.yml').map(p => p.line);

describe('persistedCredentials', () => {
  test('a step that sets the option passes, as a list item or after another key (criterion 2)', () => {
    assert.deepEqual(lines([
      'steps:',
      `  - uses: ${checkout}`,
      '    with:',
      '      fetch-depth: 0',
      '      persist-credentials: false',
      '',
      "  - if: steps.guard.outputs.allowed == 'true'",
      `    uses: ${checkout}`,
      '    with:',
      '      persist-credentials: false',
      '  - run: npm ci',
    ]), []);
  });

  test('CRLF line endings are framing, not content (criterion 2)', () => {
    const text = [`- uses: ${checkout}`, '  with:', '    persist-credentials: false', ''].join('\r\n');
    assert.deepEqual(persistedCredentials(text, 'w.yml'), []);
  });

  test('a step with no `with:` block is reported with its file and line (criterion 2)', () => {
    const problems = persistedCredentials(['steps:', `  - uses: ${checkout}`, '', '  - run: npm ci'].join('\n'), 'check.yml');
    assert.deepEqual(problems.map(p => [p.file, p.line]), [['check.yml', 2]]);
    assert.match(problems[0]!.reason, /with:/);
    assert.equal(describeCredentialProblem(problems[0]!), `check.yml:2: ${problems[0]!.reason}`);
  });

  test('a `with:` block without the option is reported (criterion 2)', () => {
    assert.deepEqual(lines([`  - uses: ${checkout}`, '    with:', '      fetch-depth: 0']), [1]);
  });

  test('the option of the next step does not count for this one (criterion 2)', () => {
    assert.deepEqual(lines([
      `  - uses: ${checkout}`,
      '    with:',
      '      fetch-depth: 0',
      '  - uses: other/action@v1',
      '    with:',
      '      persist-credentials: false',
    ]), [1]);
  });

  test('any value other than a bare false is reported (criterion 2)', () => {
    for (const value of ['true', "'false'", '"false"', 'False', 'no', '', 'false # later', '${{ inputs.keep }}']) {
      assert.deepEqual(lines([`- uses: ${checkout}`, '  with:', `    persist-credentials: ${value}`]), [1], value);
    }
  });

  test('the option given twice, or nested under another key, is reported (criterion 2)', () => {
    assert.deepEqual(lines([
      `- uses: ${checkout}`,
      '  with:',
      '    persist-credentials: false',
      '    persist-credentials: true',
    ]), [1]);
    assert.deepEqual(lines([
      `- uses: ${checkout}`,
      '  with:',
      '    other:',
      '      persist-credentials: false',
    ]), [1]);
  });

  test('`with:` at another column, a flow mapping or a key in between is reported (criterion 2)', () => {
    assert.deepEqual(lines([`- uses: ${checkout}`, '    with:', '      persist-credentials: false']), [1]);
    assert.deepEqual(lines([`- uses: ${checkout}`, '  with: { persist-credentials: false }']), [1]);
    assert.deepEqual(lines([`- uses: ${checkout}`, '  name: checkout', '  with:', '    persist-credentials: false']), [1]);
  });

  test('every other mention of the action is reported as unsupported (criterion 2)', () => {
    const problems = persistedCredentials([
      '- { uses: actions/checkout@v5 }',
      '- "uses": actions/checkout@v5',
      '-\tuses: actions/checkout@v5',
      '# actions/checkout keeps the token',
    ].join('\n'), 'w.yml');
    assert.deepEqual(problems.map(p => p.line), [1, 2, 3, 4]);
    for (const p of problems) assert.match(p.reason, /unsupported form/);
  });

  // Qodo local review finding ea881e83: a comment set the block's indentation, and the text of a
  // block scalar then counted as the option.
  test('text inside a multi-line value does not count as the option (criterion 2)', () => {
    assert.deepEqual(lines([
      `- uses: ${checkout}`,
      '  with:',
      '      # a comment, indented like the text below',
      '    ssh-known-hosts: |',
      '      persist-credentials: false',
    ]), [1]);
    assert.deepEqual(lines([
      `- uses: ${checkout}`,
      '  with:',
      '    ssh-known-hosts: |',
      '      github.com ssh-ed25519 AAAA',
      '    persist-credentials: false',
    ]), [1]);
  });

  test('a comment, a quote or a blank line inside `with:` is reported (criterion 2)', () => {
    assert.deepEqual(lines([`- uses: ${checkout}`, '  with:', '    # why', '    persist-credentials: false']), [1]);
    assert.deepEqual(lines([`- uses: ${checkout}`, '  with:', '    ref: "main"', '    persist-credentials: false']), [1]);
    assert.deepEqual(lines([
      `- uses: ${checkout}`,
      '  with:',
      '    persist-credentials: false',
      '',
      '    persist-credentials: true',
    ]), [1]);
  });

  test('blank lines after the block, before the next step, are fine (criterion 2)', () => {
    assert.deepEqual(lines([`- uses: ${checkout}`, '  with:', '    persist-credentials: false', '', '  ', '- run: npm ci']), []);
  });

  // Qodo local review finding 5dcf1618: YAML reads a double-quoted value with a backslash
  // escape for the letter c as the checkout action, and no text match on the name sees it.
  test('a quoted or escaped `uses` value is reported whatever it spells (criterion 2)', () => {
    const backslash = String.fromCodePoint(0x5c);
    const escaped = `- uses: "actions/${backslash}u0063heckout@fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09" # v5.1.0`;
    assert.ok(!escaped.includes('checkout'));
    const problems = persistedCredentials([
      escaped,
      "- uses: 'owner/repo@v1'",
      '- "uses": owner/repo@v1',
    ].join(String.fromCodePoint(0x0a)), 'w.yml');
    assert.deepEqual(problems.map(p => p.line), [1, 2, 3]);
    for (const p of problems) assert.match(p.reason, /unsupported form/);
  });

  // Qodo local review finding 4397bda9: GitHub reads action names without regard to case.
  test('the action name in another letter case is reported, not skipped (criterion 2)', () => {
    const sha = 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09';
    for (const name of ['Actions/Checkout', 'ACTIONS/CHECKOUT', 'actions/Checkout']) {
      const problems = persistedCredentials(`- uses: ${name}@${sha} # v5.1.0`, 'w.yml');
      assert.deepEqual(problems.map(p => p.line), [1], name);
      assert.match(problems[0]!.reason, /unsupported form/, name);
    }
  });

  test('a file without a checkout step has no problems (criterion 2)', () => {
    assert.deepEqual(lines(['steps:', '  - run: echo persist-credentials: true']), []);
  });
});

// Qodo local review finding 140b01cb: the entry block, its argument and its exit status.
describe('checkout-credentials as a child process', () => {
  const scriptPath = path.join(repoRoot, 'scripts', 'checkout-credentials.ts');
  function runScript(args: string[]) {
    const result = spawnSync(process.execPath, [scriptPath, ...args], { cwd: repoRoot, encoding: 'utf8' });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  }
  function withWorkflows(files: Record<string, string[]>, run: (dir: string) => void) {
    const dir = mkdtempSync(path.join(tmpdir(), 'checkout-credentials-'));
    try {
      for (const [name, text] of Object.entries(files)) writeFileSync(path.join(dir, name), text.join('\n'));
      run(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test('no argument: the workflows of this repository, exit 0, nothing printed', () => {
    const { code, stdout, stderr } = runScript([]);
    assert.equal(code, 0, stderr);
    assert.equal(stdout, '');
  });

  test('a directory with a step that keeps its credential: exit 1, one line per problem, files in name order', () => {
    withWorkflows({
      'b.yml': ['steps:', `  - uses: ${checkout}`],
      'a.yaml': [`- uses: ${checkout}`, '  with:', '    fetch-depth: 0'],
      'ok.yml': [`- uses: ${checkout}`, '  with:', '    persist-credentials: false'],
      'notes.txt': [`- uses: ${checkout}`],
    }, dir => {
      const { code, stdout } = runScript([dir]);
      assert.equal(code, 1);
      const printed = stdout.split('\n');
      assert.equal(printed.length, 3);
      assert.match(printed[0]!, /^a\.yaml:1: `with:` must hold/);
      assert.match(printed[1]!, /^b\.yml:2: the line after the step must be its `with:` block/);
      assert.equal(printed[2], '');
    });
  });

  test('a directory where every step sets the option: exit 0', () => {
    withWorkflows({ 'ok.yml': [`- uses: ${checkout}`, '  with:', '    persist-credentials: false'] }, dir => {
      const { code, stdout, stderr } = runScript([dir]);
      assert.equal(code, 0, stderr);
      assert.equal(stdout, '');
    });
  });
});

describe('the workflows of this repository', () => {
  test('every checkout step sets persist-credentials: false (criterion 1)', () => {
    const problems = workflowCredentialProblems(path.join(repoRoot, '.github', 'workflows'));
    assert.deepEqual(problems.map(describeCredentialProblem), []);
  });
});

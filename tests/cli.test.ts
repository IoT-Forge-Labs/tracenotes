import { after, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { main } from '../src/cli.ts';

// These tests run the CLI as a real child process, which is the only way to
// cover the "invoked directly" entry check across platforms. No network; git runs only in the
// throwaway repositories of the T-010 block at the end, never against this repository.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cliPath = path.join(repoRoot, 'src', 'cli.ts');

function runCli(args: string[], input?: string) {
  const result = spawnSync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    encoding: 'utf8',
    input: input ?? '',
  });
  return { code: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('cli', () => {
  test('parse with an argument prints JSON and exits 0', () => {
    const { code, stdout, stderr } = runCli(['parse', 'feat(cli): add parse command (#42)']);
    assert.equal(code, 0, stderr);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.type, 'feat');
    assert.equal(parsed.scope, 'cli');
    assert.equal(parsed.prNumber, 42);
  });

  test('parse reads the message from stdin when no argument is given', () => {
    const { code, stdout } = runCli(['parse'], 'fix: from stdin\n\nRefs: #3\n');
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout);
    assert.equal(parsed.subject, 'from stdin');
    assert.deepEqual(parsed.issueRefs, [3]);
  });

  test('empty input exits 2 with an error', () => {
    const { code, stdout, stderr } = runCli(['parse'], '');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /empty commit message/);
  });

  test('unknown command exits 2 and prints usage', () => {
    const { code, stderr } = runCli(['bogus']);
    assert.equal(code, 2);
    assert.match(stderr, /unknown command "bogus"/);
    assert.match(stderr, /Usage:/);
  });

  // T-002 criterion 8
  test('log parses a stream from stdin, reports malformed records, and exits 0', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const { code, stdout } = runCli(['log'], stream);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.count, 6);
    assert.equal(result.commits.length, 5);
    assert.equal(result.malformed.length, 1);
  });

  test('log with empty stdin exits 2', () => {
    const { code, stderr } = runCli(['log'], '');
    assert.equal(code, 2);
    assert.match(stderr, /empty git log stream/);
  });

  // T-003 criterion 8
  test('group prints ReleaseGroups, passes malformed through, exits 0', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const { code, stdout } = runCli(['group'], stream);
    assert.equal(code, 0);
    const result = JSON.parse(stdout);
    assert.equal(result.total, 5);
    assert.equal(result.malformed.length, 1);
    assert.equal(result.ignored.length, 1);
    assert.equal(result.sections[0].title, 'Breaking changes');
  });

  test('group with empty stdin exits 2', () => {
    const { code, stdout, stderr } = runCli(['group'], '');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /empty git log stream/);
  });

  // T-004 criterion 8
  test('render prints Markdown with and without --repo-url, exits 0', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const plain = runCli(['render'], stream);
    assert.equal(plain.code, 0, plain.stderr);
    assert.ok(plain.stdout.startsWith('## Unreleased\n'));
    assert.match(plain.stdout, /\(`2222222`, #1\)/);
    const url = 'https://github.com/UBayouski/tracenotes';
    const linked = runCli(['render', '--repo-url', url], stream);
    assert.equal(linked.code, 0, linked.stderr);
    assert.ok(linked.stdout.includes(`[#1](${url}/pull/1)`));
  });

  test('render rejects an invalid URL, a missing value and unknown options with nothing on stdout', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    for (const args of [['--repo-url', 'https://github.com/a/b/'], ['--repo-url'], ['--bogus']]) {
      const { code, stdout, stderr } = runCli(['render', ...args], stream);
      assert.equal(code, 2, args.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: /);
    }
    assert.match(runCli(['render', '--repo-url', 'http://x/a/b'], stream).stderr, /http:\/\/x\/a\/b/);
  });

  // T-007 criterion 9
  test('render --format json prints the notes document, with and without --repo-url', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const plain = runCli(['render', '--format', 'json'], stream);
    assert.equal(plain.code, 0, plain.stderr);
    assert.equal(plain.stderr, '');
    assert.ok(plain.stdout.endsWith('}\n'));
    const doc = JSON.parse(plain.stdout);
    assert.equal(doc.schemaVersion, 1);
    assert.deepEqual(doc.counts, { shown: 4, total: 5, ignored: 1, malformed: 1 });
    assert.equal(doc.sections[2].entries[0].source.sha, '2'.repeat(40));
    assert.equal(doc.sections[2].entries[0].source.commitUrl, null);
    const url = 'https://github.com/UBayouski/tracenotes';
    for (const args of [['--format', 'json', '--repo-url', url], ['--repo-url', url, '--format', 'json']]) {
      const linked = runCli(['render', ...args], stream);
      assert.equal(linked.code, 0, linked.stderr);
      const source = JSON.parse(linked.stdout).sections[2].entries[0].source;
      assert.equal(source.commitUrl, `${url}/commit/${'2'.repeat(40)}`);
      assert.equal(source.prUrl, `${url}/pull/1`);
    }
  });

  test('render output is Markdown by default and with --format markdown; the last --format wins', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const byDefault = runCli(['render'], stream);
    const explicit = runCli(['render', '--format', 'markdown'], stream);
    assert.equal(explicit.code, 0, explicit.stderr);
    assert.ok(explicit.stdout.startsWith('## Unreleased\n'));
    assert.equal(explicit.stdout, byDefault.stdout);
    assert.equal(runCli(['render', '--format', 'json', '--format', 'markdown'], stream).stdout, byDefault.stdout);
    assert.equal(
      runCli(['render', '--format', 'markdown', '--format', 'json'], stream).stdout,
      runCli(['render', '--format', 'json'], stream).stdout,
    );
  });

  test('render rejects an invalid, wrong-case, padded or missing --format with nothing on stdout', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    for (const value of ['yaml', 'JSON', 'Json', ' json', 'json ', '', 'md']) {
      const { code, stdout, stderr } = runCli(['render', '--format', value], stream);
      assert.equal(code, 2, JSON.stringify(value));
      assert.equal(stdout, '');
      assert.ok(stderr.startsWith(`error: invalid --format ${JSON.stringify(value)}: expected markdown or json\n`), stderr);
    }
    const missing = runCli(['render', '--format'], stream);
    assert.equal(missing.code, 2);
    assert.equal(missing.stdout, '');
    assert.match(missing.stderr, /^error: --format needs a value/);
  });

  // Qodo local review finding 277d5eae: only the last --format value counts, like --repo-url.
  test('render: an invalid --format before a valid one is overridden; an invalid last one fails', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const overridden = runCli(['render', '--format', 'yaml', '--format', 'json'], stream);
    assert.equal(overridden.code, 0, overridden.stderr);
    assert.equal(overridden.stderr, '');
    assert.equal(overridden.stdout, runCli(['render', '--format', 'json'], stream).stdout);
    const toMarkdown = runCli(['render', '--format', 'JSON', '--format', 'markdown'], stream);
    assert.equal(toMarkdown.code, 0, toMarkdown.stderr);
    assert.equal(toMarkdown.stdout, runCli(['render'], stream).stdout);
    for (const args of [['--format', 'json', '--format', 'yaml'], ['--format', 'json', '--format']]) {
      const { code, stdout, stderr } = runCli(['render', ...args], stream);
      assert.equal(code, 2, args.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: /);
    }
  });

  test('render --format json with empty stdin exits 2', () => {
    const { code, stdout, stderr } = runCli(['render', '--format', 'json'], '');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /empty git log stream/);
  });

  test('usage documents --format', () => {
    assert.match(runCli(['--help']).stdout, /tracenotes render \[--repo-url <url> \| --origin\] \[--format markdown\|json\]/);
  });

  test('render with empty stdin exits 2', () => {
    const { code, stdout, stderr } = runCli(['render'], '');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /empty git log stream/);
    assert.match(stderr, /Usage:/);
  });

  // T-005 criterion 7
  test('version prints the recommendation as JSON and exits 0', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    const { code, stdout, stderr } = runCli(['version', '--current', '1.4.2'], stream);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.endsWith('}\n') && !stdout.endsWith('\n\n'));
    const r = JSON.parse(stdout);
    assert.equal(stdout, `${JSON.stringify(r, null, 2)}\n`);
    assert.equal(r.next, '2.0.0');
    assert.equal(r.rule.id, 'breaking');
    assert.equal(r.triggers[0].shortSha, '5555555');
  });

  test('version rejects bad arguments with nothing on stdout, before reading stdin', () => {
    const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
    for (const args of [[], ['--current'], ['--current', 'v1.2.3'], ['--current', '1.2.3 '], ['--current', '1.2.3', '--bogus']]) {
      const { code, stdout, stderr } = runCli(['version', ...args], stream);
      assert.equal(code, 2, args.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: /);
    }
    assert.match(runCli(['version', '--current', 'v1.2.3'], stream).stderr, /v1\.2\.3/);
  });

  test('version with empty stdin exits 2 with usage', () => {
    const { code, stdout, stderr } = runCli(['version', '--current', '1.0.0'], '');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /Usage:/);
  });

  test('usage lists the version command', () => {
    assert.match(runCli(['--help']).stdout, /tracenotes version --current <x\.y\.z>/);
  });

  test('--help exits 0 and prints usage', () => {
    const { code, stdout } = runCli(['--help']);
    assert.equal(code, 0);
    assert.match(stdout, /Usage:/);
  });

  test('piped stdin still parses (T-026 criterion 3)', () => {
    const { code, stdout } = runCli(['parse'], 'feat(x): piped\n');
    assert.equal(code, 0);
    assert.equal(JSON.parse(stdout).subject, 'piped');
  });
});

// tickets/T-008-config-ignore-patterns.md criterion 9
describe('cli --config', () => {
  const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
  const cfg = (name: string) => path.join('tests', 'fixtures', name);
  const commands: string[][] = [['group'], ['render'], ['version', '--current', '1.4.2']];

  test('group lists commits ignored by config with their pattern', () => {
    const { code, stdout, stderr } = runCli(['group', '--config', cfg('config-ignore-docs.json')], stream);
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    const result = JSON.parse(stdout);
    assert.deepEqual(result.ignored.map((e: { reason: string }) => e.reason), ['merge commit', 'ignore pattern: ^docs']);
    assert.equal(result.total, 5);
    assert.ok(!result.sections.some((s: { title: string }) => s.title === 'docs'));
  });

  test('render counts commits ignored by config in Markdown and JSON', () => {
    const md = runCli(['render', '--config', cfg('config-ignore-docs.json')], stream);
    assert.equal(md.code, 0, md.stderr);
    assert.ok(md.stdout.endsWith('_3 of 5 commits shown; 1 merge commits ignored; 1 ignored by config; 1 malformed records skipped._\n'), md.stdout);
    const json = runCli(['render', '--format', 'json', '--config', cfg('config-ignore-docs.json')], stream);
    assert.equal(json.code, 0, json.stderr);
    assert.deepEqual(JSON.parse(json.stdout).counts, { shown: 3, total: 5, ignored: 2, malformed: 1 });
  });

  test('version ignores matching commits but never a breaking one', () => {
    const { code, stdout, stderr } = runCli(['version', '--current', '1.4.2', '--config', cfg('config-ignore-fix.json')], stream);
    assert.equal(code, 0, stderr);
    const r = JSON.parse(stdout);
    // The fixture's breaking commit is `feat(parser)!`, which matches ^feat and must still count.
    assert.equal(r.next, '2.0.0');
    assert.equal(r.rule.id, 'breaking');
    assert.equal(r.counts.ignored, 3);
  });

  test('without --config the output is what it was', () => {
    for (const command of commands) {
      const bom = runCli([...command, '--config', cfg('config-bom.json')], stream);
      assert.equal(bom.code, 0, bom.stderr);
      // ' ^docs' (leading space kept) matches nothing, so the result equals a run without config.
      assert.equal(bom.stdout, runCli(command, stream).stdout, command.join(' '));
    }
  });

  test('a missing value, a missing file and invalid files exit 2 with one error line naming the path', () => {
    const bad: [string, RegExp][] = [
      ['does-not-exist.json', /^error: cannot read config "tests[\\/]+fixtures[\\/]+does-not-exist\.json": .*ENOENT/],
      ['config-not-json.json', /^error: config "[^"]+config-not-json\.json": invalid config: not valid JSON/],
      ['config-unknown-key.json', /^error: config "[^"]+config-unknown-key\.json": invalid config: unknown key "sections"/],
      ['config-bad-regex.json', /^error: config "[^"]+config-bad-regex\.json": invalid config: ignore\[1\] is not a valid regular expression/],
    ];
    for (const command of commands) {
      const missing = runCli([...command, '--config'], stream);
      assert.equal(missing.code, 2, command.join(' '));
      assert.equal(missing.stdout, '');
      assert.equal(missing.stderr, 'error: --config needs a value\n');
      for (const [name, pattern] of bad) {
        const { code, stdout, stderr } = runCli([...command, '--config', cfg(name)], stream);
        assert.equal(code, 2, `${command.join(' ')} ${name}`);
        assert.equal(stdout, '');
        assert.match(stderr, pattern);
        assert.equal(stderr.trimEnd().split('\n').length, 1, stderr);
      }
    }
  });

  test('a directory given as the config file is an error, not a crash', () => {
    const { code, stdout, stderr } = runCli(['render', '--config', path.join('tests', 'fixtures')], stream);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: cannot read config /);
  });

  test('when --config is repeated only the last file is read', () => {
    for (const command of commands) {
      const last = runCli([...command, '--config', 'does-not-exist.json', '--config', cfg('config-ignore-docs.json')], stream);
      assert.equal(last.code, 0, last.stderr);
      assert.equal(last.stdout, runCli([...command, '--config', cfg('config-ignore-docs.json')], stream).stdout);
      const bad = runCli([...command, '--config', cfg('config-ignore-docs.json'), '--config', cfg('config-not-json.json')], stream);
      assert.equal(bad.code, 2, command.join(' '));
      assert.equal(bad.stdout, '');
    }
  });

  test('group now rejects an unknown argument with usage', () => {
    for (const args of [['--bogus'], ['extra'], ['--config', cfg('config-ignore-docs.json'), '--repo-url', 'x']]) {
      const { code, stdout, stderr } = runCli(['group', ...args], stream);
      assert.equal(code, 2, args.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: unknown option /);
      assert.match(stderr, /Usage:/);
    }
  });

  // Qodo local review finding e7cc6b40: bytes that are not UTF-8 must not be replaced and accepted.
  test('a config file that is not valid UTF-8 is rejected, not repaired', () => {
    for (const command of commands) {
      const { code, stdout, stderr } = runCli([...command, '--config', cfg('config-invalid-utf8.json')], stream);
      assert.equal(code, 2, command.join(' '));
      assert.equal(stdout, '');
      assert.match(stderr, /^error: cannot read config "[^"]+config-invalid-utf8\.json": the file is not valid UTF-8\n$/);
    }
  });

  // Qodo local review finding 9f986931: the diagnostic stays one line whatever the path or file holds.
  test('a newline in the path or in the file cannot add lines to the error', () => {
    const forged = runCli(['render', '--config', 'nope\nerror: forged line'], stream);
    assert.equal(forged.code, 2);
    assert.equal(forged.stdout, '');
    assert.match(forged.stderr, /^error: cannot read config "nope\\nerror: forged line": /);
    assert.equal(forged.stderr.trimEnd().split('\n').length, 1, forged.stderr);
    const multiline = runCli(['render', '--config', cfg('config-not-json-multiline.json')], stream);
    assert.equal(multiline.code, 2);
    assert.match(multiline.stderr, /^error: config "[^"]+": invalid config: not valid JSON/);
    assert.equal(multiline.stderr.trimEnd().split('\n').length, 1, multiline.stderr);
  });

  test('usage documents --config on group, render and version', () => {
    const usage = runCli(['--help']).stdout;
    assert.match(usage, /tracenotes group \[--config <path>\]/);
    assert.match(usage, /tracenotes render \[--repo-url <url> \| --origin\] \[--format markdown\|json\] \[--config <path>\]/);
    assert.match(usage, /tracenotes version --current <x\.y\.z> \[--config <path>\]/);
    assert.match(usage, /No config file is read unless --config is given/);
  });
});

// T-026: terminal branch via injected io (no pseudo-terminal needed).
async function runMain(argv: string[], io: { stdinIsTTY: boolean; readStdin: () => Promise<string> }) {
  let out = '';
  let err = '';
  const code = await main(argv, {
    ...io,
    stdout: text => { out += text; },
    stderr: text => { err += text; },
  });
  return { code, out, err };
}

describe('cli with a terminal stdin', () => {
  const failRead = async (): Promise<string> => { throw new Error('stdin must not be read'); };

  test('render validates --repo-url before reading stdin', async () => {
    const { code, err } = await runMain(['render', '--repo-url', 'https://github.com:99999/o/r'], { stdinIsTTY: false, readStdin: failRead });
    assert.equal(code, 2);
    assert.match(err, /invalid repoUrl/);
  });

  test('render validates --format before reading stdin (T-007 criterion 9)', async () => {
    const { code, err, out } = await runMain(['render', '--format', 'yaml'], { stdinIsTTY: false, readStdin: failRead });
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /invalid --format "yaml"/);
  });

  test('render --format json on a terminal prints error and usage, does not read stdin', async () => {
    const { code, err, out } = await runMain(['render', '--format', 'json'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /Usage:/);
  });

  test('parse without argument prints error and usage, exits 2, does not read stdin', async () => {
    const { code, err } = await runMain(['parse'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.match(err, /^error: no commit message given and stdin is a terminal\n/);
    assert.match(err, /Usage:/);
  });

  test('log prints error and usage, exits 2, does not read stdin', async () => {
    const { code, err } = await runMain(['log'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.match(err, /^error: no git log stream on stdin \(stdin is a terminal\)\n/);
    assert.match(err, /Usage:/);
  });

  test('group prints error and usage, exits 2, does not read stdin', async () => {
    const { code, err } = await runMain(['group'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.match(err, /^error: no git log stream on stdin \(stdin is a terminal\)\n/);
    assert.match(err, /Usage:/);
  });

  test('render prints error and usage, exits 2, does not read stdin', async () => {
    const { code, err, out } = await runMain(['render'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^error: no git log stream on stdin \(stdin is a terminal\)\n/);
    assert.match(err, /Usage:/);
  });

  test('version prints error and usage on a terminal, does not read stdin', async () => {
    const { code, err, out } = await runMain(['version', '--current', '1.0.0'], { stdinIsTTY: true, readStdin: failRead });
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^error: no git log stream on stdin \(stdin is a terminal\)\n/);
    assert.match(err, /Usage:/);
  });

  test('version validates --current before reading stdin', async () => {
    const { code, err } = await runMain(['version', '--current', '01.2.3'], { stdinIsTTY: false, readStdin: failRead });
    assert.equal(code, 2);
    assert.match(err, /01\.2\.3/);
  });

  test('parse with an argument never consults stdin', async () => {
    for (const stdinIsTTY of [true, false]) {
      const { code, out } = await runMain(['parse', 'fix: arg'], { stdinIsTTY, readStdin: failRead });
      assert.equal(code, 0);
      assert.equal(JSON.parse(out).subject, 'arg');
    }
  });

  test('usage says stdin is read only when not a terminal', async () => {
    const { out } = await runMain(['--help'], { stdinIsTTY: true, readStdin: failRead });
    assert.match(out, /read stdin only when it is not a terminal/);
  });
});

// tickets/T-008-config-ignore-patterns.md criteria 9 and 10: the config is read through CliIo,
// after the other options and before stdin.
describe('cli --config with an injected reader', () => {
  const failRead = async (): Promise<string> => { throw new Error('stdin must not be read'); };
  const failFile = (): string => { throw new Error('the config file must not be read'); };
  const commands: string[][] = [['group'], ['render'], ['version', '--current', '1.0.0']];

  async function run(argv: string[], readFile: (path: string) => string, readStdin: () => Promise<string> = failRead) {
    let out = '';
    let err = '';
    const code = await main(argv, {
      stdinIsTTY: false,
      readStdin,
      readFile,
      stdout: text => { out += text; },
      stderr: text => { err += text; },
    });
    return { code, out, err };
  }

  test('an invalid config fails before stdin is read', async () => {
    for (const command of commands) {
      const { code, out, err } = await run([...command, '--config', 'c.json'], () => '{"ignore": [""]}');
      assert.equal(code, 2, command.join(' '));
      assert.equal(out, '');
      assert.equal(err, 'error: config "c.json": invalid config: ignore[0] is an empty pattern, which would match every commit\n');
    }
  });

  test('an unreadable config fails before stdin is read', async () => {
    const denied = (): string => { throw new Error('EACCES: permission denied'); };
    const { code, err } = await run(['render', '--config', 'c.json'], denied);
    assert.equal(code, 2);
    assert.equal(err, 'error: cannot read config "c.json": EACCES: permission denied\n');
  });

  // Qodo local review finding 9f986931, without a file system: reader and parser messages.
  test('control characters in a reader or parser message are escaped, one line out', async () => {
    const thrower = (): string => { throw new Error('first\nerror: second\r\u001b[31m\u2028x'); };
    const read = await run(['group', '--config', 'c.json'], thrower);
    assert.equal(read.code, 2);
    assert.equal(read.err, 'error: cannot read config "c.json": first\\u000aerror: second\\u000d\\u001b[31m\\u2028x\n');
    const regex = await run(['group', '--config', 'c.json'], () => '{"ignore": ["a\\nb("]}');
    assert.equal(regex.code, 2);
    assert.equal(regex.err.trimEnd().split('\n').length, 1, regex.err);
    assert.match(regex.err, /^error: config "c\.json": invalid config: ignore\[0\] is not a valid regular expression: "a\\nb\("/);
  });

  test('the config is not read when another option is invalid, or without --config', async () => {
    const badFormat = await run(['render', '--format', 'yaml', '--config', 'c.json'], failFile);
    assert.equal(badFormat.code, 2);
    assert.match(badFormat.err, /invalid --format/);
    const badVersion = await run(['version', '--current', 'v1', '--config', 'c.json'], failFile);
    assert.equal(badVersion.code, 2);
    assert.match(badVersion.err, /invalid version/);
    const stdin = async () => '1'.repeat(40) + '\u001fA\u001f2026-11-01T00:00:00Z\u001ffeat: a\u001e\n';
    const none = await run(['group'], failFile, stdin);
    assert.equal(none.code, 0, none.err);
  });

  test('only the last --config path is passed to the reader, exactly as given', async () => {
    const seen: string[] = [];
    const reader = (p: string): string => { seen.push(p); return '{"ignore": ["^feat"]}'; };
    const stdin = async () => '1'.repeat(40) + '\u001fA\u001f2026-11-01T00:00:00Z\u001ffeat: a\u001e\n';
    const { code, out } = await run(['group', '--config', 'first.json', '--config', ' second.json '], reader, stdin);
    assert.equal(code, 0);
    assert.deepEqual(seen, [' second.json ']);
    assert.equal(JSON.parse(out).ignored[0].reason, 'ignore pattern: ^feat');
  });
  // Qodo PR review finding fa44bb08: the path itself, beyond what JSON.stringify escapes.
  test('DEL, C1 controls and line separators in the path are escaped in both error lines', async () => {
    const path = 'a\u007fb\u0085c\u2028d\u2029e.json';
    const shown = '"a\\u007fb\\u0085c\\u2028d\\u2029e.json"';
    const denied = (): string => { throw new Error('EACCES: permission denied'); };
    const read = await run(['group', '--config', path], denied);
    assert.equal(read.code, 2);
    assert.equal(read.err, `error: cannot read config ${shown}: EACCES: permission denied\n`);
    const parsed = await run(['group', '--config', path], () => '[]');
    assert.equal(parsed.code, 2);
    assert.ok(parsed.err.startsWith(`error: config ${shown}: invalid config: `), parsed.err);
    assert.doesNotMatch(parsed.err, /[\u007f-\u009f\u2028\u2029]/);
  });
});

// T-010: --origin, with the origin reader injected (criteria 6 to 9).
describe('cli render --origin with an injected reader', () => {
  const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
  const url = 'https://github.com/UBayouski/tracenotes';
  const failRead = async (): Promise<string> => { throw new Error('stdin must not be read'); };
  const noOrigin = (): string => { throw new Error('git must not be run'); };

  async function run(argv: string[], readOrigin: () => string, readStdin = async () => stream) {
    let out = '';
    let err = '';
    const code = await main(argv, {
      stdinIsTTY: false,
      readStdin,
      readOrigin,
      stdout: text => { out += text; },
      stderr: text => { err += text; },
    });
    return { code, out, err };
  }

  test('renders exactly as --repo-url would, in Markdown and JSON (criterion 6)', async () => {
    const origin = () => 'git@github.com:UBayouski/tracenotes.git\n';
    for (const format of ['markdown', 'json']) {
      const viaOrigin = await run(['render', '--origin', '--format', format], origin);
      const viaUrl = await run(['render', '--repo-url', url, '--format', format], noOrigin);
      assert.equal(viaOrigin.code, 0, viaOrigin.err);
      assert.equal(viaOrigin.err, '');
      assert.equal(viaOrigin.out, viaUrl.out);
    }
  });

  test('credentials in the remote never reach stdout', async () => {
    const { code, out } = await run(['render', '--origin'], () => 'https://x-access-token:ghs_SECRET@github.com/UBayouski/tracenotes.git\n');
    assert.equal(code, 0);
    assert.ok(out.includes(`[#1](${url}/pull/1)`));
    assert.ok(!out.includes('SECRET'));
  });

  test('--origin with --repo-url is a usage error in either order, nothing read (criterion 7)', async () => {
    for (const argv of [['render', '--origin', '--repo-url', url], ['render', '--repo-url', url, '--origin']]) {
      const { code, out, err } = await run(argv, noOrigin, failRead);
      assert.equal(code, 2, argv.join(' '));
      assert.equal(out, '');
      assert.equal(err, 'error: --origin and --repo-url cannot be used together\n');
    }
  });

  test('a repeated --origin is allowed and reads the remote once', async () => {
    let calls = 0;
    const { code } = await run(['render', '--origin', '--origin'], () => { calls++; return `${url}.git\n`; });
    assert.equal(code, 0);
    assert.equal(calls, 1);
  });

  test('the remote is read after the options are checked and before stdin (criterion 6)', async () => {
    const order: string[] = [];
    const bad = await run(['render', '--origin', '--format', 'yaml'], () => { order.push('origin'); return url; }, failRead);
    assert.equal(bad.code, 2);
    assert.equal(order.length, 0);
    const ok = await run(['render', '--origin'], () => { order.push('origin'); return url; }, async () => { order.push('stdin'); return stream; });
    assert.equal(ok.code, 0, ok.err);
    assert.deepEqual(order, ['origin', 'stdin']);
  });

  test('a failed read exits 2 with one line and never echoes git output (criterion 8)', async () => {
    const failing = (): string => { throw new Error('fatal: no such remote origin https://u:SECRET@h/o/r'); };
    const { code, out, err } = await run(['render', '--origin'], failing, failRead);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err, 'error: cannot read the origin remote\n');
  });

  // Qodo PR review finding 56942752: one fixed message hid which failure happened. Only the
  // error's `code` (ENOENT) and numeric exit `status` are shown; neither holds the remote or git's output.
  test('git not found is reported as such (finding 56942752)', async () => {
    const missing = (): string => {
      throw Object.assign(new Error('spawnSync git ENOENT https://u:SECRET@h/o/r'), { code: 'ENOENT' });
    };
    const { code, out, err } = await run(['render', '--origin'], missing, failRead);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err, 'error: cannot read the origin remote: git not found\n');
  });

  test('a git exit status is shown, git output is not (finding 56942752)', async () => {
    const exited = (): string => {
      throw Object.assign(new Error('Command failed'), { status: 128, stderr: 'fatal: https://u:SECRET@h/o/r' });
    };
    const { code, out, err } = await run(['render', '--origin'], exited, failRead);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err, 'error: cannot read the origin remote: git exited with status 128 (not a git repository, no origin remote, or another git error)\n');
  });

  test('a status that is not an integer is never printed (finding 56942752)', async () => {
    const odd = (): string => { throw Object.assign(new Error('x'), { status: 'SECRET', code: 'SECRET' }); };
    const { code, err } = await run(['render', '--origin'], odd, failRead);
    assert.equal(code, 2);
    assert.equal(err, 'error: cannot read the origin remote\n');
  });

  test('a rejected remote exits 2 with one line and no part of the remote (criterion 8)', async () => {
    const { code, out, err } = await run(['render', '--origin'], () => 'https://u:SECRET@github.com/o/r/x.git\n', failRead);
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.equal(err.split('\n').length, 2, err);
    assert.match(err, /^error: origin remote: /);
    assert.ok(!err.includes('SECRET') && !err.includes('github.com'), err);
  });

  test('git is never run without --origin (criterion 8)', async () => {
    for (const argv of [['render'], ['render', '--repo-url', url], ['render', '--format', 'json'], ['group'], ['log']]) {
      const { code } = await run(argv, noOrigin);
      assert.equal(code, 0, argv.join(' '));
    }
  });
});

// T-010 criterion 9: the real reader, in throwaway repositories under the OS temp directory.
// No test runs git against this repository: GIT_CEILING_DIRECTORIES stops the search at the temp dir.
describe('cli render --origin as a child process', () => {
  const stream = readFileSync(path.join(repoRoot, 'tests', 'fixtures', 'log-basic.bin'), 'utf8');
  const base = mkdtempSync(path.join(os.tmpdir(), 'tracenotes-t010-'));
  // Environment for git and the CLI, built from `source` (the test process's own by default):
  // every inherited GIT_* variable is dropped (GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE,
  // GIT_CONFIG_* and the rest can redirect git to another repository), then the ceiling is set
  // and the caller's global and system git config are replaced by none (a url.<base>.insteadOf
  // rule there changes what `git remote get-url` prints, Qodo PR review finding cb45117f).
  const isolatedGitEnv = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => ({
    ...Object.fromEntries(Object.entries(source).filter(([name]) => !name.toUpperCase().startsWith('GIT_'))),
    GIT_CEILING_DIRECTORIES: base,
    GIT_CONFIG_GLOBAL: path.join(base, 'no-global-gitconfig'),
    GIT_CONFIG_NOSYSTEM: '1',
  });
  const env = isolatedGitEnv(process.env);
  const git = (cwd: string, ...args: string[]) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  const runIn = (cwd: string, args: string[], runEnv = env) => {
    const result = spawnSync(process.execPath, [cliPath, ...args], { cwd, env: runEnv, encoding: 'utf8', input: stream });
    return { code: result.status, stdout: result.stdout, stderr: result.stderr };
  };
  after(() => rmSync(base, { recursive: true, force: true }));

  // Qodo PR review finding 039c99ec (local a54388e5, wrongly dismissed): on Windows, Node looks up a
  // bare program name in the current directory before PATH unless NoDefaultCurrentDirectoryInExePath
  // is set. Claude Code's shell sets it, which hid the bug; a normal terminal does not, so the test
  // removes it. The fake git.exe is a copy of node that prints a forged remote.
  test('runs the git on PATH, not a git.exe in the current directory (Windows)', { skip: process.platform !== 'win32' }, () => {
    const repo = path.join(base, 'planted-git');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'remote', 'add', 'origin', 'https://github.com/UBayouski/tracenotes.git');
    copyFileSync(process.execPath, path.join(repo, 'git.exe'));
    writeFileSync(path.join(repo, 'remote'), 'console.log("https://github.com/evil/pwned.git");\n');
    const plain = Object.fromEntries(Object.entries(env).filter(([name]) => name.toLowerCase() !== 'nodefaultcurrentdirectoryinexepath'));
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin'], plain);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes('[#1](https://github.com/UBayouski/tracenotes/pull/1)'), stdout);
    assert.ok(!stdout.includes('evil'), stdout);
  });

  // Qodo PR review finding cb45117f: `git remote get-url` applies url.<base>.insteadOf from the
  // caller's global config, so a developer's rewrite rule would change what the tests read.
  test('ignores url.*.insteadOf in the caller\'s global git config', () => {
    const home = path.join(base, 'home-insteadof');
    mkdirSync(home);
    writeFileSync(path.join(home, '.gitconfig'), '[url "https://mirror.example.com/a/b/"]\n\tinsteadOf = git@github.com:\n');
    const hostile = isolatedGitEnv({ ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home });
    const repo = path.join(base, 'insteadof');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'remote', 'add', 'origin', 'git@github.com:UBayouski/tracenotes.git');
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin'], hostile);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes('[#1](https://github.com/UBayouski/tracenotes/pull/1)'), stdout);
  });

  // Qodo local review finding c72af242: under a git hook (or `git rebase -x`) GIT_DIR and friends
  // are set and would point git at the repository running the tests. A decoy repository stands
  // in for it here, so the reproduction never touches the real one.
  test('ignores GIT_DIR, GIT_WORK_TREE and GIT_CONFIG_* inherited from the caller', () => {
    const decoy = path.join(base, 'decoy');
    mkdirSync(decoy);
    git(decoy, 'init', '-q');
    git(decoy, 'remote', 'add', 'origin', 'https://github.com/decoy/wrong.git');
    const repo = path.join(base, 'hooked');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'remote', 'add', 'origin', 'git@github.com:UBayouski/tracenotes.git');
    const hostile = isolatedGitEnv({
      ...process.env,
      GIT_DIR: path.join(decoy, '.git'),
      GIT_WORK_TREE: decoy,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'remote.origin.url',
      GIT_CONFIG_VALUE_0: 'https://github.com/config/wrong.git',
    });
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin'], hostile);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes('[#1](https://github.com/UBayouski/tracenotes/pull/1)'), stdout);
    assert.ok(!stdout.includes('wrong'), stdout);
  });

  test('builds links from the origin of the current repository, without its credentials', () => {
    const repo = path.join(base, 'with-origin');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    git(repo, 'remote', 'add', 'origin', 'https://ci:SECRET@github.com/UBayouski/tracenotes.git');
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin']);
    assert.equal(code, 0, stderr);
    assert.ok(stdout.includes('[#1](https://github.com/UBayouski/tracenotes/pull/1)'));
    assert.ok(!stdout.includes('SECRET'));
  });

  test('a repository without an origin remote exits 2 with one error line', () => {
    const repo = path.join(base, 'no-origin');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin']);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: cannot read the origin remote: git exited with status \d+ \(.*\)\n$/);
  });

  // Qodo local review finding 062cc9f6: a remote.origin.url in the user's own git config would
  // give the throwaway repository an origin. A fake home directory stands in for the user's.
  test('ignores remote.origin.url in the caller\'s global git config', () => {
    const home = path.join(base, 'home');
    mkdirSync(home);
    writeFileSync(path.join(home, '.gitconfig'), '[remote "origin"]\n\turl = https://github.com/home/wrong.git\n');
    const hostile = isolatedGitEnv({ ...process.env, HOME: home, USERPROFILE: home, XDG_CONFIG_HOME: home });
    const repo = path.join(base, 'no-origin-home');
    mkdirSync(repo);
    git(repo, 'init', '-q');
    const { code, stdout, stderr } = runIn(repo, ['render', '--origin'], hostile);
    assert.equal(code, 2, stdout);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: cannot read the origin remote: git exited with status \d+ \(.*\)\n$/);
  });

  test('a directory that is not a repository exits 2 with one error line', () => {
    const dir = path.join(base, 'not-a-repo');
    mkdirSync(dir);
    const { code, stdout, stderr } = runIn(dir, ['render', '--origin']);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: cannot read the origin remote: git exited with status \d+ \(.*\)\n$/);
  });

  test('usage documents --origin', () => {
    assert.match(runIn(base, ['--help']).stdout, /tracenotes render \[--repo-url <url> \| --origin\] \[--format markdown\|json\] \[--config <path>\]/);
  });
});

describe('cli check (T-009)', () => {
  const rec = (digit: string, message: string) =>
    `${digit.repeat(40)}\u001fAda\u001f2026-11-18T10:00:00Z\u001f${message}\u001e\n`;
  const usage = /Usage:\n {2}tracenotes parse <message>/;

  test('every commit passes: exit 0, only the summary line (criteria 3, 5)', () => {
    const { code, stdout, stderr } = runCli(['check'], rec('1', 'feat: a\n') + rec('2', 'fix(cli): b\n'));
    assert.equal(code, 0, stderr);
    assert.equal(stderr, '');
    assert.equal(stdout, 'checked 2: 2 passed, 0 failed, 0 skipped, 0 malformed\n');
  });

  test('a failing commit is listed and exits 1 (criteria 3, 5)', () => {
    const { code, stdout } = runCli(['check'], rec('1', 'feat: a\n') + rec('2', 'Journl day 11 update\n\nbody\n'));
    assert.equal(code, 1);
    assert.equal(stdout, 'fail 2222222 "Journl day 11 update"\nchecked 2: 1 passed, 1 failed, 0 skipped, 0 malformed\n');
  });

  test('a malformed record alone exits 1 with its reason (criteria 3, 5)', () => {
    const { code, stdout } = runCli(['check'], 'ABCDEF\u001fMallory\u001f2026-11-04T12:00:00Z\u001fchore: bad sha\u001e\n');
    assert.equal(code, 1);
    assert.match(stdout, /^malformed .+\nchecked 1: 0 passed, 0 failed, 0 skipped, 1 malformed\n$/);
  });

  // Qodo PR review finding 15aa08e5 (the Day 12 deliberate gap): every skipped merge is listed.
  test('a stream of only merge commits exits 0 and lists every merge (criteria 3, 5)', () => {
    const { code, stdout } = runCli(['check'], rec('1', 'Merge pull request #1 from o/b\n') + rec('2', "Merge branch 'x'\n"));
    assert.equal(code, 0);
    assert.equal(stdout, 'skip 1111111 merge commit\nskip 2222222 merge commit\nchecked 2: 0 passed, 0 failed, 2 skipped, 0 malformed\n');
  });

  test('lines come in the order fail, malformed, skip, summary (criterion 3, finding 15aa08e5)', () => {
    const stream = rec('1', 'Merge pull request #1 from o/b\n') + 'ABCDEF\u001fM\u001f2026-11-04T12:00:00Z\u001fchore: x\u001e\n' + rec('2', 'bad header\n');
    const { code, stdout } = runCli(['check'], stream);
    assert.equal(code, 1);
    assert.deepEqual(stdout.split('\n').map(line => line.split(' ')[0]), ['fail', 'malformed', 'skip', 'checked', '']);
  });

  test('a control character in a header is printed escaped (criterion 4)', () => {
    const { code, stdout } = runCli(['check'], rec('1', 'bad\u001b[31m red\n'));
    assert.equal(code, 1);
    assert.ok(!stdout.includes('\u001b'), JSON.stringify(stdout));
    assert.ok(stdout.startsWith('fail 1111111 "bad\\u001b[31m red"\n'), stdout);
  });

  // Qodo local review finding 14905284 (and 96c793d3): JSON.stringify leaves DEL, C1 controls,
  // U+2028/U+2029 and format characters such as bidi overrides raw.
  test('no control, format or separator character reaches stdout raw (finding 14905284)', () => {
    const raw = ['\u007f', '\u0085', '\u009b', '\u2028', '\u2029', '\u202e', '\u2066', '\u200b', '\u00ad', '\ufeff'];
    const header = `bad ${raw.join('x')} end`;
    const badSha = `ABC\u202eDEF\u2028`;
    const { code, stdout } = runCli(['check'], rec('1', `${header}\n`) + `${badSha}\u001fM\u001f2026-11-04T12:00:00Z\u001fchore: x\u001e\n`);
    assert.equal(code, 1);
    for (const ch of raw) assert.ok(!stdout.includes(ch), `U+${ch.codePointAt(0)!.toString(16)} raw in ${JSON.stringify(stdout)}`);
    assert.equal(stdout.split('\n').length, 4, JSON.stringify(stdout));
    assert.ok(stdout.startsWith('fail 1111111 "bad \\u007fx\\u0085x\\u009bx\\u2028x\\u2029x\\u202ex\\u2066x\\u200bx\\u00adx\\ufeff end"\n'), stdout);
    assert.match(stdout, /\nmalformed invalid sha: "ABC\\u202eDEF\\u2028"\n/);
  });

  // Qodo local review finding 9858a1e5: a \u{...} escape is not JSON, so a character above
  // U+FFFF is written as its UTF-16 surrogate pair, which JSON.parse and JavaScript both read.
  test('a format character above U+FFFF keeps the header a valid JSON string (finding 9858a1e5)', () => {
    const header = `bad ${String.fromCodePoint(0xe0001)} tag`;
    const { code, stdout } = runCli(['check'], rec('1', `${header}\n`));
    assert.equal(code, 1);
    const quoted = stdout.split('\n')[0]!.slice('fail 1111111 '.length);
    assert.equal(JSON.parse(quoted), header);
    assert.ok(quoted.includes('\\udb40\\udc01'), quoted);
  });

  // Qodo PR review finding 9ef963f7: AGENTS.md rule 7 also names the characters displayed as
  // nothing (Default_Ignorable_Code_Point), U+2800, U+FFFD and every space but the ordinary one.
  test('characters displayed as nothing and odd spaces are printed escaped (finding 9ef963f7)', () => {
    const odd = ['\u034f', '\u3164', '\ufe0f', '\u2800', '\ufffd', '\u00a0', '\u3000'];
    const { code, stdout } = runCli(['check'], rec('1', `feat${odd.join('')}: x\n`));
    assert.equal(code, 1);
    for (const ch of odd) assert.ok(!stdout.includes(ch), `U+${ch.codePointAt(0)!.toString(16)} raw in ${JSON.stringify(stdout)}`);
    assert.ok(stdout.startsWith('fail 1111111 "feat\\u034f\\u3164\\ufe0f\\u2800\\ufffd\\u00a0\\u3000: x"\n'), stdout);
  });

  test('an empty stream exits 2 with the usage text (criterion 5)', () => {
    const { code, stdout, stderr } = runCli(['check'], ' \n');
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: empty git log stream on stdin\n\n/);
    assert.match(stderr, usage);
  });

  test('an argument after check exits 2 without reading stdin (criterion 5)', () => {
    const { code, stdout, stderr } = runCli(['check', '--fix'], rec('1', 'feat: a\n'));
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.match(stderr, /^error: unknown option "--fix"\n\n/);
  });

  // Qodo PR review finding 731e5dee: an argument with a newline could forge a second error line.
  test('an unknown option is printed escaped (finding 731e5dee)', () => {
    const { code, stderr } = runCli(['check', 'a\nerror: forged\u202e']);
    assert.equal(code, 2);
    assert.ok(stderr.startsWith('error: unknown option "a\\u000aerror: forged\\u202e"\n\n'), JSON.stringify(stderr));
  });

  test('a terminal stdin exits 2 without reading it (criterion 5)', async () => {
    let out = '';
    let err = '';
    const code = await main(['check'], {
      stdinIsTTY: true,
      readStdin: async () => { throw new Error('stdin must not be read'); },
      stdout: text => { out += text; },
      stderr: text => { err += text; },
    });
    assert.equal(code, 2);
    assert.equal(out, '');
    assert.match(err, /^error: no git log stream on stdin \(stdin is a terminal\)\n\n/);
  });

  test('usage documents check (criterion 7)', () => {
    assert.match(runCli(['--help']).stdout, /tracenotes check {2,}/);
  });
});

describe('cli usage errors escape what the user typed (T-031)', () => {
  // A newline would forge a second error line; U+0085 is a C1 control; U+202E reverses the text
  // after it on screen. Written as escapes here (AGENTS.md rule 7).
  const hostile = '--a\nerror: forged\u0085\u202e';
  const escaped = '--a\\u000aerror: forged\\u0085\\u202e';
  const raw = /[\n\u0085\u202e]/u;
  const usage = runCli(['--help']).stdout;

  /** The part of stderr before the usage text: the error line itself, with its newline. */
  function errorLine(stderr: string): string {
    const end = stderr.indexOf('\n');
    return stderr.slice(0, end + 1);
  }

  for (const command of ['group', 'render', 'version'] as const) {
    test(`${command}: an unknown option is printed escaped (criterion 1)`, () => {
      const { code, stdout, stderr } = runCli([command, hostile]);
      assert.equal(code, 2);
      assert.equal(stdout, '');
      assert.equal(stderr, `error: unknown option "${escaped}"\n\n${usage}`);
    });
  }

  test('an unknown command is printed escaped (criterion 2)', () => {
    const { code, stdout, stderr } = runCli([`x${hostile}`]);
    assert.equal(code, 2);
    assert.equal(stdout, '');
    assert.equal(stderr, `error: unknown command "x${escaped}"\n\n${usage}`);
  });

  // JSON.stringify already writes the newline as \n; the C1 control and U+202E it leaves raw.
  const cases: Array<[string, string[], string]> = [
    ['--format', ['render', '--format', hostile],
      'error: invalid --format "--a\\nerror: forged\\u0085\\u202e": expected markdown or json\n'],
    ['--repo-url', ['render', '--repo-url', hostile],
      'error: invalid repoUrl "--a\\nerror: forged\\u0085\\u202e": expected https://<host>/<owner>/<repo> ' +
      'with no trailing slash, .git suffix, query or fragment\n'],
    ['--current', ['version', '--current', hostile],
      'error: invalid version "--a\\nerror: forged\\u0085\\u202e": expected MAJOR.MINOR.PATCH ' +
      '(non-negative integers, no leading zeros, no prefix or suffix)\n'],
  ];
  for (const [option, args, expected] of cases) {
    test(`an invalid ${option} value is printed escaped (criterion 3)`, () => {
      const { code, stdout, stderr } = runCli(args, 'unused');
      assert.equal(code, 2);
      assert.equal(stdout, '');
      assert.equal(stderr, expected);
      assert.doesNotMatch(errorLine(stderr).slice(0, -1), raw);
    });
  }

  test('printable bad values give the same errors as before (criterion 4)', () => {
    assert.equal(runCli(['render', '--fix']).stderr, `error: unknown option "--fix"\n\n${usage}`);
    assert.equal(runCli(['nocmd']).stderr, `error: unknown command "nocmd"\n\n${usage}`);
    assert.equal(
      runCli(['render', '--format', 'xml'], 'unused').stderr,
      'error: invalid --format "xml": expected markdown or json\n',
    );
  });
});

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describePinProblem, unpinnedUses, workflowPinProblems } from '../scripts/action-pins.ts';

// tickets/T-034-pin-workflow-actions.md
// The check fails closed (human decision, Nov 19, after Qodo local review 2): every line where
// `uses` stands as a key, in any spelling, must be exactly a pinned step, or it is reported.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = 'fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09';

describe('unpinnedUses', () => {
  test('a SHA with an exact release passes, as a step or a bare key (criterion 1)', () => {
    const text = [
      'steps:',
      `  - uses: actions/checkout@${sha} # v5.1.0`,
      '  - name: setup',
      `    uses: actions/setup-node@${sha}  #  v5.0.0`,
      `    uses: owner/repo/sub/path@${sha} # v1.0.283`,
      `    uses: owner/repo@${sha} # 1.2.3`,
      `    uses: owner/repo@${sha} # v1.2.3-rc.1`,
      '  - run: echo pinned',
    ].join('\n');
    assert.deepEqual(unpinnedUses(text, 'ok.yml'), []);
  });

  test('a moving tag, a short SHA, an uppercase SHA or no ref fails (criterion 2)', () => {
    const text = [
      '  - uses: actions/checkout@v5',
      '  - uses: actions/checkout@fbc6f39 # v5.1.0',
      `  - uses: actions/checkout@${sha.toUpperCase()} # v5.1.0`,
      '  - uses: actions/checkout',
    ].join('\r\n');
    const problems = unpinnedUses(text, 'w.yml');
    assert.deepEqual(problems.map(p => [p.line, p.action]), [
      [1, 'actions/checkout@v5'],
      [2, 'actions/checkout@fbc6f39'],
      [3, `actions/checkout@${sha.toUpperCase()}`],
      [4, 'actions/checkout'],
    ]);
    for (const p of problems) assert.match(p.reason, /not pinned/);
  });

  // Qodo local review findings af5d2700 (any word passed) and a42b757b (real tags rejected).
  test('the comment must name an exact release tag (criterion 1)', () => {
    assert.match(unpinnedUses(`- uses: actions/checkout@${sha}`, 'w.yml')[0]!.reason, /release/);
    for (const comment of ['#', '# v5', '# main', '# TODO', '# v5.1', '# v5.1.0 extra']) {
      const problems = unpinnedUses(`- uses: actions/checkout@${sha} ${comment}`, 'w.yml');
      assert.equal(problems.length, 1, comment);
      assert.match(problems[0]!.reason, /release/, comment);
    }
  });

  test('local, docker and quoted values are reported as unsupported (criterion 2)', () => {
    const text = [
      '- uses: ./.github/actions/local',
      '- uses: docker://alpine:3.20',
      `- uses: "actions/checkout@${sha}" # v5.1.0`,
    ].join('\n');
    const problems = unpinnedUses(text, 'w.yml');
    assert.equal(problems.length, 3);
    for (const p of problems) assert.match(p.reason, /unsupported/);
  });

  // Qodo local review findings 64a7ab3d, cb8ef482 and ccd2f27a: other spellings of the key.
  test('every other spelling of the uses key is reported, not skipped (criterion 2)', () => {
    const text = [
      '  - { uses: actions/checkout@v5 }',
      '  - "uses": actions/checkout@v5',
      "    'uses' : actions/checkout@v5",
      '  - {name: x, uses: actions/checkout@v5}',
      '  - uses : actions/checkout@v5',
      '  - {name: "Fix #12", uses: actions/checkout@v5}',
      `  - { uses: actions/checkout@${sha} } # v5.1.0`,
    ].join('\n');
    const problems = unpinnedUses(text, 'w.yml');
    assert.deepEqual(problems.map(p => p.line), [1, 2, 3, 4, 5, 6, 7]);
    for (const p of problems) assert.match(p.reason, /unsupported/);
  });

  // Qodo local review finding 5fa32f55 (High): YAML reads an escaped quoted key as `uses`. Any
  // quoted key with a backslash escape is reported. GitHub's own `sha_pinning_required` setting
  // is the control; this test is the early warning (human decision, Nov 19).
  test('a quoted key with an escape is reported (finding 5fa32f55)', () => {
    const bs = '\\';
    const text = [
      `  - "${bs}u0075ses": actions/checkout@v5`,
      `  - { "u${bs}x73es": actions/checkout@v5 }`,
      `    "${bs}x75ses" : actions/checkout@v5`,
      `    "name${bs}t": x`,
    ].join('\n');
    const problems = unpinnedUses(text, 'w.yml');
    assert.deepEqual(problems.map(p => p.line), [1, 2, 3, 4]);
    for (const p of problems) assert.match(p.reason, /unsupported/);
  });

  // Qodo PR 34 review findings 2dab9c1b and 3a2670fe: a flow sequence and an explicit key.
  // Fix round on the PR, recorded exception to the 3-round limit (human, Nov 19): any line with
  // the word `uses` that is not exactly a pinned step is reported, and so is any explicit key.
  test('a flow sequence, an explicit key or a tagged key is reported (PR 34 findings)', () => {
    const text = [
      '  - [uses: actions/checkout@v5]',
      '  - ? uses',
      '    : actions/checkout@v5',
      '  - ? "u"',
      '  - !!str uses: actions/checkout@v5',
      '  # this step uses the cache',
    ].join('\n');
    assert.deepEqual(unpinnedUses(text, 'w.yml').map(p => p.line), [1, 2, 4, 5, 6]);
  });

  // Qodo PR 34 review finding 28bcc7c0 (High, rule 6): no trimming before the check. A hidden
  // space after the SHA or the tag is not ASCII whitespace and must fail, not be stripped.
  test('a non-ASCII space next to the SHA or the tag fails (finding 28bcc7c0)', () => {
    for (const code of [0x00a0, 0xfeff, 0x2007, 0x3000]) {
      const ch = String.fromCodePoint(code);
      for (const line of [
        `- uses: actions/checkout@${sha}${ch} # v5.1.0`,
        `- uses: actions/checkout@${sha} # v5.1.0${ch}`,
        `- uses:${ch}actions/checkout@${sha} # v5.1.0`,
        `${ch}- uses: actions/checkout@${sha} # v5.1.0`,
      ]) {
        assert.equal(unpinnedUses(line, 'w.yml').length, 1, `U+${code.toString(16)} in ${JSON.stringify(line)}`);
      }
    }
    // Tabs and spaces are ordinary YAML whitespace and still pass.
    assert.deepEqual(unpinnedUses(`\t- uses:\tactions/checkout@${sha}\t#\tv5.1.0\t`, 'w.yml'), []);
  });

  // Qodo local review finding da3acbde, kept on purpose: text that looks like the key is
  // reported too, because a silent miss is worse than a visible false alarm in this check.
  test('text that looks like a uses key is reported on purpose (fail closed)', () => {
    const problems = unpinnedUses('  - run: \'echo ", uses: not-an-action"\'\n  - run: echo uses: x', 'w.yml');
    assert.deepEqual(problems.map(p => p.line), [1, 2]);
  });

  test('the report line names the file, the line and the action (criterion 2)', () => {
    const [p] = unpinnedUses('jobs:\n  - uses: actions/checkout@v5\n', 'check.yml');
    assert.equal(
      describePinProblem(p!),
      'check.yml:2: "actions/checkout@v5": not pinned to a full commit SHA (40 lowercase hex characters)',
    );
  });
});

describe('this repository', () => {
  test('every uses: in .github/workflows is pinned to a commit with its release (criteria 1, 2)', () => {
    const problems = workflowPinProblems(path.join(repoRoot, '.github', 'workflows'));
    assert.deepEqual(problems.map(describePinProblem), []);
  });
});

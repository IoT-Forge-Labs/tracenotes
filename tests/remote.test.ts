import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { repoUrlFromRemote } from '../src/remote.ts';
import { checkRepoUrl } from '../src/render.ts';
import * as api from '../src/index.ts';

// T-010: pure conversion of an origin remote into a link base. No git, no network (rule 5).
describe('repoUrlFromRemote', () => {
  // Criterion 2: each accepted form, with and without .git, userinfo and port.
  const accepted: Array<[string, string]> = [
    ['https://github.com/UBayouski/tracenotes', 'https://github.com/UBayouski/tracenotes'],
    ['https://github.com/UBayouski/tracenotes.git', 'https://github.com/UBayouski/tracenotes'],
    ['https://git.example.com:8443/team/app.git', 'https://git.example.com:8443/team/app'],
    ['https://ci-user@github.com/o/r.git', 'https://github.com/o/r'],
    // Qodo local review finding f1cdda45: the same forms without .git.
    ['https://ci-user@github.com/o/r', 'https://github.com/o/r'],
    ['https://git.example.com:8443/team/app', 'https://git.example.com:8443/team/app'],
    ['git@github.com:o/r', 'https://github.com/o/r'],
    ['ssh://git@github.com/o/r.git', 'https://github.com/o/r'],
    ['ssh://github.com/o/r', 'https://github.com/o/r'],
    ['ssh://git@git.example.com:2222/team/app.git', 'https://git.example.com/team/app'],
    ['ssh://git@git.example.com:65535/team/app', 'https://git.example.com/team/app'],
    ['git@gh.io:o/r.git', 'https://gh.io/o/r'],
    ['git@github.com:o/r.git', 'https://github.com/o/r'],
    ['github.com:o/r', 'https://github.com/o/r'],
    ['git@github.com:My.Org/Repo_Name-2.git', 'https://github.com/My.Org/Repo_Name-2'],
  ];
  for (const [remote, expected] of accepted) {
    test(`accepts ${remote}`, () => {
      const url = repoUrlFromRemote(remote);
      assert.equal(url, expected);
      checkRepoUrl(url); // criterion 4: the result is always a valid link base
    });
  }

  // Criterion 3: the newline git prints is framing; exactly one is removed.
  test('removes one trailing \\n or \\r\\n and nothing else', () => {
    assert.equal(repoUrlFromRemote('git@github.com:o/r.git\n'), 'https://github.com/o/r');
    assert.equal(repoUrlFromRemote('https://github.com/o/r.git\r\n'), 'https://github.com/o/r');
    assert.throws(() => repoUrlFromRemote('https://github.com/o/r\n\n'), RangeError);
    assert.throws(() => repoUrlFromRemote('https://github.com/o/r\r\n\r\n'), RangeError);
  });

  test('keeps host, owner and repo as written', () => {
    assert.equal(repoUrlFromRemote('git@GitHub.com:UBayouski/TraceNotes.git'), 'https://GitHub.com/UBayouski/TraceNotes');
  });

  // Criterion 3: rejected shapes.
  const rejected = [
    '',
    '\n',
    ' https://github.com/o/r',
    'https://github.com/o/r ',
    'https://github.com/o /r',
    'https://github.com/o/r/',
    'https://github.com/o/r.git/',
    'https://github.com/o/r?x=1',
    'https://github.com/o/r#readme',
    'https://github.com/o',
    'https://gitlab.com/group/sub/r.git',
    'http://github.com/o/r.git',
    'git://github.com/o/r.git',
    'file:///srv/git/r.git',
    '/srv/git/r.git',
    'C:\\repos\\r',
    '../r',
    'git@github.com:/o/r.git',
    'git@github.com:o/r/x.git',
    'ssh://git@github.com:o/r.git',
    'https://github.com/o/r.git.git',
    'https://github.com/o/.git',
    'git@github.com:../r.git',
    'https://github.com/o/..',
    // Qodo local review finding b175921d: on Windows a one-letter "host" is a drive.
    'C:work/repo',
    'c:work/repo.git',
    'git@C:work/repo',
    // Qodo local review finding 12f291b1: the SSH port is dropped but still checked.
    'ssh://git@github.com:0/o/r.git',
    'ssh://git@github.com:99999/o/r.git',
  ];
  for (const remote of rejected) {
    test(`rejects ${JSON.stringify(remote)}`, () => {
      assert.throws(() => repoUrlFromRemote(remote), RangeError);
    });
  }

  // Criterion 4: a remote that converts to an invalid link base is rejected, not repaired.
  test('rejects a port checkRepoUrl rejects', () => {
    assert.throws(() => repoUrlFromRemote('https://github.com:0/o/r.git'), RangeError);
    assert.throws(() => repoUrlFromRemote('https://github.com:99999/o/r.git'), RangeError);
  });

  // Product decision: credentials never reach the output or an error message.
  test('drops user:token userinfo from the URL', () => {
    const url = repoUrlFromRemote('https://x-access-token:ghs_SECRET123@github.com/o/r.git\n');
    assert.equal(url, 'https://github.com/o/r');
    assert.ok(!url.includes('SECRET'));
  });

  test('a rejected remote never appears in the error message (criterion 5)', () => {
    const secretRemotes = [
      'https://user:ghp_SECRET456@github.com/o/r/extra.git',
      'http://user:ghp_SECRET456@github.com/o/r.git',
      'https://user:ghp_SECRET456@github.com:99999/o/r.git',
      'https://user:ghp_SECRET456@github.com/o/r?token=1',
    ];
    for (const remote of secretRemotes) {
      assert.throws(
        () => repoUrlFromRemote(remote),
        (error: unknown) => {
          assert.ok(error instanceof RangeError);
          assert.ok(!error.message.includes('SECRET'), error.message);
          assert.ok(!error.message.includes('github.com'), error.message);
          assert.match(error.message, /https:\/\/<host>/);
          return true;
        },
      );
    }
  });

  test('is exported from the package entry (criterion 1)', () => {
    assert.equal(api.repoUrlFromRemote, repoUrlFromRemote);
  });
});

# T-010: Repository URL from the origin remote

**Goal.** `tracenotes render --origin` builds commit and pull request links from the repository's
own `origin` remote, so a maintainer no longer has to type `--repo-url`. The links are the same
links `--repo-url` would give, and nothing secret in the remote ever reaches the output.

**Why.** T-004 made links possible but only with a URL typed by hand (T-004 "Out of scope": detecting
the URL is T-010). T-002 kept git outside the tool on purpose; this is the first time tracenotes
runs git itself, so the ticket also fixes how that access is tested (rule 5).

**Product decisions (human, Nov 16).**
- Opt-in only. Without `--origin` the output and the behavior are unchanged and git is never run.
  The same input on stdin gives the same notes in any directory.
- Offline. Only `git remote get-url origin` is run: local, no network, no GitHub API.
- Credentials in a remote (`https://user:token@host/...`, set by some CI systems) are dropped. They
  never appear in the notes, on stdout, or in any error message, whatever else goes wrong.

**Investigation.** Done Nov 16 with Codebase Wisdom (Qodo CLI 2.3.1, skill 1.1.7) on `main` at
`4d3062e` (index date Nov 13), cross-checked against the local tree at `38c8978`. Raw results:
`evidence/day11/wisdom-*.json`.

- *Does any code run git or reach a remote today?* No. `codebase grep`
  (`child_process|execFile|spawnSync|get-url|remote`) over `src/**`, `scripts/**` and `.github/**`
  finds nothing. T-002 ("Why this shape") deferred shelling out to git to T-010/T-011. This ticket
  therefore defines the access point: one reader in `src/cli.ts`, injectable through `CliIo`, with
  the parsing in a pure function.
- *How is a URL checked today?* `checkRepoUrl()` in `src/render.ts` accepts exactly
  `https://<host>[:port]/<owner>/<repo>` (port 1-65535, no `.git`, no trailing slash) and repairs
  nothing. `notesDocument()` calls it again. It is the single definition of a valid link base, so the
  converted remote must pass it (criterion 4) instead of getting a second regex.
- *What did review teach about URLs before?* PR 14 (T-004) had five Qodo findings, two of them on the
  URL: ports out of range, and a trailing newline (disputed correctly: `$` without `m`). The ticket
  had not named either case. Here the remote forms, the port and the newline git prints are named
  up front (criteria 2, 3).
- *How is the CLI tested?* `tests/cli.test.ts` runs the CLI as a child process (`runCli`) and calls
  `main()` with an injected `CliIo` (`runMain`). The convention (AGENTS.md) requires child-process
  cases for argument changes. Rule 5 forbids running git against the real repository, so those cases
  run in a throwaway repository under the OS temp directory (criterion 9).
- Not checked: past review history for this area (`pull-request similar` returned
  `MT-UPSTREAM-DOWN`; the PR 14 facts above come from `journal/day-06.md`).

**Acceptance criteria.**

1. `repoUrlFromRemote(remote: string): string` in `src/remote.ts`, exported from `src/index.ts`,
   with a doc comment (inputs, output, failure). It is pure: no git, no file system, no network.
2. Accepted remote forms, checked on the raw text before anything is removed (rule 6):
   - `https://[userinfo@]<host>[:port]/<owner>/<repo>[.git]`, where the port is kept;
   - `ssh://[user@]<host>[:port]/<owner>/<repo>[.git]`, where the port is checked (1-65535) and dropped (it is the SSH port, not the web one);
   - `[user@]<host>:<owner>/<repo>[.git]` (scp-like, e.g. `git@github.com:o/r.git`).
   Each gives `https://<host>[:port]/<owner>/<repo>`. Host, owner and repo are kept as written (no
   lower-casing).
3. Documented framing that may be removed: one trailing `\n` or `\r\n` (the newline git prints), a
   single `.git` suffix, and the userinfo before `@`. Nothing else is trimmed. Leading or inner
   whitespace, a query, a fragment, more or fewer than two path segments (nested groups),
   `http://`, `git://`, `file://`, a local path, or an empty string are rejected.
4. The result always passes `checkRepoUrl()`. A remote that converts to something `checkRepoUrl()`
   rejects (for example port 0 or 99999) is rejected, not repaired.
5. Rejection throws `RangeError`. The message names the accepted forms and **does not contain the
   remote or any part of it**, so a token in a rejected remote cannot leak.
6. CLI: `render --origin` reads the origin remote, converts it with `repoUrlFromRemote()`, and
   renders exactly as `render --repo-url <that url>` would, in Markdown and in JSON. This happens
   after the other options are checked and before stdin is read (same order as `--repo-url`).
7. `--origin` together with `--repo-url` (in either order) is a usage error: exit 2, nothing read.
   Repeating `--origin` is allowed.
8. A failed read (git not installed, not a repository, no `origin` remote) or a rejected remote exits
   2 with one `error:` line and no stdout. The line never contains the remote or git's own output.
   Git is never run without `--origin`.
9. Reader: `CliIo.readOrigin?: () => string`. The default runs `git remote get-url origin` with
   `execFileSync` (no shell) and returns its stdout as UTF-8; the repository is the one git
   resolves from the current directory and the environment (`GIT_DIR` and the like are honored,
   as by every git command; amended Nov 16 by the human after Qodo finding 897d1e0d). Unit tests
   use a fake. Child-process cases in `tests/cli.test.ts` cover success, no remote and not a
   repository, using a throwaway repository created under `os.tmpdir()` with
   `GIT_CEILING_DIRECTORIES` set. No test runs git against this repository.
10. Tests for `repoUrlFromRemote()`: each accepted form with and without `.git`, userinfo and port;
    every rejected shape in criterion 3; a remote with `user:token@` gives a URL without the token,
    and a rejected remote with a token gives an error message without it; `\r\n` and `\n` endings;
    a value with two trailing newlines is rejected.
11. `README.md` and the CLI usage text show `--origin`. `npm run check` passes.

**Out of scope.**
- Remotes other than `origin`, and choosing a remote by name.
- Nested groups (GitLab subgroups): `checkRepoUrl()` allows only `<owner>/<repo>` today.
- Detecting the host type (GitHub vs GitLab link paths); links stay `/commit/` and `/pull/` (T-004).
- `url.<base>.insteadOf` handling beyond what `git remote get-url` already applies.

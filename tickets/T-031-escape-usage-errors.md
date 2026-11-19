# T-031: Escape user-supplied values in every usage error

**Goal.** No value typed on the command line reaches stderr raw. Every usage error that repeats
an argument (an unknown option, an unknown command, an invalid `--format`, `--repo-url` or
`--current`) prints it through `oneLine()`, so it stays on one line, reads as it runs, and cannot
forge a second `error:` line. `check` already does this (PR 28, Qodo finding 731e5dee); the
other commands do not.

**Why.** Rule 7 (AGENTS.md) and `oneLine()` exist so that a message built from outside text
cannot hide or forge output. PR 28 fixed only `check` and moved the rest here (journal/day-12.md).
A wrapper script or an agent that passes a bad argument should get one honest error line, not one
the argument wrote.

**Investigation.** Done Nov 19 on `main` at `532219f`, by reading `src/cli.ts` and running the
CLI (`node src/cli.ts`) with an argument ending in `\nerror: forged` + U+202E (right-to-left
override), stdin from `/dev/null`.

- `group --x…`, `render --x…`, `version --x…` and the unknown command `nocmd…` print the value
  raw: the newline starts a second line `error: forged`, and U+202E is written as raw bytes
  (`src/cli.ts:247`, `303`, `422`, `468`). `check --x…` prints `\u000a…‮` (`src/cli.ts:375`).
- `render --format x…`, `render --repo-url x…` and `version --current x…` quote the value with
  `JSON.stringify`: the newline becomes `\n`, but U+202E is still written raw
  (`src/cli.ts:316`; the messages of `checkRepoUrl()` in `src/render.ts:35` and `parseVersion()`
  in `src/version.ts:54`, printed at `src/cli.ts:326` and `435`). The bump overflow message
  (`src/version.ts:67`, printed at `src/cli.ts:460`) quotes a version that already passed
  `parseVersion()`, so it holds only digits and dots.
- `parse` and `log` take no options. The config errors already go through `oneLine()`
  (`src/cli.ts:105`, `111`). The origin remote errors never contain the remote (T-010).
- What changed in the ticket: the BACKLOG row named only the unknown option; the run shows the
  unknown command and the three `JSON.stringify` messages leak too, so they are in scope.

**Acceptance criteria.**

1. The unknown-option error of `group`, `render` and `version` prints the option through
   `oneLine()`, as `check` does: `error: unknown option "<escaped>"`, then the usage text, exit 2,
   nothing on stdout.
2. The unknown-command error prints the command through `oneLine()`, same shape, exit 2.
3. The invalid `--format`, invalid `--repo-url` and invalid `--current` errors print the whole
   message through `oneLine()` at the CLI edge. The library messages (`checkRepoUrl()`,
   `parseVersion()`) and their exported behavior do not change.
4. Printable text is unchanged: an ordinary bad value (`--fix`, `nocmd`, `--format xml`) gives
   byte-for-byte the same error as before. Existing tests pass unchanged.
5. Child-process tests in `tests/cli.test.ts` (AGENTS.md CLI convention), one per message in
   criteria 1 to 3, with a value holding `\n`, a C1 control and U+202E: stderr is exactly one
   `error:` line (plus the usage text where it is printed), the three characters appear as
   `\u000a`, `\u0085`, `‮` (in the three quoted messages of criterion 3 the newline is
   JSON's own `\n`, already escaped before this ticket), and no raw copy of them is on stderr.
6. No other behavior changes: exit codes, the order of checks, and stdout stay as they are.
   `npm run check` passes.

**Out of scope.** Escaping inside the library error messages themselves; the parser `.trim()`
question (T-030).

# T-009: `check` command, lint commit messages against the convention

**Goal.** `tracenotes check` reads the same git log stream as `log`, `group` and `render`, and
says which commits in the range do not follow Conventional Commits, so a maintainer (or CI) can
catch a bad message before it lands in the release notes as "Unclassified".

**Why.** AGENTS.md (Code conventions) says commit messages follow Conventional Commits, because
the project parses its own history. Nothing checks it today. Of the 71 commits on `main`, 3
that are not merge commits break the convention: `d0b3721 Journl day 11 update`,
`05ab5f1 Updating on journal entries`, `e3684e4 PR commit to resolve issue`.

**Product decisions (human, Nov 18).**
- Any type is accepted: the only test is the Conventional Commits header grammar, as the parser
  already decides it (`conventional: true`). No list of allowed types.
- Merge commits are not violations. They are counted and listed as skipped, so nothing vanishes
  (same detection as grouping, T-003 criterion 4: the message starts with `Merge `).
- Exit codes: 0 when every commit passes; 1 when at least one commit fails or a record cannot be
  read; 2 for usage errors, an empty stream, or stdin that is a terminal.

**Investigation.** Done Nov 18 with Codebase Wisdom (Qodo CLI 2.3.3) on `main` at `d8199fe`
(index fetched Nov 18), cross-checked against the local tree at `d0b3721`. Raw results:
`evidence/day12/raw/`.

- *Does anything check commit messages today?* No. `codebase grep "conventional"` over `src/`,
  `scripts/` and `.github/` finds only the parser (`src/commit.ts`: `conventional` is set at
  line 144 from the header regex) and a type comment in `src/group.ts:21`. No script, workflow or
  command reads it to pass or fail anything (`01-grep-conventional.json`).
- *What does the parser already decide?* `parseCommit()` never throws; a header that does not
  match `type[(scope)][!]: description` gives `conventional: false`, and `subject` is then the
  whole header line (`src/commit.ts:24-47`). An empty scope `feat(): x` is already
  non-conventional (`src/commit.ts:50`). So `check` needs no grammar of its own.
- *How are merge commits recognized?* `groupCommits()` treats a message that starts with
  `Merge ` as a merge commit and puts it in `ignored` with `reason: 'merge commit'`
  (`src/group.ts:115`, T-003 criterion 4). The log stream has no parent SHAs, so the message is
  the only signal. `check` uses the same test.
- *What does the real history look like?* `codebase list-commits` on `main` (71 commits, from
  `d0b3721` back to `3e332b1`, the whole history): 21
  have a non-conventional header, 17 of them `Merge pull request ...`, 1 `Merge branch ...`, and 3
  ordinary messages (`03-list-commits-main.json`). A check that failed merges would fail on every
  range of this repository; this is why merges are skipped.
- *How do the other stream commands handle input?* `render` and `version` refuse a terminal
  stdin and an empty stream (only whitespace) with exit 2 and the usage text
  (`src/cli.ts:327-354`). `parseGitLog()` returns unreadable records in `malformed` with a reason
  (`src/gitlog.ts:32-44`).
- Not checked: past PRs on commit linting (`pull-request similar` returned `MT-UPSTREAM-DOWN`
  twice, `04-pr-similar-check.json`). No PR in this repository has added a checker; the
  journals name none.
- Changed in the ticket after the investigation: merges skipped (not failed), malformed records
  counted as failures.

**Acceptance criteria.**

1. `checkGitLog(result: GitLogResult): CheckResult` in a new `src/check.ts`, exported from
   `src/index.ts`, with a doc comment (inputs, output, failure). It is pure. For each commit, in
   stream order, it gives one of: `pass` (conventional header), `fail` (non-conventional header,
   with the reason `not a conventional commit header`), or `skip` (merge commit, reason
   `merge commit`). Malformed records are carried over with their reason.
2. Counts: `total` (commits plus malformed records), `passed`, `failed`, `skipped`, and the
   malformed records themselves (`malformed`, a list as in `GitLogResult`).
   `passed + failed + skipped + malformed.length === total`. Nothing in the stream is left out (rule 2).
3. CLI: `tracenotes check` reads the stream from stdin. Stdout has one line per failing commit:
   `fail <short sha> <header>`, then one line per malformed record: `malformed <reason>`, then
   one line per skipped merge commit: `skip <short sha> merge commit`, then a summary line:
   `checked <total>: <passed> passed, <failed> failed, <skipped> skipped, <malformed> malformed`.
   A passing commit prints no line of its own.
4. `<header>` is the first line of the parsed message (`ParsedCommit.raw`: line endings and
   trailing whitespace already normalized as rule 6 documents), written as a JSON string
   (`JSON.stringify`), so a control character or an invisible character in a message shows up
   as an escape instead of reaching the terminal raw.
5. Exit codes: 0 when `failed` and `malformed` are both 0 (skipped merges do not count against
   it); 1 otherwise. Exit 2, nothing on stdout, for a terminal stdin, an empty stream (only
   whitespace), or any argument after `check`, each with one `error:` line and the usage text on
   stderr, the same messages `render` uses.
6. Tests: `tests/check.test.ts` for `checkGitLog()` (all pass; a mix of pass, fail, skip and
   malformed in stream order; counts add up; `feat(): x` fails; a merge commit is skipped, not
   failed). Child-process cases in `tests/cli.test.ts` for exit 0, exit 1 with a failing commit,
   exit 1 with only a malformed record, a stream of only merge commits (exit 0, every merge
   listed), a header with a control character printed escaped, an empty stream (exit 2), and an
   extra argument (exit 2). Fixtures are in-repo; no test runs git (rule 5).
7. `README.md` and the CLI usage text document `check`. `npm run check` passes.

**Out of scope.**
- Checking the body or footers, header length, or the case of the description.
- A list of allowed types, and `--config` ignore patterns for `check`.
- Running git to choose the range (the user pipes `git log`, as for `render`; T-011).
- A CI workflow that runs `check` on pull requests.

**Verification.** `npm run check` passes. Manual, on this repository:
`git log --format='%H%x1f%an%x1f%aI%x1f%B%x1e' -20 | node src/cli.ts check` lists the
non-conventional commits in that range, skips the merges and exits 1.

# T-032: `release-notes-audit` skill, check rendered notes against the git range

**Goal.** A project skill that an agent runs after a change to parsing, grouping, rendering or
`check`, or before a release: for one git range it renders the notes the way a user would and
proves, from saved files, that every commit in the range is accounted for exactly once and every
entry links to its own commit. The check has been done by hand several times (T-010 links, the
T-009 run on the last 20 commits); Day 13 turns it into a procedure.

**Why.** Rules 1 (No Orphan Notes) and 2 (Nothing Vanishes) are tested with fixtures, but no
step compares real output with the real history. A review cannot show that either: it reads the
code, not the notes a range produces.

**Investigation.** Done Nov 18 on `main` at `3903f33`, by running the commands this ticket
describes on the range `d8199fe..3903f33` (6 commits) and reading the code.

- `git rev-list --count d8199fe..3903f33` gives 6. `group` prints `sections[].entries[]` and
  `ignored[]`, each with the full `sha`, plus `malformed` and `total` (6). Every commit lands in
  exactly one place: `groupCommits()` puts it in `ignored` (merge or ignore pattern), Breaking
  changes, a type section or Unclassified (`src/group.ts:111-127`), so "exactly once" can be
  checked on `group`'s output.
- `render --format json` lists only shown entries with `source.sha` and `source.commitUrl`
  (`${repoUrl}/commit/${sha}`, `src/render.ts:85-92`); ignored commits appear only in
  `counts` (`shown + ignored === total`, malformed separate). So links are checked on `render`,
  exactly-once on `group`.
- Markdown: one `- ` line per entry ending in `([<short>](<repoUrl>/commit/<sha>))`, and a footer
  `_<shown> of <total> commits shown; ..._`. `check` prints `fail`, `malformed`, `skip` lines and
  `checked <total>: ...`, and exits 1 when a header fails, which is not an audit failure.
- Redirecting a stream with `>` in Windows PowerShell 5.1 writes UTF-16 with a BOM; the stream and
  the outputs must be written from a POSIX shell (Git Bash on Windows).
- `tsconfig.json` and the source-hygiene walk cover `src/`, `tests/` and `scripts/` only; a
  script inside `.claude/skills/` would be neither type-checked nor hygiene-checked.

**Acceptance criteria.**

1. `.claude/skills/release-notes-audit/SKILL.md` in the Agent Skills format: YAML frontmatter
   with `name: release-notes-audit` (the directory name) and a `description` that says when to
   use it. The body names the required input (a git range), the project context, ordered steps
   with exact commands, the expected results, the evidence to save and where, and when to stop
   and ask (no range, a range git cannot resolve, an empty range, a mismatch, a shell that is not
   POSIX).
2. `.claude/skills/release-notes-audit/scripts/audit.ts` exports `auditNotes(input)`: pure, it
   takes the texts of `rev-list.txt`, `group.json`, `notes.json`, `notes.md`, `check.txt` and the
   expected repository URL (a stated input, never read from the notes under audit), and returns one result per check (`id`, `ok`, `detail`) and an
   overall verdict. Doc comment with inputs, output and failure.
3. Checks, each reported with what differed:
   - `exactly-once`: the SHAs in `group` (sections and ignored) equal the range's SHAs: none
     missing, none extra, none twice; no malformed record.
   - `counts`: `group.total`, `notes.json` `counts.total`, the Markdown footer and `check`'s
     `checked <n>` equal the range's size; `shown + ignored === total`; the footer's shown, merge
     and config counts match; `check`'s verdicts add up; `malformed` is 0 everywhere.
   - `json-links`: every entry's `commitUrl` is `<repoUrl>/commit/<its sha>`, its sha is in the
     range, and entry k is `group`'s entry k: same commit, section, subject, scope, PR number and breaking notes,
     with `prUrl` `<repoUrl>/pull/<n>` or null (amended after review: sets of SHAs let entries
     trade links or text).
   - `markdown-links`: one `- ` line per shown entry; line k sits under `group`'s section
     heading for entry k and, with its escapes removed, is exactly the line render writes for it:
     scope, subject, commit link and PR link, nothing else, followed by exactly its breaking notes
     as `  - ` lines.
   - `check-agrees`: `check`'s `skip` lines name exactly `group`'s merge commits, and its summary
     counts match the `fail`, `malformed` and `skip` lines it printed.
4. Input that cannot be read (a null section or entry, Markdown without its footer, a rev-list line that is not a 40-character lowercase SHA, JSON that
   does not parse, a missing `checked` line, an empty range, a repository URL `checkRepoUrl()`
   rejects) throws `RangeError`; nothing is guessed.
5. Entry: `node .claude/skills/release-notes-audit/scripts/audit.ts <dir> <repo-url>` reads the
   five files from `<dir>`, writes one `PASS <id>: ...` or `FAIL <id>: ...` line per check and a
   last line `audit: PASS` or `audit: FAIL (<k> of <n> checks failed)` to stdout; exit 0 on PASS,
   1 on FAIL, 2 with one `error:` line on stderr for bad input or usage. Only the entry block
   touches the process (AGENTS.md, scripts convention).
6. `tsconfig.json` and the source-hygiene walk include `.claude/skills`, so the script is
   type-checked and held to rule 7.
7. Tests in `tests/release-notes-audit.test.ts` build their inputs with the real CLI (`main()`
   with injected IO) from a synthetic stream: a clean audit passes; a commit missing from the
   range, an extra one, a broken Markdown link, a wrong JSON link, a malformed record and a
   `check` count that disagrees each fail the right check; each unreadable input throws; the entry
   gives exit 0, 1 and 2 as a child process on a temp directory. No test runs git (rule 5).

**Out of scope.** Running the audit in CI; auditing `version`; a range by tag (T-011).

**Verification.** `npm run check` passes. A fresh agent session invokes the skill on a real range
of this repository and saves the evidence it names (Day 13).

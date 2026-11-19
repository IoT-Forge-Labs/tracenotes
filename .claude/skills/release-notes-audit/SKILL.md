---
name: release-notes-audit
description: Audit the release notes tracenotes renders for one git range against the range itself - every commit accounted for exactly once, every entry linked to its own commit, all counts equal. Use after a change to parsing, grouping, rendering or the check command, before a release, or when asked to "audit the notes", "check the notes for <range>" or "prove nothing vanished". Needs a git range; saves the outputs and a PASS/FAIL report under evidence/.
---

# Release notes audit

Proves, from saved files, that the notes for a range are complete and sourced (AGENTS.md rules 1
and 2). It runs the CLI the way a user would, then `scripts/audit.ts` compares the outputs with
`git rev-list`. The audit **reports**; it never fixes code, edits outputs, or reruns until green.

## Inputs

- **Range (required), in one of exactly two forms:** `<from>..<to>` (commits after `<from>` up
  to `<to>`) or a single `<rev>` (its whole history). Each endpoint is one revision git can
  resolve to a commit: a SHA, a branch, a tag, `HEAD~20`. Other range syntax (`A...B`, `HEAD^!`,
  `^A B`, several revisions) is not accepted: ask the human to restate it in one of the two
  forms (Qodo local review finding 9e7b46de).
- **Output directory (optional).** Default `evidence/audits/<from-short>-<to-short>/`, or
  `evidence/audits/root-<rev-short>/` for a single rev. On a hackathon day, the human may name
  `evidence/dayNN/audit-<label>/` instead.
- **Repository URL (required, stated, never read from the notes).** The link base every entry
  must use, `https://<host>/<owner>/<repo>`. For this repository it is
  `https://github.com/UBayouski/tracenotes`; for another one, ask the human. Taking it from the
  notes under audit would only prove the notes agree with themselves (Qodo local review findings
  7af68d8b, 3cab7486).

**Safe values only.** Every value is pasted into a single-quoted Bash assignment, so a quote in
it would end the string and run whatever follows (PR 30 review, finding 91a3c1c4). Before step 1,
check each value character by character and use it only if it has nothing outside these sets:

| Value | Allowed characters |
|---|---|
| Range | letters, digits, `.` `_` `/` `~` `^` `-` (the `..` between endpoints is two dots) |
| Output directory | letters, digits, `.` `_` `/` `-`; a relative path inside the repository, no `..` segment |
| Repository URL | letters, digits, `.` `_` `/` `:` `-`, starting with `https://` |

No quotes, spaces, `$`, backticks, `;`, `&`, `|`, `<`, `>`, `(`, `)`, `*`, `?`, `\`, newlines or
non-ASCII characters. A value with any of them is not repaired or escaped: stop and ask the human
to restate it. After step 1 the range is pasted as full SHAs, which are always safe.

## Project context

- Work in the repository root (`dark_factory/`, where `package.json` is). The CLI is
  `node src/cli.ts`; no build step, no dependencies to install.
- The log stream format is fixed: `git log --format='%H%x1f%an%x1f%aI%x1f%B%x1e' <range>`.
- **Use Bash** (Git Bash on Windows, the Bash tool in Claude Code); the blocks need nothing
  beyond POSIX sh. Windows PowerShell 5.1 writes `>` redirects as UTF-16 with a byte order mark,
  which corrupts every file below.
- `check` exits 1 when a commit header is not conventional. That is the check's verdict on the
  history, **not** an audit failure; record it and go on.
- Never print the origin remote itself: it can hold credentials. `render --origin` drops them.

## Stop and ask the human when

- no range was given, it is ambiguous ("the last release" with no tag), or it is not one of the
  two forms above;
- a range, output directory or repository URL has a character outside its allowed set (see
  "Safe values only");
- git cannot resolve an endpoint (`git rev-parse --verify` fails) or the range is empty;
- the only shell available is PowerShell or cmd (no Bash);
- `render --origin` fails (no origin, unreadable remote): report it; do not fall back to
  `--repo-url`, which would make the link checks compare the stated URL with itself;
- the repository is not this one and the human has not stated its URL;
- the output directory exists and is not empty (never overwrite earlier evidence);
- the audit reports FAIL, or exits 2. Report what differed; do not change code, outputs or the
  range to make it pass.

## Steps

Run each block from the repository root and check its result before the next one. **Every block
starts by setting its own values** (`RANGE`, `OUT`, `REPO_URL`), written out literally: the
agent's shell does not keep variables from one call to the next (Claude Code's Bash tool starts
each call fresh; Qodo local review finding 285ab321). Decide the three values in step 1 and
paste the same literal values at the top of every later block.

1. **Resolve the range and record the code version.**
   ```bash
   RANGE='<from>..<to>'                                  # or a single rev
   for end in $(printf '%s\n' "$RANGE" | sed 's/\.\./ /'); do git rev-parse --verify --quiet "$end^{commit}" || echo "UNRESOLVED $end"; done
   echo "commits: $(git rev-list --count "$RANGE")"
   git rev-parse HEAD; git status --short -- src tests .claude
   ```
   Expected: no `UNRESOLVED` line and a count greater than 0. Stop otherwise. Each resolved
   endpoint prints its full SHA. **From step 3 on, `RANGE` is written with those full SHAs**
   (`<from-sha>..<to-sha>`, or `<rev-sha>`), not with the names given: a branch or tag that
   moves between steps would otherwise change the range under the audit (PR 30 review, finding
   dc9d9e47). Report the range both ways, as given and as pinned. Note whether `src/` has
   uncommitted changes: the audit then covers the working tree, not `HEAD`. Choose `OUT` now:
   `evidence/audits/<from-short>-<to-short>` (short SHAs from `git rev-parse --short`) unless the
   human named another directory.
2. **Create the output directory** (refuse a non-empty one).
   ```bash
   OUT='evidence/audits/<from-short>-<to-short>'
   if [ -n "$(ls -A "$OUT" 2>/dev/null)" ]; then echo "NOT EMPTY: $OUT"; else mkdir -p "$OUT" && echo "created $OUT"; fi
   ```
   Expected: `created ...`. On `NOT EMPTY`, stop.
3. **Save the range and the stream.**
   ```bash
   RANGE='<from-sha>..<to-sha>'; OUT='evidence/audits/<from-short>-<to-short>'   # the pinned range from step 1
   git rev-list "$RANGE" > "$OUT/rev-list.txt"
   git log --format='%H%x1f%an%x1f%aI%x1f%B%x1e' "$RANGE" > "$OUT/stream.bin"
   echo "rev-list lines: $(wc -l < "$OUT/rev-list.txt")"; ls "$OUT"
   ```
   Expected: the line count equals the count from step 1, and both files are in `$OUT`. List names
   only (`ls`, not `ls -l`): the long listing prints the local account name into the evidence.
4. **Render every output from the same stream.**
   ```bash
   OUT='evidence/audits/<from-short>-<to-short>'
   node src/cli.ts group                         < "$OUT/stream.bin" > "$OUT/group.json"; echo "group exit $?"
   node src/cli.ts render --origin --format json < "$OUT/stream.bin" > "$OUT/notes.json"; echo "render json exit $?"
   node src/cli.ts render --origin               < "$OUT/stream.bin" > "$OUT/notes.md";   echo "render md exit $?"
   node src/cli.ts check                         < "$OUT/stream.bin" > "$OUT/check.txt";  echo "check exit $?"
   ```
   Expected: `group` and both `render` runs exit 0; `check` exits 0 or 1 (1 lists failing
   headers). Any exit 2 means stop.
5. **Run the audit** against the stated repository URL.
   ```bash
   OUT='evidence/audits/<from-short>-<to-short>'; REPO_URL='https://github.com/UBayouski/tracenotes'
   node .claude/skills/release-notes-audit/scripts/audit.ts "$OUT" "$REPO_URL" > "$OUT/audit.txt"; echo "audit exit $?"; cat "$OUT/audit.txt"
   ```
   The exit status is read with `$?` straight after the command, not through a pipe
   (finding facfcef8). Expected: five `PASS` lines and `audit: PASS`, exit 0. A range of only
   merge commits needs no special handling: there are no entries to link, and the URL is still
   checked as input. On exit 2, `audit.txt` is empty and the error is on the screen: report it.
6. **Report** to the human, in this order: the range and the count from step 1; the code version (`HEAD`, dirty or
   not); each check line from `audit.txt`; the `check` verdict (its `fail` lines are history
   findings, listed, not audit failures); the files saved in `$OUT`. On FAIL, quote the failing
   lines and stop.

## What each check proves

| Check | Proves | Fails when |
|---|---|---|
| `exactly-once` | every commit of the range appears once in `group` (a section or ignored) and nothing else does | a commit is missing, extra or listed twice, or a record was malformed |
| `counts` | `group`, `notes.json`, the Markdown footer and `check` count the range's size; `shown + ignored = total`; the footer's shown, merge and config counts match; `check`'s verdicts add up | any count differs |
| `json-links` | JSON entry k is `group`'s entry k: same commit, section, subject, scope, PR number and breaking notes; `commitUrl` is `<repo>/commit/<its sha>` and `prUrl` is `<repo>/pull/<n>` or null | a link is wrong, an entry is not in the range, out of order, or shows another section, subject, scope or PR |
| `markdown-links` | Markdown entry line k, with its escapes removed, is exactly the line render writes for `group`'s entry k (scope, subject, commit link, PR link), under that entry's section heading, followed by exactly its breaking notes as `  - ` lines | a line has no link, two links, another commit's link, extra text, or the wrong heading, scope, subject or PR link |
| `check-agrees` | `check` skips exactly the merge commits `group` ignores, and its summary matches the lines it printed | a merge is not skipped, a non-merge is, or a summary count differs from its lines |

## Evidence saved

`$OUT/` holds `rev-list.txt`, `stream.bin`, `group.json`, `notes.json`, `notes.md`, `check.txt`
and `audit.txt`. Commit it with the change it verifies. It contains commit messages and author
names from the history, nothing else; check `stream.bin` before committing a private range.

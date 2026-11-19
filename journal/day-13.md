# Day 13 — Nov 18 — Teach your factory a new skill

Brief: https://github.com/orgs/qodo-hackathon/discussions/15. Turn one recurring check into a
skill (`SKILL.md`, Agent Skills format, name = directory, a description that says when to use
it; inputs, ordered steps, expected results, evidence, stop conditions), then run it in a fresh
agent session on one real task, inspect what the agent actually did, refine and retry. Code
changes still go through Qodo review. (The plan said "Close the review loop" for today; the
thread is canonical.)

PR: https://github.com/UBayouski/tracenotes/pull/30 (first commit `9ba1863`, by the agent at the human's request)

- Post: https://github.com/orgs/qodo-hackathon/discussions/15#discussioncomment-19724682

Status: local gate NOT MET after three fix rounds, continued as a recorded exception. PR 30
merged by the human as `7742d7f` on Nov 18 (recorded exception, below); issue #29 closed.

## The procedure

`release-notes-audit` (`.claude/skills/release-notes-audit/`): for one git range, render the notes
the way a user would and prove from saved files that every commit is accounted for exactly once
and every entry links to its own commit. Done by hand several times before (T-010 links, the
T-009 run on the last 20 commits). It is the product's version of the brief's CSV example:
generate the output from known data, compare it with the source.

- When: after a change to parsing, grouping, rendering or `check`, and before a release.
- Input: a git range. Output: `evidence/audits/<from>-<to>/` with the range, the stream, the four
  outputs and `audit.txt`.
- The comparison is `scripts/audit.ts` inside the skill (tested in
  `tests/release-notes-audit.test.ts`), five checks: `exactly-once`, `counts`, `json-links`,
  `markdown-links`, `check-agrees`.
- Stops: no range, unresolvable or empty range, non-POSIX shell (PowerShell 5.1 writes `>` as
  UTF-16), unreadable origin, a non-empty output directory, any FAIL.

Bonus, `pr-gate-check` (split out in round 3, now T-033): the gate at a PR head, written after the
PR 26 miss on Nov 18 (green checks reported as "ready" while Qodo had a new finding at the head).

## Built (in session)

- Ticket `tickets/T-032-release-notes-audit-skill.md`, issue #29 (no label), investigation by
  running the commands on `d8199fe..3903f33` and reading `src/group.ts` and `src/render.ts`:
  exactly-once can be checked on `group` (each commit lands in one place), links on `render`.
- `tsconfig.json` and the source-hygiene walk now include `.claude/skills`; rule 7's scope says so.
- Tests first (`evidence/day13/red-t032-1.txt`: the module did not exist), then the script: 328
  tests.
- Dry runs by the drafting session (scratchpad, not evidence): `d8199fe..3903f33`, 6 commits, PASS;
  the whole history at `3903f33`, 76 commits (57 shown, 19 merges), PASS. `pr-gate-check`'s
  commands on PR 28: they work, and showed that Qodo did review PR 28's docs head `2142d2a`
  (run 2045323), which the Day 12 report had not seen.

## Local review (before the first commit)

Run with `--ticket` issue #29 and the session context (`evidence/day13/t032-context-*.json`).

Round 1 (deep, full coverage; `t032-review-1-deep.json`): 11 findings, 10 valid ones fixed:

- The audit itself had holes. Two entries could trade sources in JSON (44bb76a4, High) or two
  Markdown lines trade links (7f66a5e3, High) and still pass, because the checks compared sets
  of SHAs; now entry and line k must be `group`'s entry k. `check`'s own verdicts were not added
  up (4f944bf8). Test-first (`red-t032-review1.txt`, 3 red).
- The expected link base came from the notes under audit (7af68d8b, 3cab7486): circular, and
  empty for a merge-only range. Now a stated input, named in the SKILL for this repository.
- `pr-gate-check`: a skipped head run could count as a review (3eb4255c, High); an
  endpoint-to-endpoint diff misses a reverted code change (48f845c0, High); a fork head that
  cannot be fetched made the diff fail silently (b07a1bd2, High); the report lacked type,
  category, decision and evidence (33748ce4).
- 2f938c17 (Medium): no real-range audit saved in the PR. Planned, but the human changed the
  plan: the fresh session runs on the PR branch before the merge, so its evidence and any
  refinements are reviewed in the same PR.
- d457935f (Low): two merges sharing a short SHA would fail `check-agrees`. Human: fix
  (`red-t032-d457935f.txt`); compared as multisets now. 332 tests.

Lesson in the making: the first version of the audit checked membership where the claim was
correspondence. A set of SHAs equal to the range says nothing about which subject links where.

Round 2 (deep, full; `t032-review-2-deep.json`): 10 of 11 resolved, 2f938c17 open as planned,
6 new, all valid and fixed:

- **285ab321, ed598c7a: the steps would not have run in a fresh session.** Both SKILLs set
  `$RANGE`, `$OUT`, `$HEAD` and `$R` in one block and used them in the next, but the agent's
  shell starts each call fresh. The fresh session would have written `/rev-list.txt` at the
  filesystem root. Every block now sets its own literal values; dry-run again block by block.
- facfcef8: `PIPESTATUS` is Bash-only; the audit's exit status is now read with `$?` before
  printing the file. f9d91704: `pr-gate-check` stops with "gate pending" on a failed `qodo` read.
- 624dd0de (High): `check`'s summary could move a count from skipped to passed; the line counts
  must now match. 4b2ac78e (High): a second commit link to another repository went unnoticed;
  every commit link on a line counts now. Test-first (`red-t032-review2.txt`, 2 red). 334 tests.

The drafting session's own dry runs had passed, because they ran in one shell call. The finding
that matters most for Day 13 came from review, not from the dry run: a procedure that works for
its author can still fail for the agent who follows it.

Round 3 (deep, full; `t032-review-3-deep.json`): 6 resolved, 4 new. Three valid Mediums were all
in `pr-gate-check` (a head that moves during the check, the decision column for a dismissed
finding, merge commits that list no files), its ninth finding in three rounds; one Low in
`audit.ts` (5638c83e, commit-link text inside a subject counted as a link). Human: **split
`pr-gate-check` out** to its own ticket (T-033; the draft and its open findings are kept outside
the repository until then), and fix the Low. The bonus skill was the one whose procedure had the
most corners; keeping it would have spent the last fix round on it.

Round 4 (final, deep, full; `t032-review-4-deep.json`): 4 resolved, 5 new. **Local gate: NOT MET**
after three fix rounds: 9e7b46de (High, step 1 rejected valid git expressions such as `HEAD^!`),
7dc5829e (Medium, subjects not compared), f9b538b4 (Medium, sections flattened), b987e197 (Low,
a helper comment), d08bcc76 (Low, the human's uncommitted Day 12 journal edit showed in the diff;
not staged, so it does not ship). Each round asked the audit to prove more: membership, then
positions, counts, links, and now the text and the section next to each link.

Human (FACTORY.md gate 3): **recorded exception**. The gate stays NOT MET here; the findings were
fixed test-first anyway (`red-t032-review4.txt`, 4 red): entry and line k now carry `group`'s
section, subject and scope; the range is one of two stated forms; the comment is right. 339 tests.
The whole history (76 commits) still audits PASS. The pull request review is the next check on
these fixes; the merge still needs the PR gate MET at its head. Ticket criteria 2 and 3 and
issue #29 describe the stricter checks.

## The fresh session (run 1)

The human started a new Claude Code session in `dark_factory/` on the PR branch at `4ad7bdd`
(none of this conversation in it), typed `/skills`, then `/release-notes-audit 3903f33`, and
exported the transcript (`evidence/day13/fresh-session-1.txt`; the local account name in two
`ls -l` lines is redacted to `<user> <group>`, nothing else changed).

What the agent did, checked against the SKILL:
- Loaded the skill: its first command is step 1, verbatim. (`/skills` opens a panel the export
  does not capture: "No changes".)
- Ran all six steps in order, **each block with its own literal `RANGE`, `OUT`, `REPO_URL`**: the
  round-2 fix (285ab321) at work; without it the run would have written to `/rev-list.txt`.
- Took the default output directory `evidence/audits/root-3903f33/`, correctly: the invocation
  named none (the drafting session's instructions to the human said "output to
  evidence/day13/audit-history" but left it out of the command line).
- Treated `check`'s exit 1 as a finding about the history, listed the 3 non-conventional
  headers, and warned that `stream.bin` holds author names before anything is committed.
- Result: `audit: PASS`, five checks. Checked independently: all six saved outputs are
  byte-identical to the drafting session's dry run of the same range, `git rev-list --count
  3903f33` is 76, and the audit re-run on the saved folder passes.

What it got wrong was the skill's, not the agent's: step 3's `ls -l` printed the local account
name into evidence meant for a public repository (AGENTS.md hard rule: no personal data).
Refined: step 3 lists names only, and says why.

## The retry (run 2)

After the refinement, the human asked the same session to run again with the output directory
named: `evidence/day13/audit-history/`. It was the session of run 1, not a new one (it remembered
run 1's `/export` going astray). It read the refined SKILL from disk and said so ("I followed that
version"). Result: `audit: PASS`; all seven saved files are byte-identical to run 1's. One slip: it
told the human the transcript was still at the stray path, from memory; the drafting session had
already moved it. It reported a state without looking.

## PR 30

Review of `4ad7bdd` (run 2045835, extended, `review_complete: false`: incomplete, so it cannot
carry the gate; `evidence/day13/pr30-review-1-extended.json`). Checks green. New, all valid:
e1492647 (Medium, Security: a token in the stated URL was quoted in the error), 633aace6
(Medium: text around the subject, or a wrong PR link, passed), be79ef1c (Medium: the Markdown
footer was not checked), dc9d9e47 (Medium: a branch moving between steps changes the range),
2a84cc4a and 9d61dab6 (Low: error-line escaping; null members threw TypeError). f9b538b4 shown
`implemented`. Human: fix all in one round, then one more review, then stop.

Fixed test-first (`red-pr30-round1.txt`, 6 red): the URL is never quoted; each Markdown line must
equal, escapes removed, the exact line render writes for `group`'s entry (scope, subject, commit
and PR link), and JSON entries carry the PR number and link; the footer counts are compared;
step 1 pins the range to full SHAs; the error line escapes like `oneLine()`; null members are
`RangeError`. 344 tests. The real history (76 commits, 57 lines) still audits PASS with the
exact-line check. The two runs' evidence is in this commit, which also answers 2f938c17.

Run 2's transcript (`evidence/day13/fresh-session-2.txt`, the whole session, so run 1 again; the
same two `ls -l` lines redacted) confirms the refinement: step 3 printed `rev-list.txt` and
`stream.bin` only. It also confirms the retry ran in run 1's session (the `/export` of run 1 sits
between the two invocations). The range was still given as `3903f33`, not pinned: the pinning
step (dc9d9e47) came after this run.

Review of `73f8a1e` (run 2045927, extended, `review_complete: false` again;
`evidence/day13/pr30-review-2-extended.json`): all eight earlier findings `implemented`,
2f938c17 included (the evidence answered it). One new High, 91a3c1c4: the SKILL had the agent
paste the caller's range and directory into single-quoted Bash assignments, so a quote in a value
would end the string and run what follows. Valid. **PR gate: NOT MET**, the agreed stop. Human:
fix it (SKILL text: a table of allowed characters per value; anything else stops and asks, never
escaped or repaired), push, and the human decides the merge as a recorded exception if the review
stays incomplete. Qodo has not produced a complete review on PR 30: both runs at extended depth
ended `review_complete: false`.

Review of `cc014f9` (run 2045987, extended, incomplete again): 91a3c1c4 `implemented`, all ten
earlier findings closed; one new High, 8f818660: breaking-change notes (JSON `breakingNotes`,
Markdown `  - ` lines) were not compared. Valid, and the last field render writes for an entry.
Human: fix it, then the human decides the merge. Fixed test-first (`red-pr30-8f818660.txt`): lost,
changed and invented notes fail. 345 tests. The audit now compares every field render prints for
an entry (section, scope, subject, commit link, PR link, breaking notes) and the footer.

Review of `37b35aa` (run 2046034, extended, incomplete again): 8f818660 `implemented`, all eleven
earlier findings closed; one new High, 234d5143: without `--config`, a non-merge commit in
`ignored` passed as "ignored by config", so a commit could be missing from consistent outputs.
Valid. Fixed test-first (`red-pr30-234d5143.txt`, reproduced with the real CLI and a fixture
config, so every output agreed about the missing commit). 346 tests.

**Merge decision (human, Nov 18): merge after this fix as a recorded exception**, without
waiting for another review round. Reasons on record: six PR review rounds, each finding one more
valid thing the audit could prove, none of them a regression; Qodo never completed a review of
PR 30 (five extended runs, all `review_complete: false`), so the gate's "completed review at the
head" could not be met by waiting; the required checks are green on every head. Findings Qodo
raises on this last head become a follow-up ticket, not more rounds here.

## Lesson

A skill is a procedure for someone who has never seen the conversation that wrote it. The
drafting session's dry runs passed because it ran every step in one shell; the procedure would
have failed in a fresh session (variables do not survive between calls), and only review caught
that before the real run. And the audit itself kept growing because its first claim was
membership ("every commit is there") while the real claim is correspondence ("every line is that
commit's line"): eleven rounds of findings were the distance between the two.

# Day 13 — Nov 18 — Teach your factory a new skill

Brief: https://github.com/orgs/qodo-hackathon/discussions/15. Turn one recurring check into a
skill (`SKILL.md`, Agent Skills format, name = directory, a description that says when to use
it; inputs, ordered steps, expected results, evidence, stop conditions), then run it in a fresh
agent session on one real task, inspect what the agent actually did, refine and retry. Code
changes still go through Qodo review. (The plan said "Close the review loop" for today; the
thread is canonical.)

PR: https://github.com/UBayouski/tracenotes/pull/30 (first commit `9ba1863`, by the agent at the human's request)

Status: local gate NOT MET after three fix rounds, continued as a recorded exception. PR 30 open;
the fresh session runs on its branch before the merge.

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

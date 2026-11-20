# Day 14 — Nov 19 — Turn your quality gate into a workflow

Brief: https://github.com/orgs/qodo-hackathon/discussions/16. Give the Day 9 quality gate a next
step in Qodo: one workflow that adds the "Qodo approved" label when a pull request meets the
conditions, one approval guard on a path that needs a person, and two useful pull requests (one
outside the guarded path, one inside), each with a prediction written before review, compared
with what happened. (The plan said "Give your factory a tool" for today; the thread is
canonical. T-013, the MCP server, moves to a free slot.)

PRs: https://github.com/UBayouski/tracenotes/pull/33 (outside) and
https://github.com/UBayouski/tracenotes/pull/34 (inside). Issues #31, #32.

- Post: https://github.com/orgs/qodo-hackathon/discussions/16#discussioncomment-19757736

Status: both predictions held. #34 merged by the human as `49e7cee`, then #33 as `0ed246a`
(merge order below); issues #31 and #32 closed. The Qodo trial showed "0 days left" all day.

## The gate, as a workflow

Saved gate: `AGENTS.md`, "Quality gate" (Day 9): every valid High and Medium finding of any type
fixed, Lows reported and left to the human, a disputed finding blocks, the last review covers
the head, the required checks pass.

Workflow, Qodo portal → Workflows, scope **Repository → UBayouski/tracenotes**:

- Name: `tracenotes gate: no Medium+ findings → Qodo approved label`
- When: Qodo finishes reviewing a PR (fixed).
- If: no findings of **Medium or higher** severity. No category or finding-type filter, so every
  category and every finding type counts.
- Then: **Add "Qodo approved" label**. Not auto-approve: approval and merge stay human.
- In plain words: "When Qodo finishes reviewing a PR, Qodo adds the 'Qodo approved' label if it
  matches: no findings of medium severity or higher."
- Created with Active off, read back, then activated (`evidence/day14/06`, `16`).

What the workflow cannot express of the saved gate, kept as separate requirements in
`FACTORY.md`: a disputed finding blocks; findings from local reviews; the required checks
(`check` on Linux and Windows, `ticket-link`); the acceptance criteria. Lows stay visible and
are the human's call; they do not block the label.

Two inactive workspace templates were already there ("Auto-approve low-risk PRs", "Label clean
PRs") and were left alone. "Label clean PRs" (no findings at all) is stricter than the gate: a
single Low would block it.

## The guard

Workspace-wide, Approval guards: none existed before (`evidence/day14/02`).
Added: `ubayouski/tracenotes`, **only `.github/workflows/**`**.

Why that path: the two agent workflows hold the Anthropic key and write tokens and commit on
`agent/*` branches; `check.yml` and `ticket-link.yml` are the required checks on `main`. A pull
request that edits them can weaken its own gate (Day 10, finding 282b3a84). No review result
should label such a change; a person reads it.

## What went wrong in the portal (caught by reading it back)

1. **The guard lost its path on save.** The path was typed, then added with its own Add button
   ("Only these paths", `03`). After Save guards and reopening, the guard read **"Whole
   repository"** (`08`): every tracenotes pull request would have been guarded and none could
   ever get the label. Re-added, saved, reloaded the page: the path held (`10`, `12`). Another
   participant hit the same loss today.
2. **The workflow was first created at Workspace scope.** The badge on the card follows the tab
   being viewed, so it read "This repository" on the repository tab. After a reload the
   Workspace tab listed it as Active (`11`). The Edit dialog has no scope field (`13`). The human
   had also created a repository-scoped copy; the workspace copy was deleted before any pull
   request was opened (`15`, `16`). Proof of scope used: the workflow is absent from another
   repository's view.

## T-031, outside the guard (PR 33)

Escape every user-supplied value in usage errors with `oneLine()` (unknown option in `group`,
`render`, `version`; unknown command; invalid `--format`, `--repo-url`, `--current`). The
Investigation ran the CLI with `--a\nerror: forged` + U+0085 + U+202E: four messages forged a
second `error:` line, three let the controls through raw. The BACKLOG row had named only the
unknown option.

- Test-first: 8 child-process tests, 7 red (`evidence/day14/t031/tests-red.txt`); 354 tests green.
- Local: one deep review, 0 findings, coverage complete. Gate MET in round 1.
- PR 33: agent commit `f942ab5` (third exception, after the gate report and the human's
  go-ahead), BACKLOG `d4bae4c`.
- **Prediction (in the PR body before review): label.**
- Qodo run 2061091 at `d4bae4c`: complete, 0 findings.
- **Observed: label "Qodo approved" added by `qodo-code-review[bot]` at 18:04:50Z**, about 80 s
  after the review started (`evidence/day14/pr33/issue-events.json`). The label's own
  description on GitHub: "A label only, not an approval vote."
- PR Triage: "Standard review · Reviewed on d4bae4c", findings 0 open, merge risk Low, next
  action "Needs review" (`pr33/pr-triage-expanded.png`). PR Triage has no entry for the workflow
  itself; the GitHub event is the evidence that it acted.
- Checks green; merge state clean.

The head `d4bae4c` changed only `BACKLOG.md` (Day 9 saw Qodo skip such commits); this time it was
reviewed completely.

## T-034, inside the guard (PR 34)

Pin every action in `.github/workflows/` to a commit SHA. The Investigation found `@v1` of
`anthropics/claude-code-action` pointing at `v1.0.283`, released at 01:17 UTC the same day, 14
releases since the bot's last run on Nov 10. The next labelled ticket would have run code no
run here had used, with the key.

Built test-first: `scripts/action-pins.ts` + `tests/action-pins.test.ts` (red with all 10 lines
first), 10 pins, AGENTS.md rule.

Local reviews (deep), with issue #32 as the ticket:

| Review | Found | Decision |
|---|---|---|
| 1 | 2 Low: a flow-mapping `uses:` passes unseen (64a7ab3d); any word passes as the release (af5d2700) | Human: fix both. Round 1. |
| 2 | both fixed; new 2 Medium: `uses :` passes (cb8ef482), my fallback flags `run:` text (da3acbde); 2 Low: `#` in a quoted name (ccd2f27a), tags without `v` rejected (a42b757b) | The regex-per-spelling loop again (Day 10). Human: **fail closed**: report every line where `uses` can be a key unless it is exactly a pinned step; da3acbde's false alarm accepted. Round 2. |
| 3 | all four resolved; new **High 5fa32f55**: `"\u0075ses":` is `uses` to YAML and invisible to text | Human approved turning on GitHub's **`sha_pinning_required`** (the agent ran it; first checked that the pinned `claude-code-action` pins its own nested `setup-bun`, so no lane breaks) plus an escaped-key rule, test-first. Round 3. |
| 4, 5 | nothing new; 5fa32f55 still listed with its unchanged description | Human: "fixed, reviewer stale" (gate point 7). Not recorded in Qodo (human: skip). |

PR 34: agent commit `8c87663`, BACKLOG `024a686`.

- **Prediction (in the PR body before review): no label and no qodo-bot approval, even if the
  review is clean.**
- Qodo run 2061636 at `024a686`: **1 High** (28bcc7c0, `.trim()` before validation, rule 6),
  **2 Medium** (2dab9c1b `[uses: …]`, 3a2670fe `? uses` explicit key). No label, but that proved
  nothing: the findings alone fail the workflow's condition.
- Human: one fix round on the pull request as a recorded exception to the three-round limit.
  Fixed test-first in `4099677`: any line with the word `uses`, an explicit key or an escaped
  quoted key must be exactly a pinned step, matched on the raw line with ASCII spaces and tabs
  only. 357 tests.
- Qodo run 2062101 at `4099677`: complete, 3/3 implemented, 0 new, **0 open**.
- **Observed: no label, no `labeled` event** on a clean, complete review of the head
  (`evidence/day14/pr34/issue-events-2.json`, `state-2.json`). The guard held.
- PR Triage: "Reviewed on 4099677", findings 0 open, merge risk Medium (blast radius: both agent
  lanes and the required checks), next action "Needs review". Its priority text was stale
  ("Ranked 30 minutes ago", still citing the fixed High). It also says "The change trips an
  approved review standard", the closest it comes to naming the guard.
- Checks green. Merged by the human as `49e7cee`; issue #32 closed.

**Merge order.** With `sha_pinning_required` on, the unpinned workflows on `main` and on #33's
branch no longer run, so #34 had to merge first. Then the agent pushed `e7720ea` to #33,
removing its own `T-034 planned` BACKLOG row, which would have conflicted with #34's `done` row.
`check` on `main` at `49e7cee` passed: the first run under required SHA pinning (run
44599481174).

**The label follows the head.** On that push Qodo removed "Qodo approved" from #33
(19:34:15Z), reviewed `e7720ea` completely, and added it again (19:34:36Z)
(`evidence/day14/pr33/issue-events-2.json`). A label on an older head does not survive a new
commit; the workflow judges each head again.

**A skipped review does not bring it back.** The journal and evidence commit `17765f9` went on
#33 last. Qodo removed the label on the push (19:44:28Z) and then skipped the review
(run 2062792, `review_complete: false`, docs only). No label came back, and the human merged #33
at 19:44:42Z without it. The quality gate was still MET at the merge: checks green at
`17765f9`, and the skip counts under gate point 8 (every commit since the last complete review,
`e7720ea`, changes only Markdown and `evidence/`). The label and the gate disagree here, which
is the point of keeping them apart. Next time the docs commit goes in before the last code
review, or on `main` after the merge.

## Diagram

`FACTORY.md`: the approval step now runs from every Qodo PR review into the workflow, then the
guard; outside the guard a clean head gets the label, inside it goes to the human. Gates 5a
(required checks) and 5b (the gate report) stay separate requirements; the label never replaces
them. New known gaps: the label is not the gate; the portal configuration is invisible to
review.

## Predicted versus observed

| PR | Prediction | Observed | Match |
|---|---|---|---|
| #33 outside | label after a clean complete review | label by `qodo-code-review[bot]`, 18:04:50Z | yes |
| #34 inside | no label even when clean | first review not clean (no evidence); after the fix: clean, no label | yes, after the confound was removed |

## What Qodo caught that I missed

- T-034 was a pin check written as line regexes over YAML. Five reviews found eight ways past
  it, one at a time. The right control was a platform setting the reviewer pushed me to find;
  the test became the early warning.
- 28bcc7c0: my own `.trim()` broke rule 6 (Validate Before You Normalize) in the file I wrote
  after reading that rule all week.
- A Bash heredoc mangled the escapes in the T-031 tests and wrote one raw U+202E into a `.ts`
  file (rule 7); the Edit and Write tools later decoded `\u0075` into `u` in two comments and in this journal. Both were found
  by reading the file back, not by a gate.

## Lesson

A configuration you cannot see in the repository has to be read back after every save. The
guard lost its path and the workflow landed in the wrong scope, and both screens looked right
at the moment of saving. And a missing label proves a guard only when the review was clean:
the first "no label" on #34 was the findings talking, not the guard.

## Follow-up (Nov 20): `scripts/` guarded too

The post left one question open: guard `scripts/` as well? Yes. The scripts are the logic
behind the checks (`pr-ticket-check.ts` for `ticket-link`, `ticket-ready.ts` for the label-lane
guard, `source-hygiene.ts`, `action-pins.ts`), and a pull request that weakens one should go to
a person the same way a workflow change does. The human added `scripts/**` to the
`ubayouski/tracenotes` guard, saved, reloaded and reopened it: both paths held, Save guards
greyed out (`evidence/day15/01-guard-scripts-after-reload.png`, sidebar cropped out). The
portal now reads "Trial ended", but the guard still saved. `tests/` stays unguarded on purpose
(see `FACTORY.md`, known gaps). `FACTORY.md` and `AGENTS.md` updated.

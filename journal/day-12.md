# Day 12 — Nov 17 (worked Nov 18) — Give your factory the full picture

Brief: https://github.com/orgs/qodo-hackathon/discussions/14. Pick one PR and its source ticket,
write down one concrete expectation and where it is in the source, give Qodo the source, check
the expectation in code and with a test, run Qodo on the PR head, and record what the review
caught, what it missed and what can be verified about its use of the source. A draft PR with a
documented, deliberate gap is allowed; it is never merged with the gap. (The plan said "Research
before writing" with T-011 for today; the thread is canonical.)

PR: https://github.com/UBayouski/tracenotes/pull/28 (draft, first commit `d52ba69`)

Status: PR 28 gate MET at `3bb2f6c` (run 2045283 complete, 5 of 5 findings implemented, 0 open;
checks green). First commit and PR made by the agent at the human's request, under the new third
exception. Merged by the human as `3903f33` on Nov 18; issue #27 closed.

- Post: https://github.com/orgs/qodo-hackathon/discussions/14#discussioncomment-19723485

## Rule change: the agent may make a first commit when asked

Open since Nov 13. On Nov 18 the human said "go for it" to the commit and the draft PR; the agent
pointed out that CLAUDE.md and AGENTS.md kept the first commit human, and the human chose to
change the rule. AGENTS.md (Process rules), CLAUDE.md and the FACTORY.md gate 4 row now have a
third exception: for one named task, asked in the conversation, the agent may make the first
commit, push and open the pull request, after giving the gate report and stating branch, files,
title and body. Merging, labels and triggers stay human. The rule change travels in this PR
(human, Nov 18). The round 3 review ran before these Markdown edits.

## Why T-009 and not T-011

T-011 (ranges by tag) needs tracenotes to run `git log` itself, a product decision T-002 left
open and the same ground T-010 took four review rounds to cover. T-009 (`check`) reads the same
stdin stream as `render` and needs no git (human, Nov 18).

## The source and the expectation

- Source: issue https://github.com/UBayouski/tracenotes/issues/27 (GitHub Issues, so no extra
  connection: the PR body names the issue). The issue body is the whole ticket,
  `tickets/T-009-check-command.md`.
- Product decisions (human, Nov 18): any commit type; merge commits skipped, counted and listed;
  exit 0 / 1 / 2.
- **Expectation:** criterion 3, "one line per skipped merge commit: `skip <short sha> merge
  commit`". Rule 2 (Nothing Vanishes) is already met by the skipped count, so only the ticket
  asks for the list. A review that flags its absence got it from the source.
- **Deliberate gap (human-approved):** the first commit leaves those lines out, and the merge-only
  CLI test asserts only the count. Stated in the PR body. Fixed before merge.

## Baseline

The PR 26 reviews (Day 11) never cited issue #25: citation types were only `pr_branch_file`,
`pr_knowledge` and `web_page`, and the ticket file was cited as a file of the branch
(`evidence/day11/pr26-review-*-extended.json`).

## Local review (before the first commit)

Investigation with Codebase Wisdom: `evidence/day12/raw/` (`pull-request similar` was down,
`MT-UPSTREAM-DOWN`, twice). Local reviews run with `--ticket <issue URL>` and the session context
(`evidence/day12/t009-context-*.json`), which named the gap as deliberate.

| Round | Depth | Result |
|---|---|---|
| 1 | deep | 3 new. fbd0ecfa (High, Correctness) "Check output drops skipped merge commits", **cites `ticket` https://github.com/UBayouski/tracenotes/issues/27**; 14905284 (Medium, Security) control, format and separator characters reach the terminal raw; 96c793d3 (Low) same for malformed reasons. Meta: ticket body inline, 6332 chars. |
| 2 | deep | First run failed (`MT-UPSTREAM-DOWN`, `remote_stream_incomplete`, `t009-review-2-deep-failed.json`); one retry completed. 14905284 and 96c793d3 gone; fbd0ecfa still open; 2 new Lows: 9858a1e5 (`\u{...}` is not a JSON escape), 2978cde6 (doc says "unchanged"). |
| 3 | deep | After the human chose to fix both Lows (`red-t009-9858a1e5.txt`; surrogate-pair escapes, doc comment). 0 new; 9858a1e5 and 2978cde6 `implemented`; only fbd0ecfa open. 312 tests. |

So, locally, Qodo used the issue: the finding that only the ticket can support cites it with
`source_type: ticket`, and it was raised although the context called the gap deliberate.

Fix round 1 (test-first, `evidence/day12/red-t009-14905284.txt`): `oneLine()` in `src/cli.ts`
now escapes every Unicode control, format, line and paragraph separator character, and `check`
applies it to the header and the malformed reason. 311 tests.

## What went wrong on the way

- Escapes written through the agent's tools came out wrong twice: a heredoc dropped one backslash
  of `\\u001b` (a test caught it), and an edit wrote ` `, `‮` and others as raw
  characters into `tests/cli.test.ts`. Rule 7's hygiene test failed with the file, line and
  escape to write, and a small script rewrote them. The rule did what it was written for.
- Two observations on existing parser code, not changed here: `parseCommit()` calls `.trim()` on
  the header line before matching (`src/commit.ts:128`), and trailing whitespace before U+2028 or
  U+2029 inside a header is removed by normalization.

## PR 28: the review with the source

The draft got no Qodo review (only a "trial ends soon" comment); after the human clicked "Ready
for review", run 2045210 (standard depth, complete) reviewed head `ef866b2`
(`evidence/day12/pr28-review-1-extended.json`). Checks green on that head.

| Finding | Level | Source used | Decision |
|---|---|---|---|
| 15aa08e5 Check output drops the merge-commit skip lines | High | **`ticket` https://github.com/UBayouski/tracenotes/issues/27**, plus the PR body: "The PR description says this is a known gap ... but the diff as submitted still violates the output contract." | The deliberate gap: caught. Fixed test-first. |
| 88effe66 `  feat: x` passes the check | High | code + `pr_knowledge` (PR 9, validate before normalizing) | Valid: `parseCommit()` trims the header. Human: fix in `check` only, parser to T-030. |
| 731e5dee unknown option printed raw | Medium | code | Valid; fixed in `check`, other commands to T-031. |
| 9ef963f7 U+034F and other rule-7 characters print raw | Medium | code + AGENTS.md | Valid; `oneLine()` now escapes rule 7's whole set. |
| f6bbf647 third exception does not make the agent wait | Medium | AGENTS.md + FACTORY.md | Valid; human chose to require the go-ahead after the gate report. |

What the source added: the one finding no code or rule could support (the skip lines) cites the
issue, the explanation restates the criterion (as Qodo's own "Criterion 4802871"), and the
PR body's "known gap" did not talk it out of the finding. What it did not show: which other
criteria were checked against the issue; a finding that is absent says nothing either way.
Compared with Day 11, where no PR 26 run cited issue #25 although the PR body said `Closes #25`,
the difference today is not visible in the setup (same GitHub Issues route, `Closes #N` in both):
one explanation is that issue #25's criteria were all met.

Fix round (test-first, `evidence/day12/red-pr28-round1.txt`, 5 red): skip lines in stream order
after the malformed lines, leading whitespace fails, the unknown option escaped, `oneLine()` on
rule 7's set (`Default_Ignorable_Code_Point`, U+2800, U+FFFD, every space but U+0020). 316 tests.

Review of `3bb2f6c` (run 2045283, standard, complete): all five `implemented`, no new finding
(`evidence/day12/pr28-review-2-extended.json`). `check` (Ubuntu, Windows) and `ticket-link` green.
Gate **MET**, merge state clean.

## Lesson

A review with the source connected can only show it used the source when the source says
something the code does not. Write the expectation down first, make it one that no code and no
rule can support, and then look for the citation: here the deliberate gap was the only finding
that cited the issue, which is the evidence; the four other findings would have come without it.

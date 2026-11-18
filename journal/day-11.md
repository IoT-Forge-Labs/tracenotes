# Day 11 — Nov 16 — Make the reviewer yours

Brief: https://github.com/orgs/qodo-hackathon/discussions/13. Take a real PR's Qodo review, say
where it fell short for this product, change the review setup, re-run Qodo on the same unchanged
PR code, and compare the findings (feedback vs display). Decide to keep, adjust or undo. (The plan
said "Give your agent the standards" for today; the thread is canonical.)

Status: PR 26 (T-010) gate MET at `272cc47`, checks green, waiting for the human to merge. The
review guidelines are kept, now in `.pr_agent.toml`; the wiki page is deleted after the merge.
Evidence: `evidence/day11/`, comparison in `evidence/day11/comparison.md`.

## The PR: T-010, `render --origin`

Ticket `tickets/T-010-repo-url-from-origin.md`, issue #25. `render --origin` builds links from
`git remote get-url origin`: opt-in, offline, credentials in the remote dropped and never printed.
It is the first time tracenotes starts a process. Human decisions: opt-in flag (not automatic),
drop credentials (not refuse), honor `GIT_DIR` like every git command (criterion 9 amended).

Codebase Wisdom (Qodo CLI 2.3.1): no git or child-process access anywhere on `main`
(`src/**`, `scripts/**`, `.github/**`); `pull-request similar` was down (`MT-UPSTREAM-DOWN`).

### Local review gate: NOT MET after three rounds, one exception

| Review (deep) | Findings | Outcome |
|---|---|---|
| 1 | c72af242 Medium (test env copies `GIT_DIR`), b175921d Low (`C:work/repo` drive path) | Medium fixed test-first with a decoy repository |
| 2 (full re-run, context changed) | 8d7c5f5e, 897d1e0d, a54388e5, 062cc9f6 Medium; 12f291b1 Low | rule 6 amended (human); 897d1e0d disputed, dismissed `intentional` (human); a54388e5 and 062cc9f6 dismissed `false_positive` after failed reproductions; both Lows fixed at the human's request |
| 3 | f1cdda45 Medium: three accepted remote shapes missing from the test table | 3 fix rounds used: NOT MET. Human granted one exception: rows added (test-only), no 4th local review; the PR review covers the final tree |

**a54388e5 was dismissed wrongly.** It said Windows runs a `git.exe` from the working folder. The
reproduction (a fake `git.exe` in the folder) ran inside Claude Code's shell, which sets
`NoDefaultCurrentDirectoryInExePath=1`; with that variable Windows skips the folder. A normal
terminal does not set it (user and machine environment checked). The same concern came back on
the PR and was then reproduced: the notes linked to `https://github.com/evil/pwned`.

## The experiment

| | Before | After |
|---|---|---|
| Setup | portal Workspace, preset Recall, **custom instructions empty**; repo `.pr_agent.toml` with bot keys only | plus repo wiki `.pr_agent.toml`: issue + compliance guidelines (product decisions), `enable_incremental_review = false`, `inline_comments_severity_threshold = 2`, `expand_evidence = true` |
| Run | 1993376, standard depth, automatic | 1993597, **extended** depth, `/agentic_review` |
| Head | `03d4a17` | `03d4a17` (unchanged) |
| Findings | 2 Medium: BACKLOG row; `insteadOf` in global config | the same 2, word for word, plus **039c99ec `git.exe` in the working folder (Windows)** |

- **Feedback changed, display did not.** The new finding is the most important on the PR and
  matches guidelines 1 and 5; its fix suggestion opens with "Use Node built-ins only, with no new
  dependency" (guideline 3). Neither display key had a visible effect: no inline comments in either
  run, and the summary comment has no evidence section at all.
- **Confounder:** Qodo chose a deeper effort for the re-run on its own. One pair of runs cannot
  separate depth from guidelines; the local deep review without guidelines found the same issue.
- Severity grouping showed all findings as Medium: `remediation_recommended` = Medium is now
  confirmed on a real PR comment (open since Day 9).
- Portal finding: "Requirement gap" is on with no spec source, so the reviewer never checks the
  ticket's criteria. Candidate next change, not made today (one change at a time).

Decision (human): **adjust**. Keep the two guideline texts, move them into `.pr_agent.toml`
(`272cc47`); drop the display keys and `enable_incremental_review = false`; delete the wiki page
after the merge.

## After the comparison: PR review gate on PR 26

- `21bc1b1` fixes all three findings test-first (`NoDefaultCurrentDirectoryInExePath` set before the
  spawn; test env replaces global and system git config; BACKLOG row `done (PR 26)`). 293 tests.
- Review of `272cc47` (run 1993750, extended): all three `implemented`; one new High, 69b1fa82
  (`$` matches before a final newline). False for JavaScript (`/a$/.test("a\n")` is false; the
  cited test passes on Windows and Linux); the same mix-up as PR 14. Dismissed `false_positive`
  by the human.
- `check` (Ubuntu, Windows) and `ticket-link` green at `272cc47`. Gate **MET**, merge state clean.
- Nov 18: the journal commit `e211fe7` was reviewed too (not skipped as docs-only), with one new
  informational finding, 56942752: every origin read failure printed the same fixed message, so
  git missing, a missing remote and other git errors (such as `safe.directory`) all looked
  alike. The agent first reported the PR as ready from green checks and the older gate note,
  without reading the review at head; the human caught it. The human chose to fix it. The fix is
  test-first (`evidence/day11/red-56942752.txt`, 7 red): the message now shows only the error's
  `code` (`git not found`) and its integer exit `status`, never git's output. 296 tests. Read at
  `e211fe7`: `evidence/day11/pr26-review-e211fe7-extended.json`.

## What went wrong on the way

- `gh pr comment --body "/agentic_review"` from Git Bash posted `C:/Program Files/Git/agentic_review`:
  MSYS path conversion. Use `MSYS_NO_PATHCONV=1` for slash-commands.
- The wiki page was first pasted with terminal indentation (`  ```toml`); fixed by a push to the
  wiki repo (`ef1ff4d`), read back byte-exact.
- GitHub's PR title was cut at the first commit's subject length and `Closes #25` was missing;
  `ticket-link` would have stayed red for the wrong reason.

## Lesson

A failed reproduction is evidence about the environment it ran in, not about the code. Before
dismissing a platform finding, check what the shell itself changes (`env`), and run the
reproduction the way a user would run the tool.

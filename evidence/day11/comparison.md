# Day 11: PR 26 review before and after the configuration change

Same pull request, same head commit both times: `03d4a17` (checked with `gh pr view 26 --json headRefOid`
before the re-run). No commit was pushed between the runs.

| | Before | After |
|---|---|---|
| Run | 1993376, automatic on PR open, 18:09 UTC | 1993597, `/agentic_review` comment, 18:23 UTC |
| Setup | portal Workspace defaults (preset Recall, custom instructions empty), repo `.pr_agent.toml` with bot keys only | plus wiki `.pr_agent.toml` (`wiki-pr_agent.toml.md`): issue and compliance guidelines, `enable_incremental_review = false`, `inline_comments_severity_threshold = 2`, `expand_evidence = true` |
| Effort chosen by Qodo (auto, capped at Deep) | standard | **extended** (deep) |
| Findings | 2, both Medium (`remediation_recommended`) | 3, all Medium |
| Raw data | `pr26-review-before-extended.json`, `pr26-summary-before.md` | `pr26-review-after-extended.json`, `pr26-summary-after.md` |

The summary comment is edited in place by Qodo; the "before" text is recovered from GitHub's edit
history (`pr26-summary-comment-edits.json`).

## Findings, one by one

| Finding | Before | After | Checked against the code |
|---|---|---|---|
| 69a37c33 BACKLOG row says "in progress" | yes | yes, unchanged | Correct; the `ticket-link` check already fails for the same reason. Bookkeeping, not product. |
| cb45117f global `url.*.insteadOf` can break the origin tests | yes | yes, unchanged | Plausible: `git remote get-url` applies `insteadOf`. To reproduce. |
| **039c99ec `git.exe` in the working folder runs on Windows** | **no** | **new** | **Reproduced.** With a fake `git.exe` in a repository folder, `render --origin` rendered `https://github.com/evil/pwned` instead of the real origin, once `NoDefaultCurrentDirectoryInExePath` was removed from the environment. |

## One concrete example: 039c99ec

`src/cli.ts:143` runs `execFileSync('git', ['remote', 'get-url', 'origin'], …)`. On Windows, Node's
spawner (libuv `search_path`) looks in the current directory before `PATH` unless
`NoDefaultCurrentDirectoryInExePath` is set. `tracenotes render --origin` is meant to be run inside
the repository the user is standing in, so a cloned repository with a `git.exe` at its root runs
that program.

The same concern came up in the local review (a54388e5) and was dismissed as a false positive
after a failed reproduction. That reproduction ran in Claude Code's shell, which sets
`NoDefaultCurrentDirectoryInExePath=1`; a normal Windows terminal does not (the user and machine
environment do not set it). The "after" review's evidence names exactly that variable. The
dismissal was wrong.

The after review also respected a product decision: its suggested fix starts "Use Node built-ins
only, with no new dependency" (guideline 3, zero runtime dependencies) and offers either setting
the variable before the spawn or resolving `git` through `PATH` by hand.

## Feedback or display?

**Feedback changed.** One new finding, and it is the most important one on the PR: it falls under
two of the guidelines (1: the only process is git, started on request; 5: process spawning that
behaves differently on Windows and Linux). The two old findings came back word for word.

**Display did not visibly change.**
- `inline_comments_severity_threshold = 2`: neither run posted inline comments on the code, so
  there was nothing to filter. The setting had no visible effect.
- `expand_evidence = true`: the summary comment has no evidence section in either version (every
  section is collapsed, `<details>` without `open`); the evidence is only in the Qodo API/portal.
  No visible effect.
- Severity: both runs grouped all findings as Medium ("View medium (n)"), which confirms the
  quality gate's mapping `remediation_recommended` = Medium on a real PR comment (open since Day 9).

## What else changed between the runs

- **Effort level: standard before, extended after.** Qodo picks the effort itself (Auto, capped at
  Deep). The new finding may come from the deeper run and not from the guidelines, or from both;
  one pair of runs cannot separate them. The local deep review (no guidelines) found the same
  concern, which points at depth as at least part of the cause.
- Trigger: automatic on open vs `/agentic_review` comment.
- Model output is not deterministic; the two repeated findings were reused, not re-derived
  (same IDs, same text).

## Still unhelpful, or lost

- Nothing useful disappeared: both earlier findings are still there.
- One of three findings is still bookkeeping that CI already enforces.
- No rule-violation finding in either run, so the compliance instruction (cite the rule number)
  was not exercised.
- The reviewer never sees the ticket: "Requirement gap" is on but has no spec source connected
  (portal, `setup-before/portal-workspace-finding-types.png`). Acceptance criteria are not checked.

# Day 16 — Nov 23 — Scan your repo with Arnica

Brief: https://github.com/orgs/qodo-hackathon/discussions/18. Connect one repository to Arnica
(code, dependencies, infrastructure configuration, secrets) in scan-only mode, confirm the
analysis finished, investigate one finding with the agent and decide (fix, investigate further,
or dismiss with a reason), and add the scan to the Day 10 diagram. A completed scan with no
findings is a valid result. A fix is optional. (The plan said "Wire up the factory" for today;
the thread is canonical. T-015 and T-029 move to a free slot.)

Status: in progress. Scan, investigation and fix done; pull request, follow-up scan and post open.

## Setup constraint

Arnica connects GitHub organizations only (its GitHub guide, and confirmed by Arnica in the
thread: a free organization works). `UBayouski/tracenotes` belongs to a personal account. Plan:
a free organization used only for this, holding a fork of the repository at the same commit;
only that fork is selected in Arnica. The fork runs no workflows and carries no secrets.

- Original: `UBayouski/tracenotes`, `main` at `b349b8b`.
- Fork: `IoT-Forge-Labs/tracenotes` (organization, free plan, public, `main` only), `main` at
  `b349b8b`. Same commit and same tree (`fbc2bdd`) as the original, read with `gh api` at
  17:59 UTC: `evidence/day16/01-fork-same-commit.txt`. The fork has 0 workflow runs and 0
  secrets; the organization had no GitHub app installed at that time.

## Predictions, written before the scan

Written on Nov 23 before the repository was connected, from the code at `b349b8b`.

| Arnica job | Prediction | Why |
|---|---|---|
| SCA / licenses | 0 findings | No runtime dependencies. Dev dependencies are `typescript` (Apache-2.0) and `@types/node` (MIT). |
| Secrets | 0 real secrets; a false alarm is possible | No tokens in the tree (rule 4). Test fixtures hold synthetic URLs with credentials for the `render --origin` tests, which a pattern scanner may flag. |
| IaC | 0 findings | No infrastructure files, unless Arnica counts workflows here. |
| SAST | 1 to 5 findings, the most likely one on `actions/checkout` | No workflow sets `persist-credentials: false`: five checkout steps in four files (`check.yml` has one step run on two systems). Another participant got this rule as a Medium. Less likely: `execFileSync` in `src/cli.ts`, and a `RegExp` built from the configuration file in `src/config.ts:30`. |

What would be worth a fix if it is reported: the checkout credential in `check.yml` and
`ticket-link.yml`, which never push. The two agent workflows push to `agent/*` branches, so the
same line there needs an investigation of what the action uses to push before anything changes.

## Scan

Arnica's GitHub app was installed on the organization at 18:22 UTC
(`evidence/day16/02-arnica-installation.txt`; access "all repositories", and the organization
holds only the fork). All four scans completed within three minutes; none failed, none was still
running (`evidence/day16/03-arnica-jobs.png` and `.txt`).

| Arnica job | Scope shown | Completed (UTC) | Result shown |
|---|---|---|---|
| SCA/License Scan | `tracenotes#main` | 18:24:53 | Done (0 findings) |
| IAC Scan | `tracenotes#main` | 18:25:26 | Done (0 findings) |
| Secrets Scan | `tracenotes#main` | 18:25:26 | Done (1 findings) |
| SAST Scan | `tracenotes#main` | 18:25:39 | Done (6 findings) |

The job cards name the branch, not a commit. The fork's `main` was at `b349b8b` before the
installation and after it, so that is the commit scanned.

Seven findings, all open (`evidence/day16/04-arnica-code-findings.csv`,
`05-arnica-secrets-finding.png`, cropped above the panel that shows the author's email):

| # | Arnica severity | Type | Where | Description |
|---|---|---|---|---|
| 1 | Medium | SAST | `.github/workflows/agent-ticket.yml#L50` | GitHub actions artipacked vulnerability |
| 2 | Medium | SAST | `.github/workflows/agent-fix.yml#L53` | same rule |
| 3 | Medium | SAST | `.github/workflows/check.yml#L40` | same rule |
| 4 | Medium | SAST | `.github/workflows/ticket-link.yml#L45` | same rule |
| 5 | Low | SAST | `src/config.ts#L30` | Detect non literal regexp |
| 6 | Low | SAST | `.claude/skills/release-notes-audit/scripts/audit.ts` (the `RegExp` built from the repository URL) | Detect non literal regexp |
| 7 | Info | Secret | `tests/remote.test.ts#L106` | Credentials in URL; validation "Invalid" (Arnica tried it: "The response code is 4XX") |

Arnica's links point at the commit that last touched each line, not at the scanned head.

## Finding investigated

Findings 1 to 4, one rule: `actions/checkout` without `persist-credentials: false` leaves the
job's token in the work tree's git configuration for every later step. The rule is named after
the case where a later step uploads the work tree as an artifact and the token leaves with it.

What the agent inspected (`evidence/day16/06-artipacked-investigation.txt`):

- No workflow uploads an artifact, a Pages bundle or a cache of the work tree. The leak the rule
  is named after cannot happen here.
- The run logs confirm the mechanism: `persist-credentials: true`, and
  `git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***` in
  `.git/config`, on Linux and on Windows.
- `check.yml` and `ticket-link.yml`: the token is read-only on a public repository
  (`Contents: read`). The steps after the checkout run the pull request's own code
  (`npm run check`), which can read the token, but the token reads nothing a visitor cannot.
  Neither job runs git after the checkout, so the stored credential has no use.
- `agent-ticket.yml` and `agent-fix.yml`: here the token can write (`Contents`, `Issues`,
  `PullRequests`). Between the checkout and the agent step it sits in `.git/config` while the
  guard script and `npm ci` run. On an issue label and on a pull request comment those come
  from `main`. On a review comment (`pull_request_review_comment`) the checkout is the pull
  request's merge commit, so `npm ci` installs what an `agent/*` branch asks for with the write
  token in reach: the one place where this finding is more than hygiene.
  The agent action then removes it itself ("Removing existing git authentication headers") and
  puts its own app token into the remote URL to push. So the checkout credential is not what
  the bot pushes with, and `persist-credentials: false` should not break the lane. That is
  read from the log of a Nov 10 run on the `v1` tag; it has not been run on the pinned version
  with the option set.
- What the scanner does not see: the action's own write token sits in the remote URL while the
  agent runs `npm run check`, that is, tests a ticket asked for. It is revoked when the job
  ends. Removing the checkout credential does not change that; it is the same family as the
  Day 10 finding that kept the Qodo key out of this job.

Severity as Arnica gives it: Medium for all four. The agent's reading: low for the two check
workflows (read-only token, public repository), real but narrow for the two agent workflows
(write token for a few steps; trusted code except on the review-comment path).

Decision (human, Nov 23): fix all four. Reason: one line per workflow, no job uses the stored
credential, and the two agent workflows hold a write token.

Decisions on the other three are still open; the agent's proposal is to dismiss all three in
Arnica with the reasons below, without a code change.

The other three, read but not the finding of the day:

- 5: `src/config.ts:30` compiles the user's own ignore patterns from `.tracenotes.json`. That
  is the feature (T-008). A slow pattern can only stall the run of the person who wrote it.
- 6: the audit script builds one expression from the repository URL after escaping every
  special character in it.
- 7: `https://user:ghp_SECRET456@github.com/o/r?token=1` is a made-up value in a test that
  proves a rejected remote never appears in an error message. Arnica marked it Invalid itself.
  Other made-up credential URLs in `tests/cli.test.ts` were not flagged.

## The fix: T-035

Ticket `tickets/T-035-checkout-credentials.md`, issue #35 (no label), local branch
`t-035-checkout-credentials`, built in the session.

- Test first: `scripts/checkout-credentials.ts` and `tests/checkout-credentials.test.ts`. The
  repository test was red on exactly Arnica's four lines (`evidence/day16/t035/tests-red.txt`):
  `agent-fix.yml:53`, `agent-ticket.yml:50`, `check.yml:40`, `ticket-link.yml:45`. The check
  fails closed, like the pin check.
- Fix: `persist-credentials: false` in the four checkout steps, five added lines, nothing else
  changed in the workflows. `AGENTS.md` process rule, `BACKLOG.md` rows T-035 and T-036.

Qodo local reviews of the uncommitted tree (CLI 2.4.0, deep, issue #35 as the ticket), all
under `evidence/day16/t035/`:

| Review | Result | What followed |
|---|---|---|
| 1 | Did not run: `AGENT-QUOTA-EXCEEDED`, credit balance exhausted. | Stop, reported to the human. The human restored credits. |
| 2 | 3 findings; coverage incomplete (two screenshots skipped). High ea881e83: a comment set the block's indentation, so text inside a multi-line value counted as the option. Medium 5dcf1618: a `uses` value with a YAML escape spells the action without its name. Medium a73703d7: the `BACKLOG.md` row says `planned`, so `ticket-link` is red. | Fix round 1, red first (`tests-red-review-2.txt`): every line of the `with:` block must be `key: plain value` at one indentation; a `uses` line with a quote or backslash is reported. a73703d7 left for the human. |
| 3 | First attempt failed upstream (stream closed), one retry. Coverage complete (screenshots excluded by path). ea881e83 and 5dcf1618 not listed again. New Medium 4397bda9: `Actions/Checkout` in another letter case is skipped. d6f052b6: the `BACKLOG.md` row again. | Fix round 2, red first (`tests-red-review-3.txt`): the mention is matched without regard to case. |
| 4 | Coverage complete. 4397bda9 `implemented`. New Medium 140b01cb: the script's entry block and exit status had no test. Low 14bdfd21: this journal section described the state before the reviews. d6f052b6 still open. | Fix round 3, the last one allowed: three child-process tests; this section rewritten. |
| 5 | Coverage complete, the final tree. Nothing new. 140b01cb and 14bdfd21 `implemented`. d6f052b6 still open. | Stop: three fix rounds used, one Medium open and disputed. |

Disputed, waiting for the human: d6f052b6 (a73703d7 in review 2), Medium. The finding is right
that `ticket-link` is red on the first commit. That is how the check was designed on Day 10:
the pull request number does not exist before the pull request, so the row is set to
`done (PR n)` in the second commit, as on pull requests 24, 33 and 34.

Gate report, uncommitted tree, after review 5 (run `4ee88574`, deep, full, coverage complete):

| Finding | Category | `action_level` / severity | Status | Decision |
|---|---|---|---|---|
| ea881e83 | Security | `action_required` / High | fixed in round 1; not listed since review 3 | valid, fixed test-first |
| 5dcf1618 | Correctness | `remediation_recommended` / Medium | fixed in round 1; not listed since review 3 | valid, fixed test-first |
| 4397bda9 | Security | `remediation_recommended` / Medium | `implemented` (review 4) | valid, fixed test-first |
| 140b01cb | Testability | `remediation_recommended` / Medium | `implemented` (review 5) | valid, tests added |
| 14bdfd21 | Maintainability | `informational` / Low | `implemented` (review 5) | journal rewritten |
| d6f052b6 (a73703d7) | Correctness | `remediation_recommended` / Medium | open | disputed by the agent: by design, set on the pull request; the human decides |

`npm run check`: 384 pass, 0 fail. Fix rounds: 3 of 3. Deep reviews completed: 4, the last one
on the final tree. This section's row 5 and this report were written after review 5, in
Markdown only.

**Quality gate: NOT MET.** One Medium is open and disputed; a disputed finding blocks until the
human decides.

Unresolved verification, stated before the pull request exists:

- The two check workflows are verified by their own runs on the pull request.
- The two agent workflows are not run by this ticket. Unverified until a labelled ticket and
  an `@claude` comment have each run with the pinned action and pushed successfully. Qodo's
  reviewer asked for the same in reviews 2, 3 and 4.
- The check reads `.github/workflows/` only. A checkout step in a composite action under
  `.github/actions/` would not be seen; there is none today.
- Arnica: after the merge the fork is synced and the findings are read again.

## Predictions against the result

| Job | Predicted | Observed |
|---|---|---|
| SCA / licenses | 0 | 0 |
| IaC | 0 | 0 |
| Secrets | 0 real, a false alarm possible on test fixtures | 1, a test fixture, marked Invalid by Arnica. Right kind, wrong file: I named `tests/cli.test.ts`, it was `tests/remote.test.ts`. |
| SAST | 1 to 5, most likely the checkout credential | 6: the checkout credential in all four workflows, the `RegExp` in `src/config.ts:30` as predicted, and one I did not list, the `RegExp` in the audit script. `execFileSync` was not flagged. |

## Where this fits

`FACTORY.md`: after `main`, a security scan step drawn as taken (the human syncs the
organization fork, Arnica scans it), then the human reads the findings and decides, and a fix
goes back to the top as a new ticket. Arnica checks on the pull request are dashed: they need
the repository itself in an organization. A gate-table row, a "Checked against the Arnica scan
and T-035" section and two new known gaps: the scan sees a copy, after the merge, when a person
syncs it; and the agent action's own write token is in reach of ticket-written tests (T-036).

Status line at the top of this file: the scan, the investigation and the fix are done; the
pull request, the follow-up Arnica read and the post are not.

## What I missed

_TODO_

## Lesson

_TODO_

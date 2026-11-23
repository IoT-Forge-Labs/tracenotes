# T-035: Do not keep the job token in the work tree after checkout

**Goal.** Every `actions/checkout` step in `.github/workflows/` sets `persist-credentials: false`,
so the job's token is not left in `.git/config` for the steps that follow.

**Why.** Day 16: Arnica scanned `main` at `b349b8b` (in the organization fork
`IoT-Forge-Labs/tracenotes`) and reported four Medium findings, one per workflow, rule
"GitHub actions artipacked vulnerability": `agent-ticket.yml#L50`, `agent-fix.yml#L53`,
`check.yml#L40`, `ticket-link.yml#L45`. The human decided to fix all four (Nov 23). This pull
request is inside the approval guard on `.github/workflows/**` and `scripts/**`.

**Investigation.** Done Nov 23 on `main` at `b349b8b`, by reading the four workflows and the logs
of run 45228686728 (`check`, `b349b8b`) and run 42870198062 (`agent-ticket`, issue 15, Nov 10).
Excerpts: `evidence/day16/06-artipacked-investigation.txt`.

- Four checkout steps, one per workflow, all `actions/checkout` v5.1.0 by SHA. None sets
  `persist-credentials`; the logs show the default, `persist-credentials: true`, and
  `git config --local http.https://github.com/.extraheader AUTHORIZATION: basic ***`.
- No workflow uploads an artifact, a Pages bundle or a cache of the work tree, so the leak the
  rule is named after cannot happen today.
- `check.yml` and `ticket-link.yml`: token is `Contents: read` on a public repository; no step
  after the checkout runs git. The credential has no use and no value.
- `agent-ticket.yml` and `agent-fix.yml`: token has `Contents`, `Issues` and `PullRequests`
  write. No step between the checkout and the agent action runs git with it (the guard steps
  call `gh` with `GH_TOKEN` from the environment). The agent action removes the checkout
  credential itself ("Removing existing git authentication headers") and pushes with its own
  app token in the remote URL. On `pull_request_review_comment` the checkout is the pull
  request's merge commit, so `npm ci` installs what an `agent/*` branch asks for while the
  write token is in `.git/config`.
- Not verified: the agent log is from the `v1` tag of Nov 10, not the pinned `v1.0.283`, and no
  run has had the option set. The repository is public, so a fetch needs no credential.
- What changed in the ticket: nothing; this ticket was written after the investigation.

**Acceptance criteria.**

1. Each of the four `actions/checkout` steps has `persist-credentials: false` in its `with:`
   block. No other line in the workflows changes.
2. A test in `tests/` reads every `.github/workflows/*.yml` file and fails, naming the file and
   the line, when a checkout step does not set `persist-credentials: false`. It fails closed:
   a line that mentions `actions/checkout` in any other form than a block `uses:` step, a step
   whose next line is not its own `with:`, an option given twice, a value other than `false`,
   or a flow mapping is reported, not passed. It runs in `npm run check`.
3. The test is shown red against the current workflows before they are changed (test-first).
4. `AGENTS.md` says that a checkout step sets `persist-credentials: false`.
5. `check` (Linux and Windows) and `ticket-link` run green on the pull request; that is the
   verification for those two workflows.
6. The agent workflows are not run by this ticket (no label, no `@claude`). Their change is
   reported as unverified until the next labelled ticket, whose run log must show
   `persist-credentials: false` and a successful push.
7. After the merge the fork is synced and Arnica is read again; the result for the four
   findings is recorded in `journal/day-16.md`, whatever it is.
8. `npm run check` passes.

**Out of scope.** The agent action's own write token in the remote URL while ticket-written
tests run (T-036); Arnica's two Low findings and its Info secret finding (decided separately,
no code change); Arnica pull-request checks.

# T-034: Pin every third-party action in the workflows to a commit

**Goal.** Each `uses:` in `.github/workflows/` names a full commit SHA, with the release it was
taken from in a comment. A tag that moves upstream can no longer change what runs in the
factory, least of all in the two agent workflows that hold the Anthropic key and write tokens.

**Why.** `agent-ticket.yml` and `agent-fix.yml` run `anthropics/claude-code-action@v1` with
`ANTHROPIC_API_KEY` and `contents`, `pull-requests` and `issues` write access, and they commit
on `agent/*` branches. `@v1` is a moving tag: whatever it points to on the day of a run is what
runs with those secrets, and nobody here has read it. `check.yml` and `ticket-link.yml` are the
required checks on `main`; a moved tag in them changes the gate without a pull request.
This ticket is also the Day 14 pull request inside the approval guard on `.github/workflows/**`.

**Investigation.** Done Nov 19 on `main` at `532219f`, by reading the four workflows and asking
GitHub for each tag (`gh api repos/<owner>/<repo>/git/ref/tags/<tag>`, annotated tags
dereferenced).

- Ten `uses:` lines, three actions: `actions/checkout@v5` (4 times), `actions/setup-node@v5`
  (4 times), `anthropics/claude-code-action@v1` (2 times, agent workflows only). None is pinned.
- `actions/checkout@v5` → `fbc6f3992d24b796d5a048ff273f7fcc4a7b6c09`, the same commit as `v5.1.0`.
- `actions/setup-node@v5` → `a0853c24544627f65ddf259abe73b1d18a591444`, the same commit as
  `v5.0.0`.
- `anthropics/claude-code-action@v1` → `f431adaf77e0fecf918431e75a2b5b45b85af002`, the same
  commit as `v1.0.283`, released Nov 19 01:17 UTC. 14 releases since Nov 9; the bot's last run
  was Nov 10 (run 42870198062). So `v1` has moved 14 times since the bot last ran, and the next
  labelled ticket would run a version no run here has used.
- No `dependabot.yml` exists, so nothing proposes pin updates.
- What changed in the ticket: nothing; the claims held.

**Acceptance criteria.**

1. Every `uses:` in `.github/workflows/*.yml` is `<owner>/<repo>@<40 hex>` followed by
   `# <exact release tag>` (`v1.2.3`, `1.2.3`, `v1.2.3-rc.1`; not a moving tag or a word),
   using the SHAs in the Investigation (the release each moving tag points to on Nov 19). No
   other line in the workflows changes.
2. A test in `tests/` reads every `.github/workflows/*.yml` file and fails, naming the file,
   the line number and the action, when a `uses:` is not pinned to a 40-hex SHA with a
   release comment. A local action (`./…`) or `docker://` reference, if one is ever added, is
   reported as unsupported rather than passed. It runs in `npm run check`.
   **The check fails closed** (human decision, Nov 19, after Qodo local review 2 found
   spellings a line regex missed): every line where `uses` can stand as a key (a space before
   the colon, a quoted key, a flow mapping, or the word inside other text) is reported unless
   it is exactly the pinned block form. A `run:` string that contains `uses:` is reported too;
   that false alarm is accepted, a silent miss is not. A double-quoted key with a backslash
   escape is reported too (YAML reads `"\u0075ses"` as `uses`; Qodo local review 3, 5fa32f55).
7. (Added Nov 19, human decision after review 3.) The repository setting
   `sha_pinning_required` is on, so GitHub itself refuses an unpinned action in any spelling.
   The test is the early warning; the setting is the control. Checked before turning it on:
   the pinned `claude-code-action` pins its own nested action (`oven-sh/setup-bun` by SHA), and
   `checkout` and `setup-node` call none, so no lane breaks. Consequence: the unpinned workflows
   on `main` and on older branches stop running until this pull request is merged.
3. The test is shown red against the unpinned files before the pins are made (test-first).
4. `AGENTS.md` says that actions are pinned by commit and that bumping a pin is its own pull
   request, read by the human (the approval guard on `.github/workflows/**` keeps it that way).
5. `check` (Linux and Windows) and `ticket-link` run green on the pull request with the pinned
   actions. The agent workflows are not run by this ticket (no label).
6. `npm run check` passes.

**Out of scope.** Dependabot or another updater for the pins (later ticket); changing any
permission, trigger or step in the workflows.

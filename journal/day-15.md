# Day 15 — Nov 20 — Show your factory

Brief: https://github.com/orgs/qodo-hackathon/discussions/17. No new setup: publish one public
post on LinkedIn, X or Instagram that shows how the factory runs (ticket, implementation,
verification, review, and where the human decides), with one concrete example, one lesson, and
what works versus what is planned; tag Qodo; reply in the thread with the link. (The plan said
"Let an agent use your app" for today; the thread is canonical. T-014 moves to a free slot.)

- Platform: LinkedIn.
- Reply in the thread: https://github.com/orgs/qodo-hackathon/discussions/17#discussioncomment-19779443
- Post: https://www.linkedin.com/feed/update/urn:li:activity:7529586450061750272/
- Image: `evidence/day15/factory-diagram.png`, rendered from `factory-diagram.html` with headless
  Edge (nothing sent to an outside renderer).

## What the post shows

`FACTORY.md` is too dense for a feed, so the image is a seven-step version of it: ticket,
Investigation gate, test-first build, Qodo local review (three rounds at most), the pull request
checks GitHub enforces, Qodo's PR review feeding the "Qodo approved" workflow with the approval
guard, and the human merge. The human decisions are marked separately: picking the lane after
reading the revised ticket, every Low and every disputed finding, guarded changes, the merge.

- Example: T-034. A pin check written as regexes over YAML; seven Qodo reviews found eight ways
  past it; GitHub's `sha_pinning_required` is what held (`journal/day-14.md`).
- Lesson: read back any setting that lives outside the repository (the guard that lost its path
  on Day 14).
- Planned, said as planned: Qodo review on the bot lane (T-029), the MCP server (T-013). Known
  gap, said as a gap: the Qodo review gate (5b) is procedure, not enforced by GitHub.

## Before posting: `scripts/` guarded

The post names the guarded paths, so Day 14's open question was settled first: `scripts/**` was
added to the approval guard, saved, and read back after a reload
(`evidence/day15/01-guard-scripts-after-reload.png`). `FACTORY.md` and `AGENTS.md` were updated
and pushed (`9ccf4ec`, `check` green) before the post went out, so the linked map matches the
post. Details in `journal/day-14.md`, "Follow-up (Nov 20)".

## What I missed

- The first render of the image said "five Qodo reviews found five more ways past it". The
  journal says seven reviews and eight ways. Caught by checking the card against
  `journal/day-14.md` before posting; a public number gets checked against the record.
- The guard screenshot showed the account email in the portal sidebar. It was cropped before it
  went into `evidence/`, which is public.

## Lesson

A post about the factory is a claim about the repository. Make the repository true first (the
guard, the docs, a green `check`), then post, and check every number in the post against the
journal.

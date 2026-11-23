# T-037: The audit script finds commit links with a fixed pattern

**Goal.** `auditNotes()` in `.claude/skills/release-notes-audit/scripts/audit.ts` no longer
builds a regular expression from the repository URL. It matches every commit link with a fixed
pattern and compares the link's base to the repository URL as plain text. What the audit
reports does not change.

**Why.** Day 16: Arnica's scan reported a Low finding, "Detect non literal regexp", on the line
that builds the expression (`audit.ts#L236` on `main` at `1a6f865`). The finding is not a
vulnerability today: the URL is validated and every special character in it is escaped before
the expression is built. The human chose to fix it anyway (Nov 23): the code is simpler without
the escaping step, and the finding then closes by itself instead of by a dismissal. The other
Low (`src/config.ts#L30`, the user's own ignore patterns) is the feature of T-008 and is
dismissed in Arnica, not changed.

**Investigation.** Done Nov 23 on `main` at `8f88b60`, by reading `audit.ts`, `src/render.ts`
and `tests/release-notes-audit.test.ts`.

- One place builds an expression from input: `linkRe`, from `input.repoUrl` with its special
  characters escaped, anchored on an unescaped `](` and ending in `/commit/<40 hex>)`. It is
  used once, to list the full SHAs each entry line links to under this repository's base.
- `auditNotes()` calls `checkRepoUrl()` first. A URL that passes is
  `https://<host>[:port]/<owner>/<repo>` over `[A-Za-z0-9._-]`, so it holds no `)` and no
  whitespace. A fixed pattern `](<base>/commit/<40 hex>)` with `<base>` as any run of
  characters other than `)` and whitespace therefore captures the same links, and comparing
  the captured base with `===` selects the same ones the built expression matched.
- A second fixed pattern already exists next to it (`anyCommitLink`, 7 to 40 hex, any base); it
  counts links whatever their base and stays as it is.
- The tests build their inputs with the real CLI and cover: a missing link, a link to another
  repository added to a line, swapped links, a link inside a subject. None uses a base that
  differs from the repository URL only where the URL has a character that is special in a
  regular expression (the `.` in the host); that case is what the escaping step was for.
- What changed in the ticket: nothing; it was written after the investigation.

**Acceptance criteria.**

1. `audit.ts` contains no `new RegExp(` and no `RegExp(` call; the commit links are found with
   a regular expression literal, and the base is compared to `input.repoUrl` with `===`.
2. A test shows that a link whose base differs from the repository URL only by a character
   standing where the URL has a `.` is not taken as the entry's own link: the audit fails
   `markdown-links`. The test passes before the change (the escaping did this) and after it.
3. Every existing test of the audit passes unchanged.
4. The skill's dry run on a real range of this repository gives the same report before and
   after the change (`evidence/day16/t037/`).
5. `npm run check` passes.
6. After the merge the fork is synced and Arnica is read again; the result for the finding is
   recorded in `journal/day-16.md`, whatever it is.

**Out of scope.** `src/config.ts#L30` (dismissed in Arnica as intentional); any change to what
the audit checks or reports; the `SKILL.md` text.

# Qodo setup before the Day 11 change (Nov 16, before the PR 26 re-run)

Read from the portal screenshots in this folder (Configurations, **Workspace** level, preset **Recall**)
and from the repository file `pr_agent.toml` (a copy of `.pr_agent.toml` on `main`). No repository wiki
page existed (`tracenotes.wiki.git` not found).

| Tab | Setting | Value |
|---|---|---|
| Finding types | Bug | always on |
| | Rule violation | on, 19 active standards |
| | Skill insight, Cross-repo conflict | on |
| | Requirement gap | on, **no spec source connected** ("will run and find nothing") |
| | Design gap | on, no Figma source |
| Display | Display mode | Balanced |
| | Group by / Severity terminology | Severity / High, Medium, Low |
| Workflow | Code review trigger | Published PRs |
| | Review every push | on |
| | Allow GitHub bot reviews | off (the repo file sets `ignore_bot_pr = false`) |
| | Review effort mode | Auto, highest allowed: Deep |
| | Fix loop optimization | on |
| Context | REVIEW.md instructions | on (the repository has no REVIEW.md) |
| | Rule files | AGENTS.md, CLAUDE.md, GEMINI.md, best_practices.md, RULE.md, .cursorrules, copilot-instructions.md, pr_compliance_checklist.yaml; folder `.cursor/rules` |
| | Mine rules from review history; auto-approve mined rules | on; on |
| | Auto-approve rules from repository files | off |
| Remediation | Remediation agent, auto fix | off |
| | Suggest committable fixes | on |
| Custom instructions | Issue finding agent, Rule enforcer agent, Review effort mode | **empty** (0 / 2,000 characters each) |
| Agentic Toolbox | | "Codebase tool access could not be loaded" |

Repository file (`pr_agent.toml`): `[github] ignore_bot_pr = false`; `[github_app] ignore_bot_pr = false`,
`push_trigger_ignore_bot_commits = false`. Nothing else.

Screenshot of the Repository and Git organization levels: not taken; the Workspace level is what the
"before" review ran with unless those levels override it.

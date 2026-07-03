# Claude Code Configuration & Usage Audit
**Date:** 2026-07-03 · **Scope:** global `~/.claude`, workspace + repo config, memory/lessons, ~3 months of transcripts (111 sessions, 1,966 subagent runs, fully streamed by script)

---

## Executive summary (one screen)

Your setup is not failing where you think it is. The transcript data says your three standing preferences are **mostly already honoured**: median assistant reply is 35 words, true "continue" nudges are 1 in 941 prompts, and 80% of sessions end with an explicit status. The one measurable gap is **~20% of sessions ending with no Done/Not-done marker** — fixable with a Stop hook.

Where the setup *is* failing:

1. **The real recurring incidents have zero enforcement.** Push≠deploy (5 separate notes, still recurring), parallel-session git clobbering (2 incidents in 2 days, 2026-07-02/03), and skipped verification before "done" (3 prod incidents traceable to it). Every one of these has only passive notes. The single hook that looks like enforcement (git-push confirm) is a no-op echo.
2. **Governance pile-up.** At least 8 systems each claim authority over session start, pre-edit, and pre-done. Three demand to be the mandatory first step (GSD, superpowers' "1% rule", session-setup). Compliance is near zero: GSD invoked 2× in a month despite a hard "no edits outside GSD" block; session-setup ran in 2 of 30 sessions despite firing every session. These blocks are dead letter, and they directly contradict your own "just fix it autonomously" instruction *in the same file*.
3. **Context tax.** ~15,000 tokens of CLAUDE.md/rules auto-load per session, plus ~26–30 KB of SessionStart hook injections. The context-mode routing block is pasted verbatim into **both** the workspace and repo CLAUDE.md (935 tokens × 2) *and* injected twice more by hooks because a stale v1.0.22 is hard-pinned in `settings.json` alongside the live v1.0.168 plugin.
4. **Stale docs actively misdirect.** Three memory files exist purely to contradict CLAUDE.md (nav file, email transport, migration workflow). The repo CLAUDE.md self-contradicts on Tailwind (v3 vs v4), crons (5 listed vs 38 real), and `fromDb<T>()` (mandated, doesn't exist anywhere in `src/`).
5. **Dead weight.** 11 project-scoped plugins are pinned to the repo's old path (`Cursor/anchor-management-tools`) and never activate. ~204 skill entries are exposed per session with 8+ duplicate names; the 50-command GSD suite and the entire review sprawl (~24 distinct review entry points) go essentially unused.

**Recommended shape of the fix:** delete the dead-letter enforcement blocks and duplicated context; add three small hooks that target the three incidents that actually recur; correct the stale facts once; archive (never delete) the dead weight. Full numbered plan below.

---

## Scorecard — your three standing preferences

| Preference | Evidence (3 months, 111 sessions) | Grade | Instrument recommended |
|---|---|---|---|
| (a) Short, plain, answer-first | Median reply **35 words**; p90 165; only **8.5%** exceed 200 words | B+ | Response-contract block in global CLAUDE.md (items 9, 14); output style optional |
| (b) Explicit Done/Not-done | **19.8%** of sessions (16.3% of long ones) end with **no** status marker | C+ | **Stop hook** (item 13) — the only hard guarantee |
| (c) No premature stops | **1** true "continue" nudge in 941 prompts (0.1%); you steer via interrupts (49) instead | A | Nothing new needed; keep the memory note |

**Instrument trade-offs for (a)–(c):**
- **CLAUDE.md rule** — zero runtime cost, always loaded, but advisory; it's what you have now and it's ~80% effective.
- **Output style** — replaces part of the system prompt, so it's stronger than a rule and costs nothing per turn; but it's global (affects all projects) and invisible until you inspect it. Good for (a)+(b) tone-setting.
- **Stop hook** — the only mechanism that can *block* a turn ending without a status line. Costs one Node process per turn end and occasionally forces a retry (false positives possible on borderline replies; the draft exempts replies under 240 chars). Recommended for (b) only.

---

## Findings, prioritised

### Critical

**C1 — context-mode hooks double-registered at two versions.**
`~/.claude/settings.json` hard-pins `plugins/cache/context-mode/context-mode/1.0.22/hooks/{sessionstart,pretooluse}.mjs` while the enabled plugin (1.0.168) registers the same events via its own hooks.json. SessionStart injection and PreToolUse evaluation (Bash/Read/Grep/WebFetch/Agent) fire twice per event. A `settings.json.bak` from Jun 29 shows the pre-pin state. *Fix: item 1.*

**C2 — the three most-recurring incidents have zero enforcement.**
- *Push ≠ deploy:* 5 separate records (`feedback_verify_deployments.md`, `lessons.md:31-35`, `reference_deploy_topology.md`, `reference_prod_migration_workflow.md`, MEMORY.md index).
- *Parallel git clobbering:* 2 incidents in 2 days — 2026-07-02 (a parallel subagent gutted the Tabology webhook, 67 lines) and 2026-07-03 (`feedback_parallel_session_git_hazard.md`).
- *Verification before done:* `lessons.md` items 4–6 all trace prod incidents to skipped verification (skipped `npm test` on deletion; untested PL/pgSQL retry path → first live booking failed, commit `9e63e709` "prod incident").
30% of your last 821 commits start with `fix:`. The only enforcement-shaped hook (workspace git-push gate) just echoes "awaiting confirmation" and blocks nothing. *Fix: items 11–13, 15–16.*

**C3 — competing governance with near-zero compliance.**
Three systems claim the mandatory first step: GSD ("Do not make direct repo edits outside a GSD workflow", repo CLAUDE.md), superpowers ("even a 1% chance … you ABSOLUTELY MUST invoke the skill", injected every session), session-setup ("Run the session-setup skill now", every session). Your own repo CLAUDE.md simultaneously demands "Autonomous Bug Fixing: just fix it… zero context switching". Measured reality: GSD 2 invocations/month (vs 50 commands + 17 agents), session-setup 2/30 sessions, superpowers skills genuinely used (13 invocations — the only governance layer earning its keep). ~24 distinct code-review entry points and ~11 planning entry points exist. *Fix: items 4–6; operating model below.*

### High

**H1 — stale CLAUDE.md facts actively misdirect.** All verified against the codebase:
- Tailwind: repo CLAUDE.md says both v4 (Quick Profile) and "^3.4.0, tailwind.config.js … v3 NOT v4". **Truth: v4.3.0**, no config file, `@theme` in `globals.css`, `@tailwindcss/postcss`.
- Navigation: points at `src/components/features/shared/AppNavigation.tsx` — **doesn't exist**; live file is `src/ds/shell/SidebarNav.tsx`.
- Email: "via Microsoft Graph" — **truth: dual transport** Graph|Resend switched by `EMAIL_PROVIDER` (`src/lib/email/emailService.ts:38-49`).
- Crons: table lists 5; **vercel.json has 38** (and one of the 5 has the wrong schedule); CLAUDE.md elsewhere says "35+".
- `fromDb<T>()`: mandated by workspace CLAUDE.md and `rules/supabase.md:27-28`, claimed "preserved" by repo CLAUDE.md — **zero occurrences in `src/`**; project maps manually.
Three memory files exist solely to contradict these docs. *Fix: items 7–10.*

**H2 — session context tax.** ~15K tokens of CLAUDE.md + rules auto-load; hooks inject ~26–30 KB more at SessionStart (superpowers ~5.8 KB, vercel ~12–13 KB incl. an upgrade nag that violates your own "do only what is asked" rule, context-mode ×2). The 3,741-byte context-mode block is duplicated verbatim in workspace CLAUDE.md *and* repo CLAUDE.md — redundant three times over since the plugin injects it anyway. Repo CLAUDE.md also contains two `## Architecture` and two `## Error Handling` sections and re-states ~2–3 KB of workspace content. *Fix: items 2–3, 8, 25.*

**H3 — 11 project-scoped plugins are dead.** Pinned in `installed_plugins.json` to `projectPath: /Users/peterpitcher/Cursor/anchor-management-tools`, which no longer exists (repo renamed to `OJ-AnchorManagementTools`): github, feature-dev, ralph-loop, playwright, commit-commands, context7, typescript-lsp, code-simplifier, serena, claude-md-management, frontend-design. They silently never activate. *Fix: item 22.*

**H4 — whole-project typecheck after every edit.** Workspace PostToolUse runs `npx tsc --noEmit` after every `.ts(x)` Edit/Write — a per-edit latency tax on a ~600-file repo, multiplied by multi-edit waves. Your verification pipeline already mandates typecheck pre-push. *Fix: item 5.*

### Medium

**M1 — done-status ambiguity** (scorecard row b). ~1 in 5 sessions ends without an explicit status. *Fix: items 13–14.*

**M2 — duplicate registrations.** `ui-standards-enforcer` agent exists at workspace (9,369 B) *and* repo (10,434 B) with **differing content** — ambiguous which wins. `fix-function` appears twice in the skill list (global + project copy, different descriptions). `codex-qa-review` exists in two on-disk copies. `anthropic-skills:*` (claude.ai-synced) duplicates 6 local skills (implement-plan, keyword-plan, obsidian-docs, standards-guardian, schedule, docx). superpowers ships 3 deprecated command stubs. 9 plugins are enabled at both workspace and repo level. *Fix: items 18–21, 24.*

**M3 — hygiene.** Orphaned `gsd-workflow-guard.js` (wired nowhere); stale `settings.json.bak`; junk permission `Bash(done)` in repo settings.local.json; redundant allow rule in global settings.local.json; `tasks/` holds 6.6 MB across 60 files; `design` skill is 9.3 MB; 33/47 global skills are symlinks into `~/.agents/skills/` (one directory move breaks 70% of the library); legacy memory dir for the repo's old path still present. *Fix: items 17, 20–21, 27.*

### Low

**L1 —** Vercel plugin injects an upgrade nag every session; workspace CLAUDE.md contains a pseudo-hook (`when:/do:` YAML for codex) that no runtime executes; the git-push "gate" hook is a cosmetic echo. **L2 —** 8.5% of replies exceed 200 words — the residual target for preference (a).

---

## Skill inventory — keep / cut / merge (by family)

~107 skills visible per session (47 global — 33 of them symlinks — plus ~60 plugin), ~204 list entries including duplicates. Actual invocations in 3 months, this repo: superpowers 13, implement-plan 14 (all projects), codex-qa-review 9, seo-powerhouse 5, fix-function 4, session-setup 8, graphify (typed 4×), long tail ≤3.

| Family | Count | Verdict | Reason |
|---|---|---|---|
| superpowers plugin | 14 skills | **Keep** | Only governance layer with real usage (brainstorming 18, writing-plans 16, systematic-debugging 10) |
| Marketing pack (symlinked) | ~33 | **Keep** | Used in website projects (seo-powerhouse, keyword-plan); zero cost when not triggered |
| GSD suite | 50 cmds + 17 agents | **Demote to opt-in** (item 6); archive optional (item 26) | 2 uses in a month; enforcement block is dead letter; statusline worth keeping |
| context-mode | 8 skills + hooks | **Keep, fix double-reg** (items 1–3) | Heavily wired; sandbox genuinely used |
| vercel plugin | 25 skills, 3 agents | **Optional disable** (item 25) | ~13 KB/session injection + nag; deploys are git-push-driven; MCP unauthenticated |
| anthropic-skills (claude.ai sync) | 6 dupes | **Disable at source** (item 24) | Pure duplicates of local skills |
| karpathy-skills | 1 | **Cut** (item 23) | Zero invocations |
| Local one-offs: graphify, design, auth-standardiser, e2e-test, editorial-team, cleanup, codex(-qa-review), find-skills | — | **Keep** | Used or cheap; note design = 9.3 MB |
| obsidian-docs, standards-guardian (local copies) | 2 | **Cut (archive)** (item 27) | Zero invocations, both duplicated by anthropic-skills anyway |
| Project `.claude/skills` copies (codex-qa-review, fix-function, bug-fix, techdebt, code-review) | 5 | **Merge** (item 19) | Duplicate global copies; cause the double listing |
| session-setup | 1 | **Demote to on-demand** (item 4) | Demanded every session, obeyed 2/30 |

---

## The operating model (recommendation)

One owner per moment; everything else opt-in:

| Moment | Single owner | Everything else |
|---|---|---|
| Session start | context-mode plugin (once) + statusline | No mandatory skill demands (session-setup, GSD nag removed) |
| Planning | Built-in plan mode; `tasks/todo.md` for tracking | GSD and superpowers plans invoked explicitly when wanted |
| Editing | Autonomous (your rule), protected by parallel-git-guard hook | GSD enforcement block removed |
| Review | Built-in `/code-review`; `codex-qa-review` as the named second opinion | The other ~22 entry points remain but are never mandated |
| Turn end | Stop hook (Done/Not-done) + response contract | — |

Precedence, written down once: **your prompt > repo CLAUDE.md > workspace CLAUDE.md > plugin advice.**

---

## Working-practice feedback (evidence-grounded)

1. **Your steering style works — your verification gate doesn't.** You correct via interrupts (49) rather than re-prompts (≈0), and sessions are marathons (73% >100 messages, ~18 subagents each). But 30% of commits are `fix:` and the prod incidents cluster at the ship boundary. Invest at that boundary (hooks 11–13, skills 15–16), not in more process systems.
2. **Governance accretes and never sheds.** Every plugin added a "mandatory" layer; none was removed when ignored. Adopt one-in-one-out: an enforcement block that transcripts show being ignored is a bug, not a rule.
3. **Notes fail at the moment of action.** Memory/lessons work when they record facts (deploy topology, live nav file). They fail when they demand behaviour at a moment you're not reading them — that's exactly the pattern behind all three Critical-2 themes. Hooks fire at the moment; notes don't.
4. **Docs that contradict the code cost double.** Three memories exist purely to override CLAUDE.md; the dead-duplicate-clients pattern ("fixes keep landing on the dead copy") is the same disease in code form. After item 7, treat any new "the doc is wrong" memory as a prompt to fix the doc the same day.
5. **Housekeeping:** `tasks/` at 6.6 MB and the legacy memory dir for the old repo path are safe archive candidates (not in this plan's scope; say the word).

---

## Numbered change plan

Approve by number, e.g. `APPROVED: 1, 2, 7-13`. Effort XS–XL; risk L/M/H. All backups go to `./tasks/claude-audit-backups/<timestamp>/` before any touch; nothing is hard-deleted — removals move files to `~/.claude/_archived/`.

### Group R — Reversible

**Kill double-firing & injection bloat**
1. **Remove stale context-mode v1.0.22 hook entries** (SessionStart + PreToolUse) from `~/.claude/settings.json`; live v1.0.168 plugin keeps registering its own. [XS, L]
2. **Delete the context-mode routing block from repo CLAUDE.md** (`# context-mode — MANDATORY routing rules` … end). Plugin injects the same rules every session. Saves ~935 tokens. [XS, L]
3. **Delete the identical block from workspace `Cursor/CLAUDE.md`.** Saves another ~935 tokens. [XS, L]
4. **Remove the session-setup SessionStart hook entries** from `~/.claude/settings.json` (both `session-setup.js` at SessionStart and, optionally, the Pre/PostToolUse `session-setup-hooks.js` advisories). Skill stays available as `/session-setup`. [XS, L]
5. **Remove the workspace PostToolUse `tsc --noEmit`-per-edit hook** from `Cursor/.claude/settings.json`. Pre-push pipeline already mandates typecheck. Trade-off: type errors surface at verification instead of instantly. [XS, L/M]
6. **Delete the "GSD Workflow Enforcement" section from repo CLAUDE.md.** GSD stays installed and invocable; it just stops being (a fictional) law. [XS, L]

**Fix the facts, slim the docs** (full diffs in `tasks/claude-audit-drafts/claude-md-edits.md`)
7. **Repo CLAUDE.md fact corrections:** Tailwind → v4/`@theme`/no config file; navigation → `src/ds/shell/SidebarNav.tsx`; email → dual Graph|Resend via `EMAIL_PROVIDER`; cron table → "38 crons; `vercel.json` is the source of truth"; remove the `fromDb<T>()` "preserved" claim. [S, L]
8. **Repo CLAUDE.md de-duplication:** remove the second `## Architecture` and `## Error Handling` sections and the content re-stated from workspace CLAUDE.md (commands block, core principles, workflow orchestration). ~2–3 KB saved. [M, M — needs your read-through]
9. **Global `~/.claude/CLAUDE.md`: add the Response Contract block** (plain English, answer first, mandatory Done/Not-done line, work-to-completion + the three legitimate pause reasons). This is the portable, all-projects home for your three preferences. [XS, L]
10. **Workspace fixes:** replace the codex pseudo-hook YAML with one plain sentence; soften `rules/supabase.md` `fromDb` mandate to "follow the project's conversion convention (AMS maps manually)". [S, L]

**New enforcement** (drafts in `tasks/claude-audit-drafts/hooks/` + `skills/`)
11. **Add deploy-verify PostToolUse hook** (workspace settings): after any `git push`, injects the push≠deploy checklist (Ready + prod alias) into context. [S, L]
12. **Add parallel-git-guard PreToolUse hook** (workspace settings): denies `git stash` (except list/show), `git add -A|.`, `git checkout --`, `git reset --hard`, `git clean -f` with an explanation and "ask the user to run it" escape hatch. Directly encodes the 2026-07-02/03 incidents. Trade-off: occasionally blocks a legitimately-wanted command; you run it yourself in that case. [S, M]
13. **Add done-status Stop hook** (global settings): blocks a turn ending without a Done/Not-done marker in the final message (replies <240 chars exempt; loop-guarded). The hard guarantee for preference (b). [M, M]
14. **Install "Concise Status" output style** (`~/.claude/output-styles/`) — optional complement to 9/13; enable per-session with `/output-style`. [S, L]
15. **Add `deploy-verify` skill** — actually performs the Vercel Ready + alias check after a push (the hook reminds; the skill verifies). Knows the-anchor.pub website is manual-deploy. [S, L]
16. **Add `prod-migrate` skill** — encodes the real prod migration workflow (Supabase MCP `apply_migration`, not `db push`), function-grant lockdown, drop-column function audit, post-apply smoke test, `RETURNS TABLE` casting. Kills the theme behind lesson 6 and two reference memories. [S, L]

**Hygiene**
17. **Permission cleanup:** remove `Bash(done)` from repo `settings.local.json`; remove the redundant `Bash(node .../session-setup.js)` rule from global `settings.local.json` (subsumed by `Bash(node:*)`). [XS, L]
18. **Resolve `ui-standards-enforcer` duplicate:** keep the newer repo copy, archive the workspace copy (diff preserved in backups). [S, L]
19. **De-dupe project `.claude/skills/`:** archive the project copies of `codex-qa-review` and `fix-function` (global copies remain) — removes the double listing. [S, L]

### Group D — Destructive (archive/disable; all reversible via `~/.claude/_archived/`)

20. **Archive orphaned `gsd-workflow-guard.js`** (referenced nowhere). [XS, L]
21. **Archive `~/.claude/settings.json.bak`.** [XS, L]
22. **Remove the 11 dead project-scoped plugin entries** pinned to the old repo path (github, feature-dev, ralph-loop, playwright, commit-commands, context7, typescript-lsp, code-simplifier, serena, claude-md-management, frontend-design). Tell me which you actually want and I'll note reinstall commands for the new path in the apply report. [M, M]
23. **Disable karpathy-skills plugin** (zero use). [XS, L]
24. **anthropic-skills duplicates** — these sync from claude.ai, not local files; I can't remove them. *Action for you:* disable the duplicated skills in claude.ai connector/skill settings. Listed for completeness. [XS, L]
25. **OPTIONAL — disable the vercel plugin** in this workspace: saves ~13 KB/session + the nag; you lose vercel:* skills and its MCP (currently unauthenticated anyway). [XS, M]
26. **OPTIONAL — archive the GSD command suite** (50 commands + 17 agents) keeping `gsd-statusline.js` and `gsd-context-monitor.js`. Only if you've decided you won't use GSD; item 6 alone already removes the friction. [L, M]
27. **OPTIONAL — archive unused local skills** `obsidian-docs`, `standards-guardian` (both zero-use and duplicated by anthropic-skills). [XS, L]

### Quick wins vs structural
- **Quick wins (do today):** 1–7, 9, 11–13, 17, 20–21 — roughly halves per-session context waste and installs all three enforcement hooks.
- **Structural (need your judgement):** 8 (CLAUDE.md rewrite), 22 (which plugins to revive), 25–27 (what to retire).

---

## Drafts index (`tasks/claude-audit-drafts/`)

| File | For item |
|---|---|
| `hooks/deploy-verify.js` | 11 |
| `hooks/parallel-git-guard.js` | 12 |
| `hooks/done-status-stop.js` | 13 |
| `hooks/settings-snippets.md` | 1, 4, 5, 11–13 (exact JSON) |
| `claude-md-edits.md` | 2, 3, 6–10 (diffs) |
| `output-style-concise-status.md` | 14 |
| `skills/deploy-verify/SKILL.md` | 15 |
| `skills/prod-migrate/SKILL.md` | 16 |

---

## Apply log — 2026-07-03 (APPROVED: 1–27)

**Backups:** `tasks/claude-audit-backups/2026-07-03-170337/` (every modified file, pre-change). **Quarantine:** `~/.claude/_archived/2026-07-03/` (nothing hard-deleted).

Applied: 1–23, 25–27 in full; 24 is a user action (disable anthropic-skills duplicates in claude.ai settings). Item 26 deviation: `gsd-check-update.js` and `gsd-prompt-guard.js` hooks left wired (not named for removal; both verified error-free after archiving — statusline shows a cosmetic `/gsd:update` chip). Item 8 deviation: kept both Error Handling sections and the generated architecture layers (content proved non-duplicative on close read); removed Core Principles/workflow-orchestration duplicates, empty headings, and the Entry Points repeat instead.

**Measured result:** CLAUDE.md auto-load 60,045 → 34,682 bytes for the three files (repo 28,572→23,257; workspace 14,026→9,922; global 226→1,503 incl. new Response Contract). context-mode now fires once (stale v1.0.22 entries gone). New hooks tested green: deploy-verify (fires on `git push` only), parallel-git-guard (denies `git add -A`/`stash`/`reset --hard`/`checkout --`/`clean -f`; allows explicit paths, `stash list`), done-status-stop (blocks long unmarked endings; passes Done-marked, short, and loop-guard cases). New skills `deploy-verify` + `prod-migrate` registered live mid-session. All six edited settings files JSON-valid.

**Rollback:** copy any file back from the backup dir; move archived items back from `~/.claude/_archived/2026-07-03/` (commands-gsd → `~/.claude/commands/gsd`, agents/* → `~/.claude/agents/`, etc.); re-enable vercel/karpathy by restoring their `enabledPlugins` lines in `~/.claude/settings.json`.

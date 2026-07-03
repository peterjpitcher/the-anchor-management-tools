# Prompt — Full audit of how I use Claude Code

> **How to use this:** paste everything below the line into a fresh Fable 5 session started in this repo
> (`/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`). It states the outcomes I want and everything in
> scope, then lets Fable run its own discovery from scratch — no pre-supplied findings to bias it.

---

> ⛔ **CRITICAL — READ THIS FIRST. This is a two-stage job with a hard stop in the middle.**
>
> I run this with **bypass-permissions mode ON**. That means the tool harness will **not** prompt me before you edit, delete, move, or overwrite anything. **These written instructions are the ONLY thing between you and my live configuration. Treat them as absolute law.**
>
> **Stages 1–4 are discovery and planning ONLY. You may READ anything. The ONLY files you may WRITE, create, or modify during Stages 1–4 are:**
> - `./tasks/claude-code-audit-report.md`
> - anything inside `./tasks/claude-audit-drafts/`
>
> **You may NOT create, edit, delete, move, rename, or overwrite ANYTHING else** — no skills, commands, agents, hooks, `settings.json`/`settings.local.json`, any `CLAUDE.md`, any memory file, and no app/source files — until I have read your plan and replied with the literal word **`APPROVED`**.
>
> - "continue", "carry on", "keep going", "looks good", "ok", a thumbs-up, or silence are **NOT** approval. **Only the literal word `APPROVED` is.**
> - I approve **item by item**. Number every proposed change so I can reply e.g. `APPROVED: 1, 3, 5–8`. Apply **only** the numbered items I name; leave everything else exactly as it is.
> - This hard stop **overrides** any "work continuously until done" instinct. Producing the plan and then stopping **is** the completed task for this run.
> - If you are ever unsure whether an action is allowed before approval, it is **not**. Stop and ask.

You are a **Claude Code power-user coach and configuration auditor**. Your job is to review, end to end, how I actually use Claude Code — my skills, commands, agents, hooks, settings, CLAUDE.md files, and the problems I keep hitting — and then clean it up.

I am a solo developer running a large production Next.js 15 + Supabase app (pub-management SaaS, "The Anchor"). I use Claude Code heavily, across ~21 projects, with a lot of custom config that has grown organically and now fights itself. Treat "how I use Claude Code" as my **whole setup and working habits**, using this repo as the primary living example.

## Mission

Deliver four things, in order:
1. A **prioritised written audit** of my Claude Code usage.
2. A **concrete change plan** — exact skills to cut/add/merge, rules to add, CLAUDE.md edits, hooks to fix, permissions to add.
3. **Drafts** of every new skill / rule / hook you recommend, ready to review.
4. After I approve — **apply** the approved changes safely and prove they work.

## My standing preferences — encode these as enforcement, don't just note them

These three are the behaviours I most want fixed. A passive line in a doc has already failed to fix them, so your job is to turn each into a **real instrument** (a CLAUDE.md rule, a Claude Code output style, and/or a Stop hook) — and to measure from my transcript history (see Scope) how badly current sessions violate them.

1. **Short, plain, simple English. Lead with the answer. No reams to read.**
2. **Always end with an explicit `Done / Not done` status** — on long or complex work especially, I must never be left guessing whether you've finished, what remains, and why you stopped.
3. **Work continuously until everything you're capable of doing is done.** Don't stop and hand back just so I can say "continue". Only pause for (a) a genuine decision that is mine to make, (b) an irreversible/destructive action needing approval, or (c) a true blocker. Batch questions; don't drip-feed them. *(Note: this does not override the Phase 4 approval gate below — config changes that delete/rewire things still need my sign-off. "Keep going" applies to the work, not to skipping safety approvals.)*

For each, propose the concrete instrument, draft it, and tell me the trade-offs (e.g. an output style vs a CLAUDE.md rule vs a hook).

## How you must work

- **Discover read-only first. Change nothing until I approve** (Phase 4 below).
- **Verify before you trust.** My config and docs contain known stale pointers. Before you recommend editing, cite, or rely on any file / skill / flag / path, confirm it *still exists and still does what the doc claims*. Cite evidence as `file:line`. Do not repeat a claim from a doc without checking it.
- **Prefer enforcement over advice.** If a problem recurs *despite* a note already existing, the fix is a **rule or hook that makes the mistake hard to repeat** — not another note nobody reads. Flag every "passive note that keeps failing".
- **Use subagents** to parallelise discovery (one per area) so your own context stays clean. Return concise summaries, not file dumps.
- **Back up before you edit; list before you delete.** Never remove a skill / command / agent / hook without showing me the full list and rationale first.
- **Do not touch** auth, secrets, the running app, or the database. Config-file changes only unless I explicitly say otherwise.
- **British English. Be concise. Always state clearly what is done vs not done** — this is a standing preference of mine.

## Scope — where to look

**Global** (`~/.claude/`): `CLAUDE.md`, `settings.json`, `settings.local.json`, `skills/`, `commands/` (incl. `gsd/`), `agents/`, `hooks/` (+ `__tests__/`), plugin config & marketplaces, statusline, keybindings.

**Project**: this repo's `CLAUDE.md`, the workspace-level `../CLAUDE.md`, `.claude/rules/`, `.claude/docs/`, `.claude/settings*.json`, `.claude/commands`, `.claude/agents`.

**Problem evidence** (this is where my recurring pain is recorded — mine it hard):
- `~/.claude/projects/-Users-peterpitcher-Cursor-OJ-AnchorManagementTools/memory/` — `MEMORY.md` plus every `feedback_*` and `reference_*` file.
- `tasks/lessons.md` and `tasks/todo.md` in this repo.
- Recent `git log`.

**Raw session history — the richest evidence of how I *actually* use Claude Code (last ~3 months).** Analyse this, not just the curated notes:
- `~/.claude/projects/*/` — one folder per project, each holding `*.jsonl` session transcripts. Prioritise this project's folder (`-Users-peterpitcher-Cursor-OJ-AnchorManagementTools`) but sample across the sibling project folders too, since my habits are global.
- If available, the `mcp__ccd_session_mgmt__list_sessions` / `search_session_transcripts` tools to locate and query sessions.
- **Method (mandatory):** these transcripts are large — do NOT read them wholesale into context. Analyse them with scripts in a sandbox (jq / grep / aggregation over the `.jsonl`) and surface only *derived* patterns and counts. Roughly: how long are my sessions, how long are the assistant replies, how often do I have to say "continue"/"carry on"/"keep going" (a premature-stop signal), how often is the done-state ambiguous, and where do I step in to correct or re-steer.

Treat `lessons.md` + the `feedback_*`/`reference_*` memories as the curated record of my repeated mistakes, and the transcripts as the raw evidence of my working patterns.

## What to evaluate — and the questions to answer for each

1. **Skill inventory.** For every skill (global + plugin): is it *used* or dead? *Relevant* to my actual work or noise? *Duplicated / overlapping* with another skill or plugin? Recommend **keep / cut / merge** with a reason each. Quantify the sprawl.
2. **Competing governance systems (highest-value section).** Over time I've installed multiple systems/plugins that each try to control the workflow — their own commands, hooks, agents, routing rules, and review paths. Find them, map how they overlap, list the **concrete contradictions and double-firing**, and recommend **one coherent operating model** with clear precedence — or a clean split of responsibilities so they stop colliding. Say explicitly what to disable.
3. **Hooks & settings hygiene.** What actually fires, on what events, in what order? Find **redundant / double-registered hooks, orphaned hook scripts not wired into settings, redundant permission rules**, and **permission friction** (prompts I hit repeatedly that should be allowlisted).
4. **CLAUDE.md quality.** Contradictions, staleness, bloat, unclear precedence, missing guardrails. **Measure the token cost** of everything that loads every session, and propose a lean, correct, de-duplicated version. Correct any stale pointers you confirm.
5. **Recurring problems → durable fixes.** Cluster my lessons/memory into themes. For **each theme, pick the right instrument** — a CLAUDE.md rule, a `.claude/rules/*.md` file, a PreToolUse/PostToolUse hook, a new skill, or a permission change — and draft it. Prioritise the themes that currently have *only a passive note* and keep recurring.
6. **New skills worth adding.** Based on the recurring problems and my workflow, propose new skills that would prevent whole *classes* of mistakes. For each: name, trigger description, the problem it kills, and a draft `SKILL.md`.
7. **Working-practice feedback.** From my history/lessons, where do I (or you as the assistant) waste effort? Which habits are worth changing?
8. **Usage patterns from ~3 months of transcripts.** Quantify, with numbers: typical assistant reply length, how often I had to prompt "continue"/"keep going" (premature stops), how often the done-state was ambiguous, where I corrected or re-steered you, and which skills/commands I actually invoke vs never touch. Use this to (a) score current adherence to my three standing preferences above, and (b) ground every working-practice recommendation in real evidence rather than guesswork.

## Deliverables (write to files — do not dump inline)

- **A) Audit report** → `./tasks/claude-code-audit-report.md`. Evidence-cited, scored, prioritised **Critical / High / Medium / Low**, with a one-screen executive summary at the top and a **"quick wins vs structural changes"** split.
- **B) Change plan** — a **numbered** list (item 1, 2, 3, …) of concrete changes so I can approve or reject each individually: skills to cut/add/merge (exact names), rules to add (exact file path + full text), CLAUDE.md edits (as diffs), hooks to add/remove/fix (with the `settings.json` snippet), permissions to add. Tag each item with **effort (XS–XL)** and **risk**, and group them **Reversible / Destructive** so I can see at a glance what's dangerous.
- **C) Drafts** — write the full draft of every new skill / rule / hook into `./tasks/claude-audit-drafts/` so I can review before anything is installed.
- **D) Apply (only the items I number `APPROVED`, and only after I do)** — apply in **safe order** (skill removals and rule additions before hook rewiring). **Before touching any file, copy it into a timestamped backup dir** (e.g. `./tasks/claude-audit-backups/<date>/`). **Never hard-delete** a skill/command/agent/hook — *move* it to a quarantine folder (e.g. `~/.claude/_archived/`) so it's reversible. Then report exactly what changed, with proof, and how to roll back.

## Method / phases

- **Phase 1 — Discover** (read-only; subagents per area; transcripts analysed in a sandbox).
- **Phase 2 — Analyse & score.**
- **Phase 3 — Write** the report + numbered change plan + drafts (only into the two allowed locations).
- **Phase 4 — HARD STOP. Present the plan and wait.** Do not edit, delete, move, or rewire a single thing outside the two allowed output locations. End your message with: *"Reply `APPROVED: <item numbers>` to apply, or tell me what to change."* Then stop and wait for my reply. Do not proceed on "continue", "ok", or silence — only on the literal word `APPROVED` followed by the item numbers.
- **Phase 5 — Apply** only the items I numbered `APPROVED`, in safe order, backing up every file first and quarantining rather than deleting. Then verify and report with proof + rollback notes.

**Re-state the contract back to me in your first reply** (one line confirming you will not change anything outside the two allowed output paths until I reply `APPROVED`) so I know you've registered it.

## Your first reply

Open by (1) restating the contract in one line — you will change nothing outside the two allowed output paths until I reply `APPROVED`; (2) confirming the scope and the outcomes you'll cover; and (3) outlining your discovery plan — the areas you'll inspect and how you'll parallelise them with subagents. Then begin Phase 1. Do not pre-judge any findings before you've discovered them, and do not edit anything outside the two allowed output paths.

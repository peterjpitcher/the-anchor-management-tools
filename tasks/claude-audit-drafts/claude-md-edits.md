# CLAUDE.md edits (items 2, 3, 6–10) — as diffs

Anchors are exact text from the current files; line numbers indicative.

---

## Item 2 — repo `OJ-AnchorManagementTools/CLAUDE.md`: delete duplicated context-mode block

Delete the entire section from the heading below to end of file (~62 lines, ~3.7 KB). The context-mode plugin injects identical rules at every SessionStart.

```diff
-# context-mode — MANDATORY routing rules
-
-You have context-mode MCP tools available. These rules are NOT optional …
-… (entire section through the ctx commands table) …
```

## Item 3 — workspace `Cursor/CLAUDE.md`: delete the identical block

Same section, same deletion (byte-identical copy).

## Item 6 — repo CLAUDE.md: delete GSD enforcement

```diff
-## GSD Workflow Enforcement
-
-Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.
-
-Use these entry points:
-- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
-- `/gsd:debug` for investigation and bug fixing
-- `/gsd:execute-phase` for planned phase work
-
-Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
+## GSD (optional)
+
+GSD planning artifacts live in `.planning/`. Use `/gsd:*` commands when explicitly working a planned phase; direct edits are otherwise fine.
```

## Item 7 — repo CLAUDE.md: fact corrections

**7a. Tailwind (Key Dependencies section):**
```diff
-- Tailwind CSS ^3.4.0 (config: tailwind.config.js) + tailwindcss-animate ^1.0.7
+- Tailwind CSS ^4.3.0 — CSS-first config via `@theme` in `src/app/globals.css` (no tailwind.config file); processed by `@tailwindcss/postcss`. Plus tailwindcss-animate ^1.0.7
```

**7b. Tailwind (Configuration section):**
```diff
-- `tailwind.config.js` — Tailwind theme (v3; NOT v4 inline theme)
+- Tailwind v4 theme tokens live in `src/app/globals.css` under `@theme`
```

**7c. Navigation pointer (UI Components):**
```diff
-Navigation defined in `src/components/features/shared/AppNavigation.tsx`.
+Navigation defined in `src/ds/shell/SidebarNav.tsx` (`NAV_GROUPS`); consumed by `AppShell`/`Sidebar`/`MobileChrome`.
```

**7d. Email (Key Libraries):**
```diff
-- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)` via Microsoft Graph
+- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)`; dual transport (Microsoft Graph or Resend) switched by `EMAIL_PROVIDER` (falls back to Resend when `RESEND_API_KEY` is set)
```

**7e. Crons — replace the 5-row table:**
```diff
-## Scheduled Jobs (vercel.json crons)
-
-| Route | Schedule |
-|---|---|
-| `/api/cron/parking-notifications` | 0 5 * * * |
-| `/api/cron/rota-auto-close` | 0 5 * * * |
-| `/api/cron/rota-manager-alert` | 0 18 * * 0 |
-| `/api/cron/rota-staff-email` | 0 21 * * 0 |
-| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |
+## Scheduled Jobs
+
+38 crons are defined in `vercel.json` (41 route dirs under `src/app/api/cron/`). **`vercel.json` is the source of truth** — do not rely on any list in docs. All cron routes require `Authorization: Bearer CRON_SECRET`.
```

**7f. fromDb claim (Constraints/Existing patterns):**
```diff
-- **Existing patterns**: Server actions, `fromDb<T>()` conversion, audit logging — all preserved
+- **Existing patterns**: Server actions, manual snake_case→camelCase field mapping (this project has no `fromDb<T>()` helper), audit logging — all preserved
```

**7g. NEW — live-file guard (add under Data Conventions or UI Components):**
```diff
+### Before editing any *Client.tsx or page component
+Several sections have a dead duplicate `*Client.tsx`. Before fixing or testing a component, confirm which file the route's `page.tsx` actually imports — fixes and tests repeatedly land on the dead copy.
```

## Item 8 — repo CLAUDE.md: structural de-duplication (needs your read-through)

Delete, because each duplicates workspace CLAUDE.md or an earlier section of the same file:
- the second `## Architecture` heading block (the GSD-generated one that repeats the hand-written section)
- the second `## Error Handling` block
- `## Commands` block (identical to workspace Common Commands, minus typecheck — keep ONE, prefer repo since it's project-specific; delete the workspace-duplicated prose around it instead)
- `## Core Principles` (verbatim from workspace)
- `## Workflow Orchestration` subsections that repeat workspace text (Plan Mode Default, Subagent Strategy, Self-Improvement Loop) — keep only the project-specific lines (Autonomous Bug Fixing, Demand Elegance)
- Date-handling and phone bullets duplicated in both Conventions and Key Libraries — keep one occurrence

Estimated saving: ~2–3 KB (~600–750 tokens) on top of items 2 and 6.

## Item 9 — global `~/.claude/CLAUDE.md`: add Response Contract

Append (file currently only contains the graphify note):

```markdown
# Response contract (every reply, every project)

- Plain British English, short and simple. Lead with the answer or outcome in the first sentence; supporting detail after. No filler, no restating the question.
- Explain choices in terms of outcomes and trade-offs I care about, not internals. Never bury a decision in technical detail — if detail could mislead, summarise it and say what it means for me.
- End every substantive reply with an explicit status block:
  **Done** — <what was delivered>, or **Not done — <exactly what remains and why you stopped>**
  **Next:** <what happens next — "nothing, finished" is a valid answer>
  **You need to:** <any actions only I can take, as a checklist — omit the line if none>
  Never leave completion ambiguous, especially on long or multi-step work.
- Work continuously until everything you are capable of doing is done. Do not stop to ask "shall I continue?". Pause ONLY for: (a) a decision that is genuinely mine, (b) an irreversible or destructive action, (c) a true blocker. Batch questions; never drip-feed them.
- Never ask me a question without a recommendation. Every question comes with your preferred option and one line on why. If I don't reply, the recommendation is what you'd proceed with (where safe).
```

## Item 10 — workspace fixes

**10a. `Cursor/CLAUDE.md` — replace the codex pseudo-hook:**
```diff
-### 6. Codex Integration Hook
-Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.
-
-```
-when: "running tests OR auditing OR simulating"
-do:
-  - run_skill(codex-review, target=current_task)
-  - compare_outputs(claude_result, codex_result)
-  - flag_discrepancies(threshold=medium)
-  - merge_best_solution()
-```
-
-The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.
+### 6. Second opinion
+For an independent adversarial review, invoke the `codex-qa-review` skill ("QA review", "second opinion", "check my work"). It is on-demand, not automatic.
```

**10b. `Cursor/.claude/rules/supabase.md` — soften the fromDb mandate:**
```diff
-DB columns are always `snake_case`; TypeScript types are `camelCase` with Date objects. Always wrap DB results:
-
-```typescript
-import { fromDb } from "@/lib/utils";
-const record = fromDb<MyType>(dbRow); // converts snake_case keys + ISO strings → Date
-```
+DB columns are always `snake_case`; TypeScript types are `camelCase`. Follow the project's conversion convention: some projects use a `fromDb<T>()` helper; **AnchorManagementTools maps fields manually in query transforms** — check existing code before assuming a helper exists.
```

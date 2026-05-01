# Review Pack: event-promo-sms-fix

**Generated:** 2026-04-20
**Mode:** A (A=Adversarial / B=Code / C=Spec Compliance)
**Project root:** `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools`
**Base ref:** `main`
**HEAD:** `ce7af5b7`
**Diff range:** `main...HEAD`

> This pack is the sole input for reviewers. Do NOT read files outside it unless a specific finding requires verification. If a file not in the pack is needed, mark the finding `Needs verification` and describe what would resolve it.

## Changed Files

_(none detected for this diff range)_

## User Concerns

Spec correctness for fixing broken event promo SMS pipeline. Three bugs: PGRST203 overload ambiguity, timestamptz type mismatch, empty promo_sequence table. Verify the fix plan is complete and the backfill migration is safe.

## Diff (`main...HEAD`)

_(no diff output)_

## Changed File Contents

_(no files to include)_
## Related Files (grep hints)

_(no related files found by basename grep)_

## Workspace Conventions (`Cursor/CLAUDE.md`)

```markdown
# CLAUDE.md — Workspace Standards

Shared guidance for Claude Code across all projects. Project-level `CLAUDE.md` files take precedence over this one — always read them first.

## Default Stack

Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS, Supabase (PostgreSQL + Auth + RLS), deployed on Vercel.

## Workspace Architecture

21 projects across three brands, plus shared tooling:

| Prefix | Brand | Examples |
|--------|-------|----------|
| `OJ-` | Orange Jelly | AnchorManagementTools, CheersAI2.0, Planner2.0, MusicBingo, CashBingo, QuizNight, The-Anchor.pub, DukesHeadLeatherhead.com, OrangeJelly.co.uk, WhatsAppVideoCreator |
| `GMI-` | GMI | MixerAI2.0 (canonical auth reference), TheCookbook, ThePantry |
| `BARONS-` | Barons | CareerHub, EventHub, BrunchLaunchAtTheStar, StPatricksDay, DigitalExperienceMockUp, WebsiteContent |
| (none) | Shared / test | Test, oj-planner-app |

## Core Principles

**How to think:**
- **Simplicity First** — make every change as simple as possible; minimal code impact
- **No Laziness** — find root causes; no temporary fixes; senior developer standards
- **Minimal Impact** — only touch what's necessary; avoid introducing bugs

**How to act:**
1. **Do ONLY what is asked** — no unsolicited improvements
2. **Ask ONE clarifying question maximum** — if unclear, proceed with safest minimal implementation
3. **Record EVERY assumption** — document in PR/commit messages
4. **One concern per changeset** — if a second concern emerges, park it
5. **Fail safely** — when in doubt, stop and request human approval

### Source of Truth Hierarchy

1. Project-level CLAUDE.md
2. Explicit task instructions
3. Existing code patterns in the project
4. This workspace CLAUDE.md
5. Industry best practices / framework defaults

## Ethics & Safety

AI MUST stop and request explicit approval before:
- Any operation that could DELETE user data or drop DB columns/tables
- Disabling authentication/authorisation or removing encryption
- Logging, sending, or storing PII in new locations
- Changes that could cause >1 minute downtime
- Using GPL/AGPL code in proprietary projects

## Communication

- When the user asks to "remove" or "clean up" something, clarify whether they mean a code change or a database/data cleanup before proceeding
- Ask ONE clarifying question maximum — if still unclear, proceed with the safest interpretation

## Debugging & Bug Fixes

- When fixing bugs, check the ENTIRE application for related issues, not just the reported area — ask: "Are there other places this same pattern exists?"
- When given a bug report: just fix it — don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user

## Code Changes

- Before suggesting new environment variables or database columns, check existing ones first — use `grep` to find existing env vars and inspect the current schema before proposing additions
- One logical change per commit; one concern per changeset

## Workflow Orchestration

### 1. Plan Mode Default
- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately

### 2. Subagent Strategy
- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- One task per subagent for focused execution

### 3. Task Tracking
- Write plan to `tasks/todo.md` with checkable items before starting
- Mark items complete as you go; document results when done

### 4. Self-Improvement Loop
- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules that prevent the same mistake; review lessons at session start

### 5. Verification Before Done
- Never mark a task complete without proving it works
- Run tests, check logs, demonstrate correctness
- Ask yourself: "Would a staff engineer approve this?"
- For non-trivial changes: pause and ask "is there a more elegant way?"

### 6. Codex Integration Hook
Uses OpenAI Codex CLI to audit, test and simulate — catches what Claude misses.

```
when: "running tests OR auditing OR simulating"
do:
  - run_skill(codex-review, target=current_task)
  - compare_outputs(claude_result, codex_result)
  - flag_discrepancies(threshold=medium)
  - merge_best_solution()
```

The full multi-specialist QA review skill lives in `~/.claude/skills/codex-qa-review/`. Trigger with "QA review", "codex review", "second opinion", or "check my work". Deploys four specialist agents (Bug Hunter, Security Auditor, Performance Analyst, Standards Enforcer) into a single prioritised report.

## Common Commands

```bash
npm run dev       # Start development server
npm run build     # Production build
npm run lint      # ESLint (zero warnings enforced)
npm test          # Run tests (Vitest unless noted otherwise)
npm run typecheck # TypeScript type checking (npx tsc --noEmit)
npx supabase db push   # Apply pending migrations (Supabase projects)
```

## Coding Standards

### TypeScript
- No `any` types unless absolutely justified with a comment
- Explicit return types on all exported functions
- Props interfaces must be named (not inline anonymous objects for complex props)
- Use `Promise<{ success?: boolean; error?: string }>` for server action return types

### Frontend / Styling
- Use design tokens only — no hardcoded hex colours in components
- Always consider responsive breakpoints (`sm:`, `md:`, `lg:`)
- No conflicting or redundant class combinations
- Design tokens should live in `globals.css` via `@theme inline` (Tailwind v4) or `tailwind.config.ts`
- **Never use dynamic Tailwind class construction** (e.g., `bg-${color}-500`) — always use static, complete class names due to Tailwind's purge behaviour

### Date Handling
- Always use the project's `dateUtils` (typically `src/lib/dateUtils.ts`) for display
- Never use raw `new Date()` or `.toISOString()` for user-facing dates
- Default timezone: Europe/London
- Key utilities: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`

### Phone Numbers
- Always normalise to E.164 format (`+44...`) using `libphonenumber-js`

## Server Actions Pattern

All mutations use `'use server'` functions (typically in `src/app/actions/` or `src/actions/`):

```typescript
'use server';
export async function doSomething(params): Promise<{ success?: boolean; error?: string }> {
  const supabase = await getSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Unauthorized' };
  // ... permission check, business logic, audit log ...
  revalidatePath('/path');
  return { success: true };
}
```

## Database / Supabase

See `.claude/rules/supabase.md` for detailed patterns. Key rules:
- DB columns are `snake_case`; TypeScript types are `camelCase`
- Always wrap DB results with a conversion helper (e.g. `fromDb<T>()`)
- RLS is always on — use service role client only for system/cron operations
- Two client patterns: cookie-based auth client and service-role admin client

### Before Any Database Work
Before making changes to queries, migrations, server actions, or any code that touches the database, query the live schema for all tables involved:
```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name IN ('relevant_table') ORDER BY ordinal_position;
```
Also check for views referencing those tables — they will break silently if columns change:
```sql
SELECT table_name FROM information_schema.view_table_usage
WHERE table_name IN ('relevant_table');
```

### Migrations
- Always verify migrations don't conflict with existing timestamps
- Test the connection string works before pushing
- PostgreSQL views freeze their column lists — if underlying tables change, views must be recreated
- Never run destructive migrations (DROP COLUMN/TABLE) without explicit approval

## Git Conventions

See `.claude/rules/pr-and-git-standards.md` for full PR templates, branch naming, and reviewer checklists. Key rules:
- Conventional commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- Never force-push to `main`
- One logical change per commit
- Meaningful commit messages explaining "why" not just "what"

## Rules Reference

Core rules (always loaded from `.claude/rules/`):

| File | Read when… |
|------|-----------|
| `ui-patterns.md` | Building or modifying UI components, forms, buttons, navigation, or accessibility |
| `testing.md` | Adding, modifying, or debugging tests; setting up test infrastructure |
| `definition-of-ready.md` | Starting any new feature — check requirements are clear before coding |
| `definition-of-done.md` | Finishing any feature — verify all quality gates pass |
| `complexity-and-incremental-dev.md` | Scoping a task that touches 4+ files or involves schema changes |
| `pr-and-git-standards.md` | Creating branches, writing commit messages, or opening PRs |
| `verification-pipeline.md` | Before pushing — run the full lint → typecheck → test → build pipeline |
| `supabase.md` | Any database query, migration, RLS policy, or client usage |

Domain rules (auto-injected from `.claude/docs/` when you edit relevant files):

| File | Domain |
|------|--------|
| `auth-standard.md` | Auth, sessions, middleware, RBAC, CSRF, password reset, invites |
| `background-jobs.md` | Async job queues, Vercel Cron, retry logic |
| `api-key-auth.md` | External API key generation, validation, rotation |
| `file-export.md` | PDF, DOCX, CSV generation and download |
| `rate-limiting.md` | Upstash rate limiting, 429 responses |
| `qr-codes.md` | QR code generation (client + server) |
| `toast-notifications.md` | Sonner toast patterns |
| `email-notifications.md` | Resend email, templates, audit logging |
| `ai-llm.md` | LLM client, prompts, token tracking, vision |
| `payment-processing.md` | Stripe/PayPal two-phase payment flows |
| `data-tables.md` | TanStack React Table v8 patterns |

## Quality Gates

A feature is only complete when it passes the full Definition of Done checklist (`.claude/rules/definition-of-done.md`). At minimum: builds, lints, type-checks, tests pass, no hardcoded secrets, auth checks in place, code commented where complex.
```

## Project Conventions (`CLAUDE.md`)

```markdown
# CLAUDE.md — Anchor Management Tools

This file provides project-specific guidance. See the workspace-level `CLAUDE.md` one directory up for shared conventions (stack, TypeScript rules, Supabase patterns, etc.).

## Quick Profile

```yaml
framework: Next.js 15 App Router + React 19
test_runner: Vitest (config: vitest.config.ts)
database: Supabase (PostgreSQL + Auth + RLS)
integrations: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal
styling: Tailwind CSS v4
hosting: Vercel
size: ~600 files, large multi-module management system
```

---

## Workflow Orchestration

### Plan Mode Default
Enter plan mode for any non-trivial task (3+ steps or architectural decisions). If something goes sideways, STOP and re-plan immediately — don't keep pushing. Use plan mode for verification steps, not just building. Write detailed specs upfront to reduce ambiguity.

### Subagent Strategy
Use subagents liberally to keep the main context window clean. Offload research, exploration, and parallel analysis to subagents. For complex problems, throw more compute at it via subagents. One task per subagent for focused execution. When exploring the codebase, use subagents to read multiple sections in parallel.

### Self-Improvement Loop
After ANY correction from the user, update `tasks/lessons.md` with the pattern. Write rules for yourself that prevent the same mistake. Review `tasks/lessons.md` at session start.

### Verification Before Done
Never mark a task complete without proving it works. Diff behaviour between main and your changes when relevant. Ask yourself: "Would a staff engineer approve this?" Run tests, check logs, demonstrate correctness.

### Demand Elegance (Balanced)
For non-trivial changes, pause and ask "is there a more elegant way?" Skip this for simple, obvious fixes — don't over-engineer. Challenge your own work before presenting it.

### Autonomous Bug Fixing
When given a bug report, just fix it. Don't ask for hand-holding. Check Supabase logs, Vercel deployment logs, and browser console. Point at errors, then resolve them. Zero context switching from the user.

---

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

---

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Minimal code impact.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
- **Test Against Reality**: Don't assume code is correct because it exists. Trace the actual logic.

---

## Domain Rules

- £10 deposit per person for groups of 7 or more (NOT credit card holds — that was old functionality)
- Events hosted by the venue itself are exceptions to deposit rules
- Contracts must be generated for private bookings
- Booking amendments, cancellations, and deletions must track payment state correctly
- All customer-facing language must reflect current policies, not legacy ones
- Legacy "credit card hold" language anywhere in code or templates is always a bug

---

## Prompting Conventions

- **Challenge as reviewer**: "Grill me on these changes and don't make a PR until I pass your test."
- **Demand proof**: "Prove to me this works" — diff behaviour between main and feature branch.
- **Force elegance**: "Knowing everything you know now, scrap this and implement the elegant solution."
- **Section review**: "Do a full review of the /[section-name] section" triggers the fix-function skill.
- **Autonomous mode**: Point at logs, Slack threads, or failing CI and just say "fix."

---

## Commands

```bash
npm run dev      # Start development server
npm run build    # Production build
npm run lint     # ESLint (zero warnings enforced)
npm test         # Run Vitest tests
npx supabase db push   # Apply pending migrations
```

**Node version:** Use Node 20 LTS (as pinned in `.nvmrc`). Run `nvm use` before development. The `engines` field in `package.json` enforces `>=20 <23`.

## Architecture

**Additional integrations**: Twilio (SMS), Microsoft Graph (email), Stripe, PayPal.

**Route groups**:
- `(authenticated)/` — all staff-facing pages, auth enforced at layout level
- `(staff-portal)/portal/` — employee-only views (shifts, pay)
- `(timeclock)/timeclock/` — public kiosk access (no auth)
- `(employee-onboarding)/` — onboarding flows
- `api/cron/` — Vercel cron endpoints (require `Authorization: Bearer CRON_SECRET`)
- `api/webhooks/` — Twilio, Stripe, PayPal webhooks

**Auth**: Supabase Auth with JWT + HTTP-only cookies. `src/middleware.ts` is currently **disabled** (renamed `.disabled` after a Vercel incident); auth is enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Public path prefixes: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`.

## Supabase Clients

- **`src/lib/supabase/server.ts`** — cookie-based auth, use in server actions and API routes
- **`src/lib/supabase/admin.ts`** — service role key, bypasses RLS; use for system/cron operations
- ESLint rule prevents importing the admin singleton in client components

## Permissions (RBAC)

```typescript
await checkUserPermission('module', 'action', userId)
```

Modules: `calendar`, `customers`, `employees`, `events`, `invoices`, `messages`, `parking`, `private-bookings`, `receipts`, `rota`, `leave`, `timeclock`, `payroll`, `settings`, `roles`, etc.
Actions: `view`, `create`, `edit`, `delete`, `publish`, `request`, `clock`, `manage`.
Roles: `super_admin`, `manager`, `staff`. Defined in `src/types/rbac.ts`.

## Key Libraries & Utilities

- **`src/lib/dateUtils.ts`** — `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()` etc. London timezone hardcoded.
- **`src/lib/email/emailService.ts`** — `sendEmail(to, subject, html, cc?, attachments?)` via Microsoft Graph
- **`src/lib/sms/`** — Twilio wrapper with safety guards (hourly/daily rate limits, idempotency)
- **`src/services/`** — business logic services (CustomerService, EmployeeService, PermissionService, etc.)

## UI Components

Migrating from legacy `PageWrapper`/`Page` pattern to `PageLayout` + `HeaderNav` from `src/components/ui-v2/`. New pages must use the `ui-v2` pattern. Navigation defined in `src/components/ui-v2/navigation/AppNavigation.tsx`.

## Data Conventions

- Server actions body size limit: 20 MB (for file uploads)
- Dashboard data cached via `loadDashboardSnapshot()` in `src/app/(authenticated)/dashboard/`
- Date/holiday pre-computation: `buildConfirmedUKDates()` in calendar-notes actions

## Scheduled Jobs (vercel.json crons)

| Route | Schedule |
|---|---|
| `/api/cron/parking-notifications` | 0 5 * * * |
| `/api/cron/rota-auto-close` | 0 5 * * * |
| `/api/cron/rota-manager-alert` | 0 18 * * 0 |
| `/api/cron/rota-staff-email` | 0 21 * * 0 |
| `/api/cron/private-bookings-weekly-summary` | 0 * * * * |

## Key Environment Variables

```
NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
NEXT_PUBLIC_APP_URL
TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_PHONE_NUMBER
MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / MICROSOFT_TENANT_ID / MICROSOFT_USER_EMAIL
PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET / PAYPAL_WEBHOOK_ID / PAYPAL_ENVIRONMENT
STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET
OPENAI_API_KEY
CRON_SECRET
PAYROLL_ACCOUNTANT_EMAIL
```

See `.env.example` for the full list.
```

## Rule: `/Users/peterpitcher/Cursor/.claude/rules/definition-of-done.md`

```markdown
# Definition of Done (DoD)

A feature is ONLY complete when ALL applicable items pass. This extends the Quality Gates in the root CLAUDE.md.

## Code Quality

- [ ] Builds successfully — `npm run build` with zero errors
- [ ] Linting passes — `npm run lint` with zero warnings
- [ ] Type checks pass — `npx tsc --noEmit` clean (or project equivalent)
- [ ] No `any` types unless justified with a comment
- [ ] No hardcoded secrets or API keys
- [ ] No hardcoded hex colours — use design tokens
- [ ] Server action return types explicitly typed

## Testing

- [ ] All existing tests pass
- [ ] New tests written for business logic (happy path + at least 1 error case)
- [ ] Coverage meets project minimum (default: 80% on business logic)
- [ ] External services mocked — never hit real APIs in tests
- [ ] If no test suite exists yet, note this in the PR as tech debt

## Security

- [ ] Auth checks in place — server actions re-verify server-side
- [ ] Permission checks present — RBAC enforced on both UI and server
- [ ] Input validation complete — all user inputs sanitised (Zod or equivalent)
- [ ] No new PII logging, sending, or storing without approval
- [ ] RLS verified (Supabase projects) — queries respect row-level security

## Accessibility

- [ ] Interactive elements have visible focus styles
- [ ] Colour is not the sole indicator of state
- [ ] Modal dialogs trap focus and close on Escape
- [ ] Tables have proper `<thead>`, `<th scope>` markup
- [ ] Images have meaningful `alt` text
- [ ] Keyboard navigation works for all interactive elements

## Documentation

- [ ] Complex logic commented — future developers can understand "why"
- [ ] README updated if new setup, config, or env vars are needed
- [ ] Environment variables documented in `.env.example`
- [ ] Breaking changes noted in PR description

## Deployment

- [ ] Database migrations tested locally before pushing
- [ ] Rollback plan documented for schema changes
- [ ] No console.log or debug statements left in production code
- [ ] Verification pipeline passes (see `verification-pipeline.md`)
```

---

_End of pack._

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

**Auth**: Supabase Auth with JWT + HTTP-only cookies. `src/middleware.ts` is active and protects non-public routes; auth is also enforced in `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Public path prefixes: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`.

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

All UI components are imported from the unified design system barrel at `@/ds` (source: `src/ds/`). This includes primitives (Button, Input, Modal, etc.), composites (Card, Section, Tabs), shell components (Sidebar, Topbar, AppShell), and a compatibility layer (`src/ds/compat/`) for legacy wrapper components. Navigation defined in `src/components/features/shared/AppNavigation.tsx`.

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

<!-- GSD:project-start source:PROJECT.md -->
## Project

**AMS UI Redesign**

A comprehensive UI redesign and feature expansion of The Anchor Management Tools (AMS), implementing pixel-perfect designs from a Claude Design handoff bundle. The redesign covers a new design system, collapsible sidebar navigation, topbar, 20+ redesigned existing screens, 6+ new full-stack sections (Events, Performers, Cashing Up, OJ Projects, Short Links, Design System), and an FOH-only chromeless mode. The target is a production Next.js 15 App Router + React 19 + Tailwind CSS v4 + Supabase application.

**Core Value:** Every staff member at The Anchor sees a consistent, modern, professional management interface that matches the design handoff pixel-perfectly — with a collapsible sidebar, unified component library, and seamless navigation across all 34 screens.

### Constraints

- **Max phases**: 4 — user requirement
- **Tech stack**: Next.js 15 App Router, React 19, Tailwind CSS v4, Supabase — no changes
- **Backwards compatible**: App is in production; each phase must be independently deployable without breaking existing functionality
- **No auth changes**: Existing Supabase Auth + RBAC system stays as-is
- **Existing patterns**: Server actions, `fromDb<T>()` conversion, audit logging — all preserved
- **Node version**: 20 LTS as pinned in `.nvmrc`
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Languages
- TypeScript 5.8 — all source files under `src/`; strict mode enabled
- SQL — Supabase migrations in `supabase/migrations/`
## Runtime
- Node.js >=20 <23 (pinned to Node 20 LTS via `.nvmrc`)
- npm (implicit — no lock file override)
- Lockfile: `package-lock.json` present
## Frameworks
- Next.js ^15.5.14 — App Router, React Server Components, API routes, cron handlers
- React ^19.1.0 — UI layer (Server and Client Components)
- Vitest ^4.0.17 — test runner (config: `vitest.config.ts`)
- @testing-library/react ^16.0.1 — component testing
- @testing-library/user-event ^14.5.2 — user interaction simulation
- jsdom ^25.0.0 — DOM environment for Vitest
- TypeScript ^5.8.3 — type checking (`npx tsc --noEmit`)
- ESLint ^9.39.2 — linting (`eslint.config.js`); zero warnings enforced
- PostCSS `postcss.config.mjs` — Tailwind processing
- tsx ^4.21.0 — for running utility scripts directly (e.g., `scripts/`)
- patch-package ^8.0.1 — postinstall patches to `node_modules`
## Key Dependencies
- Tailwind CSS ^3.4.0 (config: `tailwind.config.js`) + tailwindcss-animate ^1.0.7
- tailwind-merge ^3.3.1 — merging class names without conflicts
- lucide-react ^0.522.0 — icon library
- @heroicons/react ^2.2.0 — additional icons
- @headlessui/react ^2.2.4 — accessible headless UI primitives
- react-hook-form ^7.66.1 + @hookform/resolvers ^5.2.2 — form management
- zod ^3.25.56 — schema validation
- react-hot-toast ^2.5.2 — toast notifications
- @dnd-kit/core, @dnd-kit/sortable, @dnd-kit/utilities — drag-and-drop (rota, menu)
- clsx ^2.1.1 — conditional class name utility
- @supabase/supabase-js ^2.55.0 — Supabase client (all DB operations)
- @supabase/ssr ^0.10.0 — cookie-based auth for Next.js SSR
- pdfkit ^0.18.0 — server-side PDF generation (invoices, contracts, payroll)
- pdf-lib ^1.17.1 — PDF manipulation
- pdf2json ^4.0.0 — PDF parsing
- pdfjs-dist ^5.4.530 — PDF rendering (browser)
- puppeteer ^24.12.1 + @sparticuz/chromium ^143.0.4 — headless browser PDF (quotes, invoices)
- @napi-rs/canvas ^0.1.88 — server-side canvas rendering
- sharp ^0.34.5 — image processing/compression
- exceljs ^4.4.0 — Excel export
- archiver ^7.0.1 — ZIP archive creation
- jszip ^3.10.1 — ZIP handling on client/server
- papaparse ^5.5.3 — CSV parsing
- mammoth ^1.11.0 — DOCX to HTML conversion
- twilio ^5.10.6 — SMS sending and webhook validation
- openai ^6.15.0 — OpenAI API client (receipt classification)
- @microsoft/microsoft-graph-client ^3.0.7 — Microsoft Graph (email via Outlook)
- @azure/identity ^4.10.2 — Azure AD credential for Graph auth
- googleapis ^171.4.0 — Google Calendar API
- @paypal/react-paypal-js ^9.0.1 — PayPal JS SDK (client-side payment buttons)
- @vercel/functions ^3.4.3 — Vercel serverless function utilities
- date-fns ^4.1.0 + date-fns-tz ^3.2.0 — date manipulation (London timezone)
- libphonenumber-js ^1.12.37 — phone number normalisation to E.164
- qrcode ^1.5.4 — QR code generation (server + client)
- franc ^6.2.0 — language detection
- @zxing/browser + @zxing/library — barcode/QR scanning (timeclock kiosk)
## Configuration
- Configured via `.env.local` (local) and Vercel environment variables (production)
- `.env.example` documents all required and optional vars
- Path alias: `@/*` → `./src/*` (tsconfig.json)
- `next.config.mjs` — Next.js configuration
- `postcss.config.mjs` — PostCSS/Tailwind pipeline
- `tailwind.config.js` — Tailwind theme (v3; NOT v4 inline theme)
- `vitest.config.ts` — test runner configuration
- `eslint.config.js` — ESLint flat config
## Platform Requirements
- Node 20 LTS (`.nvmrc` pins to `20`); run `nvm use` before development
- Supabase CLI (`supabase` devDependency ^2.58.5) for migrations
- Vercel (hosting + serverless functions + cron jobs)
- Supabase (PostgreSQL + Auth + RLS + Storage)
- Custom domains: `the-anchor.pub`, `vip-club.uk` (short links), `l.the-anchor.pub`
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

## Naming Patterns
- React page files: `page.tsx` (Next.js App Router convention)
- React component files: `PascalCase.tsx` (e.g., `MileageClient.tsx`, `DishExpandedRow.tsx`)
- Server action files: `camelCase.ts` (e.g., `mileage.ts`, `quotes.ts`, `employeeDetails.ts`)
- Test files: co-located with source in `__tests__/` subdirectory (e.g., `src/lib/__tests__/dateUtils.test.ts`) or co-located directly (e.g., `src/services/private-bookings.test.ts`)
- Library/utility files: `camelCase.ts` (e.g., `hmrcRates.ts`, `dateUtils.ts`, `audit-helpers.ts`)
- Exported server actions: `camelCase` async functions (e.g., `getDestinations`, `createTrip`, `deleteTrip`)
- Internal helpers: `camelCase` (e.g., `requireMileagePermission`, `revalidateMileagePaths`, `validateManualTripLegs`)
- Constants: `SCREAMING_SNAKE_CASE` (e.g., `STANDARD_RATE`, `REDUCED_RATE`, `THRESHOLD_MILES`)
- All TypeScript variables: `camelCase`
- Zod schema objects: `camelCase` with `Schema` suffix (e.g., `destinationSchema`, `tripLegSchema`, `createTripSchema`)
- Interfaces: `PascalCase` with named exports (e.g., `MileageDestination`, `MileageTrip`, `MileageTripLeg`)
- Type aliases: `PascalCase` (e.g., `MileageGranularity`, `GenericClient`)
- Exported from action files alongside the functions they relate to
- DB columns: `snake_case` (as stored in Supabase)
- TypeScript representations: `camelCase` with manual mapping in query results
- No `fromDb<T>()` generic helper used in this project — manual field-by-field mapping in query result transforms
## Code Style
- No Prettier config detected — formatting enforced via ESLint
- Single quotes for strings
- No semicolons at end of statements in most files (some legacy files use semicolons)
- Two-space indentation
- ESLint v9 flat config (`eslint.config.js`)
- Extends `next/core-web-vitals` + `next/typescript`
- `no-console` is an error — `console.warn` and `console.error` are the only permitted console calls
- `@typescript-eslint/no-unused-vars`: off (not enforced)
- `@typescript-eslint/no-explicit-any`: off (not enforced, but should still be avoided)
- `react-hooks/exhaustive-deps`: off
- `@next/next/no-img-element`: off
- ESLint rule prevents importing `@/lib/supabase-singleton` in any `src/components/**` file — admin client must only be used in server actions and route handlers
- Zero warnings enforced via `--max-warnings=0` in `npm run lint`
## Import Organization
- `@/` maps to `src/` (configured in `vitest.config.ts` and `tsconfig.json`)
## Server Action Pattern
## Error Handling
- Permission failures: throw `new Error('Insufficient permissions')` or `new Error('Unauthorized')` inside permission helper
- Validation failures: return `{ error: parsed.error.issues[0]?.message }` immediately (no throw)
- DB errors: `if (dbError) throw dbError` — caught by outer try/catch
- Catch block always extracts message: `error instanceof Error ? error.message : 'Fallback message'`
- Service layer (non-action) functions may throw directly (caller handles)
## Logging
## Comments
## Component Design
- Default to server components for page-level data fetching
- `'use client'` added for interactivity, hooks, and browser APIs
- Data passed from server parents as props to client children
- All UI components import from `@/ds` (unified design system barrel at `src/ds/`)
- Design tokens defined in `src/ds/tokens.ts` — primary green `#16a34a`, neutral grays
- Compat layer at `src/ds/compat/` for legacy wrapper components (FormGroup, EmptyState, TabNav, etc.)
- Tailwind classes only — no inline hex colors in components
- Never use dynamic Tailwind class construction (e.g., no `bg-${color}-500`)
## Module Design
- Named exports everywhere (no default exports from utility/service files)
- Default exports used only for Next.js page/layout components
- `src/ds/index.ts` is the single export point for the UI library (re-exports primitives, composites, shell, compat)
- Service and action files do not use barrel exports — import directly from specific files
## Form Validation
## Date Handling
- Always use `src/lib/dateUtils.ts` utilities for user-facing dates
- Key functions: `getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()`, `formatTime12Hour()`
- London timezone hardcoded (`Europe/London`) throughout
- Never use raw `new Date()` or `.toISOString()` for display
## Phone Numbers
- Normalise to E.164 format via `formatPhoneForStorage()` from `src/lib/utils.ts` (delegates to `src/lib/phone/`)
- `generatePhoneVariants()` used for search matching across formats
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## Pattern Overview
- Server Components as default; `'use client'` only for interactivity, forms, and browser APIs
- All mutations go through `'use server'` actions in `src/app/actions/`; direct DB access from pages is server-only and read-focused
- Business logic lives in `src/services/` (domain services) and `src/lib/` (cross-cutting utilities), not in route handlers or components
- Auth enforced by middleware and authenticated layout; RBAC enforced server-side in every action
- Comprehensive audit logging via `logAuditEvent()` on every mutation
## Layers
- Purpose: Render UI, handle user events, call server actions
- Location: `src/app/(authenticated)/**/*.tsx`, `src/components/`
- Contains: Server Components (pages, layouts), Client Components (`*Client.tsx`), modal components
- Depends on: Server actions, context, hooks
- Used by: End users (browser)
- Purpose: Handle all mutations, enforce auth/RBAC, coordinate business logic, revalidate cache
- Location: `src/app/actions/` (~60+ action files, one per domain)
- Contains: `'use server'` functions that validate input, check permissions, call services, log audit events, and call `revalidatePath()`
- Depends on: Services layer, lib utilities, Supabase clients
- Used by: Client components (via Next.js Server Actions RPC)
- Purpose: Domain business logic, data access encapsulation, complex queries
- Location: `src/services/` (flat files: `customers.ts`, `employees.ts`, `private-bookings.ts`, `parking.ts`, etc.)
- Contains: Class-based services (e.g. `CustomerService`, `PrivateBookingService`) with methods that query Supabase directly
- Depends on: Supabase clients, lib utilities, type definitions
- Used by: Server actions, cron routes, API routes
- Purpose: Cross-cutting utilities and integration wrappers
- Location: `src/lib/` (large flat directory + domain sub-folders)
- Contains: Supabase clients, email service, SMS service, PDF generator, date utilities, validation schemas, payments, OpenAI wrappers, rate limiting
- Depends on: External SDKs (Twilio, Microsoft Graph, Stripe, PayPal, OpenAI)
- Used by: Services, server actions, API routes, cron jobs
- Purpose: Webhooks, public-facing APIs, cron triggers
- Location: `src/app/api/`
- Contains: Webhook handlers (`/webhooks/paypal`, `/webhooks/twilio`), cron jobs (`/cron/*` — 35+ scheduled jobs), public/external endpoints
- Depends on: Services, lib utilities
- Used by: External services (Twilio, PayPal webhooks), Vercel Cron scheduler
- Purpose: Shared TypeScript interfaces
- Location: `src/types/` (flat files: `database.ts`, `database.generated.ts`, `rbac.ts`, `customers.ts`, etc.)
- Contains: DB row types, domain model types, RBAC types, generated Supabase types
- Depends on: Nothing (pure types)
- Used by: All other layers
## Data Flow
- Server state via Supabase + Next.js cache (`unstable_cache`, `revalidatePath`, `revalidateTag`)
- Client state via React Context: `PermissionContext` (`src/contexts/PermissionContext.tsx`) provides RBAC data to all client components without prop drilling
- Form state via React Hook Form (where configured)
- No Redux, Zustand, or global client state stores
## Key Abstractions
- Purpose: Expose pre-loaded RBAC permissions to all client components without repeated server round-trips
- Location: `src/contexts/PermissionContext.tsx`
- Pattern: Seeded at layout level with `initialPermissions` from server, consumed by client components to show/hide UI elements
- Purpose: Consistent mutation response shape
- Pattern: `Promise<{ success?: boolean; error?: string; data?: T }>` across all action files
- Purpose: Cookie-based client for user-scoped operations (respects RLS); admin/service-role client for system operations
- Location: `src/lib/supabase/server.ts` (anon+cookie), `src/lib/supabase/admin.ts` (service role)
- Purpose: Encapsulate complex multi-step business operations, reusable across server actions and API routes
- Examples: `src/services/customers.ts` (CustomerService), `src/services/private-bookings.ts` (PrivateBookingService), `src/services/employees.ts` (EmployeeService)
- Pattern: Class with static or instance methods; direct Supabase queries; no HTTP calls
- Purpose: Complex domain logic that doesn't fit services (calculations, templates, external calls)
- Examples: `src/lib/rota/`, `src/lib/mileage/`, `src/lib/private-bookings/`, `src/lib/invoices/`, `src/lib/menu/`
- Pattern: Flat function exports or small focused files
## Entry Points
- Location: `src/app/(authenticated)/layout.tsx`
- Triggers: Any request under `/` (authenticated paths)
- Responsibilities: Auth guard (`supabase.auth.getUser()`), permission loading (`getUserPermissions()`), portal redirect for non-management staff
- Location: `src/app/table-booking/`
- Triggers: Customer visits booking URL
- Responsibilities: Public form, token-based confirmation, no auth required
- Location: `src/app/parking/guest/`
- Triggers: Guest visits parking link
- Responsibilities: Public parking registration flow
- Location: `src/app/(staff-portal)/portal/`
- Triggers: Staff-only employees log in
- Responsibilities: Shift view, leave requests, payroll — no management access
- Location: `src/app/(timeclock)/timeclock/`
- Triggers: Kiosk device access (no auth)
- Responsibilities: Clock in/out for employees
- Location: `src/app/layout.tsx`
- Responsibilities: Global providers (Supabase session, Toaster), PWA manifest, SEO robot blocking, service worker registration
## Error Handling
- Server actions return `{ error: string }` for expected failures (validation, permission denied, not found)
- Server actions throw for unexpected failures (let Next.js error boundary catch)
- `src/lib/errors.ts` contains typed error helpers
- `src/lib/dbErrorHandler.ts` normalises Supabase DB errors
- `src/lib/retry.ts` wraps flaky external calls (SMS, email) with retry logic
- `src/lib/supabase-retry.ts` adds retry wrapper for Supabase queries
- `error.tsx` files at route group level catch rendering errors
## Cross-Cutting Concerns
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED
Any Bash command containing `curl` or `wget` is intercepted and replaced with an error message. Do NOT retry.
Instead use:
- `ctx_fetch_and_index(url, source)` to fetch and index web pages
- `ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED
Any Bash command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` is intercepted and replaced with an error message. Do NOT retry with Bash.
Instead use:
- `ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### WebFetch — BLOCKED
WebFetch calls are denied entirely. The URL is extracted and you are told to use `ctx_fetch_and_index` instead.
Instead use:
- `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Bash (>20 lines output)
Bash is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:
- `ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### Read (for analysis)
If you are reading a file to **Edit** it → Read is correct (Edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `ctx_execute_file(path, language, code)` instead. Only your printed summary enters context. The raw file content stays in the sandbox.

### Grep (large results)
Grep results can flood context. Use `ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls.
2. **FOLLOW-UP**: `ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `ctx_execute(language, code)` | `ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `ctx_fetch_and_index(url, source)` then `ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Subagent routing

When spawning subagents (Agent/Task tool), the routing block is automatically injected into their prompt. Bash-type subagents are upgraded to general-purpose so they have access to MCP tools. You do NOT need to manually instruct subagents about context-mode.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `ctx_search(source: "label")` later.

## ctx commands

| Command | Action |
|---------|--------|
| `ctx stats` | Call the `ctx_stats` MCP tool and display the full output verbatim |
| `ctx doctor` | Call the `ctx_doctor` MCP tool, run the returned shell command, display as checklist |
| `ctx upgrade` | Call the `ctx_upgrade` MCP tool, run the returned shell command, display as checklist |

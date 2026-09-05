# CLAUDE.md, Anchor Management Tools

Project-specific guidance only. Workspace-wide standards (TypeScript, Tailwind, Supabase client patterns, git, testing, quality gates, task tracking) live in `/Users/peterpitcher/Cursor/CLAUDE.md` and `/Users/peterpitcher/Cursor/.claude/rules/`; read those first, they are not repeated here. `AGENTS.md` is a symlink to this file so Codex and Cursor read the same rules. Talk to the user in plain, simple British English and keep replies short.

Reference material (route map, public path list, API surface, cron inventory, env var inventory, RBAC lists, dependency inventory, naming conventions, architecture layers) lives in `docs/agent-reference.md`. The wider docs index is `docs/README.md`.

## What this is

The live staff and admin app for The Anchor (Stanwell Moor) and Orange Jelly at `https://management.orangejelly.co.uk`. Its Supabase database is the sole source of truth for bookings, customers, employees, rota, payroll, invoices, receipts and messaging. Real customers, real SMS, real money: every send, cron and migration touches production. The public website (`/Users/peterpitcher/Cursor/OJ-The-Anchor.pub`) has no database of its own and reads this app's API with an API key.

## Stack: deviations from the workspace default

- Next.js 15 App Router, React 19, TypeScript strict, Tailwind CSS v4 (CSS-first `@theme` in `src/app/globals.css`, no `tailwind.config`), Supabase, Vercel.
- **Vitest**, not Jest (`vitest.config.ts`, jsdom, `TZ` pinned to `Europe/London`). Tests live mostly in the root `tests/` tree, which mirrors `src/`, plus some co-located `__tests__/` folders and `*.test.ts` files.
- Node 20 LTS (`.nvmrc`); `engines` is `>=20 <23`. Run `nvm use` first.
- UI comes from the design-system barrel `@/ds` (`src/ds/`: primitives, composites, shell, icons, tokens, and `compat/` wrappers for legacy components). Navigation is `NAV_GROUPS` in `src/ds/shell/SidebarNav.tsx`.
- Toasts are `react-hot-toast`, not Sonner. Validation is Zod. There is no React Hook Form.
- No `fromDb<T>()` helper: map `snake_case` to `camelCase` by hand in each query transform.
- ESLint flat config: `no-console` is an error (`warn` and `error` allowed); `no-unused-vars`, `no-explicit-any` and `exhaustive-deps` are off, which is not licence to use `any`. `npm run lint` runs with `--max-warnings=0`.
- OpenAI and PayPal are called over plain `fetch` (`src/lib/openai.ts`, `src/lib/paypal.ts`); there is no OpenAI SDK in `package.json`.

## Commands

```bash
npm run dev             # local server on :3000
npm run lint            # eslint src --max-warnings=0
npx tsc --noEmit        # there is no typecheck script
npm test                # vitest run (coverage floors: lines 42, branches 34, functions 52)
npm run test:coverage
npm run knip            # unused files and exports
npm run build
npx supabase db push    # read Database and migrations below first
npx tsx scripts/security/assert-anon-surface.ts   # after any migration adding a table, view or SECURITY DEFINER routine
```

Operational scripts in `scripts/` are dry-run by default; a mutation only happens when the matching `RUN_<NAME>_MUTATION=true` flag is set (helpers in `src/lib/script-mutation-safety.ts` and the `src/lib/*-safety.ts` files). Keep that pattern for any new script.

## Architecture in brief

- `src/app/(authenticated)/` holds the staff pages; the layout calls `supabase.auth.getUser()` and `src/middleware.ts` guards everything outside its `PUBLIC_PATH_PREFIXES` list. Other groups: `(staff-portal)/portal`, `(timeclock)` (public kiosk), `(employee-onboarding)`, `(event-kiosk)`, `(feedback)`, `(dev)/guest-preview`.
- `src/app/actions/`: one `'use server'` file per domain. Validate with Zod, `checkUserPermission()`, call services, `logAuditEvent()` (`src/app/actions/audit.ts`), `revalidatePath()`. Return `{ success?, error?, data? }`; permission failures throw `Insufficient permissions` or `Unauthorized`, validation failures return `{ error }`.
- `src/services/`: class-based domain services. `src/lib/`: cross-cutting utilities and integration wrappers (`sms/`, `email/`, `payments/`, `table-bookings/`, `private-bookings/`, `invoices/`, `rota/`, `google-calendar*.ts`, `openai*`).
- `src/app/api/`: webhooks (`webhooks/paypal/*`, `webhooks/twilio`, `webhooks/resend`, `stripe/webhook`), crons (`cron/*`, `jobs/process`), the API the website consumes (`external/*`, `table-bookings`, `event-bookings`, `business-hours`, `menu` and others) and the endpoints behind the public token-gated pages.
- Supabase clients: `src/lib/supabase/server.ts` `createClient()` (cookie session, respects RLS) and `src/lib/supabase/admin.ts` `createAdminClient()` (service role). The admin client belongs in server actions, route handlers, crons and services only. The ESLint `no-restricted-imports` guard still names `@/lib/supabase-singleton`, a module that no longer exists, so nothing enforces this today; police it by hand.
- Permissions: `checkUserPermission(module, action, userId?)` in `src/app/actions/rbac.ts`. Module and action names are typed in `src/types/rbac.ts`; roles (`super_admin`, `manager`, `staff`) are database rows. `PermissionContext` (`src/contexts/`) seeds client components; hiding a control in the UI never replaces the server-side check.
- Dates: `src/lib/dateUtils.ts` (London hardcoded). Phones: `formatPhoneForStorage()` and `generatePhoneVariants()` in `src/lib/utils.ts`, delegating to `src/lib/phone/`.

## Domain rules

- **Group deposit: £10 per person for parties of 15 or more**, any day, any booking type. It is a PayPal deposit, NOT a credit card hold; holds were old functionality and any "credit card hold" language in code or templates is a bug. The threshold moved from 10 to 15 on 2026-08-09 because a party of ten is an ordinary family Sunday, not a risk worth putting a payment screen in front of. Single source of truth: `src/lib/table-bookings/deposit.ts`, pinned to the SQL function `resolve_table_booking_deposit` by the parity test `create-path-deposit.test.ts`. Do not duplicate the rule anywhere else.
- **Christmas bookings** (`booking_type = 'christmas'`) take a deposit at ANY party size, so a party of 6 owes £60. A manager waiver (`deposit_waived`) beats both rules.
- Events hosted by the venue itself are exceptions to deposit rules (their `deposit_amount` may be NULL).
- **Deposits are captured by PayPal and recorded on the booking itself** (`paypal_deposit_capture_id`, `deposit_amount_locked`); no `payments` row is written. Code deciding "was a deposit paid" must read the booking, not the `payments` ledger. Stripe deposits are historical only (the last was 2026-03-14); the Stripe webhook and refund paths stay for old records. Build nothing new on Stripe.
- Contracts must be generated for private bookings. Booking amendments, cancellations and deletions must track payment state correctly.
- Customer-facing language must reflect current policies, not legacy ones. Brand and operational facts (hours, menu, prices, banned claims) are owned by the website repo's `docs/SSOT.md`; check it before writing customer copy or templates.

## Integrations and external services

| Service | Used for | Where |
|---|---|---|
| Twilio | SMS and WhatsApp; inbound webhook with signature validation | `src/lib/twilio.ts`, `src/lib/sms/`, `api/webhooks/twilio` |
| Microsoft Graph | Email for Orange Jelly invoices and quotes; fallback email provider | `src/lib/microsoft-graph.ts` |
| Resend | Venue email and all B2B marketing email; delivery webhook | `src/lib/email/`, `api/webhooks/resend` |
| PayPal | Every live payment: table-booking deposits, event bookings, private bookings, parking, invoices | `src/lib/paypal.ts`; one webhook route and `PAYPAL_*_WEBHOOK_ID` per surface under `api/webhooks/paypal/*`; four reconciliation crons |
| Stripe | Historical only (see Domain rules) | `src/lib/payments/stripe.ts`, `api/stripe/webhook` |
| Google Calendar | Shared "Pub Ops" calendar: private bookings, birthdays, events, notes, recruitment slots | `src/lib/google-calendar*.ts` |
| Google Routes API | Mileage distance backfill script only | `npm run mileage:distances:routes` |
| OpenAI | Receipt parsing, recruitment sweep, event SEO and content, menu parsing | `src/lib/openai*`; per-feature `OPENAI_*_MODEL` vars |
| Cloudflare Turnstile | Bot check on public booking, enquiry, feedback and recruitment endpoints | `src/lib/turnstile.ts` |
| Upstash Redis | Distributed rate limiting for public endpoints; without it limits are per-instance memory | `src/lib/distributed-rate-limit.ts` |
| GitHub | In-app bug reporter raises issues | `src/lib/bug-reporter` |

Email transport: `EMAIL_PROVIDER` (`graph` or `resend`) wins; if unset, Resend is used when both `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are set, otherwise Graph. Marketing never falls back to Graph (it needs idempotency keys and delivery webhooks). `sendEmail(options)` in `src/lib/email/emailService.ts` takes one options object.

SMS safety (`src/lib/sms/`): idempotency claims, global and per-recipient hourly and daily limits, quiet hours 21:00 to 09:00 London, and the kill switches `SUSPEND_ALL_SMS`, `SUSPEND_EVENT_SMS`, `SUSPEND_ALL_COMMS`. Never bypass these to get a message out. Treat every local run as production-capable: those flags are the only guard between a script and a customer's phone.

## Scheduled jobs

`vercel.json` is the source of truth for crons; do not trust any list in docs. Counts drift (54 schedules against 56 route folders on 2026-09-04, three folders unscheduled; details in `docs/agent-reference.md`). Every cron route authenticates through `src/lib/cron-auth.ts` (`Authorization: Bearer CRON_SECRET`; `CRON_SECRET` is mandatory in production). Deferred work goes through the job queue (`src/lib/background-jobs.ts`, drained by `/api/jobs/process`). Writes made by webhooks and crons are attributed to `SYSTEM_USER_ID` (nil UUID by default). Cron failures email `CRON_ALERT_EMAIL` when it is set.

## Environment variables

`.env.example` documents 98 names, grouped and commented; read it before adding anything. Required at boot (`src/lib/env.ts`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`. Everything else is optional at boot but required for its feature. About 50 further names are read in code but missing from `.env.example` (token secrets, WhatsApp, per-feature OpenAI models, script limits); the list is in `docs/agent-reference.md`. Token secrets fall back to other secrets when unset (`PRIVATE_BOOKING_TOKEN_SECRET` to `CRON_SECRET`; `CALENDAR_TOKEN_SECRET` and `OPEN_SHIFT_REQUEST_TOKEN_SECRET` to the service role key), so rotating those invalidates issued tokens.

## Security rules

- **Anon access fails closed.** Since migration `20260828120356`, new objects in `public` no longer inherit access for the `anon` role (the public browser key). A new table or view the website must read needs its own `GRANT SELECT ... TO anon` in the same migration, otherwise it fails with a 401. A `CREATE OR REPLACE` of an anon-callable RPC must re-issue its `GRANT EXECUTE ... TO anon` in the same migration. An event trigger strips the built-in `PUBLIC` EXECUTE grant from any new or newly `SECURITY DEFINER` routine in `public` (because `ALTER DEFAULT PRIVILEGES` cannot); a deliberate grant issued after the `CREATE` still wins. The twelve tables the site reads are listed in `public.v_anon_surface_report`. After any migration that adds a table, a view or a SECURITY DEFINER routine, run `npx tsx scripts/security/assert-anon-surface.ts`: read-only, non-zero on regression, and it checks both directions (nothing newly exposed, the website's own access intact).
- `/api` is public at the middleware level, so every route handler does its own auth: session, API key (`src/lib/api/auth.ts`, hashed keys in `api_keys` with per-key rate limits), cron bearer, webhook signature, or a signed token. Public endpoints must write with the admin client: the private-booking enquiry endpoint went dead when a route kept using the session client after anon EXECUTE was revoked (commits `80257c0f`, `df47a5ca`).
- Public pages are the `PUBLIC_PATH_PREFIXES` list in `src/middleware.ts` (`/table-booking`, `/parking/guest`, `/timeclock`, `/invoice-portal`, `/recruitment/book`, `/g`, `/r`, `/m`, `/legacy-link` and others). Scope a new public page to its own prefix so the staff pages beside it stay protected.
- Turnstile verification is skipped when `TURNSTILE_SECRET_KEY` is unset (dev and test), so production must always have it. Our own outages must never be reported to the customer as a failed bot check (commit `78553a9d`).
- The CSP in `next.config.mjs` allows only PayPal and Supabase as third parties; a new external script or connection needs a CSP change or it is blocked silently.

## Database and migrations

- `supabase/migrations/` holds 661 files: the squashed baseline `20251123120000_squashed.sql`, `*_remote_placeholder.sql` files mirroring production's `schema_migrations` history (keep them), and real migrations after that. A new migration needs a timestamp newer than the latest applied one (`supabase/migrations/README.md`). Pre-squash SQL is in `supabase/migrations-archive/`.
- Anything destined for production goes through the `prod-migrate` skill; drafting and reviewing are separate from applying, and applying needs the owner's explicit go-ahead every time.
- Query the live schema and check dependent views before touching a table (workspace rule); views freeze their column lists.

## Known gotchas (each has bitten us)

- **Dead duplicate `*Client.tsx` files.** Several sections have a stale copy. Before fixing or testing a component, confirm which file the route's `page.tsx` actually imports; fixes and tests have repeatedly landed on the dead copy.
- **Reading the `payments` ledger for deposits** misses every PayPal deposit (see Domain rules).
- **Production webpack cache is disabled** in `next.config.mjs` because builds intermittently emitted server chunks with stale paths. Do not re-enable it for speed.
- **Assets read from `public/` at runtime** need an `outputFileTracingIncludes` entry in `next.config.mjs` (the recruitment PDFs do this for the logo) or the serverless bundle ships without them.
- **Vitest runs in `Europe/London`.** Assertions built from host-local dates pass in London and fail elsewhere; build them with `dateUtils`.
- **`tasks/lessons.md`** holds the rest (verify the day of the week before any customer message, serialise provider errors field by field, keep audit-log writers aligned with `audit_logs`, grep `tests/` too when deleting a module). Read it at session start.
- **Test against reality.** Do not assume code is correct because it exists; trace the actual logic, and check Supabase logs, Vercel deployment logs and the browser console before diagnosing.

## Receipt operations

Before any `/receipts` work, read `/Users/peterpitcher/Documents/Codex/2026-08-18/i-w/outputs/receipt-runbook.md` and `/Users/peterpitcher/Documents/Codex/2026-08-18/i-w/outputs/vendor-login-index.md`. Update both after every receipt run with confirmed URLs, usernames and account labels, MFA requirements, matching rules and blockers. Never store passwords, password fragments, recovery answers or one-time codes; keep credentials in Chrome Password Manager. During every run, also review and update the runbook's VAT recovery watchlist: compare each vendor with its past VAT treatment and record any unusual missing VAT, rate change, refund, credit note or overseas reverse-charge issue.

## Domains

`management.orangejelly.co.uk` (the app); `l.the-anchor.pub` and `the-anchor.pub/l/:code` (short links, served by `/api/redirect`); `vip-club.uk` (legacy short-link domain being retired, shows the `/legacy-link` interstitial). Rewrites live in `vercel.json`.

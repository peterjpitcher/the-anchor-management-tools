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
- Styling uses the design tokens in `src/app/globals.css` (`@theme static`). The rules are in `docs/standards/UI_UX.md` and every token shows live at `/settings/design-system`. The guard `tests/guards/design-tokens.test.ts` fails on new raw Tailwind colours, hex, pixel text sizes, off-scale radii or shadows and `dark:` classes (light theme only). Emails and PDFs take their colours from `src/lib/brand/palette.ts` (`STAFF` for Orange Jelly and staff, `GUEST` for guest-facing Anchor comms). Every downloadable document carries a logo (owner decision, 5 October 2026): Orange Jelly documents take the wordmark from `getDocumentLogoDataUri()` in `src/lib/pdf/document-logo.ts`, venue documents take The Anchor mark from `getAnchorLogoDataUri()` in `src/lib/pdf/anchor-logo.ts`. Which brand a document belongs to is listed in `docs/design/brief-orange-jelly.md` and `docs/design/brief-the-anchor.md`; a document that already carries The Anchor logo keeps it. Look at a rendered page before shipping a logo change: pdfkit and Chromium do not draw the same PNG the same way.
- Toasts are `react-hot-toast`, not Sonner. Validation is Zod. There is no React Hook Form.
- No `fromDb<T>()` helper: map `snake_case` to `camelCase` by hand in each query transform.
- ESLint flat config: `no-console` is an error (`warn` and `error` allowed); `no-unused-vars`, `no-explicit-any` and `exhaustive-deps` are off, which is not licence to use `any`. `npm run lint` runs with `--max-warnings=0`.
- OpenAI and PayPal are called over plain `fetch` (`src/lib/openai.ts`, `src/lib/paypal.ts`); there is no OpenAI SDK in `package.json`.

## Commands

```bash
npm run dev             # local server on :3000
npm run lint            # eslint src --max-warnings=0
npx tsc --noEmit        # app code only (tsconfig.json excludes tests/ and *.test.ts); no npm script
npm run typecheck:tests # tests/ plus co-located src/**/*.test.ts (tsconfig.tests.json); CI runs both
npm test                # vitest run (coverage floors: lines 42, branches 34, functions 52)
npm run test:coverage
npm run test:pg         # every scripts/testing/*-postgres.py harness on a throwaway local Postgres (PG_BIN, default Homebrew); CI runs it on 15
npm run knip            # unused files and exports
npm run build
npx supabase db push    # read Database and migrations below first
npx tsx scripts/security/assert-anon-surface.ts   # after any migration adding a table, view or SECURITY DEFINER routine
```

Operational scripts in `scripts/` are dry-run by default; a mutation only happens when the matching `RUN_<NAME>_MUTATION=true` flag is set (helpers in `src/lib/script-mutation-safety.ts` and the `src/lib/*-safety.ts` files). Keep that pattern for any new script.

Builds: a cold `next build` outruns Node's default heap on this machine and dies in the type-check phase, so run it locally as `NODE_OPTIONS=--max-old-space-size=8192 npm run build` (deliberately not in the `build` script, which Vercel also runs). Before calling a build green ahead of a deploy, run it uncached (`rm -rf .next` and the `*.tsbuildinfo` files first): incremental caches have carried a pre-edit clean result forward and Vercel then failed on a real type error a subagent had already flagged. Capture the exit code before piping output anywhere (`npm run build > build.log 2>&1; echo $?`): `$?` after a pipe belongs to `tail`, and an out-of-memory build once read as a pass. Never run a production build against the `.next` folder of a running dev server, and stop duplicate dev servers before moving that folder aside.

Deploying: this app auto-deploys `main` on Vercel; the website (`OJ-The-Anchor.pub`) was a manual production deploy by the owner (recorded 12 June 2026), so a push there is not a release. Either way, "live" means the `deploy-verify` skill has shown a new Ready deployment at the pushed commit.

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
- **Signatures and agreements go through the shared signing feature** (`src/lib/signing/`). Anything a person must sign, accept or acknowledge (staff, customer, client or supplier) is a kind in `src/lib/signing/kinds.ts`: it is sent with `createSigningRequest`, shown on the record with `SignaturePanel` (`src/components/features/signing/`), and signed at `/sign/<token>`, in the staff portal or in person on a venue device. Never build a one-off agree box, a hand-set "signed" flag or a new signed-at column. A new document type means a new kind in the registry, a completion hook, a template (or a generator) and its tests; `tests/guards/signing.test.ts` fails on a kind that is incomplete and on any signature field outside the feature. Signed copies and the evidence trail (`signing_events`, append-only) are never edited or deleted; a change means a new version, which replaces the old one once it is signed. New template wording ships switched off and cannot be sent until the owner has filled every `[[TO CONFIRM: ...]]` gap and switched it on in Settings, Signing templates. Exceptions: table booking deposits and event tickets (paying is the agreement) and anything that needs a witness. Owner decision, 12 October 2026. One further exception: a private booking contract the customer accepted on paper or in writing is recorded by staff through `recordContractAcceptedAnotherWay` (`src/app/actions/signing-bookings.ts`), with a note of where the evidence is kept, and in no other way (owner decision, 13 October 2026).
- Contracts must be generated for private bookings. Booking amendments, cancellations and deletions must track payment state correctly.
- Customer-facing language must reflect current policies, not legacy ones. Brand and operational facts (hours, menu, prices, banned claims) are owned by the website repo's `docs/SSOT.md`; check it before writing customer copy or templates.
- **Menu, dish and event names are a load-bearing interface.** The website matches dishes by regex on the name (the fish and chips page, its structured data and the gluten guards all broke when "Fish & Chips" was renamed in the database on 28 July 2026, and the half portion became the headline product). Before renaming anything customer-facing in the database: grep both repositories for the old name and for matchers over `item.name`; deploy the consuming code first, then change the data; then re-fetch the live pages and their JSON-LD. Match on an id or a shape rather than a display string where you can.
- An event's capacity comes from its live record and booking snapshot, never from a report or a genre example.
- OJ Projects: a client's recurring charges (OJ Projects, Clients, View, Recurring Charges) are not recurring invoice templates; check which one a question is about before giving instructions.
- Mileage: no reimbursement for 2024 onwards had been paid as of 15 September 2026, and drivers are included in the first report (owner decisions, 15 September 2026). Keep any percentage-based historical allocation separate from verified journey-level driver attribution.

## Customer-facing copy

- Verify the day of the week programmatically before any message that names one; 32 SMS went out on 20 April 2026 saying Thursday for a Friday.
- Never hang an exception off a day. Say what each day is ("from midday Tuesday to Sunday and from 4pm on Mondays"), and do not paraphrase in prose an hours table in the same email. `findVenueClosureClaims` (`src/lib/email/marketing/venueClosureClaims.ts`) warns in the campaign UI and refuses at `scheduleCampaign`; it is deliberately not in `validateMarketingContent`, which re-runs before every send and would kill a campaign approved last month.
- Accuracy is the floor. A marketing paragraph gives the reader something to feel and a picture, not a stock-take of our nights and sittings. Operational facts go in a table and the warmth in the prose beside it; times, prices and hours are never warmed. After fact-checking, read the copy once as a hurried reader will take it.
- The Anchor is a Greene King tenanted pub; never describe it as independent. Use neutral venue wording unless ownership is relevant.
- The venue does have gluten-free options: keep platform-controlled dietary attributes such as OpenTable's `Gluten-free Options`. In our own copy say NGCI with the cross-contamination caveat (the website's `docs/SSOT.md`). Never remove a venue capability on a wording distinction alone.
- Before calling two scheduled sends a clash, read the rule that decides it: round-ups carry `ignores_frequency_cap`, so they neither block nor are blocked, and the SMS promotion limits count only `PROMOTIONAL_SMS_TEMPLATE_KEYS`. Say which rule you checked.

## Integrations and external services

| Service | Used for | Where |
|---|---|---|
| Twilio | SMS and WhatsApp; inbound webhook with signature validation | `src/lib/twilio.ts`, `src/lib/sms/`, `api/webhooks/twilio` |
| Microsoft Graph | Email transport for Orange Jelly invoices, receipts and quotes | `src/lib/microsoft-graph.ts` |
| Resend | Venue email and all B2B marketing email; delivery webhook | `src/lib/email/`, `api/webhooks/resend` |
| PayPal | Every live payment: table-booking deposits, event bookings, private bookings, parking, invoices | `src/lib/paypal.ts`; **ONE webhook, `api/webhooks/paypal`**. PayPal fans every event on the app out to every registered URL and cannot scope a registration to a subset of transactions, so a webhook per domain was five copies of one feed and no endpoint could tell whose event it had. Everything runs `src/lib/paypal-webhook-dispatch.ts`: verify, claim under the single `webhook:paypal:<eventId>` namespace, route on the payload via `src/lib/paypal-webhook-router.ts`, then call the domain handler in `src/lib/paypal-domains/`. An event we cannot place is logged `unrouted` and acknowledged, never 500. The per-domain URLs still exist as thin wrappers so old registrations keep working; delete them once nothing is registered against them. Webhook ids resolve from PayPal by URL, with `PAYPAL_*_WEBHOOK_ID` an emergency override for a registry outage only. Four reconciliation crons plus the daily `api/cron/paypal-webhook-health` check. |
| Stripe | Historical only (see Domain rules) | `src/lib/payments/stripe.ts`, `api/stripe/webhook` |
| Google Calendar | Shared "Pub Ops" calendar: private bookings, birthdays, events, notes, recruitment slots | `src/lib/google-calendar*.ts` |
| Google Routes API | Mileage distance backfill script only | `npm run mileage:distances:routes` |
| OpenAI | Receipt parsing, recruitment sweep, event SEO and content, menu parsing | `src/lib/openai*`; per-feature `OPENAI_*_MODEL` vars |
| Cloudflare Turnstile | Bot check on public booking, enquiry, feedback and recruitment endpoints | `src/lib/turnstile.ts` |
| Upstash Redis | Distributed rate limiting for public endpoints; without it limits are per-instance memory | `src/lib/distributed-rate-limit.ts` |
| GitHub | In-app bug reporter raises issues | `src/lib/bug-reporter` |

Email transport: **one provider per send, and no fallback.** `sendEmail` picks Graph or Resend once and stays with it; if that provider fails, the send fails, and nothing retries on the other. `EMAIL_PROVIDER` (`graph` or `resend`) wins; if unset, Resend is used when both `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are set, otherwise Graph. A caller may pin a provider per send: marketing pins Resend, because it needs idempotency keys and delivery webhooks that Graph does not give us. `sendEmail(options)` in `src/lib/email/emailService.ts` takes one options object.

Invoices, receipts and quotes go out as Orange Jelly Limited, never as the venue (owner decision, 28 August 2026). `src/lib/email/invoice-sender.ts` resolves that identity; see `INVOICE_EMAIL_FROM_ADDRESS` in `.env.example`. A route test of that mailbox goes to one outside address with no copies and says which copy to press Reply on; the app's permission can send but not read, so report the reply address as unchecked rather than implied. A test email shows only what a real customer in that position would get, or labels the optional part.

SMS safety (`src/lib/sms/`): idempotency claims, global and per-recipient hourly and daily limits, and quiet hours 21:00 to 09:00 London. Kill switches are read at send time and are off unless set to `true`:

- `SUSPEND_ALL_SMS` stops every SMS and WhatsApp message. Email still sends.
- `SUSPEND_EVENT_SMS` stops SMS carrying an event, event booking or table booking id, or a key starting `event_` (plus `table_review_followup`). Private booking SMS and email still send.
- `SUSPEND_ALL_EMAIL` (`src/lib/email/suspension.ts`) stops every email through `sendEmail`: guest, staff, invoices, cron alerts and marketing. It returns `code: 'email_suspended'`. `notifyCustomer` then falls back to SMS, where the hourly limits throttle the surge; the marketing cron holds its queue rather than failing recipients; every other sender sees an ordinary failed send.
- `SUSPEND_ALL_COMMS` stops all three: SMS, WhatsApp and email.

Never bypass these to get a message out. Treat every local run as production-capable: those flags are the only guard between a script and a customer's phone or inbox.

## Scheduled jobs

`vercel.json` is the source of truth for crons; do not trust any list in docs. Counts drift (54 schedules against 56 route folders on 2026-09-04, three folders unscheduled; details in `docs/agent-reference.md`). Every cron route authenticates through `src/lib/cron-auth.ts` (`Authorization: Bearer CRON_SECRET`; `CRON_SECRET` is mandatory in production). Deferred work goes through the job queue (`src/lib/background-jobs.ts`, drained by `/api/jobs/process`). Writes made by webhooks and crons are attributed to `SYSTEM_USER_ID` (nil UUID by default). Cron failures email `CRON_ALERT_EMAIL` when it is set.

## Environment variables

`.env.example` documents 98 names, grouped and commented; read it before adding anything. Required at boot (`src/lib/env.ts`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`. Everything else is optional at boot but required for its feature. About 50 further names are read in code but missing from `.env.example` (token secrets, WhatsApp, per-feature OpenAI models, script limits); the list is in `docs/agent-reference.md`. Token secrets fall back to other secrets when unset (`PRIVATE_BOOKING_TOKEN_SECRET` to `CRON_SECRET`; `CALENDAR_TOKEN_SECRET` and `OPEN_SHIFT_REQUEST_TOKEN_SECRET` to the service role key), so rotating those invalidates issued tokens.

## Security rules

- **Anon access fails closed.** Since migration `20260828120356`, new objects in `public` no longer inherit access for the `anon` role (the public browser key). A new table or view that anon must read needs its own `GRANT SELECT ... TO anon` in the same migration, otherwise it fails with a 401. A `CREATE OR REPLACE` of an anon-callable RPC must re-issue its `GRANT EXECUTE ... TO anon` in the same migration. Since migration `20260929120545`, a new function no longer gets the built-in `PUBLIC` EXECUTE grant either (the global `ALTER DEFAULT PRIVILEGES` form; the per-schema form in `20260828120356` could not remove it), so a new function anon must call, or one that is dropped and recreated, needs its own `GRANT EXECUTE ... TO anon` in the same migration. authenticated and service_role still get EXECUTE on new functions in `public` by default. The event trigger from `20260828120356` still strips `PUBLIC` and `anon` from any new or newly `SECURITY DEFINER` routine in `public`; a deliberate grant issued after the `CREATE` still wins. The public website (OJ-The-Anchor.pub) does not read this database with the anon key: it has no Supabase client, never has in its git history, and goes through this app's API as the service role (checked 29 September 2026). `public.v_anon_surface_report` still checks that the twelve tables and three functions it lists as the website's keep their anon grants; no known client reads them with the anon key, and revoking them is a separate decision. After any migration that adds a table, a view or a SECURITY DEFINER routine, run `npx tsx scripts/security/assert-anon-surface.ts`: read-only, non-zero on regression, and it checks both directions (nothing newly exposed, and those twelve tables and three functions still reachable).
- `/api` is public at the middleware level, so every route handler does its own auth: session, API key (`src/lib/api/auth.ts`, hashed keys in `api_keys` with per-key rate limits), cron bearer, webhook signature, or a signed token. Public endpoints must write with the admin client: the private-booking enquiry endpoint went dead when a route kept using the session client after anon EXECUTE was revoked (commits `80257c0f`, `df47a5ca`).
- Public pages are the `PUBLIC_PATH_PREFIXES` list in `src/middleware.ts` (`/table-booking`, `/parking/guest`, `/timeclock`, `/invoice-portal`, `/recruitment/book`, `/sign`, `/g`, `/r`, `/m`, `/legacy-link` and others). Scope a new public page to its own prefix so the staff pages beside it stay protected.
- Turnstile verification is skipped when `TURNSTILE_SECRET_KEY` is unset (dev and test), so production must always have it. Our own outages must never be reported to the customer as a failed bot check (commit `78553a9d`).
- A `CREATE OR REPLACE` of a SECURITY DEFINER function restates `SECURITY DEFINER`, `SET search_path` and its grants, derived from `pg_get_functiondef()`, not from an older migration file; a bare replace silently cleared the pin twice here (`20260817150000`, then `20260913101708`, restored by `20260913110102`) and nothing failed. After applying, the proconfig-null count in the workspace Supabase rule must return 0. A revoke from `anon, authenticated` leaves a grant made to PUBLIC in place: check with `has_table_privilege` and revoke from `public` first.
- The CSP in `next.config.mjs` allows only PayPal and Supabase as third parties; a new external script or connection needs a CSP change or it is blocked silently.

## Database and migrations

- `supabase/migrations/` holds 661 files: the squashed baseline `20251123120000_squashed.sql`, `*_remote_placeholder.sql` files mirroring production's `schema_migrations` history (keep them), and real migrations after that. A new migration needs a timestamp newer than the latest applied one (`supabase/migrations/README.md`). Pre-squash SQL is in `supabase/migrations-archive/`.
- Anything destined for production goes through the `prod-migrate` skill; drafting and reviewing are separate from applying, and applying needs the owner's explicit go-ahead every time.
- Query the live schema and check dependent views before touching a table (workspace rule); views freeze their column lists.
- Regenerate `src/types/database.generated.ts` in the same change as a migration (`npx supabase gen types typescript --project-id tfcasgxopxegwrabvwat --schema public`). The guard `tests/guards/query-columns.test.ts` checks every column a `.from('<table>')` query filters on, selects or writes against that file, so a column the table lacks fails the suite instead of returning a 400 in production, and so do stale types.
- The Postgres traps that have bitten this repo are listed in the workspace rule `.claude/rules/supabase.md`: `db push --dry-run` runs nothing (validate inside `BEGIN ... ROLLBACK`; a column named `window` passed the dry run and would have failed the push), `CREATE OR REPLACE` clears `search_path`, PUBLIC grants survive a revoke from named roles, functions do not block a DROP, `RETURN QUERY` needs casts, and a CHECK passes on NULL. Smoke-test every new function with a real `select` after applying.

## Known gotchas (each has bitten us)

- **Dead duplicate `*Client.tsx` files.** Several sections have a stale copy. Before fixing or testing a component, confirm which file the route's `page.tsx` actually imports; fixes and tests have repeatedly landed on the dead copy.
- **The signing page never shows a contract's A4 HTML.** It links to the server-rendered PDF, because a fixed-height A4 sheet breaks under a browser's minimum font size. The same PDF is what gets fingerprinted, so what the signer reads and what is recorded are one file.
- **A signing reminder issues a new link.** Only a hash of each link is stored, so the old one cannot be re-sent; the earlier link stops working when a reminder goes out.
- **Reading the `payments` ledger for deposits** misses every PayPal deposit (see Domain rules).
- **Production webpack cache is disabled** in `next.config.mjs` because builds intermittently emitted server chunks with stale paths. Do not re-enable it for speed.
- **Assets read from `public/` at runtime** need an `outputFileTracingIncludes` entry in `next.config.mjs` (the recruitment PDFs do this for the logo) or the serverless bundle ships without them.
- **Vitest runs in `Europe/London`.** Assertions built from host-local dates pass in London and fail elsewhere; build them with `dateUtils`.
- **Views freeze their columns.** `private_bookings_with_details` has no `invoice_id`; mock rows hid it and detail-only smoke checks missed the list failure. Read invoice identity from the payments base table, and after a deploy check list pages, filters and messages as well as detail pages.
- **`rota_shifts` inflates a naive no-show count.** `status='sick'`, `status='cancelled'` and open shifts (`is_open_shift=true`, `employee_id` NULL) are not people who failed to turn up; filter to `status='scheduled' AND is_open_shift=false AND employee_id IS NOT NULL`. A figure that contradicts the owner's knowledge of his own business means the query is wrong: re-run a subagent's aggregate yourself before presenting it.
- **Multi-state RPC wrappers gate on `state`, never on payload presence.** The `customer_conflict` response carries the existing `booking_id`, and a null-check on it mutated a live booking on the first live table booking. Test the "customer already holds an active booking" path before shipping any booking flow; it is the commonest real retry.
- **A reconcile generator that deliberately leaves some items out of its desired set** (floating checklist tasks with an open instance) must skip them in its retract step too, or a re-run deletes live data. Never call a job safe to retry until a literal second run has been traced.
- **Component tests race auto-selection.** Wait for the component's own selection to land (`waitFor` on the loader call) before clicking something that changes it; anchor async assertions with `findBy*`, and scope an absence assertion inside the container that must be open. Raising a `waitFor` timeout hides the race.
- **Serialise provider errors field by field** (`code`, `message`, `details`, `hint` for Supabase; the enumerable fields for PayPal and Twilio). `JSON.stringify(error)` hides them.
- **Audit-log writers:** before touching `audit_logs` columns, grep every `from('audit_logs').insert(` and update them in the same change.
- **Deleting a module:** grep `src/`, `scripts/` and `tests/` (a test is an importer) and run `npm test`; `tsc --noEmit` skips the tests tree.
- **A styling pass that swaps a raw control for a DS component** gets a render test against the HEAD version: behaviour changes hide in that swap. Register every new token name in `cn()` (`extendTailwindMerge` in `src/lib/utils.ts`) or tailwind-merge drops it. Sidebar and brand decisions are in `docs/standards/UI_UX.md`.
- **Test against reality.** Do not assume code is correct because it exists; trace the actual logic, and check Supabase logs, Vercel deployment logs and the browser console before diagnosing.
- **`tasks/lessons.md`** holds corrections from the last month or so. Read it at session start; a lesson that has held for a month moves into this file or `docs/standards/` and leaves it.

## Specs and reviews

When the owner answers a specification review, fold the decisions into one self-contained handoff; never a review plus a separate addendum. Finding-level review checks each claim in isolation and misses one section contradicting another, so before calling a spec buildable, walk one object (an instance, a missed task, a rollback) through the whole document and check every section agrees about it.

## Receipt operations

Before any `/receipts` work, read `/Users/peterpitcher/Documents/Codex/2026-08-18/i-w/outputs/receipt-runbook.md` and `/Users/peterpitcher/Documents/Codex/2026-08-18/i-w/outputs/vendor-login-index.md`. Update both after every receipt run with confirmed URLs, usernames and account labels, MFA requirements, matching rules and blockers. Never store passwords, password fragments, recovery answers or one-time codes; keep credentials in Chrome Password Manager. During every run, also review and update the runbook's VAT recovery watchlist: compare each vendor with its past VAT treatment and record any unusual missing VAT, rate change, refund, credit note or overseas reverse-charge issue.

## Domains

`management.orangejelly.co.uk` (the app); `l.the-anchor.pub` and `the-anchor.pub/l/:code` (short links, served by `/api/redirect`); `vip-club.uk` (legacy short-link domain being retired, shows the `/legacy-link` interstitial). Rewrites live in `vercel.json`.

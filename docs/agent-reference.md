# Agent reference: Anchor Management Tools

Reference material moved out of `CLAUDE.md` on 2026-09-04 so the instruction file stays short. Nothing here is a rule; the rules are in `CLAUDE.md`. Lists and counts were verified against the repo on that date and will drift, so re-check the source named in each section before relying on a number.

## 1. Route map

### Route groups under `src/app/`

| Group | Contents |
|---|---|
| `(authenticated)/` | Staff pages: cashing-up, checklists, customers, dashboard, employees, events, expenses, feedback-inbox, invoices, marketing, menu-management, messages, mgd, mileage, oj-projects, parking, private-booking, private-bookings, profile, quotes, receipts, recruitment, roles, rota, settings, short-links, table-bookings, users, vouchers. `layout.tsx` calls `supabase.auth.getUser()` and loads permissions; `ROLE_PRIORITY` is `super_admin`, `manager`, `staff`. |
| `(staff-portal)/portal/` | Employee-only views (shifts, pay) |
| `(timeclock)/timeclock/` | Kiosk, public prefix |
| `(employee-onboarding)/onboarding/` | Onboarding flows, public prefix |
| `(event-kiosk)/events/` | Event kiosk |
| `(feedback)/feedback/` | Customer feedback, public prefix |
| `(dev)/guest-preview/` | Developer preview |
| Top-level routes | `auth`, `booking-confirmation`, `booking-portal`, `booking-success`, `error`, `g`, `invoice-portal`, `legacy-link`, `login`, `parking`, `privacy`, `r`, `recruitment`, `table-booking`, `unauthorized` |

Root `src/app/layout.tsx` holds global providers, the PWA manifest, robots blocking and service-worker registration.

### Public path prefixes (`PUBLIC_PATH_PREFIXES` in `src/middleware.ts`)

`/_next`, `/static`, `/api` (every handler does its own auth), `/auth`, `/error`, `/privacy`, `/booking-confirmation`, `/booking-portal`, `/booking-success`, `/invoice-portal` (HMAC token in the path, `src/lib/invoices/invoice-token.ts`), `/feedback`, `/table-booking`, `/parking/guest`, `/parking/payment-error`, `/onboarding`, `/recruitment/book` (token-gated slot picker), `/timeclock`, `/m`, `/g`, `/r`, `/legacy-link`. Matching is segment-bounded, so `/invoices` stays protected while `/invoice-portal` is open. The matcher excludes `_next/static`, `_next/image` and `favicon.ico`.

### API surface (`src/app/api/`)

Top-level folders: `app-version`, `boh`, `bug-report`, `business`, `business-hours`, `cashup`, `client-errors`, `cron`, `customers`, `employees`, `event-bookings`, `event-categories`, `event-waitlist`, `events`, `external` (`create-booking`, `event-bookings`, `performer-interest`, `table-bookings`), `feedback`, `foh`, `invoices`, `jobs`, `marketing`, `menu`, `menu-management`, `messages`, `oj-projects`, `outstanding-counts`, `parking`, `portal`, `private-booking-enquiry`, `private-bookings`, `public` (`private-booking`), `quotes`, `receipts`, `recruitment`, `redirect`, `rota`, `search`, `settings`, `short-links`, `stripe` (`webhook`), `table-bookings`, `unsubscribe`, `vouchers`, `webhooks`, `website` (`ui-flags`).

Webhooks: `webhooks/paypal` (root plus `event-bookings`, `table-bookings`, `invoices`, `private-bookings`, `parking`), `webhooks/resend`, `webhooks/twilio`, `stripe/webhook`.

Turnstile-checked endpoints: `event-bookings`, `table-bookings`, `feedback`, `private-booking-enquiry`, `public/private-booking`, `recruitment/applications`, `recruitment/booking/[token]` (plus `cancel` and `reschedule`).

External API auth: `src/lib/api/auth.ts` hashes keys (SHA-256) and looks them up in `api_keys` (permissions, `rate_limit`, `is_active`, `expires_at`); `checkRateLimit()` is per key.

## 2. Scheduled jobs inventory (2026-09-04)

- `vercel.json` has 54 schedules: 53 under `/api/cron/*` plus `/api/jobs/process?process=true&batch=30`, which drains the job queue.
- `src/app/api/cron/` has 56 route folders. Three have no schedule: `backfill-marketing-links`, `sunday-lunch-prep`, `sunday-preorder`.
- Every cron route authenticates with `Authorization: Bearer CRON_SECRET` through `src/lib/cron-auth.ts`. Failures email `CRON_ALERT_EMAIL` when set; run outcomes go through `src/lib/cron-run-results.ts`.
- Regenerate the comparison:

```bash
node -e 'const v=require("./vercel.json");const fs=require("fs");const dirs=fs.readdirSync("src/app/api/cron");const p=v.crons.map(c=>c.path.replace("/api/cron/",""));console.log("schedules",v.crons.length,"dirs",dirs.length);console.log("unscheduled",dirs.filter(d=>!p.includes(d)))'
```

## 3. Environment variables

### Required at boot (`src/lib/env.ts`)

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_APP_URL`, `CRON_SECRET`. The file validates with Zod and applies test defaults when `NODE_ENV=test`.

### Groups in `.env.example` (98 names)

Supabase; application URLs and contact number; SMS safety flags and guards; cron send guards; Twilio (account, phone number, messaging service, webhook auth token, `SKIP_TWILIO_SIGNATURE_VALIDATION`); `WEBHOOK_BASE_URL`; Microsoft Graph; Resend and `EMAIL_PROVIDER`; B2B marketing email (`MARKETING_*`); PayPal (client, per-surface webhook IDs, environment, public client ID); Stripe; `SYSTEM_USER_ID`; Google Calendar (OAuth or service account, `GOOGLE_CALENDAR_ID`, optional interview calendar); `GOOGLE_ROUTES_API_KEY`; Turnstile; Upstash; cron secret, digest hour and alert email; GitHub bug reporter; OpenAI (`OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_RECEIPTS_MODEL`); job queue; recipient addresses (`EVENT_CHECKLIST_EMAIL_RECIPIENT`, `ROTA_MANAGER_EMAIL`, `PAYROLL_ACCOUNTANT_EMAIL`, `OJ_PROJECTS_BILLING_ALERT_EMAIL`, `MANAGER_EMAIL`, `PRIVATE_BOOKINGS_MANAGER_EMAIL`); company identity (`COMPANY_*`, `DOCUMENT_EMAIL_SENDER`); `ROTA_FEED_SECRET`; `CORS_ALLOWED_ORIGIN`; event cross-promotion tuning.

### Read in code but absent from `.env.example` (2026-09-04)

Feature configuration: `CALENDAR_TOKEN_SECRET`, `OPEN_SHIFT_REQUEST_TOKEN_SECRET`, `PRIVATE_BOOKING_TOKEN_SECRET`, `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, `TWILIO_WHATSAPP_FROM`, `TWILIO_WHATSAPP_APPROVED_TEMPLATE_KEYS`, `PAYPAL_EVENT_BOOKINGS_WEBHOOK_ID`, `PAYPAL_INVOICES_WEBHOOK_ID`, `OPENAI_EVENTS_MODEL`, `OPENAI_EVENT_CONTENT_MODEL`, `OPENAI_EVENT_SEO_MODEL`, `OPENAI_RECRUITMENT_MODEL`, `GOOGLE_CALENDAR_ROTA_ID`, `GOOGLE_CALENDAR_IMPERSONATE_EMAIL`, `CHECKLIST_MANAGER_EMAIL`, `CHECKLIST_SYSTEM_EMAIL`, `COMMS_ALERT_EMAIL`, `COMMS_EXPECT_RESEND_INBOUND`, `COMMUNICATION_CAPTURE_BODY_MEDIA_ENABLED`, `EVENT_TICKET_TYPES_ENABLED`, `INVOICE_REMITTANCE_TEST_RECIPIENT`, `RECRUITMENT_FROM_EMAIL`, `RECRUITMENT_NOTIFICATION_EMAIL`, `RECRUITMENT_RETENTION_MONTHS`, `PRIVATE_BOOKINGS_WEEKLY_DIGEST_HOUR_LONDON`, `SHORT_LINK_ALLOWED_HOSTS`, `SHORT_LINK_ALLOWED_DESTINATION_HOSTS`, `SUSPEND_ALL_COMMS`, `JOB_QUEUE_HEARTBEAT_MS`, `JOB_QUEUE_LEASE_SECONDS`, `JOB_QUEUE_TIMEOUT_MS`.

Script-only flags (dry-run and limit controls): `ALLOW_*_SCRIPT`, `ALLOW_*_MUTATION`, `ALLOW_JOB_RETRY_SEND_TYPES`, `ALLOW_PROCESS_JOBS_SEND_TYPES`, `RUN_*_MUTATION`, `*_LIMIT`, `FEB_REVIEW_SMS_SEND_LIMIT`, plus the `TEST_*` and `RUN_TEST_*` names read by the manual test scripts.

Regenerate: collect `process.env.X` names from `src/` with `grep -rhoE "process\.env\.[A-Z0-9_]+" src | sort -u` and diff against the `NAME=` lines in `.env.example`.

### Fallback chains

- `PRIVATE_BOOKING_TOKEN_SECRET`, then `CRON_SECRET`, then the literal `'dev-secret'` (`src/lib/invoices/invoice-token.ts`).
- `CALENDAR_TOKEN_SECRET`, then `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/portal/calendar-token.ts`).
- `OPEN_SHIFT_REQUEST_TOKEN_SECRET`, then `CALENDAR_TOKEN_SECRET`, then `SUPABASE_SERVICE_ROLE_KEY` (`src/lib/rota/open-shift-request-token.ts`).
- `ROTA_FEED_SECRET`, then SHA-256 of `SUPABASE_SERVICE_ROLE_KEY` (per `.env.example`).
- Email provider: `EMAIL_PROVIDER` if set to `graph` or `resend`; otherwise Resend when both `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` are set; otherwise Graph (`src/lib/email/emailService.ts`).

## 4. RBAC lists (`src/types/rbac.ts`)

Modules: `dashboard`, `events`, `performers`, `customers`, `employees`, `messages`, `sms_health`, `settings`, `reports`, `users`, `roles`, `private_bookings`, `table_bookings`, `invoices`, `oj_projects`, `receipts`, `loyalty`, `quotes`, `parking`, `short_links`, `feedback`, `menu_management`, `cashing_up`, `rota`, `leave`, `timeclock`, `payroll`, `recruitment`, `mileage`, `expenses`, `mgd`, `checklists`, `vouchers`, `marketing` (B2B marketing email; deliberately its own module because `messages.send_marketing` means bulk SMS).

Actions: `view`, `create`, `edit`, `delete`, `export`, `manage`, `send`, `convert`, `view_documents`, `upload_documents`, `delete_documents`, `view_templates`, `manage_templates`, `manage_roles`, `view_pricing`, `manage_deposits`, `view_vendor_costs`, `manage_spaces`, `manage_catering`, `manage_vendors`, `generate_contracts`, `gm_override`, `view_sensitive`, `view_sms_queue`, `approve_sms`, `enroll`, `redeem`, `refund`, `submit`, `approve`, `lock`, `unlock`, `publish`, `request`, `clock`, `view_contact_preferences`, `manage_contact_preferences`, `manage_whatsapp_opt_in`, `record_service_contact`, `send_transactional`, `send_marketing`, `view_consent_audit`, `export_consent_audit`.

Roles are rows in `roles` (`super_admin`, `manager`, `staff`). `checkUserPermission(module, action, userId?)` lives in `src/app/actions/rbac.ts`; `PermissionContext` (`src/contexts/PermissionContext.tsx`) is seeded from the authenticated layout so client components can show or hide controls without extra round trips.

## 5. Dependency inventory (`package.json`, 2026-09-04)

- Framework and tooling: `next ^15.5.14`, `react ^19.1.0`, `typescript ^5.8.3`, `eslint ^9.39.2` with `eslint-config-next 15.5.9`, `vitest ^4.0.17` with `@vitejs/plugin-react`, `@vitest/coverage-v8`, `jsdom ^25`, `@testing-library/react ^16`, `@testing-library/user-event`, `@testing-library/jest-dom`, `tsx ^4.21`, `knip ^6`, `patch-package ^8` (postinstall, patches in `patches/`), `supabase ^2.109` (CLI), `dotenv`.
- Styling and UI: `tailwindcss ^4.3` via `@tailwindcss/postcss`, `tailwind-merge`, `clsx`, `@headlessui/react`, `lucide-react`, `@heroicons/react`, `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, `react-hot-toast`, `recharts`, `qrcode`.
- Data and validation: `@supabase/supabase-js ^2.55`, `@supabase/ssr ^0.10`, `zod ^3.25`, `date-fns ^4` with `date-fns-tz ^3`, `libphonenumber-js`, `server-only`.
- Documents and files: `pdfkit`, `pdf-lib`, `pdf2json`, `puppeteer` with `@sparticuz/chromium` (headless PDF), `exceljs`, `archiver`, `jszip`, `papaparse`, `mammoth`, `word-extractor`, `officeparser`, `sharp`.
- Integrations: `twilio ^5.10`, `resend ^6.12`, `@microsoft/microsoft-graph-client` with `@azure/identity`, `googleapis ^171` with `google-auth-library`, `@paypal/react-paypal-js` (client-side buttons only; server calls are plain REST in `src/lib/paypal.ts`), `@upstash/ratelimit` with `@upstash/redis`, `@vercel/functions`. OpenAI is called with `fetch` from `src/lib/openai.ts`; there is no `openai` package.
- Not dependencies, despite older notes: `react-hook-form`, `@hookform/resolvers`, `tailwindcss-animate`, `pdfjs-dist`, `franc`, `@zxing/*`, `openai`. `@napi-rs/canvas` appears only as a webpack external in `next.config.mjs`.
- Configuration files: `next.config.mjs` (security headers and CSP, `/rota/print` redirect, `serverExternalPackages`, 20 MB server-action body limit, webpack cache disabled in production, `outputFileTracingIncludes` for the recruitment PDF logo), `postcss.config.mjs`, `vitest.config.ts` and `vitest.setup.ts`, `eslint.config.js`, `knip.json`, `components.json`, `tsconfig.json` (`@/*` maps to `./src/*`), `.nvmrc` (20), `vercel.json` (crons and rewrites), `.claude/launch.json` (dev, start and test launch configs).

## 6. Naming and code conventions (observed)

- Files: `page.tsx` for routes; components `PascalCase.tsx` (`MileageClient.tsx`); server-action and library files `camelCase.ts` or `kebab-case.ts` (`employeeDetails.ts`, `audit-helpers.ts`); tests in `tests/` mirroring `src/`, or co-located as `__tests__/x.test.ts` or `x.test.ts`.
- Identifiers: exported actions and helpers `camelCase`; constants `SCREAMING_SNAKE_CASE`; Zod schemas `camelCase` with a `Schema` suffix; interfaces and type aliases `PascalCase`, named exports.
- Data: DB columns `snake_case`; TypeScript `camelCase` with manual field-by-field mapping in query transforms; no generic `fromDb<T>()` helper.
- Style: single quotes, two-space indent, semicolons mostly absent (some legacy files keep them); no Prettier config; ESLint flat config extends `next/core-web-vitals` and `next/typescript`. `no-console` is an error (`warn` and `error` allowed; off under `src/scripts/**`). `@typescript-eslint/no-unused-vars`, `@typescript-eslint/no-explicit-any`, `react-hooks/exhaustive-deps` and `@next/next/no-img-element` are off. `src/components/**` may not import `@/lib/supabase-singleton`, a path that no longer exists.
- Error handling in actions: permission failures throw `Error('Insufficient permissions')` or `Error('Unauthorized')` inside the permission helper (about 160 call sites); validation failures return `{ error: parsed.error.issues[0]?.message }` without throwing; DB errors are thrown and caught by the outer `try/catch`, which extracts `error instanceof Error ? error.message : 'Fallback message'`. Service-layer functions may throw for the caller to handle.
- Components: server components by default; `'use client'` only for interactivity, hooks and browser APIs; data passed down as props; everything imported from `@/ds`; Tailwind classes only, no inline hex, no dynamic class construction.
- Modules: named exports everywhere; default exports only for Next.js pages and layouts; `src/ds/index.ts` is the one barrel; services and actions are imported from their specific files.
- Dates: `src/lib/dateUtils.ts` (`getTodayIsoDate()`, `toLocalIsoDate()`, `formatDateInLondon()` and friends), `Europe/London` hardcoded.
- Phones: `formatPhoneForStorage()` (E.164) and `generatePhoneVariants()` (search matching) in `src/lib/utils.ts`, delegating to `src/lib/phone/`.

## 7. Architecture layers

| Layer | Location | Contains | Depends on |
|---|---|---|---|
| UI | `src/app/(authenticated)/**`, `src/components/`, `src/ds/` | Server Components (pages, layouts), Client Components (`*Client.tsx`), modals | Server actions, contexts, hooks |
| Server actions | `src/app/actions/` (one file per domain, `oj-projects/` sub-folder) | `'use server'` functions: validate, check permission, call services, audit, revalidate | Services, lib, Supabase clients |
| Services | `src/services/` | Class-based domain services (`CustomerService`, `EmployeeService`, `PrivateBookingService`) querying Supabase directly, no HTTP | Supabase clients, lib, types |
| Lib | `src/lib/` (169 entries: flat utilities plus domain folders) | Supabase clients, email, SMS, PDF, dates, validation, payments, OpenAI, rate limiting, script safety helpers | External services |
| API | `src/app/api/` | Webhooks, crons, job queue, external and public endpoints | Services, lib |
| Types | `src/types/` | `database.ts`, `database.generated.ts`, `rbac.ts`, domain types | Nothing |

Data flow: server state via Supabase and the Next.js cache (`unstable_cache`, `revalidatePath`, `revalidateTag`, used in about 34 files); client state via React Context only (`PermissionContext`); no Redux or Zustand. Error handling: actions return `{ error }` for expected failures and throw for unexpected ones; `src/lib/errors.ts` (typed helpers), `src/lib/dbErrorHandler.ts` (normalises Supabase errors), `src/lib/retry.ts` (SMS and email), `src/lib/supabase-retry.ts`; `error.tsx` per route group. Domain logic that does not fit a service lives in `src/lib/<domain>/` (`rota/`, `mileage/`, `private-bookings/`, `invoices/`, `menu/`, `table-bookings/`, `events/`, `short-links/`).

## 8. Data conventions

- Server-action body limit: 20 MB (`next.config.mjs`, for uploads).
- Dashboard data: `loadDashboardSnapshot()` in `src/app/(authenticated)/dashboard/dashboard-data.ts`.
- UK bank-holiday dates: `buildConfirmedUKDates()` in `src/app/actions/calendar-notes.ts`.
- Heavy server libraries are listed in `serverExternalPackages` (`exceljs`, `pdfkit`, `puppeteer`, `googleapis`, `officeparser`, `pdf-lib` and their transitive proxy packages) so they are not bundled.
- The Supabase Storage public bucket host is allow-listed under `images.remotePatterns`.
- Audit log: `logAuditEvent(params)` in `src/app/actions/audit.ts` writes to `audit_logs`; keep writers aligned with its columns (see `tasks/lessons.md`).

## 9. Scripts and one-off operations

- `scripts/` holds around 240 TypeScript, JavaScript and SQL scripts (`scripts/README.md`). Run TypeScript ones with `npx tsx --tsconfig tsconfig.json scripts/<name>.ts`.
- Extra package scripts: `backfill:birthdays`, `mileage:distances:routes` (Google Routes API; `--plan-only`, `--confirm`, `RUN_MILEAGE_DISTANCE_BACKFILL_MUTATION`, `ALLOW_MILEAGE_DISTANCE_BACKFILL_MUTATION_SCRIPT`), `eval:seo`, `knip`, `test:coverage`.
- Mutation safety: `src/lib/script-mutation-safety.ts` provides `assertScriptMutationAllowed`, `assertScriptExpectedRowCount`, `assertScriptMutationSucceeded` and friends; each script has a `src/lib/<name>-safety.ts` companion reading `RUN_<NAME>_MUTATION` (and often `ALLOW_<NAME>_SCRIPT`).
- `supabase/verify-migrations.sh` checks migration naming and ordering; `supabase/rollbacks/` and `supabase/sql-scripts/` hold hand-run SQL.

## 10. Migration workflow details (`supabase/migrations/README.md`)

- `20251123120000_squashed.sql` is the baseline with the full schema; earlier SQL lives in `supabase/migrations-archive/pre-squash-20251123`.
- `*_remote_placeholder.sql` files mirror versions already in the remote `schema_migrations` table; keep them so the CLI history matches production.
- New migrations need a timestamp newer than the latest applied version; create them with `npx supabase migration new <timestamp>_<name>`.
- 661 files in the folder on 2026-09-04; the newest were `20260903160000_invoice_paypal_payment_foundations.sql` and `20260903220000_short_link_legacy_reports.sql`.
- Migrations worth knowing by name: `20260828120356_default_privileges_stop_anon_inheriting.sql`, `20260828120614_anon_surface_report_view.sql`, `20260809100000_group_deposit_threshold_15.sql`, `20260803000200_seasonal_deposit_on_create.sql`.

## 11. Prompting conventions the owner uses

- "Grill me on these changes and don't make a PR until I pass your test": act as a hostile reviewer first.
- "Prove to me this works": diff behaviour between `main` and the branch and show evidence.
- "Knowing everything you know now, scrap this and implement the elegant solution": rewrite rather than patch.
- "Do a full review of the /[section-name] section": run the `fix-function` skill.
- Pointing at logs, a Slack thread or failing CI and saying "fix": autonomous mode, no hand-holding.

## 12. UI redesign programme (GSD planning context)

The old `CLAUDE.md` carried blocks generated from `.planning/` (`PROJECT.md` and `codebase/STACK.md`, `CONVENTIONS.md`, `ARCHITECTURE.md`). The programme they describe: a UI redesign implementing a Claude Design handoff across 34 screens, with a collapsible sidebar, topbar, unified `@/ds` component library, six new sections (Events, Performers, Cashing Up, OJ Projects, Short Links, Design System) and an FOH-only chromeless mode. Constraints recorded there: at most four phases; no stack changes; each phase independently deployable without breaking production; no auth or RBAC changes; server actions, manual field mapping and audit logging preserved; Node 20. The live planning state is in `.planning/` (`ROADMAP.md`, `STATE.md`, `phases/`); read that rather than this summary when working on the redesign.

## 13. Custom domains and rewrites (`vercel.json`)

- `the-anchor.pub/l/:code` and `www.the-anchor.pub/l/:code` rewrite to `/api/redirect/:code`.
- `l.the-anchor.pub/:code` rewrites to `/api/redirect/:code`.
- `vip-club.uk` and `www.vip-club.uk`: `/` and `/:code` go to `/api/redirect`, `/legacy-link/:code` stays on the interstitial, `/robots.txt` is served. The domain is being retired; `src/app/legacy-link/` shows the notice and `api/short-links/legacy-report` records where old links are still published.
- `next.config.mjs` redirects `/rota/print` to `/api/rota/pdf` (307).

# External Integrations

**Analysis Date:** 2026-05-18

## APIs & External Services

**SMS:**
- Twilio — outbound SMS to customers and staff; inbound webhook for delivery status
  - SDK/Client: `twilio` ^5.10.6; wrapper in `src/lib/sms/` and `src/lib/twilio.ts`
  - Auth env vars: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`
  - Optional: `TWILIO_MESSAGING_SERVICE_SID` for messaging service (overrides from-number)
  - Webhook secret: `TWILIO_WEBHOOK_AUTH_TOKEN`; signature validation (can be skipped locally via `SKIP_TWILIO_SIGNATURE_VALIDATION=true`)
  - Safety guards: hourly/daily rate limits, quiet hours, idempotency — all in `src/lib/sms/safety.ts`
  - Inbound webhook: `src/app/api/webhooks/twilio/route.ts`

**Email:**
- Microsoft Graph / Outlook — transactional email (invoices, contracts, staff comms, booking confirmations)
  - SDK/Client: `@microsoft/microsoft-graph-client` ^3.0.7 + `@azure/identity` ^4.10.2
  - Auth env vars: `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `MICROSOFT_USER_EMAIL`
  - Implementation: `src/lib/email/emailService.ts` — `sendEmail(to, subject, html, cc?, attachments?)`
  - Auth method: client credentials (ClientSecretCredential → delegated access)
  - Specialized templates: `src/lib/email/private-booking-emails.ts`, `src/lib/email/employee-invite-emails.ts`

**Payments — PayPal:**
- PayPal — deposit collection for private bookings, table bookings, parking
  - SDK/Client: `@paypal/react-paypal-js` ^9.0.1 (browser buttons); custom REST client in `src/lib/paypal.ts`
  - Auth env vars: `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET`, `PAYPAL_ENVIRONMENT` (`live`/`sandbox`)
  - Webhook IDs: `PAYPAL_WEBHOOK_ID` (general), `PAYPAL_PRIVATE_BOOKINGS_WEBHOOK_ID`, `PAYPAL_PARKING_WEBHOOK_ID`, `PAYPAL_TABLE_BOOKINGS_WEBHOOK_ID`
  - Browser key: `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
  - Webhooks: `src/app/api/webhooks/paypal/route.ts` (general), `/paypal/private-bookings/`, `/paypal/table-bookings/`, `/paypal/parking/`
  - Refund handling: `src/lib/paypal-refund-webhook.ts`

**Payments — Stripe:**
- Stripe — event ticket payments
  - SDK/Client: custom REST calls via `src/lib/payments/stripe.ts`
  - Auth env vars: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
  - Webhook: `src/app/api/stripe/webhook/route.ts`

**AI / LLM:**
- OpenAI — receipt/transaction classification for expenses module
  - SDK/Client: `openai` ^6.15.0; wrapper in `src/lib/receipts/ai-classification.ts`; config in `src/lib/openai/config.ts`
  - Auth env vars: `OPENAI_API_KEY`, `OPENAI_BASE_URL` (proxy-compatible), `OPENAI_RECEIPTS_MODEL` (default `gpt-4o-mini`)
  - Models: `gpt-4o-mini`, `gpt-4o`, `gpt-4.1-mini` (pricing tracked per-model)
  - Use: single and batch transaction classification with UK pub context prompt

**Calendar:**
- Google Calendar — rota publishing, event sync, birthday reminders
  - SDK/Client: `googleapis` ^171.4.0; wrappers in `src/lib/google-calendar.ts`, `src/lib/google-calendar-rota.ts`, `src/lib/google-calendar-birthdays.ts`, `src/lib/google-calendar-events.ts`
  - Auth env vars: `GOOGLE_CALENDAR_CLIENT_ID`, `GOOGLE_CALENDAR_CLIENT_SECRET`, `GOOGLE_CALENDAR_REDIRECT_URI`, `GOOGLE_CALENDAR_ID`
  - Extended auth: `GOOGLE_CALENDAR_DELEGATE_EMAIL`, `GOOGLE_SERVICE_ACCOUNT_KEY` (service account / domain-wide delegation)
  - OAuth callback: `src/app/api/auth/google/callback`

**Maps / Distance:**
- Google Routes API — mileage distance backfill (optional; scripts only)
  - Auth env var: `GOOGLE_ROUTES_API_KEY`
  - Usage: `scripts/mileage/backfill-distance-cache-from-google-routes.ts` (run via `npm run mileage:distances:routes`)

**Bot Protection:**
- Cloudflare Turnstile — bot protection on public booking endpoints (table bookings, private booking enquiry)
  - Client: `src/lib/turnstile.ts`
  - Auth env var: `TURNSTILE_SECRET_KEY`
  - Applied at: `src/app/api/table-bookings/route.ts`, `src/app/api/public/private-booking/route.ts`

**Bug Reporting:**
- GitHub Issues API — automated bug reporting from in-app bug reporter
  - Client: `src/lib/bug-reporter/github-client.ts`
  - Auth env vars: `GITHUB_BUG_REPORTER_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
  - Endpoint: `src/app/api/bug-report/route.ts`

## Data Storage

**Databases:**
- Supabase (PostgreSQL) — primary data store for all application data
  - Connection managed by: `src/lib/supabase/server.ts` (cookie-based auth), `src/lib/supabase/admin.ts` (service role)
  - Browser client: `src/lib/supabase/client.ts`
  - Auth env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
  - Migrations: `supabase/migrations/`
  - Retry wrapper: `src/lib/supabase-retry.ts`

**File Storage:**
- Supabase Storage — receipt images and employee document attachments (inferred from image processing patterns)

**Caching:**
- Database-backed job queue via `src/lib/unified-job-queue.ts` (no external Redis/Upstash detected)
- Mileage distance cache stored in DB (`src/lib/mileage/`)

## Authentication & Identity

**Auth Provider:**
- Supabase Auth — JWT + HTTP-only cookies
  - Implementation: `src/lib/supabase/server.ts` (SSR cookie client)
  - Auth enforcement: `src/(authenticated)/layout.tsx` via `supabase.auth.getUser()`
  - Middleware: `src/middleware.ts.disabled` (disabled after Vercel incident — auth handled at layout level)
  - Public paths: `/timeclock`, `/parking/guest`, `/table-booking`, `/g/`, `/m/`, `/r/`
  - RBAC: `src/types/rbac.ts`; permission checks via `checkUserPermission()` in `src/services/`

## Monitoring & Observability

**Error Tracking:**
- Not detected (no Sentry or similar SDK found)

**Logs:**
- `console.log` / `console.error` / `console.warn` — server-side stdout (Vercel logs)
- Audit log: `logAuditEvent()` in `src/lib/audit-helpers.ts` — writes to Supabase audit table
- Cron run results: `src/lib/cron-run-results.ts` — tracks cron job success/failure in DB
- Cron failure alerts: email sent to `CRON_ALERT_EMAIL` on failure

## CI/CD & Deployment

**Hosting:**
- Vercel — Next.js deployment, serverless functions, cron scheduler
  - Config: `vercel.json` (cron schedules, domain rewrites)
  - Custom domains: `the-anchor.pub` (main), `vip-club.uk` and `l.the-anchor.pub` (short links)
  - Body size limit: 20 MB (server actions, for file uploads)

**CI Pipeline:**
- Not detected (no GitHub Actions or CircleCI config found)

## Environment Configuration

**Required env vars (production):**
- `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` + `SUPABASE_SERVICE_ROLE_KEY`
- `NEXT_PUBLIC_APP_URL`
- `TWILIO_ACCOUNT_SID` + `TWILIO_AUTH_TOKEN` + `TWILIO_PHONE_NUMBER`
- `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` + `MICROSOFT_TENANT_ID` + `MICROSOFT_USER_EMAIL`
- `PAYPAL_CLIENT_ID` + `PAYPAL_CLIENT_SECRET` + `PAYPAL_WEBHOOK_ID` + `PAYPAL_ENVIRONMENT` + `NEXT_PUBLIC_PAYPAL_CLIENT_ID`
- `STRIPE_SECRET_KEY` + `STRIPE_WEBHOOK_SECRET`
- `CRON_SECRET`

**Optional env vars:**
- `OPENAI_API_KEY` + `OPENAI_BASE_URL` + `OPENAI_RECEIPTS_MODEL` — AI receipt classification
- `GOOGLE_CALENDAR_*` — Google Calendar sync
- `GOOGLE_ROUTES_API_KEY` — mileage distance backfill script
- `TURNSTILE_SECRET_KEY` — bot protection on public endpoints
- `GITHUB_BUG_REPORTER_TOKEN` + `GITHUB_OWNER` + `GITHUB_REPO` — bug reporting
- `SMS_SAFETY_*` — SMS rate limit overrides
- `SUSPEND_EVENT_SMS` / `SUSPEND_ALL_SMS` — kill switches for SMS

**Secrets location:**
- Local: `.env.local` (gitignored)
- Production: Vercel environment variables
- Reference: `.env.example` (committed, no real values)

## Webhooks & Callbacks

**Incoming:**
- `POST /api/webhooks/twilio` — Twilio SMS delivery status updates
- `POST /api/webhooks/paypal` — PayPal general events (HMAC verified)
- `POST /api/webhooks/paypal/private-bookings` — PayPal events for private booking deposits
- `POST /api/webhooks/paypal/table-bookings` — PayPal events for table booking deposits
- `POST /api/webhooks/paypal/parking` — PayPal events for parking payments
- `POST /api/stripe/webhook` — Stripe event ticket payment events
- `GET /api/auth/google/callback` — Google OAuth calendar authorisation callback

**Outgoing (cron-driven):**
- 29 Vercel cron jobs (see `vercel.json`) covering: job queue processing (every minute), event booking holds, waitlist offers, guest engagement, parking notifications, Sunday pre-orders, SMS reconciliation, PayPal deposit reconciliation, private booking monitoring, invoice reminders, birthday reminders, rota automation, employee separations, auto-send invoices, engagement scoring, rate limit cleanup, weekly/monthly billing, table booking deposit timeouts, Sunday lunch prep
- Auth requirement: `Authorization: Bearer CRON_SECRET` header on all `/api/cron/*` and `/api/jobs/*` routes

---

*Integration audit: 2026-05-18*

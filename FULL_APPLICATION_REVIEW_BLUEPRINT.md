# Full Application Review Blueprint

Generated: 2026-02-14T06:46:22.178Z

Purpose: provide a single, exhaustive checklist of application surfaces so a deep code review cannot miss major areas.

How to use: work section-by-section, log findings and evidence, and do not mark a section complete until code, tests, and runtime behavior are all verified.

## Scope Snapshot

- API routes: **98**
- Server actions: **67**
- Services: **24**
- Shared libs: **112**
- Test files: **39**
- Scripts/tooling files: **264**
- Docs files: **39**
- Supabase migrations (active): **202**
- Supabase migrations (archive): **107**
- Supabase migrations (backup): **30**
- Supabase SQL scripts: **13**
## Review Workflow

1. Baseline and safety checks
   - Confirm production env requirements (`CRON_SECRET`, webhook secrets, payment keys, Twilio auth).
   - Run `lint`, `tsc --noEmit`, tests, and `next build` before and after each review batch.
2. Surface-by-surface code review
   - Review each domain in the checklist below.
   - For every state-changing path, verify auth, validation, idempotency, retries, and audit logging.
3. Runtime verification
   - Exercise critical end-to-end flows (booking, payment, SMS, webhook callbacks, cron execution).
   - Validate failure paths (timeouts, retries, duplicates, bad payloads, partial DB failures).
4. Sign-off
   - Record findings, fixes, test evidence, and residual risks for each domain.
   - Any unchecked domain means review is not complete.
## Domain Checklist

| Domain | Primary Paths | Core Risks To Check | Status | Evidence |
|---|---|---|---|---|
| Auth/RBAC/session | `src/app/actions/rbac.ts`, middleware, protected APIs | privilege bypass, missing permission checks, session assumptions | ☐ | |
| API contracts & validation | `src/app/api/**`, zod schemas | unsafe input, missing schema validation, 500 on user errors | ☐ | |
| Jobs/cron orchestration | `src/app/api/cron/**`, `src/app/api/jobs/**`, `src/lib/unified-job-queue.ts` | duplicate execution, race conditions, fail-open auth, unbounded batches | ☐ | |
| Messaging/SMS | `src/lib/twilio.ts`, `src/lib/sms/**`, `src/services/sms-queue.ts` | spam loops, bad retry policy, dedupe gaps, opt-out non-compliance | ☐ | |
| Webhooks | Stripe/Twilio/PayPal routes | signature verification, replay/idempotency, sensitive logging, partial writes | ☐ | |
| Payments | Stripe/PayPal libs + booking payment flows | double capture/refund, booking-payment mismatch, inconsistent states | ☐ | |
| Booking domains | table/event/private/parking services & APIs | inventory race, status drift, duplicate notifications, state machine errors | ☐ | |
| Invoices/quotes/receipts | invoice/quote services & receipt workflows | incorrect totals, status transitions, file export issues | ☐ | |
| OJ projects/time tracking | `src/app/actions/oj-projects/**`, cron billing routes | duplicate billing, rate calc errors, retainer logic drift | ☐ | |
| Employees/HR | employees APIs/actions/services | PII leakage, contract generation errors, missing access control | ☐ | |
| Menu/FOH/BOH operations | menu routes/actions, foh/boh routes | unauthorized mutations, stale availability, race in table assignments | ☐ | |
| Analytics/reporting | `src/lib/analytics/**`, reporting pages | incorrect aggregation, null handling, expensive queries | ☐ | |
| Data layer/schema | Supabase migrations/RLS/RPC/functions | schema drift, missing indexes, weak RLS, unsafe RPC assumptions | ☐ | |
| Frontend UX reliability | `src/app/**`, key clients/components | destructive UI actions, missing loading/error states, stale cache views | ☐ | |
| Observability & incident response | logger usage, audit logs, health endpoints | insufficient alerts, missing correlation IDs, noisy/unusable logs | ☐ | |
| Testing & QA rigor | `tests/**`, scripts | untested critical paths, missing regression tests for historical incidents | ☐ | |
## High-Risk Flows (Must Be Reviewed End-To-End)

- New booking -> payment intent/order -> capture/confirmation -> notification send -> webhook callback reconciliation
- Cron-triggered reminders -> queue execution -> SMS send -> status callback -> customer state updates
- Bulk messaging -> segmentation query -> send fanout -> rate limits/safety limits -> dedupe and opt-out handling
- Retrier behavior for payment, webhook, and SMS paths under network errors and 4xx/5xx responses
- Idempotent replay behavior for all public/external mutation endpoints and webhook handlers
## Authenticated Product Areas

- `src/app/(authenticated)/cashing-up`
- `src/app/(authenticated)/customers`
- `src/app/(authenticated)/dashboard`
- `src/app/(authenticated)/employees`
- `src/app/(authenticated)/events`
- `src/app/(authenticated)/invoices`
- `src/app/(authenticated)/menu-management`
- `src/app/(authenticated)/messages`
- `src/app/(authenticated)/oj-projects`
- `src/app/(authenticated)/parking`
- `src/app/(authenticated)/performers`
- `src/app/(authenticated)/private-bookings`
- `src/app/(authenticated)/profile`
- `src/app/(authenticated)/quotes`
- `src/app/(authenticated)/receipts`
- `src/app/(authenticated)/roles`
- `src/app/(authenticated)/settings`
- `src/app/(authenticated)/short-links`
- `src/app/(authenticated)/table-bookings`
- `src/app/(authenticated)/unauthorized`
- `src/app/(authenticated)/users`
## Operational Endpoints

- Cron routes (19)
- `src/app/api/cron/auto-send-invoices/route.ts`
- `src/app/api/cron/reconcile-sms/route.ts`
- `src/app/api/cron/apply-customer-labels/route.ts`
- `src/app/api/cron/oj-projects-billing/route.ts`
- `src/app/api/cron/recurring-invoices/route.ts`
- `src/app/api/cron/birthday-reminders/route.ts`
- `src/app/api/cron/oj-projects-billing-reminders/route.ts`
- `src/app/api/cron/parking-notifications/route.ts`
- `src/app/api/cron/invoice-reminders/route.ts`
- `src/app/api/cron/event-waitlist-offers/route.ts`
- `src/app/api/cron/event-booking-holds/route.ts`
- `src/app/api/cron/engagement-scoring/route.ts`
- `src/app/api/cron/cleanup-rate-limits/route.ts`
- `src/app/api/cron/event-checklist-reminders/route.ts`
- `src/app/api/cron/event-guest-engagement/route.ts`
- `src/app/api/cron/oj-projects-retainer-projects/route.ts`
- `src/app/api/cron/generate-slots/route.ts`
- `src/app/api/cron/sunday-preorder/route.ts`
- `src/app/api/cron/private-booking-monitor/route.ts`

- Job processor routes (2)
- `src/app/api/jobs/process/route.ts`
- `src/app/api/jobs/process-now/route.ts`

- Webhook routes (3)
- `src/app/api/stripe/webhook/route.ts`
- `src/app/api/webhooks/twilio/route.ts`
- `src/app/api/webhooks/paypal/parking/route.ts`

- Public/external routes (4)
- `src/app/api/public/private-booking/route.ts`
- `src/app/api/public/private-booking/config/route.ts`
- `src/app/api/external/create-booking/route.ts`
- `src/app/api/external/performer-interest/route.ts`
## API Inventory By Group

### boh (6)

- `src/app/api/boh/table-bookings/[id]/move-table/route.ts`
- `src/app/api/boh/table-bookings/[id]/party-size/route.ts`
- `src/app/api/boh/table-bookings/[id]/route.ts`
- `src/app/api/boh/table-bookings/[id]/sms/route.ts`
- `src/app/api/boh/table-bookings/[id]/status/route.ts`
- `src/app/api/boh/table-bookings/route.ts`

### bug-report (1)

- `src/app/api/bug-report/route.ts`

### business (2)

- `src/app/api/business/amenities/route.ts`
- `src/app/api/business/hours/route.ts`

### business-hours (1)

- `src/app/api/business-hours/route.ts`

### cashup (1)

- `src/app/api/cashup/weekly/print/route.ts`

### cron (19)

- `src/app/api/cron/apply-customer-labels/route.ts`
- `src/app/api/cron/auto-send-invoices/route.ts`
- `src/app/api/cron/birthday-reminders/route.ts`
- `src/app/api/cron/cleanup-rate-limits/route.ts`
- `src/app/api/cron/engagement-scoring/route.ts`
- `src/app/api/cron/event-booking-holds/route.ts`
- `src/app/api/cron/event-checklist-reminders/route.ts`
- `src/app/api/cron/event-guest-engagement/route.ts`
- `src/app/api/cron/event-waitlist-offers/route.ts`
- `src/app/api/cron/generate-slots/route.ts`
- `src/app/api/cron/invoice-reminders/route.ts`
- `src/app/api/cron/oj-projects-billing-reminders/route.ts`
- `src/app/api/cron/oj-projects-billing/route.ts`
- `src/app/api/cron/oj-projects-retainer-projects/route.ts`
- `src/app/api/cron/parking-notifications/route.ts`
- `src/app/api/cron/private-booking-monitor/route.ts`
- `src/app/api/cron/reconcile-sms/route.ts`
- `src/app/api/cron/recurring-invoices/route.ts`
- `src/app/api/cron/sunday-preorder/route.ts`

### customers (1)

- `src/app/api/customers/lookup/route.ts`

### employees (1)

- `src/app/api/employees/[employee_id]/employment-contract/route.ts`

### event-bookings (1)

- `src/app/api/event-bookings/route.ts`

### event-categories (1)

- `src/app/api/event-categories/route.ts`

### event-waitlist (1)

- `src/app/api/event-waitlist/route.ts`

### events (6)

- `src/app/api/events/[id]/route.ts`
- `src/app/api/events/customers/search/route.ts`
- `src/app/api/events/export/route.ts`
- `src/app/api/events/recurring/route.ts`
- `src/app/api/events/route.ts`
- `src/app/api/events/today/route.ts`

### external (2)

- `src/app/api/external/create-booking/route.ts`
- `src/app/api/external/performer-interest/route.ts`

### foh (15)

- `src/app/api/foh/bookings/[id]/cancel/route.ts`
- `src/app/api/foh/bookings/[id]/left/route.ts`
- `src/app/api/foh/bookings/[id]/move-table/route.ts`
- `src/app/api/foh/bookings/[id]/no-show/route.ts`
- `src/app/api/foh/bookings/[id]/party-size/route.ts`
- `src/app/api/foh/bookings/[id]/seated/route.ts`
- `src/app/api/foh/bookings/[id]/walkout/route.ts`
- `src/app/api/foh/bookings/route.ts`
- `src/app/api/foh/customers/search/route.ts`
- `src/app/api/foh/event-bookings/route.ts`
- `src/app/api/foh/events/route.ts`
- `src/app/api/foh/events/upcoming/route.ts`
- `src/app/api/foh/food-order-alert/route.ts`
- `src/app/api/foh/schedule/route.ts`
- `src/app/api/foh/sunday-preorder/menu/route.ts`

### invoices (2)

- `src/app/api/invoices/[id]/pdf/route.ts`
- `src/app/api/invoices/export/route.ts`

### jobs (2)

- `src/app/api/jobs/process-now/route.ts`
- `src/app/api/jobs/process/route.ts`

### menu (4)

- `src/app/api/menu/ai-parse/route.ts`
- `src/app/api/menu/dietary/[type]/route.ts`
- `src/app/api/menu/route.ts`
- `src/app/api/menu/specials/route.ts`

### menu-management (8)

- `src/app/api/menu-management/dishes/[id]/route.ts`
- `src/app/api/menu-management/dishes/route.ts`
- `src/app/api/menu-management/ingredients/[id]/prices/route.ts`
- `src/app/api/menu-management/ingredients/[id]/route.ts`
- `src/app/api/menu-management/ingredients/route.ts`
- `src/app/api/menu-management/menus/route.ts`
- `src/app/api/menu-management/recipes/[id]/route.ts`
- `src/app/api/menu-management/recipes/route.ts`

### messages (2)

- `src/app/api/messages/bulk/customers/route.ts`
- `src/app/api/messages/unread-count/route.ts`

### oj-projects (1)

- `src/app/api/oj-projects/billing-preview/route.ts`

### outstanding-counts (1)

- `src/app/api/outstanding-counts/route.ts`

### parking (5)

- `src/app/api/parking/availability/route.ts`
- `src/app/api/parking/bookings/[id]/route.ts`
- `src/app/api/parking/bookings/route.ts`
- `src/app/api/parking/payment/return/route.ts`
- `src/app/api/parking/rates/route.ts`

### private-booking-enquiry (1)

- `src/app/api/private-booking-enquiry/route.ts`

### private-bookings (1)

- `src/app/api/private-bookings/contract/route.ts`

### public (2)

- `src/app/api/public/private-booking/config/route.ts`
- `src/app/api/public/private-booking/route.ts`

### quotes (1)

- `src/app/api/quotes/[id]/pdf/route.ts`

### receipts (2)

- `src/app/api/receipts/export/route.ts`
- `src/app/api/receipts/upload/route.ts`

### redirect (2)

- `src/app/api/redirect/[code]/route.ts`
- `src/app/api/redirect/route.ts`

### settings (2)

- `src/app/api/settings/table-bookings/space-area-links/route.ts`
- `src/app/api/settings/table-bookings/tables/route.ts`

### stripe (1)

- `src/app/api/stripe/webhook/route.ts`

### table-bookings (1)

- `src/app/api/table-bookings/route.ts`

### webhooks (2)

- `src/app/api/webhooks/paypal/parking/route.ts`
- `src/app/api/webhooks/twilio/route.ts`
## Server Actions Inventory

- `src/app/actions/auth.ts`
- `src/app/actions/employeeQueries.ts`
- `src/app/actions/attachmentCategories.ts`
- `src/app/actions/privateBookingActions.ts`
- `src/app/actions/vendors.ts`
- `src/app/actions/cashing-up.ts`
- `src/app/actions/receipts.ts`
- `src/app/actions/audit.ts`
- `src/app/actions/event-categories.ts`
- `src/app/actions/cronJobs.ts`
- `src/app/actions/customerSmsActions.ts`
- `src/app/actions/employeeExport.ts`
- `src/app/actions/employee-history.ts`
- `src/app/actions/employeeDetails.ts`
- `src/app/actions/private-bookings-dashboard.ts`
- `src/app/actions/recurring-invoices.ts`
- `src/app/actions/job-queue.ts`
- `src/app/actions/business-hours.ts`
- `src/app/actions/fix-phone-numbers.ts`
- `src/app/actions/cashing-up-import.ts`
- `src/app/actions/events.ts`
- `src/app/actions/profile.ts`
- `src/app/actions/customer-labels.ts`
- `src/app/actions/gdpr.ts`
- `src/app/actions/missing-cashups.ts`
- `src/app/actions/rbac.ts`
- `src/app/actions/event-images.ts`
- `src/app/actions/parking.ts`
- `src/app/actions/ai-menu-parsing.ts`
- `src/app/actions/customer-labels-bulk.ts`
- `src/app/actions/auditLogs.ts`
- `src/app/actions/employee-birthdays.ts`
- `src/app/actions/performer-submissions.ts`
- `src/app/actions/messageActions.ts`
- `src/app/actions/event-content.ts`
- `src/app/actions/event-checklist.ts`
- `src/app/actions/email.ts`
- `src/app/actions/diagnose-messages.ts`
- `src/app/actions/short-links.ts`
- `src/app/actions/invoices.ts`
- `src/app/actions/quotes.ts`
- `src/app/actions/event-marketing-links.ts`
- `src/app/actions/messagesActions.ts`
- `src/app/actions/menu-settings.ts`
- `src/app/actions/webhooks.ts`
- `src/app/actions/sms-bulk-direct.ts`
- `src/app/actions/import-messages.ts`
- `src/app/actions/menu-management.ts`
- `src/app/actions/vendor-contacts.ts`
- `src/app/actions/employeeActions.ts`
- `src/app/actions/events-optimized.ts`
- `src/app/actions/customers.ts`
- `src/app/actions/sms.ts`
- `src/app/actions/backgroundJobs.ts`
- `src/app/actions/daily-summary.ts`
- `src/app/actions/messageTemplates.ts`
- `src/app/actions/loyalty.ts`
- `src/app/actions/oj-projects/work-types.ts`
- `src/app/actions/oj-projects/system.ts`
- `src/app/actions/oj-projects/vendor-settings.ts`
- `src/app/actions/oj-projects/project-contacts.ts`
- `src/app/actions/oj-projects/projects.ts`
- `src/app/actions/oj-projects/recurring-charges.ts`
- `src/app/actions/oj-projects/entries.ts`
- `src/app/actions/diagnose-webhook-issues.ts`
- `src/app/actions/pnl.ts`
- `src/app/actions/event-interest-audience.ts`
## Service Layer Inventory

- `src/services/auth.ts`
- `src/services/vendors.ts`
- `src/services/audit.ts`
- `src/services/event-categories.ts`
- `src/services/permission.ts`
- `src/services/business-hours.ts`
- `src/services/financials.ts`
- `src/services/sms-queue.ts`
- `src/services/events.ts`
- `src/services/customer-labels.ts`
- `src/services/gdpr.ts`
- `src/services/parking.ts`
- `src/services/cashing-up.service.ts`
- `src/services/private-bookings.ts`
- `src/services/menu.ts`
- `src/services/event-checklist.ts`
- `src/services/event-marketing.ts`
- `src/services/messages.ts`
- `src/services/short-links.ts`
- `src/services/invoices.ts`
- `src/services/quotes.ts`
- `src/services/menu-settings.ts`
- `src/services/employees.ts`
- `src/services/customers.ts`
## Shared Library Inventory

| `src/lib` Group | File Count |
|---|---:|
| (root) | 49 |
| analytics | 3 |
| api | 5 |
| bug-reporter | 4 |
| email | 1 |
| events | 8 |
| foh | 3 |
| guest | 3 |
| hiring | 2 |
| openai | 1 |
| parking | 6 |
| payments | 1 |
| pnl | 1 |
| private-bookings | 1 |
| receipts | 2 |
| settings | 1 |
| short-links | 2 |
| sms | 9 |
| sound | 1 |
| supabase | 4 |
| table-bookings | 4 |
| vendors | 1 |

Top-level files: 49
## Database/Schema Surface

- Primary migration set: `supabase/migrations/`
- Archived migration history: `supabase/migrations-archive/`
- Backup migration baseline: `supabase/migrations-backup/`
- SQL operational/debug scripts: `supabase/sql-scripts/`
- Review requirements:
  - Verify RLS and grants for tables touched by public/external/webhook/cron routes.
  - Verify unique constraints supporting idempotency and duplicate suppression.
  - Verify indexes on high-volume filters (`status`, `created_at`, foreign keys, message SID/event IDs).
  - Verify RPC functions used by critical flows preserve transactional consistency.
## Testing Surface

- Primary automated tests in `tests/`:
- `tests/services/eventsSchema.test.ts`
- `tests/services/short-links.service.test.ts`
- `tests/services/cashing-up.service.test.ts`
- `tests/api/eventsRouteFilters.test.ts`
- `tests/lib/receiptRuleMatching.test.ts`
- `tests/lib/shortLinksBaseUrl.test.ts`
- `tests/lib/tableBookingRules.test.ts`
- `tests/lib/shortLinksRouting.test.ts`
- `tests/lib/parking/capacity.test.ts`
- `tests/lib/parking/notifications.test.ts`
- `tests/lib/events/sundayLunchOnlyPolicy.test.ts`
- `tests/lib/hiring/experience-signals.test.ts`
- `tests/lib/dateUtils.test.ts`
- `tests/lib/smsCustomers.test.ts`
- `tests/lib/smsLinkShortening.test.ts`
- `tests/lib/smsQuietHours.test.ts`
- `tests/lib/googleCalendar.test.ts`
- `tests/lib/idempotency.test.ts`
- `tests/lib/stripeWebhookSignature.test.ts`
- `tests/lib/recurringInvoiceSchedule.test.ts`
- `tests/lib/sms/suspension.test.ts`
- `tests/lib/sms/metadata.test.ts`
- `tests/lib/sms/safety.test.ts`
- `tests/lib/retry.test.ts`
- `tests/lib/eventMarketingLinks.test.ts`
- `tests/lib/phoneUtils.test.ts`
- `tests/actions/messageActionsUnread.test.ts`
- `tests/actions/vendors.test.ts`
- `tests/actions/customerSmsActions.test.ts`
- `tests/components/UserManagement.test.tsx`
- `tests/components/SettingsClients.test.tsx`
- `tests/components/Calendar.test.tsx`
- `tests/components/InvoicesClient.test.tsx`
- `tests/components/SmsQueueActionForm.test.tsx`
- `tests/components/PrivateBookingMessagesClient.test.tsx`
- `tests/settings/read-only-settings.test.tsx`
- `tests/settings/manage-affordances.test.tsx`
- `tests/mocks/microsoft-graph.ts`
- `tests/mocks/twilio.ts`

- Required final verification command set:
- `npm run lint`
- `node ./node_modules/typescript/bin/tsc --noEmit`
- `npm test`
- `npm run build`
## Scripts and Operational Tooling

- Operational scripts under `scripts/` (review for unsafe assumptions and stale one-off fixes).
- Script file count: **264** (tracked via `rg --files scripts`)
- Scripts mentioning SMS/Twilio/queue keywords: **32**
- Scripts containing mutation-ish calls (`insert/update/delete/upsert/rpc`): **96** (note: `rpc` may be read-only; still review)
- Suggested script review focus:
  - Job queue maintenance scripts
  - SMS/backfill/remediation scripts
  - DB mutation/fix scripts
  - Testing smoke scripts used during incidents

Quick triage commands (avoid `cat/head/ls` in this shell; prefer `rg` and `node -e`):
```sh
# scripts likely touching SMS
rg -l "\\b(sendSms|sendSMS|twilio|messageSid|send_sms|sms-queue|SmsQueue)\\b" scripts

# scripts with mutation-ish calls (rpc may be read-only, still review)
rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts
```
## Review Log Template

| Date | Reviewer | Domain | Finding ID | Severity | Summary | Fix PR/Commit | Test Evidence | Residual Risk |
|---|---|---|---|---|---|---|---|---|
| | | | | | | | | |
## Current Progress (2026-02-14)

Status updates:
- Jobs/cron orchestration: `◑ In Progress`
- Messaging/SMS: `◑ In Progress`
- API contracts & validation: `◑ In Progress`
- Webhooks: `◑ In Progress`
- Payments: `◑ In Progress`
- Auth/RBAC/session: `◑ In Progress`
- Invoices/quotes/receipts: `◑ In Progress`

Completed fixes this pass:
1. `SMS-001` (P0) Prevented duplicate bulk SMS enqueueing with deterministic dispatch keys and queue uniqueness checks.
2. `SMS-002` (P0) Added queue-level duplicate suppression in `SmsQueueService.queueAndSend` before insert/send.
3. `SMS-003` (P0) Added hourly send guard + hard per-run cap for `private-booking-monitor` cron.
4. `SMS-004` (P1) Made `private-booking-monitor` expiry path cap-aware and resilient to per-booking failures.
5. `SMS-005` (P1) Fixed queued SMS metadata behavior so job correlation does not weaken idempotency dedupe.
6. `API-001` (P1) Restricted bug report API to authenticated users and added payload size guards.
7. `API-002` (P1) Restricted outstanding-counts API to authenticated users.
8. `CORE-001` (P2) Fixed un-awaited async write in menu management action.
9. `API-003` (P2) Added invalid-JSON request guards to menu-management mutation endpoints to prevent unhandled 500s.
10. `API-004` (P1) Added IP rate limiting and invalid-JSON guards on public private-booking enquiry creation endpoints.
11. `IDEMP-001` (P0) Hardened shared idempotency key lifecycle to treat expired rows as reclaimable and avoid stale `processing` lockouts.
12. `IDEMP-002` (P0) Added guaranteed idempotency claim release (`finally`) on non-success exits for public booking mutation APIs.
13. `SMS-006` (P1) Added expiry-aware reclaim for SMS idempotency claims in `src/lib/sms/safety.ts`.
14. `PAY-001` (P0) Hardened PayPal parking webhook handlers to fail closed on DB write/read errors (prevents silent dropped payment state transitions).
15. `PAY-002` (P1) Fixed parking PayPal return capture path to reconcile already-paid records instead of false failing when webhook wins the race.
16. `API-005` (P2) Added explicit invalid-JSON handling for `POST /api/bug-report` to avoid generic 500 responses.
17. `API-006` (P2) Added explicit invalid-JSON handling for `POST /api/external/create-booking`.
18. `API-007` (P2) Added explicit invalid-JSON handling for `POST /api/parking/bookings`.
19. `IDEMP-003` (P1) Added race-safe claim retry paths in idempotency helpers when stale rows are reclaimed/deleted concurrently.
20. `API-008` (P2) Hardened public `business-hours` endpoint by replacing `select('*')` with explicit field allow-lists.
21. `AUTH-001` (P1) Removed secret-bearing API auth logs, tightened bearer-key extraction, and made API usage logging fail-safe to avoid request failures when logging fails.
22. `INV-001` (P1) Hardened invoice payment recording input validation (requires positive finite amount and valid payment date).
23. `QUOTE-001` (P0) Fixed quote->invoice conversion race by requiring conditional quote-finalization and rolling back created invoices when finalization fails.
24. `REC-001` (P1) Added fail-safe receipt upload state handling with checked transaction update and rollback cleanup if status update fails.
25. `REC-002` (P1) Hardened receipt deletion flow with explicit storage/DB/state error checks to prevent silent partial deletes.
26. `AUTH-002` (P1) Closed cross-user RBAC introspection gap by requiring `users.manage_roles` when fetching/checking another user's permissions.
27. `AUTH-003` (P1) Hardened role/permission reassignment operations with deduped inputs and rollback restore on insert failures to prevent accidental access loss.
28. `CRON-001` (P0) Hardened invoice auto-send cron to prevent duplicate vendor emails by checking prior sent logs, enforcing checked status transitions, and persisting fallback send logs when status finalization fails.
29. `CRON-002` (P0) Hardened OJ projects billing send paths to fail closed on invoice status-finalization gaps and preserve sent logs for reconciliation to prevent repeated invoice email sends.
30. `CRON-003` (P0) Hardened parking notifications cron with stage-aware dedupe checks against notification history, sent-flag backfill from history, and explicit error accounting on marker update failures to prevent repeated reminder SMS bursts.
31. `CRON-004` (P0) Hardened event waitlist offer cron cleanup path by replacing unchecked parallel updates with explicit checked transitions and fail-closed cancellation of entries after SMS delivery failures to prevent retry spam loops.
32. `CRON-005` (P1) Hardened waitlist SMS helper persistence by checking all post-send writes (offer/hold/token/analytics), adding warning telemetry for partial persistence failures, and extending dedupe context with `waitlist_entry_id`.
33. `CRON-006` (P1) Hardened event booking hold-expiry cron for race safety by applying dependent hold/capture expiry updates only to rows actually transitioned in the same run and making analytics writes best-effort.
34. `CRON-007` (P1) Hardened SMS reconciliation cron with explicit config guards, structured logging, checked status-history insertions, robust Twilio not-found handling, and safer timestamp normalization.
35. `WEBHOOK-001` (P1) Hardened Twilio webhook handling so optional webhook log-client config failures do not break callback processing, added explicit error checks for customer delivery-outcome updates and regression-history writes, and fixed missing status fields in outbound delivery updates.
36. `WEBHOOK-002` (P0) Hardened Stripe payment-intent webhook handling for approved charges by blocking failure-status regressions after success, adding explicit DB error checks on charge/payment writes, and making seat-increase blocked/refund writes fail-safe to prevent silent payment-state drift.
37. `CRON-008` (P0) Hardened invoice-reminder cron with per-invoice/per-reminder idempotency claims, checked overdue-status transitions, and claim-release-on-send-failure behavior to prevent concurrent duplicate reminder emails.
38. `CRON-009` (P1) Hardened birthday reminder dispatch by moving internal cron execution to admin Supabase context, fixing `daysAhead` logic (no hardcoded 7-day filter), and adding per-day idempotency claims so repeated cron runs do not re-send the same reminder batch.
39. `CRON-010` (P0) Hardened recurring-invoice cron with per-recurring-invoice/per-scheduled-date idempotency claims, checked state transitions, and safe claim release/persist handling to prevent duplicate invoice generation/sending under retries.
40. `CRON-011` (P0) Hardened event checklist reminder cron with per-day idempotency claims and failure-path claim release so repeated cron triggers cannot spam checklist emails.
41. `SMS-007` (P0) Fixed quiet-hours deferred SMS flow so initial claims do not block queued delivery, added deterministic queue uniqueness keys, and released claims only after successful enqueue to prevent dropped or duplicated deferred sends.
42. `CRON-012` (P1) Hardened event guest engagement follow-up persistence by replacing unchecked post-send `Promise.all` writes with explicit checked booking/token updates and best-effort analytics logging.
43. `WEBHOOK-003` (P0) Hardened PayPal parking completion webhook for out-of-order/retry safety by reconciling `pending/paid/failed/refunded` payment states and preventing booking-state regression after refund/cancellation.
44. `CRON-013` (P0) Hardened OJ projects billing reminders cron with per-billing-date/per-reminder idempotency claims to prevent repeated internal reminder emails on frequent schedule runs.
45. `CRON-014` (P0) Hardened invoice auto-send cron with per-invoice idempotency claims and explicit claim lifecycle handling so concurrent runs cannot double-send vendor invoices.
46. `QUEUE-001` (P0) Fixed unified queue `send_sms` execution so unsuccessful SMS results throw and retry/backoff applies, preventing silent message drops from being marked as completed jobs.
47. `QUEUE-002` (P1) Hardened unified queue job state transitions by checking lease/completion/failure update results explicitly, preventing false-positive completed states when DB writes fail or token guards miss.
48. `WEBHOOK-004` (P1) Hardened PayPal denied-capture webhook path to be state-aware and idempotent, avoiding false denied audit trails when no pending payment transition occurred.
49. `SMS-008` (P1) Hardened private-booking SMS queue transitions by checking sent/failed status writes, tightening approve/reject state guards, and validating audit-write outcomes to prevent stale queue rows and unreliable manual send behavior.
50. `CRON-015` (P0) Hardened OJ projects billing invoice delivery with per-invoice idempotency claims in both existing-invoice and newly-created invoice send paths so concurrent cron executions cannot double-send vendor invoices.
51. `CRON-016` (P1) Hardened OJ projects billing post-send reconciliation by treating already-finalized invoice statuses as success and persisting `processed_with_error` idempotency responses when status transitions fail after email send, preventing retry-induced duplicate sends.
52. `SMS-009` (P0) Closed SMS idempotency bypasses by enforcing default `template_key` + deterministic message-stage fingerprints in queue/manual send paths (`unified-job-queue`, `background-jobs`, and server `sendSms`) so duplicate triggers dedupe while distinct messages continue to send.
53. `SMS-010` (P1) Hardened OTP send metadata with deterministic OTP-stage context (`template_key=otp_message`) so exact duplicate OTP retries are suppressed without blocking legitimate new-code sends.
54. `SMS-011` (P1) Hardened event waitlist join confirmations by adding `event_id` + `waitlist_entry_id` to SMS metadata context, preventing cross-event same-day dedupe collisions that could suppress legitimate confirmation texts.
55. `PB-001` (P1) Hardened private-booking item reorder mutation to avoid partial-order corruption by replacing parallel writes with checked sequential updates and best-effort rollback to the previous order on failure.
56. `PAY-003` (P1) Hardened parking refund state transitions by enforcing checked conditional updates (`status=paid -> refunded`) on `parking_booking_payments`, preventing silent payment-state drift after successful external refunds.
57. `SMS-012` (P1) Added endpoint-level rate limiting on FOH food-order alert dispatch to prevent rapid repeated-trigger SMS bursts from UI double-clicks or accidental repeated submissions.
58. `SMS-013` (P1) Hardened message-thread reply sends with deterministic message-stage metadata so conversational follow-ups are not incorrectly blocked by template-level idempotency conflicts.
59. `SMS-014` (P1) Hardened BOH manual booking SMS sends with deterministic message-stage metadata so staff can send distinct follow-up texts without triggering false idempotency conflicts.
60. `PAY-004` (P0) Hardened event refund processing with checked payment lookup/write paths, existing-refund reconciliation by source payment, and reason-independent Stripe idempotency keys to prevent duplicate refunds across retries or reason edits.
61. `PAY-005` (P0) Hardened approved table-booking charge execution so Stripe-side success cannot be misclassified as failed when local persistence/analytics steps error; all charge/payment writes are now checked and fallback status degrades to pending for manual reconciliation.
62. `PAY-006` (P1) Hardened manager charge-approval action route by making analytics writes best-effort so approved/waived decisions cannot fail after mutation or block approved-charge execution.
63. `PAY-007` (P1) Hardened guest table-manage cancellation/fee-charge request flow by making analytics and manager-email side-effects best-effort so booking state transitions and charge-request creation are not blocked by telemetry/notification failures.
64. `PB-002` (P1) Hardened private-booking feedback submission by making token-consumption and analytics writes best-effort after feedback persistence, preventing false error responses and dropped manager notifications when non-critical side-effects fail.
65. `SMS-015` (P0) Hardened approved private-booking SMS dispatch with atomic row-claim semantics (`error_message` dispatch token) so concurrent manual-send attempts cannot double-dispatch the same queue item.
66. `SMS-016` (P0) Hardened SMS transport retry policy to avoid ambiguous network/server retries that can duplicate outbound messages after uncertain delivery outcomes; retries now only occur on explicit Twilio back-pressure signals.
67. `WEBHOOK-005` (P1) Hardened Twilio inbound opt-out handling by making analytics logging best-effort so successful opt-out writes cannot fail the webhook and trigger avoidable provider retries.
68. `WEBHOOK-006` (P1) Hardened Stripe webhook side effects by making analytics and retry-SMS notifications best-effort in failure/blocked paths so non-critical telemetry/notification errors do not force webhook replays.
69. `CRON-017` (P1) Hardened private-booking monitor feedback sweep with per-candidate failure isolation and best-effort analytics, preventing one malformed booking/side-effect failure from aborting the entire cron run.
70. `PB-003` (P1) Hardened private-booking service mutations (`cancel`, `recordDeposit`, `recordFinalPayment`, booking-created notification) so post-mutation SMS queue failures no longer surface as false operation failures after state changes are committed.
71. `PAY-008` (P1) Hardened event payment SMS helpers to treat outbound messaging as best-effort and avoid throwing from notification paths after payment state transitions complete.
72. `SMS-017` (P1) Added stale-claim recovery for approved private-booking SMS dispatch locks so interrupted sends no longer leave queue rows permanently stuck in claimed `dispatching:*` state.
73. `FOH-001` (P1) Hardened FOH table-booking create flow analytics writes (`table_booking_created`, `card_capture_started`) to best-effort logging so booking creation cannot fail after successful state mutation/SMS dispatch.
74. `PB-004` (P1) Hardened public private-booking enquiry endpoints (`/api/private-booking-enquiry`, `/api/public/private-booking`) so analytics failures no longer block idempotency response persistence after successful booking creation.
75. `WAITLIST-001` (P1) Hardened event waitlist offer SMS helper to catch thrown provider errors, clean up transient guest tokens on thrown/non-success send outcomes, and fail closed without aborting cron event processing.
76. `CRON-018` (P1) Hardened parking notification cron SMS helper so thrown Twilio errors are captured/logged per booking and cannot abort entire reminder batches.
77. `SMS-018` (P1) Hardened route-level SMS exception handling across event booking/waitlist/FOH/guest acceptance/manual BOH send flows so provider throws return controlled responses and do not short-circuit non-SMS side effects.
78. `EVENT-001` (P1) Hardened admin event server actions (`create`, `seat update`, `cancel`) by making analytics writes best-effort and guarding cancellation SMS send exceptions to prevent false failure responses after committed mutations.
79. `EVENT-002` (P1) Hardened guest event manage-booking cancel path by making cancellation analytics best-effort so successful cancellations/refunds are not converted to `internal_error` redirects by telemetry failures.
80. `SMS-019` (P1) Fixed FOH food-order alert dedupe scope by adding short-window stage metadata, preventing long-lived idempotency suppression of legitimate repeated alerts while still damping rapid duplicate clicks.
81. `REVIEW-001` (P2) Hardened review-redirect token route with explicit booking/table update error checks and conditional analytics emission only after successful status transitions to avoid silent state-update failures.
82. `OBS-001` (P2) Added explicit safe analytics wrappers (with structured warn logs) in event booking/waitlist and waitlist-acceptance `Promise.allSettled` flows so telemetry failures remain non-fatal but observable.
83. `PB-005` (P0) Hardened guest table-manage mutation flow for race safety by requiring checked conditional updates (`status=confirmed`) and moving charge-request creation after successful booking updates to avoid orphaned charge requests and false post-commit failures.
84. `PB-006` (P1) Hardened guest table-manage charge side-effects by making late-cancel/reduction charge-request creation best-effort after committed booking changes, preventing successful updates/cancellations from surfacing as errors when charge-request side-effects fail.
85. `PB-007` (P1) Hardened Sunday pre-order persistence by checking delete-step errors before reinsert, preventing silent partial overwrite/data-loss scenarios.
86. `PB-008` (P1) Hardened private-feedback submission idempotency with atomic token-consume claim before insert (plus rollback on insert failure), preventing duplicate feedback rows under concurrent submissions.
87. `PB-009` (P1) Hardened private-feedback manager-email dispatch to be strictly best-effort (including provider-throw handling), preventing successful feedback submissions from failing due to notification errors.
88. `WEBHOOK-007` (P0) Hardened Stripe and PayPal webhook idempotency handling to ACK only true replays while returning retriable `409` for `in_progress` claims, preventing event loss from premature duplicate ACKs when the primary worker later fails.
89. `PAY-009` (P1) Hardened event/seat-increase checkout persistence by checking for existing `stripe_checkout_session_id` payment rows before insert, reducing duplicate pending payment rows on repeated checkout requests.
90. `OBS-002` (P2) Hardened table-booking SMS/hold-alignment observability by logging non-success SMS outcomes and `Promise.allSettled` rejection paths in card-capture hold realignment helpers.
91. `SMS-020` (P1) Hardened `sendSMS` transport pipeline with top-level exception containment so pre-dispatch failures (customer resolution/safety/idempotency lookups) return controlled failure payloads instead of bubbling throws into caller mutation flows.
92. `SMS-021` (P1) Hardened `sendSMS` unexpected-error path to release previously claimed SMS idempotency locks before returning, preventing stale dedupe claims from suppressing legitimate future sends after pre-dispatch exceptions.
93. `CRON-019` (P1) Hardened SMS reconciliation cron with Twilio-status regression guards and customer delivery-outcome synchronization so reconciliation cannot downgrade final states and now keeps `sms_delivery_failures`/deactivation counters aligned when webhook callbacks are missed.
94. `SMS-022` (P1) Hardened approved private-booking SMS failure-state persistence with race-aware fallback (`sent` state reconciliation) so concurrent dispatch completion does not surface false send failures when a stale worker cannot persist `failed` status.
95. `WEBHOOK-008` (P0) Hardened Twilio status webhook ACK behavior to return retriable `500` when core `messages` status persistence fails, preventing silent delivery-state loss from false-success ACKs.
96. `CASH-001` (P1) Fixed cashing-up submit workflow regression by restoring `draft -> submitted` transition semantics (instead of incorrectly setting `approved`), clearing `approved_by_user_id` during submit, and requiring checked row updates for submit/approve state transitions.
97. `CASH-002` (P1) Hardened cashing-up session upsert child-row replacement by checking errors on existing breakdown/count delete steps before reinsert, preventing silent partial-refresh corruption.
98. `MENU-001` (P1) Hardened menu ingredient create/update flows by checking ingredient price-history insert outcomes, preventing silent loss of cost-history records while primary ingredient mutations report success.
99. `MENU-002` (P1) Hardened menu recipe/dish update flows by checking `menu_refresh_*_calculations` RPC outcomes, preventing stale costing/profitability calculations from being silently left out-of-date after successful edits.
100. `BH-001` (P1) Hardened special-hours create/update/delete flows by checking `auto_generate_weekly_slots` RPC outcomes, preventing silent slot-regeneration failures after business-hours overrides are changed.
101. `AUTH-004` (P2) Hardened API usage telemetry by checking `api_usage` insert outcomes and surfacing failures to the safe logger wrapper, preventing silent audit-log drops.
102. `QUEUE-003` (P1) Hardened background-job customer-stats sync by checking `rebuild_customer_category_stats`/`rebuild_all_customer_category_stats` RPC outcomes, preventing false-success job completions when stats rebuild fails.
103. `SHORT-001` (P2) Hardened short-link click tracking in both service and redirect API paths by checking click insert/counter RPC outcomes and catching async tracking failures, preventing silent analytics drops and unhandled async failures.
104. `INV-002` (P1) Hardened invoice status mutations with explicit transition guards plus conditional (`id + old_status + not_deleted`) updates, preventing stale concurrent workers from regressing or overwriting already-finalized invoice states.
105. `INV-003` (P2) Added explicit invalid-JSON guard for invoice line-item payload parsing during create flow, preventing malformed request bodies from surfacing as generic internal errors.
106. `QUOTE-002` (P1) Hardened quote status updates with transition guards, conversion-lock protection (converted quotes immutable), and checked conditional updates to prevent invalid/backward transitions and stale-write races.
107. `QUOTE-003` (P1) Replaced manual quote-update totals math with shared guarded calculator and added rollback-safe line-item replacement (quote + line-item restore on failure), preventing NaN/divide-by-zero totals and partial line-item data loss.
108. `QUOTE-004` (P1) Hardened quote delete/convert rollback paths by supporting schema-safe soft-delete fallback to hard-delete and by deleting invoice line-items before invoice rollback on convert failures, reducing orphaned/partially-rolled-back invoice artifacts.
109. `REC-003` (P1) Hardened recurring-invoice actions with checked update/delete/toggle row effects, explicit line-item delete error handling, and prior-line-item restore on replacement failures, preventing silent no-op mutations and partial schedule/item corruption.
110. `AUTH-005` (P2) Hardened RBAC reassignment service by checking failures when loading existing role-permission/user-role state before destructive updates, preventing fail-open reassignment paths when read operations error.
111. `CRON-020` (P0) Hardened invoice-reminder cron idempotency and time handling by switching due-date filtering/overdue calculation to stable ISO-date semantics, adding deleted-invoice exclusion, checking reminder-log writes, and persisting `processed_with_error` after partial send failures so retries cannot duplicate reminder emails.
112. `INV-004` (P2) Fixed invoice PDF route audit logging path to use the central audit logger (instead of writing to a non-existent `invoice_audit_logs` table) with best-effort failure handling, preventing silent audit-loss and post-generation failures.
113. `QUOTE-005` (P1) Hardened quote PDF generation to reject soft-deleted quotes where supported and made audit logging best-effort, preventing deleted-record disclosure and avoiding false PDF failures on telemetry errors.
114. `INV-005` (P1) Hardened invoice export API with strict date/export-type validation, bounded export window, null-safe monetary formatting, and best-effort audit logging so malformed requests and telemetry issues no longer break export reliability.
115. `QUOTE-006` (P1) Hardened quote list/summary/detail/convert/delete actions to treat soft-deleted quotes as not-found when schema supports soft deletes, preventing deleted quote visibility and post-delete mutation access.
116. `EMAIL-001` (P0) Hardened manual invoice/chase/quote email actions with dispatch-level idempotency claims (short TTL) and replay/in-progress dedupe responses so duplicate UI submissions or retries cannot resend identical emails.
117. `EMAIL-002` (P1) Hardened manual invoice/quote email post-send persistence by checking `invoice_email_logs` writes and applying race-safe status transitions (`draft -> sent` with checked conditional updates), while returning success-with-warnings for non-critical post-send persistence gaps.
118. `EMAIL-003` (P1) Hardened chase-email overdue computation to stable ISO-date semantics and clamped outstanding amounts to non-negative values, preventing timezone-driven off-by-one overdue messaging and negative-balance chase emails.
119. `DASH-001` (P1) Hardened dashboard invoice/quote snapshot metrics by excluding soft-deleted records and computing unpaid totals from true outstanding balance (`total_amount - paid_amount`), preventing ghost/deleted data and overstated receivables in operational views.
120. `EMAIL-004` (P1) Hardened manual chase-email dispatch with explicit status/outstanding guards (`paid/void/written_off` and `outstanding <= 0` blocked), preventing invalid reminder sends to already-settled invoices.
121. `INV-006` (P1) Hardened payment remittance behavior to send advice only when the payment flow transitions invoice state into `paid`, preventing accidental repeat remittance emails on non-transition payment actions.
122. `SMS-023` (P1) Fixed bulk SMS rate-limit double-counting by removing duplicate limiter consumption in the immediate-send path (`sendBulkSMSDirect` already applies the gate), preventing premature operator throttling and false “too many bulk operations” errors.
123. `INV-007` (P1) Hardened invoice edit flow to enforce soft-delete exclusion before updates and at service layer preflight (`id + deleted_at IS NULL + draft status`), blocking edits to deleted invoices that could otherwise be mutated by the invoice-update RPC.
124. `INV-008` (P2) Hardened invoice delete prefetch to exclude soft-deleted rows, preventing stale/deleted invoice metadata from being loaded during delete attempts and aligning error behavior with soft-delete semantics.
125. `EMP-001` (P1) Hardened employee attachment deletion by enforcing `attachment_id + employee_id` row binding and deleting files strictly via DB-resolved `storage_path`, preventing cross-record/path tampering and incorrect file deletes.
126. `EMP-002` (P1) Hardened right-to-work photo deletion with optimistic DB path-clear guards and rollback restoration when storage deletion fails, preventing dangling/missing-file references during transient storage failures or concurrent edits.
127. `REC-004` (P1) Hardened receipt-file deletion ordering by deleting DB metadata first and rolling it back on storage-delete failure, preventing silent missing-file references in `receipt_files` when storage operations fail.
128. `REC-005` (P1) Hardened receipt-upload rollback handling by checking both metadata and storage cleanup outcomes when transaction status finalization fails, surfacing explicit manual-reconciliation errors instead of silently leaving partial rollback state.
129. `EVENTIMG-001` (P1) Hardened event-image upload rollback by checking storage cleanup failures and removing newly-created `event_images` rows when parent event updates fail, preventing orphaned metadata/files after partial upload flows.
130. `EVENTIMG-002` (P1) Hardened event-image deletion flow with explicit image-query error handling, checked metadata delete, and rollback reinsertion when storage removal fails, preventing false-success deletes and event image state drift.
131. `BH-002` (P1) Hardened special-hours range creation to fail closed when duplicate-date precheck queries error, preventing silent bypass of conflict checks under transient DB failures.
132. `BH-003` (P1) Hardened special-hours delete flow with explicit prefetch error handling plus checked delete row-effects, preventing DB read failures from being misreported as not-found and catching stale-delete races.
133. `REC-006` (P1) Hardened receipt-upload metadata-insert failure cleanup by checking storage cleanup results and returning explicit manual-reconciliation errors when cleanup fails, preventing silent orphaned-file incidents.
134. `MENU-003` (P1) Hardened menu ingredient/recipe/dish delete operations to enforce delete row-effect checks (`delete + select + maybeSingle`), preventing false-success responses when records are already missing.
135. `AUTH-006` (P1) Hardened role deletion with checked delete row-effects (`delete + select + maybeSingle`) to catch stale concurrent deletions and avoid false-success responses in RBAC administration.
136. `WEBHOOK-009` (P2) Hardened webhook diagnostics test-write cleanup by using a unique per-run `message_sid` marker and checked scoped delete (`webhook_type + marker`), preventing accidental broad cleanup deletes and surfacing cleanup failures explicitly.
137. `EMP-003` (P1) Hardened signed-upload employee attachment persistence so post-persist audit/email side-effect failures are best-effort (no false error response and no destructive storage cleanup after metadata commit), preventing false-failure UX and accidental file removal.
138. `CASH-003` (P2) Hardened weekly cash-up print API to fail closed when site lookup errors/misses occur and removed raw exception-message echoing from 500 responses, reducing sensitive internal error leakage.
139. `VENDOR-001` (P1) Hardened vendor delete/deactivate flows with checked row-effects (`update/delete + select + maybeSingle`), preventing false-success responses when stale concurrent actions target missing vendor rows.
140. `EVENTCAT-001` (P1) Hardened event-category create/delete flows by checking sort-order lookup errors and delete row-effects, preventing fail-open ordering behavior and false-success deletions under concurrent mutations.
141. `SHORT-002` (P1) Hardened short-link delete with checked delete row-effects (`delete + select + maybeSingle`), preventing false-success responses after stale concurrent deletes.
142. `CUST-001` (P1) Hardened customer delete/test-delete/toggle-opt-in flows with explicit prefetch error handling and checked mutation row-effects, preventing false-success state changes and stale-delete race misreporting.
143. `ATTCAT-001` (P2) Hardened attachment-category delete flow with explicit prefetch-error handling and checked delete row-effects, preventing stale concurrent deletes from returning false success.
144. `CUSTLABEL-001` (P2) Hardened customer-label delete/unassign actions with checked delete row-effects, preventing false-success audit trails when label rows/assignments are already removed.
145. `VCONTACT-001` (P2) Hardened vendor-contact update/delete actions with checked row-effects (`update/delete + select + maybeSingle`), preventing false-success responses on missing contact IDs.
146. `MSGTPL-001` (P2) Hardened message-template delete/toggle actions with checked row-effects, preventing stale/missing template operations from returning success.
147. `OJ-001` (P1) Hardened OJ project action mutations (`project contacts`, `work types`, `recurring charges`, `projects`, and `entries`) with checked row-effects (`update/delete + select + maybeSingle`), preventing stale concurrent mutations from returning false success.
148. `EVENTIMG-003` (P1) Hardened event-image write paths with checked row-effects for event/category image-link updates and metadata edits, plus explicit not-found handling, preventing orphaned files/metadata and false-success image updates.
149. `PARK-001` (P1) Hardened parking booking status/mark-paid flows by checking payment lookup/update/insert outcomes and row-effects before booking transitions, preventing payment-state drift and false-success settlement actions.
150. `PERF-001` (P2) Hardened performer submission updates with explicit prefetch-error handling and checked update row-effects, preventing stale IDs from returning successful edits.
151. `PROFILE-001` (P2) Hardened profile update/toggle/avatar mutations with checked row-effects and avatar orphan cleanup when profile rows are missing, preventing false-success profile writes and unreferenced avatar files.
152. `PB-010` (P1) Hardened private-booking service mutations (`items`, `discount`, `cancel`, `expire`, `venue/catering/vendor delete`) with checked row-effects, preventing stale concurrent operations from returning success after no-op writes.
153. `EVENT-003` (P1) Hardened admin event manual cancellation with checked booking-cancel row-effects, preventing false-success cancellation responses when booking rows are concurrently removed/changed.
154. `SMS-024` (P1) Hardened private-booking SMS queue sent/failed persistence with checked queue row-effects and explicit reconciliation errors when SMS dispatch succeeds but queue state cannot be persisted.
155. `CASH-004` (P1) Hardened cashing-up upsert-update/lock/unlock state transitions with checked row-effects, preventing stale session IDs from being reported as successfully updated/locked/unlocked.
156. `EVENT-004` (P2) Hardened `EventService.deleteEvent` with checked delete row-effects, preventing stale concurrent deletes from returning success.
157. `INV-009` (P2) Hardened invoice catalog soft-delete (`line_item_catalog`) with checked update row-effects, preventing false-success deactivations for missing items.
158. `PB-011` (P2) Added explicit error observability for private-booking calendar-link persistence/cleanup writes (`calendar_event_id` updates), preventing silent calendar sync drift after successful booking mutations.
159. `EVENT-005` (P2) Added explicit rollback-write observability for event table-allocation rollback (`bookings` + `booking_holds`), preventing silent rollback failure during table reservation fallback paths.
160. `WEBHOOK-010` (P2) Hardened Twilio webhook error responses to avoid returning raw exception messages in HTTP 500 payloads, reducing sensitive internal error leakage while preserving detailed server-side diagnostics.
161. `BH-004` (P2) Hardened service-status override deletion with checked delete row-effects (`delete + select + maybeSingle`), preventing stale concurrent removals from returning false success.
162. `MSG-001` (P2) Hardened message read/unread mutations with checked update row-effects (`update + select + maybeSingle`) so stale message IDs cannot return false-success read-state changes.
163. `API-009` (P2) Hardened external booking create endpoint to return generic 500 errors (no raw exception text), reducing internal error leakage on public/external API surfaces.
164. `CRON-021` (P2) Hardened cleanup-rate-limits cron error responses by replacing raw text stack/error echoes with structured generic JSON errors, reducing internal error exposure.
165. `CRON-022` (P2) Hardened apply-customer-labels cron error payloads by removing raw database error details from responses, reducing operational internals leakage.
166. `UTIL-001` (P2) Hardened phone-number remediation mutation accounting with checked row-effects on customer updates and explicit applied success/error counts, preventing false-success maintenance reports.
167. `EVENT-006` (P2) Hardened event table-fallback rollback observability by checking cancellation row-effects for booking rollback updates and logging missing-row rollback drift.
168. `EMP-004` (P1) Hardened `EmployeeService.updateEmployee`/`deleteEmployee` with checked row-effects (`update/delete + select + maybeSingle`), preventing stale concurrent employee mutations from returning false success.
169. `BH-005` (P1) Hardened `BusinessHoursService.updateServiceStatus` Sunday-lunch slot synchronization by checking slot-write and override-load/apply errors, preventing silent slot-state drift after status changes.
170. `QUEUE-004` (P0) Hardened legacy background job processing with atomic pending-claim guards (`id + status=pending`) and processing-status-guarded completion/failure writes, preventing concurrent workers from double-processing the same job.
171. `PB-012` (P1) Hardened private-booking contract generation route by checking audit/version persistence write outcomes and stale row-effects, preventing silent contract-version drift and untracked generation events.
172. `PAY-010` (P1) Hardened approved-charge request persistence by enforcing checked row-effects on all `charge_requests` status updates (failure/attempt/fallback paths), preventing orphaned payment audit writes and silent charge-request state drift.
173. `CRON-023` (P1) Hardened event guest-engagement cron post-send persistence with checked row-effects on manual-interest reminders, review-booking status transitions, and review-token expiry updates, preventing silent post-SMS state drift that can re-open repeat-send risk.
174. `CRON-024` (P2) Hardened recurring-invoice end-date deactivation with checked row-effects (`update + select + maybeSingle`), preventing stale recurring IDs from being silently treated as deactivated.
175. `WEBHOOK-011` (P1) Hardened Twilio webhook customer updates (`delivery outcome`, inbound canonical mobile sync, inbound opt-out) with checked row-effects and missing-row telemetry, preventing silent customer-state drift when post-send/inbound persistence no-ops.
176. `CRON-025` (P1) Hardened OJ billing recovered-invoice linkage persistence on `oj_billing_runs` with checked row-effects, preventing silent invoice-link loss that can re-open duplicate invoice-send/reconcile risk.
177. `REC-007` (P2) Hardened receipt-rule automation persistence by checking row-effects for `receipt_transactions` updates before incrementing status/classification counters/logs, preventing false-success retro summaries when transaction rows are concurrently removed.
178. `TB-001` (P1) Hardened deferred card-capture hold alignment to fail-observe Supabase resolved errors (not just thrown rejections) and to log no-row alignment drift across `table_bookings`, `booking_holds`, and `card_captures`, preventing silent hold-expiry desynchronization.
179. `CRON-026` (P1) Hardened event guest-engagement table-review follow-up persistence with checked row-effects on `table_bookings` status transitions and `guest_tokens` expiry updates, preventing silent post-SMS table-review state drift that can re-open repeat-send risk.
180. `TB-002` (P1) Hardened table-booking party-size increase table-move persistence with checked row-effects on `booking_table_assignments` updates, preventing stale concurrent assignment updates from returning false-success table moves.
181. `FIN-001` (P1) Fixed financial-metric delete scope in save flows by replacing broad cross-product `.in(metric_key).in(timeframe)` deletes with exact `(metric_key,timeframe)` pair deletes, preventing unintended historical metric data loss.
182. `FOH-001` (P1) Hardened FOH/BOH table-booking status mutations (`seated`, `left`, `cancelled`, `completed`, `confirmed`, `no_show`) to enforce checked row-effects before success responses and before no-show charge side-effects, preventing false-success state transitions and orphaned charge requests on stale rows.
183. `CRON-027` (P1) Hardened SMS reconciliation cron persistence with checked row-effects for `messages` and customer delivery-counter updates, preventing silent reconciliation no-ops under concurrent deletes that can re-open repeat-send/opt-out drift.
184. `PAY-011` (P1) Hardened PayPal parking webhook booking/payment refund state transitions with checked row-effects on `parking_bookings` and `parking_booking_payments`, preventing silent payment/booking-state divergence when webhook updates target stale rows.
185. `TB-003` (P1) Hardened FOH/BOH move-table routes to require checked row-effects when refreshing an existing target table assignment window, preventing stale concurrent assignment loss from returning false-success table moves.
186. `EVENT-007` (P1) Hardened FOH event-booking table-reservation conflict rollback to verify rollback write outcomes (`bookings` cancel + `booking_holds` release) and fail closed when rollback persistence fails, preventing silent confirmed/blocked state divergence after reservation conflicts.
187. `CRON-028` (P2) Hardened OJ billing cron candidate-vendor error responses by replacing raw database error message payloads with generic 500 responses while logging detailed server-side diagnostics, reducing internal error leakage on operational endpoints.
188. `CRON-029` (P2) Hardened OJ retainer-project cron vendor/settings load failures to return generic 500 payloads while logging server-side diagnostics, reducing operational error-detail leakage.
189. `API-010` (P2) Hardened receipts export API 500 responses to remove raw exception details from payloads while keeping diagnostics in server logs, reducing internal error leakage on authenticated export endpoints.
190. `CRON-030` (P1) Hardened parking-notifications cron booking mutation writes with a shared checked row-effect helper (`update + select + maybeSingle`) and explicit missing/error accounting, preventing silent `parking_bookings` flag/status drift that can re-open repeat-send risk.
191. `CRON-031` (P2) Hardened event waitlist-offers cron 500 responses to return generic errors instead of raw exception text, reducing operational/internal error leakage.
192. `CRON-032` (P2) Hardened event booking-holds cron 500 responses to return generic errors instead of raw exception text, reducing operational/internal error leakage.
193. `CRON-033` (P2) Hardened Sunday pre-order cron 500 responses to return generic errors instead of raw exception text, reducing operational/internal error leakage.
194. `CRON-034` (P2) Hardened event guest-engagement cron 500 responses to return generic errors instead of raw exception text, reducing operational/internal error leakage.
195. `CRON-035` (P2) Hardened private booking-monitor cron error responses to return generic JSON 500 payloads instead of raw `Error: ...` text responses, reducing operational/internal error leakage.
196. `PB-013` (P2) Hardened private booking-monitor feedback-pass customer-link persistence with checked row-effects (`update + select + maybeSingle`) and missing-row telemetry, preventing silent customer-link no-op drift during SMS follow-up processing.
197. `CRON-036` (P2) Hardened engagement-scoring cron 500 responses to always return generic error payloads instead of raw exception text, reducing operational/internal error leakage.
198. `CRON-037` (P2) Hardened OJ billing-reminders cron send-failure/catch responses to return generic 500 errors while preserving server-side diagnostics and idempotency-claim release, reducing operational/internal error leakage.
199. `CRON-038` (P2) Hardened OJ retainer-project cron per-vendor failure payloads to return generic failure text and moved detailed error diagnostics to server logs, reducing tenant-visible error-detail leakage.
200. `SMS-025` (P1) Hardened waitlist-offer post-SMS persistence writes with checked row-effects on `waitlist_offers`, `booking_holds`, and `guest_tokens`, preventing silent post-send state drift that can re-open repeat-send/retry ambiguity.
201. `WEBHOOK-012` (P1) Hardened Stripe approved-charge payment-intent webhook persistence with checked row-effects on `charge_requests` and payment status updates, preventing silent charge/payment state divergence when concurrent stale updates affect no rows.
202. `API-011` (P2) Hardened FOH booking walk-in override failure responses to avoid reflecting raw exception text in 500 payloads, reducing operational/internal error leakage on authenticated booking APIs.
203. `API-012` (P2) Hardened settings table-booking space-area link load failures to return generic 500 payloads while logging server-side diagnostics, reducing internal error leakage on settings endpoints.
204. `API-013` (P2) Hardened settings table-setup load failures to return generic 500 payloads while logging server-side diagnostics, reducing internal error leakage on settings endpoints.
205. `SEAT-001` (P1) Hardened staff table-booking seat-sync mutations with checked row-effects (`table_bookings` direct + linked updates), preventing stale no-op writes from being reported as success and failing closed when linked seat-sync persistence is missing.
206. `PARK-002` (P1) Hardened parking payment-request SMS reminder-flag persistence with checked row-effects and missing-row telemetry, reducing silent flag drift that can re-open repeat-reminder risk after successful sends.
207. `API-014` (P2) Hardened FOH/BOH move-table route 500 responses to return generic payloads while logging detailed server diagnostics, reducing internal error leakage on operational booking endpoints.
208. `API-015` (P2) Hardened FOH/BOH party-size route 500 responses to return generic payloads while logging detailed server diagnostics, reducing internal error leakage on operational booking endpoints.
209. `API-016` (P2) Hardened settings table-setup refresh failure responses in join-link replacement flow to return generic 500 payloads while preserving detailed server-side diagnostics.
210. `PARK-003` (P1) Hardened parking customer resolution with checked email/last-name enrichment row-effects and duplicate-insert race reconciliation (`23505` fallback lookup), preventing silent customer-data enrichment drift and transient duplicate-key failures under concurrent creates.
211. `SMS-026` (P1) Hardened SMS customer-linking persistence with checked row-effects for customer enrichment and private-booking customer backfill updates, preventing silent booking/customer linkage drift when enrichment/link writes no-op.
212. `WEBHOOK-013` (P1) Hardened Twilio status-callback reconciliation to treat stale no-row status writes as idempotent success (instead of HTTP 500), preventing unnecessary webhook retry loops under read/write races.
213. `CRON-039` (P1) Added shared cron-run result persistence guard (`persistCronRunResult`) and applied it across Sunday pre-order, event guest-engagement, parking notifications, and private booking-monitor cron routes, preventing silent run-state drift when `cron_job_runs` completion/failure writes no-op.
214. `SMS-027` (P1) Hardened bulk SMS dispatch parameter handling with bounded normalization for `chunkSize`, `concurrency`, and `batchDelayMs`, preventing non-terminating loop conditions from zero/negative values.
215. `QUEUE-005` (P1) Hardened queued bulk-SMS batching by normalizing/sorting/deduplicating recipients before batch split and adding empty-input rejection, preventing order-dependent dedupe bypass and duplicate-recipient enqueue drift.
216. `QUEUE-006` (P1) Added bulk rate-limit enforcement to queued bulk-SMS action (`enqueueBulkSMSJob`), aligning queued and direct bulk-send blast-radius controls and blocking rapid repeated enqueue floods before job creation.
217. `CRON-040` (P1) Hardened cron-run stale-restart recovery by adding shared lock-recovery handling (`recoverCronRunLock`) and applying it across Sunday pre-order, event guest-engagement, parking notifications, and private booking-monitor routes, preventing stale no-row restart writes from surfacing as fatal acquisition failures and reducing duplicate-trigger retry risk.
218. `SMS-028` (P1) Added shared bulk recipient hard-cap enforcement (`BULK_SMS_MAX_RECIPIENTS`, default 500) across direct-send action, queued-send action, and bulk sender utility, preventing accidental oversized blast sends from a single request path.
219. `SMS-029` (P1) Hardened `sendBulkSMSAsync` server action by adding explicit `messages.send` permission enforcement, bulk rate-limit enforcement, recipient normalization, and recipient-cap checks to close an unguarded bulk-send path that could bypass queue/direct bulk safeguards.
220. `MUT-041` (P1) Hardened write-update row-effect checks across vendor, role, customer, short-link, menu recipe/dish, and line-item catalog update paths by replacing write-time `.single()` usage with checked `maybeSingle()` results and explicit not-found handling.
221. `HOURS-003` (P1) Hardened business-hours service status/special-hours update flows with explicit prefetch and update row-effect guards, preventing stale no-row updates from being reported as generic write failures.
222. `SETTINGS-007` (P1) Hardened attachment-category, customer-label, and API-key revoke action update paths with explicit no-row guards to prevent stale update races from surfacing as false-success or low-signal failures.
223. `PARK-004` (P1) Hardened parking booking repository updates with explicit no-row detection, preventing missing booking writes from propagating raw PostgREST no-row errors.
224. `MEDIA-002` (P1) Hardened `deleteEventImage` metadata deletion to use checked row-effects (`maybeSingle`) with explicit image-not-found handling, preventing stale delete races from being reported as generic metadata failures.
225. `DB-006` (P1) Hardened shared `RetryableSupabase.updateWithRetry` to use `maybeSingle` for write row-effects, preventing implicit PostgREST no-row exceptions from bypassing caller-level stale-update handling.
226. `OJ-012` (P1) Hardened OJ work-type and recurring-charge update actions with checked row-effects (`maybeSingle`) and explicit not-found responses, preventing stale no-row updates from surfacing as opaque backend errors in settings UIs.
227. `MKT-003` (P1) Hardened event marketing link regeneration by treating stale no-row short-link updates as recoverable and re-inserting links via retry-backed creation, preventing silent stale-link drift when rows disappear between load and update.
228. `RCPT-012` (P1) Hardened manual receipt transaction/rule updates with checked row-effects and explicit transaction/rule not-found outcomes, preventing stale update races from returning ambiguous generic failures.
229. `QUEUE-007` (P1) Hardened `UnifiedJobQueue.updateJobStatus` with explicit row-effect validation so status mutations return failure when no job row is updated, preventing silent success on stale/missing job IDs.
230. `OJ-013` (P1) Hardened OJ project and entry update actions with checked row-effects (`maybeSingle`) and explicit not-found outcomes, preventing stale edit races from bubbling opaque PostgREST errors in project/entry editors.
231. `RCPT-013` (P1) Hardened receipt upload/delete transaction-status persistence with checked update row-effects, ensuring stale transaction races fail explicitly and trigger deterministic rollback outcomes instead of silent no-op writes.
232. `AUTH-003` (P2) Hardened API key `last_used_at` persistence with checked row-effects and explicit disappearance telemetry, improving observability for revoked/deleted key races during request authentication.
233. `QUEUE-008` (P1) Hardened unified job queue lease-heartbeat and stale-reset writes with checked row-effects, preventing lease-extension and stale-reset no-op writes from being treated as successful state transitions.
234. `QUOTE-006` (P2) Hardened quote update rollback visibility by checking rollback row-effects and logging explicit stale-draft rollback misses, improving incident diagnostics for partial-failure recovery paths.
235. `PB-007` (P2) Hardened private-booking item reorder rollback by checking each restore update row-effect and logging missing-row restore misses, reducing silent rollback drift during partial reorder failures.
236. `GUEST-002` (P1) Hardened guest-token throttle persistence by treating `rate_limits` update no-row outcomes as failures and failing over to local throttle state, preventing stale DB no-op writes from weakening brute-force protection.
237. `RINV-002` (P1) Hardened recurring-invoice cron schedule advancement with explicit row-effect checks, preventing generated invoices from being marked successful when recurring schedule rows disappear before post-generate persistence.
238. `FOH-010` (P1) Hardened FOH booking/event-booking seating and rollback writes with checked row-effects (`maybeSingle`) and explicit no-row failure handling, preventing silent seat/rollback no-op writes from being treated as successful state transitions.
239. `OJ-014` (P1) Hardened OJ monthly billing cron run-state persistence by introducing checked `updateBillingRunById` mutations for `oj_billing_runs` status/linkage updates, preventing stale no-row run updates from silently reporting success or masking failed billing-run transitions.
240. `OJ-015` (P1) Hardened OJ cap-splitting persistence for recurring-charge/mileage/time candidate updates with explicit row-effect checks, preventing partial split operations from silently proceeding when source rows disappear mid-split.
241. `RCPT-014` (P1) Hardened AI receipt-classification persistence with checked row-effects, preventing stale transaction no-op writes from being logged as successful AI classification updates.
242. `OJ-016` (P0) Hardened OJ billing selected-row state transitions (`billing_pending` lock, post-failure unlock, and billed finalization) with strict selected-ID row-count checks, preventing partial transition races from invoicing entries that never lock and avoiding duplicate future billing exposure from partially persisted lifecycle writes.
243. `SMS-030` (P0) Hardened SMS safety/idempotency persistence behavior to fail closed in production when safety tables are unavailable (with explicit `SMS_SAFETY_ALLOW_MISSING_TABLES` override), preventing fail-open sends when dedupe/rate-limit guarantees cannot be enforced.
244. `WEBHOOK-014` (P1) Hardened Twilio inbound webhook customer resolution to recover duplicate-key (`23505`) customer-create races by reloading the concurrently-created row, preventing transient 500s/retry loops and duplicate inbound processing risk under concurrent first-message arrivals.
245. `SMS-031` (P0) Hardened SMS idempotency missing-table handling across duplicate-key lookup/retry/reclaim branches to honor production fail-closed behavior, preventing residual fail-open send paths when `idempotency_keys` is unavailable mid-claim lifecycle.
246. `CRON-041` (P0) Hardened private booking-monitor reminder duplicate checks to fail closed on queue lookup errors and added production-default schema-gap blocking for its send guard, preventing reminder sends when duplicate/state safety checks are unavailable.
247. `PB-014` (P1) Hardened private-booking `status=completed` thank-you SMS duplicate guard to skip sends when queue dedupe lookup fails, preventing fallback duplicate sends under transient DB lookup failures.
248. `CRON-042` (P0) Hardened Sunday pre-order and event guest-engagement send guards to block runs when required guard schema is unavailable in production (with explicit runtime env overrides), preventing fail-open send bursts under schema drift/migration gaps.
249. `CRON-043` (P0) Hardened parking notifications send controls by blocking guard-schema gaps in production and making reminder dedupe lookup errors fail closed, preventing repeat parking reminder sends when guard/dedupe persistence is unavailable.
250. `WEBHOOK-015` (P1) Hardened Twilio status webhook pre-update message lookup to fail closed on DB read errors (retriable `500`) instead of ACKing success, preventing silent delivery-state loss during transient persistence outages.
251. `WEBHOOK-016` (P1) Hardened Twilio inbound duplicate-SID guard to fail closed when duplicate lookup queries error, preventing ambiguous duplicate inbound processing when dedupe state cannot be verified.
252. `SMS-032` (P0) Hardened outbound `sendSMS` customer eligibility checks to fail closed on customer lookup errors/no-row results, preventing opt-out/sms-status bypass sends during transient DB read failures.
253. `SMS-033` (P0) Hardened shared SMS customer resolution (`ensureCustomerForPhone`) to fail closed on customer lookup failures and duplicate-insert conflict lookups, returning explicit `resolutionError` signals instead of silently continuing without safety context.
254. `SMS-034` (P0) Hardened `sendSMS` customer-resolution preflight to block dispatch when customer resolution safety checks fail (`customer_lookup_failed`), preventing send attempts when customer safety state cannot be trusted.
255. `SCRIPT-001` (P1) Hardened `trigger-invoice-reminders` operational script by adding fail-closed dedupe-log checks, checked overdue-status transitions, and checked reminder-log persistence so reminder emails are not sent when dedupe/persistence safety checks fail.
256. `SMS-035` (P1) Hardened OTP server action send path to fail closed when customer-resolution safety checks fail or return no customer context, preventing OTP sends from bypassing SMS safety eligibility controls during lookup outages.
257. `SCRIPT-002` (P1) Hardened manual Feb review campaign script with deterministic campaign-level SMS dedupe metadata, checked post-send booking/token persistence, and token cleanup gating (cleanup only before send), reducing replay/duplicate-send risk from partial post-send failures.
258. `PARK-005` (P1) Hardened parking payment-request and payment-confirmation SMS eligibility checks to fail closed on customer lookup errors/no-row outcomes, preventing opt-out bypass sends when customer preference state cannot be verified.
259. `SCRIPT-003` (P1) Hardened parking SMS backfill script dedupe/persistence safety by failing closed on existing-message SID lookup failures and enforcing checked notification-linkage updates, preventing fail-open backfill progression under lookup/update errors.
260. `SCRIPT-004` (P1) Hardened cancelled-parking backfill script with explicit mutation-run guard, checked booking/payment row-effects, strict payment-lookup error handling, and non-zero exit on any per-booking safety failure, preventing silent partial reconciliation and false-success maintenance runs.
261. `SCRIPT-005` (P1) Hardened reminder-flag fix script (`is_reminder_only`) with explicit mutation-run guard, fail-closed fetch/update error handling, and expected-row-count enforcement so partial/no-op mutation runs cannot exit successfully.
262. `SCRIPT-006` (P1) Hardened Twilio log backfill script to be explicitly mutation-gated and to keep `--dry-run` read-only (no customer auto-creation), preventing unintended production data mutations during rehearsal runs.
263. `SCRIPT-007` (P1) Hardened Twilio log backfill customer resolution and batch persistence to fail closed on customer lookup failures, reconcile duplicate-key customer create races, and enforce per-batch inserted-row counts, preventing fail-open duplicate customer creation and silent partial backfill writes.
264. `SCRIPT-008` (P1) Hardened invoice reminder trigger script to require explicit mutation approval and to fail closed when any reminder send/dedupe-log/audit persistence errors occur, preventing silent partial send runs that can re-open replay/retry ambiguity.
265. `PB-015` (P1) Hardened private-booking `status=completed` thank-you SMS duplicate-check to run as a fail-closed preflight before mutation, preventing booking updates from silently proceeding when dedupe safety state cannot be verified.
266. `QUEUE-009` (P1) Hardened approved-SMS dispatch race handling to return explicit conflict failures (instead of silent success) when another worker holds a fresh claim or stale-claim reclaim loses the race, preventing hidden send-state ambiguity under concurrent dispatch attempts.
267. `SCRIPT-009` (P1) Hardened parking SMS backfill script with explicit mutation-run safety gate and fail-closed completion assertions on dedupe/booking/log/persistence failures, preventing partial mutation runs from exiting successfully.
268. `QUEUE-010` (P1) Hardened private-booking queue auto-send failure handling to fail closed when `failed` status persistence/reconciliation cannot be confirmed, preventing silent queue-state drift after send failures.
269. `SCRIPT-010` (P1) Hardened manual Feb 2026 review SMS campaign script to fail closed when per-customer token/send/persistence processing errors occur, preventing partial campaign runs from exiting successfully after send-adjacent failures.
270. `SCRIPT-011` (P1) Hardened approved-duplicate cleanup script with explicit mutation guard, target-resolution fail-closed checks, checked delete/audit row effects, and non-zero completion assertion on any per-row failure, preventing silent partial duplicate-customer cleanup runs.
271. `SCRIPT-012` (P1) Hardened stuck-job cleanup script with explicit mutation guard, fail-closed processing/SMS job query handling, stale-job timestamp validation, and strict expected-row-count checks on reset/delete mutations, preventing accidental fail-open queue cleanup runs.
272. `SCRIPT-013` (P1) Hardened reminder-backlog clear script with explicit mutation-run guard plus strict query/mutation row-effect assertions on reminder/job cancellation, preventing silent partial cancellation runs from leaving reminder-send paths inconsistently active.
273. `SCRIPT-014` (P1) Hardened past-reminder remediation script with explicit mutation-run guard, fail-closed validation of reminder event context, checked row-effect assertions for reminder/job mutations, and non-zero exit on reporting-query failures, preventing unsafe partial remediation runs.
274. `SCRIPT-015` (P1) Hardened event-reminder finalization script with explicit mutation-run guard, fail-closed reminder context validation, and strict row-effect assertions on reminder/job cancellation mutations, preventing partial reminder-finalization runs from silently succeeding.
275. `SCRIPT-016` (P1) Hardened invite-reminder migration script with explicit mutation-run guard, deterministic delete-plan validation, per-booking expected delete-count checks, and fail-closed completion assertions across delete/scheduler phases, preventing partial migration runs from reporting success.
276. `SCRIPT-017` (P1) Hardened phone-cleanup remediation script with explicit mutation-run guard, fail-closed query validation, checked per-customer row-effect assertions, and non-zero exit on unresolved cleanup failures, preventing partial phone-normalization runs from silently succeeding.
277. `SCRIPT-018` (P1) Hardened Twilio-log backfill script to fail closed when any CSV row cannot resolve a customer before insert, preventing partial message-history backfills from reporting success while leaving dedupe/history gaps.
278. `SCRIPT-019` (P1) Hardened parking-SMS backfill script to treat missing notification payload fields and missing booking customer linkage as processing errors, preventing silent skip-and-success outcomes that leave unreconciled SMS rows.
279. `WAITLIST-002` (P1) Hardened waitlist-offer SMS post-send persistence handling to fail closed on critical offer/hold/token write gaps (instead of returning success-with-warning), so cron cancellation/fail-closed safeguards execute and duplicate-offer replay risk is reduced.
280. `PAY-003` (P1) Hardened event checkout pending-payment persistence by failing closed on pre-insert lookup errors, enforcing insert row-effect checks, and reconciling duplicate-key insert races before returning success, preventing ambiguous checkout persistence that can re-open duplicate-send/replay risk.
281. `PAY-004` (P1) Hardened manage-booking seat-increase checkout pending-payment persistence by failing closed on dedupe lookup errors, enforcing insert row-effect checks, and reconciling duplicate-key insert races, preventing checkout-success responses when payment persistence safety cannot be verified.
282. `SCRIPT-020` (P1) Hardened private-bookings calendar resync script with explicit mutation-run approval, checked per-booking row-effect persistence, and fail-closed completion assertions, preventing partial calendar-id backfills from exiting as successful maintenance runs.
283. `QUEUE-011` (P1) Hardened unified job enqueue unique-key dedupe checks to fail closed on lookup errors (instead of continuing insert), preventing duplicate job creation when dedupe safety state cannot be verified.
284. `FOH-011` (P1) Hardened FOH charge-request cap prechecks to fail closed on booking-cap context lookup errors, missing booking rows, and existing charge-allocation lookup errors, preventing cap/dedupe safeguards from failing open before charge-request creation.
285. `SMS-036` (P1) Hardened SMS recipient-context resolution to fail closed when booking lookup safety checks error or target booking rows are missing, preventing send paths from falling back to phone-only resolution when booking context cannot be verified.
286. `SCRIPT-021` (P1) Hardened old-SMS cleanup script with explicit mutation-run guard, fail-closed query/delete/audit checks, and strict expected-row-count assertions so stale-message/stale-job cleanup cannot silently partially succeed or exit successfully after safety-check failures.
287. `SCRIPT-022` (P1) Hardened pending-SMS cleanup script with explicit mutation-run guard, fail-closed count/update checks, strict expected-row-count assertions, and checked audit persistence so pending-message cancellation cannot silently partially succeed or exit successfully after safety-check failures.
288. `SCRIPT-023` (P1) Hardened queued-message cleanup script with explicit mutation-run guard, fail-closed message/job query checks, strict delete row-count assertions, and checked audit persistence so queue-clearing maintenance cannot silently partially succeed or report success after failed safety checks.
289. `SCRIPT-024` (P1) Hardened pending-SMS cancellation script with explicit mutation-run guard, fail-closed pending-job query checks, strict cancellation row-count assertions for both all/selected paths, and checked audit persistence so interactive queue-cancel operations cannot silently partially succeed or report success after safety-check failures.
290. `SCRIPT-025` (P1) Hardened SMS template-key remediation script with explicit mutation-run guard, fail-closed pending-job query checks, strict per-job update row-count assertions, and checked audit persistence so pending send-job template fixes cannot silently partially succeed or report success after safety-check failures.
291. `SCRIPT-026` (P1) Hardened table-booking SMS diagnostics script by adding explicit write-probe mutation gating, fail-closed diagnostics query handling, strict probe insert/delete row-count assertions, and fail-closed completion checks so diagnostic runs cannot silently succeed after probe/query safety failures.
292. `SCRIPT-027` (P1) Hardened pending-payment remediation script with explicit mutation-run guards, fail-closed booking/payment lookup handling, strict payment/booking/audit row-effect checks, and non-zero exits on safety failures so one-off payment fixes cannot silently partially mutate booking state.
293. `SCRIPT-028` (P1) Hardened queue-processing operational script with explicit mutation-run gating, fail-closed pending-job preflight checks, and a default send-job safety block (override-required) so accidental script execution cannot silently dispatch queued outbound SMS jobs.
294. `SCRIPT-029` (P1) Hardened duplicate-loyalty-program remediation script with explicit mutation-run gating, fail-closed program/member/count lookups, strict member-migration and duplicate-delete row-effect assertions, and fail-closed completion checks so one-off loyalty merges cannot silently partially mutate state or exit successfully after safety-check failures.
295. `SCRIPT-030` (P1) Hardened delete-all-table-bookings cleanup script with explicit mutation-run gating (`--confirm` + env guards), fail-closed count/query checks, strict delete row-effect assertions for booking-item/payment/booking/SMS-job cleanup, and post-run zero-state verification so destructive cleanup cannot silently partially succeed or report success after safety-check failures.
296. `SCRIPT-031` (P1) Hardened delete-test-bookings remediation script with explicit mutation-run gating, fail-closed booking/job lookups, strict payment/item/job/booking/audit row-effect assertions, and force-required guardrails for confirmed paid bookings so one-off booking cleanup cannot silently partially succeed or bypass destructive-safety intent.
297. `SCRIPT-032` (P1) Hardened delete-specific-customers remediation script with explicit mutation-run gating, fail-closed target-resolution and customer lookup checks, strict customer-delete/audit row-effect assertions, and fail-closed completion checks so one-off customer cleanup cannot silently partially mutate state or report success after safety-check failures.
298. `SCRIPT-033` (P1) Hardened delete-peter-pitcher-bookings remediation script with explicit mutation-run gating, fail-closed target booking resolution and query handling, strict booking-delete/audit row-effect assertions, and fail-closed completion checks so one-off cleanup cannot silently partially mutate state or report success after safety-check failures.
299. `SCRIPT-034` (P1) Hardened `reset-jobs`/`retry-failed-jobs` scripts with explicit mutation-run gating (`--confirm` + `RUN_JOB_RETRY_MUTATION_SCRIPT=true`), read-only default mode, fail-closed preflight query handling, and strict preflight-to-update row-count assertions so queue retry/reschedule operations cannot silently partially mutate state or run under ambiguous safety conditions.
300. `SCRIPT-035` (P1) Hardened `delete-peter-test-bookings` cleanup script with explicit mutation-run gating (`--confirm` + `RUN_DELETE_PETER_TEST_BOOKINGS_MUTATION=true`), read-only default mode, fail-closed customer/booking lookup handling, strict delete/audit row-effect assertions, and fail-closed completion checks so targeted cleanup cannot silently partially mutate state or report success after safety-check failures.
301. `SCRIPT-036` (P1) Hardened `delete-test-customers-direct` cleanup script with explicit mutation-run gating (`--confirm` + `RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true`), read-only default mode, fail-closed target query handling, strict delete/audit row-effect assertions, safe-target validation, and fail-closed completion checks so bulk customer cleanup cannot silently partially mutate state or proceed under ambiguous targeting.
302. `SCRIPT-037` (P1) Hardened `delete-test-invoices` and `delete-specific-invoice` cleanup scripts with explicit mutation-run gating (`--confirm` + run env flags), read-only default mode, fail-closed invoice/line-item/email-log query handling, strict delete/audit row-effect assertions, and fail-closed completion checks so invoice cleanup cannot silently partially mutate state or report success after safety-check failures.
303. `AUTH-007` (P1) Hardened API key rate limit enforcement to fail closed when usage lookups error, preventing rate-limited APIs from failing open during DB outages.
304. `QUEUE-012` (P1) Hardened approved private-booking SMS dispatch metadata so per-queue-row correlation IDs are recorded as `queue_job_id` (not `job_id`), preventing duplicate queue rows from bypassing distributed SMS idempotency dedupe.
305. `SCRIPT-038` (P1) Hardened `test-sms-new-customer` diagnostic script to fail closed by default, require dual send gates (`--confirm` + env flags), avoid customer auto-creation, and include deterministic SMS idempotency metadata to prevent accidental replay/duplicate sends.
306. `SCRIPT-039` (P1) Hardened `test-and-fix-sms` diagnostic script by fixing the broken admin-client import and making it strictly read-only (no queue processing or SMS sends), preventing accidental mutation/send operations during incident diagnostics.
307. `QUEUE-013` (P0) Hardened unified job enqueue unique-key handling by adding an idempotency-key lock (fail-closed under contention) to eliminate check-then-insert races that can create duplicate jobs (including bulk SMS sends), and ensured bulk SMS jobs prefer stable dispatch keys (`payload.unique_key`) as `bulk_job_id` so distributed SMS idempotency dedupe remains effective even if duplicate jobs slip through.
308. `SCRIPT-040` (P1) Hardened `send-feb-2026-event-review-sms` operational script to default to read-only/dry-run and require dual send gates (`--confirm` + `RUN_FEB_REVIEW_SMS_SEND=true` + `ALLOW_FEB_REVIEW_SMS_SEND=true`) plus explicit send caps (`--limit`/`FEB_REVIEW_SMS_SEND_LIMIT`) enforced by hard cap `200`, preventing accidental mass dispatch.
309. `PARK-006` (P1) Hardened parking payment-request SMS reminder-flag persistence to fail closed when the post-send `parking_bookings` update errors or affects no rows, preventing stale flags from re-enabling additional reminder SMS after a successful initial payment request send.
310. `SCRIPT-041` (P1) Hardened `test-table-booking-sms` diagnostic script to default to read-only/dry-run, require dual send gates (`--confirm` + `RUN_TEST_TABLE_BOOKING_SMS_SEND=true` + `ALLOW_TEST_TABLE_BOOKING_SMS_SEND=true`) plus explicit targets (`--booking-id` + `--to`), and removed direct queue job insertion using deprecated template-based SMS jobs, preventing accidental enqueue/send behavior from prod scripts.
311. `SCRIPT-042` (P0) Hardened `test-enrollment-with-sms` diagnostic script: it previously created customer/loyalty rows, generated random UK `07...` mobile numbers, enqueued and processed SMS jobs, and performed cleanup deletes (high risk of real-number SMS spam and production DB mutation). Fix: rewrite to default to read-only/dry-run; sending requires dual gates (`--confirm` + `RUN_TEST_ENROLLMENT_WITH_SMS_SEND=true` + `ALLOW_TEST_ENROLLMENT_WITH_SMS_SEND=true`) plus explicit `--customer-id` and `--to` targeting (with `--to` required to match the target customer's mobile), and route the single send through `sendSMS` with deterministic idempotency metadata (no job processing, no customer creation, no cleanup deletes).
312. `SCRIPT-043` (P0) Hardened `test-loyalty-enrollment` diagnostic script: it previously created customers with random UK phone numbers, created loyalty members, and relied on background job dispatch (plus cleanup deletes) with no gating (high risk of SMS spam and production DB mutation). Fix: rewrite to be strictly read-only and require explicit customer targeting (`--customer-id`/`TEST_LOYALTY_ENROLLMENT_CUSTOMER_ID`); the script now only inspects existing loyalty membership/welcome series state and recent `send_sms` jobs and refuses `--confirm` runs.
313. `SMS-037` (P0) Hardened the `sendSms` server action to enforce `messages.send` permission server-side. It previously relied on client-side permission checks while using the admin Supabase client, allowing unprivileged users to invoke the action and send SMS. Fix: add a `checkUserPermission('messages', 'send')` gate that fails closed before rate limiting and dispatch, with regression coverage in `tests/actions/smsActions.test.ts`.
314. `SCRIPT-044` (P0) Hardened `test-private-booking-customer-creation` diagnostic script: it previously inserted and deleted `private_bookings` rows using the service-role key with no gating (production DB mutation risk) while not actually exercising the server action. Fix: rewrite to be strictly read-only; it now only performs customer/private-booking lookups for a target phone and refuses `--confirm`/`--keep` mutation flags.
315. `SCRIPT-045` (P0) Hardened `test-critical-flows` script: it previously performed unsafe inserts/deletes across `customers`, `events`, `bookings`, `messages`, and `private_bookings` with the service-role key (including incomplete cleanup and no non-zero exit on failure). Fix: rewrite as read-only smoke checks (auth + table/RPC availability) and exit non-zero when any check fails.
316. `QUEUE-014` (P0) Hardened UnifiedJobQueue lease enforcement: if a job lease refresh fails (or affects no rows), abort execution and fail the job rather than continuing side effects without an active lease, reducing duplicate-processing and duplicate-send risk under lease-expiry/stale-reset races.
317. `MSG-002` (P0) Hardened Twilio missed-message import server action to fail closed when existing-message or customer lookups error, and to create placeholder customers with SMS deactivated (`sms_status='sms_deactivated'`, `sms_opt_in=false`) instead of SMS-eligible defaults, preventing fail-open duplicate imports and preventing backfill-created customers from becoming SMS-eligible.
318. `SCRIPT-046` (P0) Hardened legacy Twilio backfill script (`src/scripts/import-missed-messages.ts`) by rewriting it as strictly read-only and blocking `--confirm`, preventing accidental service-role inserts of customers/messages and unsafe opt-in assumptions during incident response.
319. `SMS-038` (P0) Hardened customer SMS opt-out handling: `CustomerService.toggleSmsOptIn` previously updated only `sms_opt_in` while outbound SMS eligibility checks rely on `sms_status`, allowing opted-out customers to remain SMS-eligible. Fix: update `sms_status` alongside `sms_opt_in` (`active`/`opted_out`) and disable `marketing_sms_opt_in` on opt-out, ensuring opt-out transitions actually block future sends.
320. `SMS-039` (P0) Hardened bulk SMS campaign dispatch to require `sms_opt_in=true`, `marketing_sms_opt_in=true`, and non-blocked `sms_status` (and prefer `mobile_e164`) before sending, and to fail closed on customer/event/category context lookup errors, preventing bulk marketing sends to non-consented or opted-out customers and preventing context lookups from degrading into placeholder-text sends.
321. `MSG-003` (P1) Hardened `diagnoseMessages` action to use the admin Supabase client and fail closed when the messages-table lookup errors (and to skip DB checks when Twilio returns zero messages), preventing incident triage from reporting false-positive “missing” messages during DB outages.
322. `SMS-040` (P1) Hardened bulk customer selection (`/api/messages/bulk/customers`) to enforce marketing eligibility (`sms_opt_in=true`, `marketing_sms_opt_in=true`, and non-blocked `sms_status`), aligning recipient selection and counts with bulk dispatch gating and preventing non-consented or opted-out customers from appearing in bulk send audiences.
323. `SMS-041` (P0) Hardened `sendSMS` customer eligibility checks to block `sms_opt_in=false` recipients even when `sms_status` is `null`/`active`, preventing legacy opt-outs (pre-`sms_status` adoption) from remaining SMS-eligible.
324. `WAITLIST-002` (P1) Hardened waitlist-offer SMS sending to fail closed when event lookups error or affect no rows, preventing placeholder `"your event"` content from being sent when event context cannot be verified.
325. `WAITLIST-003` (P1) Hardened guest waitlist-offer acceptance confirm route SMS helper to fail closed when customer/event lookups error or event is missing, preventing acceptance confirmation SMS from sending with unverifiable event context.
326. `SCRIPT-047` (P0) Hardened Twilio log backfill script (`backfill-twilio-log`) to default to dry-run, require explicit mutation gating (`--confirm` + env allow flags) plus explicit capped limits before any DB writes, and ensure any placeholder customers created during backfills are SMS-deactivated and opted out by default, preventing backfill operations from accidentally enabling SMS eligibility or performing unbounded inserts.
327. `SMS-042` (P0) Hardened manual-send customer resolution: `resolveCustomerIdForSms` now refuses to create new customers when sending to arbitrary phone numbers without booking/customer context, and instead resolves only existing customers (or fails closed), preventing manual-send flows from silently expanding the SMS-eligible population and reducing accidental spam risk.
328. `QUEUE-015` (P0) Hardened queue-driven `send_sms` job execution to fail closed when `customer_id` is missing, preventing queue workers from auto-creating customers and sending SMS without verified recipient context.
329. `WEBHOOK-017` (P0) Hardened Twilio inbound opt-out keyword handling to fail closed when the customer preference update fails or affects no rows (retriable `500`), preventing silent STOP compliance drops and ensuring retries do not get short-circuited by duplicate inbound message persistence.
330. `EVENT-008` (P1) Hardened event manual-booking table-reservation conflict rollback to fail closed when rollback persistence fails (booking cancel or hold release), preventing “blocked” success responses while leaving confirmed bookings/holds in an inconsistent state.
331. `SMS-043` (P0) Hardened `resolveCustomerIdForSms` to fail closed when a provided `customerId` or private-booking context does not match the destination phone (`to`), preventing opt-out/eligibility bypasses and mis-attributed manual sends to arbitrary numbers.
332. `SMS-044` (P0) Hardened `sendSMS` to fail closed when a provided `customerId` does not match the destination phone (`to`), preventing opt-out/eligibility bypasses and mis-attributed sends via mismatched customer context.
333. `SCRIPT-048` (P1) Hardened `test-server-action-import` diagnostic script to be strictly read-only (no server-action calls) and to exit non-zero on import failures, preventing accidental SMS enqueue/send side effects and false-success diagnostics during incident response.
334. `SCRIPT-049` (P0) Hardened `test-cron-endpoint` diagnostic script: it previously POSTed to `/api/jobs/process` using a real `CRON_SECRET` (defaulting to production URL), which can process jobs and trigger outbound side effects (SMS/email), while also exiting 0 on failures (false-success diagnostics). Fix: the script is now strictly read-only; it performs only an authenticated GET health check (`/api/jobs/process?health=true`), asserts unauthenticated access is rejected, never calls POST, and fails closed by setting `process.exitCode=1` on any failure.
335. `SCRIPT-050` (P1) Hardened `test-customer-labels-cron` diagnostic script: it previously invoked the live `/api/cron/apply-customer-labels` route with a real `CRON_SECRET` by default (production DB mutation risk), printed parts of the secret, and could exit 0 on failure. Fix: add an authorized read-only `?health=true` mode to the route (no RPC/audit writes), and rewrite the script to be strictly read-only (health-check only), verify unauth access is rejected, avoid secret printing, and fail closed via `process.exitCode=1` on any failure.
336. `SCRIPT-051` (P1) Hardened `test-employee-creation` diagnostic script: it previously inserted/deleted employee records (and financial/health details) using the Supabase service-role key with no gating (production DB mutation risk) and could leave partial data behind on error. Fix: rewrite as strictly read-only table diagnostics (select-only), and fail closed via `process.exitCode=1` on any query/env error.
337. `SCRIPT-052` (P1) Hardened `test-short-link-crud` diagnostic script: it previously inserted/updated/deleted short links using the Supabase service-role key with no gating (production DB mutation risk) and could exit 0 on failures. Fix: rewrite as strictly read-only diagnostics (select-only) and fail closed via `process.exitCode=1` on any query/env error.
338. `SCRIPT-053` (P1) Hardened event image-field diagnostic scripts: `test-event-crud-fixed` and `test-event-image-fields` previously inserted/updated/deleted events and categories using the Supabase service-role key with no gating (production DB mutation risk) to probe schema behavior. Fix: rewrite both scripts as strictly read-only schema diagnostics (select-only), including explicit checks that legacy `events.image_url` is not selectable, and fail closed via `process.exitCode=1` on any query/env error.
339. `SCRIPT-054` (P0) Hardened `test-booking-api` diagnostic script: it previously POSTed to the production booking initiation API (`https://management.orangejelly.co.uk/api/bookings/initiate`) using a baked-in test phone number (`07700900123`) with no explicit send gating (high risk of accidental booking creation and outbound SMS spam during incident diagnostics). Fix: default to dry-run unless `--confirm` is provided; require dual send gates (`RUN_TEST_BOOKING_API_SEND=true` + `ALLOW_TEST_BOOKING_API_SEND=true`), plus remote/prod-specific gating (`ALLOW_TEST_BOOKING_API_REMOTE=true`, `--prod` + `ALLOW_TEST_BOOKING_API_PROD=true`); remove baked-in prod URL/phone; default to `http://localhost:3000` and require explicit `--url` for remote; mask secrets/phones in logs; and fail closed via `process.exitCode=1` on any failure.
340. `SCRIPT-055` (P0) Hardened table-booking API diagnostic scripts: `test-api-booking-fix`, `test-booking-now`, `test-sunday-lunch-api`, and `test-sunday-lunch-payment-fix` previously hardcoded production URLs and/or embedded API keys and baked-in phone numbers while POSTing booking creation requests by default (high risk of accidental production booking creation and outbound SMS spam, plus secret leakage risk). Fix: remove baked-in prod URLs/API keys/phones; default to dry-run; require explicit multi-gate send enablement (`--confirm` + `RUN_TEST_TABLE_BOOKING_API_SEND=true` + `ALLOW_TEST_TABLE_BOOKING_API_SEND=true`), plus remote/prod-specific gating (`--url` + `ALLOW_TEST_TABLE_BOOKING_API_REMOTE=true`, `--prod` + `ALLOW_TEST_TABLE_BOOKING_API_PROD=true`); mask secrets/phones in logs; add deterministic `Idempotency-Key`; and fail closed via `process.exitCode=1` on any failure.
341. `SCRIPT-056` (P0) Hardened audit log diagnostic scripts: `test-audit-log` and `test-audit-log-rls` previously inserted rows into `audit_logs` (and attempted to create helper functions via RPC) using admin/service-role clients with no gating, risking production DB mutation during incident diagnostics. Fix: rewrite both scripts as strictly read-only diagnostics (select/RPC only), block `--confirm`, remove all insert/helper-function creation attempts, and fail closed via `process.exitCode=1` on any query/RPC error.
342. `SCRIPT-057` (P0) Hardened API key and deployment diagnostic scripts: `test-api-complete-fix`, `check-deployment-status`, and `check-api-key-database` previously embedded real API keys and defaulted to production booking-creation POSTs (and the DB script printed full API keys), creating high risk of accidental production booking creation/outbound SMS and secret leakage. Fix: remove all hardcoded API keys; default to dry-run/read-only; require explicit multi-gate send enablement for any booking-creation POST; avoid production URL defaults; mask sensitive output; and fail closed via `process.exitCode=1` on any failure.
343. `SCRIPT-058` (P1) Hardened `test-demographics` diagnostic script: it previously inserted test short links and click rows (and deleted them during cleanup) using the Supabase service-role key with no gating, creating production DB mutation risk during incident diagnostics. Fix: rewrite as strictly read-only analytics diagnostics (select/RPC only), require explicit `--short-code`, block `--confirm`, add strict caps (`--days`, click sample limit), and fail closed via `process.exitCode=1` on any query/RPC error.
344. `SCRIPT-059` (P1) Hardened `resync-private-bookings-calendar` operational script: it previously performed unbounded calendar sync + DB updates for all upcoming private bookings with only a single env gate and no dry-run default, creating production mutation risk and external side effects during incident response. Fix: default to dry-run, require explicit multi-gate mutation enablement (`--confirm` + dual env gates) plus explicit caps (`--limit` or `--booking-id`), avoid processing already-synced bookings by default, and fail closed via `process.exitCode=1` on any failure.
345. `SCRIPT-060` (P1) Hardened calendar sync testing scripts (`test-calendar-sync`, `test-calendar-sync-admin`, `test-calendar-final`, `test-booking-calendar-sync`): they previously performed external Google Calendar writes and `private_bookings` updates with no gating (and could log-and-continue on failed updates), creating production mutation risk during incident diagnostics. Fix: rewrite as strictly read-only diagnostics, block `--confirm`, remove `syncCalendarEvent` calls and all DB mutation paths, and fail closed via `process.exitCode=1`.
346. `SCRIPT-061` (P1) Hardened `send-feb-2026-event-review-sms` bulk SMS operational script: it previously baked in a production app URL fallback and used `process.exit(...)`, increasing risk of accidental production link sends and making safety checks harder to test. Fix: default to `http://localhost:3000` (never production) unless `NEXT_PUBLIC_APP_URL`/`--url` is provided (and require explicit URL when sending), and fail closed via `process.exitCode=1`.
347. `SMS-045` (P0) Removed legacy `job_id` from SMS idempotency dedupe context keys: it previously remained in `DEDUPE_CONTEXT_KEYS`, so including per-job correlation IDs could bypass distributed SMS dedupe and trigger duplicate sends. Fix: exclude `job_id` from the dedupe context and add regression coverage ensuring `metadata.job_id` does not affect the dedupe key/hash.
348. `SMS-046` (P1) Hardened private-booking SMS queue auto-send so system contexts (cron/services) no longer depend on the RBAC-gated `sendSms` server action (which requires an authenticated user session and can fail with `Insufficient permissions`). Auto-send now resolves recipient context via `resolveCustomerIdForSms` and dispatches via transport-level `sendSMS` with stable idempotency metadata (`template_key`, `trigger_type`, `stage` + queue correlation), preserving dedupe/safety guards while allowing legitimate reminder sends.
349. `SCRIPT-062` (P1) Hardened `fix-past-reminders` operational script (cancels past-event reminders and deletes pending SMS jobs) to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_FIX_PAST_REMINDERS_MUTATION=true` + `ALLOW_FIX_PAST_REMINDERS_MUTATION=true`), explicit operation selection (`--cancel-reminders` and/or `--delete-pending-sms-jobs`), and explicit capped limits (`--reminder-limit`/`--job-limit`, hard cap `500`) before any DB writes. Mutations fail closed via strict row-effect assertions.
350. `EVENT-009` (P1) Hardened manual event booking cancellation (`cancelEventManualBooking`) to fail closed when follow-up DB updates (releasing booking holds and cancelling linked table bookings) error, preventing false-success cancellations that leave related state inconsistent (and can re-trigger downstream reminders/notifications).
351. `SCRIPT-063` (P1) Hardened `cleanup-phone-numbers` operational script to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_CLEANUP_PHONE_NUMBERS_MUTATION=true` + `ALLOW_CLEANUP_PHONE_NUMBERS_MUTATION=true`) plus an explicit capped limit (`--limit`/`CLEANUP_PHONE_NUMBERS_LIMIT`, hard cap `500`) before any DB updates, preventing unbounded service-role mutations during incident response. The update path now guards check-then-update races by requiring the original phone number to match when applying the cleaned value.
352. `SCRIPT-064` (P1) Hardened `clear-stuck-jobs` operational script to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_CLEAR_STUCK_JOBS_MUTATION=true` + `ALLOW_CLEAR_STUCK_JOBS_MUTATION=true`), explicit operation selection (`--fail-stale-processing` and/or `--delete-pending-sms-jobs`), and explicit capped limits (`--stale-limit`/`--pending-limit`, hard cap `500`) before failing or deleting job rows, preventing unbounded job mutation/deletion during incident response.
353. `SCRIPT-065` (P1) Hardened `clear-reminder-backlog` operational script to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_CLEAR_REMINDER_BACKLOG_MUTATION=true` + `ALLOW_CLEAR_REMINDER_BACKLOG_MUTATION=true`), explicit operation selection (`--cancel-reminders` and/or `--cancel-jobs`), and explicit capped limits (`--reminder-limit`/`--job-limit`, hard cap `500`) before cancelling reminder rows or reminder-processing jobs, preventing unbounded reminder/job mutation during incident response.
354. `SCRIPT-066` (P1) Hardened `finalize-event-reminders` operational script to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_FINALIZE_EVENT_REMINDERS_MUTATION=true` + `ALLOW_FINALIZE_EVENT_REMINDERS_MUTATION=true`), explicit operation selection (`--cancel-reminders` and/or `--cancel-jobs`), and explicit capped limits (`--reminder-limit`/`--job-limit`, hard cap `500`) before cancelling reminder rows or reminder-processing jobs, preventing unbounded reminder/job mutation during incident response.
355. `SCRIPT-067` (P1) Hardened `migrate-invite-reminders` operational script to default to dry-run and require explicit mutation gating (`--confirm` + `RUN_MIGRATE_INVITE_REMINDERS_MUTATION=true` + `ALLOW_MIGRATE_INVITE_REMINDERS_MUTATION=true`), explicit capped booking batches (`--booking-limit`/`MIGRATE_INVITE_REMINDERS_BOOKING_LIMIT`, hard cap `500`), and explicit operation selection (`--delete-legacy-reminders` and/or `--reschedule`) with `--reschedule` requiring deletion to avoid duplicate reminders, preventing unbounded reminder mutation during incident response.
356. `SMS-047` (P0) Hardened the core `sendSMS` pipeline to surface outbound message logging failures explicitly via `code: 'logging_failed'` + `logFailure: true` (instead of swallowing `messages` insert failures and returning plain success), preventing safety limits from silently undercounting sends; `sendBulkSms` now aborts fanout loops on fatal safety failures (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) so bulk dispatch cannot continue when safety/persistence cannot be trusted.
357. `SCRIPT-068` (P1) Hardened SMS diagnostic scripts (`scripts/testing/test-sms-flow.ts`, `scripts/database/check-sms-issue.ts`) to be strictly read-only and fail closed: fixed a variable redeclaration bug that broke `test-sms-flow` execution, replaced `.catch(console.error)`/fail-open error handling with explicit `process.exitCode = 1` markers, and added regression tests to prevent future fail-open regressions during incident triage.
358. `SCRIPT-069` (P0) Hardened additional SMS diagnostics scripts (`scripts/database/check-sms-jobs.ts`, `scripts/database/check-bulk-sms-jobs.ts`, `scripts/database/check-sms-queue.ts`, `scripts/database/check-table-booking-sms.ts`, `scripts/testing/test-sms-new-customer.ts`) to fail closed and avoid unsafe mutations: removed an ungated template auto-create (`insert`) from `check-table-booking-sms`, fixed broken imports/invalid output formatting in check scripts, replaced `.catch(console.error)` and `process.exit(...)` with `process.exitCode = 1` fail-closed markers, and extended regression coverage so these scripts cannot silently exit 0 on error.
359. `QUEUE-016` (P0) Hardened queue-driven SMS dispatch to honor fatal `sendSMS` safety signals: UnifiedJobQueue now treats `logging_failed` (`logFailure: true`) as a fatal failure (transport send succeeded but outbound `messages` persistence failed), treats `safety_unavailable`/`idempotency_conflict` as fatal batch abort signals, serializes `send_sms`/`send_bulk_sms` jobs so the first fatal failure requeues the remaining send jobs, and legacy JobQueue `send_sms` fails closed on `logging_failed`. Manual send actions (`sendSms`, `sendOTPMessage`) now surface `code`/`logFailure` so callers can detect partial failures without treating the transport send as unsuccessful.
360. `QUEUE-017` (P0) Hardened private-booking SMS queue send paths to surface fatal `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`) and persist them as `sms_code`/`sms_log_failure` markers in `private_booking_sms_queue.metadata`, improving fail-closed detectability and post-incident reconciliation without misclassifying transport-level sends as failures.
361. `MSG-004` (P1) Hardened message-thread reply sending (`MessageService.sendReply`) to surface `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`) so UI callers can detect degraded outbound-message persistence without treating transport sends as failures.
362. `SMS-048` (P1) Hardened the BOH manual table-booking SMS route (`/api/boh/table-bookings/[id]/sms`) to surface `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`) in its success response so UI callers can detect degraded outbound message logging without retrying transport sends.
363. `EVENT-010` (P1) Hardened event booking seat-update SMS helper (`sendEventBookingSeatUpdateSms`) to propagate `sendSMS` safety signals (`code`/`logFailure`) instead of collapsing to a boolean, so callers can distinguish transport success from degraded outbound-message persistence.
364. `WAITLIST-004` (P0) Hardened event waitlist-offers cron processing to abort remaining sends when `sendSMS` reports fatal safety signals (`code: 'logging_failed'` / `logFailure: true`), preventing waitlist-offer fanout while outbound message persistence (and safety limits) are degraded.
365. `SMS-049` (P0) Hardened Sunday pre-order cron (`/api/cron/sunday-preorder`) to fail closed when message dedupe lookups error and to abort remaining sends when `sendSMS` reports fatal safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`), preventing continued fanout when outbound message persistence/dedupe cannot be trusted.
366. `SMS-050` (P0) Hardened private booking monitor cron (`/api/cron/private-booking-monitor`) to fail closed when private feedback message dedupe lookups error and to abort remaining sends when SMS dispatch reports fatal safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`), returning HTTP 200 with abort metadata (to avoid retry loops) while persisting a failed run result; also propagated `code`/`logFailure` through private-booking expiration and queue send results so the cron can detect degraded outbound message logging.
367. `SMS-051` (P0) Hardened parking notifications cron (`/api/cron/parking-notifications`) to abort remaining sends when `sendSMS` reports fatal safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`) and to fail closed when `parking_booking_notifications` persistence fails after a successful transport send (so its own dedupe history cannot silently degrade); removed `Promise.all` concurrency between payment-lifecycle and session-reminder passes so an abort in one pass reliably stops the other, and returned HTTP 200 with explicit abort metadata while persisting a failed run result (avoiding retry-driven resend loops).
368. `SMS-052` (P0) Hardened event guest engagement cron (`/api/cron/event-guest-engagement`) to fail closed when `messages` dedupe lookups error and to abort remaining sends when `sendSMS` reports fatal safety signals (`logFailure` / `code: 'logging_failed'`, plus `safety_unavailable` / `idempotency_conflict`); removed `Promise.all` concurrency between SMS-producing passes so a single abort reliably stops the rest, and returned HTTP 200 with explicit abort metadata while persisting a failed run result (avoiding retry-driven resend loops).
369. `SMS-053` (P1) Hardened FOH food order alert route (`/api/foh/food-order-alert`) to surface `sendSMS` safety signals (`code`/`logFailure`, including `logging_failed`) in its success payload and log explicitly on outbound-message logging failures, preventing the UI/operator from misclassifying partial logging failures as full success while keeping HTTP 200 to avoid retry-driven duplicate sends.
370. `SCRIPT-070` (P1) Further hardened SMS cleanup scripts (`scripts/cleanup/delete-old-sms-messages.ts`, `scripts/cleanup/delete-all-queued-messages.ts`, `scripts/cleanup/delete-all-pending-sms.ts`, `scripts/cleanup/delete-pending-sms.ts`) to default to dry-run and require explicit multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`) plus explicit capped limits (with hard caps) before any delete/update operations; also removed the interactive `readline` cancellation flow and ensured fail-closed completion uses `process.exitCode` (no `process.exit`).
371. `SCRIPT-071` (P1) Hardened SMS testing scripts (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) to fail non-zero when `sendSMS` reports transport success but outbound message logging failed (`code: 'logging_failed'` / `logFailure: true`), preventing false-green incident diagnostics and reducing resend-loop risk when `messages` persistence is degraded.
372. `SMS-054` (P1) Hardened non-cron send surfaces (public event booking + waitlist join, FOH event booking create, table booking create, and event admin manual booking actions) to surface `sendSMS` safety signals (`success`/`code`/`logFailure`, including `logging_failed`) via `meta.sms` and log an explicit `logger.error` when outbound message logging failed, preventing invisible partial failures while keeping success HTTP statuses to avoid retry-driven duplicate sends.
373. `PARK-007` (P1) Hardened parking payment SMS notification logging to persist `sms_code` and `sms_log_failure` markers in `logParkingNotification` payloads (payment request + payment confirmation), and emit explicit `logger.error` events when `sendSMS` reports a transport-success-but-log-failed outcome (`code: 'logging_failed'` / `logFailure: true`), improving reconciliation and making degraded outbound message persistence observable.
374. `SMS-055` (P1) Hardened event payment confirmation + retry SMS notifications (`sendEventPaymentConfirmationSms`, `sendEventPaymentRetrySms`) to log an explicit error when outbound message logging fails (`code: 'logging_failed'` / `logFailure: true`) and include `code` in non-success warn logs, making Stripe webhook-triggered payment notifications observable during `messages` persistence degradation without triggering retry-driven duplicate sends.
375. `SCRIPT-072` (P0) Hardened `scripts/clear-cashing-up-data.ts` to be safe-by-default: it now defaults to dry-run, requires explicit multi-gating (`--confirm` + `RUN_CLEAR_CASHING_UP_DATA_MUTATION=true` + `ALLOW_CLEAR_CASHING_UP_DATA_MUTATION_SCRIPT=true`), requires an explicit `--limit` with a hard cap (`5000`), deletes only selected IDs (no unbounded table deletes), enforces strict row-effect assertions, and fails closed via `process.exitCode=1` on any error, preventing accidental production data wipes or false-green maintenance runs.
376. `SCRIPT-073` (P1) Hardened additional operational scripts: `scripts/verify-hiring-flow.ts` now defaults to dry-run and requires explicit multi-gating (`--confirm` + `RUN_VERIFY_HIRING_FLOW_MUTATION=true` + `ALLOW_VERIFY_HIRING_FLOW_MUTATION_SCRIPT=true`) before creating/deleting hiring records, and `scripts/debug-outstanding.ts` now fails closed (non-zero exit) on any query/RPC error, preventing false-green diagnostics during incident response.
377. `SCRIPT-074` (P1) Hardened script error handling across `scripts/` by removing `.catch(console.error)` tails that could swallow errors and exit `0` (false-green diagnostics). All scripts now use a fail-closed catch handler that sets `process.exitCode=1`, and a regression test blocks reintroducing `.catch(console.error)` in future script edits.
378. `QUEUE-018` (P1) Hardened private-booking SMS queue duplicate suppression against check-then-insert races: `SmsQueueService.queueAndSend` previously performed a read-then-insert duplicate guard without an atomic lock, allowing concurrent calls to race and create duplicate queue rows (and increasing duplicate-send risk if safety persistence is degraded). Fix: acquire a short-lived idempotency-key lock around the duplicate lookup + queue insert, and fail closed when the lock is held and no existing queue row is found.
379. `SMS-056` (P1) Hardened private-booking SMS side effects to avoid fail-open error handling: `PrivateBookingService` previously used `.catch(console.error)` on SMS queue-and-send calls, swallowing thrown exceptions and hiding queue/send failures and `logFailure` safety signals from callers. Fix: remove `.catch(console.error)`, capture per-trigger SMS side-effect summaries on returned booking objects, and emit structured error logs when queue/send fails or outbound message logging fails.
380. `EVENT-011` (P1) Hardened event booking seat-update SMS observability: `sendEventBookingSeatUpdateSms` previously propagated `code`/`logFailure` but did not emit an explicit error when `sendSMS` reported a transport-success-but-log-failed outcome (`code: 'logging_failed'` / `logFailure: true`), leaving degraded outbound message persistence harder to detect in Stripe webhook, guest, and staff seat-update flows. Fix: log `logger.error` on `logFailure` and include `code`/`logFailure` in non-success warn logs.
381. `IDEMP-004` (P0) Hardened booking-create idempotency fail-closed behavior: `/api/public/private-booking` and `/api/external/create-booking` previously released idempotency claims when `persistIdempotencyResponse` errored after booking creation, deleting `idempotency_keys` rows and allowing retries to create duplicate bookings (and downstream duplicate notifications/SMS) during DB/idempotency-write degradation. Fix: catch idempotency-response persistence failures, return HTTP 201 with the created booking reference, log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once a booking is created.
382. `IDEMP-005` (P0) Hardened public booking idempotency persistence failures to prevent retry-driven duplicate notifications: `/api/event-bookings`, `/api/event-waitlist`, and `/api/table-bookings` previously released idempotency claims when `persistIdempotencyResponse` errored after successful RPC mutations and outbound SMS/email side effects, deleting `idempotency_keys` rows and allowing client retries to re-trigger the same mutation and re-send notifications during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal for the HTTP response, log structured errors, and intentionally keep the idempotency claim once a booking/waitlist entry has been created.
383. `SMS-058` (P1) Hardened SMS server action error handling to avoid fail-open console logging: `src/app/actions/sms.ts` previously used `console.error` in OTP/manual-send catch blocks, bypassing structured logging and increasing the chance of silent diagnostics near send paths. Fix: replace with structured `logger.error` (without logging message bodies) and add a regression guard preventing direct `console.*` logging in SMS actions.
384. `IDEMP-006` (P0) Hardened Stripe webhook replay safety when idempotency persistence fails: `/api/stripe/webhook` previously released idempotency claims when `persistIdempotencyResponse` failed after successful event processing, allowing Stripe retries to replay mutations and re-send notifications during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 200), log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once processing completes.
385. `WEBHOOK-018` (P1) Hardened Stripe webhook blocked-checkout behavior to avoid retry-driven duplicates: `/api/stripe/webhook` previously allowed `sendEventPaymentRetrySms` exceptions to bubble in the blocked checkout-session flow, returning HTTP 500 and triggering Stripe retries that can amplify duplicate notifications. Fix: catch and log retry-SMS errors and continue to persist the webhook idempotency response.
386. `IDEMP-007` (P0) Hardened PayPal parking webhook replay safety when idempotency persistence fails: `/api/webhooks/paypal/parking` previously released idempotency claims when `persistIdempotencyResponse` failed after successful processing, enabling retry-driven replay of non-transactional side effects (webhook logs/audit logs) and weakening replay safety during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 200), log structured errors, and intentionally keep the idempotency claim once processing completes (and replace `console.*` logging with structured `logger`).
387. `SMS-059` (P1) Hardened private booking server actions to surface SMS side-effect safety meta: `recordDepositPayment`, `recordFinalPayment`, `cancelPrivateBooking`, and `sendApprovedSms` previously returned success without surfacing `smsSideEffects` summaries or approved-send `code`/`logFailure`, hiding `logging_failed` signals from the UI and increasing retry-driven duplicate-send risk during degraded outbound-message logging. Fix: propagate SMS side-effect summaries and approved-send `code`/`logFailure` to callers, log explicitly on outbound-message logging failure, and standardize action returns to include `success: boolean` so callers can safely branch without relying on missing properties.
388. `IDEMP-008` (P0) Hardened idempotency persist failures for additional non-cron mutation routes: `/api/private-booking-enquiry`, `/api/parking/bookings`, and `/api/external/performer-interest` previously released idempotency claims when `persistIdempotencyResponse` errored after successful booking/submission creation, deleting `idempotency_keys` rows and allowing client retries to replay mutations and re-send downstream notifications during DB/idempotency-write degradation. Fix: treat idempotency-response persistence failures as non-fatal (return HTTP 201/200), log structured errors, and intentionally keep the idempotency claim (skip `releaseIdempotencyClaim`) once the mutation is committed; also replaced remaining `console.*` logging near these write paths with structured `logger`.
389. `SMS-061` (P1) Hardened SMS reply + bulk-enqueue server actions to avoid fail-open console logging: `sendSmsReply` (`src/app/actions/messageActions.ts`) and `enqueueBulkSMSJob` (`src/app/actions/job-queue.ts`) previously used `console.error` in catch blocks, bypassing structured logging on send/enqueue paths and reducing incident diagnosability. Fix: replace with structured `logger.error` (without logging message bodies) and add a regression guard blocking direct `console.*` logging in these actions.
390. `EVENT-013` (P1) Hardened event server actions to avoid fail-open console logging: `src/app/actions/events.ts` previously used `console.error` in multiple error paths (including booking create/cancel and SMS send exception handling), bypassing structured logging and reducing incident diagnosability. Fix: replace with structured `logger` calls (avoid logging message bodies) and add a regression guard blocking direct `console.*` logging in event actions.
391. `FOH-012` (P1) Hardened FOH/BOH table-booking party-size update routes to avoid fail-open console logging: `src/app/api/foh/bookings/[id]/party-size/route.ts` and `src/app/api/boh/table-bookings/[id]/party-size/route.ts` previously used `console.error` in write-path error handling, bypassing structured logging and reducing incident diagnosability. Fix: replace with structured `logger.error` calls and add a regression guard blocking direct `console.*` logging in these route handlers.
392. `EVENT-014` (P1) Hardened admin event booking seat-update action to avoid swallowed side-effect failures: `updateEventManualBookingSeats` (`src/app/actions/events.ts`) previously ran linked table-booking party-size sync + analytics via `Promise.allSettled` but ignored results, swallowing Supabase errors and hiding partial-failure state after the booking update commit. Fix: inspect outcomes, log structured errors on table sync failures/rejections (without failing the booking update), and surface `meta.table_booking_sync` plus `meta.sms` safety markers in the action result.
393. `MSG-006` (P1) Hardened missed-message import action to avoid fail-open console logging: `importMissedMessages` (`src/app/actions/import-messages.ts`) previously used `console.error` across permission, Twilio, and Supabase failure paths, bypassing structured logging near `messages` writes. Fix: replace with structured `logger` calls (avoid logging message bodies) and add a regression guard blocking direct `console.*` logging in this action.
394. `WEBHOOK-019` (P1) Hardened Stripe webhook side-effect visibility to avoid swallowed async/Supabase failures: `/api/stripe/webhook` previously ran table card-capture and prepaid event payment confirmation side effects via `Promise.allSettled(...)` but ignored outcomes, swallowing fulfilled Supabase `{ error }` results and hiding rejected SMS tasks in confirmation flows. Fix: inspect `Promise.allSettled` results and log structured warnings/errors for rejected promises and fulfilled Supabase errors while preserving HTTP 200 semantics to avoid retry-driven duplicate sends. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts`.
395. `PB-016` (P1) Hardened private booking actions to avoid fail-open console logging: `src/app/actions/privateBookingActions.ts` previously used `console.error` across many read/mutation paths, bypassing structured logging and reducing incident diagnosability near booking writes (including SMS queue surfaces in the same module). Fix: replace direct console logging with structured `logger.error` via a shared `logPrivateBookingActionError(...)` helper and add a regression guard blocking `console.*` usage in this action file. Regression: `tests/actions/privateBookingActionsConsoleGuards.test.ts`.
396. `MSG-007` (P1) Hardened message inbox actions and unread-count route to avoid fail-open console logging: `src/app/actions/messagesActions.ts` and `src/app/api/messages/unread-count/route.ts` previously used `console.error` in Supabase failure paths, bypassing structured logging near `messages` reads/writes and weakening incident diagnosability. Fix: replace direct `console.*` usage with structured `logger` calls (including normalized `Error` instances) and add regression guards blocking `console.*` usage in both modules. Regression: `tests/actions/messagesActionsConsoleGuards.test.ts`, `tests/api/messagesUnreadCountRouteConsoleGuards.test.ts`.
397. `FOH-013` (P1) Hardened FOH create-booking route manual walk-in override cleanup to fail closed: `src/app/api/foh/bookings/route.ts` previously attempted to clean up a newly inserted `table_bookings` row after table-assignment conflicts via `Promise.allSettled([...deletes])` but ignored the outcomes, risking an orphan `status='confirmed'` booking without assignments (availability corruption) under DB degradation. Fix: inspect cleanup outcomes, attempt a fail-closed cancellation fallback when delete fails, and emit structured `logger.error` with per-step failure metadata. Regression: `tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts`.
398. `SMS-063` (P1) Hardened the BOH manual table-booking SMS route to avoid swallowed send exceptions: `src/app/api/boh/table-bookings/[id]/sms/route.ts` previously swallowed unexpected `sendSMS` exceptions (catch without logging) and returned HTTP 502 with no structured error context, weakening incident diagnosability on a manual send surface. Fix: capture and log the exception via structured `logger.error` with booking/customer metadata (no message bodies). Regression: extended `tests/api/bohTableBookingSmsRouteSafety.test.ts`.
399. `DIAG-001` (P1) Hardened Twilio/messages diagnostic actions to avoid fail-open console logging: `src/app/actions/diagnose-messages.ts` and `src/app/actions/diagnose-webhook-issues.ts` previously used `console.log/error`, bypassing structured logging and weakening incident diagnosability during message/webhook diagnostics. Fix: replace `console.*` with structured `logger` calls and add a regression guard blocking direct `console.*` usage in these modules. Regression: `tests/actions/diagnosticActionsConsoleGuards.test.ts`.
400. `FOH-014` (P1) Hardened FOH event booking side-effect visibility to avoid swallowed promise rejections: `src/app/api/foh/event-bookings/route.ts` previously ran analytics + manager-email + optional SMS side effects via `Promise.allSettled(...)` but ignored outcomes, so a rejected manager-email send could be silently swallowed. Fix: label side-effect tasks, inspect `Promise.allSettled` outcomes, and emit structured `logger.warn` events when any task rejects while still returning HTTP 201/200 to avoid retry-driven duplicates after successful booking creation. Regression: extended `tests/api/fohEventBookingsSmsMeta.test.ts`.
401. `TB-004` (P1) Hardened table booking create route side effects to avoid retry-driven duplicates on unexpected rejections: `src/app/api/table-bookings/route.ts` previously awaited post-RPC SMS/email/hold-alignment helpers without guarding promise rejections, so a throw after booking creation could return HTTP 500 before idempotency response persistence (retry-driven duplicate-send risk). Fix: wrap side-effect helpers in try/catch, log structured warnings on rejection, and surface `meta.sms` as `{ success: false, code: 'unexpected_exception', logFailure: false }` when the SMS helper rejects so the route can still persist the idempotency response and return HTTP 201. Regression: extended `tests/api/tableBookingsRouteSmsMeta.test.ts`.
402. `SMS-064` (P0) Hardened bulk SMS direct-send action to avoid retry-driven duplicate sends on fatal logging failures: `src/app/actions/sms-bulk-direct.ts` (used by `src/app/(authenticated)/messages/bulk/page.tsx`) previously returned `{ error }` when the shared bulk helper aborted due to `logging_failed` (transport send may have occurred but outbound message persistence failed), surfacing as a UI error toast and encouraging operator retries. Fix: detect `logging_failed` aborts and return `{ success: true, code: 'logging_failed', logFailure: true }` with an explicit "do not retry" message so the UI does not prompt repeated sends during degraded persistence. Regression: `tests/actions/smsBulkDirectFailSafe.test.ts`.
403. `FOH-015` (P1) Hardened FOH food order alert route to avoid retry-driven duplicate alerts if fatal post-send persistence safety signals are surfaced as failures: `src/app/api/foh/food-order-alert/route.ts` previously returned HTTP 500 whenever `sendSMS` returned `success: false`. If a fatal post-send persistence safety signal (`logging_failed` / `logFailure: true`) is surfaced as `success: false` (consistent with some bulk/queue abort wrappers), the FOH UI would prompt operator retries and increase duplicate-alert risk during degraded persistence. Fix: treat `logging_failed`/`logFailure` as a fail-safe HTTP 200 success response (`success: true`, `code`, `logFailure`) while logging the fatal condition, preventing duplicate alerts during degraded persistence. Regression: extended `tests/api/fohFoodOrderAlertRouteSafety.test.ts`.
404. `FOH-016` (P1) Hardened FOH create booking route Sunday pre-order capture/link handling to be fail-safe after booking commit: `src/app/api/foh/bookings/route.ts` previously allowed `saveSundayPreorderByBookingId` (capture-now) to throw after a successful booking mutation, returning HTTP 500 and encouraging operator retries that can create duplicate bookings/SMS side effects. Fix: wrap Sunday pre-order capture/link handling in try/catch; on capture/link exceptions, log structured warnings and return HTTP 201 with explicit `sunday_preorder_state`/`sunday_preorder_reason` (and attempt the existing fallback link-send path) instead of throwing. Regression: `tests/api/fohBookingsSundayPreorderFailSafe.test.ts`.
405. `SMS-065` (P0) Hardened SMS server actions to fail-safe on fatal post-send persistence signals instead of returning retry-driving errors: `src/app/actions/sms.ts` still returned errors on `logging_failed` paths in `sendBulkSMSAsync` (bulk helper abort), and could surface hard failures in `sendSms` / `sendOTPMessage` when `success: false` coincided with `code: 'logging_failed'` / `logFailure: true` (transport may already have sent, logging failed). Fix: normalize `logging_failed` across all three actions to success payloads (`success: true`, `code: 'logging_failed'`, `logFailure: true`), include explicit do-not-retry guidance for bulk sends, and log structured fatal safety metadata. Regression: extended `tests/actions/smsActions.test.ts` with bulk-abort fail-safe, OTP fail-safe, and manual-send fail-safe cases.
406. `SMS-066` (P1) Hardened BOH manual table-booking SMS route to avoid retry-driven duplicates when outbound logging fails after send: `src/app/api/boh/table-bookings/[id]/sms/route.ts` still returned HTTP 502 when `sendSMS` reported `success: false`, including `logging_failed` safety signals that can occur after transport send succeeds but message persistence fails. Fix: treat `logging_failed` (`code` or `logFailure`) as fail-safe HTTP 200 success with explicit safety metadata, while preserving HTTP 502 for true unsent failures and emitting structured `logger.error` for investigation. Regression: extended `tests/api/bohTableBookingSmsRouteSafety.test.ts` with a `success:false + logging_failed` scenario asserting HTTP 200 + safety metadata.
407. `EVENT-016` (P1) Hardened event manual booking action SMS semantics to avoid retry-driving false failures on fatal post-send persistence signals: `src/app/actions/events.ts` still treated some `logging_failed` outcomes as unsent when helper results came back `success: false` despite `code: 'logging_failed'` / `logFailure: true` (transport may already have sent while outbound message persistence failed). This affected manual booking create, seat-update, and cancellation admin flows. Fix: normalize these outcomes to `sms_sent: true` and `meta.sms.success: true` whenever the result is "sent/unknown", preserve `code`/`logFailure` metadata, and avoid false warn logging for non-success `logging_failed`. Regression: extended `tests/actions/eventsManualBookingGuards.test.ts` with focused creation, seat-update, and cancellation fail-safe cases.
408. `SMS-067` (P1) Hardened event booking/waitlist API SMS meta semantics to avoid retry-driving false failures on fatal post-send persistence signals: `src/app/api/event-bookings/route.ts`, `src/app/api/event-waitlist/route.ts`, and `src/app/api/foh/event-bookings/route.ts` still treated `success:false + logging_failed` as unsent in returned `meta.sms`, even though this signal can occur after transport send succeeds while outbound message logging fails. Fix: normalize these outcomes to `meta.sms.success: true` whenever `code: 'logging_failed'` or `logFailure` indicates "sent/unknown", and suppress non-success warning logs for that fatal post-send state. Regression: extended `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, and `tests/api/fohEventBookingsSmsMeta.test.ts` with `success:false + logging_failed` cases.
409. `WEBHOOK-020` (P1) Hardened Stripe webhook blocked seat-increase payment transitions to fail closed on missing row effects: `src/app/api/stripe/webhook/route.ts` previously updated `payments` to `failed` in the blocked seat-increase path without checking affected rows, then could continue into refund-side logic even when no pending payment row transitioned. Fix: enforce strict row-effect verification for this update and, when zero rows are updated, require a verified existing terminal payment state (`failed`/`refunded`) before proceeding; otherwise throw and fail closed. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a blocked seat-increase no-row-update case that returns HTTP 500 and skips idempotency-response persistence.
410. `WEBHOOK-021` (P1) Hardened Stripe webhook prepaid-event confirmation SMS outcome handling so fulfilled non-success results are no longer silently ignored: `/api/stripe/webhook` used `Promise.allSettled(...)` but only inspected rejected SMS promises, so `sendEventPaymentConfirmationSms` could return `{ success:false, code, logFailure }` and the route emitted no route-level telemetry. Fix: inspect fulfilled SMS outcomes and log structured warning/error metadata when `success !== true` (including explicit `logging_failed` handling), while preserving HTTP 200 semantics to avoid retry-driven duplicate processing. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a fulfilled non-success prepaid-confirmation SMS case asserting webhook success plus warning telemetry.
411. `WEBHOOK-022` (P1) Hardened Stripe webhook seat-increase confirmation SMS outcome handling so fulfilled non-success results are no longer silently ignored: `/api/stripe/webhook` used `Promise.allSettled(...)` but only inspected rejected SMS promises, so `sendEventBookingSeatUpdateSms` could return `{ success:false, code, logFailure }` and the route emitted no route-level telemetry. Fix: inspect fulfilled SMS outcomes and log structured warning/error metadata when `success !== true` (including explicit `logging_failed` handling), while preserving HTTP 200 semantics to avoid retry-driven duplicate processing. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a fulfilled non-success seat-increase SMS case asserting webhook success plus warning telemetry.
412. `WEBHOOK-023` (P1) Hardened Stripe checkout-failure payment transitions to fail closed on missing row effects: `handleCheckoutSessionFailure` in `src/app/api/stripe/webhook/route.ts` previously updated `payments` to `failed` but treated zero-row updates as a silent success and returned early, hiding missing/stale payment rows on a payment write path. Fix: enforce strict row-effect verification for checkout-failure updates and, when zero rows are updated, require a verified existing terminal payment state (`failed`/`succeeded`/`refunded`/`partially_refunded`) before acknowledging as a safe no-op; otherwise throw and fail closed. Also emit explicit warning telemetry when booking lookup for analytics fails, instead of silently swallowing lookup errors. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with checkout-failure no-row cases for both fail-closed missing-payment behavior and safe terminal-status acknowledgement without retry-SMS fanout.
413. `WEBHOOK-024` (P1) Hardened Stripe webhook table-card-capture confirmation SMS visibility so fulfilled non-success outcomes are no longer silent: `/api/stripe/webhook` used `Promise.allSettled(...)`, but `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed` returned `void` and swallowed booking/customer lookup errors, which hid fulfilled non-success/logging-failure SMS outcomes at the webhook layer. Fix: make the helper return structured SMS safety metadata and fail closed on booking/customer lookup DB errors (surfaced as rejected tasks), then inspect fulfilled SMS outcomes in the webhook and log structured warning/error telemetry when `success !== true` (including `logging_failed`) while preserving HTTP 200 semantics to avoid retry-driven duplicate processing. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with table-card-capture fulfilled non-success and logging-failure SMS cases.
414. `EVENT-018` (P1) Hardened event manual cancellation follow-up row-effect verification to fail closed on stale/racy zero-row updates: `cancelEventManualBooking` in `src/app/actions/events.ts` previously treated zero-row `booking_holds`/`table_bookings` follow-up updates as success when no mutation `error` was returned, without verifying post-update state. This could return success while active linked rows remained. Fix: add strict follow-up mutation evidence checks and zero-row post-update verification queries; if verification errors, result shape is unavailable, or active linked rows remain, fail closed with existing operator-facing error messages and structured warning metadata.
415. `EVENT-019` (P1) Hardened event booking rollback hold-release verification to fail closed on stale/racy zero-row updates: `cancelEventBookingAfterTableReservationFailure` in `src/app/api/event-bookings/route.ts` previously treated zero-row `booking_holds` release updates as success when no mutation `error` was returned, without verifying whether active payment holds still remained after the booking cancellation rollback. This could acknowledge rollback completion while leaving active holds attached to a cancelled booking. Fix: enforce strict hold-release row-effect checks and, when zero rows are updated, run a post-update verification query for remaining active payment holds; if verification errors, result shape is invalid, or active rows remain, throw and fail closed.
416. `EVENT-020` (P1) Hardened event manual booking create rollback hold-release verification to fail closed on stale/racy zero-row updates: `rollbackEventBookingForTableFailure` in `src/app/actions/events.ts` still treated zero-row `booking_holds` payment-hold release updates as success when no mutation `error` was returned, without verifying whether active payment-hold rows still remained after rollback. This could return a blocked table-reservation outcome while leaving active holds attached to a cancelled booking. Fix: enforce strict hold-release row-effect checks and, when zero rows are updated, query remaining active payment holds and fail closed when verification errors, result shape is unavailable, or active rows remain.
417. `EVENT-021` (P1) Hardened FOH event booking create rollback hold-release verification to fail closed on stale/racy zero-row updates: `cancelEventBookingAfterTableReservationFailure` in `src/app/api/foh/event-bookings/route.ts` still treated zero-row `booking_holds` payment-hold release updates as success when no mutation `error` was returned, without verifying whether active payment-hold rows remained after rollback. This could return a table-reservation conflict outcome while leaving active holds attached to the cancelled booking. Fix: enforce strict hold-release row-effect checks and, when zero rows are updated, query remaining active payment holds and fail closed when verification errors, result shape is unavailable, or active rows remain.
418. `WEBHOOK-025` (P1) Hardened Stripe webhook retry-SMS observability for blocked/failed checkout flows: `handleCheckoutSessionCompleted` (blocked branch) and `handleCheckoutSessionFailure` in `src/app/api/stripe/webhook/route.ts` previously only handled thrown `sendEventPaymentRetrySms` exceptions and ignored fulfilled non-success outcomes, leaving fatal post-send logging failures (`code: 'logging_failed'` / `logFailure: true`) and provider non-success states invisible on a webhook send path. Fix: add a shared retry-SMS outcome handler that inspects fulfilled results and logs structured `error` telemetry for `logging_failed` and `warn` telemetry for other non-success outcomes while preserving HTTP 200 webhook semantics to avoid retry-driven duplicate sends.
419. `EVENT-022` (P1) Hardened event manual booking seat-update linked-table sync verification to avoid silent zero-row write drift: `updateEventManualBookingSeats` in `src/app/actions/events.ts` previously treated zero-row linked `table_bookings` party-size updates as success when no mutation `error` was returned, with no post-update verification. Under stale/racy state this could return `success` while active linked table bookings remained unsynced. Fix: require mutation-result evidence (`.select('id')`) and, when zero rows update, verify no active linked table bookings remain; surface failures via `meta.table_booking_sync` (`mutation_result_unavailable`, verification errors, `active_rows_remaining:N`) and emit structured error telemetry instead of silent success.
420. `WEBHOOK-026` (P1) Hardened Stripe webhook table-card-capture customer-sync row-effect verification so zero-row `customers` updates are no longer silent: `handleTableCardCaptureCheckoutCompleted` in `src/app/api/stripe/webhook/route.ts` previously surfaced only explicit Supabase update errors while treating zero-row `stripe_customer_id` updates as success, leaving stale/missing-row drift invisible on a webhook write path. Fix: require mutation evidence via `.select('id')`, and when zero rows update, run a verification lookup to classify/log `mutation_result_unavailable`, lookup failures, missing customer rows, unset `stripe_customer_id`, and mismatched existing Stripe customer IDs while preserving HTTP 200 webhook semantics to avoid retry-driven duplicate side effects. Regression: extended `tests/api/stripeWebhookMutationGuards.test.ts` with a zero-row customer sync verification case asserting surfaced telemetry and webhook success.
420 (follow-up). `WEBHOOK-026` (P1) Hardened Twilio webhook customer delivery-outcome writes to fail closed on duplicate-status/retry paths: `src/app/api/webhooks/twilio/route.ts` still had a fail-open gap where duplicate status callbacks returned early before re-applying customer delivery outcomes, and `applySmsDeliveryOutcome` did not enforce strict customer row-effect checks on delivered/failed updates. Fix: apply delivery outcomes before duplicate-status ACK and fail closed when customer lookup/update errors or zero-row customer updates occur; keep analytics emit best-effort to avoid retry loops on non-critical telemetry. Regression: extended `tests/api/twilioWebhookMutationGuards.test.ts` with duplicate-status and post-status customer-update failure cases asserting HTTP 500 fail-closed behavior.
420 (follow-up 2). `PARK-009` (P1) Hardened parking booking create SMS safety-meta surfacing so fatal post-send persistence signals are not hidden: `src/app/api/parking/bookings/route.ts` called `sendParkingPaymentRequest` after booking/payment-order creation but ignored returned `{ sent, skipped, code, logFailure }` metadata, masking `logging_failed` and unsent provider states on a send/write-adjacent route. Fix: capture/normalize send helper outcomes, return `meta.sms` + `meta.status_code` on the HTTP 201 response, emit structured `logger.error` on `logging_failed`, and map thrown SMS-task exceptions to a safe surfaced fallback (`code: 'unexpected_exception'`) without retry-driving failures after booking commit. Regression: extended `tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` with logging-failed and unsent-provider response-meta cases.
420 (follow-up 3). `SMS-069` (P1) Hardened event booking/waitlist route-level SMS fallback meta surfacing for rejected side-effect promises: `src/app/api/event-bookings/route.ts`, `src/app/api/event-waitlist/route.ts`, and `src/app/api/foh/event-bookings/route.ts` previously set `meta.sms` to `null` when the route-level SMS side-effect task rejected unexpectedly, masking failure context on successful booking/waitlist responses. Fix: surface explicit fallback safety metadata (`{ success: false, code: 'unexpected_exception', logFailure: false }`) on these rejected-task paths while preserving non-retry-driving success responses. Regression: extended `tests/api/eventBookingsRouteSmsMeta.test.ts`, `tests/api/eventWaitlistRouteSmsMeta.test.ts`, and `tests/api/fohEventBookingsSmsMeta.test.ts` with rejected-task cases asserting fallback `meta.sms`.
421. `SMS-057` (P1) Hardened private booking non-update flows to surface SMS safety signals: `PrivateBookingService.cancelBooking`, `recordDeposit`, and `recordFinalPayment` previously called `SmsQueueService.queueAndSend` but ignored returned `{ error, code, logFailure }`, swallowing queue/send failures and `logging_failed` safety signals. Fix: capture and return `smsSideEffects` summaries and emit structured error logs on queue/send failure or outbound-message logging failure.
422. `EVENT-012` (P1) Hardened staff seat-update SMS meta propagation: `updateTableBookingPartySizeWithLinkedEventSeats` previously collapsed `sendEventBookingSeatUpdateSms` results to `sms_sent`, dropping `code`/`logFailure` safety signals (including `logging_failed`) from FOH/BOH party-size update flows. Fix: propagate seat-update SMS safety meta via a new `sms: { success, code, logFailure } | null` field on the return payload.
423. `QUEUE-019` (P0) Hardened private booking SMS queue auto-send dispatch claiming to prevent approval races: `SmsQueueService.queueAndSend` now inserts auto-send queue rows with a `dispatching:` marker in `error_message` (cleared on success), and approve/reject updates require `error_message IS NULL`, failing closed with an explicit "dispatch in progress" error when a dispatch marker is present. Regression: `tests/services/smsQueue.service.test.ts`.
424. `QUEUE-020` (P1) Hardened approved SMS queue send meta propagation: `SmsQueueService.sendApprovedSms` now returns `{ success, code, logFailure }` on success so callers can observe fatal SMS safety signals (e.g., `logging_failed`) and abort downstream fanout without retrying the transport send. Regression: `tests/services/smsQueue.service.test.ts`.
425. `SMS-060` (P0) Hardened SMS safety config to ignore `SMS_SAFETY_ALLOW_MISSING_TABLES` in production: it previously could bypass safety limits + distributed SMS idempotency when `messages`/`idempotency_keys` tables are unavailable, risking uncontrolled outbound sends; `resolveConfig` now forces `allowMissingTables=false` when `NODE_ENV=production`. Regression: `tests/lib/sms/safety.test.ts`.
426. `INV-010` (P1) Hardened invoice reminder dedupe helper to fail closed on DB errors: `hasSentInvoiceEmailLog` now returns `{ exists: true, error }` when lookup fails so callers default to skipping sends when dedupe state is unknown (avoids duplicate reminder emails if callers ignore the error field). Regression: `tests/lib/invoiceReminderSafety.test.ts`.
427. `QUEUE-021` (P0) Hardened private booking SMS queue recipient resolution to fail closed on booking/customer lookup errors: `resolvePrivateBookingRecipientPhone` now returns an explicit error when the booking is missing or any booking/customer lookup errors, and `SmsQueueService.queueAndSend` aborts immediately when recipient resolution reports an error (no lock/insert/send on unverifiable recipient context). Regression: `tests/services/smsQueue.service.test.ts`.
428. `SMS-062` (P0) Hardened `sendSMS` to surface fatal `logging_failed` safety signals when message persistence is impossible: `sendSMS` previously returned transport success even when outbound message logging was skipped due to missing customer context (`createCustomerIfMissing=false` with no `customerId`), hiding fatal safety signals and allowing batch callers to continue sending while safety counters cannot be updated. Fix: treat missing customer context for outbound-message logging as `logging_failed` (return `{ success: true, code: 'logging_failed', logFailure: true }`) so callers can abort further sends when persistence is impossible. Regression: `tests/lib/twilioSendLoggingFailClosed.test.ts`.
429. `QUEUE-022` (P1) Hardened legacy background job SMS execution to treat suppressed/deferred sends as success: `JobQueue.processSendSms` previously threw when `sendSMS` returned `success: true` but no `sid` (e.g., `suppressed_duplicate` or quiet-hours `deferred` sends), causing unnecessary retries and duplicate deferrals. Fix: treat `{ success: true, suppressed/deferred }` results as successful execution and return a null SID without retrying. Regression: `tests/lib/backgroundJobsQueue.test.ts`.
430. `MSG-005` (P1) Hardened message-thread reply SMS meta normalization and duplicate suppression handling: `MessageService.sendReply` now treats `code: 'logging_failed'` as `logFailure: true` for consistent fatal safety signal propagation, and regression coverage ensures dedupe suppression (`suppressed_duplicate`) returns success with a null SID (no retry-driven resend loops). Regression: `tests/services/messages.service.test.ts`.
431. `QUEUE-023` (P0) Hardened unified job queue SMS state persistence to fail closed: `UnifiedJobQueue.processJob` now treats completion-state persistence failures as fatal (`logging_failed`) to prevent retry-driven duplicate sends after side effects ran, and treats failure-state persistence errors/zero-row updates as fatal (`safety_unavailable`) so claimed SMS batches abort when the system cannot safely persist job state. Regression: `tests/lib/unifiedJobQueue.test.ts`.
432. `QUEUE-024` (P0) Hardened private booking SMS queue post-send persistence to surface fatal safety meta: `SmsQueueService.queueAndSend` now treats "SMS sent but queue status update failed" as fatal `logging_failed` (`logFailure: true`) while returning `success: true`, so batch callers can abort downstream fanout without retrying transport sends. Regression: `tests/services/smsQueue.service.test.ts`.
433. `QUEUE-025` (P0) Hardened approved private booking SMS dispatch to avoid resend from stale dispatch claims and to fail closed on post-send persistence errors: `SmsQueueService.sendApprovedSms` previously reclaimed stale `dispatching:` claims and re-sent, and it threw when the transport send succeeded but the queue row could not be persisted as `status='sent'`, creating a retry/reclaim resend vector. Fix: stale `dispatching:` claims now fail closed and attempt safe reconciliation by checking the outbound `messages` log (prefer `metadata.queue_job_id`, fall back to booking/to/template filters); if evidence exists, reconcile the queue row to `sent` without re-sending, otherwise refuse to resend automatically. Post-send queue persistence failures now return `{ success: true, code: 'logging_failed', logFailure: true }` to avoid retry-driven duplicates and propagate fatal safety meta. Regression: `tests/services/smsQueue.service.test.ts`.
434. `PARK-008` (P0) Hardened parking payment request SMS dispatch to fail closed on post-send persistence errors without retry-driven duplicates: `sendParkingPaymentRequest` previously threw when post-send persistence failed (parking notification log insert or booking reminder-flag update error/0-row) after a successful transport send, risking resend loops and/or later fanout due to missing flags. Fix: return `{ sent, skipped, code, logFailure }` and treat post-send persistence failures as fatal `logging_failed` while keeping `sent: true` (no throw), and persist stable `template_key` + `stage` metadata in `parking_booking_notifications.payload` for dedupe/reconciliation. Regression: `tests/lib/parkingPaymentsPersistence.test.ts`.
435. `WAITLIST-005` (P0) Hardened waitlist offer SMS dispatch to surface fatal safety meta when post-send persistence fails: `sendWaitlistOfferSms` previously returned `success: false` when post-send persistence (offer/hold/token timestamp updates) failed after a successful transport send, misclassifying a sent/scheduled SMS as unsent and allowing cron-level cleanup/retry logic to run. Fix: treat post-send persistence failures as fatal `logging_failed` while returning `{ success: true, code: 'logging_failed', logFailure: true }` so cron/batch callers abort without retrying or continuing fanout. Regression: `tests/lib/waitlistOffersSmsPersistence.test.ts`.
436. `PB-017` (P1) Aborted private booking update SMS side-effect dispatch after fatal SMS safety signals: `PrivateBookingService.updateBooking` previously continued enqueuing additional SMS side effects after an earlier side effect returned a fatal safety signal (`logging_failed`, `safety_unavailable`, `idempotency_conflict`), increasing fanout risk while outbound message persistence/safety is degraded. Fix: normalize `code`/`logFailure` consistently (treat `code: 'logging_failed'` as `logFailure: true`) and abort further SMS side-effect dispatch within the same mutation after a fatal signal while still returning the updated booking and `smsSideEffects` (no retry-driving throw). Regression: `tests/services/privateBookingsSmsSideEffects.test.ts`.
437. `EVENT-015` (P1) Hardened seat-update SMS helper safety meta propagation: `sendEventBookingSeatUpdateSms` previously computed `smsLogFailure` but returned `logFailure: smsResult.logFailure`, which could drop the fatal safety signal when the transport result omitted the boolean. Fix: return `code`/`logFailure` using the computed normalization so callers reliably receive `{ code: 'logging_failed', logFailure: true }`. Regression: `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
438. `WAITLIST-006` (P1) Hardened waitlist offer SMS safety meta normalization: `sendWaitlistOfferSms` could return `code: 'logging_failed'` without normalizing the corresponding `logFailure` flag, so callers could miss the fatal safety signal if the transport result omitted the boolean. Fix: treat `code: 'logging_failed'` as `logFailure: true` for consistent abort semantics in batch/cron callers. Regression: extended `tests/lib/waitlistOffersSmsPersistence.test.ts`.
439. `QUEUE-026` (P1) Hardened private booking SMS queue auto-send safety meta normalization: `SmsQueueService.sendPrivateBookingSms` could return `code: 'logging_failed'` without normalizing the corresponding `logFailure` flag, so callers could miss the fatal safety signal if the transport meta omitted the boolean. Fix: treat `code: 'logging_failed'` as `logFailure: true` for consistent abort semantics. Regression: extended `tests/services/smsQueue.service.test.ts`.
440. `GUEST-003` (P1) Hardened guest-token throttle fail-closed behavior for production safety: `checkGuestTokenThrottle` (`src/lib/guest/token-throttle.ts`) previously swallowed all `rate_limits` DB errors and always fell back to in-memory throttling, which can fail open in multi-instance production deployments and weaken brute-force protection on guest-token endpoints that gate SMS-triggering flows. Fix: fail closed in production on throttle DB errors (`allowed: false`, `remaining: 0`) while preserving local fallback in non-production. Regression: extended `tests/lib/guestTokenThrottle.test.ts`.
441. `SMS-067` (P1) Hardened bulk SMS fatal-abort fanout semantics: `sendBulkSms` (`src/lib/sms/bulk.ts`) previously launched each concurrency window with `Promise.all`, so fatal safety signals (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) could still permit additional in-flight sends in the same window before abort took effect. Fix: cap effective dispatch concurrency to `1` (single-flight) so fatal safety signals stop fanout before additional sends are started. Regression: extended `tests/lib/smsBulkLoopGuards.test.ts` with a high-requested-concurrency fatal-signal guard that asserts only one send executes.
442. `MSG-008` (P1) Hardened message-thread reply safety-meta propagation on non-success sends: `MessageService.sendReply` (`src/services/messages.ts`) previously threw a generic error when `sendSMS` returned non-success, dropping `code`/`logFailure` metadata and obscuring fatal safety signals (`logging_failed`, `safety_unavailable`, `idempotency_conflict`) for callers. Fix: return structured non-success results with preserved `error`/`code`/`logFailure` instead of throwing. Regression: extended `tests/services/messages.service.test.ts`.
443. `EVENT-017` (P1) Hardened event-payment helper safety-meta propagation: `sendEventPaymentConfirmationSms` and `sendEventPaymentRetrySms` (`src/lib/events/event-payments.ts`) previously only logged SMS safety metadata and returned `void`, so callers could not observe `code`/`logFailure` outcomes from Stripe-triggered send paths. Fix: both helpers now return normalized safety metadata `{ success, code, logFailure }` while preserving existing logging semantics. Regression: extended `tests/lib/eventPaymentSmsSafetyMeta.test.ts`.
444. `TB-005` (P1) Hardened table-booking SMS helper fail-safe sent/unknown semantics for fatal post-send logging failures: `sendTableBookingCreatedSmsIfAllowed` and `sendSundayPreorderLinkSmsIfAllowed` in `src/lib/table-bookings/bookings.ts` previously treated `success:false + code:'logging_failed'` as unsent, even though transport may already have sent while outbound message logging failed, which could drive retry loops and duplicate sends. Fix: normalize these helpers to treat `logging_failed`/`logFailure` as sent/unknown for returned `sent`/`scheduledFor`/`sms.success` while preserving `code`/`logFailure` metadata for fatal-signal abort logic. Regression: extended `tests/lib/tableBookingCreatedSmsMeta.test.ts` and added `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts`.
445. `TB-006` (P1) Hardened card-capture hold-alignment helper to fail closed on send-adjacent persistence failures: `alignTableCardCaptureHoldToScheduledSend` in `src/lib/table-bookings/bookings.ts` previously used `Promise.allSettled` and logged warnings when updates to `table_bookings`, `booking_holds`, or `card_captures` errored or affected no rows, but still returned a successful expiry timestamp. This masked failed hold-alignment writes after deferred card-capture SMS scheduling. Fix: keep warning telemetry but throw on any update error/no-row condition with explicit per-table failure markers so callers can treat alignment state as unreliable instead of silently continuing. Regression: updated `tests/lib/tableBookingHoldAlignment.test.ts`.
446. `EVENT-017` (P1 follow-up) Hardened event-payment SMS helper DB-read fail-closed safety metadata: `sendEventPaymentConfirmationSms` and `sendEventPaymentRetrySms` in `src/lib/events/event-payments.ts` previously returned generic non-success metadata (`code: null`) when booking/customer lookup queries errored, making fatal DB-read safety degradation indistinguishable from normal non-send states for callers that need abort signals. Fix: return explicit `{ success: false, code: 'safety_unavailable', logFailure: false }` on booking/customer lookup DB errors while preserving non-fatal `code: null` for expected business-state non-send cases. Regression: extended `tests/lib/eventPaymentSmsSafetyMeta.test.ts`.
447. `QUEUE-027` (P1) Hardened approved private-booking SMS dispatch to fail closed on booking-context lookup failures: `SmsQueueService.sendApprovedSms` in `src/services/sms-queue.ts` previously ignored `private_bookings` lookup errors and could still proceed to `sendSms` with unverifiable booking/customer context, creating a fail-open send path during DB degradation. Fix: require booking context lookup success before dispatch and throw fail-closed on lookup error/no-row before any send attempt. Regression: extended `tests/services/smsQueue.service.test.ts` with a booking-lookup-error case asserting fail-closed rejection and no `sendSms` call.
448. `EVENT-015` (P1 follow-up) Hardened seat-update SMS helper DB-read fail-closed metadata in `sendEventBookingSeatUpdateSms` (`src/lib/events/event-payments.ts`): booking/customer lookup DB errors previously surfaced generic non-success payloads that obscured safety degradation for callers. Fix: return explicit `{ success: false, code: 'safety_unavailable', logFailure: false }` for lookup DB errors while preserving explicit non-fatal metadata for expected non-send states. Regression: extended `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
449. `QUEUE-028` (P1) Hardened private-booking queue recipient-resolution safety metadata in `src/services/sms-queue.ts`: recipient context DB failures were previously returned as generic `error` strings without fatal safety codes, so upstream side-effect loops could continue fanout during safety degradation. Fix: propagate `code: 'safety_unavailable'` for booking/customer context lookup DB failures in `queueAndSend`, and map lookup resolution failures in `sendPrivateBookingSms` to `safety_unavailable` while preserving thrown safety metadata. Regression: extended `tests/services/smsQueue.service.test.ts`.
450. `WAITLIST-007` (P1) Hardened waitlist offer SMS helper metadata propagation in `src/lib/events/waitlist-offers.ts`: customer/event lookup DB errors and thrown send exceptions previously returned generic reasons without `code/logFailure`, obscuring safety states for batch callers. Fix: return explicit `{ success: false, code: 'safety_unavailable', logFailure: false }` on lookup DB errors and `{ success: false, code: 'unexpected_exception', logFailure: false }` on thrown send exceptions. Regression: extended `tests/lib/waitlistOffersSmsPersistence.test.ts`.
451. `BULK-006` (P1) Hardened bulk SMS fail-closed exception handling in `src/lib/sms/bulk.ts`: per-recipient send exceptions were previously logged and collected as ordinary failures, but the loop continued dispatching additional recipients. Fix: thrown send errors now set a fatal abort signal (`logging_failed`/explicit fatal code or fallback `safety_unavailable`) and terminate the batch before further fanout. Regression: extended `tests/lib/smsBulkLoopGuards.test.ts` with thrown-send abort coverage asserting single-send execution.
452. `SMS-068` (P1) Hardened unexpected `sendSMS` pipeline safety metadata in `src/lib/twilio.ts`: top-level unexpected pipeline failures previously returned a generic non-success payload without a fatal safety code, preventing batch callers from consistently treating safety-path exceptions as abort-worthy. Fix: unexpected pipeline catch now returns `{ success: false, error: 'Failed to send message', code: 'safety_unavailable' }`. Regression: added `tests/lib/twilioUnexpectedPipelineSafety.test.ts`.
453. `EVENT-023` (P1) Hardened event payment SMS helper thrown-error safety propagation in `src/lib/events/event-payments.ts`: thrown `sendSMS` failures were previously collapsed to `code: 'unexpected_exception'` with `logFailure: false`, dropping fatal safety metadata needed by callers to recognize abort-worthy safety failures. Fix: added `normalizeThrownSmsSafety(...)` and wired catch paths in `sendEventPaymentConfirmationSms`, `sendEventBookingSeatUpdateSms`, and `sendEventPaymentRetrySms` to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: extended `tests/lib/eventPaymentSmsSafetyMeta.test.ts` and `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`.
454. `TB-007` (P1) Hardened table-booking SMS helper thrown-error safety propagation in `src/lib/table-bookings/bookings.ts`: thrown `sendSMS` failures in table-booking created/post-card-capture/sunday-preorder helpers were previously collapsed to `code: 'unexpected_exception'` with `logFailure: false`, obscuring fatal safety metadata from thrown safety signals. Fix: added `normalizeThrownSmsSafety(...)` and wired catch paths in `sendTableBookingCreatedSmsIfAllowed`, `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed`, and `sendSundayPreorderLinkSmsIfAllowed` to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: extended `tests/lib/tableBookingCreatedSmsMeta.test.ts`, `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts`, and added `tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts`.
455. `WAITLIST-008` (P1) Hardened thrown waitlist-offer SMS safety propagation in `src/lib/events/waitlist-offers.ts`: thrown `sendSMS` failures were still collapsed to `code: 'unexpected_exception'` with `logFailure: false`, which dropped fatal safety metadata and weakened batch abort behavior. Fix: added `normalizeThrownSmsSafety(...)` and wired the thrown send catch path to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: updated `tests/lib/waitlistOffersSmsPersistence.test.ts` with generic-throw fallback and thrown `idempotency_conflict` propagation assertions.
456. `EVENT-024` (P1) Hardened staff seat-update thrown SMS safety propagation in `src/lib/events/staff-seat-updates.ts`: thrown `sendEventBookingSeatUpdateSms` errors were still mapped to hardcoded `{ code: 'unexpected_exception', logFailure: false }`, suppressing fatal safety metadata. Fix: added `normalizeThrownSmsSafety(...)` and wired the catch path in `updateTableBookingPartySizeWithLinkedEventSeats` to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: updated `tests/lib/staffSeatUpdatesMutationGuards.test.ts` with thrown `idempotency_conflict` propagation coverage.
457. `PARK-010` (P1) Hardened parking payment request thrown SMS safety propagation in `src/lib/parking/payments.ts`: thrown `sendSMS` failures in `sendParkingPaymentRequest` were still collapsed to `code: 'unexpected_exception'`, dropping fatal safety metadata needed by callers to stop fanout. Fix: added `normalizeThrownSmsSafety(...)` and wired the thrown send catch path to propagate normalized `{ code, logFailure }` with fail-closed fallback `code: 'safety_unavailable'`. Regression: updated `tests/lib/parkingPaymentsPersistence.test.ts` with thrown `logging_failed` propagation coverage.
458. `QUEUE-029` (P1) Hardened approved private-booking SMS send failure metadata propagation in `src/services/sms-queue.ts`: `sendApprovedSms` previously caught thrown send failures and replaced them with a generic `error`, discarding thrown safety metadata (`code/logFailure`) needed by callers to detect fatal safety conditions (for example `idempotency_conflict`). Fix: preserve thrown `code/logFailure` in the fallback result and attach normalized safety metadata to the final thrown error in the `result.error` path. Regression: updated `tests/services/smsQueue.service.test.ts` with thrown `idempotency_conflict` propagation coverage for `sendApprovedSms`.
461. `SCRIPT-075` (P0) Hardened `check-event-categories-migration` database script to be strictly read-only: it previously created SECURITY DEFINER helper functions (including an `exec_sql` DDL executor) via `supabase.rpc('exec_sql')` with no gating; it now never creates helper functions, falls back to `select('*')` column inference when helper RPCs are missing, and fails closed (non-zero exit) when checks error or are unavailable.
462. `SCRIPT-076` (P0) Hardened `check-migration-simple` database script to be strictly read-only: it previously performed ungated insert/delete constraint probes (production DB mutation risk) and failed open by returning early on query errors; it now removes all insert/delete probes, throws on query errors, and exits non-zero on any failure.
463. `SCRIPT-077` (P1) Hardened parking SMS backfill script (`scripts/backfill/parking-sms.ts`) to be safe by default: it now defaults to dry-run; mutations require explicit multi-gating (`--confirm` + `RUN_PARKING_SMS_BACKFILL_MUTATION=true` + `ALLOW_PARKING_SMS_BACKFILL_MUTATION=true`, legacy allow supported) plus an explicit capped `--limit` (hard cap `1000`) before any writes; optional `--offset`; and it fails closed via `process.exitCode=1`.
464. `SCRIPT-078` (P1) Hardened `fix-rpc-functions` scripts to be strictly read-only diagnostics: they previously contained unsafe/broken behavior (automatic DDL/arbitrary SQL execution paths and forced success exits); they now never execute SQL automatically, print the SQL patch for manual application on failure, and exit non-zero on errors.
465. `SCRIPT-079` (P0) Hardened `scripts/database/check-private-bookings-schema.ts` to be strictly read-only: it previously attempted DB inserts to “discover” schema and used a Next.js server Supabase client while failing open on errors; it now never mutates, uses `createAdminClient`, falls back to column probes when schema helpers are unavailable, and fails closed via `process.exitCode=1`.
466. `SCRIPT-080` (P0) Hardened `scripts/database/check-click-tracking.ts` to be strictly read-only: it previously inserted test click rows and updated click counts; it now blocks `--confirm`, uses `createAdminClient`, uses safe count queries/column inventory, and fails closed via `process.exitCode=1`.
467. `SCRIPT-081` (P0) Hardened `scripts/database/check-loyalty-program.ts` to be strictly read-only: it previously created a default loyalty program automatically and failed open on query errors; it now blocks `--confirm`, never mutates, fails closed on query errors or missing expected program rows, and uses `createAdminClient`.
468. `SCRIPT-082` (P0) Hardened `scripts/database/check-migration-table-structure.ts` to be strictly read-only: it previously attempted DB inserts into migration tables and used silent catches; it now blocks `--confirm`, never mutates, uses `createAdminClient`, and fails closed on unexpected query errors.
469. `SCRIPT-083` (P0) Hardened `scripts/database/complete-past-event-checklists.ts` to be safe by default: it previously upserted checklist status rows by default with no gating/caps and imported a broken Supabase admin singleton; it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION=true` + `ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true`) plus an explicit capped `--event-limit` (hard cap `200`) and `--offset`, and it enforces a hard cap on total upsert rows (`5000`).
470. `SCRIPT-084` (P0) Hardened `scripts/fixes/fix-sms-template-keys.ts` to be safe by default: it previously performed unbounded updates to pending `send_sms` jobs by default (only a single allow env gate; no dry-run; no caps); it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_FIX_SMS_TEMPLATE_KEYS_MUTATION=true` + `ALLOW_FIX_SMS_TEMPLATE_KEYS_SCRIPT=true`) plus an explicit capped `--limit` (hard cap `500`) and optional `--offset`, and it filters directly in SQL (`payload->>template`) to avoid scanning all pending jobs.
471. `SCRIPT-093` (P0) Hardened `scripts/cleanup/remove-historic-import-notes.ts` to be safe by default: it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION=true` + `ALLOW_REMOVE_HISTORIC_IMPORT_NOTES_MUTATION_SCRIPT=true`) plus an explicit capped `--limit` (hard cap `500`) and optional `--offset`, and it fails closed via `process.exitCode=1`.
472. `SCRIPT-094` (P0) Hardened `scripts/cleanup/delete-approved-duplicates.ts` to be safe by default: it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_DELETE_APPROVED_DUPLICATES_MUTATION=true` + `ALLOW_DELETE_APPROVED_DUPLICATES_MUTATION_SCRIPT=true`) plus an explicit capped `--limit` (hard cap `50`) and optional `--offset`, enforces strict row-effect assertions for destructive deletes + audit writes, and fails closed via `process.exitCode=1`.
473. `SCRIPT-095` (P0) Hardened `scripts/fixes/fix-superadmin-permissions.ts` to be safe by default: it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_FIX_SUPERADMIN_PERMISSIONS_MUTATION=true` + `ALLOW_FIX_SUPERADMIN_PERMISSIONS_MUTATION_SCRIPT=true`) plus explicit operation selection, bulk-grant paths require explicit caps (hard cap `200`), and it fails closed via `process.exitCode=1`.
474. `SCRIPT-096` (P0) Removed a hardcoded API key and hardened `scripts/fixes/fix-table-booking-api-permissions.ts`: it now defaults to dry-run, requires `--key-hash` instead of a raw key, mutations require explicit multi-gating (`--confirm` + `RUN_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION=true` + `ALLOW_FIX_TABLE_BOOKING_API_PERMISSIONS_MUTATION_SCRIPT=true`), enforces strict single-row update assertions, and the standalone variant containing the hardcoded key was deleted.
475. `SCRIPT-097` (P0) Hardened the `scripts/fixes/fix-table-booking-sms.ts` write probe to prevent accidental send-job queueing: it now requires explicit multi-gating (`--confirm` + `--write-probe` + `RUN_FIX_TABLE_BOOKING_SMS_WRITE_PROBE=true` + `ALLOW_FIX_TABLE_BOOKING_SMS_PROBE_MUTATION=true`), and the probe inserts a `cancelled` `send_sms` job (never pending) scheduled far in the future before deleting it.
476. `SCRIPT-098` (P1) Hardened `scripts/fixes/fix-pending-payment.ts` to be safe by default: it now defaults to dry-run and requires explicit multi-gating (`--confirm` + `RUN_FIX_PENDING_PAYMENT_MUTATION=true` + `ALLOW_FIX_PENDING_PAYMENT_MUTATION=true`) before mutating booking/payment rows, and it fails closed via `process.exitCode=1`.
477. `SCRIPT-099` (P0) Hardened `scripts/fixes/fix-duplicate-loyalty-program.ts` to be safe by default: it now defaults to dry-run, mutations require explicit multi-gating (`--confirm` + `RUN_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true` + `ALLOW_FIX_DUPLICATE_LOYALTY_PROGRAM_MUTATION=true`), member migration requires an explicit `--limit` cap (hard cap `500`) and runs in batches, and the duplicate program is only deleted once it has no remaining members.
478. `SCRIPT-100` (P1) Hardened `scripts/database/check-enrollment-sms.ts` to be safe for incident diagnostics: it previously failed open by logging Supabase errors and returning early (while still exiting `0`); it now blocks `--confirm`, uses `createAdminClient`, fails closed via `process.exitCode=1` on any query error, and supports a bounded diagnostic window via `--hours` (default `24`).
479. `SCRIPT-101` (P1) Hardened `scripts/database/check-processed-sms.ts` to be safe for incident diagnostics: it previously hardcoded booking references, ignored Supabase query errors, and could exit `0` after an incomplete run; it now blocks `--confirm`, requires explicit booking reference args (no hardcoded production refs), uses `createAdminClient`, and fails closed via `process.exitCode=1` on any query error.
480. `SCRIPT-107` (P0) Hardened `scripts/cleanup/delete-specific-customers.ts` to require explicit multi-gating and caps: it now defaults to DRY RUN; mutations require `--confirm` plus `RUN_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true` and `ALLOW_DELETE_SPECIFIC_CUSTOMERS_MUTATION=true`, plus an explicit `--limit` that must equal the number of targeted customers (hard cap `50`); and `--confirm` without the RUN env gate fails closed.
481. `SCRIPT-108` (P0) Hardened `scripts/cleanup/delete-test-bookings.ts` to be safe by default: the `delete` command now defaults to DRY RUN and prints an explicit delete plan for payments/items/jobs/booking; mutations require `--confirm` plus `RUN_DELETE_TEST_BOOKINGS_MUTATION=true` and `ALLOW_DELETE_TEST_BOOKINGS_MUTATION=true`; `--confirm` without the RUN env gate fails closed; and mutation deletes are blocked without `--force` when the booking does not look like a test booking.
482. `SCRIPT-112` (P1) Hardened multiple `scripts/database` diagnostic scripts to fail closed and be runnable as `tsx` scripts: they previously swallowed Supabase query/RPC errors and still forced success termination (`process.exit(0)` / `.then(() => process.exit(0))`), and some imported Next.js server Supabase clients. Fix: standardize on `createAdminClient`, remove all `process.exit(...)` usage in favor of fail-closed `process.exitCode=1` handling, add shebangs, and require explicit targeting for `check-user-permissions` via `--user-id` or `--email`.
483. `SCRIPT-113` (P0) Hardened `scripts/cleanup/delete-test-customers.ts` to remove an unsafe server-action delete path: it now delegates to the hardened `scripts/cleanup/delete-test-customers-direct.ts` script (safe-by-default DRY RUN), which requires explicit multi-gating (`--confirm` + `RUN_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true` + `ALLOW_DELETE_TEST_CUSTOMERS_DIRECT_MUTATION=true`) plus an explicit `--limit` with a hard cap (`50`) before any deletes; shared cap parsing/hard-cap assertions live in `src/lib/delete-test-customers-direct-safety.ts`, and the scripts fail closed via `process.exitCode=1`.
484. `SCRIPT-114` (P1) Hardened legacy messaging diagnostic scripts `scripts/database/check-messages-permissions.ts` and `scripts/database/check-messages.ts` to fail closed and be runnable as `tsx` scripts: they previously used a Node shebang, loaded env from a broken `__dirname` path, and could exit `0` after logging Supabase errors. Fix: standardize on `createAdminClient`, block `--confirm` (read-only), remove `process.exit(...)` usage in favor of fail-closed `process.exitCode=1`, and treat missing expected `messages.manage`/`messages.send` permissions as a script failure.
485. `SCRIPT-118` (P1) Hardened additional legacy `scripts/database` diagnostics to be safe for incident review: `check-production-templates`, `check-customer-labels`, `check-event-categories`, `check-event-categories-data`, and `check-invalid-phone-numbers` previously used ad-hoc Supabase clients (`createClient` + service-role key), loaded `.env.local` via brittle `__dirname` paths, and used `.catch(console.error)` / log-and-return patterns that could exit `0` after query/RPC failures. Fix: standardize them as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), route query/RPC failures through `assertScriptQuerySucceeded`/`markFailure`, remove all `process.exit(...)` usage, and fail closed via `process.exitCode=1`. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover these scripts.
486. `SCRIPT-119` (P1) Hardened `scripts/database/check-invalid-bank-details.ts` to be safe for incident diagnostics: it previously loaded `.env.local` from a brittle `__dirname` path, used an ad-hoc Supabase client (`createClient` + service-role key), and failed open by logging query errors and returning while still exiting `0`. Fix: standardize it as a runnable `tsx` script using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), and fail closed via `process.exitCode=1` on any query error (and when invalid bank details are detected). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover this script.
487. `SCRIPT-122` (P1) Hardened webhook log diagnostic scripts (`scripts/database/check-webhook-logs-new.ts`, `scripts/database/check-webhook-logs.ts`) to be safe for incident diagnostics: they previously failed open by ignoring Supabase query errors (or catching and logging without setting a non-zero exit code), producing false-green incident diagnostics during Twilio/SMS investigations. Fix: standardize both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), route query failures through `assertScriptQuerySucceeded`/`markFailure`, and fail closed via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover both scripts.
488. `SCRIPT-123` (P1) Hardened SMS tools diagnostics (`scripts/sms-tools/check-all-jobs.ts`, `scripts/sms-tools/check-reminder-issues.ts`) to be safe for incident diagnostics: they previously lacked `tsx` shebangs and failed open by ignoring Supabase query errors, producing false-green diagnostics around stuck jobs and reminder re-sends. Fix: standardize both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), add bounded sampling (`--limit` with a hard cap) to avoid unbounded reads/output, and fail closed via `process.exitCode=1` on any query error (and when issue conditions are detected). Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to cover both scripts.
489. `SCRIPT-124` (P1) Hardened SMS diagnostics scripts (`scripts/database/check-sms-status.ts`, `scripts/database/check-sms-templates.ts`) to be safe for incident diagnostics: they previously had hard-coded production defaults (booking reference), selected `*` across sensitive tables, and failed open by ignoring Supabase query errors (logging and returning while still exiting `0`). Fix: standardize both as runnable `tsx` scripts using `createAdminClient`, load `.env.local` from `process.cwd()`, require explicit `--booking-ref` (no baked-in production references), bound outputs (`--limit` hard cap + masked phones, optional `--show-body`), block `--confirm` (strict read-only), and fail closed via `process.exitCode=1` on any query error (and missing expected templates/jobs). Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` to cover both scripts.
490. `SCRIPT-125` (P1) Hardened remaining fail-open `scripts/database` diagnostics (`scripts/database/check-audit-logs.ts`, `scripts/database/check-booking-duplicates.ts`, `scripts/database/check-booking-errors.ts`, `scripts/database/check-sunday-lunch-orders.ts`, `scripts/database/check-sunday-lunch-table.ts`, `scripts/database/check-venue-spaces.ts`, `scripts/database/check-payment-status.ts`, `scripts/database/check-latest-booking-details.ts`) to be safe for incident diagnostics: they previously used legacy/broken Supabase client patterns (`supabase-singleton` / Next.js server clients), lacked `tsx` shebangs, ran unbounded queries, and failed open by logging and returning. `check-booking-errors` additionally attempted to queue SMS via a server action with no gating. Fix: standardize all eight scripts as runnable `tsx` diagnostics using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), add bounded sampling (`--limit` with hard caps), require explicit targeting for booking-focused scripts (`--booking-ref` / `--latest`), and fail closed via `process.exitCode=1` + `assertScriptQuerySucceeded` (no `process.exit`). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all eight scripts.
491. `SCRIPT-126` (P1) Hardened additional `scripts/database` read-only diagnostics (`scripts/database/check-attendance-dates.ts`, `scripts/database/check-booking-discount.ts`, `scripts/database/check-current-schema.ts`, `scripts/database/check-customer-phone.ts`, `scripts/database/check-customers-and-labels.ts`, `scripts/database/check-event-images.ts`, `scripts/database/check-pending-booking.ts`, `scripts/database/check-recent-attendance.ts`, `scripts/database/check-table-bookings-structure.ts`) to be safe for incident response: they previously used legacy/broken Supabase client patterns (`supabase-singleton` / Next.js server clients), embedded hard-coded production identifiers (booking IDs, event IDs, default phone), printed PII, and/or used `process.exit(...)` / fail-open error handling. Fix: rewrite as runnable `tsx` diagnostics using `createAdminClient`, load `.env.local` from `process.cwd()`, block `--confirm` (strict read-only), require explicit targeting flags (`--phone`, `--token`, `--booking-id`, `--event-id`), add explicit caps (`--limit` hard caps) where applicable, mask phone output, and fail closed via `process.exitCode=1` + `assertScriptQuerySucceeded` (no `process.exit`). Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all scripts above.
492. `SCRIPT-131` (P1) Hardened remaining `scripts/database` schema/migration/client check scripts (`scripts/database/check-customer-schema.ts`, `scripts/database/check-event-categories-migration.ts`, `scripts/database/check-migration-history.ts`, `scripts/database/check-migration-simple.ts`, `scripts/database/check-migrations.ts`, `scripts/database/check-schema-admin.ts`, `scripts/database/check-schema-env.ts`, `scripts/database/check-supabase-clients.ts`) to be safe for incident diagnostics: they previously used a `node` shebang on TypeScript (not runnable), loaded env from `.env` or brittle relative paths, used ad-hoc Supabase clients, printed sample PII and/or ran unbounded reads (e.g., full slug scans), contained non-ASCII log markers, and/or used `process.exit(...)` / fail-open error handling. Fix: rewrite all eight as runnable `tsx` scripts that load `.env.local` from `process.cwd()`, use `createAdminClient`, block `--confirm` (strict read-only), add explicit caps (`--limit`, `--max-print`, `--max-slugs`) and PII masking for sample output, remove `process.exit(...)` in favor of fail-closed `process.exitCode=1` + completion assertions, and standardize logs to ASCII-only. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` to cover all eight scripts (tsx shebang, fail-closed, no `process.exit`, and no DB mutations).
493. `SCRIPT-132` (P1) Hardened remaining mutation-capable `scripts/sms-tools` and `scripts/cleanup` wrappers to keep fail-closed behavior consistent and testable: `scripts/sms-tools/backfill-twilio-log.ts`, `scripts/sms-tools/fix-past-reminders.ts`, `scripts/sms-tools/finalize-event-reminders.ts`, `scripts/sms-tools/migrate-invite-reminders.ts`, `scripts/sms-tools/cleanup-phone-numbers.ts`, `scripts/sms-tools/clear-stuck-jobs.ts`, `scripts/sms-tools/clear-reminder-backlog.ts`, `scripts/cleanup/delete-test-invoices.ts`, `scripts/cleanup/delete-specific-invoice.ts`, `scripts/cleanup/delete-peter-pitcher-bookings.ts`, `scripts/cleanup/delete-peter-test-bookings.ts`, and `scripts/cleanup/delete-all-table-bookings.ts` still ended with top-level `process.exit(1)` catches. Fix: replace those terminal exits with `process.exitCode = 1` so safety/env/query failures remain non-zero while preserving deterministic completion semantics used by script harnesses. Regression: expanded `tests/scripts/testScriptMutationGating.test.ts` and `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to assert gating/caps plus `process.exitCode` fail-closed semantics and forbid `process.exit(` for this script set.
494. `SCRIPT-134` (P1) Hardened remaining utility fix scripts in owned scope to fail closed with safe defaults: `scripts/fixes/fix-api-access-simple.ts` previously embedded a hard-coded production `key_hash`, selected broad API-key data, and could return success after service-role query failures; `scripts/fixes/fix-google-service-key.ts` previously used forced `process.exit(1)` paths, did not deterministically await auth validation, and wrote output JSON by default. Fix: block `--confirm` in both scripts, require explicit validated `--key-hash` (or `API_KEY_HASH`) for API-key diagnostics, remove hard-coded key targeting, route fatal paths through `process.exitCode = 1` (no `process.exit`), and default the Google key helper to read-only behavior with optional `--write-json` and `--output-path` for local writes. Regression: expanded `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` to assert read-only defaults and fail-closed semantics for both scripts.
495. `SCRIPT-136` (P1) Hardened remaining mutation-enabled fix scripts to require explicit hard caps instead of implicit single-target assumptions: `scripts/fixes/fix-table-booking-api-permissions.ts`, `scripts/fixes/fix-pending-payment.ts`, and the `--write-probe` path in `scripts/fixes/fix-table-booking-sms.ts` previously allowed mutation mode without an explicit cap flag, relying only on key/booking targeting. Fix: require `--limit=1` in mutation mode for all three paths (with helper-level hard-cap assertions), keep existing multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`), and preserve fail-closed non-zero exits via `process.exitCode = 1`. Regression: expanded `tests/scripts/testScriptMutationGating.test.ts` plus helper safety suites `tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts`, `tests/lib/pendingPaymentFixSafety.test.ts`, and `tests/lib/tableBookingSmsFixSafety.test.ts` to enforce required cap parsing and `--limit=1` hard-cap validation.
496. `SCRIPT-139` (P1) Hardened high-risk cleanup mutation scripts to require explicit operator caps: `scripts/cleanup/delete-test-invoices.ts`, `scripts/cleanup/delete-peter-pitcher-bookings.ts`, `scripts/cleanup/delete-peter-test-bookings.ts`, and `scripts/cleanup/delete-all-table-bookings.ts` previously entered mutation mode without explicit `--limit` caps, allowing one confirmed run to delete unbounded rows. Fix: require explicit `--limit` in mutation mode for all four scripts, add helper-level hard-cap assertions (`200` for targeted invoice/booking cleanup scripts; `10000` for delete-all-table-bookings), and fail closed when matched/planned row mutations exceed the declared limit. Regression: expanded `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/lib/deletePeterPitcherBookingsSafety.test.ts`, `tests/lib/deletePeterTestBookingsSafety.test.ts`, `tests/lib/deleteAllTableBookingsSafety.test.ts`, and `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to enforce cap parsing/hard caps plus read-only and multi-gating markers.
497. `SCRIPT-140` (P1) Hardened remaining cleanup mutation scripts to require explicit operator caps: `scripts/cleanup/delete-specific-invoice.ts` and `scripts/cleanup/delete-test-bookings.ts` previously entered mutation mode without explicit cap flags, relying only on explicit invoice/booking targeting. Fix: require explicit `--limit=1` in mutation mode for both scripts, add helper-level cap parsing and hard-cap assertions for delete-test-bookings (`src/lib/delete-test-bookings-safety.ts`), and fail closed when matched rows exceed the declared limit. Regression: expanded `tests/lib/deleteTestBookingsSafety.test.ts`, `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/scripts/testSmsCleanupScriptsSafety.test.ts`, and `tests/scripts/testScriptMutationGating.test.ts` to enforce cap markers/parsing/hard-cap behavior plus read-only multi-gating semantics.
498. `SCRIPT-142` (P1) Hardened deployment-status operational script to require an explicit cap in confirm-mode sends: `scripts/database/check-deployment-status.ts` previously allowed confirm-mode send execution without explicit per-run cap acknowledgement. Fix: add explicit cap parsing (`--limit` / `CHECK_DEPLOYMENT_STATUS_LIMIT`), require `--limit=1` in confirm mode (hard cap `1`), and fail closed when planned request count exceeds the declared cap before any send path executes. Regression: expanded `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` to enforce cap markers, required multi-gating, and fail-closed script semantics.
499. `SCRIPT-145` (P1) Hardened SMS diagnostics script `scripts/database/check-sms-jobs.ts` to use explicit read-only script-safe query handling: it previously used raw `@supabase/supabase-js` client construction and did not explicitly block `--confirm`, leaving diagnostic safety conventions inconsistent with hardened incident-response scripts. Fix: switch to `createAdminClient`, explicitly block `--confirm` for this read-only diagnostic, and route query checks through `assertScriptQuerySucceeded` for deterministic fail-closed behavior on DB read failures. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` with direct `check-sms-jobs.ts` guard assertions (read-only block + script-safe query helper usage + no raw `@supabase/supabase-js` import).
500. `SCRIPT-146` (P1) Hardened SMS diagnostics scripts `scripts/database/check-sms-queue.ts` and `scripts/database/check-bulk-sms-jobs.ts` to align with read-only fail-closed script safety: they previously used raw `@supabase/supabase-js` client construction and did not explicitly block `--confirm`. Fix: standardize both scripts on `createAdminClient`, explicitly reject `--confirm` in read-only mode, and route DB reads through `assertScriptQuerySucceeded` for deterministic non-zero exits on query failures. Regression: expanded `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` with direct guard assertions for both scripts (read-only block markers + script-safe admin/query helper usage + no raw `@supabase/supabase-js` import).
500. `SCRIPT-146` (P1 follow-up) Hardened remaining SMS diagnostics read-only guardrails in `scripts/database/check-sms-issue.ts` and `scripts/database/check-table-booking-sms.ts`: both scripts had drifted back to raw `@supabase/supabase-js` client wiring and did not explicitly reject `--confirm`, leaving incident diagnostics inconsistent with script-safe fail-closed conventions. Fix: standardize both scripts on `createAdminClient`, explicitly reject `--confirm` in read-only mode, and route all DB reads/count checks through `assertScriptQuerySucceeded` for deterministic non-zero exits on query failures.
500. `SCRIPT-146` (P1 follow-up) Hardened additional database diagnostics to enforce script-safe fail-closed behavior: `scripts/database/check-api-key-database.ts` and `scripts/database/check-performance.ts` still relied on raw `@supabase/supabase-js` client construction, and `check-performance.ts` used fail-open timing checks that could exit `0` after query failures. Fix: standardize both scripts on `createAdminClient`, explicitly block `--confirm` in read-only mode, route reads/count checks through `assertScriptQuerySucceeded`, and fail closed on any failed performance query measurement.
500. `SCRIPT-146` (P1 follow-up) Hardened remaining SMS cleanup/remediation scripts `scripts/sms-tools/clear-stuck-jobs.ts`, `scripts/sms-tools/clear-reminder-backlog.ts`, `scripts/sms-tools/fix-past-reminders.ts`, and `scripts/sms-tools/finalize-event-reminders.ts` to remove raw `@supabase/supabase-js` service-role client wiring and align with script-safe admin client conventions. Fix: standardize all four scripts on `createAdminClient` while preserving dry-run defaults, explicit multi-gating, explicit hard caps, strict row-effect checks, and fail-closed non-zero exits.
500. `SCRIPT-146` (P1 follow-up) Hardened additional SMS/maintenance scripts to remove remaining raw service-role Supabase client construction: `scripts/sms-tools/backfill-twilio-log.ts`, `scripts/sms-tools/migrate-invite-reminders.ts`, `scripts/sms-tools/cleanup-phone-numbers.ts`, `scripts/fixes/fix-rpc-functions.ts`, `scripts/fixes/fix-rpc-functions-direct.ts`, and the service-role query path in `scripts/fixes/fix-api-access-simple.ts`. Fix: standardize these service-role paths on `createAdminClient`, add explicit read-only `--confirm` blocking in both RPC diagnostics scripts, route reads through `assertScriptQuerySucceeded` where applicable, and keep fail-closed non-zero exits.
500. `SCRIPT-146` (P1 follow-up) Completed scoped raw-client cleanup by removing the last remaining `@supabase/supabase-js` imports in owned directories from `scripts/database/check-booking-duplicates.ts` and `scripts/fixes/fix-api-access-simple.ts`. Fix: replace anon visibility probes with explicit read-only REST checks (`fetch`) while keeping service-role diagnostics on `createAdminClient`, preserving read-only defaults and fail-closed non-zero behavior.
500. `SCRIPT-146` (P1 follow-up) Hardened remaining job/message diagnostics scripts `scripts/database/check-failed-jobs.ts`, `scripts/database/check-job-tables.ts`, and `scripts/database/check-jobs.ts` for deterministic incident-safe read-only behavior: they still allowed ambiguous operator intent (`--confirm` not explicitly blocked), mixed ad-hoc query error handling, and included unbounded pending-job reads. Fix: add explicit read-only `--confirm` rejection, enforce bounded `--limit` parsing with hard cap `200`, route reads through `assertScriptQuerySucceeded` (including per-table fail markers in `check-job-tables`), and preserve non-zero fail-closed exits via `process.exitCode = 1`. Regression: expanded `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` with direct guard assertions for all three scripts (`--confirm` block, `--limit` hard-cap markers, script-safe query helper usage, and admin-client-only wiring).
500. `SCRIPT-146` (P1 follow-up) Hardened root jobs-script cap parsing in `src/lib/process-jobs-script-safety.ts` and `src/lib/job-retry-script-safety.ts`: both helpers still used permissive `Number.parseInt`, so malformed values like `--limit=1abc` (or `PROCESS_JOBS_BATCH_SIZE=1abc`) could be truncated and accepted for mutation-cap paths used by `scripts/process-jobs.ts`, `scripts/reset-jobs.ts`, and `scripts/retry-failed-jobs.ts`. Fix: require strict positive integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) before existing hard-cap checks (`100`/`500`) so malformed limits fail closed. Regression: expanded `tests/lib/processJobsScriptSafety.test.ts` and `tests/lib/jobRetryScriptSafety.test.ts` with malformed-cap rejection assertions.
500. `SCRIPT-146` (P1 follow-up) Hardened cleanup mutation cap parsing in `scripts/cleanup/delete-old-sms-messages.ts` and `scripts/cleanup/delete-all-pending-sms.ts`: both scripts still used permissive `Number.parseInt` in optional cap parsing, so malformed values like `--limit=1abc` / `--jobs-limit=1abc` could be truncated and accepted. Fix: require strict positive integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit fail-closed errors on malformed input while preserving existing dry-run defaults, explicit multi-gating, and hard-cap checks. Regression: expanded `tests/scripts/testSmsCleanupScriptsSafety.test.ts` to enforce strict parser markers and forbid legacy `Number.parseInt` cap parsing in both scripts.
500. `SCRIPT-146` (P1 follow-up) Hardened superadmin permission-fix cap parsing in `src/lib/fix-superadmin-permissions-script-safety.ts`: helper parsing for `--limit` / `--offset` (and env fallbacks) still used permissive `Number.parseInt`, so malformed values like `--limit=1e2`, `--limit=09`, or `--offset=01` could be coerced and weaken explicit cap semantics in `scripts/fixes/fix-superadmin-permissions.ts`. Fix: enforce strict integer parsing (`/^[1-9]\d*$/` for positive limits, `/^(0|[1-9]\d*)$/` for non-negative offsets, plus `Number.isInteger`) with explicit fail-closed errors on malformed CLI/env values. Regression: expanded `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` with malformed-cap rejection coverage and expanded `tests/scripts/testScriptMutationGating.test.ts` to assert `fix-superadmin-permissions` read-only/multi-gating/cap markers.
500. `SCRIPT-146` (P1 follow-up) Hardened remaining cleanup/fix mutation cap parsers in owned scope: `scripts/cleanup/delete-pending-sms.ts`, `scripts/cleanup/delete-all-queued-messages.ts`, `scripts/cleanup/delete-specific-customers.ts`, and `scripts/fixes/fix-duplicate-loyalty-program.ts` still used permissive `Number.parseInt` parsing for explicit mutation caps, so malformed values like `--limit=1e2`, `--limit=09`, or malformed env cap values could be coerced and weaken explicit cap semantics. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit fail-closed errors for malformed CLI/env caps and parse CLI/env sources separately so invalid explicit flags cannot silently fall back to env values. Regression: expanded `tests/scripts/testSmsCleanupScriptsSafety.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` with strict parser markers and guards forbidding legacy `const parsed = Number.parseInt(raw, 10)` patterns for all four scripts.
500. `SCRIPT-146` (P1 follow-up) Hardened confirm-mode send cap parsing in `scripts/database/check-deployment-status.ts`: the send-cap assertion still used permissive `Number.parseInt`, so malformed values such as `--limit=1e0` could coerce to `1` and satisfy confirm-mode gating on a script that can trigger booking-creation side effects. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) while preserving the hard requirement `--limit=1`, and expand argument parsing to support both `--flag value` and `--flag=value` forms so explicit cap parsing is consistent. Regression: expanded `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` to require strict parser markers and forbid legacy `Number.parseInt(limitRaw, 10)` cap coercion.
501. `SCRIPT-085` (P1) Hardened menu seed scripts under `scripts/menu/` to be safe by default: they previously performed `upsert/insert` operations by default without dry-run previews, explicit caps, or robust failure handling; they now default to DRY RUN, require explicit multi-gating (`--confirm` + script-specific `RUN_*` + `ALLOW_*`) plus explicit `--limit` hard caps before any DB writes, and fail closed via `process.exitCode=1`.
501. `SCRIPT-085` (P1 follow-up) Hardened explicit-cap parsing in menu seed mutation scripts: `scripts/menu/seed-chefs-essentials-chips.js`, `scripts/menu/seed-chefs-larder-{slow-cooked-lamb-shanks,garden-peas,buttery-mash,sweet-potato-fries}.js`, and `scripts/menu/seed-menu-dishes.{js,ts}` still parsed `--limit` with `Number.parseInt`, allowing malformed inputs like `--limit=1abc` to be truncated and accepted. Fix: tighten `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any mutation path can proceed.
502. `SCRIPT-086` (P0) Hardened OJ project maintenance scripts under `scripts/oj-projects/` to be safe by default: they previously performed high-risk production mutations (create projects, move entries, update rates/hours) without safe defaults, explicit caps, or strict per-step row-effect checks; they now default to dry-run, require explicit multi-gating (`--confirm` + script-specific `RUN_*` + `ALLOW_*`) plus explicit capped `--limit` before any inserts/updates, enforce strict row-effect assertions, and keep `verify-closing-logic.ts` strictly read-only (blocks `--confirm`).
502. `SCRIPT-086` (P0 follow-up) Hardened explicit-cap parsing in OJ project mutation scripts: `scripts/oj-projects/fix-typo.ts`, `fix-entry-rates.ts`, `move-all-to-retainers.ts`, `move-to-website-content.ts`, `update-barons-retainer.ts`, `update-barons-retainer-hours.ts`, and `add-barons-pubs-entries.ts` still parsed `--limit` with `Number.parseInt`, allowing malformed values (for example `--limit=1abc`) to be truncated and accepted. Fix: tighten each script’s `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any mutation path can proceed.
503. `SCRIPT-087` (P0) Hardened several scripts under `scripts/testing/` to be safe for incident diagnostics: they previously included fail-open `process.exit(0)` / log-and-continue patterns and some included mutation side effects; they are now strictly read-only (block `--confirm`) and fail closed, and PayPal order creation is now gated behind explicit multi-gating (`--confirm` + `RUN_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE=true` + `ALLOW_TEST_PAYPAL_CREDENTIALS_ORDER_CREATE_SCRIPT=true`) plus `--limit=1` (and `--live` is required for `PAYPAL_ENVIRONMENT=live`).
503. `SCRIPT-087` (P0 follow-up) Hardened explicit-cap parsing in high-risk testing send scripts: `scripts/testing/test-paypal-credentials.ts` and `scripts/testing/test-microsoft-graph-email.ts` still parsed `--limit` with `Number.parseInt`, allowing malformed values (for example `--limit=1abc`) to be truncated and accepted. Fix: tighten each script’s `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any order-create/email-send path can proceed.
504. `SCRIPT-088` (P1) Hardened hiring CV cleanup script (`scripts/hiring/cleanup-stuck-cvs.ts`) to be safe by default: it now defaults to dry-run and requires explicit multi-gating (`--confirm` + `RUN_CLEANUP_STUCK_CVS_MUTATION=true` + `ALLOW_CLEANUP_STUCK_CVS_MUTATION_SCRIPT=true`) plus an explicit `--limit` hard cap before any updates, enforces strict row-effect checks, and fails closed via `process.exitCode=1`.
505. `SCRIPT-089` (P1) Hardened additional OJ project verification/list/debug scripts under `scripts/oj-projects/` to be strictly read-only and fail closed: they now block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded` for deterministic non-zero exits on env/query/RPC failures, and verification scripts now exit non-zero when mismatches are detected (vs printing and exiting 0).
506. `SCRIPT-090` (P1) Hardened birthday calendar sync diagnostic (`scripts/testing/test-birthday-calendar-sync.ts`) to be strictly read-only: it now blocks `--confirm`, never calls `syncBirthdayCalendarEvent`, and fails closed via `process.exitCode=1`.
507. `SCRIPT-091` (P0) Hardened Microsoft Graph email test script (`scripts/testing/test-microsoft-graph-email.ts`) to prevent accidental external sends: it now defaults to DRY RUN and only sends when explicitly enabled with multi-gating (`--confirm --limit=1 --to <email>` + `RUN_TEST_MICROSOFT_GRAPH_EMAIL_SEND=true` + `ALLOW_TEST_MICROSOFT_GRAPH_EMAIL_SEND_SCRIPT=true`), enforcing a hard cap of `1`.
508. `SCRIPT-092` (P1) Hardened remaining `scripts/testing/` diagnostics to be runnable and fail closed: fixed broken Supabase imports from Next.js server modules, removed remaining `process.exit(...)` usage, blocked `--confirm` for read-only checks, ensured check scripts set non-zero exit codes when checks fail, and removed Next.js server Supabase client usage from scripts (e.g. PDF generation diagnostics now use `createAdminClient`).
509. `SCRIPT-102` (P1) Hardened table-booking SMS test script to fail closed on query failures: `scripts/testing/test-table-booking-sms.ts` previously logged booking/template query errors and returned early without a non-zero exit code, producing false-green diagnostics; it now routes booking lookup failures, missing bookings/templates, and opt-out blockers through `markFailure(...)` (sets `process.exitCode=1`).
510. `SCRIPT-103` (P1) Hardened template diagnostics scripts to be runnable and fail closed: `scripts/testing/{test-template-loading,test-template-fix,test-production-templates,test-production-template-fix}.ts` previously referenced a non-existent `src/lib/smsTemplates` module and/or removed debug endpoints; they now use `createAdminClient` plus `rpc('get_message_template')` and `message_templates` inventory checks, block `--confirm`, and fail closed via `process.exitCode=1` when templates/RPC results are missing or queries error.
511. `SCRIPT-104` (P1) Hardened menu display diagnostic to require explicit targeting and fail closed: `scripts/testing/test-menu-display.ts` previously hardcoded a production booking reference and printed payloads without any failure signaling; it now requires `--booking-ref` (or env), blocks `--confirm`, and exits non-zero when the public API payload is missing expected item fields or the request fails.
512. `SCRIPT-105` (P1) Hardened deployment status diagnostic to fail closed: `scripts/testing/test-deployment.ts` now blocks `--confirm`, performs GET-only checks, and sets `process.exitCode=1` on site/health-check fetch failures (instead of returning success).
513. `SCRIPT-106` (P1) Hardened SMS diagnostic tool to avoid fail-open termination patterns: `scripts/testing/test-and-fix-sms.ts` now blocks `--confirm`, removes all `process.exit(...)` calls in favor of fail-closed `process.exitCode=1`, and remains strictly read-only (no enqueue/process/send or DB mutations).
514. `SCRIPT-109` (P0) Hardened root cashing-up seed/cleanup scripts (`scripts/seed-cashing-up.ts`, `scripts/seed-cashup-targets.ts`, `scripts/clear-2025-data.ts`) to be safe by default: they now default to DRY RUN, require explicit multi-gating (`--confirm` + script `RUN_*` + `ALLOW_*`) plus explicit `--limit` hard caps before any inserts/upserts/deletes, require explicit targeting (`--site-id` for targets, `--site-id` + `--user-id` for cashup sessions), enforce strict row-effect checks, and fail closed via `process.exitCode=1` (no `process.exit`).
515. `SCRIPT-110` (P0) Hardened booking reminder-flag fix script (`scripts/fix-bookings-is-reminder-only.ts`) to be safe by default: it now defaults to DRY RUN, requires explicit multi-gating (`--confirm` + `RUN_FIX_BOOKINGS_IS_REMINDER_ONLY_MUTATION=true` + allow env), requires `--limit` with a hard cap (`500`), updates only selected IDs, enforces strict row-effect checks, and fails closed via `process.exitCode=1` (no `process.exit`).
516. `SCRIPT-111` (P0) Hardened dev-user bootstrap script (`scripts/setup-dev-user.ts`) to be safe by default: it now defaults to DRY RUN, requires explicit multi-gating (`--confirm` + `RUN_SETUP_DEV_USER_MUTATION=true` + `ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT=true`) plus explicit `--email`, `--password`, and `--role` (no baked-in credentials), supports optional `--reset-password`, enforces strict role-assignment row-effect checks, and fails closed via `process.exitCode=1` (no `process.exit`).
517. `SCRIPT-113` (P1) Hardened event categorization script (`scripts/apply-event-categorization.ts`) to be safe by default: it now defaults to DRY RUN, requires explicit multi-gating (`--confirm` + `RUN_APPLY_EVENT_CATEGORIZATION_MUTATION=true` + `ALLOW_APPLY_EVENT_CATEGORIZATION_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `200`) before any inserts/updates, enforces strict row-effect checks, and fails closed via `process.exitCode=1` (no `process.exit` / no `.catch(console.error)`).
518. `SCRIPT-114` (P0) Hardened employee document import script (`scripts/import-employee-documents.ts`) to be safe by default: it now defaults to DRY RUN and requires explicit multi-gating (`--confirm`/`--commit` + `RUN_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION=true` + `ALLOW_IMPORT_EMPLOYEE_DOCUMENTS_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `500`) before any DB/storage writes, and it fails closed via `process.exitCode=1` with completion assertions (no `process.exit`).
518. `SCRIPT-114` (P0 follow-up) Hardened mutation cap parsing in `scripts/import-employee-documents.ts`: the script still parsed `--limit` with permissive numeric coercion (`Number(...)`), which accepted non-integer values and weakened explicit-cap fail-closed semantics in confirm mode. Fix: add strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit malformed-input throws and support both `--limit=<n>` and `--limit <n>` forms before any mutation path can proceed.
519. `SCRIPT-115` (P1) Hardened Golden Barrels maintenance scripts (`scripts/insert-golden-barrels-hours.ts`, `scripts/rectify-golden-barrels.ts`) to be safe by default: they now default to DRY RUN, require explicit multi-gating (`--confirm` + script `RUN_*` + `ALLOW_*`) plus explicit `--limit` hard caps, require explicit vendor/project targeting (or env overrides), require explicit `--create-missing` before any vendor/settings/work-type creation, and fail closed via `process.exitCode=1`.
520. `SCRIPT-116` (P0) Hardened CV reprocess script (`scripts/reprocess-cvs.ts`) to be safe by default: it now defaults to DRY RUN, requires explicit multi-gating (`--confirm` + `RUN_REPROCESS_CVS_MUTATION=true` + `ALLOW_REPROCESS_CVS_MUTATION_SCRIPT=true`) plus explicit `--limit` (hard cap `500`), updates only selected job IDs with strict row-effect checks, and fails closed via `process.exitCode=1`.
521. `SCRIPT-117` (P0) Hardened invoice reminder trigger script (`scripts/trigger-invoice-reminders.ts`) to be safe by default: it now defaults to DRY RUN and requires explicit multi-gating (`--confirm` + `RUN_TRIGGER_INVOICE_REMINDERS_MUTATION=true` + `ALLOW_INVOICE_REMINDER_TRIGGER_SCRIPT=true`) plus explicit `--limit` (hard cap `50`) and explicit app base URL (`NEXT_PUBLIC_APP_URL` or `--url https://...`) before any email/DB writes, caps parsed vendor recipients, and fails closed via `process.exitCode=1` (no `process.exit`).
522. `SCRIPT-118` (P0) Hardened job maintenance scripts (`scripts/reset-jobs.ts`, `scripts/retry-failed-jobs.ts`, `scripts/process-jobs.ts`) to be safe by default: they now default to DRY RUN, require explicit multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`) plus mandatory `--limit` hard caps (`500`) for any updates, update only explicitly selected job IDs with strict row-effect checks, and block retrying send job types unless `ALLOW_JOB_RETRY_SEND_TYPES=true` is set.
523. `SCRIPT-119` (P1) Hardened hiring flow verification script (`scripts/verify-hiring-flow.ts`) to require an explicit mutation cap: mutation mode now requires `--limit=1` (hard cap `1`) in addition to `--confirm` + env gates, and fails closed when missing/mismatched.
523. `SCRIPT-119` (P1 follow-up) Hardened explicit-cap parsing across remaining root/hiring mutation scripts from this safety stream (`SCRIPT-088/109/110/111/113/115/116/117/119`): `scripts/{clear-cashing-up-data,verify-hiring-flow,seed-cashing-up,seed-cashup-targets,clear-2025-data,fix-bookings-is-reminder-only,setup-dev-user,apply-event-categorization,insert-golden-barrels-hours,rectify-golden-barrels,reprocess-cvs,trigger-invoice-reminders}.ts` and `scripts/hiring/cleanup-stuck-cvs.ts` still parsed `--limit` with permissive `Number.parseInt`, allowing malformed values (for example `--limit=1abc`) to be truncated and accepted. Fix: tighten each script’s `parsePositiveInt` to strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed values before any mutation path can proceed.
524. `SCRIPT-120` (P1) Hardened table booking API diagnostics scripts (`scripts/testing/test-api-booking-fix.ts`, `scripts/testing/test-booking-now.ts`, `scripts/testing/test-sunday-lunch-api.ts`, `scripts/testing/test-sunday-lunch-payment-fix.ts`) to require explicit caps in mutation mode: `--confirm` now requires an explicit `--limit` (hard cap `1` or `2`, depending on script) in addition to existing env gates, and scripts log planned requests vs cap and fail closed on cap violations.
524. `SCRIPT-120` (P1 follow-up) Hardened cap parsing fail-closed behavior in table booking API diagnostics scripts (`scripts/testing/test-api-booking-fix.ts`, `scripts/testing/test-booking-now.ts`, `scripts/testing/test-sunday-lunch-api.ts`, `scripts/testing/test-sunday-lunch-payment-fix.ts`): these scripts still parsed `--limit` with `Number.parseInt`, so malformed values like `--limit=1abc` were silently truncated and accepted. Fix: require strict positive integer input (`/^[1-9]\d*$/` + `Number.isInteger`) and throw on malformed limits before any confirm-mode send path can proceed.
525. `SCRIPT-121` (P1) Hardened root-level debug scripts to fail closed and avoid hard-coded production identifiers: `scripts/debug-booking-payment.ts`, `scripts/debug-booking-payment-records.ts`, `scripts/check-booking-state.ts`, `scripts/debug-bookings.ts`, `scripts/debug-business-hours.ts`, `scripts/check_hours_debug.ts`, `scripts/check_hours_debug.js`, `scripts/fetch-events-for-categorization.ts` are now strictly read-only (block `--confirm`), require explicit targeting flags (booking refs/tokens/dates/limits), cap large outputs, remove `process.exit(...)` in favor of `process.exitCode=1`, and throw on env/query failures to avoid false-green diagnostics.
526. `SCRIPT-124` (P1) Hardened root-level utility scripts (`scripts/reproduce_availability.js`, `scripts/create-placeholder-icons.js`) to fail closed and avoid unsafe defaults: `scripts/reproduce_availability.js` is now strictly read-only (blocks `--confirm`), requires explicit `--date YYYY-MM-DD` (no hard-coded production dates), uses stable UTC day-of-week computation, enforces an interval hard cap, and fails closed via `process.exitCode=1`; `scripts/create-placeholder-icons.js` now fails closed on missing source logo or any copy error via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testRootDebugScriptsFailClosed.test.ts`.
527. `SCRIPT-125` (P1) Hardened several remaining root-level diagnostic scripts (`scripts/check-employee-status.ts`, `scripts/check-golden-barrels-projects.ts`, `scripts/check-golden-barrels-status.ts`, `scripts/debug-schema.ts`, `scripts/debug-outstanding.ts`) to be safe for incident response: they previously failed open (missing non-zero exit on query errors or invalid checks), ignored Supabase errors, embedded hard-coded production identifiers (vendor IDs, invoice numbers, dates), and ran unbounded queries. Fix: rewrite as strictly read-only scripts that block `--confirm`, require explicit targeting (`--vendor-id`) where needed, add explicit `--limit` caps with hard caps, remove hard-coded production identifiers, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query/RPC handling, and avoid `process.exit`. Regression: expanded `tests/scripts/testRootDebugScriptsFailClosed.test.ts`.
528. `SCRIPT-126` (P1) Hardened root-level hiring candidate diagnostic script (`scripts/debug-candidates.ts`) to avoid PII leaks and fail-open behavior: it previously selected `*` and printed candidate emails/parsed_data while ignoring Supabase errors and exiting `0`. Fix: rewrite as strictly read-only (blocks `--confirm`), add explicit `--limit` caps (hard cap `200`) plus optional `--first-name-ilike`, mask PII in logs, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling, and fail closed via `process.exitCode=1` (no `process.exit`). Regression: expanded `tests/scripts/testRootDebugScriptsFailClosed.test.ts`.
529. `SCRIPT-127` (P1) Hardened messages permissions analysis script (`scripts/analysis/analyze-messages-permissions.ts`) to avoid false-green incident diagnostics: it previously used a `node` shebang for TypeScript, swallowed unexpected errors, and exited `0` even when Supabase queries failed. Fix: rewrite as strictly read-only (blocks `--confirm`), use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling with support for both `permissions/role_permissions` and `rbac_*` schemas, remove `process.exit` in favor of `process.exitCode=1`, and add regression `tests/scripts/testAnalysisScriptsFailClosed.test.ts`.
530. `SCRIPT-128` (P1) Hardened backfill scripts (`scripts/backfill/cancelled-parking.ts`, `scripts/backfill/employee-birthdays-to-calendar.ts`) to be safe by default: they now default to DRY RUN and require explicit multi-gating (`--confirm` + script-specific `RUN_*` + `ALLOW_*`) plus explicit caps (`--limit` hard caps; `--booking-id` as implicit cap=1 where applicable) before any DB or calendar writes, and they fail closed via `process.exitCode=1` (no `process.exit`).
531. `SCRIPT-129` (P1) Fixed private-bookings calendar resync script runtime reliability (`scripts/tools/resync-private-bookings-calendar.ts`): it previously imported a Next.js server-only Supabase module and could crash even in dry-run mode; it now uses script-safe imports (`@/lib/supabase/admin`, `@/lib/google-calendar`) and regression coverage asserts no Next.js server runtime imports (`next/headers`).
532. `SCRIPT-130` (P1) Hardened remaining analysis scripts (`scripts/analysis/analyze-duplicates-detailed.ts`, `scripts/analysis/calibrate-hiring-thresholds.ts`, `scripts/analysis/evaluate-hiring-screening.ts`) to be safe for incident diagnostics: they now block `--confirm` (read-only), load `.env.local` from `process.cwd()`, use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed query handling (including overrides query errors), avoid raw `@supabase/supabase-js` clients, and avoid `process.exit` in favor of fail-closed `process.exitCode=1`. Regression: expanded `tests/scripts/testAnalysisScriptsFailClosed.test.ts` to cover these scripts.
533. `SCRIPT-131` (P1) Hardened additional analysis diagnostics (`scripts/analysis/analyze-private-bookings-customers.ts`, `scripts/analysis/analyze-performance.ts`) to be read-only and fail closed: they now block `--confirm`, load `.env.local` from `process.cwd()`, use `createAdminClient` + `assertScriptQuerySucceeded` for deterministic non-zero exits on query/RPC failures, avoid raw `@supabase/supabase-js` clients, and use `process.exitCode=1` instead of `process.exit`.
534. `SCRIPT-133` (P1) Hardened additional `scripts/testing` diagnostics (`scripts/testing/test-critical-flows.ts`, `scripts/testing/test-short-link.ts`, `scripts/testing/test-vip-club-redirect.ts`) to use script-safe query patterns: they previously used raw `@supabase/supabase-js` service-role clients and ad-hoc query handling; they now remain strictly read-only (block `--confirm`), use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed DB/RPC reads, and keep non-zero exits via `process.exitCode=1` (no `process.exit`).
535. `SCRIPT-135` (P1) Hardened remaining read-only diagnostics in `scripts/testing` (`scripts/testing/test-demographics.ts`, `scripts/testing/test-employee-creation.ts`, `scripts/testing/test-analytics-function.ts`) to use script-safe query handling: they previously used raw `@supabase/supabase-js` service-role clients and ad-hoc query checks; they now block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded` for deterministic fail-closed DB/RPC reads, and keep non-zero exits via `process.exitCode=1` (no `process.exit`).
535. `SCRIPT-135` (P1 follow-up) Hardened strict bounded-argument parsing in additional read-only diagnostics (`scripts/testing/test-production-templates.ts`, `scripts/testing/test-template-loading.ts`, `scripts/testing/test-demographics.ts`, `scripts/testing/test-slot-generation.ts`, `scripts/testing/test-audit-log.ts`, `scripts/testing/test-audit-log-rls.ts`, `scripts/testing/test-calendar-sync.ts`): these scripts still used permissive numeric coercion (`Number(value)`) with clamp semantics (`Math.floor`/`Math.min`), so malformed values like `--limit=1e2` or `--days=01` could be accepted and silently altered. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`), fail closed on hard-cap exceedance instead of clamping, and support both `--flag value` and `--flag=value` forms in bounded `getArgValue(...)` readers.
536. `SCRIPT-137` (P1) Hardened remaining read-only SMS diagnostics in `scripts/testing` (`scripts/testing/test-private-booking-customer-creation.ts`, `scripts/testing/test-loyalty-enrollment.ts`, `scripts/testing/test-sms-flow.ts`) to use script-safe query handling: they previously used raw `@supabase/supabase-js` clients and ad-hoc query checks, and `test-sms-flow.ts` did not explicitly block `--confirm`; they now use `createAdminClient` + `assertScriptQuerySucceeded`, enforce read-only `--confirm` blocking in `test-sms-flow.ts`, and keep fail-closed non-zero exits via `process.exitCode=1` (no `process.exit`).
537. `SCRIPT-138` (P1) Hardened remaining SMS send-test scripts in `scripts/testing` (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) to use script-safe query handling: they previously used raw `@supabase/supabase-js` clients and ad-hoc pre-send query checks; they now use `createAdminClient` + `assertScriptQuerySucceeded` for fail-closed customer/booking/template reads while preserving existing multi-gating send controls and non-zero failure exits via `process.exitCode=1` (no `process.exit`).
538. `SCRIPT-141` (P1) Hardened SMS send-test scripts in `scripts/testing` (`scripts/testing/test-table-booking-sms.ts`, `scripts/testing/test-enrollment-with-sms.ts`) to require explicit operator caps in mutation mode: send mode previously did not require explicit per-run cap flags, so confirmed sends could execute without explicit cap acknowledgement. Fix: add explicit `--limit` parsing and hard-cap assertions in `src/lib/test-table-booking-sms-safety.ts` and `src/lib/test-enrollment-with-sms-safety.ts`, enforce `--limit=1` in both scripts alongside existing multi-gating (`--confirm` + `RUN_*` + `ALLOW_*`), and update read-only guidance text to include cap requirements.
538. `SCRIPT-141` (P1 follow-up) Hardened strict cap parsing semantics in `src/lib/test-table-booking-sms-safety.ts` and `src/lib/test-enrollment-with-sms-safety.ts`: both helpers still accepted permissive numeric coercion (`Number(...)`) for `--limit`, allowing malformed values (for example `--limit=1e0` and `--limit=01`) to pass and weakening explicit-cap fail-closed behavior in confirm-mode send paths. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) with explicit malformed-input throws before safety gating can proceed.
539. `SCRIPT-143` (P1) Hardened remaining side-effecting diagnostics in `scripts/testing` (`scripts/testing/test-booking-api.ts`, `scripts/testing/test-sms-new-customer.ts`) to require explicit operator caps in mutation/send mode: both scripts previously allowed confirmed mutation/send paths without explicit cap acknowledgement. Fix: require explicit `--limit=1` in mutation/send mode (hard cap `1`) for both scripts, add helper-level cap parsing/hard-cap assertions in `src/lib/test-sms-new-customer-safety.ts`, and update operator guidance strings to include required caps.
539. `SCRIPT-143` (P1 follow-up) Hardened `scripts/testing/test-api-complete-fix.ts` request-cap semantics: confirm-mode execution still had a cap bypass because `--max-bookings` was clamped with `Math.min(...)` and cap checks only counted create-intent tests, allowing additional outbound POST requests (for `invalid`) without matching explicit cap acknowledgement. Fix: require strict integer `--max-bookings` values with fail-closed hard-cap enforcement (`max 4`) and enforce `plannedRequests <= cap` before any POST is sent.
539. `SCRIPT-143` (P1 follow-up) Hardened `scripts/testing/test-booking-api.ts` cap parser strictness and CLI cap-flag compatibility: it still parsed `--limit` using permissive numeric coercion (`Number(value)`), which accepted malformed values (for example `--limit=1e0`), and it only parsed `--limit <n>` while guidance required `--limit=<n>`. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and support both `--flag value` and `--flag=value` argument forms before send-mode cap checks run.
539. `SCRIPT-143` (P1 follow-up) Hardened `scripts/testing/test-api-complete-fix.ts` cap parser strictness and CLI cap-flag compatibility: it still parsed `--max-bookings` using permissive numeric coercion (`Number(value)`), which accepted malformed values (for example `--max-bookings=1e0`), and it only parsed `--max-bookings <n>` while hardened script guidance also supports `--flag=<n>` inputs. Fix: enforce strict positive-integer parsing (`/^[1-9]\d*$/` + `Number.isInteger`) and support both `--flag value` and `--flag=value` argument forms before send-mode cap checks run.
540. `SCRIPT-144` (P1) Hardened fail-closed behavior in `scripts/testing/test-sms-new-customer.ts`: the script previously logged and continued on critical diagnostic safety failures (missing Twilio sender/credentials, Twilio connectivity errors, and pending-bookings lookup failures), allowing false-green exit `0` runs. Fix: route these paths through `markFailure(...)` so they exit non-zero, require a phone target when send mode is enabled, and preserve explicit `--limit=1` + multi-gating enforcement for send mode.
516. `SCRIPT-111` (P1 follow-up) Hardened `scripts/setup-dev-user.ts` to require an explicit mutation cap: this root-level DB mutation script had dry-run defaults and multi-gating but still lacked explicit operator cap acknowledgement. Fix: require explicit `--limit=1` in mutation mode (hard cap `1`) and fail closed on missing/invalid/exceeding caps while preserving existing multi-gating (`--confirm` + `RUN_SETUP_DEV_USER_MUTATION` + `ALLOW_SETUP_DEV_USER_MUTATION_SCRIPT`).

Regression coverage added:
- `tests/scripts/testBookingApiScriptSafety.test.ts` (expanded `test-booking-api` cap safety coverage: strict positive-integer parser markers, `--flag=value` argument parsing marker, and guard against permissive `Number(value)` cap parsing in send mode)
- `tests/scripts/testApiCompleteFixScriptSafety.test.ts` (expanded `test-api-complete-fix` cap safety coverage: explicit capped `--max-bookings` markers, strict positive-integer parser markers, `--flag=value` argument parsing marker, no clamping (`Math.min`), and guard against permissive `Number(value)` cap parsing)
- `tests/scripts/testTableBookingApiScriptsSafety.test.ts` (expanded table-booking diagnostics safety coverage to enforce strict positive-integer cap parsing markers and forbid `Number.parseInt` cap truncation)
- `tests/lib/testTableBookingSmsSafety.test.ts` (expanded strict cap parser coverage for `src/lib/test-table-booking-sms-safety.ts`: rejects malformed cap formats like `1e0` and `01` in addition to non-numeric values)
- `tests/lib/testEnrollmentWithSmsSafety.test.ts` (expanded strict cap parser coverage for `src/lib/test-enrollment-with-sms-safety.ts`: rejects malformed cap formats like `1e0` and `01` in addition to non-numeric values)
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` (expanded `import-employee-documents.ts` cap parser guard: strict positive-integer parser markers, support for both `--limit=<n>` and `--limit <n>`, and no permissive `Number(...)` coercion pattern)
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` (expanded `setup-dev-user` safety coverage to assert explicit `--limit=1` hard-cap markers and fail-closed cap enforcement text)
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` (regression guard for additional mutation scripts: dry-run by default, multi-gated, capped, and avoids `process.exit`)
- `tests/scripts/testMenuSeedScriptsSafety.test.ts` (menu seed scripts are dry-run by default, multi-gated, capped, and fail closed)
- `tests/scripts/testMenuSeedScriptsSafety.test.ts` (expanded menu seed cap parser guard: all seven menu seed mutation scripts enforce strict positive-integer parsing and no `Number.parseInt` truncation for `--limit`)
- `tests/scripts/testOjProjectsScriptsSafety.test.ts` (OJ projects scripts safety guards: mutation scripts are dry-run by default, multi-gated, capped, and fail closed; read-only OJ verify/find/debug scripts block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded`, and avoid `process.exit`)
- `tests/scripts/testOjProjectsScriptsSafety.test.ts` (expanded OJ mutation cap parser guard: seven OJ mutation scripts enforce strict positive-integer parsing and forbid the legacy `const parsed = Number.parseInt(raw, 10)` cap parser pattern)
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` (expanded read-only/fail-closed guard for `scripts/testing` diagnostics: `test-slot-generation`, `test-analytics-function`, `test-short-link`, and `test-vip-club-redirect` must block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded`, and avoid raw `@supabase/supabase-js` / `process.exit`; PayPal and external-email diagnostics remain explicitly gated/capped)
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` (expanded send-script cap parser guard: `test-paypal-credentials.ts` and `test-microsoft-graph-email.ts` enforce strict positive-integer parsing and forbid the legacy `const parsed = Number.parseInt(raw, 10)` cap parser pattern)
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` (expanded strict bounded parser guard for read-only diagnostics: `test-slot-generation.ts`, `test-template-loading.ts`, and `test-production-templates.ts` now require strict positive-integer parser markers, hard-cap rejection markers, and forbid permissive `Number(value)` parsing)
- `tests/scripts/testDemographicsScriptReadOnly.test.ts` (expanded parser guard: `test-demographics.ts` now requires strict bounded integer parser markers, hard-cap rejection markers, and no permissive `Number(value)` CLI parsing)
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts` (expanded parser guard: `test-audit-log.ts` and `test-audit-log-rls.ts` now require strict bounded integer parser markers, hard-cap rejection markers, and no permissive `Number(value)` CLI parsing)
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` (expanded parser guard for `test-calendar-sync.ts`: strict bounded integer parser markers, hard-cap rejection markers, and no permissive `Number(value)` CLI parsing)
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` (expanded root mutation cap parser guard across cashing-up/hiring/golden-barrels/remediation scripts: strict positive-integer parsing markers and no legacy `const parsed = Number.parseInt(raw, 10)` pattern)
- `tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` (expanded hiring cleanup cap parser guard: strict positive-integer parsing markers and no legacy `const parsed = Number.parseInt(raw, 10)` pattern)
- `tests/scripts/testTableBookingApiScriptsSafety.test.ts` (table booking API scripts require explicit env gating plus explicit `--limit` caps in mutation mode)
- `tests/scripts/testRootDebugScriptsFailClosed.test.ts` (root debug scripts block `--confirm`, require explicit targeting flags, forbid `process.exit`, and avoid hard-coded production identifiers)
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (expanded to cover additional `scripts/database` read-only diagnostics; enforces no DB mutations, no Next.js server Supabase client imports, fail-closed `process.exitCode=1`, no `process.exit`, and `tsx` shebangs)
- `tests/scripts/testAnalysisScriptsFailClosed.test.ts` (analysis scripts block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded`, avoid raw `@supabase/supabase-js` clients, and avoid `process.exit`; expanded coverage includes `analyze-messages-permissions`, `analyze-duplicates-detailed`, `analyze-private-bookings-customers`, `analyze-performance`, `calibrate-hiring-thresholds`, and `evaluate-hiring-screening`)
- `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (expanded SMS diagnostics coverage to assert `test-sms-flow.ts` blocks `--confirm`, uses `createAdminClient` + `assertScriptQuerySucceeded`, avoids raw `@supabase/supabase-js`, requires explicit `--limit=1` send-cap markers in `test-sms-new-customer.ts`, and enforces fail-closed Twilio/db diagnostic failure markers (`markFailure` paths) with no log-and-continue fallback)
- `tests/scripts/testScriptMutationGating.test.ts` (expanded regression guards for `scripts/sms-tools` mutation wrappers: require `--confirm` + dual env gates + explicit caps and forbid terminal `process.exit`)
- `tests/scripts/testSmsCleanupScriptsSafety.test.ts` (expanded cleanup script safety guards for delete wrappers: enforce read-only/mutation gating markers and require `process.exitCode` fail-closed handling without `process.exit`)
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` (calendar sync scripts remain strictly read-only and contain no calendar/DB mutation attempts; blocks `--confirm`; avoids Next.js server Supabase imports)
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts` (audit log diagnostic scripts remain strictly read-only; use `createAdminClient`; avoid Next.js server Supabase imports)
- `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts` (expanded to assert loyalty enrollment diagnostics use `createAdminClient` + `assertScriptQuerySucceeded`, remain strictly read-only, and avoid raw `@supabase/supabase-js` / `process.exit`)
- `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts` (expanded to assert private-booking customer diagnostics use `createAdminClient` + `assertScriptQuerySucceeded`, remain strictly read-only, and avoid raw `@supabase/supabase-js` / `process.exit`)
- `tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` (hiring cleanup script defaults to dry-run and requires multi-gating + caps before any mutation)
- `tests/api/stripeWebhookMutationGuards.test.ts` (Stripe webhook replay/idempotency + mutation row-effect guards: return 200 and keep idempotency claim when response persistence fails; blocked checkout retry-SMS exceptions do not trigger a retry-driving 500; blocked seat-increase and checkout-failure payment updates fail closed when no valid payment row transitions; prepaid/seat-increase/table-card-capture confirmation fulfilled non-success SMS outcomes are logged instead of silently ignored)
- `tests/api/paypalParkingWebhookFailClosed.test.ts` (PayPal parking webhook replay/idempotency guard: return 200 and keep idempotency claim when response persistence fails after processing)
- `tests/actions/privateBookingActionsSmsMeta.test.ts` (private booking actions surface `smsSideEffects` and approved-send `code`/`logFailure` without returning retry-driving errors; actions return `success: boolean` for safe branching)
- `tests/api/bookingCreateIdempotencyFailClosed.test.ts` (booking-create idempotency fail-closed guard: do not release the idempotency claim when response persistence fails after booking creation)
- `tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` (route idempotency fail-closed guards: return success and keep the idempotency claim when response persistence fails after mutations commit in `/api/private-booking-enquiry`, `/api/parking/bookings`, and `/api/external/performer-interest`)
- `tests/actions/smsActionsConsoleGuards.test.ts` (regression guard: blocks direct `console.*` logging in `src/app/actions/sms.ts` so send-path errors are always structured/log-safe)
- `tests/actions/messagesAndQueueConsoleGuards.test.ts` (regression guard: blocks direct `console.*` logging in `src/app/actions/messageActions.ts` and `src/app/actions/job-queue.ts` so SMS reply/enqueue errors are always structured/log-safe)
- `tests/actions/eventsActionsConsoleGuards.test.ts` (regression guard: blocks direct `console.*` logging in `src/app/actions/events.ts` so event mutation + SMS error paths remain structured/log-safe)
- `tests/services/privateBookingsSmsSideEffects.test.ts` (PrivateBookingService cancel/deposit/final-payment flows capture and return `smsSideEffects` meta when queue/send fails or outbound logging fails)
- `tests/lib/staffSeatUpdatesMutationGuards.test.ts` (staff seat-update helper propagates `sms` safety meta from `sendEventBookingSeatUpdateSms`)
- `tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts` (database event-category migration check scripts remain strictly read-only; no helper-function/exec_sql creation)
- `tests/lib/parkingSmsBackfillScriptSafety.test.ts` (parking SMS backfill script mutation gating + explicit caps/limits)
- `tests/lib/parkingSmsBackfillSafety.test.ts` (parking SMS backfill helper safety: dedupe/persistence guards remain fail-closed)
- `tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts` (rpc fix scripts remain strictly read-only; no arbitrary SQL executor; no forced `process.exit(0)`)
- `tests/api/eventBookingsRouteSmsMeta.test.ts` (public event booking route surfaces `meta.sms` on `logging_failed`, including `success:false + logging_failed` fail-safe semantics, keeps idempotency claims when response persistence fails after booking creation, and fails closed when table-reservation rollback hold-release updates zero rows but active holds still remain)
- `tests/api/eventWaitlistRouteSmsMeta.test.ts` (event waitlist join route surfaces `meta.sms` on `logging_failed`, including `success:false + logging_failed` fail-safe semantics, and keeps idempotency claims when response persistence fails after entry creation)
- `tests/api/fohEventBookingsSmsMeta.test.ts` (FOH event booking route surfaces `meta.sms` on `logging_failed`, including `success:false + logging_failed` fail-safe semantics, and fails closed when rollback hold-release updates zero rows but active holds remain)
- `tests/api/tableBookingsRouteSmsMeta.test.ts` (table booking create route returns `meta.sms` and keeps idempotency claims when response persistence fails after booking creation)
- `tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts` (FOH/BOH party-size route handlers avoid direct `console.*` logging; prefer structured `logger`)
- `tests/lib/tableBookingCreatedSmsMeta.test.ts` (`sendTableBookingCreatedSmsIfAllowed` treats `logging_failed` as sent/unknown while preserving `code`/`logFailure`)
- `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts` (`sendSundayPreorderLinkSmsIfAllowed` treats `logging_failed` as sent/unknown while preserving `code`/`logFailure`)
- `tests/lib/tableBookingHoldAlignment.test.ts` (`alignTableCardCaptureHoldToScheduledSend` now throws on any DB write error or zero-row alignment result instead of logging-and-continuing)
- `tests/lib/parkingPaymentsPersistence.test.ts` (parking payment request + confirmation notification logs persist `sms_code`/`sms_log_failure` markers when `sendSMS` returns `logging_failed`)
- `tests/lib/eventPaymentSmsSafetyMeta.test.ts` (event payment confirmation + retry SMS logs explicitly on `logging_failed`)
- `tests/scripts/testSmsCleanupScriptsSafety.test.ts` (cleanup scripts remain dry-run by default, multi-gated, explicitly capped, non-interactive, and avoid `process.exit`)
- `tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` (expanded to assert `test-table-booking-sms.ts` and `test-enrollment-with-sms.ts` use `createAdminClient` + `assertScriptQuerySucceeded`, enforce explicit `--limit=1` cap markers, treat `logging_failed` / `logFailure` as failures, avoid raw `@supabase/supabase-js`, and avoid `process.exit`)
- `tests/lib/testTableBookingSmsSafety.test.ts` (expanded cap parsing and hard-cap assertions for `test-table-booking-sms`: invalid/missing/exceeds/must-equal-1 `--limit` cases)
- `tests/lib/testEnrollmentWithSmsSafety.test.ts` (expanded cap parsing and hard-cap assertions for `test-enrollment-with-sms`: invalid/missing/exceeds/must-equal-1 `--limit` cases)
- `tests/lib/twilioSendLoggingFailClosed.test.ts` (sendSMS returns `code: 'logging_failed'` + `logFailure: true` when outbound `messages` persistence fails after a transport send, or when customer context is missing and logging is impossible (e.g. `createCustomerIfMissing=false` with no `customerId`); bulk loops can detect fatal `logging_failed`)
- `tests/lib/smsBulkLoopGuards.test.ts` (bulk SMS aborts on fatal safety failures like `logging_failed` to prevent unlogged fanout)
- `tests/lib/smsBulkLoopGuards.test.ts` (bulk SMS single-flight guard: even when high concurrency is requested, fatal `logging_failed` aborts before additional sends start)
- `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (read-only + fail-closed regression guard for SMS diagnostics scripts under `scripts/testing/` and `scripts/database/`)
- `tests/scripts/testScriptMutationGating.test.ts` (expanded mutation gating guard for fix scripts: `fix-table-booking-api-permissions`, `fix-pending-payment`, and `fix-table-booking-sms` now require explicit mutation cap flags)
- `tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts` (expanded cap parsing and hard-cap validation for `fix-table-booking-api-permissions` mutation mode)
- `tests/lib/pendingPaymentFixSafety.test.ts` (expanded cap parsing and hard-cap validation for `fix-pending-payment` mutation mode)
- `tests/lib/tableBookingSmsFixSafety.test.ts` (expanded write-probe cap parsing and hard-cap validation for `fix-table-booking-sms`)
- `tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` (script safety regression guard: root cashing-up seed/target/clear scripts, booking reminder-flag fix, setup-dev-user, and hiring-flow verification scripts are dry-run by default, multi-gated, capped, and avoid `process.exit`; and debug-outstanding fails closed)
- `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` (expanded script safety regression guards: blocks `.catch(console.error)` and enforces read-only/fail-closed semantics for `scripts/fixes/fix-api-access-simple.ts` and `scripts/fixes/fix-google-service-key.ts`)
- `tests/lib/bulkDispatchKey.test.ts` (dispatch-key stability + recipient-cap validation guard)
- `tests/lib/sms/safety.test.ts` (queue job metadata dedupe regression + legacy `job_id` ignored for idempotency)
- `tests/lib/idempotency.test.ts` (expired key lookup/reclaim + in-progress behavior)
- `tests/lib/sms/safety.test.ts` (expired SMS idempotency reclaim)
- `tests/services/cashing-up.service.test.ts` (submit/approve + upsert-update/lock/unlock transition guards)
- `tests/lib/statusTransitions.test.ts` (invoice/quote transition guard matrix)
- `tests/services/employees.service.test.ts` (employee stale update/delete row-effect guards + attachment path-trust + right-to-work delete rollback guard)
- `tests/actions/receiptsActions.test.ts` (receipt file delete rollback reinsertion + metadata-insert cleanup-failure reporting)
- `tests/actions/receiptsActions.test.ts` (manual receipt status/classification/rule update stale no-row guards)
- `tests/actions/eventImagesActions.test.ts` (event image delete rollback reinsertion + event/image not-found row-effect guards)
- `tests/services/business-hours.service.test.ts` (special-hours precheck/load failure guards + service-status slot update failure guard)
- `tests/services/menu.service.test.ts` (menu delete not-found guard regressions)
- `tests/services/permission.service.test.ts` (role delete row-effect guard)
- `tests/lib/apiAuthRateLimit.test.ts` (API-key rate-limit DB error fail-closed guard)
- `tests/actions/employeeActions.test.ts` (post-persist employee attachment side-effect failures stay non-destructive)
- `tests/services/mutation-race-guards.test.ts` (vendor/category/customer/short-link/event/catalog row-effect race guards)
- `tests/services/mutation-race-guards.test.ts` (CustomerService.toggleSmsOptIn updates `sms_status` and disables `marketing_sms_opt_in` on opt-out so SMS eligibility cannot remain active after opt-out)
- `tests/actions/adminActionMutationGuards.test.ts` (vendor contact + message template row-effect guards)
- `tests/actions/ojProjectMutationGuards.test.ts` (OJ project action row-effect guard regressions)
- `tests/actions/parkingActions.test.ts` (parking payment persistence/row-effect guard regressions)
- `tests/actions/performerSubmissionsActions.test.ts` (performer submission stale-update guard)
- `tests/actions/profileActions.test.ts` (profile row-effect + avatar orphan cleanup guard)
- `tests/actions/eventsManualBookingGuards.test.ts` (event manual cancellation stale-update guard + follow-up update failure guards (hold release / linked table bookings) + zero-row linked-table follow-up verification fail-closed guard + table-reservation rollback fail-closed guard + table-reservation rollback zero-row hold-release verification fail-closed guard + manual create/seat-update/cancel `logging_failed` fail-safe semantics)
- `tests/actions/importMessagesConsoleGuards.test.ts` (regression guard: import-missed-messages action avoids direct `console.*` logging)
- `tests/services/privateBookingsMutationGuards.test.ts` (private-booking item/discount/cancel/expire/vendor-space/package row-effect guards)
- `tests/services/smsQueue.service.test.ts` (queue sent-status persistence row-effect guard + approved-dispatch claim conflict/reclaim-race fail-closed guards + approve/reject blocked when dispatch markers are present + auto-send rows claimed with a `dispatching:` marker and cleared on sent persistence + `sendApprovedSms` returns `{ success, code, logFailure }` safety meta + approved-dispatch metadata avoids `job_id` idempotency bypass + approved/auto send paths surface `code`/`logFailure` and persist `sms_code`/`sms_log_failure` markers in queue metadata + auto-send path uses transport-level `sendSMS` directly (system context) with stable idempotency metadata + failed-status reconciliation fail-closed guard)
- `tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts` (regression guard: blocks `.catch(console.error)` in `PrivateBookingService` so SMS queue/send errors cannot be swallowed)
- `tests/services/messages.service.test.ts` (MessageService.sendReply surfaces `code`/`logFailure` when outbound message logging fails so message-thread UI can detect degraded persistence/safety state)
- `tests/api/bohTableBookingSmsRouteSafety.test.ts` (BOH manual table-booking SMS route surfaces `code`/`logFailure` in success responses when outbound message logging fails)
- `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` (event booking seat-update SMS helper surfaces `code`/`logFailure`, including `logging_failed`, and logs explicitly when outbound message logging fails so degraded persistence is observable)
- `tests/lib/testSmsNewCustomerSafety.test.ts` (expanded test SMS script safety helpers: send gating requires `--confirm` + env allow flag and explicit `--limit=1` hard-cap validation; deterministic metadata builder)
- `tests/scripts/testAndFixSmsScriptReadOnly.test.ts` (read-only regression guard: diagnostic SMS tool cannot enqueue/process/send or mutate DB, blocks `--confirm`, and avoids `process.exit`)
- `tests/scripts/testBookingApiScriptSafety.test.ts` (expanded safety regression guard: booking initiation API diagnostic script defaults to dry-run, requires multi-gate send enablement plus explicit `--limit=1` hard-cap markers, and does not default to production URL or baked-in phone numbers)
- `tests/scripts/testTableBookingApiScriptsSafety.test.ts` (safety regression guard: table booking API diagnostic scripts require multi-gate send enablement and contain no prod URL defaults, baked-in API keys, or baked-in phone numbers)
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts` (read-only regression guard: audit log diagnostic scripts cannot insert/update/delete or attempt helper function creation)
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` (safety regression guard: scripts do not embed Anchor API keys and do not default to production targets)
- `tests/scripts/testDemographicsScriptReadOnly.test.ts` (expanded read-only regression guard: demographics diagnostics block `--confirm`, use `createAdminClient` + `assertScriptQuerySucceeded`, avoid raw `@supabase/supabase-js`, and contain no insert/update/delete calls)
- `tests/scripts/testBackfillScriptsSafety.test.ts` (safety regression guard: backfill scripts default to DRY RUN, require multi-gating + explicit caps before any DB or calendar writes, and avoid `process.exit`)
- `tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` (safety regression guard: calendar resync script defaults to dry-run and requires explicit caps + multi-gating, and forbids Next.js server runtime imports)
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` (read-only regression guard: calendar sync testing scripts cannot perform calendar writes or mutate DB)
- `tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts` (safety regression guard: Feb 2026 review bulk SMS script does not default to production URLs and uses fail-closed exit codes)
- `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts` (read-only regression guard: loyalty enrollment diagnostic script cannot generate random phone numbers or mutate DB)
- `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts` (read-only regression guard: private-booking customer-creation diagnostic script cannot mutate DB and blocks `--confirm`/`--keep`)
- `tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` (expanded read-only regression guard: critical-flows script cannot mutate DB, blocks `--confirm`, uses `createAdminClient` + `assertScriptQuerySucceeded`, forbids raw `@supabase/supabase-js`, and exits non-zero when smoke checks fail)
- `tests/scripts/testServerActionImportScriptReadOnly.test.ts` (read-only regression guard: server-action import diagnostic script cannot call server actions or mutate DB)
- `tests/scripts/testCronEndpointScriptReadOnly.test.ts` (read-only regression guard: cron endpoint diagnostic script cannot POST/process jobs or mutate DB)
- `tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts` (read-only regression guard: customer-labels cron diagnostic script cannot trigger label application or mutate DB)
- `tests/api/cronApplyCustomerLabelsHealth.test.ts` (health-check regression guard: customer-labels cron route supports authorized `?health=true` without RPC/audit writes)
- `tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` (expanded read-only regression guard: employee diagnostics script uses `tsx` shebang, blocks `--confirm`, uses `createAdminClient` + `assertScriptQuerySucceeded`, avoids raw `@supabase/supabase-js`, and contains no insert/update/delete/RPC mutation calls)
- `tests/scripts/testShortLinkCrudScriptReadOnly.test.ts` (read-only regression guard: short-link CRUD diagnostic script cannot insert/update/delete short links)
- `tests/scripts/testEventImageScriptsReadOnly.test.ts` (read-only regression guard: event image-field diagnostic scripts cannot insert/update/delete events/categories)
- `tests/actions/importMessagesActions.test.ts` (import-messages server action fails closed on lookup errors and creates SMS-deactivated placeholder customers)
- `tests/scripts/importMissedMessagesLegacyScriptReadOnly.test.ts` (read-only regression guard: legacy Twilio backfill script blocks `--confirm` and contains no DB mutation calls)
- `tests/actions/messagesMutationGuards.test.ts` (message read/unread row-effect guards)
- `tests/lib/smsBulkMarketingEligibility.test.ts` (bulk SMS helper enforces `sms_opt_in=true`, `marketing_sms_opt_in=true`, and non-blocked `sms_status` before dispatch)
- `tests/lib/smsBulkLoopGuards.test.ts` (bulk SMS loop guard coverage updated for marketing eligibility gating)
- `tests/actions/diagnoseMessagesActions.test.ts` (diagnose-messages action fails closed when DB lookups error and returns empty summary when Twilio has no messages)
- `tests/api/bulkCustomersRouteMarketingEligibility.test.ts` (bulk customer selection route enforces marketing eligibility so bulk audiences align with dispatch gating)
- `tests/actions/fixPhoneNumbersActions.test.ts` (phone-fix maintenance row-effect accounting guard)
- `tests/services/business-hours.service.test.ts` (service-status override delete row-effect guard)
- `tests/lib/backgroundJobsQueue.test.ts` (legacy job pending-claim race guard + failure-state processing guard)
- `tests/lib/backgroundJobsQueue.test.ts` (send_sms job execution fails closed when `customer_id` is missing and when `sendSMS` reports `logFailure`/`code: 'logging_failed'`, and treats `suppressed_duplicate`/quiet-hours `deferred` results as success to avoid retry loops)
- `tests/lib/chargeApprovals.test.ts` (approved-charge missing-row persistence guard)
- `tests/lib/tableBookingHoldAlignment.test.ts` (deferred card-capture hold alignment resolved-error/no-row guard)
- `tests/services/financials.service.test.ts` (financial metric pair-delete guard against cross-product over-delete)
- `tests/api/tableBookingStatusMutationGuards.test.ts` (FOH/BOH status no-op row-effect guard + no-show charge side-effect guard + FOH move-table stale-assignment guard)
- `tests/api/reconcileSmsRoute.test.ts` (reconcile-sms generic 500 payload sanitization regression)
- `tests/api/fohEventBookingsRollback.test.ts` (FOH event-booking rollback-persistence fail-closed guard)
- `tests/api/ojProjectsBillingRouteErrors.test.ts` (OJ billing cron generic 500 error-payload guard)
- `tests/api/ojProjectsRetainerProjectsRouteErrors.test.ts` (OJ retainer cron generic 500 error-payload guard)
- `tests/api/receiptsExportRouteErrors.test.ts` (receipts export generic 500 error-payload guard)
- `tests/api/parkingNotificationsMutationGuards.test.ts` (parking-notifications booking mutation row-effect helper guards)
- `tests/api/eventWaitlistOffersRouteErrors.test.ts` (event waitlist-offers cron generic 500 payload guard + post-send persistence failure fail-closed cleanup/counter path + aborts remaining sends on fatal `logging_failed` safety signals)
- `tests/api/eventBookingHoldsRouteErrors.test.ts` (event booking-holds cron generic 500 payload guard)
- `tests/api/sundayPreorderRouteErrors.test.ts` (Sunday pre-order cron generic 500 payload guard + aborts remaining sends on fatal `sendSMS` safety signals + fails closed when message dedupe lookups error)
- `tests/api/eventGuestEngagementRouteErrors.test.ts` (event guest-engagement cron generic 500 payload guard)
- `tests/api/privateBookingMonitorRouteErrors.test.ts` (private booking-monitor cron generic 500 payload guard)
- `tests/api/engagementScoringRouteErrors.test.ts` (engagement-scoring cron generic 500 payload guard)
- `tests/api/ojProjectsBillingRemindersRouteErrors.test.ts` (OJ billing-reminders cron generic send-failure payload guard)
- `tests/api/ojProjectsRetainerProjectsResultErrors.test.ts` (OJ retainer-project per-vendor failure payload sanitization guard)
- `tests/lib/waitlistOffersSmsPersistence.test.ts` (waitlist-offer send fails closed on event lookup errors/missing rows and on post-send critical persistence failures; analytics-only failures remain non-blocking)
- `tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts` (guest waitlist acceptance confirm route does not send SMS when event lookup errors or affects no rows)
- `tests/api/stripeWebhookMutationGuards.test.ts` (Stripe approved-charge webhook stale-update fail-closed guard)
- `tests/api/tableBookingSettingsRouteErrors.test.ts` (settings table-booking route generic 500 payload guards)
- `tests/lib/staffSeatUpdatesMutationGuards.test.ts` (staff seat-sync direct/linked row-effect guards)
- `tests/lib/parkingPaymentsPersistence.test.ts` (parking payment-request reminder-flag persistence now fails closed when the post-send booking update errors/affects no rows)
- `tests/api/tableBookingRouteErrorPayloads.test.ts` (FOH/BOH move-table + party-size generic 500 payload guards)
- `tests/lib/parkingCustomerResolution.test.ts` (parking customer enrichment row-effect + concurrent-insert race reconciliation guards)
- `tests/lib/smsCustomers.test.ts` (customer enrichment no-row observability guard)
- `tests/api/twilioWebhookMutationGuards.test.ts` (Twilio status-update no-row idempotent-success guard)
- `tests/lib/cronRunResults.test.ts` (cron run completion/failure persistence guard + stale-restart lock-recovery guard)
- `tests/lib/smsBulkLoopGuards.test.ts` (bulk SMS chunk/concurrency non-terminating-loop guard + recipient-cap short-circuit guard)
- `tests/actions/jobQueueActions.test.ts` (bulk queue recipient normalization + empty-input + rate-limit + recipient-cap guard)
- `tests/actions/smsActions.test.ts` (`sendBulkSMSAsync` permission/rate-limit/recipient-cap guard regressions + recipient normalization guard)
- `tests/services/business-hours.service.test.ts` (service-status update no-row guard + special-hours update no-row guard)
- `tests/services/menu.service.test.ts` (recipe/dish update no-row guard)
- `tests/services/permission.service.test.ts` (role update no-row guard)
- `tests/services/mutation-race-guards.test.ts` (vendor/customer/catalog update no-row guard expansions)
- `tests/services/short-links.service.test.ts` (short-link update no-row guard)
- `tests/actions/settingsMutationGuards.test.ts` (attachment category/customer label/API key update no-row guard regressions)
- `tests/lib/parkingRepository.test.ts` (parking booking update no-row guard)
- `tests/actions/eventImagesActions.test.ts` (event image metadata delete no-row guard)
- `tests/lib/supabaseRetry.test.ts` (retryable supabase update no-row guard)
- `tests/actions/ojProjectMutationGuards.test.ts` (OJ work-type/recurring-charge update no-row guard expansions)
- `tests/services/event-marketing.service.test.ts` (event-marketing stale-update recreate-link guard)
- `tests/lib/unifiedJobQueue.test.ts` (unified queue status-update no-row guard)
- `tests/actions/ojProjectMutationGuards.test.ts` (OJ project/entry update no-row guard expansions)
- `tests/actions/receiptsActions.test.ts` (receipt upload/delete transaction-status no-row guard expansions)
- `tests/lib/guestTokenThrottle.test.ts` (guest-token throttle DB no-row fallback guard + production fail-closed behavior when `rate_limits` persistence is unavailable)
- `tests/api/fohEventBookingsRollback.test.ts` (FOH rollback persistence guard updated for checked booking-cancel row-effects)
- `tests/lib/sms/safety.test.ts` (production fail-closed guard for missing `idempotency_keys`/`messages` safety tables)
- `tests/api/twilioWebhookMutationGuards.test.ts` (inbound customer-create duplicate-key race reconciliation guard)
- `tests/api/twilioWebhookMutationGuards.test.ts` (status-lookup DB error retriable `500` guard + inbound duplicate-SID lookup fail-closed guard)
- `tests/api/twilioWebhookMutationGuards.test.ts` (inbound STOP keyword fails closed when opt-out preference persistence errors or affects no rows, and skips inbound message insert so retries can re-attempt the opt-out write)
- `tests/lib/sms/safety.test.ts` (duplicate-key lookup/reclaim missing-table branches fail closed in production)
- `tests/api/privateBookingMonitorRouteErrors.test.ts` (private booking monitor: reminder duplicate-check lookup error skips send; aborts remaining sends on fatal `logging_failed` safety signal; fails closed when private feedback dedupe lookup errors)
- `tests/services/privateBookingsMutationGuards.test.ts` (completed-booking thank-you duplicate-check now fails closed pre-mutation on lookup errors and still skips send when duplicates already exist)
- `tests/api/sundayPreorderRouteErrors.test.ts` (Sunday send guard blocks when schema is unavailable in production)
- `tests/api/eventGuestEngagementRouteErrors.test.ts` (event engagement cron: send guard blocks when schema is unavailable in production + aborts remaining sends on fatal `logging_failed` safety signal + fails closed when reminder dedupe lookup errors)
- `tests/api/fohFoodOrderAlertRouteSafety.test.ts` (FOH food order alert surfaces `code`/`logFailure` in success payload so `logging_failed` is not silently treated as full success)
- `tests/api/parkingNotificationsRouteErrors.test.ts` (parking cron: generic 500 payload + production send-guard schema fail-closed behavior + aborts remaining sends on fatal `logging_failed` safety signal + aborts when notification logging fails after a successful send)
- `tests/lib/twilioSendGuards.test.ts` (customer eligibility lookup error/no-row fail-closed guard + blocks opted-out customers via `sms_status` or legacy `sms_opt_in=false` before transport send + blocks when provided `customerId` does not match the destination phone)
- `tests/lib/smsCustomers.test.ts` (customer resolution lookup failures now return explicit `resolutionError` and skip inserts fail-closed)
- `tests/lib/twilioSendGuards.test.ts` (`sendSMS` blocks dispatch when customer resolution preflight returns `lookup_failed`)
- `tests/lib/invoiceReminderSafety.test.ts` (invoice reminder script dedupe/log helper fail-closed behavior on lookup/insert failures + script-completion error summary guard)
- `tests/actions/smsActions.test.ts` (OTP server action fails closed on customer-resolution failure/no-customer outcomes)
- `tests/lib/manualReviewCampaignSafety.test.ts` (manual review campaign metadata stability + booking/token persistence and cleanup row-effect guards + run-completion fail-closed error summary guard)
- `tests/lib/sendFeb2026EventReviewSmsSafety.test.ts` (Feb 2026 review SMS script dual-gate send enablement + explicit cap parsing and hard-cap enforcement)
- `tests/lib/testTableBookingSmsSafety.test.ts` (table-booking SMS test script dual-gate send enablement + required booking/to targeting assertions)
- `tests/lib/testEnrollmentWithSmsSafety.test.ts` (enrollment-with-sms test script dual-gate send enablement + required customer/to targeting assertions)
- `tests/lib/duplicateCustomerCleanupSafety.test.ts` (approved-duplicate cleanup target-resolution and completion fail-closed guards)
- `tests/lib/parkingSmsSafety.test.ts` (parking SMS eligibility now fails closed on customer lookup errors/no-row outcomes)
- `tests/lib/parkingPaymentsPersistence.test.ts` (parking payment-request path skips SMS when customer preference lookup fails)
- `tests/lib/parkingSmsBackfillSafety.test.ts` (parking SMS backfill SID dedupe lookup + notification-linkage persistence fail-closed guards + mutation-run gate + missing payload/customer-field fail-closed guards)
- `tests/lib/scriptMutationSafety.test.ts` (script query fail-closed guards + expected-row-count assertions for mutation-script safety helpers)
- `tests/lib/twilioLogBackfillSafety.test.ts` (Twilio log backfill lookup fail-closed, dry-run no-create policy, duplicate-key reconciliation detection, batch row-count enforcement, and unresolved-row completion guard)
- `tests/lib/twilioLogBackfillScriptSafety.test.ts` (Twilio log backfill script defaults to dry-run and enforces explicit mutation/customer-create gating, strict caps, and safe SMS-deactivated placeholder customer payloads)
- `tests/lib/stuckJobsCleanupSafety.test.ts` (stale processing-job selection + invalid-timestamp fail-closed cleanup guard)
- `tests/lib/reminderBacklogSafety.test.ts` (reminder backlog target-id validation + past-event reminder context fail-closed guards)
- `tests/lib/reminderBacklogSafety.test.ts` (nested relation-array reminder context parsing guard for finalize-event-reminders fail-closed filtering)
- `tests/lib/fixPastRemindersScriptSafety.test.ts` (safety regression guard: fix-past-reminders mutation mode requires explicit `--confirm`, dual env gates, explicit operation selection, and strict caps)
- `tests/lib/reminderInviteMigrationSafety.test.ts` (invite-reminder migration delete-plan validation + duplicate/invalid-row fail-closed guards + completion failure assertions)
- `tests/lib/phoneCleanupSafety.test.ts` (phone-cleanup candidate validation + unresolved-failure completion guard)
- `tests/lib/cleanupPhoneNumbersScriptSafety.test.ts` (safety regression guard: cleanup-phone-numbers mutation mode requires explicit `--confirm`, dual env gates, and strict capped `--limit`)
- `tests/lib/clearStuckJobsScriptSafety.test.ts` (safety regression guard: clear-stuck-jobs mutation mode requires explicit `--confirm`, dual env gates, explicit operation selection, and strict caps)
- `tests/lib/clearReminderBacklogScriptSafety.test.ts` (safety regression guard: clear-reminder-backlog mutation mode requires explicit `--confirm`, dual env gates, explicit operation selection, and strict caps)
- `tests/lib/finalizeEventRemindersScriptSafety.test.ts` (safety regression guard: finalize-event-reminders mutation mode requires explicit `--confirm`, dual env gates, explicit operation selection, and strict capped limits)
- `tests/lib/migrateInviteRemindersScriptSafety.test.ts` (safety regression guard: migrate-invite-reminders mutation mode requires explicit `--confirm`, dual env gates, explicit operation selection, strict capped booking batches, and blocks reschedule without deletion)
- `tests/lib/eventPaymentsPersistence.test.ts` (event checkout pending-payment pre-insert lookup fail-closed guard + insert no-row/duplicate-key race persistence guards)
- `tests/lib/eventManageBookingCheckoutPersistence.test.ts` (manage-booking seat-increase checkout pre-insert lookup fail-closed guard + insert no-row/duplicate-key race persistence guards)
- `tests/lib/scriptMutationSafety.test.ts` (script completion fail-closed helper guard used by private-bookings calendar resync script)
- `tests/lib/unifiedJobQueue.test.ts` (unique enqueue dedupe lookup fail-closed guard + existing unique-job reuse guard + enqueue idempotency-lock contention guard + bulk SMS `bulkJobId` stable-dispatch preference guard + SMS completion/failure persistence fatal guards + lease refresh/heartbeat fail-closed abort guard)
- `tests/lib/unifiedJobQueue.test.ts` (send_sms job execution fails closed when `customer_id` is missing)
- `tests/lib/unifiedJobQueue.test.ts` (SMS queue processing aborts remaining send jobs on fatal safety signals like `logging_failed`/`safety_unavailable` and requeues the rest of the send batch)
- `tests/lib/fohChargeRequestSafety.test.ts` (FOH charge-request cap precheck fail-closed guards for booking lookup, missing rows, and existing-charge lookup errors)
- `tests/lib/smsCustomers.test.ts` (recipient-context resolver now fails closed on booking lookup errors/missing booking rows)
- `tests/lib/smsCustomers.test.ts` (manual send customer resolution fails closed when no existing customer is found and does not create new customers from arbitrary phone numbers)
- `tests/lib/smsCustomers.test.ts` (customerId/booking context safety: fails closed when provided `customerId` does not match destination phone, when private-booking `to` mismatches `contact_phone`, or when provided `customerId` mismatches booking `customer_id`)
- `tests/actions/smsActions.test.ts` (manual send action blocks dispatch when `messages.send` permission is missing and when recipient-context resolution reports safety failures; surfaces `code`/`logFailure` when outbound message logging fails)
- `tests/lib/oldSmsCleanupSafety.test.ts` (old SMS cleanup script guard + fail-closed query/delete/audit safety assertions)
- `tests/lib/pendingSmsCleanupSafety.test.ts` (pending-SMS cleanup script mutation guard + fail-closed count/update/audit safety assertions)
- `tests/lib/queuedMessagesCleanupSafety.test.ts` (queued-message cleanup mutation guard + fail-closed query/delete/audit row-effect assertions)
- `tests/lib/pendingSmsDeleteSafety.test.ts` (pending-SMS delete script mutation guard + fail-closed query/update/audit row-effect assertions)
- `tests/lib/smsTemplateKeyFixSafety.test.ts` (SMS template-key fix script mutation guard + fail-closed query/update/completion assertions)
- `tests/lib/completePastEventChecklistsScriptSafety.test.ts` (complete-past-event-checklists script safety: multi-gating, explicit caps, cutoff parsing)
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (database check scripts remain read-only, avoid Next.js server Supabase imports, fail closed)
- `tests/scripts/testScriptMutationGating.test.ts` (regression guard: mutation scripts require `--confirm` + `RUN_*` + `ALLOW_*` + explicit limits)
- `tests/lib/removeHistoricImportNotesScriptSafety.test.ts` (remove-historic-import-notes script safety: multi-gating, explicit caps, fail-closed assertions)
- `tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts` (delete-approved-duplicates script safety: multi-gating, explicit caps, fail-closed assertions)
- `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` (fix-superadmin-permissions script safety: multi-gating, explicit operation selection, capped bulk grants)
- `tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts` (fix-table-booking-api-permissions script safety: key-hash validation + multi-gating)
- `tests/lib/tableBookingSmsFixSafety.test.ts` (table-booking SMS diagnostics script write-probe mutation guard + fail-closed diagnostics/probe/completion assertions)
- `tests/lib/pendingPaymentFixSafety.test.ts` (pending-payment remediation script mutation guard + fail-closed booking/payment lookup and payment/booking/audit row-effect assertions)
- `tests/lib/processJobsScriptSafety.test.ts` (process-jobs script mutation-run guard + fail-closed preflight query/batch-size validation + send-job processing safety override guard)
- `tests/lib/duplicateLoyaltyProgramFixSafety.test.ts` (duplicate-loyalty-program fix script mutation-run guard + fail-closed query/count checks + migration/delete row-effect/completion assertions)
- `tests/lib/deleteAllTableBookingsSafety.test.ts` (delete-all-table-bookings script mutation-run guard + fail-closed count/query checks + delete row-effect and post-run completion assertions)
- `tests/lib/deleteTestBookingsSafety.test.ts` (delete-test-bookings script mutation-run/force guards + fail-closed query checks + delete/audit row-effect and completion assertions)
- `tests/lib/deleteSpecificCustomersSafety.test.ts` (delete-specific-customers script mutation-run guard + fail-closed target/query checks + delete/audit row-effect and completion assertions)
- `tests/lib/deletePeterPitcherBookingsSafety.test.ts` (delete-peter-pitcher-bookings script mutation-run guard + fail-closed booking query checks + delete/audit row-effect and completion assertions)
- `tests/lib/jobRetryScriptSafety.test.ts` (reset/retry jobs scripts mutation-run gating + fail-closed preflight/update row-count assertions)
- `tests/lib/processJobsScriptSafety.test.ts` and `tests/lib/jobRetryScriptSafety.test.ts` (expanded strict cap parser fail-closed coverage: malformed values such as `1abc` now reject instead of truncating in process/reset/retry jobs safety helpers)
- `tests/lib/deletePeterTestBookingsSafety.test.ts` (delete-peter-test-bookings script mutation-run gating + fail-closed query/delete/audit/completion assertions)
- `tests/lib/deleteTestCustomersDirectSafety.test.ts` (delete-test-customers-direct script mutation-run gating + fail-closed target query/delete/audit/completion assertions)
- `tests/lib/deleteInvoiceCleanupSafety.test.ts` (invoice cleanup scripts mutation-run gating + fail-closed query/delete/audit/completion assertions)
- `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/lib/deletePeterPitcherBookingsSafety.test.ts`, `tests/lib/deletePeterTestBookingsSafety.test.ts`, `tests/lib/deleteAllTableBookingsSafety.test.ts`, and `tests/scripts/testSmsCleanupScriptsSafety.test.ts` (expanded mutation cap enforcement: explicit `--limit` parsing, hard-cap assertions, and script-level cap marker checks for cleanup mutation scripts)
- `tests/scripts/testSmsCleanupScriptsSafety.test.ts` (expanded cleanup parser fail-closed coverage: `delete-old-sms-messages.ts` and `delete-all-pending-sms.ts` now require strict integer parser markers and forbid `Number.parseInt` cap truncation patterns)
- `tests/lib/deleteTestBookingsSafety.test.ts`, `tests/lib/deleteInvoiceCleanupSafety.test.ts`, `tests/scripts/testSmsCleanupScriptsSafety.test.ts`, and `tests/scripts/testScriptMutationGating.test.ts` (expanded remaining cleanup cap enforcement: `delete-specific-invoice` + `delete-test-bookings` now require explicit `--limit=1`, enforce helper-level hard caps, and preserve read-only/multi-gating fail-closed semantics)
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` (expanded deployment-status script safety coverage: confirm mode requires explicit `--limit=1`, hard-cap enforcement marker checks, required multi-gating, and fail-closed non-zero semantics)
- `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (expanded SMS diagnostics script safety for `check-sms-jobs.ts`: explicit read-only `--confirm` blocking, script-safe admin client/query helper usage, and no raw `@supabase/supabase-js` import)
- `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (expanded SMS diagnostics script safety for `check-sms-queue.ts` and `check-bulk-sms-jobs.ts`: explicit read-only `--confirm` blocking, script-safe `createAdminClient` + `assertScriptQuerySucceeded` usage, and no raw `@supabase/supabase-js` imports)
- `tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` (expanded SMS diagnostics script safety for `check-sms-issue.ts` and `check-table-booking-sms.ts`: explicit read-only `--confirm` blocking, script-safe `createAdminClient` + `assertScriptQuerySucceeded` usage, and no raw `@supabase/supabase-js` imports)
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (expanded database diagnostics script safety for `check-api-key-database.ts` and `check-performance.ts`: explicit read-only `--confirm` blocking, script-safe `createAdminClient` + `assertScriptQuerySucceeded` usage, no raw `@supabase/supabase-js` imports, and fail-closed non-zero behavior)
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (expanded `check-booking-duplicates.ts` script safety coverage to enforce script-safe admin/anon diagnostics and prohibit raw `@supabase/supabase-js` imports)
- `tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` (expanded job/message diagnostics script safety for `check-failed-jobs.ts`, `check-job-tables.ts`, and `check-jobs.ts`: explicit read-only `--confirm` blocking, bounded `--limit` hard-cap markers, script-safe `assertScriptQuerySucceeded` usage, and admin-client-only wiring)
- `tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts` (added SMS remediation script safety coverage for `clear-stuck-jobs.ts`, `clear-reminder-backlog.ts`, `fix-past-reminders.ts`, and `finalize-event-reminders.ts`: read-only/dry-run defaults, required multi-gating + explicit caps, fail-closed non-zero semantics, script-safe `createAdminClient`/`assertScriptQuerySucceeded` usage, and no raw `@supabase/supabase-js` imports)
- `tests/scripts/testScriptMutationGating.test.ts` (expanded sms-tools mutation script guard coverage to require `createAdminClient` and disallow raw `@supabase/supabase-js` imports across `backfill-twilio-log.ts`, `migrate-invite-reminders.ts`, `cleanup-phone-numbers.ts`, and related sms-tools mutation scripts)
- `tests/scripts/testScriptMutationGating.test.ts` (expanded mutation-gating coverage for `scripts/fixes/fix-superadmin-permissions.ts` to enforce read-only defaults, explicit multi-gating markers, explicit cap markers, and fail-closed non-zero semantics)
- `tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts` (expanded fix-rpc script safety coverage with explicit read-only `--confirm` guard markers plus `createAdminClient`/`assertScriptQuerySucceeded` usage and no raw `@supabase/supabase-js` imports)
- `tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` (expanded `fix-api-access-simple.ts` guard coverage to require `createAdminClient` + `assertScriptQuerySucceeded` markers and prohibit raw `@supabase/supabase-js` imports)
- `src/lib/fix-superadmin-permissions-script-safety.ts` (hardened limit/offset parsing to strict fail-closed integer validation for malformed CLI/env values)
- `tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` (expanded malformed cap rejection coverage for strict `--limit`/`--offset` parsing and env fallbacks)
- `scripts/cleanup/delete-pending-sms.ts`, `scripts/cleanup/delete-all-queued-messages.ts`, `scripts/cleanup/delete-specific-customers.ts`, and `scripts/fixes/fix-duplicate-loyalty-program.ts` (hardened mutation cap parsing to strict fail-closed integer validation with explicit malformed-value errors and separate CLI/env parsing to prevent invalid explicit-flag fallback)
- `tests/scripts/testSmsCleanupScriptsSafety.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` (expanded strict parser regression coverage for the four scripts above; enforce regex/`Number.isInteger` markers and forbid legacy `Number.parseInt` truncation pattern)
- `scripts/database/check-deployment-status.ts` (hardened confirm-mode send cap parsing to strict fail-closed integer validation and expanded argument parsing to support both `--flag value` and `--flag=value` forms)
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` and `tests/scripts/testScriptMutationGating.test.ts` (expanded deployment-status cap regression coverage to require strict parser markers and forbid legacy `Number.parseInt(limitRaw, 10)` coercion)

Validation evidence (latest run):
- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/database/check-deployment-status.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testNoHardcodedApiKeysInScripts.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testNoHardcodedApiKeysInScripts.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 18 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-pending-sms.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-all-queued-messages.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-specific-customers.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/fixes/fix-duplicate-loyalty-program.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 24 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-production-templates.ts scripts/testing/test-template-loading.ts scripts/testing/test-demographics.ts scripts/testing/test-slot-generation.ts scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts scripts/testing/test-calendar-sync.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts --reporter=dot` passed (`4 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1001 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/fix-superadmin-permissions-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/fixSuperadminPermissionsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/fixSuperadminPermissionsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (`2 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 998 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-old-sms-messages.ts /Users/peterpitcher/Cursor/anchor-management-tools/scripts/cleanup/delete-all-pending-sms.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (`1 file, 9 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Could not find a production build in '.next' directory` during export step)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOTEMPTY: .../.next/export`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 993 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts tests/scripts/testBookingApiScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts --reporter=dot` passed (`1 file, 1 test`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/process-jobs-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/src/lib/job-retry-script-safety.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/processJobsScriptSafety.test.ts /Users/peterpitcher/Cursor/anchor-management-tools/tests/lib/jobRetryScriptSafety.test.ts --reporter=dot` passed (`2 files, 16 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts --reporter=dot` passed (`2 files, 14 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-failed-jobs.ts scripts/database/check-job-tables.ts scripts/database/check-jobs.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (`1 file, 8 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` failed (`1 failed | 985 passed (986)`; failing test: `tests/api/twilioWebhookMutationGuards.test.ts > fails closed when post-status customer delivery-outcome updates cannot be applied`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 986 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/import-employee-documents.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (`1 file, 16 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 983 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/clear-cashing-up-data.ts scripts/verify-hiring-flow.ts scripts/seed-cashing-up.ts scripts/seed-cashup-targets.ts scripts/clear-2025-data.ts scripts/fix-bookings-is-reminder-only.ts scripts/setup-dev-user.ts scripts/apply-event-categorization.ts scripts/insert-golden-barrels-hours.ts scripts/rectify-golden-barrels.ts scripts/reprocess-cvs.ts scripts/trigger-invoice-reminders.ts scripts/hiring/cleanup-stuck-cvs.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts --reporter=dot` passed (`2 files, 17 tests`)
- `./node_modules/.bin/tsc --noEmit` failed (`src/lib/events/event-payments.ts:479/499/520 Type 'null' is not assignable to type 'string | undefined'`)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 976 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOTEMPTY: .../.next/export`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-booking-duplicates.ts scripts/fixes/fix-api-access-simple.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (`2 files, 9 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 977 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, open '.next/server/app/_not-found/page.js.nft.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/backfill-twilio-log.ts scripts/sms-tools/migrate-invite-reminders.ts scripts/sms-tools/cleanup-phone-numbers.ts scripts/fixes/fix-rpc-functions.ts scripts/fixes/fix-rpc-functions-direct.ts scripts/fixes/fix-api-access-simple.ts tests/scripts/testScriptMutationGating.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (`3 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 971 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-paypal-credentials.ts scripts/testing/test-microsoft-graph-email.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 969 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/clear-stuck-jobs.ts scripts/sms-tools/clear-reminder-backlog.ts scripts/sms-tools/fix-past-reminders.ts scripts/sms-tools/finalize-event-reminders.ts tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsToolsReminderCleanupScriptsSafety.test.ts --reporter=dot` passed (`1 file, 2 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 967 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/oj-projects/fix-typo.ts scripts/oj-projects/fix-entry-rates.ts scripts/oj-projects/move-all-to-retainers.ts scripts/oj-projects/move-to-website-content.ts scripts/oj-projects/update-barons-retainer.ts scripts/oj-projects/update-barons-retainer-hours.ts scripts/oj-projects/add-barons-pubs-entries.ts tests/scripts/testOjProjectsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testOjProjectsScriptsSafety.test.ts --reporter=dot` passed (1 file, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 963 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Cannot find module '.next/server/next-font-manifest.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-api-key-database.ts scripts/database/check-performance.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 963 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, open '.next/build-manifest.json'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/menu/seed-chefs-essentials-chips.js scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js scripts/menu/seed-chefs-larder-garden-peas.js scripts/menu/seed-chefs-larder-buttery-mash.js scripts/menu/seed-chefs-larder-sweet-potato-fries.js scripts/menu/seed-menu-dishes.js scripts/menu/seed-menu-dishes.ts tests/scripts/testMenuSeedScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testMenuSeedScriptsSafety.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 961 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-issue.ts scripts/database/check-table-booking-sms.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 961 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts scripts/testing/test-api-booking-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testTableBookingApiScriptsSafety.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-queue.ts scripts/database/check-bulk-sms-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)

- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testApiCompleteFixScriptSafety.test.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 955 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/setup-dev-user.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 953 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-sms-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 951 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-sms-new-customer.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (2 files, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 951 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts scripts/testing/test-sms-new-customer.ts src/lib/test-sms-new-customer-safety.ts tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/lib/testSmsNewCustomerSafety.test.ts --reporter=dot` passed (3 files, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOTEMPTY: .next`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/static/.../_ssgManifest.js`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-deployment-status.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testNoHardcodedApiKeysInScripts.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (2 files, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Type error: missing .next/types/app/(authenticated)/cashing-up/daily/page.ts`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)

- `./node_modules/.bin/eslint scripts/cleanup/delete-specific-invoice.ts scripts/cleanup/delete-test-bookings.ts src/lib/delete-test-bookings-safety.ts tests/lib/deleteTestBookingsSafety.test.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestBookingsSafety.test.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (4 files, 40 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 944 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts src/lib/test-table-booking-sms-safety.ts src/lib/test-enrollment-with-sms-safety.ts tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts tests/lib/testEnrollmentWithSmsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (3 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 941 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-test-invoices.ts scripts/cleanup/delete-peter-pitcher-bookings.ts scripts/cleanup/delete-peter-test-bookings.ts scripts/cleanup/delete-all-table-bookings.ts src/lib/delete-invoice-cleanup-safety.ts src/lib/delete-peter-pitcher-bookings-safety.ts src/lib/delete-peter-test-bookings-safety.ts src/lib/delete-all-table-bookings-safety.ts tests/lib/deleteInvoiceCleanupSafety.test.ts tests/lib/deletePeterPitcherBookingsSafety.test.ts tests/lib/deletePeterTestBookingsSafety.test.ts tests/lib/deleteAllTableBookingsSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteInvoiceCleanupSafety.test.ts tests/lib/deletePeterPitcherBookingsSafety.test.ts tests/lib/deletePeterTestBookingsSafety.test.ts tests/lib/deleteAllTableBookingsSafety.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (5 files, 43 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 938 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 929 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-private-booking-customer-creation.ts scripts/testing/test-loyalty-enrollment.ts scripts/testing/test-sms-flow.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (3 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 928 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/fixes/fix-table-booking-api-permissions.ts scripts/fixes/fix-pending-payment.ts scripts/fixes/fix-table-booking-sms.ts src/lib/fix-table-booking-api-permissions-script-safety.ts src/lib/pending-payment-fix-safety.ts src/lib/table-booking-sms-fix-safety.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/lib/pendingPaymentFixSafety.test.ts tests/lib/tableBookingSmsFixSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/lib/pendingPaymentFixSafety.test.ts tests/lib/tableBookingSmsFixSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (4 files, 35 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 923 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-demographics.ts scripts/testing/test-employee-creation.ts scripts/testing/test-analytics-function.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testEmployeeCreationScriptReadOnly.test.ts --reporter=dot` passed (3 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 917 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 914 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/fixes/fix-api-access-simple.ts scripts/fixes/fix-google-service-key.ts tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 913 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-slot-generation.ts scripts/testing/test-critical-flows.ts scripts/testing/test-short-link.ts scripts/testing/test-vip-club-redirect.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts --reporter=dot` passed (2 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 913 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/sms-tools/backfill-twilio-log.ts scripts/sms-tools/fix-past-reminders.ts scripts/sms-tools/finalize-event-reminders.ts scripts/sms-tools/migrate-invite-reminders.ts scripts/sms-tools/cleanup-phone-numbers.ts scripts/sms-tools/clear-stuck-jobs.ts scripts/sms-tools/clear-reminder-backlog.ts scripts/cleanup/delete-test-invoices.ts scripts/cleanup/delete-specific-invoice.ts scripts/cleanup/delete-peter-pitcher-bookings.ts scripts/cleanup/delete-peter-test-bookings.ts scripts/cleanup/delete-all-table-bookings.ts tests/scripts/testScriptMutationGating.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts --reporter=dot` passed (2 files, 22 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 908 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/guest/token-throttle.ts tests/lib/guestTokenThrottle.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/guestTokenThrottle.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 902 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-duplicates-detailed.ts scripts/analysis/analyze-private-bookings-customers.ts scripts/analysis/analyze-performance.ts scripts/analysis/calibrate-hiring-thresholds.ts scripts/analysis/evaluate-hiring-screening.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 901 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/app/actions/sms.ts 'src/app/api/boh/table-bookings/[id]/sms/route.ts' tests/actions/smsActions.test.ts tests/api/bohTableBookingSmsRouteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/smsActions.test.ts tests/api/bohTableBookingSmsRouteSafety.test.ts --reporter=dot` passed (2 files, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 899 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-customer-schema.ts scripts/database/check-event-categories-migration.ts scripts/database/check-migration-history.ts scripts/database/check-migration-simple.ts scripts/database/check-migrations.ts scripts/database/check-schema-admin.ts scripts/database/check-schema-env.ts scripts/database/check-supabase-clients.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts --reporter=dot` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 895 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-duplicates-detailed.ts scripts/analysis/calibrate-hiring-thresholds.ts scripts/analysis/evaluate-hiring-screening.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 895 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 892 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/bookings/route.ts tests/api/fohBookingsSundayPreorderFailSafe.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohBookingsSundayPreorderFailSafe.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 892 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/backfill/cancelled-parking.ts scripts/backfill/employee-birthdays-to-calendar.ts scripts/tools/resync-private-bookings-calendar.ts tests/scripts/testBackfillScriptsSafety.test.ts tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBackfillScriptsSafety.test.ts tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts --reporter=dot` passed (2 files, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (218 files, 890 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-attendance-dates.ts scripts/database/check-booking-discount.ts scripts/database/check-current-schema.ts scripts/database/check-customer-phone.ts scripts/database/check-customers-and-labels.ts scripts/database/check-event-images.ts scripts/database/check-pending-booking.ts scripts/database/check-recent-attendance.ts scripts/database/check-table-bookings-structure.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (218 files, 890 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/food-order-alert/route.ts tests/api/fohFoodOrderAlertRouteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohFoodOrderAlertRouteSafety.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 888 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/database/check-audit-logs.ts scripts/database/check-booking-duplicates.ts scripts/database/check-booking-errors.ts scripts/database/check-sunday-lunch-orders.ts scripts/database/check-sunday-lunch-table.ts scripts/database/check-venue-spaces.ts scripts/database/check-payment-status.ts scripts/database/check-latest-booking-details.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 887 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/analysis/analyze-messages-permissions.ts tests/scripts/testAnalysisScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAnalysisScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (217 files, 887 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/debug-candidates.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 885 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/app/actions/sms-bulk-direct.ts tests/actions/smsBulkDirectFailSafe.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/smsBulkDirectFailSafe.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 884 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/check-employee-status.ts scripts/check-golden-barrels-projects.ts scripts/check-golden-barrels-status.ts scripts/debug-schema.ts scripts/debug-outstanding.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 883 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint src/services/private-bookings.ts tests/services/privateBookingsSmsSideEffects.test.ts src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 876 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/event-bookings/route.ts src/app/api/table-bookings/route.ts tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts --reporter=dot` passed (2 files, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 878 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warning: Browserslist age)

- `./node_modules/.bin/eslint scripts/reproduce_availability.js scripts/create-placeholder-icons.js tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 874 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint "src/app/api/boh/table-bookings/[id]/sms/route.ts" tests/api/bohTableBookingSmsRouteSafety.test.ts src/app/actions/diagnose-messages.ts src/app/actions/diagnose-webhook-issues.ts tests/actions/diagnosticActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/bohTableBookingSmsRouteSafety.test.ts tests/actions/diagnosticActionsConsoleGuards.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/verify-hiring-flow.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts scripts/testing/test-api-booking-fix.ts scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts scripts/debug-booking-payment.ts scripts/debug-booking-payment-records.ts scripts/check-booking-state.ts scripts/debug-bookings.ts scripts/debug-business-hours.ts scripts/check_hours_debug.ts scripts/fetch-events-for-categorization.ts scripts/check_hours_debug.js tests/scripts/testRootDebugScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts tests/scripts/testRootDebugScriptsFailClosed.test.ts --reporter=dot` passed (3 files, 23 tests)
- `./node_modules/.bin/eslint src/lib/job-retry-script-safety.ts scripts/reset-jobs.ts scripts/retry-failed-jobs.ts scripts/process-jobs.ts tests/lib/jobRetryScriptSafety.test.ts tests/scripts/testJobProcessingScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/jobRetryScriptSafety.test.ts tests/scripts/testJobProcessingScriptsSafety.test.ts --reporter=dot` passed (2 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (215 files, 872 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 861 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/bookings/route.ts tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohBookingsWalkInOverrideCleanupGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (213 files, 860 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-messages-permissions.ts scripts/database/check-messages.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 853 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 853 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/delete-test-customers-direct-safety.ts scripts/cleanup/delete-test-customers-direct.ts scripts/cleanup/delete-test-customers.ts tests/lib/deleteTestCustomersDirectSafety.test.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestCustomersDirectSafety.test.ts tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (2 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 851 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/messagesActions.ts src/app/api/messages/unread-count/route.ts tests/actions/messagesActionsConsoleGuards.test.ts tests/api/messagesUnreadCountRouteConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/messagesActionsConsoleGuards.test.ts tests/api/messagesUnreadCountRouteConsoleGuards.test.ts --reporter=dot` passed (2 files, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 841 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/privateBookingActions.ts tests/actions/privateBookingActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/privateBookingActionsConsoleGuards.test.ts tests/actions/privateBookingActionsSmsMeta.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts tests/lib/unifiedJobQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts --reporter=dot` passed (1 file, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 836 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 834 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/seed-cashing-up.ts scripts/seed-cashup-targets.ts scripts/clear-2025-data.ts scripts/fix-bookings-is-reminder-only.ts scripts/setup-dev-user.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 832 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/trigger-invoice-reminders.ts scripts/apply-event-categorization.ts scripts/import-employee-documents.ts scripts/insert-golden-barrels-hours.ts scripts/rectify-golden-barrels.ts scripts/reprocess-cvs.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (211 files, 851 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts src/app/actions/import-messages.ts tests/actions/eventsManualBookingGuards.test.ts tests/actions/importMessagesConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts tests/actions/importMessagesConsoleGuards.test.ts --reporter=dot` passed (2 files, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (208 files, 827 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-specific-customers.ts scripts/cleanup/delete-test-bookings.ts tests/scripts/testScriptMutationGating.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 825 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/messages.ts tests/services/messages.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/messages.service.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 823 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-and-fix-sms.ts tests/scripts/testAndFixSmsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAndFixSmsScriptReadOnly.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 822 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-table-booking-sms.ts scripts/testing/test-production-templates.ts scripts/testing/test-production-template-fix.ts scripts/testing/test-template-loading.ts scripts/testing/test-template-fix.ts scripts/testing/test-deployment.ts scripts/testing/test-menu-display.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (2 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 822 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint 'src/app/api/foh/bookings/[id]/party-size/route.ts' 'src/app/api/boh/table-bookings/[id]/party-size/route.ts' tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/partySizeSeatUpdateRoutesConsoleGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/eslint tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/background-jobs.ts tests/lib/backgroundJobsQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/backgroundJobsQueue.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-enrollment-sms.ts scripts/database/check-processed-sms.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (207 files, 816 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/twilio.ts tests/lib/twilioSendLoggingFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioSendLoggingFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (206 files, 813 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/fixes/fix-table-booking-api-permissions.ts scripts/fixes/fix-table-booking-sms.ts scripts/fixes/fix-pending-payment.ts scripts/fixes/fix-duplicate-loyalty-program.ts src/lib/fix-table-booking-api-permissions-script-safety.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts tests/scripts/testScriptMutationGating.test.ts scripts/cleanup/remove-historic-import-notes.ts scripts/cleanup/delete-approved-duplicates.ts scripts/fixes/fix-superadmin-permissions.ts src/lib/remove-historic-import-notes-script-safety.ts src/lib/delete-approved-duplicates-script-safety.ts src/lib/fix-superadmin-permissions-script-safety.ts tests/lib/removeHistoricImportNotesScriptSafety.test.ts tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts tests/lib/fixSuperadminPermissionsScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptMutationGating.test.ts tests/lib/removeHistoricImportNotesScriptSafety.test.ts tests/lib/deleteApprovedDuplicatesScriptSafety.test.ts tests/lib/fixSuperadminPermissionsScriptSafety.test.ts tests/lib/fixTableBookingApiPermissionsScriptSafety.test.ts --reporter=dot` passed (5 files, 24 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (205 files, 811 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsActionsConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsActionsConsoleGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (206 files, 813 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-calendar-sync.ts scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts scripts/testing/test-sunday-lunch-menu.ts scripts/testing/dump-events-api.ts scripts/testing/check-shortlink-redirect.ts scripts/testing/test-private-booking-customer-creation.ts scripts/testing/test-loyalty-enrollment.ts scripts/testing/test-connectivity.ts scripts/testing/test-pdf-generation.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts --reporter=dot` passed (5 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (205 files, 811 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/messageActions.ts src/app/actions/job-queue.ts tests/actions/messagesAndQueueConsoleGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/messagesAndQueueConsoleGuards.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (205 files, 806 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/private-booking-enquiry/route.ts src/app/api/parking/bookings/route.ts src/app/api/external/performer-interest/route.ts tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (203 files, 795 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/safety.ts src/lib/invoice-reminder-safety.ts tests/lib/sms/safety.test.ts tests/lib/invoiceReminderSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/sms/safety.test.ts tests/lib/invoiceReminderSafety.test.ts --reporter=dot` passed (2 files, 18 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (201 files, 786 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/hiring/cleanup-stuck-cvs.ts scripts/menu/seed-chefs-essentials-chips.js scripts/menu/seed-chefs-larder-slow-cooked-lamb-shanks.js scripts/menu/seed-chefs-larder-garden-peas.js scripts/menu/seed-chefs-larder-buttery-mash.js scripts/menu/seed-chefs-larder-sweet-potato-fries.js scripts/menu/seed-menu-dishes.js scripts/menu/seed-menu-dishes.ts scripts/oj-projects/fix-typo.ts scripts/oj-projects/move-to-website-content.ts scripts/oj-projects/update-barons-retainer-hours.ts scripts/oj-projects/fix-entry-rates.ts scripts/oj-projects/add-barons-pubs-entries.ts scripts/oj-projects/update-barons-retainer.ts scripts/oj-projects/move-all-to-retainers.ts scripts/oj-projects/verify-closing-logic.ts scripts/testing/test-slot-generation.ts scripts/testing/test-analytics-function.ts scripts/testing/test-short-link.ts scripts/testing/test-vip-club-redirect.ts scripts/testing/test-paypal-credentials.ts scripts/testing/test-critical-flows.ts tests/scripts/testMenuSeedScriptsSafety.test.ts tests/scripts/testOjProjectsScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testMenuSeedScriptsSafety.test.ts tests/scripts/testOjProjectsScriptsSafety.test.ts tests/scripts/testHiringCleanupStuckCvsSafety.test.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts --reporter=dot` passed (4 files, 21 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (198 files, 771 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-private-bookings-schema.ts scripts/database/check-click-tracking.ts scripts/database/check-loyalty-program.ts scripts/database/check-migration-table-structure.ts scripts/database/complete-past-event-checklists.ts scripts/fixes/fix-sms-template-keys.ts src/lib/complete-past-event-checklists-script-safety.ts src/lib/sms-template-key-fix-safety.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptMutationGating.test.ts tests/lib/completePastEventChecklistsScriptSafety.test.ts tests/lib/smsTemplateKeyFixSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts tests/scripts/testScriptMutationGating.test.ts tests/lib/completePastEventChecklistsScriptSafety.test.ts tests/lib/smsTemplateKeyFixSafety.test.ts --reporter=dot` passed (4 files, 18 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (198 files, 771 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts src/app/api/webhooks/paypal/parking/route.ts tests/api/stripeWebhookMutationGuards.test.ts tests/api/paypalParkingWebhookFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts tests/api/paypalParkingWebhookFailClosed.test.ts --reporter=dot` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (191 files, 738 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (191 files, 738 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-event-categories-migration.ts scripts/database/check-migration-simple.ts scripts/backfill/parking-sms.ts scripts/fixes/fix-rpc-functions.ts scripts/fixes/fix-rpc-functions-direct.ts src/lib/parking-sms-backfill-safety.ts src/lib/parking-sms-backfill-script-safety.ts tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts tests/lib/parkingSmsBackfillSafety.test.ts tests/lib/parkingSmsBackfillScriptSafety.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDatabaseEventCategoriesMigrationScriptsReadOnly.test.ts tests/lib/parkingSmsBackfillSafety.test.ts tests/lib/parkingSmsBackfillScriptSafety.test.ts tests/scripts/testFixRpcFunctionsScriptsReadOnly.test.ts --reporter=dot` passed (4 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (189 files, 729 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/event-waitlist/route.ts src/app/api/event-bookings/route.ts src/app/api/table-bookings/route.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts --reporter=dot` passed (3 files, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (189 files, 732 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/private-bookings.ts src/lib/events/staff-seat-updates.ts tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/privateBookingsSmsSideEffects.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts --reporter=dot` passed (2 files, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (189 files, 729 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/public/private-booking/route.ts src/app/api/external/create-booking/route.ts tests/api/bookingCreateIdempotencyFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/bookingCreateIdempotencyFailClosed.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (185 files, 717 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (184 files, 715 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/services/sms-queue.ts src/services/private-bookings.ts tests/services/smsQueue.service.test.ts tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts tests/services/testPrivateBookingServiceFailClosedCatchHandlers.test.ts --reporter=dot` passed (2 files, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (184 files, 715 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint tests/scripts/testScriptsFailClosedCatchHandlers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testScriptsFailClosedCatchHandlers.test.ts --reporter=dot` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (183 files, 712 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/clear-cashing-up-data.ts scripts/verify-hiring-flow.ts scripts/debug-outstanding.ts tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCashingUpAndHiringScriptsSafety.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (182 files, 711 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts --reporter=dot` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (181 files, 708 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts src/app/api/event-waitlist/route.ts src/app/api/foh/event-bookings/route.ts src/app/actions/events.ts src/app/api/table-bookings/route.ts src/lib/table-bookings/bookings.ts src/lib/parking/payments.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts tests/api/tableBookingsRouteSmsMeta.test.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (7 files, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (180 files, 706 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/cleanup/delete-old-sms-messages.ts scripts/cleanup/delete-all-queued-messages.ts scripts/cleanup/delete-all-pending-sms.ts scripts/cleanup/delete-pending-sms.ts scripts/testing/test-table-booking-sms.ts scripts/testing/test-enrollment-with-sms.ts tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsCleanupScriptsSafety.test.ts tests/scripts/testSmsSendTestingScriptsFailClosed.test.ts --reporter=dot` passed (2 files, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (175 files, 698 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/foh/food-order-alert/route.ts tests/api/fohFoodOrderAlertRouteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohFoodOrderAlertRouteSafety.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (173 files, 692 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts src/app/api/cron/event-waitlist-offers/route.ts tests/api/eventWaitlistOffersRouteErrors.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventWaitlistOffersRouteErrors.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (172 files, 683 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/safety.ts tests/lib/sms/safety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/sms/safety.test.ts` passed (1 file, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (161 files, 615 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/tools/send-feb-2026-event-review-sms.ts tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (161 files, 614 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-calendar-sync.ts scripts/testing/test-calendar-sync-admin.ts scripts/testing/test-calendar-final.ts scripts/testing/test-booking-calendar-sync.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (160 files, 613 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/tools/resync-private-bookings-calendar.ts tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (159 files, 612 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-demographics.ts tests/scripts/testDemographicsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testDemographicsScriptReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (158 files, 611 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-api-complete-fix.ts scripts/database/check-deployment-status.ts scripts/database/check-api-key-database.ts tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testNoHardcodedApiKeysInScripts.test.ts` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (157 files, 610 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAuditLogScriptsReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (156 files, 608 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-api-booking-fix.ts scripts/testing/test-booking-now.ts scripts/testing/test-sunday-lunch-api.ts scripts/testing/test-sunday-lunch-payment-fix.ts tests/scripts/testTableBookingApiScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testTableBookingApiScriptsSafety.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (155 files, 607 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-booking-api.ts tests/scripts/testBookingApiScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testBookingApiScriptSafety.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (154 files, 606 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `node ./node_modules/eslint/bin/eslint.js src/lib/status-transitions.ts src/services/invoices.ts src/services/quotes.ts src/services/permission.ts src/app/actions/invoices.ts src/app/actions/quotes.ts src/app/actions/recurring-invoices.ts tests/lib/statusTransitions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/api/cron/invoice-reminders/route.ts src/app/api/invoices/[id]/pdf/route.ts src/app/api/quotes/[id]/pdf/route.ts src/app/api/invoices/export/route.ts src/app/actions/quotes.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/email.ts src/app/api/cron/invoice-reminders/route.ts src/app/api/invoices/[id]/pdf/route.ts src/app/api/quotes/[id]/pdf/route.ts src/app/api/invoices/export/route.ts src/app/actions/quotes.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/(authenticated)/dashboard/dashboard-data.ts' src/app/actions/email.ts src/app/actions/invoices.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/(authenticated)/dashboard/dashboard-data.ts' src/app/actions/email.ts src/app/actions/invoices.ts src/app/actions/sms-bulk-direct.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/invoices.ts src/services/invoices.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/employees.ts src/app/actions/employeeActions.ts tests/services/employees.service.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/receipts.ts tests/actions/receiptsActions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/event-images.ts tests/actions/eventImagesActions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/business-hours.ts tests/services/business-hours.service.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/menu.ts tests/services/menu.service.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/permission.ts tests/services/permission.service.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/diagnose-webhook-issues.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/employeeActions.ts tests/actions/employeeActions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/api/cashup/weekly/print/route.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/vendors.ts src/services/event-categories.ts src/services/short-links.ts src/services/customers.ts tests/services/mutation-race-guards.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/attachmentCategories.ts src/app/actions/customer-labels.ts src/app/actions/vendor-contacts.ts src/app/actions/messageTemplates.ts tests/actions/adminActionMutationGuards.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/oj-projects/project-contacts.ts src/app/actions/oj-projects/work-types.ts src/app/actions/oj-projects/recurring-charges.ts src/app/actions/oj-projects/projects.ts src/app/actions/oj-projects/entries.ts tests/actions/ojProjectMutationGuards.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/event-images.ts src/app/actions/parking.ts tests/actions/eventImagesActions.test.ts tests/actions/parkingActions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/performer-submissions.ts src/app/actions/profile.ts tests/actions/performerSubmissionsActions.test.ts tests/actions/profileActions.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/private-bookings.ts src/services/sms-queue.ts src/services/events.ts src/services/invoices.ts src/services/cashing-up.service.ts src/app/actions/events.ts tests/services/privateBookingsMutationGuards.test.ts tests/services/smsQueue.service.test.ts tests/services/mutation-race-guards.test.ts tests/services/cashing-up.service.test.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/api/webhooks/twilio/route.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/events.ts src/app/actions/fix-phone-numbers.ts src/services/business-hours.ts src/app/actions/messagesActions.ts src/app/api/external/create-booking/route.ts src/app/api/cron/cleanup-rate-limits/route.ts src/app/api/cron/apply-customer-labels/route.ts tests/actions/fixPhoneNumbersActions.test.ts tests/actions/messagesMutationGuards.test.ts tests/services/business-hours.service.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/services/employees.ts src/services/business-hours.ts src/lib/background-jobs.ts src/app/api/private-bookings/contract/route.ts tests/services/employees.service.test.ts tests/services/business-hours.service.test.ts tests/lib/backgroundJobsQueue.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/lib/table-bookings/charge-approvals.ts src/app/api/cron/event-guest-engagement/route.ts src/app/api/cron/recurring-invoices/route.ts tests/lib/chargeApprovals.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/api/webhooks/twilio/route.ts src/app/api/cron/oj-projects-billing/route.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/receipts.ts src/app/api/webhooks/twilio/route.ts src/app/api/cron/oj-projects-billing/route.ts` passed
- `node ./node_modules/eslint/bin/eslint.js src/lib/table-bookings/bookings.ts src/app/api/cron/event-guest-engagement/route.ts tests/lib/tableBookingHoldAlignment.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/boh/table-bookings/[id]/status/route.ts' 'src/app/api/foh/bookings/[id]/seated/route.ts' 'src/app/api/foh/bookings/[id]/left/route.ts' 'src/app/api/foh/bookings/[id]/cancel/route.ts' 'src/app/api/foh/bookings/[id]/no-show/route.ts' 'src/app/api/cron/reconcile-sms/route.ts' 'src/app/api/webhooks/paypal/parking/route.ts' tests/api/tableBookingStatusMutationGuards.test.ts tests/api/reconcileSmsRoute.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/foh/bookings/[id]/move-table/route.ts' 'src/app/api/boh/table-bookings/[id]/move-table/route.ts' tests/api/tableBookingStatusMutationGuards.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/foh/event-bookings/route.ts' tests/api/fohEventBookingsRollback.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/oj-projects-billing/route.ts' tests/api/ojProjectsBillingRouteErrors.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/oj-projects-retainer-projects/route.ts' tests/api/ojProjectsRetainerProjectsRouteErrors.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/receipts/export/route.ts' tests/api/receiptsExportRouteErrors.test.ts` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/event-waitlist-offers/route.ts' 'src/app/api/cron/event-booking-holds/route.ts' 'src/app/api/cron/sunday-preorder/route.ts' 'src/app/api/cron/event-guest-engagement/route.ts' 'src/app/api/cron/private-booking-monitor/route.ts' 'tests/api/eventWaitlistOffersRouteErrors.test.ts' 'tests/api/eventBookingHoldsRouteErrors.test.ts' 'tests/api/sundayPreorderRouteErrors.test.ts' 'tests/api/eventGuestEngagementRouteErrors.test.ts' 'tests/api/privateBookingMonitorRouteErrors.test.ts'` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/lib/parking/booking-updates.ts' 'src/app/api/cron/parking-notifications/route.ts' 'tests/api/parkingNotificationsMutationGuards.test.ts' 'src/app/api/cron/event-waitlist-offers/route.ts' 'src/app/api/cron/event-booking-holds/route.ts' 'src/app/api/cron/sunday-preorder/route.ts' 'src/app/api/cron/event-guest-engagement/route.ts' 'src/app/api/cron/private-booking-monitor/route.ts' 'tests/api/eventWaitlistOffersRouteErrors.test.ts' 'tests/api/eventBookingHoldsRouteErrors.test.ts' 'tests/api/sundayPreorderRouteErrors.test.ts' 'tests/api/eventGuestEngagementRouteErrors.test.ts' 'tests/api/privateBookingMonitorRouteErrors.test.ts'` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/engagement-scoring/route.ts' 'src/app/api/cron/oj-projects-billing-reminders/route.ts' 'src/app/api/cron/oj-projects-retainer-projects/route.ts' 'tests/api/engagementScoringRouteErrors.test.ts' 'tests/api/ojProjectsBillingRemindersRouteErrors.test.ts' 'tests/api/ojProjectsRetainerProjectsResultErrors.test.ts'` passed
- `node ./node_modules/eslint/bin/eslint.js 'src/lib/events/waitlist-offers.ts' 'src/app/api/stripe/webhook/route.ts' 'src/app/api/foh/bookings/route.ts' 'src/app/api/settings/table-bookings/space-area-links/route.ts' 'src/app/api/settings/table-bookings/tables/route.ts' 'tests/lib/waitlistOffersSmsPersistence.test.ts' 'tests/api/stripeWebhookMutationGuards.test.ts' 'tests/api/tableBookingSettingsRouteErrors.test.ts'` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true node ./node_modules/vitest/vitest.mjs run` passed (39 files, 138 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (46 files, 150 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/ojProjectMutationGuards.test.ts tests/actions/eventImagesActions.test.ts tests/actions/parkingActions.test.ts tests/actions/performerSubmissionsActions.test.ts tests/actions/profileActions.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/services/privateBookingsMutationGuards.test.ts tests/services/smsQueue.service.test.ts tests/services/mutation-race-guards.test.ts tests/services/cashing-up.service.test.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/fixPhoneNumbersActions.test.ts tests/actions/messagesMutationGuards.test.ts tests/services/business-hours.service.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (57 files, 190 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/services/employees.service.test.ts` passed (4 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/receiptsActions.test.ts` passed (2 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/eventImagesActions.test.ts` passed (3 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/services/business-hours.service.test.ts` passed (4 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/services/menu.service.test.ts` passed (3 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/services/permission.service.test.ts` passed (1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/employeeActions.test.ts` passed (1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/services/mutation-race-guards.test.ts` passed (7 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/adminActionMutationGuards.test.ts` passed (3 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/services/employees.service.test.ts tests/services/business-hours.service.test.ts tests/lib/backgroundJobsQueue.test.ts` passed (10 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (58 files, 195 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/lib/chargeApprovals.test.ts` passed (1 test)
- `node ./node_modules/vitest/vitest.mjs run` passed (59 files, 196 tests)
- `node ./node_modules/next/dist/bin/next build` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (59 files, 196 tests)
- `node ./node_modules/next/dist/bin/next build` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (59 files, 196 tests)
- `node ./node_modules/next/dist/bin/next build` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/tableBookingHoldAlignment.test.ts` passed (2 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (60 files, 198 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/api/tableBookingStatusMutationGuards.test.ts tests/api/reconcileSmsRoute.test.ts` passed (2 files, 4 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/api/tableBookingStatusMutationGuards.test.ts` passed (1 file, 4 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/api/fohEventBookingsRollback.test.ts` passed (1 file, 1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/api/ojProjectsBillingRouteErrors.test.ts` passed (1 file, 1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/api/ojProjectsRetainerProjectsRouteErrors.test.ts` passed (1 file, 1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/api/receiptsExportRouteErrors.test.ts` passed (1 file, 1 test)
- `node ./node_modules/vitest/vitest.mjs run tests/api/eventWaitlistOffersRouteErrors.test.ts tests/api/eventBookingHoldsRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/privateBookingMonitorRouteErrors.test.ts` passed (5 files, 5 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/api/parkingNotificationsMutationGuards.test.ts tests/api/eventWaitlistOffersRouteErrors.test.ts tests/api/eventBookingHoldsRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/privateBookingMonitorRouteErrors.test.ts` passed (6 files, 8 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/api/engagementScoringRouteErrors.test.ts tests/api/ojProjectsBillingRemindersRouteErrors.test.ts tests/api/ojProjectsRetainerProjectsResultErrors.test.ts` passed (3 files, 3 tests)
- `node ./node_modules/vitest/vitest.mjs run tests/lib/waitlistOffersSmsPersistence.test.ts tests/api/stripeWebhookMutationGuards.test.ts tests/api/tableBookingSettingsRouteErrors.test.ts` passed (3 files, 5 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (63 files, 204 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (63 files, 205 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (64 files, 206 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (65 files, 207 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (66 files, 208 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (67 files, 209 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (73 files, 217 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (76 files, 220 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (79 files, 225 tests)
- `node ./node_modules/next/dist/bin/next build` passed
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/lib/events/staff-seat-updates.ts src/lib/parking/payments.ts 'src/app/api/foh/bookings/[id]/move-table/route.ts' 'src/app/api/boh/table-bookings/[id]/move-table/route.ts' 'src/app/api/foh/bookings/[id]/party-size/route.ts' 'src/app/api/boh/table-bookings/[id]/party-size/route.ts' src/app/api/settings/table-bookings/tables/route.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/api/tableBookingRouteErrorPayloads.test.ts tests/api/tableBookingSettingsRouteErrors.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/api/tableBookingRouteErrorPayloads.test.ts tests/api/tableBookingSettingsRouteErrors.test.ts` passed (4 files, 10 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (82 files, 234 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/lib/parking/customers.ts tests/lib/parkingCustomerResolution.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/parkingCustomerResolution.test.ts` passed (1 file, 2 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (83 files, 236 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/lib/sms/customers.ts tests/lib/smsCustomers.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/smsCustomers.test.ts` passed (1 file, 4 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (83 files, 237 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/app/api/webhooks/twilio/route.ts tests/api/twilioWebhookMutationGuards.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/api/twilioWebhookMutationGuards.test.ts` passed (1 file, 1 test)
- `node ./node_modules/eslint/bin/eslint.js src/lib/cron-run-results.ts src/app/api/cron/private-booking-monitor/route.ts src/app/api/cron/parking-notifications/route.ts src/app/api/cron/event-guest-engagement/route.ts src/app/api/cron/sunday-preorder/route.ts tests/lib/cronRunResults.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/cronRunResults.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts tests/api/privateBookingMonitorRouteErrors.test.ts tests/api/parkingNotificationsMutationGuards.test.ts` passed (5 files, 9 tests)
- `node ./node_modules/eslint/bin/eslint.js src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/smsBulkLoopGuards.test.ts` passed (1 file, 1 test)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/job-queue.ts tests/actions/jobQueueActions.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/jobQueueActions.test.ts` passed (1 file, 2 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed
- `node ./node_modules/vitest/vitest.mjs run` passed (89 files, 246 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/job-queue.ts tests/actions/jobQueueActions.test.ts` passed (rate-limit guard update)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/jobQueueActions.test.ts` passed (1 file, 3 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (89 files, 247 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post queue rate-limit guard)
- `node ./node_modules/eslint/bin/eslint.js src/lib/cron-run-results.ts src/app/api/cron/event-guest-engagement/route.ts src/app/api/cron/parking-notifications/route.ts src/app/api/cron/private-booking-monitor/route.ts src/app/api/cron/sunday-preorder/route.ts tests/lib/cronRunResults.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/cronRunResults.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/privateBookingMonitorRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts tests/api/parkingNotificationsMutationGuards.test.ts` passed (5 files, 12 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (89 files, 250 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post cron lock-recovery guard)
- `node ./node_modules/eslint/bin/eslint.js src/lib/sms/bulk-dispatch-key.ts src/lib/sms/bulk.ts src/app/actions/job-queue.ts src/app/actions/sms-bulk-direct.ts tests/actions/jobQueueActions.test.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/bulkDispatchKey.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/jobQueueActions.test.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/bulkDispatchKey.test.ts` passed (3 files, 10 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (89 files, 253 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post bulk recipient-cap guard)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/sms.ts tests/actions/smsActions.test.ts src/lib/sms/bulk-dispatch-key.ts src/lib/sms/bulk.ts src/app/actions/job-queue.ts src/app/actions/sms-bulk-direct.ts tests/actions/jobQueueActions.test.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/bulkDispatchKey.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/smsActions.test.ts tests/actions/jobQueueActions.test.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/bulkDispatchKey.test.ts` passed (4 files, 14 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (90 files, 257 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post bulk async guard hardening)
- `node ./node_modules/eslint/bin/eslint.js src/services/vendors.ts src/services/permission.ts src/services/business-hours.ts src/services/short-links.ts src/services/menu.ts src/services/invoices.ts src/services/customers.ts src/lib/parking/repository.ts src/app/actions/attachmentCategories.ts src/app/actions/customer-labels.ts 'src/app/(authenticated)/settings/api-keys/actions.ts' tests/services/mutation-race-guards.test.ts tests/services/permission.service.test.ts tests/services/business-hours.service.test.ts tests/services/short-links.service.test.ts tests/services/menu.service.test.ts tests/actions/settingsMutationGuards.test.ts tests/lib/parkingRepository.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/services/mutation-race-guards.test.ts tests/services/business-hours.service.test.ts tests/services/short-links.service.test.ts tests/services/menu.service.test.ts tests/services/permission.service.test.ts tests/actions/settingsMutationGuards.test.ts tests/lib/parkingRepository.test.ts` passed (7 files, 36 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (92 files, 276 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/event-images.ts src/lib/supabase-retry.ts tests/actions/eventImagesActions.test.ts tests/lib/supabaseRetry.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/eventImagesActions.test.ts tests/lib/supabaseRetry.test.ts` passed (2 files, 5 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (93 files, 278 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/oj-projects/work-types.ts src/app/actions/oj-projects/recurring-charges.ts tests/actions/ojProjectMutationGuards.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/ojProjectMutationGuards.test.ts` passed (1 file, 8 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (93 files, 280 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/receipts.ts tests/actions/receiptsActions.test.ts src/services/event-marketing.ts tests/services/event-marketing.service.test.ts src/app/actions/oj-projects/work-types.ts src/app/actions/oj-projects/recurring-charges.ts tests/actions/ojProjectMutationGuards.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/actions/receiptsActions.test.ts tests/services/event-marketing.service.test.ts tests/actions/ojProjectMutationGuards.test.ts` passed (3 files, 15 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (94 files, 285 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js src/lib/unified-job-queue.ts tests/lib/unifiedJobQueue.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/unifiedJobQueue.test.ts` passed (1 file, 2 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (95 files, 287 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run tests/actions/ojProjectMutationGuards.test.ts tests/actions/receiptsActions.test.ts` passed (2 files, 18 tests)
- `node ./node_modules/eslint/bin/eslint.js src/app/actions/oj-projects/entries.ts src/app/actions/oj-projects/projects.ts src/app/actions/receipts.ts src/lib/api/auth.ts src/lib/unified-job-queue.ts src/app/actions/quotes.ts src/services/private-bookings.ts tests/actions/ojProjectMutationGuards.test.ts tests/actions/receiptsActions.test.ts tests/lib/unifiedJobQueue.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/lib/guestTokenThrottle.test.ts` passed (1 file, 1 test)
- `node ./node_modules/eslint/bin/eslint.js src/lib/guest/token-throttle.ts tests/lib/guestTokenThrottle.test.ts src/app/api/cron/recurring-invoices/route.ts` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 292 tests)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/foh/bookings/route.ts' 'src/app/api/foh/event-bookings/route.ts' tests/api/fohEventBookingsRollback.test.ts` passed
- `node ./node_modules/vitest/vitest.mjs run tests/api/fohEventBookingsRollback.test.ts` passed (1 file, 1 test)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 292 tests; latest)
- `node ./node_modules/next/dist/bin/next build` passed (latest)
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/oj-projects-billing/route.ts'` passed
- `node ./node_modules/vitest/vitest.mjs run tests/api/ojProjectsBillingRouteErrors.test.ts tests/api/ojProjectsBillingRemindersRouteErrors.test.ts tests/api/ojProjectsRetainerProjectsResultErrors.test.ts` passed (3 files, 3 tests)
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 292 tests; latest, post OJ billing run-state guard)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post OJ billing run-state guard)
- `node ./node_modules/eslint/bin/eslint.js 'src/app/api/cron/oj-projects-billing/route.ts' 'src/lib/receipts/ai-classification.ts'` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 292 tests; latest, post OJ split/receipt AI row-effect guards)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post OJ split/receipt AI row-effect guards)
- `node ./node_modules/eslint/bin/eslint.js src/lib/sms/safety.ts tests/lib/sms/safety.test.ts src/app/api/cron/oj-projects-billing/route.ts` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run tests/lib/sms/safety.test.ts tests/api/ojProjectsBillingRouteErrors.test.ts tests/api/ojProjectsBillingRemindersRouteErrors.test.ts` passed (3 files, 10 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 294 tests; latest, post SMS fail-closed + OJ lock-count guards)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post SMS fail-closed + OJ lock-count guards)
- `node ./node_modules/eslint/bin/eslint.js src/app/api/cron/oj-projects-billing/route.ts` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run tests/api/ojProjectsBillingRouteErrors.test.ts tests/api/ojProjectsBillingRemindersRouteErrors.test.ts` passed (2 files, 2 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 294 tests; latest, post OJ selected-row transition guards)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post OJ selected-row transition guards)
- `node ./node_modules/eslint/bin/eslint.js src/app/api/webhooks/twilio/route.ts tests/api/twilioWebhookMutationGuards.test.ts` passed
- `node ./node_modules/typescript/bin/tsc --noEmit` passed (latest)
- `node ./node_modules/vitest/vitest.mjs run tests/api/twilioWebhookMutationGuards.test.ts` passed (1 file, 2 tests)
- `node ./node_modules/vitest/vitest.mjs run` passed (96 files, 295 tests; latest, post Twilio inbound race fix)
- `node ./node_modules/next/dist/bin/next build` passed (latest, post Twilio inbound race fix)
- `./node_modules/.bin/eslint src/lib/sms/safety.ts tests/lib/sms/safety.test.ts src/app/api/cron/private-booking-monitor/route.ts tests/api/privateBookingMonitorRouteErrors.test.ts src/services/private-bookings.ts tests/services/privateBookingsMutationGuards.test.ts src/app/api/cron/parking-notifications/route.ts src/app/api/cron/event-guest-engagement/route.ts src/app/api/cron/sunday-preorder/route.ts tests/api/parkingNotificationsRouteErrors.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/sms/safety.test.ts tests/api/privateBookingMonitorRouteErrors.test.ts tests/services/privateBookingsMutationGuards.test.ts tests/api/parkingNotificationsRouteErrors.test.ts tests/api/eventGuestEngagementRouteErrors.test.ts tests/api/sundayPreorderRouteErrors.test.ts` passed (6 files, 33 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (98 files, 304 tests; latest)
- `./node_modules/.bin/next build` passed (latest)
- `./node_modules/.bin/eslint src/app/api/webhooks/twilio/route.ts src/lib/twilio.ts tests/api/twilioWebhookMutationGuards.test.ts tests/lib/twilioSendGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/twilioWebhookMutationGuards.test.ts tests/lib/twilioSendGuards.test.ts` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (99 files, 309 tests; latest)
- `./node_modules/.bin/next build` passed (latest)
- `./node_modules/.bin/eslint src/lib/sms/customers.ts src/lib/twilio.ts src/lib/invoice-reminder-safety.ts src/lib/manual-review-campaign-safety.ts src/app/actions/sms.ts scripts/trigger-invoice-reminders.ts scripts/tools/send-feb-2026-event-review-sms.ts tests/lib/smsCustomers.test.ts tests/lib/twilioSendGuards.test.ts tests/lib/invoiceReminderSafety.test.ts tests/actions/smsActions.test.ts tests/lib/manualReviewCampaignSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsCustomers.test.ts tests/lib/twilioSendGuards.test.ts tests/lib/invoiceReminderSafety.test.ts tests/actions/smsActions.test.ts tests/lib/manualReviewCampaignSafety.test.ts` passed (5 files, 23 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (101 files, 321 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/parking/sms-safety.ts src/lib/parking/payments.ts src/lib/parking-sms-backfill-safety.ts scripts/backfill/parking-sms.ts tests/lib/parkingSmsSafety.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/lib/parkingSmsBackfillSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/parkingSmsSafety.test.ts tests/lib/parkingPaymentsPersistence.test.ts tests/lib/parkingSmsBackfillSafety.test.ts` passed (3 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (103 files, 332 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/script-mutation-safety.ts scripts/backfill/cancelled-parking.ts scripts/fix-bookings-is-reminder-only.ts tests/lib/scriptMutationSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/scriptMutationSafety.test.ts` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (104 files, 342 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/twilio-log-backfill-safety.ts scripts/sms-tools/backfill-twilio-log.ts tests/lib/twilioLogBackfillSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioLogBackfillSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (105 files, 348 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/services/private-bookings.ts src/services/sms-queue.ts tests/services/privateBookingsMutationGuards.test.ts tests/services/smsQueue.service.test.ts src/lib/invoice-reminder-safety.ts scripts/trigger-invoice-reminders.ts tests/lib/invoiceReminderSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/privateBookingsMutationGuards.test.ts tests/services/smsQueue.service.test.ts tests/lib/invoiceReminderSafety.test.ts` passed (3 files, 24 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (105 files, 353 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/parking-sms-backfill-safety.ts scripts/backfill/parking-sms.ts tests/lib/parkingSmsBackfillSafety.test.ts src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/parkingSmsBackfillSafety.test.ts tests/services/smsQueue.service.test.ts` passed (2 files, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (105 files, 356 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/manual-review-campaign-safety.ts scripts/tools/send-feb-2026-event-review-sms.ts tests/lib/manualReviewCampaignSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/manualReviewCampaignSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (105 files, 358 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/duplicate-customer-cleanup-safety.ts scripts/cleanup/delete-approved-duplicates.ts tests/lib/duplicateCustomerCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/duplicateCustomerCleanupSafety.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (106 files, 362 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/stuck-jobs-cleanup-safety.ts scripts/sms-tools/clear-stuck-jobs.ts tests/lib/stuckJobsCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/stuckJobsCleanupSafety.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (107 files, 366 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/reminder-backlog-safety.ts scripts/sms-tools/clear-reminder-backlog.ts scripts/sms-tools/fix-past-reminders.ts tests/lib/reminderBacklogSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/reminderBacklogSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (108 files, 372 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/reminder-backlog-safety.ts src/lib/reminder-invite-migration-safety.ts scripts/sms-tools/finalize-event-reminders.ts scripts/sms-tools/migrate-invite-reminders.ts tests/lib/reminderBacklogSafety.test.ts tests/lib/reminderInviteMigrationSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/reminderBacklogSafety.test.ts tests/lib/reminderInviteMigrationSafety.test.ts` passed (2 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (109 files, 378 tests; latest)
- `./node_modules/.bin/next build` first run failed (transient `PageNotFoundError` for `/employees/new` and `/employees` during page-data collection), immediate rerun passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/twilio-log-backfill-safety.ts scripts/sms-tools/backfill-twilio-log.ts tests/lib/twilioLogBackfillSafety.test.ts src/lib/parking-sms-backfill-safety.ts scripts/backfill/parking-sms.ts tests/lib/parkingSmsBackfillSafety.test.ts src/lib/phone-cleanup-safety.ts scripts/sms-tools/cleanup-phone-numbers.ts tests/lib/phoneCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioLogBackfillSafety.test.ts tests/lib/parkingSmsBackfillSafety.test.ts tests/lib/phoneCleanupSafety.test.ts` passed (3 files, 19 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (110 files, 385 tests; latest)
- `./node_modules/.bin/next build` first run failed (`PageNotFoundError` for `/employees/birthdays`, `/employees/new`, `/employees`); `/bin/rm -rf .next && ./node_modules/.bin/next build` rerun passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts tests/api/eventWaitlistOffersRouteErrors.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts tests/api/eventWaitlistOffersRouteErrors.test.ts` passed (2 files, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (110 files, 387 tests; latest)
- `./node_modules/.bin/next build` failed (unrelated compile error: `/src/app/(authenticated)/settings/calendar-notes/page.tsx` cannot find module `./CalendarNotesManager`)
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentsPersistence.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (111 files, 391 tests; latest)
- `./node_modules/.bin/next build` passed (latest, post event checkout persistence guard)
- `./node_modules/.bin/eslint src/lib/events/manage-booking.ts tests/lib/eventManageBookingCheckoutPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventManageBookingCheckoutPersistence.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (112 files, 395 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/script-mutation-safety.ts scripts/tools/resync-private-bookings-calendar.ts tests/lib/scriptMutationSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/scriptMutationSafety.test.ts` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (112 files, 397 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts tests/lib/unifiedJobQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (112 files, 399 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/foh/bookings.ts tests/lib/fohChargeRequestSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/fohChargeRequestSafety.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (113 files, 402 tests; latest)
- `./node_modules/.bin/next build` first run failed (transient `.next` ENOENT for `/_not-found/page.js.nft.json` during trace collection), second run failed (transient `PageNotFoundError` for `/_document`), `/bin/rm -rf .next && ./node_modules/.bin/next build` rerun passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/sms/customers.ts src/app/actions/sms.ts tests/lib/smsCustomers.test.ts tests/actions/smsActions.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsCustomers.test.ts tests/actions/smsActions.test.ts` passed (2 files, 16 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (113 files, 406 tests; latest)
- `./node_modules/.bin/next build` failed (unrelated existing type error in `/src/app/(authenticated)/settings/calendar-notes/CalendarNotesManager.tsx`: `start_time` property is not in `CalendarNoteFormState`)
- `./node_modules/.bin/eslint src/lib/old-sms-cleanup-safety.ts scripts/cleanup/delete-old-sms-messages.ts tests/lib/oldSmsCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/oldSmsCleanupSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (114 files, 412 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/pending-sms-cleanup-safety.ts scripts/cleanup/delete-all-pending-sms.ts tests/lib/pendingSmsCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/pendingSmsCleanupSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (115 files, 418 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/queued-messages-cleanup-safety.ts scripts/cleanup/delete-all-queued-messages.ts tests/lib/queuedMessagesCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/queuedMessagesCleanupSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (116 files, 424 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/pending-sms-delete-safety.ts scripts/cleanup/delete-pending-sms.ts tests/lib/pendingSmsDeleteSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/pendingSmsDeleteSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (117 files, 430 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/sms-template-key-fix-safety.ts scripts/fixes/fix-sms-template-keys.ts tests/lib/smsTemplateKeyFixSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsTemplateKeyFixSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (118 files, 436 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/table-booking-sms-fix-safety.ts scripts/fixes/fix-table-booking-sms.ts tests/lib/tableBookingSmsFixSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingSmsFixSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/eslint src/lib/pending-payment-fix-safety.ts scripts/fixes/fix-pending-payment.ts tests/lib/pendingPaymentFixSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/pendingPaymentFixSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (120 files, 448 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/process-jobs-script-safety.ts scripts/process-jobs.ts tests/lib/processJobsScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/processJobsScriptSafety.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (121 files, 455 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/duplicate-loyalty-program-fix-safety.ts scripts/fixes/fix-duplicate-loyalty-program.ts tests/lib/duplicateLoyaltyProgramFixSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/duplicateLoyaltyProgramFixSafety.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (122 files, 462 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-all-table-bookings-safety.ts scripts/cleanup/delete-all-table-bookings.ts tests/lib/deleteAllTableBookingsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteAllTableBookingsSafety.test.ts` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (123 files, 470 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-test-bookings-safety.ts scripts/cleanup/delete-test-bookings.ts tests/lib/deleteTestBookingsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestBookingsSafety.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (124 files, 477 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-specific-customers-safety.ts scripts/cleanup/delete-specific-customers.ts tests/lib/deleteSpecificCustomersSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteSpecificCustomersSafety.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (125 files, 484 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-peter-pitcher-bookings-safety.ts scripts/cleanup/delete-peter-pitcher-bookings.ts tests/lib/deletePeterPitcherBookingsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deletePeterPitcherBookingsSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (126 files, 490 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/job-retry-script-safety.ts scripts/reset-jobs.ts scripts/retry-failed-jobs.ts tests/lib/jobRetryScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/jobRetryScriptSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (127 files, 496 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-peter-test-bookings-safety.ts scripts/cleanup/delete-peter-test-bookings.ts tests/lib/deletePeterTestBookingsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deletePeterTestBookingsSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (128 files, 502 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-test-customers-direct-safety.ts scripts/cleanup/delete-test-customers-direct.ts tests/lib/deleteTestCustomersDirectSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteTestCustomersDirectSafety.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (129 files, 509 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/delete-invoice-cleanup-safety.ts scripts/cleanup/delete-test-invoices.ts scripts/cleanup/delete-specific-invoice.ts tests/lib/deleteInvoiceCleanupSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/deleteInvoiceCleanupSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (130 files, 515 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/api/auth.ts tests/lib/apiAuthRateLimit.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/apiAuthRateLimit.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (131 files, 518 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts src/lib/test-sms-new-customer-safety.ts tests/lib/testSmsNewCustomerSafety.test.ts scripts/testing/test-sms-new-customer.ts scripts/testing/test-and-fix-sms.ts tests/scripts/testAndFixSmsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts tests/lib/testSmsNewCustomerSafety.test.ts tests/scripts/testAndFixSmsScriptReadOnly.test.ts` passed (3 files, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (133 files, 525 tests; latest)
- `./node_modules/.bin/next build` passed (latest, Browserslist age warning only)
- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts tests/lib/unifiedJobQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (133 files, 528 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/send-feb-2026-event-review-sms-safety.ts scripts/tools/send-feb-2026-event-review-sms.ts tests/lib/sendFeb2026EventReviewSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/sendFeb2026EventReviewSmsSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (134 files, 534 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/parking/payments.ts tests/lib/parkingPaymentsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/parkingPaymentsPersistence.test.ts` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (134 files, 535 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/test-table-booking-sms-safety.ts scripts/testing/test-table-booking-sms.ts tests/lib/testTableBookingSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testTableBookingSmsSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (135 files, 541 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/test-enrollment-with-sms-safety.ts scripts/testing/test-enrollment-with-sms.ts tests/lib/testEnrollmentWithSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/testEnrollmentWithSmsSafety.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (136 files, 547 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-loyalty-enrollment.ts tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (137 files, 550 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/app/actions/sms.ts tests/actions/smsActions.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/smsActions.test.ts` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (137 files, 551 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts scripts/testing/test-private-booking-customer-creation.ts scripts/testing/test-critical-flows.ts tests/lib/unifiedJobQueue.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts tests/scripts/testCriticalFlowsScriptReadOnly.test.ts` passed (3 files, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (139 files, 559 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/app/actions/import-messages.ts 'src/app/(authenticated)/settings/import-messages/ImportMessagesClient.tsx' src/scripts/import-missed-messages.ts tests/actions/importMessagesActions.test.ts tests/scripts/importMissedMessagesLegacyScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/importMessagesActions.test.ts tests/scripts/importMissedMessagesLegacyScriptReadOnly.test.ts` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (141 files, 563 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/services/customers.ts tests/services/mutation-race-guards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/mutation-race-guards.test.ts` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed (latest)
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (141 files, 565 tests; latest)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (latest; warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (161 files, 617 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/fix-past-reminders-script-safety.ts scripts/sms-tools/fix-past-reminders.ts tests/lib/fixPastRemindersScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/fixPastRemindersScriptSafety.test.ts` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (162 files, 625 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (162 files, 627 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/cleanup-phone-numbers-script-safety.ts scripts/sms-tools/cleanup-phone-numbers.ts tests/lib/cleanupPhoneNumbersScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/cleanupPhoneNumbersScriptSafety.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (163 files, 632 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/clear-stuck-jobs-script-safety.ts scripts/sms-tools/clear-stuck-jobs.ts tests/lib/clearStuckJobsScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/clearStuckJobsScriptSafety.test.ts` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (164 files, 640 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/clear-reminder-backlog-script-safety.ts scripts/sms-tools/clear-reminder-backlog.ts tests/lib/clearReminderBacklogScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/clearReminderBacklogScriptSafety.test.ts` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (165 files, 648 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/finalize-event-reminders-script-safety.ts src/lib/migrate-invite-reminders-script-safety.ts scripts/sms-tools/finalize-event-reminders.ts scripts/sms-tools/migrate-invite-reminders.ts tests/lib/finalizeEventRemindersScriptSafety.test.ts tests/lib/migrateInviteRemindersScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/finalizeEventRemindersScriptSafety.test.ts tests/lib/migrateInviteRemindersScriptSafety.test.ts` passed (2 files, 17 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (167 files, 665 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/lib/twilio.ts src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/twilioSendLoggingFailClosed.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts tests/lib/twilioSendLoggingFailClosed.test.ts` passed (2 files, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (168 files, 667 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/testing/test-sms-flow.ts scripts/database/check-sms-issue.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (169 files, 670 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint scripts/database/check-sms-jobs.ts scripts/database/check-bulk-sms-jobs.ts scripts/database/check-sms-queue.ts scripts/database/check-table-booking-sms.ts scripts/testing/test-sms-new-customer.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (169 files, 670 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
## Exit Criteria (Do Not Skip)

- Every domain in "Domain Checklist" is marked complete with evidence.
- All P0/P1 findings are fixed and regression-tested.
- Webhook, cron, and queue paths have replay-safe behavior verified.
- SMS safety controls (limits, dedupe, retry policy, auth) are validated in test and code review.
- Final full CI-equivalent run passes with no warnings promoted to errors.

- `./node_modules/.bin/eslint src/lib/sms/bulk.ts src/app/actions/diagnose-messages.ts tests/lib/smsBulkLoopGuards.test.ts tests/lib/smsBulkMarketingEligibility.test.ts tests/actions/diagnoseMessagesActions.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts tests/lib/smsBulkMarketingEligibility.test.ts tests/actions/diagnoseMessagesActions.test.ts` passed (3 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`143 files, 570 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/messages/bulk/customers/route.ts tests/api/bulkCustomersRouteMarketingEligibility.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/bulkCustomersRouteMarketingEligibility.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`144 files, 571 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/twilio.ts tests/lib/twilioSendGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioSendGuards.test.ts` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`144 files, 572 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts 'src/app/g/[token]/waitlist-offer/confirm/route.ts' tests/lib/waitlistOffersSmsPersistence.test.ts tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts` passed (2 files, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`145 files, 576 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/twilio-log-backfill-safety.ts src/lib/twilio-log-backfill-script-safety.ts scripts/sms-tools/backfill-twilio-log.ts tests/lib/twilioLogBackfillSafety.test.ts tests/lib/twilioLogBackfillScriptSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioLogBackfillSafety.test.ts tests/lib/twilioLogBackfillScriptSafety.test.ts` passed (2 files, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 580 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/customers.ts tests/lib/smsCustomers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsCustomers.test.ts` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 583 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/unified-job-queue.ts src/lib/background-jobs.ts tests/lib/unifiedJobQueue.test.ts tests/lib/backgroundJobsQueue.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/unifiedJobQueue.test.ts tests/lib/backgroundJobsQueue.test.ts` passed (2 files, 13 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 587 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)
- `./node_modules/.bin/eslint src/app/api/webhooks/twilio/route.ts tests/api/twilioWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/twilioWebhookMutationGuards.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 587 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 589 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/sms/customers.ts tests/lib/smsCustomers.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsCustomers.test.ts` passed (1 file, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 594 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/twilio.ts tests/lib/twilioSendGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/twilioSendGuards.test.ts` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`146 files, 595 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-server-action-import.ts tests/scripts/testServerActionImportScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testServerActionImportScriptReadOnly.test.ts` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`147 files, 597 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-cron-endpoint.ts tests/scripts/testCronEndpointScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testCronEndpointScriptReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`148 files, 598 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/cron/apply-customer-labels/route.ts scripts/testing/test-customer-labels-cron.ts tests/api/cronApplyCustomerLabelsHealth.test.ts tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/cronApplyCustomerLabelsHealth.test.ts tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts` passed (2 files, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`150 files, 601 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-employee-creation.ts tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testEmployeeCreationScriptReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`151 files, 602 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-short-link-crud.ts tests/scripts/testShortLinkCrudScriptReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testShortLinkCrudScriptReadOnly.test.ts` passed (1 file, 1 test)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`152 files, 603 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/testing/test-event-crud-fixed.ts scripts/testing/test-event-image-fields.ts tests/scripts/testEventImageScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testEventImageScriptsReadOnly.test.ts` passed (1 file, 2 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`153 files, 605 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint scripts/database/check-tables.ts scripts/database/check-failed-jobs.ts scripts/database/check-invoice-system.ts scripts/database/check-job-tables.ts scripts/database/check-user-permissions.ts scripts/database/check-customer-preferences.ts scripts/database/check-customer-suggestions.ts scripts/database/check-events-with-categories.ts scripts/database/check-customers-table.ts scripts/database/check-events-table.ts scripts/database/check-jobs.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts tests/scripts/testDatabaseCheckScriptsReadOnly.test.ts --reporter=dot` passed (2 files, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (209 files, 839 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (216 files, 886 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 911 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts src/app/api/event-waitlist/route.ts src/app/api/foh/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (3 files, 9 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 917 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

## Agent Handoff Snapshot (2026-02-14)

Current validated baseline:
- `./node_modules/.bin/tsc --noEmit` passed.
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run` passed (`175 files, 698 tests`).
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings).

Latest high-risk findings completed in this segment:
- `280. PAY-003` (P1) Event checkout pending-payment persistence now fails closed on lookup errors, enforces insert row-effect checks, and reconciles duplicate-key insert races before returning success.
- `281. PAY-004` (P1) Manage-booking seat-increase checkout pending-payment persistence now fails closed on dedupe lookup errors, enforces insert row-effect checks, and reconciles duplicate-key insert races.
- `282. SCRIPT-020` (P1) Private-bookings calendar resync script now requires explicit mutation approval, enforces update row-effects, and exits non-zero when any booking sync/persistence failure occurs.
- `283. QUEUE-011` (P1) Unified queue unique-key dedupe lookup now blocks enqueue on lookup error, preventing fail-open duplicate job inserts when dedupe checks are unavailable.
- `284. FOH-011` (P1) FOH charge-request cap checks now block request creation when booking-cap context or existing-charge allocation checks cannot be verified.
- `285. SMS-036` (P1) SMS recipient-context resolution now fails closed on booking lookup errors/missing booking rows, and `sendSms` blocks dispatch when recipient safety context cannot be verified.
- `286. SCRIPT-021` (P1) Old-SMS cleanup script now requires explicit mutation approval and enforces fail-closed query/delete/audit checks with expected row-count assertions so stale-message cleanup cannot silently partially succeed.
- `287. SCRIPT-022` (P1) Pending-SMS cleanup script now requires explicit mutation approval and enforces fail-closed count/update/audit checks with expected row-count assertions so pending-message cancellation cannot silently partially succeed.
- `288. SCRIPT-023` (P1) Queued-message cleanup script now requires explicit mutation approval and enforces fail-closed message/job query checks, strict delete row-count assertions, and checked audit persistence so cleanup runs cannot silently partially succeed.
- `289. SCRIPT-024` (P1) Pending-SMS cancellation script now requires explicit mutation approval and enforces fail-closed pending-job query checks, strict row-count assertions for all/selected cancellations, and checked audit persistence so interactive queue-cancel runs cannot silently partially succeed.
- `290. SCRIPT-025` (P1) SMS template-key fix script now requires explicit mutation approval and enforces fail-closed pending-job query checks, strict per-job update row-count assertions, and checked audit persistence so remediation runs cannot silently partially succeed.
- `291. SCRIPT-026` (P1) Table-booking SMS diagnostics script now requires explicit write-probe mutation approval and enforces fail-closed diagnostics/probe query and row-effect checks so diagnostics cannot silently report success after safety-check failures.
- `292. SCRIPT-027` (P1) Pending-payment remediation script now requires explicit mutation approval/run flags and enforces fail-closed booking/payment lookup, payment/booking mutation row-effects, and audit persistence checks so payment fixes cannot silently partially mutate booking state.
- `293. SCRIPT-028` (P1) Queue-processing script now requires explicit mutation approval/run flags, enforces fail-closed pending-job preflight checks, and blocks pending send-job processing unless an explicit send override is set.
- `294. SCRIPT-029` (P1) Duplicate-loyalty-program fix script now requires explicit mutation approval/run flags and enforces fail-closed program/member/count lookups plus strict migration/delete row-effect checks so one-off loyalty merges cannot silently partially succeed.
- `295. SCRIPT-030` (P1) Delete-all-table-bookings cleanup script now requires explicit mutation approval/run flags (`--confirm` + env guards), enforces fail-closed count/query handling, strict delete row-count assertions, and post-run zero-state verification so destructive cleanup cannot silently partially succeed.
- `296. SCRIPT-031` (P1) Delete-test-bookings cleanup script now requires explicit mutation approval/run flags, enforces fail-closed booking/job lookups and strict payment/item/job/booking/audit row-count assertions, and requires `--force` before deleting confirmed bookings with completed payments.
- `297. SCRIPT-032` (P1) Delete-specific-customers cleanup script now requires explicit mutation approval/run flags, enforces fail-closed target resolution and query handling, strict delete/audit row-count assertions, and non-zero completion when any per-customer delete/audit failure occurs.
- `298. SCRIPT-033` (P1) Delete-peter-pitcher-bookings cleanup script now requires explicit mutation approval/run flags, enforces fail-closed booking query handling, strict delete/audit row-count assertions, and non-zero completion when any booking delete/audit safety check fails.
- `299. SCRIPT-034` (P1) `reset-jobs` and `retry-failed-jobs` scripts now require explicit mutation approval/run flags, default to read-only preflight mode, and enforce fail-closed query/update row-count checks so queue retry/reschedule operations cannot silently partially mutate state.
- `300. SCRIPT-035` (P1) `delete-peter-test-bookings` script now requires explicit mutation approval/run flags, defaults to read-only preflight mode, and enforces fail-closed customer/booking lookup plus delete/audit row-count assertions so targeted booking cleanup cannot silently partially mutate state.
- `301. SCRIPT-036` (P1) `delete-test-customers-direct` script now requires explicit mutation approval/run flags, defaults to read-only preflight mode, and enforces fail-closed target query/delete/audit row-count assertions with safe-target validation so bulk test-customer cleanup cannot silently partially mutate state.
- `302. SCRIPT-037` (P1) Invoice cleanup scripts now require explicit mutation approval/run flags, default to read-only preflight mode, and enforce fail-closed invoice/line-item/email-log lookup plus delete/audit row-count assertions so invoice cleanup cannot silently partially mutate state.
- `303. AUTH-007` (P1) API key rate limit checks now fail closed when usage lookups error, returning 503 instead of allowing unbounded API-key requests.
- `304. QUEUE-012` (P1) Approved private-booking SMS dispatch metadata now records per-queue correlation IDs as `queue_job_id` (not `job_id`), preventing duplicate queue rows from bypassing distributed SMS idempotency dedupe.
- `305. SCRIPT-038` (P1) `test-sms-new-customer` diagnostic script now fails closed by default, requires dual send gates (`--confirm` + env allow flags), avoids customer auto-creation, and includes deterministic SMS idempotency metadata.
- `306. SCRIPT-039` (P1) `test-and-fix-sms` diagnostic script now uses the correct admin-client import and is strictly read-only (no job processing/enqueueing and no SMS sends), preventing accidental mutation/send operations during incident triage.
- `307. QUEUE-013` (P0) Unified job enqueue unique-key handling now acquires an idempotency-key lock (fail-closed under contention) to eliminate check-then-insert races that can create duplicate jobs (including bulk SMS), and bulk SMS jobs prefer stable dispatch keys (`payload.unique_key`) as `bulk_job_id` to preserve distributed SMS idempotency dedupe under queue duplication.
- `308. SCRIPT-040` (P1) `send-feb-2026-event-review-sms` operational script now defaults to read-only/dry-run and requires dual send gates plus an explicit `--limit`/env cap (hard-capped at `200`) before dispatching any SMS, preventing accidental mass sends.
- `309. PARK-006` (P1) Parking payment-request SMS now fails closed when the post-send reminder-flag update errors or affects no rows, preventing stale flags from re-enabling subsequent reminder sends after a successful initial payment request.
- `310. SCRIPT-041` (P1) `test-table-booking-sms` diagnostic script now defaults to read-only/dry-run and requires dual send gates plus explicit booking/to targeting; it no longer inserts deprecated template-based `send_sms` jobs directly into the queue.
- `311. SCRIPT-042` (P0) `test-enrollment-with-sms` diagnostic script now defaults to read-only/dry-run, requires dual send gates plus explicit `--customer-id` and `--to` targeting (with `--to` required to match the target customer's mobile), and no longer creates customer/loyalty rows, processes jobs, or runs cleanup deletes, preventing accidental SMS spam and production DB mutations.
- `312. SCRIPT-043` (P0) `test-loyalty-enrollment` diagnostic script is now strictly read-only, requires explicit `--customer-id`/`TEST_LOYALTY_ENROLLMENT_CUSTOMER_ID` targeting, and no longer creates customers/loyalty members or runs cleanup deletes (and it refuses `--confirm`), preventing accidental SMS spam and production DB mutations.
- `313. SMS-037` (P0) `sendSms` server action now enforces `messages.send` permission server-side (before rate limiting and dispatch), preventing unprivileged users from bypassing client-side checks to send SMS via the admin Supabase client.
- `314. SCRIPT-044` (P0) `test-private-booking-customer-creation` diagnostic script is now strictly read-only (no `insert`/`delete`) and blocks `--confirm`/`--keep`, preventing accidental production DB mutations during investigation.
- `315. SCRIPT-045` (P0) `test-critical-flows` script is now strictly read-only and exits non-zero when any smoke check fails, preventing unsafe inserts/deletes and false-success incident checks.
- `316. QUEUE-014` (P0) UnifiedJobQueue now aborts execution when lease refresh/heartbeat fails (or affects no rows), preventing side effects from continuing without an active lease and reducing duplicate job processing/duplicate-send risk.
- `317. MSG-002` (P0) Twilio missed-message import server action now fails closed when existing-message/customer lookups error and creates SMS-deactivated placeholder customers (rather than SMS-eligible defaults), preventing fail-open duplicate imports and accidental SMS eligibility enablement during backfills.
- `318. SCRIPT-046` (P0) Legacy Twilio backfill script (`src/scripts/import-missed-messages.ts`) is now strictly read-only and blocks `--confirm`, preventing accidental production inserts (customers/messages) and unsafe opt-in assumptions during incident response.
- `319. SMS-038` (P0) Customer SMS opt-out toggles now update `sms_status` (and disable `marketing_sms_opt_in` on opt-out) so `sendSMS` eligibility checks cannot continue sending after an opt-out transition.
- `320. SMS-039` (P0) Bulk SMS helper now requires `sms_opt_in=true`, `marketing_sms_opt_in=true`, and non-blocked `sms_status` (and prefers `mobile_e164`) before dispatch, preventing bulk marketing sends to non-consented or opted-out customers.
- `321. MSG-003` (P1) `diagnoseMessages` now uses the admin Supabase client, fails closed when DB lookups error, and skips DB checks when Twilio returns zero messages, preventing false-positive “missing message” triage results.
- `322. SMS-040` (P1) Bulk customer selection (`/api/messages/bulk/customers`) now enforces marketing eligibility (`sms_opt_in=true`, `marketing_sms_opt_in=true`, non-blocked `sms_status`) so bulk send audiences and counts align with dispatch gating.
- `323. SMS-041` (P0) `sendSMS` customer eligibility now blocks `sms_opt_in=false` recipients even when `sms_status` is `null`/`active`, preventing legacy opt-outs from remaining SMS-eligible.
- `324. WAITLIST-002` (P1) Waitlist offer SMS sending now fails closed when event lookups error or affect no rows, preventing placeholder `"your event"` content from being sent when event context cannot be verified.
- `325. WAITLIST-003` (P1) Guest waitlist-offer acceptance confirm route SMS helper now fails closed when customer/event lookups error or event is missing, preventing acceptance confirmation SMS from sending with unverifiable event context.
- `326. SCRIPT-047` (P0) Twilio log backfill script now defaults to dry-run and requires explicit mutation/customer-create gating plus strict caps, and placeholder customers created during backfills are SMS-deactivated and opted out by default, preventing backfill runs from accidentally enabling SMS eligibility or performing unbounded inserts.
- `327. SMS-042` (P0) Manual-send customer resolution now refuses to create new customers from arbitrary phone numbers when booking/customer context is missing; it resolves only existing customers (or fails closed), preventing manual-send flows from silently expanding the SMS-eligible population.
- `328. QUEUE-015` (P0) Queue-driven `send_sms` job execution now fails closed when `customer_id` is missing, preventing orphan jobs from auto-creating customers and sending SMS without verified recipient context.
- `329. WEBHOOK-017` (P0) Twilio inbound opt-out keyword handling now fails closed when the preference update errors or affects no rows (retriable `500`), preventing silent STOP compliance drops and ensuring retries can re-attempt the write.
- `330. EVENT-008` (P1) Event manual-booking table-reservation conflict rollback now fails closed when rollback persistence fails (booking cancel or hold release), preventing “blocked” success responses while leaving confirmed bookings/holds in an inconsistent state.
- `331. SMS-043` (P0) SMS recipient-context resolution now validates that provided `customerId` and private-booking context match the destination phone (`to`) and fails closed on mismatch, preventing opt-out/eligibility bypasses via mismatched customer context or booking spoofing.
- `332. SMS-044` (P0) `sendSMS` now blocks dispatch when a provided `customerId` does not match the destination phone (`to`), preventing opt-out/eligibility bypasses via mismatched customer context across OTP/manual/queue send paths.
- `333. SCRIPT-048` (P1) `test-server-action-import` diagnostic script is now strictly read-only (no server-action calls) and exits non-zero on import failures, preventing accidental enqueue/send side effects and false-success diagnostics.
- `334. SCRIPT-049` (P0) `test-cron-endpoint` diagnostic script is now strictly read-only (health-check only) and never calls the job processor POST route, preventing accidental job processing and outbound side effects (SMS/email) during incident diagnostics.
- `335. SCRIPT-050` (P1) `test-customer-labels-cron` diagnostic script is now strictly read-only (health-check only), and `/api/cron/apply-customer-labels` supports authorized `?health=true` without RPC/audit writes, preventing accidental production label mutations during incident diagnostics.
- `336. SCRIPT-051` (P1) `test-employee-creation` diagnostic script is now strictly read-only (select-only) and cannot insert/delete employee records, preventing accidental production employee/financial/health DB mutations during incident diagnostics.
- `337. SCRIPT-052` (P1) `test-short-link-crud` diagnostic script is now strictly read-only (select-only) and cannot insert/update/delete short links, preventing accidental production short-link mutations and redirect side effects during incident diagnostics.
- `338. SCRIPT-053` (P1) Event image-field diagnostic scripts are now strictly read-only (select-only) and cannot insert/update/delete events/categories, preventing accidental production event/category mutations during incident diagnostics.
- `339. SCRIPT-054` (P0) `test-booking-api` diagnostic script is now dry-run by default and multi-gated before any POST to the booking initiation endpoint, preventing accidental production booking creation and outbound SMS spam during incident diagnostics.
- `340. SCRIPT-055` (P0) Table booking API diagnostic scripts are now dry-run by default and multi-gated before any booking-creation POSTs, and contain no baked-in API keys/prod URLs/phones, preventing accidental production booking creation and outbound SMS spam during incident diagnostics.
- `341. SCRIPT-056` (P0) Audit log diagnostic scripts are now strictly read-only and cannot insert audit logs or attempt helper function creation, preventing accidental production DB mutation during incident diagnostics.
- `342. SCRIPT-057` (P0) API key and deployment diagnostic scripts no longer embed real API keys or default to production targets, and any booking-creation POSTs are now explicitly multi-gated, preventing secret leakage and accidental production booking creation/outbound SMS during incident diagnostics.
- `343. SCRIPT-058` (P1) Short link demographics diagnostic script is now strictly read-only (no short link/click inserts or cleanup deletes), preventing accidental production short link analytics mutations during incident diagnostics.
- `344. SCRIPT-059` (P1) `resync-private-bookings-calendar` operational script now defaults to dry-run, requires explicit multi-gating and caps before any calendar writes/DB updates, and fails closed on any booking sync/persistence failure, preventing unbounded production mutations during incident response.
- `345. SCRIPT-060` (P1) Calendar sync testing scripts are now strictly read-only and block `--confirm`, preventing accidental Google Calendar writes and `private_bookings` updates during incident diagnostics.
- `346. SCRIPT-061` (P1) `send-feb-2026-event-review-sms` bulk SMS script no longer bakes in a production app URL fallback, requires explicit URL configuration when sending, and uses fail-closed exit codes, reducing accidental production link-send risk during one-off campaigns.
- `347. SMS-045` (P0) SMS idempotency dedupe context no longer includes legacy `job_id`, preventing per-job correlation IDs from bypassing dedupe and triggering duplicate sends.
- `348. SMS-046` (P1) Private booking SMS queue auto-send no longer depends on the RBAC-gated `sendSms` server action; it now resolves recipient context and sends via transport-level `sendSMS` with stable idempotency metadata so cron/services can send safely without user auth.
- `349. SCRIPT-062` (P1) `fix-past-reminders` operational script now defaults to dry-run and requires explicit multi-gating, operation selection, and strict caps before cancelling reminders or deleting pending SMS jobs.
- `350. EVENT-009` (P1) Manual event booking cancellation now fails closed when follow-up booking-hold release or linked table-booking cancellation writes error, preventing false-success cancellations.

Files touched in latest segment:
- `src/lib/table-booking-sms-fix-safety.ts`
- `scripts/fixes/fix-table-booking-sms.ts`
- `tests/lib/tableBookingSmsFixSafety.test.ts`
- `src/lib/pending-payment-fix-safety.ts`
- `scripts/fixes/fix-pending-payment.ts`
- `tests/lib/pendingPaymentFixSafety.test.ts`
- `src/lib/process-jobs-script-safety.ts`
- `scripts/process-jobs.ts`
- `tests/lib/processJobsScriptSafety.test.ts`
- `src/lib/duplicate-loyalty-program-fix-safety.ts`
- `scripts/fixes/fix-duplicate-loyalty-program.ts`
- `tests/lib/duplicateLoyaltyProgramFixSafety.test.ts`
- `src/lib/delete-all-table-bookings-safety.ts`
- `scripts/cleanup/delete-all-table-bookings.ts`
- `tests/lib/deleteAllTableBookingsSafety.test.ts`
- `src/lib/delete-test-bookings-safety.ts`
- `scripts/cleanup/delete-test-bookings.ts`
- `tests/lib/deleteTestBookingsSafety.test.ts`
- `src/lib/delete-specific-customers-safety.ts`
- `scripts/cleanup/delete-specific-customers.ts`
- `tests/lib/deleteSpecificCustomersSafety.test.ts`
- `src/lib/delete-peter-pitcher-bookings-safety.ts`
- `scripts/cleanup/delete-peter-pitcher-bookings.ts`
- `tests/lib/deletePeterPitcherBookingsSafety.test.ts`
- `src/lib/job-retry-script-safety.ts`
- `scripts/reset-jobs.ts`
- `scripts/retry-failed-jobs.ts`
- `tests/lib/jobRetryScriptSafety.test.ts`
- `src/lib/delete-peter-test-bookings-safety.ts`
- `scripts/cleanup/delete-peter-test-bookings.ts`
- `tests/lib/deletePeterTestBookingsSafety.test.ts`
- `src/lib/delete-test-customers-direct-safety.ts`
- `scripts/cleanup/delete-test-customers-direct.ts`
- `tests/lib/deleteTestCustomersDirectSafety.test.ts`
- `src/lib/delete-invoice-cleanup-safety.ts`
- `scripts/cleanup/delete-test-invoices.ts`
- `scripts/cleanup/delete-specific-invoice.ts`
- `tests/lib/deleteInvoiceCleanupSafety.test.ts`
- `src/lib/api/auth.ts`
- `tests/lib/apiAuthRateLimit.test.ts`
- `src/services/sms-queue.ts`
- `tests/services/smsQueue.service.test.ts`
- `src/lib/test-sms-new-customer-safety.ts`
- `scripts/testing/test-sms-new-customer.ts`
- `tests/lib/testSmsNewCustomerSafety.test.ts`
- `scripts/testing/test-and-fix-sms.ts`
- `tests/scripts/testAndFixSmsScriptReadOnly.test.ts`
- `src/lib/unified-job-queue.ts`
- `tests/lib/unifiedJobQueue.test.ts`
- `src/lib/background-jobs.ts`
- `tests/lib/backgroundJobsQueue.test.ts`
- `src/lib/send-feb-2026-event-review-sms-safety.ts`
- `scripts/tools/send-feb-2026-event-review-sms.ts`
- `tests/lib/sendFeb2026EventReviewSmsSafety.test.ts`
- `src/lib/parking/payments.ts`
- `tests/lib/parkingPaymentsPersistence.test.ts`
- `src/lib/test-table-booking-sms-safety.ts`
- `scripts/testing/test-table-booking-sms.ts`
- `tests/lib/testTableBookingSmsSafety.test.ts`
- `src/lib/test-enrollment-with-sms-safety.ts`
- `scripts/testing/test-enrollment-with-sms.ts`
- `tests/lib/testEnrollmentWithSmsSafety.test.ts`
- `scripts/testing/test-loyalty-enrollment.ts`
- `tests/scripts/testLoyaltyEnrollmentScriptReadOnly.test.ts`
- `scripts/testing/test-private-booking-customer-creation.ts`
- `tests/scripts/testPrivateBookingCustomerCreationScriptReadOnly.test.ts`
- `scripts/testing/test-critical-flows.ts`
- `tests/scripts/testCriticalFlowsScriptReadOnly.test.ts`
- `src/app/actions/sms.ts`
- `tests/actions/smsActions.test.ts`
- `src/app/actions/import-messages.ts`
- `src/app/(authenticated)/settings/import-messages/ImportMessagesClient.tsx`
- `src/scripts/import-missed-messages.ts`
- `tests/actions/importMessagesActions.test.ts`
- `tests/scripts/importMissedMessagesLegacyScriptReadOnly.test.ts`
- `src/services/customers.ts`
- `tests/services/mutation-race-guards.test.ts`
- `src/lib/sms/bulk.ts`
- `src/app/actions/diagnose-messages.ts`
- `tests/lib/smsBulkLoopGuards.test.ts`
- `tests/lib/smsBulkMarketingEligibility.test.ts`
- `tests/actions/diagnoseMessagesActions.test.ts`
- `src/app/api/messages/bulk/customers/route.ts`
- `tests/api/bulkCustomersRouteMarketingEligibility.test.ts`
- `src/lib/sms/safety.ts`
- `tests/lib/sms/safety.test.ts`
- `src/lib/twilio.ts`
- `src/app/api/webhooks/twilio/route.ts`
- `tests/api/twilioWebhookMutationGuards.test.ts`
- `tests/lib/twilioSendGuards.test.ts`
- `tests/lib/twilioUnexpectedPipelineSafety.test.ts`
- `src/lib/events/waitlist-offers.ts`
- `src/app/g/[token]/waitlist-offer/confirm/route.ts`
- `tests/lib/waitlistOffersSmsPersistence.test.ts`
- `tests/api/guestWaitlistOfferConfirmRouteSmsGuards.test.ts`
- `scripts/sms-tools/backfill-twilio-log.ts`
- `src/lib/twilio-log-backfill-safety.ts`
- `src/lib/twilio-log-backfill-script-safety.ts`
- `tests/lib/twilioLogBackfillSafety.test.ts`
- `tests/lib/twilioLogBackfillScriptSafety.test.ts`
- `src/lib/sms/customers.ts`
- `tests/lib/smsCustomers.test.ts`
- `scripts/testing/test-server-action-import.ts`
- `tests/scripts/testServerActionImportScriptReadOnly.test.ts`
- `scripts/testing/test-cron-endpoint.ts`
- `tests/scripts/testCronEndpointScriptReadOnly.test.ts`
- `scripts/testing/test-customer-labels-cron.ts`
- `tests/scripts/testCustomerLabelsCronScriptReadOnly.test.ts`
- `src/app/api/cron/apply-customer-labels/route.ts`
- `tests/api/cronApplyCustomerLabelsHealth.test.ts`
- `scripts/testing/test-employee-creation.ts`
- `tests/scripts/testEmployeeCreationScriptReadOnly.test.ts`
- `scripts/testing/test-short-link-crud.ts`
- `tests/scripts/testShortLinkCrudScriptReadOnly.test.ts`
- `scripts/testing/test-event-crud-fixed.ts`
- `scripts/testing/test-event-image-fields.ts`
- `tests/scripts/testEventImageScriptsReadOnly.test.ts`
- `scripts/testing/test-booking-api.ts`
- `tests/scripts/testBookingApiScriptSafety.test.ts`
- `scripts/testing/test-production-templates.ts`
- `scripts/testing/test-template-loading.ts`
- `scripts/testing/test-slot-generation.ts`
- `tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts`
- `scripts/testing/test-api-booking-fix.ts`
- `scripts/testing/test-booking-now.ts`
- `scripts/testing/test-sunday-lunch-api.ts`
- `scripts/testing/test-sunday-lunch-payment-fix.ts`
- `tests/scripts/testTableBookingApiScriptsSafety.test.ts`
- `scripts/testing/test-audit-log.ts`
- `scripts/testing/test-audit-log-rls.ts`
- `tests/scripts/testAuditLogScriptsReadOnly.test.ts`
- `scripts/testing/test-api-complete-fix.ts`
- `scripts/database/check-deployment-status.ts`
- `scripts/database/check-api-key-database.ts`
- `tests/scripts/testNoHardcodedApiKeysInScripts.test.ts`
- `scripts/testing/test-demographics.ts`
- `tests/scripts/testDemographicsScriptReadOnly.test.ts`
- `scripts/tools/resync-private-bookings-calendar.ts`
- `tests/scripts/testResyncPrivateBookingsCalendarScriptSafety.test.ts`
- `scripts/testing/test-calendar-sync.ts`
- `scripts/testing/test-calendar-sync-admin.ts`
- `scripts/testing/test-calendar-final.ts`
- `scripts/testing/test-booking-calendar-sync.ts`
- `tests/scripts/testCalendarSyncScriptsReadOnly.test.ts`
- `tests/scripts/testSendFeb2026EventReviewSmsScriptSafety.test.ts`
- `src/lib/fix-past-reminders-script-safety.ts`
- `scripts/sms-tools/fix-past-reminders.ts`
- `tests/lib/fixPastRemindersScriptSafety.test.ts`
- `src/lib/events/event-payments.ts`
- `tests/lib/eventPaymentSmsSafetyMeta.test.ts`
- `tests/lib/eventBookingSeatUpdateSmsSafety.test.ts`
- `src/lib/table-bookings/bookings.ts`
- `tests/lib/tableBookingCreatedSmsMeta.test.ts`
- `tests/lib/tableBookingSundayPreorderSmsMeta.test.ts`
- `tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts`
- `src/lib/events/waitlist-offers.ts`
- `src/lib/events/staff-seat-updates.ts`
- `src/lib/parking/payments.ts`
- `tests/lib/waitlistOffersSmsPersistence.test.ts`
- `tests/lib/staffSeatUpdatesMutationGuards.test.ts`
- `tests/lib/parkingPaymentsPersistence.test.ts`
- `src/services/sms-queue.ts`
- `tests/services/smsQueue.service.test.ts`
- `FULL_APPLICATION_REVIEW_BLUEPRINT.md`
- `AGENT_HANDOFF_2026-02-14.md`

Validation evidence (latest Dev 2 batch, finding 458):
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (`1 file, 21 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1005 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, findings 455-457):
- `./node_modules/.bin/eslint src/lib/events/waitlist-offers.ts src/lib/events/staff-seat-updates.ts src/lib/parking/payments.ts tests/lib/waitlistOffersSmsPersistence.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/waitlistOffersSmsPersistence.test.ts tests/lib/staffSeatUpdatesMutationGuards.test.ts tests/lib/parkingPaymentsPersistence.test.ts --reporter=dot` passed (`3 files, 21 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1004 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 4 batch, finding 535 follow-up - read-only diagnostics strict bounded parsing):
- `./node_modules/.bin/eslint scripts/testing/test-production-templates.ts scripts/testing/test-template-loading.ts scripts/testing/test-demographics.ts scripts/testing/test-slot-generation.ts scripts/testing/test-audit-log.ts scripts/testing/test-audit-log-rls.ts scripts/testing/test-calendar-sync.ts tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/scripts/testAdditionalTestingScriptsFailClosed.test.ts tests/scripts/testDemographicsScriptReadOnly.test.ts tests/scripts/testAuditLogScriptsReadOnly.test.ts tests/scripts/testCalendarSyncScriptsReadOnly.test.ts --reporter=dot` passed (`4 files, 20 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 1001 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 454):
- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts tests/lib/tableBookingPostCardCaptureSmsMeta.test.ts --reporter=dot` passed (`3 files, 6 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`224 files, 996 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 453):
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (`2 files, 13 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 991 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, findings 451-452):
- `./node_modules/.bin/eslint src/lib/sms/bulk.ts tests/lib/smsBulkLoopGuards.test.ts src/lib/twilio.ts tests/lib/twilioUnexpectedPipelineSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/smsBulkLoopGuards.test.ts tests/lib/twilioUnexpectedPipelineSafety.test.ts --reporter=dot` passed (`2 files, 6 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`223 files, 988 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, findings 449-450):
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts src/lib/events/waitlist-offers.ts tests/lib/waitlistOffersSmsPersistence.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts tests/lib/waitlistOffersSmsPersistence.test.ts --reporter=dot` passed (`2 files, 28 tests`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 982 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 448):
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventBookingSeatUpdateSmsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventBookingSeatUpdateSmsSafety.test.ts --reporter=dot` passed (`1 file, 5 tests`)
- `./node_modules/.bin/tsc --noEmit` failed (`src/lib/events/event-payments.ts:479/499/520 Type 'null' is not assignable to type 'string | undefined'`)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (`222 files, 977 tests`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 447):
- `./node_modules/.bin/eslint src/services/sms-queue.ts tests/services/smsQueue.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/smsQueue.service.test.ts --reporter=dot` passed (1 file, 18 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 971 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 446):
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 965 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 445):
- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingHoldAlignment.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingHoldAlignment.test.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts --reporter=dot` passed (3 files, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 962 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: no such file or directory, rename '.next/export/500.html' -> '.next/server/pages/500.html'`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, finding 444):
- `./node_modules/.bin/eslint src/lib/table-bookings/bookings.ts tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/tableBookingCreatedSmsMeta.test.ts tests/lib/tableBookingSundayPreorderSmsMeta.test.ts --reporter=dot` passed (2 files, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 959 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 2 batch, findings 442-443):
- `./node_modules/.bin/eslint src/services/messages.ts tests/services/messages.service.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/services/messages.service.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/eslint src/lib/events/event-payments.ts tests/lib/eventPaymentSmsSafetyMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/lib/eventPaymentSmsSafetyMeta.test.ts --reporter=dot` passed (1 file, 3 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 929 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 409):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 6 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 928 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 410):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 7 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 938 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 411):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 941 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 412):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 10 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 950 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`Could not find a production build in the '.next' directory (next-export-no-build-id)`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 413):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts src/lib/table-bookings/bookings.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 953 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 414):
- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (219 files, 954 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 415):
- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts scripts/database/check-sms-queue.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/scripts/testSmsFlowDiagnosticsScriptsSafety.test.ts --reporter=dot` passed (2 files, 11 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (220 files, 957 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`TypeError: Cannot read properties of undefined (reading 'call')` while prerendering `/auth/login`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 416):
- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 12 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 960 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings; webpack cache big-strings warning)

Validation evidence (latest Dev 1 batch, finding 417):
- `./node_modules/.bin/eslint src/app/api/foh/event-bookings/route.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (1 file, 4 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (221 files, 962 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../route.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .next/server/pages-manifest.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true,maxRetries:10,retryDelay:100});" && NEXT_DISABLE_WEBPACK_CACHE=1 ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 418):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 969 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 419):
- `./node_modules/.bin/eslint src/app/actions/events.ts tests/actions/eventsManualBookingGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/actions/eventsManualBookingGuards.test.ts --reporter=dot` passed (1 file, 13 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 972 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420):
- `./node_modules/.bin/eslint src/app/api/stripe/webhook/route.ts tests/api/stripeWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/stripeWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 15 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 978 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up):
- `./node_modules/.bin/eslint src/app/api/webhooks/twilio/route.ts tests/api/twilioWebhookMutationGuards.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/twilioWebhookMutationGuards.test.ts --reporter=dot` passed (1 file, 8 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (222 files, 986 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up 2):
- `./node_modules/.bin/eslint src/app/api/parking/bookings/route.ts tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/idempotencyPersistFailClosedAdditionalRoutes.test.ts --reporter=dot` passed (1 file, 5 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (223 files, 993 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/export-detail.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` failed (`ENOENT: .../.next/server/app/_not-found/page.js.nft.json`)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Validation evidence (latest Dev 1 batch, finding 420 follow-up 3):
- `./node_modules/.bin/eslint src/app/api/event-bookings/route.ts src/app/api/event-waitlist/route.ts src/app/api/foh/event-bookings/route.ts tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run tests/api/eventBookingsRouteSmsMeta.test.ts tests/api/eventWaitlistRouteSmsMeta.test.ts tests/api/fohEventBookingsSmsMeta.test.ts --reporter=dot` passed (3 files, 14 tests)
- `./node_modules/.bin/tsc --noEmit` passed
- `VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run --reporter=dot` passed (224 files, 1001 tests)
- `node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build` passed (warnings: Browserslist age, webpack cache big strings)

Post-420 Dev 1 re-triage note:
- Re-audited owned non-cron send/write surfaces (`src/app/actions` SMS/message queue actions and `src/app/api` non-cron/webhook handlers in scope) for ignored `Promise.allSettled` outcomes, swallowed DB errors, unchecked row effects, and `.catch(console.error)` fail-open patterns; three additional gaps were found and fixed under `420` follow-ups (Twilio status webhook delivery-outcome fail-closed behavior, parking booking create SMS safety-meta surfacing, and event booking/waitlist rejected-task SMS fallback meta surfacing), with no further P0/P1 findings identified within the reserved Dev 1 ID range (`381-420`).

Next recommended review order:
1. Continue fail-closed/fail-safe sweep for remaining send/dedupe guards outside cron routes (services/actions/webhooks), prioritizing non-Twilio webhook and manual-send service paths.
2. Continue reviewing `scripts/` operational tooling for unsafe one-off mutation paths and missing guards (`264` scripts listed above), prioritizing remaining send/remediation scripts that still continue after read/mutation failures.
3. Continue replacing count/read checks that swallow DB errors in write-adjacent or send-adjacent flows.
4. Keep adding narrow regression tests for each fix and update this document with new IDs and evidence.

Execution notes for next agent:
- Use local binaries (`./node_modules/.bin/...`) for lint/test/build in this environment.
- Keep finding IDs sequential from `381+`.
- Treat this repository as already dirty and never revert unrelated edits.

Handover addendum (2026-02-15):
- See `/Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md` for the forwardable prompt, remaining-work checklist, and updated triage counts/commands.

## 4-Developer Parallel Handoff (2026-02-15)

Reserved finding ID ranges (do not use IDs outside your range):
- Dev 1 (actions + API routes + webhooks): `381-420`
- Dev 2 (services + libs): `421-460`
- Dev 3 (scripts: database + cleanup + sms-tools + fixes): `461-500`
- Dev 4 (scripts: menu + oj-projects + testing + root mutation scripts): `501-540`

Shared rules (all devs):
- Every fix must include regression tests.
- After each substantial batch: targeted eslint/vitest -> `tsc --noEmit` -> full vitest -> `next build`.
- After each batch, update BOTH `/Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md` and `/Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md` with: new finding IDs (within your reserved range), severity + summary, regression coverage entries, and exact validation evidence (include test/file counts).

### Prompt (Dev 1): Actions + API Routes + Webhooks (Non-cron)
```text
You are Developer 1 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 381-420 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- Next.js route handlers in src/app/api/** excluding cron (plus the Stripe/PayPal webhooks).
- Server actions in src/app/actions/** that send/enqueue SMS or touch messages/sms queue.
- Tests you add/update should live primarily in tests/api/** and tests/actions/**.

P0/P1 goals:
1) Fail-closed sweep for remaining send/dedupe paths outside cron. Replace swallowed DB errors near send/write paths, add strict row-effect checks, and guard check-then-insert/update races.
2) Remove/replace any .catch(console.error) and other fail-open patterns on send/write paths in your scope.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/app/actions src/app/api --glob '!src/app/api/cron/**'
- ALSO audit (even if keyword search misses it):
  - src/app/api/stripe/webhook/route.ts
  - src/app/api/webhooks/paypal/parking/route.ts
  - src/app/api/public/private-booking/route.ts
  - src/app/api/external/create-booking/route.ts
- Look for: Promise.all/Promise.allSettled ignoring results, swallowed Supabase errors, update/delete without checking affected rows, and check-then-insert races around dedupe/history tables.

Regression requirements:
- Add a focused vitest regression for each fix (route-level behavior, abort semantics, meta surface, or row-effect checks).
- Do not introduce retry-driven duplicate-send loops: prefer returning HTTP 200 with explicit abort metadata when a fatal safety signal happens after any transport send, but still persist a failed run/attempt when applicable.

After each batch:
- Update BOTH docs with your findings (381-420 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 2): Services + Libs (Send/Dedupe/Idempotency/Row-Effect)
```text
You are Developer 2 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 421-460 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- Service + library layers: src/services/** and src/lib/**.
- Tests you add/update should live primarily in tests/services/** and tests/lib/**.

P0/P1 goals:
1) Fail-closed sweep for remaining send/dedupe/idempotency paths outside cron: no swallowed DB errors near send/write paths, strict row-effect checks, and guard check-then-insert/update races.
2) Ensure send helpers consistently propagate safety meta (code/logFailure) and that loops/batches abort on fatal safety signals (logging_failed, safety_unavailable, idempotency_conflict) where continuing could fan out spam.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|SmsQueue|sms-queue|idempot|dedupe|twilio)\\b" src/services src/lib
- rg -n "\\.catch\\(console\\.error\\)" src/services src/lib
- Review especially:
  - src/lib/twilio.ts (sendSMS pipeline)
  - src/services/sms-queue.ts (enqueue/dedupe/locks)
  - src/lib/unified-job-queue.ts + src/lib/background-jobs.ts (job concurrency + abort semantics)
  - src/services/messages.ts (reply/send paths)
  - src/lib/sms/** and src/lib/events/** send helpers that return { success, code, logFailure }
- Look for: check-then-insert patterns without idempotency locks, update/delete calls that ignore affected row count, and error handling that logs but continues.

Regression requirements:
- Add a focused vitest regression for each fix (race guard behavior, row-effect failures, fatal safety-signal abort).
- Prefer tests that prove we fail closed on DB errors adjacent to send/write paths.

After each batch:
- Update BOTH docs with your findings (421-460 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 3): Scripts (database + cleanup + sms-tools + fixes)
```text
You are Developer 3 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 461-500 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- scripts/database/**
- scripts/cleanup/**
- scripts/sms-tools/**
- scripts/fixes/** (all; coordinate with Dev 4 if you touch non-SMS-related ones)
- plus any root-level scripts that send SMS / mutate messages/jobs.
- Tests you add/update should live primarily in tests/scripts/** and tests/lib/** (existing script-safety harnesses).

P0/P1 goals (scripts):
1) Any script that can send SMS or mutate DB must default to read-only/dry-run.
2) Any mutation/send requires multi-gating + explicit caps/limits (with hard caps).
3) Scripts must fail closed: never exit 0 if safety checks, env validation, DB reads/writes, or expected row counts fail.
4) No .catch(console.error) (or log-and-continue) in scripts.

Start here (triage):
- rg -l "\\b(sendSms|sendSMS|twilio|messageSid|send_sms|sms-queue|SmsQueue)\\b" scripts
- rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts/database scripts/cleanup scripts/sms-tools scripts/fixes
- rg -n "\\.catch\\(console\\.error\\)" scripts/database scripts/cleanup scripts/sms-tools scripts/fixes

Regression requirements:
- Every script you change must be covered by a vitest regression (read-only default, gating required, caps enforced, fails non-zero on safety failures).
- Prefer to extend existing script safety tests rather than inventing a new framework.

After each batch:
- Update BOTH docs with your findings (461-500 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

### Prompt (Dev 4): Scripts (menu + oj-projects + testing + root mutation scripts)
```text
You are Developer 4 of 4 taking over a production-hardening reliability/safety review after a severe SMS spam incident.

Repo: /Users/peterpitcher/Cursor/anchor-management-tools

Read these first (fully):
1) /Users/peterpitcher/Cursor/anchor-management-tools/AGENT_HANDOFF_2026-02-14.md
2) /Users/peterpitcher/Cursor/anchor-management-tools/FULL_APPLICATION_REVIEW_BLUEPRINT.md

Hard rules:
- Repo is intentionally dirty: do NOT revert unrelated changes.
- Prefer rg for discovery. In this shell, common utilities like cat/sed/ls/head may be missing; use rg and node -e to read/print files.
- npm scripts are unreliable; validate using local binaries only:
  - ./node_modules/.bin/eslint ...
  - ./node_modules/.bin/tsc --noEmit
  - VITE_CJS_IGNORE_WARNING=true ./node_modules/.bin/vitest run ...
  - node -e "const fs=require('fs'); fs.rmSync('.next',{recursive:true,force:true});" && ./node_modules/.bin/next build
- After each substantial batch: targeted eslint/vitest -> tsc -> full vitest -> next build.
- Every fix must include regression tests.

Finding IDs:
- You MUST use only finding IDs 501-540 (inclusive). Do not use IDs outside this range.

Scope (own these areas):
- scripts/menu/**
- scripts/oj-projects/**
- scripts/testing/**
- root-level scripts that mutate DB (coordinate with Dev 3 if it is SMS/messages/jobs-related)
- scripts/hiring/** and other remaining mutation scripts not covered by Dev 3.

P0/P1 goals (scripts):
1) Any script that can mutate DB must be safe by default: read-only/dry-run unless explicitly enabled.
2) Any mutation requires multi-gating + explicit caps/limits (with hard caps).
3) Scripts must fail closed: never exit 0 if env validation, DB reads/writes, or expected row counts fail.
4) Remove remaining fail-open patterns (.catch(console.error), process.exit(0) on error, or silent partial-failure continues).

Start here (triage):
- rg -l "\\.(insert|update|delete|upsert|rpc)\\(" scripts/menu scripts/oj-projects scripts/testing
- rg -n "\\.catch\\(console\\.error\\)" scripts/menu scripts/oj-projects scripts/testing

Regression requirements:
- Every script you change must be covered by a vitest regression (read-only default, gating required, caps enforced, fails non-zero on safety failures).
- For one-off fix scripts, add tests that assert the safety wrapper is used and that dangerous defaults are blocked.

After each batch:
- Update BOTH docs with your findings (501-540 only), regression coverage, and exact validation evidence commands/results (with updated test counts).
```

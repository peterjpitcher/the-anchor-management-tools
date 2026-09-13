# Ticket release, 10 September 2026

Complete: both migrations are applied, both final main commits are live and both GitHub CI runs passed. Temporary release worktrees and branches have been removed. Final canonical-domain checks confirmed the exact Ready deployment IDs below.

## Serving releases

- Management: commit `db10564bee00a856aa01e939acc1667531d9f829`, deployment `dpl_3HC6Vn63qqvNsC6hGH6XC2sVM8HK`, verified Ready at https://management.orangejelly.co.uk.
- Website: commit `32e759fcb0a6bd7b7708d0d27373ffb80274a524`, deployment `dpl_BoHyBeR92pWkoSVBCPTwyGu4hyvn`, verified Ready at https://www.the-anchor.pub.
- Both commits are on their repository main branch. The earlier staged deployments were promoted only after the approved migrations and database checks passed.

## Production evidence

Tasting Night's actual Tickets tab shows Standard full price £45 and online price £40, retaining the existing £5 discount. The London discount deadline and required/optional guest question controls are visible. The allergy preset was added to the unsaved editor and removed again, with no event settings saved.

The live public Tasting Night form showed separate names for two tickets and £80. Increasing quantity added a third guest while preserving entered names. The 390px mobile layout was inspected and the viewport reset. The live pay-on-arrival Quiz Night and free Karaoke forms have no per-ticket guest section. The event drawer links paid setup to Tickets. No real booking, payment or message was submitted.

Both original and companion SQL checksums matched approval immediately before Supabase MCP apply. All four new columns, eleven functions/grants, seven triggers and two constraints passed catalogue checks. The three dependent view hashes are unchanged. All nine anonymous access checks pass. Service-role smoke checks exercised paid holds, guest snapshots, required answers, price mismatch rollback, discount expiry, retained hold prices, combined dining requests, retry gates, mirrors, last-ticket/guest count guards, and ordinary free/pay-on-arrival paths. Every synthetic record rolled back.

Local verification on current main: management 7,036 tests and website 2,401 tests passed separately in London and UTC; existing skips retained. Both clean production builds, lint and types passed. The isolated PostgreSQL harness passed 60 checks. Scoped generated types were regenerated from the applied live schema.

## Existing issues deliberately not changed

One event PayPal reconciliation error refers to pending payment `0b57b60f-6698-4086-a917-0997b8c1cba8`, created 3 July 2026. PayPal reports the stored order does not exist. The same error was verified in production logs at 07:30 UTC, before this release. No payment state was altered. The tested customer screens produced no new application errors; the management browser retained an older browser-extension message-channel error from before deployment.

The Tasting Night event's authored SEO description still contains an older £25-30 price range. The structured ticket prices are now corrected. No authored event content was edited as part of the approved migrations.

Historical booking prices were not backfilled. Dedicated per-person booking amendments/refunds remain outside this release; structured bookings reject legacy seat-count/transfer shortcuts to protect the saved guests.

The original shared working trees and their unrelated marketing, private-booking, invoicing, table-booking and design work are preserved. Temporary release worktrees and branches were removed after final verification.

## Migration mapping

- `20260910065400_ticket_setup_and_attendees.sql` -> live history `20260910075712`, SHA256 `3c932cde7891ed338c8fcd548343b285d96d0ce804d6db84d002c8b1ab28ee21`.
- `20260910073920_ticket_attendees_dining_requests.sql` -> live history `20260910075719`, SHA256 `70d663e10124565c2900d592d2e57f424cecf80b9d772ca7e57ae84db79fbca8`.

Original filenames remain unchanged; the approved forward-fix plan retains collected guest data.

## Management changed files

- `scripts/testing/fixtures/ticket-setup-base.sql`
- `scripts/testing/ticket-setup-postgres.py`
- `src/app/(authenticated)/events/[id]/EventAttendeesEditor.tsx`
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx`
- `src/app/(authenticated)/events/[id]/EventTicketSettings.test.tsx`
- `src/app/(authenticated)/events/[id]/EventTicketSettings.tsx`
- `src/app/(authenticated)/events/[id]/EventTicketTypesCard.tsx`
- `src/app/(authenticated)/events/[id]/page.tsx`
- `src/app/(authenticated)/events/_components/EventDrawer.tsx`
- `src/app/actions/__tests__/event-attendees.test.ts`
- `src/app/actions/__tests__/event-ticket-settings.test.ts`
- `src/app/actions/event-attendees.ts`
- `src/app/actions/event-ticket-settings.ts`
- `src/app/actions/eventTicketTypes.ts`
- `src/app/actions/events.ts`
- `src/app/api/event-bookings/route.ts`
- `src/app/api/events/[id]/booking-sheets/route.ts`
- `src/app/api/events/[id]/route.ts`
- `src/app/api/events/route.ts`
- `src/app/api/foh/events/route.ts`
- `src/lib/events/booking-questions.test.ts`
- `src/lib/events/booking-questions.ts`
- `src/lib/events/event-payments.ts`
- `src/lib/events/pricing.test.ts`
- `src/lib/events/pricing.ts`
- `src/lib/events/stats.ts`
- `src/lib/events/ticket-type-queries.ts`
- `src/lib/events/ticket-types.ts`
- `src/services/__tests__/event-bookings-dining-requests.test.ts`
- `src/services/__tests__/event-bookings.test.ts`
- `src/services/event-bookings.ts`
- `src/services/events.ts`
- `src/types/database.generated.ts`
- `src/types/database.ts`
- `supabase/migrations/20260910065400_ticket_setup_and_attendees.sql`
- `supabase/migrations/20260910073920_ticket_attendees_dining_requests.sql`
- `tasks/fix-function/2026-09-10-ticket-setup/verification.md`
- `tasks/ticket-setup/companion-migration-approval.md`
- `tasks/ticket-setup/deployment-verification.md`
- `tasks/ticket-setup/live-booking-functions.sql`
- `tasks/ticket-setup/migration-approval.md`
- `tasks/ticket-setup/production-catalogue-check.sql`
- `tasks/ticket-setup/production-smoke-extended.sql`
- `tasks/ticket-setup/production-smoke.sql`
- `tests/api/eventBookingGuestDetails.test.ts`
- `tests/lib/eventTicketPriceSnapshot.test.ts`

## Website changed files

- `app/api/event-bookings/__tests__/route.test.ts`
- `app/api/event-bookings/route.ts`
- `app/api/events/[id]/route.ts`
- `components/features/EventBooking/ManagementEventBookingForm.tsx`
- `lib/api/client.ts`
- `lib/api/events.ts`
- `lib/event-attendees.ts`
- `lib/event-booking-experience.ts`
- `tests/unit/ManagementEventBookingForm.test.tsx`
- `tests/unit/event-attendees.test.ts`

## Final CI evidence

- Management CI run `34452836517`: success, including coverage, UTC tests, production build and database contract. The optional production dry-run job was not enabled.
- Website CI run `34452848816`: success, including production build, unit tests, SEO regression and lint.
- Final runtime error inspection of both merged deployment IDs returned 1 error records in the last 20 minutes. The sole record is the same pre-existing July payment issue recorded above.
- No migrations remain unapplied for this ticket release.

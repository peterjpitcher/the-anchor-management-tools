# Ticket setup implementation and verification

Status: local only. Release packaged on `codex/ticket-setup-release` from current `origin/main` (`0c5b3cfe`). Nothing pushed, merged, applied to production or deployed.

Release preparation after owner approval: ticket changes are isolated from the shared dirty checkouts in `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools-ticket-release` (branch `codex/ticket-setup-release`) and `/tmp/anchor-website-ticket-release` (branch `codex/ticket-attendees-release`). The website local commit is `32e759fcb0a6bd7b7708d0d27373ffb80274a524`.

Latest management main includes atomic meal/early-arrival requests absent from the original feature checkout. An additional reviewed migration preserves those requests with named guests: `20260910075719_ticket_attendees_dining_requests.sql`, checksum `70d663e10124565c2900d592d2e57f424cecf80b9d772ca7e57ae84db79fbca8`. Its exact SQL/rollback packet is in the management release worktree at `tasks/ticket-setup/companion-migration-approval.md`. The original approved SQL is unchanged. Neither migration has been applied; the additional exact SQL needs owner approval before release.

Release verification on latest main: management 7,036 tests passed with two existing skips in both London and UTC; website 2,401 passed with one existing skip in both zones, with lint, types and cold build passed. The self-contained PostgreSQL harness now passes 60 checks. Independent integration review found no remaining defects. Live read-only anon baseline passes all nine checks. The final management cold build passed, including lint/type checks and all 155 static pages. The emitted server bundle was inspected to confirm the final combined-RPC error logger was compiled. Both release commits remain local.

## Delivered behaviour

Tickets is the full setup home for paid events. The drawer keeps ordinary creation quick and links paid events to Tickets. Full prices, online prices, London discount deadline and guest question configuration are together. Free entry remains the default; ordinary pay-on-arrival reservations do not ask for each person's details unless questions are explicitly configured.

Online-paid checkout collects a stable named guest for each ticket, separate from the purchaser, with configured required/optional text, yes/no or choice answers. The server validates current question rules before customer creation and the database repeats validation inside the booking transaction. Guests, question wording/rules and ticket prices are saved atomically. Price conflicts roll back the booking and refresh the form without losing guest drafts. Removed question IDs are excluded on retry. Equally priced ticket types remain separately selectable. An explicitly free ticket basket confirms without PayPal.

Staff can read and edit captured guest answers. Edits retain original question rules and mirror names to legacy booking and ticket-line fields. Answers are excluded from audit/analytics payloads and public event responses.

## Guarded limitations

- Existing seat-count and transfer shortcuts reject structured guest bookings. Cancel/rebook the affected booking instead; these shortcuts cannot silently truncate or misassign guest answers. A dedicated per-person amendment/refund flow is not implemented.
- Historical bookings retain their prior pricing interpretation because old line-item backfills can contain zero. No historical booking price is changed by the migration.
- Existing free and staff-created legacy bookings are not forced to supply new guest details. Existing legacy names-only editing remains available for them.
- Browser checks used the actual components with synthetic action/payment adapters. No live PayPal capture, real customer booking or production migration was attempted.
- The database harness uses actual booking wrappers with synthetic capacity/allocation helpers, not a complete production clone. Live post-apply permission and booking checks remain required.

## Verification

- Management lint and uncached TypeScript check passed (Node 20, 8GB TypeScript heap).
- Latest full management UTC suite: 739 files, 6,435 passed, 2 existing skips. Earlier full London suite: 6,420 passed; subsequent changed-path London and UTC checks passed.
- Latest full website UTC suite: 211 suites, 2,396 passed, 1 existing skip. Earlier full London suite: 2,393 passed; subsequent changed form London tests passed.
- Both final production builds passed in isolated fresh copies with no previous .next or TypeScript caches. The user's original build directories were left alone.
- Website full lint/audits and build type validation passed.
- PostgreSQL harness: 45 passing assertions, including rollback on price mismatch, required answers, snapshot preservation, free and pay-on-arrival flows, free prepaid baskets, retry isolation and restricted RPC grants.
- Browser: desktop Tickets showed Standard full price £45 and online price £40; added an allergy question, made it required and observed the fixture save confirmation. Mobile 390px checkout accepted two different guest names and answers with a separate purchaser, reached the fixture payment step, and showed the £80 total. Free checkout contained no attendee section. Browser viewport override reset afterwards.
- Independent risk review found mixed-ticket validation bypass, stale removed-question retry and staff answer-validation gaps. All three were corrected and covered by focused tests.

## Deployment order and approval

The schema and compatibility triggers must be applied before either app release. Then publish the management API/admin change, followed by the website checkout change. Ordinary free/pay-on-arrival flows remain compatible. The production migration approval packet contains the exact SQL/checksum, guarded repair, locks, forward-fix plan and post-apply checks. Packaging against current main also found the existing atomic dining request wrapper. The companion migration packet preserves this feature for bookings with guest answers; the original approved SQL is unchanged. The companion still needs exact approval.

Do not push this existing shared checkout wholesale. It contains substantial earlier uncommitted work and the current branch is behind its tracked remote. Package only this task's edits into an isolated release changeset, preserving the initial overlapping booking edits and all unrelated work.

## Management files changed

- [src/app/(authenticated)/events/_components/EventDrawer.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/_components/EventDrawer.tsx)
- [src/app/(authenticated)/events/[id]/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/page.tsx)
- [src/app/(authenticated)/events/[id]/EventDetailClient.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventDetailClient.tsx)
- [src/app/(authenticated)/events/[id]/EventTicketTypesCard.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventTicketTypesCard.tsx)
- [src/app/(authenticated)/events/[id]/EventTicketSettings.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventTicketSettings.tsx)
- [src/app/(authenticated)/events/[id]/EventTicketSettings.test.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventTicketSettings.test.tsx)
- [src/app/(authenticated)/events/[id]/EventAttendeesEditor.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/events/[id]/EventAttendeesEditor.tsx)
- [src/app/actions/eventTicketTypes.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/eventTicketTypes.ts)
- [src/app/actions/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/events.ts)
- [src/app/actions/event-ticket-settings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-ticket-settings.ts)
- [src/app/actions/event-attendees.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/event-attendees.ts)
- [src/app/actions/__tests__/event-ticket-settings.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/__tests__/event-ticket-settings.test.ts)
- [src/app/actions/__tests__/event-attendees.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/__tests__/event-attendees.test.ts)
- [src/app/api/event-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/event-bookings/route.ts)
- [src/app/api/events/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/route.ts)
- [src/app/api/events/[id]/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/[id]/route.ts)
- [src/app/api/events/[id]/booking-sheets/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/events/[id]/booking-sheets/route.ts)
- [src/app/api/foh/events/route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/foh/events/route.ts)
- [src/lib/events/booking-questions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/booking-questions.ts)
- [src/lib/events/booking-questions.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/booking-questions.test.ts)
- [src/lib/events/pricing.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/pricing.ts)
- [src/lib/events/pricing.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/pricing.test.ts)
- [src/lib/events/ticket-types.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/ticket-types.ts)
- [src/lib/events/ticket-type-queries.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/ticket-type-queries.ts)
- [src/lib/events/stats.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/stats.ts)
- [src/lib/events/event-payments.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/events/event-payments.ts)
- [src/services/events.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/events.ts)
- [src/services/event-bookings.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/event-bookings.ts)
- [src/services/__tests__/event-bookings.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/__tests__/event-bookings.test.ts)
- [src/types/database.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/types/database.ts)
- [tests/api/eventBookingGuestDetails.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/api/eventBookingGuestDetails.test.ts)
- [tests/lib/eventTicketPriceSnapshot.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/lib/eventTicketPriceSnapshot.test.ts)
- [supabase/migrations/20260910075712_ticket_setup_and_attendees.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260910075712_ticket_setup_and_attendees.sql)
- [scripts/testing/ticket-setup-postgres.py](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/scripts/testing/ticket-setup-postgres.py)

## Website files changed

- [components/features/EventBooking/ManagementEventBookingForm.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/components/features/EventBooking/ManagementEventBookingForm.tsx)
- [app/api/event-bookings/route.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/route.ts)
- [app/api/events/[id]/route.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/events/[id]/route.ts)
- [lib/api/client.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/client.ts)
- [lib/api/events.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/events.ts)
- [lib/event-booking-experience.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-booking-experience.ts)
- [lib/event-attendees.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/event-attendees.ts)
- [tests/unit/ManagementEventBookingForm.test.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/tests/unit/ManagementEventBookingForm.test.tsx)
- [tests/unit/event-attendees.test.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/tests/unit/event-attendees.test.ts)
- [app/api/event-bookings/__tests__/route.test.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/event-bookings/__tests__/route.test.ts)

## Deliberately preserved

All pre-existing unrelated marketing, private-booking, invoice, table-booking, receipt/design and other task changes remain untouched by this task. The initially dirty event booking API, booking service, payment helper and service tests retain their earlier standing-ticket changes already present on current main. The current main dining request fields, idempotency hashing, atomic wrapper and response flag are preserved. The existing dirty database.generated.ts was not replaced; regenerate it from the approved live schema after migration. Website pre-existing task documents were left alone. No historic migration was edited or removed.

Task records added/updated: this run directory, tasks/ticket-setup migration packet and live function baseline, and appended entries in tasks/todo.md and tasks/lessons.md. Temporary synthetic browser fixtures are in temp/ticket-preview and are not release code.

## Release packaging additions

- `supabase/migrations/20260910075719_ticket_attendees_dining_requests.sql`: additive combined guest/dining transaction wrapper, not applied.
- `src/services/__tests__/event-bookings-dining-requests.test.ts`: combined request forwarding and failure coverage.
- `scripts/testing/fixtures/ticket-setup-base.sql`: owned synthetic base schema, so the ticket harness no longer imports the unrelated standing-policy script.
- `tasks/ticket-setup/companion-migration-approval.md`: exact SQL, live-state findings, risk, validation and rollback.
- `tasks/ticket-setup/production-smoke.sql`: prepared guaranteed rollback production smoke with combined guest/dining coverage. Not run against production.

The release excludes all earlier dirty changes outside this task, and preserves current main additions through a three-way merge. Existing plain booking hashes remain unchanged when new guest and quote fields are absent. Structured booking fields participate in the hash when supplied. The existing main regression covers this compatibility.

Release integration verification on current main: full London and UTC suites each passed 780 files, 7,036 tests, with two existing skips. The standalone PostgreSQL harness passed all 60 assertions. Final lint and uncached type validation passed before the cold build; the build also checks final types. Read-only live anon baseline passed all nine assertions. The original development-checkout counts above remain historical evidence only.

Final release cold build completed successfully. Final standalone lint passed. Both SQL checksums were rechecked unchanged. No production migration, live booking, payment, message, push or deployment was performed.

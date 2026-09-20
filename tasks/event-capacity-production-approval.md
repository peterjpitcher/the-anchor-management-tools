# Event capacity production approval packet

Status: implemented and validated locally on `codex/event-physical-capacity`. No production writes, deployment, customer messages or payment calls have been made.

## Exact production change

Project: **the-anchor-management-tools**, Supabase ref **tfcasgxopxegwrabvwat**, database host `db.tfcasgxopxegwrabvwat.supabase.co`. Verified against the repository project reference and connected project metadata. Production PostgreSQL is version 15; isolated tests used PostgreSQL 17.

Migration name: **event_physical_capacity**.

Exact SQL: [20260920200647_event_physical_capacity.sql](../supabase/migrations/20260920200647_event_physical_capacity.sql).

SHA-256: `5ab02eb13c5716e507057671f8da9710f4be129d65c6e3ba287b35fb733b8283`.

Exact rollback SQL: [event-capacity-rollback.sql](event-capacity-rollback.sql).

Rollback SHA-256: `73294e9fb81e5d8caca22fcf91726c15da5f02d572e074d3d889b0f702f6e493`.

[Database validation and complete eight-event change table](event-capacity-validation.md) records the live schema checks, affected objects, grants, row estimates, test output and rollback limits. The exact SQL above is the approval scope, not a future revised draft.

## Resulting behaviour

Table events use physical tables, communal events use physical seats plus an explicit standing ticket allowance, and general admission retains its numeric ticket limit. Mixed is removed from new-event choices; existing mixed events remain supported as table bookings. New communal events start at zero standing tickets. Guest standing becomes available only once seated places are exhausted, and no seated request silently becomes standing.

Existing booking, allocation and payment rows are not migrated. Existing manually smaller seated limits remain in force and read-only for compatibility. Eight upcoming communal events get their current inferred standing allowance made explicit: seven keep 11 standing tickets; the Christmas tasting keeps zero. The full list is in the linked validation record. These figures preserve current system availability; they are not a new assessment of venue occupancy or standing space.

## Risks and mitigations

High-risk statements are twelve SECURITY DEFINER function replacements, two new SECURITY DEFINER helpers, explicit grant/revoke statements, one event-update trigger, and the eight-row standing-capacity backfill. Signatures, existing role access and pinned search paths are preserved. No persistent table, column, view, policy or index is added or removed.

The backfill locks eight event rows. Trigger creation briefly locks events; lock acquisition is limited to five seconds. Existing booking-table rows are not explicitly locked. The whole migration must run atomically through Supabase apply_migration. A row or inferred-standing mismatch aborts rather than silently adapting the approved values. The migration hashes every pre-existing row in seven booking/payment/allocation tables and aborts on any changed or missing row. Legitimate concurrent edits may therefore cause an abort and retry; new rows are ignored. No customer data is printed.

The older app remains compatible with the preserved RPC signatures while application deployment follows. Application changes depend on the migration for atomic split-capacity saves, so production database changes must precede the application merge/deployment.

An outstanding waitlist offer still counts covers rather than reserving specific tables across events and ordinary bookings. It can lose suitable space before acceptance. Acceptance rechecks and allocates atomically; failure leaves the offer/token/hold intact and creates no seatless booking. Guaranteed physical offer reservations are outside this change.

## Verification performed

- Full application tests passed in Europe/London: 1,012 files, 9,890 passed, two skipped at that run.
- Full application tests passed in UTC: 1,012 files, 9,892 passed, two skipped at that run.
- After subsequent review fixes, all 188 focused tests passed across 11 files.
- Whole-project ESLint, TypeScript and the final production build passed. The CSS optimiser emitted a wildcard-token warning; the build still exited successfully. No affected control failed the rendered browser checks.
- Actual EventDrawer and design-system components passed isolated Chromium interactions on desktop and mobile, including mode choices, standing defaults and unchanged legacy save payloads.
- The isolated PostgreSQL suite passed migration, rollback, existing-record preservation, deliberately harmful trigger injection, full-window table fit, joined tables, holds, amendments, standing, waitlist acceptance and all four table/communal concurrency combinations.

The database suite substitutes the unrelated ordinary table-booking core, private-domain selector and ticket-price calculation helper. It is not a full production database clone. Browser actions were isolated from production. No live booking was submitted, no SMS/email sent and no payment charged. Full signed-in route and deployment checks remain pending production approval.

## Rollback and post-apply plan

Recheck production identity, exact SQL hashes, original live definitions and the eight expected allowances immediately before apply. If any differ, stop and refresh the approval packet. Apply through Supabase MCP only and record its actual history version.

After apply, inspect replaced functions, signatures, grants and search paths; confirm the migration history; run the read-only anon-surface guard and event capacity snapshots; verify existing booking relationships and preserved fields. Do not create customer bookings or send messages as smoke tests.

Commit and publish the reviewed application branch, complete required CI checks and merge to the confirmed production branch. Verify the exact commit reaches a Ready Vercel deployment and `management.orangejelly.co.uk` points to that same deployment ID. Check actual /events list/detail/editor controls and public event responses without submitting production bookings. Review bounded runtime errors. Only then report production deployment status.

If deployment fails after database application, the old app remains compatible while the deployment is repaired. If database behaviour regresses, apply the reviewed rollback SQL as a recorded migration and restore the previous application commit as appropriate. The rollback verifies the fixed standing values have not since been edited; it restores original definitions and configuration without deleting bookings created after release. Do not force a rollback past that guard or overwrite later owner edits.

## Files changed

- `tasks/event-capacity-production-approval.md`
- `scripts/testing/event-capacity-browser.mjs`
- `src/app/(authenticated)/events/[id]/EventDetailClient.tsx`
- `src/app/(authenticated)/events/_components/EventDrawer.tsx`
- `src/app/(authenticated)/events/_components/EventListView.tsx`
- `src/app/(authenticated)/events/_components/__tests__/EventDrawer.test.tsx`
- `src/app/actions/events.ts`
- `src/app/api/events/[id]/route.ts`
- `src/app/api/events/route.ts`
- `src/lib/event-seo/__tests__/generation.test.ts`
- `src/lib/event-seo/generation.ts`
- `src/lib/events/capacity.test.ts`
- `src/lib/events/capacity.ts`
- `src/lib/events/stats.test.ts`
- `src/lib/events/stats.ts`
- `src/lib/insights/sections/events.ts`
- `src/services/__tests__/event-bookings.test.ts`
- `src/services/event-bookings.ts`
- `src/services/events.ts`
- `src/types/database.ts`
- `supabase/migrations/20260920200647_event_physical_capacity.sql`
- `tasks/event-capacity-rollback.sql`
- `tasks/event-capacity-validation.md`
- `tasks/plan-2026-09-20-event-physical-capacity.md`
- `tests/api/eventsDetailRouteResilience.test.ts`
- `tests/api/eventsPhysicalCapacity.test.ts`
- `tests/database/event-physical-capacity/assertions.sql`
- `tests/database/event-physical-capacity/concurrency.py`
- `tests/database/event-physical-capacity/preservation-negative.sql`
- `tests/database/event-physical-capacity/rollback-assertions.sql`
- `tests/database/event-physical-capacity/run.sh`
- `tests/database/event-physical-capacity/setup.sql`
- `tests/lib/insights/sections/events.test.ts`
- `tests/services/event-capacity-editing.test.ts`
- `tests/services/events-link-clicks.test.ts`

## Deliberately unchanged

- The original working checkout and its unrelated mileage/task edits.
- All existing production booking, payment, customer, hold and seat-allocation records.
- The website repository: its existing seated/standing booking UI consumes the corrected event API contract.
- Ordinary table-booking core, private-booking rules, payment integrations and customer communication templates.
- Existing event rescheduling behaviour and historical Mixed records.
- Venue occupancy and standing-space limits; no new venue limit has been invented.

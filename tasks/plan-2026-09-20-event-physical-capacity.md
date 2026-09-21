# Event physical capacity implementation

Approved scope: event table capacity comes from physical tables; communal seats come from physical seating with explicit standing allowance (default zero); general admission keeps a ticket limit; Mixed is no longer offered for new events. Standing is offered only when seated availability is zero, without silently changing a seated request. Preserve all existing bookings, payments and allocations.

Existing event totals remain stored for history. Existing deliberately smaller communal seated limits remain read-only during this compatibility release. Existing inferred standing allowances are frozen once, subject to the exact migration approval, rather than being increased as seating disappears. No customer communications are part of deployment.

Work is isolated in codex/event-physical-capacity. Complexity L: database foundation first, application consumers second. UI/validation and database work have disjoint owners; integration owns availability consumers and release verification.

- [x] Capture current live functions, schema dependencies, grants and existing booking invariants.
- [x] Draft physical availability migration and exact rollback, preserving existing booking records.
- [x] Execute migration and rollback on an isolated local database with representative bookings, holds and conflicts.
- [x] Update event editor, validation and defaults; protect mode changes with active bookings.
- [x] Use resolved capacity in staff displays and public event responses, with no static-capacity fallback on errors.
- [x] Verify staff/guest creation, amendments, standing restrictions, cancellations, expiry and concurrent capacity claims in isolated tests.
- [x] Review combined diff, run lint, types, tests and production build.
- [x] Prepare exact migration SQL/checksum and rollback packet for required production approval.
- [ ] Apply approved migration, merge/push application, verify deployment identity and actual event screens, compare existing booking invariants.

Production migration approval is required by the project prod-migrate skill. No production SQL will be applied until that exact packet is approved. Deployment is authorised by the user once prerequisites are complete.

## Verification and bounded scope

The full application suite passed in Europe/London and UTC. The final 188 focused tests, TypeScript, lint, production build, isolated Chromium drawer checks and isolated PostgreSQL migration/rollback checks passed. SQL concurrency checks covered communal/communal, table/communal, communal/table and table/table requests. Existing booking, payment and allocation fixtures remained unchanged; a deliberately harmful fixture trigger proved the preservation guard aborts the whole migration.

Waitlist acceptance now uses physical allocation and cannot confirm a seatless booking. An outstanding waitlist offer remains a covers-only hold, not a guaranteed reservation of specific tables across other bookings/events. Guaranteed physical offer inventory would require a separate design; it is not introduced here. This limitation must remain visible in production approval.

Browser testing used actual production components with isolated action boundaries, not signed-in Next routes. Live route smoke testing is pending production migration approval and deployment. Tests do not charge PayPal or send customer communications.

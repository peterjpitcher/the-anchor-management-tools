# Build — Table booking & customer comms (2026-07-11)

Branch note: working tree has unrelated parallel-session changes (recruitment/vendor). Touch ONLY table-booking + customer-comms files. Do not stash/switch. Stage explicit files only when committing (with approval).

## Issue 2 — Email a customer from /customers/[id]
- [x] New server action `sendCustomerEmail(customerId, subject, body)` in `src/app/actions/customerEmailActions.ts` (permission + audit, uses existing `sendEmail`, auto-logs to email_messages)
- [x] "Email customer" button + "Email {name}" modal on the customer page (shown when email on file + messaging permission)
- [x] 4 unit tests

## Issue 1 — Capture email when adding a table booking
- [x] Email input on `FohCreateBookingModal` (shared FOH/BOH modal)
- [x] Threaded through `useFohCreateBooking` POST body (food/drinks + event)
- [x] `email` added to Zod schema in both `/api/foh/bookings` and `/api/foh/event-bookings`; passed to `ensureCustomerForPhone`; existing-customer backfill + walk-in insert (unique-index safe)
- [x] 3 unit tests

## Issue 3 — Reschedule confirmation (SMS + email)
- [x] New helper `sendTableBookingRescheduledNotificationIfAllowed` in `lib/table-bookings/bookings.ts` — re-reads booking fresh, dispatches via `notifyCustomer({ policy: 'email_first' })` (one message on best channel), audits, never rethrows
- [x] Dedicated `buildTableBookingRescheduledEmail` + `template_key: 'table_booking_rescheduled'`
- [x] Wired into BOH edit route — fires on real date/time/duration change (normalised comparison, NOT on metadata-only edits)
- [x] Wired into FOH drag time route — fires only when time actually changes
- [x] move-table (internal reassignment) + party-size deliberately NOT wired
- [x] 4 wiring tests (2 BOH, 2 FOH)

## Verify
- [x] lint (changed files, --max-warnings=0): clean
- [x] typecheck (`tsc --noEmit`, whole project): exit 0
- [x] tests: 12 feature + 278 api tests pass, no regressions
- [x] build (`npm run build`): exit 0

## Review notes
- Parallel session was live throughout (recruitment/employee/vendor + music-bingo migrations). Touched ONLY table-booking + customer-comms files. NOT committed — awaiting owner go-ahead; when committing, stage explicit files only.
- Reschedule uses the same `notifyCustomer` dual-channel dispatch, opt-in/suppression/rate-limit guards as the create-confirmation, so it's consistent (incl. walk-ins).
- Notification helper swallows all errors — a send failure can never fail the edit/move.

---

# UI component standardisation — implementation batch 1 (2026-07-15)

Complexity: 5/5, split into independently deployable batches. This batch does not touch the unrelated SMS files already modified in the worktree.

## Shared foundations
- [x] Add canonical `RowActions` with icon and overflow-menu modes
- [x] Add canonical `FormSubmitButton` using `useFormStatus`
- [x] Add canonical `DescriptionList`
- [x] Export the new components from `@/ds`
- [x] Add behaviour and accessibility tests

## Safe cleanup
- [x] Point invoice and user tests at the live components
- [x] Delete the stale invoice client and user-list implementations
- [x] Delete the unused temporary spinner file
- [x] Remove the unused private toast renderer while keeping the canonical `toast` API

## Proving section: OJ Projects
- [x] Standardise row actions across overview, clients, projects, entries and work types
- [x] Give every actionable list an intentional mobile layout
- [x] Verify keyboard labels and destructive confirmations

## Verification
- [x] `npm run lint`
- [x] `npx tsc --noEmit`
- [x] `npm test`
- [x] cold `npm run build`
- [x] signed-in production baseline checks at 320, 375, 768 and 1280px
- [ ] browser-check this changed build after it is deployed

## Review notes
- Added one row-action policy: one or two actions are labelled icon buttons; three or more actions use one menu; destructive actions are last and use the danger treatment.
- OJ Projects tables now switch to deliberate card lists below the desktop breakpoint rather than relying on horizontal scrolling.
- Button touch targets are at least 44px on mobile through the shared `Button` primitive.
- Production still showed horizontally scrolling tables on Overview, Projects, Clients and Work Types; Entries already used mobile cards. This confirms the local replacement scope but is not a visual check of the undeployed changes.
- The live mobile check also found 42px inputs and small invoice links. The shared mobile input token is now 44px and entry invoice links use the shared touch-target rule.
- The shared `Switch` now keeps its compact visual track inside a 44px mobile tap target, improving all 16 production uses.
- Full result: 532 test files and 3,631 tests passed; lint, TypeScript and the production build passed.
- Build must use the supported Node 20–22 range and an 8 GB heap on this codebase. The default Node 26 shell stalled, and the normal 4 GB Node 22 heap was insufficient.

---

# UI component standardisation — compatibility batch 2 (2026-07-15)

## Canonical aliases and removals
- [x] Make all legacy `FormGroup` instances render the canonical `Field`
- [x] Make all legacy `EmptyState` instances render the canonical `Empty`
- [x] Move legacy empty-state icons onto the DS icon registry
- [x] Replace the final `Toggle` consumers with `Switch` and remove `Toggle`
- [x] Replace the final `ConfirmModal` consumers with `ConfirmDialog` and remove `ConfirmModal`
- [x] Remove eight unused private compatibility helpers and local SVG components
- [x] Add regression tests proving the legacy names resolve to the canonical implementations

## Result
- [x] Reduce detected production component declarations from the 690 baseline to 671
- [x] Reduce compatibility implementations from 32 to 16
- [x] Full verification: lint, TypeScript, 534 test files / 3,635 tests, and cold production build
- [ ] Migrate the remaining 16 compatibility implementations and remove the public compatibility barrel

---

# Table-booking print sheets (one A4 page per booking)

> **Superseded — see the spec.** The authoritative, implementation-ready spec is
> [`tasks/table-booking-print-sheets-spec.md`](table-booking-print-sheets-spec.md),
> with the review response at
> [`tasks/table-booking-print-sheets-spec-review-response.md`](table-booking-print-sheets-spec-review-response.md).
> The earlier discovery plan that used to live here (full-page navigation, empty-day
> PDF, DS button, sort-by-table) was **wrong on four points** and has been removed to
> avoid conflicting instructions. Build from the spec only.

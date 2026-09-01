# Developer review: FOH change booking time specification

Review date: 2026-09-01  
Reviewed document: `tasks/foh-change-booking-time-spec-2026-09-01.md`  
Audience: developer, product owner, and release owner  
Original specification changed: no

## 1. Overall assessment

**Readiness: Not ready for implementation.**

The discovery work is useful and the large-tile picker is a good direction, but the
specification has material product and data-integrity gaps. The most serious issue
is that the existing time endpoint does not preserve the guest booking duration
when table turnaround time is enabled. It derives duration from the table assignment,
which includes the turnaround hold, and then writes that longer end time back to the
booking row. Reusing the endpoint more widely would increase the effect of that defect.

The specification also combines two different jobs:

1. A guest-requested reschedule, which should usually notify the guest and move the
   booking and its resources.
2. An internal floor delay, which should not rewrite the guest's agreed booking time
   or move an already seated party's resource window.

Those jobs need to be separated or the first release needs to support only the first.
The release is also blocked by unresolved notification behaviour, missing server-side
state guards, event-linked booking handling, and an availability/error contract that
cannot be delivered through the proposed shared action helper as written.

### Readiness score

| Area | Rating | Summary |
|---|---:|---|
| Product behaviour | 2/5 | Main use cases are mixed together; notification and seated behaviour are unresolved. |
| Functional detail | 2/5 | Important state, time-boundary, stale-data, and error journeys are missing. |
| Data correctness | 1/5 | Existing endpoint confuses guest duration and table occupancy duration. |
| Security and permissions | 3/5 | Authentication and edit permission exist, but business-state enforcement is client-only. |
| Accessibility | 2/5 | Touch size is considered, but keyboard, screen-reader, focus, and error requirements are not. |
| Delivery and operations | 2/5 | Test commands exist, but migration, rollout, monitoring, and realistic effort are incomplete. |

### Review evidence

The review checked the current specification against the FOH schedule UI, schedule
API, time and move-table routes, booking/assignment database functions, notification
helper, audit service, modal primitive, realtime reload path, and current tests.

The stated test baseline was reproduced:

```text
8 test files passed
55 tests passed
```

That baseline proves the current tests pass. It does not cover most of the behaviour
proposed in this specification.

## 2. Priority and status meanings

- **P0:** Must be resolved before implementation starts or before the endpoint is reused.
- **P1:** Must be resolved before release.
- **P2:** Should be resolved for a reliable release; may be a closely tracked follow-up only with explicit acceptance.
- **P3:** Low-risk future hardening.
- **Confirmed issue:** A gap, contradiction, or risk confirmed in the specification or current code.
- **Optional improvement:** A non-blocking way to simplify, improve, or future-proof the change.

## 3. Finding summary

| ID | Status | Priority | Type | Finding |
|---|---|---:|---|---|
| F01 | Confirmed issue | P0 | Data correctness | The endpoint does not preserve guest duration when turnaround time is enabled |
| F02 | Confirmed issue | P0 | Product / data model | Guest rescheduling and internal floor delay are mixed together |
| F03 | Confirmed issue | P0 | Integration | Event-linked table bookings are not safely excluded |
| F04 | Confirmed issue | P0 | API / business rules | Eligible booking states are not defined or enforced by the server |
| F05 | Confirmed issue | P0 | Notification | Notification policy is unresolved and can send inaccurate copy |
| F06 | Confirmed issue | P1 | UX / safety | Immediate apply conflicts with notification and undo claims |
| F07 | Confirmed issue | P1 | Error handling | The proposed 409 journey cannot use `runAction` unchanged |
| F08 | Confirmed issue | P1 | Data / availability | The schedule payload is not always a complete view of database conflicts |
| F09 | Confirmed issue | P1 | Data / multi-table | Client and server do not share one authoritative multi-table window |
| F10 | Confirmed issue | P1 | API / validation | Service-window restrictions are client-only |
| F11 | Confirmed issue | P1 | Functional requirement | The last valid arrival time is ambiguous |
| F12 | Confirmed issue | P1 | Functional requirement | Past and historical time changes are undefined |
| F13 | Confirmed issue | P1 | Functional detail | Slot and conflict calculation rules are incomplete |
| F14 | Confirmed issue | P1 | Concurrency | Same-booking races and realtime changes can overwrite newer work |
| F15 | Confirmed issue | P1 | Resource side effects | High-chair and outside-capacity effects are missing from the UX and contract |
| F16 | Confirmed issue | P1 | Audit / security | A shared kiosk audit cannot identify the staff member |
| F17 | Confirmed issue | P1 | Reliability / performance | Synchronous notification creates slow and uncertain outcomes |
| F18 | Confirmed issue | P1 | API contract | Validation and response behaviour are incomplete |
| F19 | Confirmed issue | P1 | Testing | The test plan does not cover the main risks |
| F20 | Confirmed issue | P0 | Delivery / migration | “No migration” and the effort estimate are not credible after the duration finding |
| F21 | Confirmed issue | P2 | Scope / regression | Touch-drag changes are separate scope and not near-zero risk |
| F22 | Confirmed issue | P2 | Accessibility | Accessibility requirements stop at touch-target size |
| F23 | Confirmed issue | P1 | Error handling | Offline, session expiry, refresh failure, and uncertain success are unspecified |
| F24 | Confirmed issue | P2 | Monitoring | Release monitoring and operational measures are missing |
| F25 | Confirmed issue | P1 | Delivery | There are no complete, testable acceptance criteria |
| F26 | Optional improvement | P2 | Wording / usability | Use “Current booking time” instead of “Now” |
| F27 | Optional improvement | P2 | Scope simplification | Keep the first release to guest-requested rescheduling |
| F28 | Optional improvement | P3 | Time handling | Replace the cross-midnight guard with an explicit timestamp contract when needed |
| F29 | Optional improvement | P2 | Architecture | Consider server-produced availability instead of duplicating database rules in the browser |
| F30 | Optional improvement | P2 | Rollout | Use a short kiosk canary before general release |

## 4. Detailed findings

### F01. The endpoint does not preserve guest duration when turnaround time is enabled

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Data correctness / database integration
- **Relevant section:** 2, “What already works”; 3.2, “The Change time modal”; 5, “Files”
- **Description:** The claim that `PATCH /api/foh/bookings/[id]/time` preserves duration is not correct for indoor bookings when turnaround time is enabled. Creation deliberately stores two different end times: `table_bookings.end_datetime` is the guest booking end, while `booking_table_assignments.end_datetime` includes the extra turnaround hold. The time route reads the assignment window, calculates one duration from it, and passes one new end time to `move_table_booking_time_v05`. That function writes the same end time to both the assignment rows and the booking row.
- **Rationale:** `create_table_booking_v06` calculates `v_booking_end` and a later `v_occupancy_end`; it writes the first to `table_bookings` and the second to assignments. The current time route takes the assignment's later end and the RPC writes it back to both records. A 105-minute guest booking with a 15-minute turnaround therefore becomes a 120-minute booking row after a move, while `duration_minutes` remains 105. This also changes resource and reporting semantics.
- **Impact:** Guest and assignment data become inconsistent. Reporting, later edits, notifications, high-chair windows, and future availability can use the wrong end time. Wider FOH use would increase the number of affected records.
- **Recommended action:** Fix the backend before building the new UI. Introduce an atomic RPC that accepts distinct `p_booking_end_datetime` and `p_assignment_end_datetime`, or another transaction-safe design that preserves both windows. Load and validate `duration_minutes` from the booking row, derive the assignment hold separately, and return both final windows. Add a migration and database integration tests. Suggested replacement for section 2: “The endpoint is conflict-safe, but its duration handling must be corrected before reuse because assignment windows may include turnaround time.”
- **Open questions:** Is turnaround time enabled in production now? Are any existing bookings already inconsistent after drag moves? Should a repair query be prepared for affected rows?

### F02. Guest rescheduling and internal floor delay are mixed together

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Product behaviour / data model
- **Relevant section:** 3.2, “Quick nudge row”; 3.4, “The guest notification”
- **Description:** The specification uses one mutation for a guest-requested reschedule and for an internal delay while a guest waits at the bar. These actions have different meanings. A reschedule changes the guest's agreed time and resource window. An internal delay records an operational problem and should not silently rewrite the original promise.
- **Rationale:** Allowing a seated booking to move to a later start can produce a start time after `seated_at`, move its table hold away from a table it is already using, change punctuality/reporting data, and make the current table appear free. Suppressing a message does not fix those data problems.
- **Impact:** The timeline can become operationally unsafe, reporting can be misleading, and staff may double-book a table occupied by an already seated party.
- **Recommended action:** Decide which job this release solves. The safest first release is “guest requested a new arrival time” for unseated, active table bookings only. If internal delay tracking is required, specify a separate field/action such as expected seating time or delay status that does not rewrite the confirmed booking window.
- **Open questions:** Is “running late” the guest running late, or the venue running late? Should already seated bookings ever be rescheduled? What report should retain the original promised time?

### F03. Event-linked table bookings are not safely excluded

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Integration / data integrity
- **Relevant section:** 3.1, “Entry point”; 5, “Files”
- **Description:** The stated `!isEventOnly` condition only clearly excludes synthetic communal and standing blocks in the current UI. A real `table_bookings` row linked to an event has a normal UUID and is rendered with derived event labels, but the schedule response does not expose `event_id` and the time route does not guard it.
- **Rationale:** Event table reservations are linked to a separate event booking and event start. Moving only the table booking time can separate the table reservation from the ticketed event and leave the linked event booking unchanged.
- **Impact:** Event capacity, guest communication, table allocation, and attendee data can disagree.
- **Recommended action:** Explicitly define event-linked bookings as eligible or ineligible. The recommended safe rule is to exclude every booking with `event_id` or `event_booking_id` until an event-aware reschedule flow exists. Return a clear eligibility field in the schedule payload and enforce the same rule in the server transaction.
- **Open questions:** Are staff expected to move the arrival time for event diners independently of the event? If yes, which event records and notifications must also change?

### F04. Eligible booking states are not defined or enforced by the server

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** API / business rules / security defence-in-depth
- **Relevant section:** 3.1; 3.3, “Liveness filter”; 3.4
- **Description:** The UI rule mentions `cancelled`, `no_show`, and `completed`, but the current endpoint does not load or validate status at all. The rule also omits `left_at`, expired unpaid holds, and review-related statuses that can still appear on the schedule. `left_at` can be set without changing the raw status, so checking only `status` is insufficient.
- **Rationale:** Client-side disabled buttons are not a business-rule boundary. An authenticated editor, stale client, or direct request can still mutate an ineligible booking. The liveness predicate says whether a booking holds resources; it is not automatically the same as whether staff may edit it.
- **Impact:** Departed, expired, cancelled, event-linked, or otherwise closed bookings can be rewritten. The notification helper may also message some of them because it checks only a limited status list.
- **Recommended action:** Define a server-side eligibility whitelist, not only a blacklist. Load `status`, `seated_at`, `left_at`, `hold_expires_at`, `payment_status`, and event linkage and enforce the decision atomically with the move. Return 409 with a stable error code and current booking snapshot when state changed.
- **Open questions:** Are `pending_payment` bookings eligible? What about an expired unpaid hold, a seated booking, or `visited_waiting_for_review`? Should managers have an override distinct from normal FOH edit permission?

### F05. Notification policy is unresolved and can send inaccurate copy

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Notification / product decision
- **Relevant section:** 3.4; 5, time route changes
- **Description:** The specification explicitly leaves notification behaviour undecided. The current helper returns no delivery result and sends copy saying the booking is “still confirmed” for any non-terminal status, including `pending_payment`. It does not check `seated_at` or `left_at` itself.
- **Rationale:** A checkbox cannot be implemented safely until the server contract defines who may suppress a transactional message, what the default is, how seated state is evaluated, and what the UI says when there is no deliverable channel. Client state can be stale and must not be the authority for seated suppression.
- **Impact:** Guests may receive alarming or false messages, staff may assume a notification was sent when it was not, and direct API calls may bypass intended suppression rules.
- **Recommended action:** Resolve this before coding. Add a strict boolean such as `notify_guest`, with a documented backwards-compatible default for the existing drag caller. Enforce forced suppression or rejection server-side based on the final eligibility rule. Change notification copy for non-confirmed states or exclude those states. Return `notification: requested | suppressed | sent | no_channel | failed` if the helper can support it, and audit the request and result separately.
- **Open questions:** Is the default checked? Can staff untick it for any unseated booking? Is it always off for seated bookings? Should pending-payment bookings be moved or notified? Does “email first and SMS fallback” meet the business expectation?

### F06. Immediate apply conflicts with notification and undo claims

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** UX / safety
- **Relevant section:** 3.2, “Tapping a time applies it immediately”
- **Description:** The no-confirmation rationale is borrowed from Move table, but the operations are not equivalent. Move table notifies nobody. A time change can message a guest, change resource windows, clamp high chairs, and affect reporting. The existing drag-time path also uses a confirmation modal, contrary to the stated consistency claim.
- **Rationale:** A notification cannot be undone by tapping the original time. The original slot may also become unavailable before the attempted undo.
- **Impact:** A single accidental tap can cause an external message and a hard-to-reverse operational change.
- **Recommended action:** Use an explicit “Change time” action after slot selection, with the notification choice visible beside it. If one-tap apply is retained, notification should not be sent in the same unconfirmed tap and the accepted risk must be stated. Suggested wording: “Selecting a slot shows the proposed new time. Tap Change time to apply it.”
- **Open questions:** Is the speed benefit of one tap worth the external-message risk? Should only quick nudges be one tap, or should all choices behave the same?

### F07. The proposed 409 journey cannot use `runAction` unchanged

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / UI architecture
- **Relevant section:** 3.3, “Staleness is handled”; 5, `FohScheduleClient.tsx`
- **Description:** The specification requires a 409 to keep the time modal open, show the endpoint message inside the flow, refresh the schedule, and re-mark the grid. The existing `runAction` catches the error, writes a page-level error, does not reload after failure, and only returns `false`. A modal can remain open, but it has no error result to render. The page header error may be hidden behind the modal.
- **Rationale:** The proposed behaviour needs the status code and payload, plus a refresh after conflict. `runAction` currently hides those details. It also treats a schedule reload failure after a successful mutation as an overall action failure.
- **Impact:** Staff may see no useful conflict message, the grid stays stale, and retries can repeat a move that already succeeded.
- **Recommended action:** Define a dedicated submit result or extend the helper to return typed mutation and refresh outcomes. The time modal needs local error/loading state, 409-specific reload, and a separate message for “time changed, but the refreshed schedule could not load.” Do not claim the existing helper can be reused unchanged.
- **Open questions:** Should `runAction` be generalised for all FOH actions, or should this flow use a focused hook? Where should errors be announced to screen readers?

### F08. The schedule payload is not always a complete view of database conflicts

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / availability / resilience
- **Relevant section:** 3.3, “Availability: compute it client-side”
- **Description:** The assertion that the schedule carries everything needed is too strong. The schedule exposes only assignments to currently visible, bookable tables. A booking assigned only to a hidden or now-unbookable table is presented as unassigned and does not include its real assignment IDs, while the endpoint still updates those assignment rows. Communal query failures are converted to an empty set, private mapping failures can silently omit blocks, and service-hours failures or closed days can fall back to 09:00–23:00.
- **Rationale:** The database trigger remains a safe backstop, but the browser grid can knowingly present blocked times as free or use invented fallback hours. “No table” is not equivalent to “no visible lane.”
- **Impact:** More failed taps, misleading availability, possible moves outside real hours, and poor recovery when schedule data is incomplete.
- **Recommended action:** Either use server-produced availability or strengthen the schedule contract. Include all real assigned table IDs, an explicit `has_hidden_assignments`, service-window validity/closed state, and completeness flags for private and communal blocks. Disable time changes when authoritative availability data is incomplete, or clearly fall back to server validation on selection.
- **Open questions:** Should a booking on a hidden table be editable from FOH? Is fallback service time acceptable for viewing only, but not for mutation? What should happen if one supporting schedule query fails?

### F09. Client and server do not share one authoritative multi-table window

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Data / multi-table bookings
- **Relevant section:** 3.3; 5, `utils.ts`
- **Description:** Each lane copy of a multi-table booking receives the window of that lane's assignment. The time endpoint instead uses the earliest start and latest end across all assignment rows. The specification does not say which client value determines candidate duration or how different assignment windows are handled.
- **Rationale:** If assignment rows differ because of old data or a partial previous operation, the browser can mark a slot free using a shorter window while the server moves a longer aggregate window and returns 409.
- **Impact:** Incorrect disabled states, confusing conflicts, and inconsistent duration display for joined tables.
- **Recommended action:** Return one authoritative booking window and one authoritative occupancy window with every booking, independent of the clicked lane. Validate that joined assignments share the expected window. Treat inconsistent assignment windows as an error requiring repair rather than silently stretching duration from earliest to latest.
- **Open questions:** Is equality of joined-table assignment windows a database invariant today? If it is not, should the new RPC repair or reject inconsistent rows?

### F10. Service-window restrictions are client-only

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** API validation / business rules
- **Relevant section:** 3.2; 4, out-of-scope rules
- **Description:** The route accepts any valid `HH:MM`. The UI intends to show only service-window slots, but a direct or stale request can move a booking to 03:00. The database RPC enforces table conflicts, not pub opening hours.
- **Rationale:** The specification excludes kitchen pacing and cut-off revalidation, but it does not clearly exclude basic pub service-hour validation. A browser-only limit is not authoritative.
- **Impact:** Invalid booking times can be stored through the authenticated endpoint.
- **Recommended action:** State the intended server rule. Recommended: enforce that the arrival time is inside the effective pub service window, including special hours, while deliberately bypassing kitchen pacing and online cut-off rules. If managers may override hours, make that an explicit permission and audited override rather than an accidental API capability.
- **Open questions:** Are moves on closed days allowed? Can a manager move a food booking outside kitchen hours? Is the special-hours configuration authoritative for staff moves?

### F11. The last valid arrival time is ambiguous

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional requirement / time bounds
- **Relevant section:** 3.2, “Full grid”; 4, kitchen cut-off out of scope
- **Description:** The specification says to show all slots across the service window, but also says not to render a slot when the booking's duration runs past the end of the timeline. Creation validates arrival time and can allow a booking whose guest duration extends after closing. The timeline itself includes padding beyond the service close.
- **Rationale:** “Service end,” “timeline end,” “guest booking end,” and “table occupancy end” are different boundaries. The current wording can produce different implementations.
- **Impact:** Valid late arrivals may disappear, or invalid late moves may be allowed, depending on the developer's interpretation.
- **Recommended action:** Define one rule with examples. A likely rule is: candidate start must be in the effective staff arrival window; the full occupancy window is used for table conflicts; it does not need to finish before pub close unless the product owner explicitly wants that new restriction.
- **Open questions:** Should a 21:30 booking be offered when the pub closes at 22:00? Should food use kitchen close while drinks use pub close, despite the out-of-scope statement?

### F12. Past and historical time changes are undefined

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional requirement / edge case
- **Relevant section:** 3.2; 4
- **Description:** The grid includes the whole service window and the FOH page can show other dates. The specification does not say whether staff can move today's booking into the past, edit a past service date, or restore an original time that is now earlier than the current clock.
- **Rationale:** Creation rejects past times, but a floor correction may legitimately need to record an earlier actual time. Those are different business actions and need an explicit rule.
- **Impact:** Developers may block valid corrections or permit historical data rewrites without an audit distinction.
- **Recommended action:** Define date and clock rules. Recommended for the first release: allow active future or same-day unseated bookings; do not allow a new start earlier than the current time, except through a separate audited correction flow. Hide the action on historical dates.
- **Open questions:** Is the feature for future bookings as well as today's floor? Is correcting a wrongly entered historical time required?

### F13. Slot and conflict calculation rules are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Functional detail / algorithm
- **Relevant section:** 3.2–3.3
- **Description:** The specification does not fully define the algorithm developers must match. Missing rules include half-open overlap boundaries, reason priority when several block types overlap, invalid/missing timestamps, duplicate copies of the same booking across lanes, hidden assignments, exact exclusion of the selected booking, and the reference time used for expired holds.
- **Rationale:** The database uses half-open windows `[start, end)`. The client helper must use the same rule. `Date.now()` inside a helper makes unit tests and memoisation unstable; a supplied reference time is safer. Off-grid nudges also create candidates such as 20:34, not only grid-aligned values.
- **Impact:** A slot can be marked incorrectly at boundaries or change state unexpectedly while the modal is open.
- **Recommended action:** Add a normative algorithm and examples. Pass `referenceNow` into `isFohBookingLive`; deduplicate by booking/block ID; use `[start, end)`; fail closed on malformed blocking data; define a reason priority such as Private, Event, Taken; and run the same check for arbitrary quick-nudge times and 15-minute grid times.
- **Open questions:** If a slot overlaps both a private block and a booking, which reason is shown? Should malformed schedule rows disable the whole modal or only affected slots?

### F14. Same-booking races and realtime changes can overwrite newer work

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Concurrency / stale state
- **Relevant section:** 3.3, “Staleness”; 5, `FohScheduleClient.tsx`
- **Description:** The database protects tables from overlapping bookings, but it does not prevent two users from moving the same booking to different free times. The second request can overwrite the first. The selected booking context is also a snapshot and is not replaced when realtime reloads the schedule.
- **Rationale:** Table-conflict locking solves a different race. The route does not send or compare an expected original window/version. The notification helper rereads after the update, so concurrent requests can also produce confusing messages about whichever time is current when each helper runs.
- **Impact:** Last-write-wins data loss, misleading audit old values, and duplicate or contradictory guest notifications.
- **Recommended action:** Include `expected_start_datetime` or `expected_updated_at` in the request and compare it inside the transaction. Return 409 with the current booking when it differs. Reconcile the selected modal booking from every schedule refresh, or close the modal when its booking becomes ineligible.
- **Open questions:** Is last-write-wins acceptable for this venue? Can BOH and FOH edit the same booking during service?

### F15. High-chair and outside-capacity effects are missing from the UX and contract

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Resource management / side effects
- **Relevant section:** 2; 3.2–3.4; 5
- **Description:** `move_table_booking_time_v05` re-runs high-chair allocation and can silently reduce the granted count. Updating an outside booking also moves its outside reservation, and the current reconciler deliberately records an oversubscription rather than blocking a staff move. The specification describes neither effect.
- **Rationale:** These are material operational resources. A successful time change can therefore mean “time changed, but one or more high chairs were lost” or “garden capacity is now over the configured level.”
- **Impact:** Staff and guests can be promised resources that are no longer available, with no visible warning.
- **Recommended action:** Return final high-chair count and outside-capacity outcome from the server. If a resource grant changes, show a prominent result and include old/new values in the audit. Decide explicitly whether outside bookings should always appear free or whether the modal should at least warn about capacity pressure.
- **Open questions:** Should a high-chair reduction block the move or require confirmation? Is intentional outside oversubscription acceptable for all FOH editors or managers only?

### F16. A shared kiosk audit cannot identify the staff member

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Audit / accountability / security
- **Relevant section:** 3.6, “Audit logging”
- **Description:** The proposed audit records `auth.userId`, but the kiosk uses the shared `manager@the-anchor.pub` account. That can identify the device/account, not the person. The stated goal of answering “who moved this booking?” is therefore not met.
- **Rationale:** Technical user identity and human operator identity are different on a shared floor device. The audit service also swallows insert failures, so audit presence is best effort rather than guaranteed.
- **Impact:** Guest disputes cannot be attributed to an individual staff member, and the specification overstates audit assurance.
- **Recommended action:** Either capture a staff/employee identifier through an existing authenticated floor identity mechanism or change the stated goal to “which account/device made the change.” Audit no-op attempts, expected/current version, old and new guest and occupancy windows, notification request/result, resource changes, and surface. Add monitoring for audit-write failures.
- **Open questions:** Is individual attribution required? Can the existing clocked-in employee state provide reliable attribution without adding friction?

### F17. Synchronous notification creates slow and uncertain outcomes

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Reliability / performance / integration
- **Relevant section:** 2; 3.4; 6
- **Description:** The endpoint waits for fresh booking/customer reads, manage-token generation, channel selection, email or SMS work, and notification audit before responding. The move itself commits before that work. A timeout or lost response can make the client report failure even though the booking moved and a message may have been sent.
- **Rationale:** This is an external side effect after the database transaction. Retrying after an unknown outcome can cause another move or another message.
- **Impact:** Slow iPad interactions, duplicate actions, duplicate notifications, and staff uncertainty during provider or network problems.
- **Recommended action:** Prefer a durable notification outbox/job keyed by the time-change audit/event ID. If that is too large for this release, separate mutation success from notification outcome in the response, add idempotency/deduplication, use a bounded timeout, and always refresh after an uncertain network result before offering retry.
- **Open questions:** What response-time target is acceptable on the floor? Is there an existing job/outbox pattern that can be reused? What notification rate limits currently apply to repeated changes?

### F18. Validation and response behaviour are incomplete

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** API contract / robustness
- **Relevant section:** 3.3–3.6; 5
- **Description:** The request contract only defines `time`. It does not define notification choice, expected version, day offset, or actor identity. The route does not validate null/invalid booking windows or inconsistent assignment windows before date arithmetic. It does not return the updated booking, final windows, high chairs, notification state, or a true unchanged state.
- **Rationale:** The existing UI helper can update local state only when a response includes a booking snapshot. A malformed window currently becomes a generic 500. Sending the current time still runs the RPC and updates data even though the UI hides that choice.
- **Impact:** Poor recovery, unnecessary writes, ambiguous retries, and limited audit/UI feedback.
- **Recommended action:** Publish a request and response schema with stable error codes. Validate the stored booking before mutation; return 422 for corrupt windows; return `state: unchanged` without mutation or notification; and return the final booking/resource snapshot on success and conflict.
- **Open questions:** Should unchanged requests be audited? Is the existing drag caller required to adopt the new concurrency and notification fields immediately?

### F19. The test plan does not cover the main risks

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Testing / quality
- **Relevant section:** 5–6
- **Description:** The current route test covers authentication, basic input validation, and one simple RPC success. It does not test conflicts, notification calls, audit, states, assignments missing/multiple, duration semantics, resource side effects, or error responses. Its comment says notification is covered in separate tests, but no direct tests of `sendTableBookingRescheduledNotificationIfAllowed` were found.
- **Rationale:** The proposed verification list is command-oriented rather than risk-oriented. Mocking the RPC cannot prove trigger conflicts, locks, guest-versus-occupancy windows, or transaction behaviour.
- **Impact:** The highest-risk defects can pass the stated suite and reach the iPad.
- **Recommended action:** Add the following minimum coverage:
  - Database integration tests for guest duration versus turnaround hold, joined tables, private/communal conflicts, same-booking concurrency, and high-chair/outside side effects.
  - Route tests for every eligible/ineligible state, unchanged, notify on/off/forced off, no channel, conflict codes, audit values, corrupt data, and expected-version mismatch.
  - Unit tests for half-open overlap, liveness with explicit time, off-grid nudges, multi-table union, reason priority, hidden/missing lanes, and cross-midnight guard behaviour.
  - Component tests for focus, keyboard use, action visibility, double tap, loading, modal-local errors, 409 refresh, uncertain success, and checkbox reset.
  - iPad Safari UAT for portrait/landscape, offline/slow network, session expiry, and deliberate realtime conflict.
- **Open questions:** Is a local/preview Supabase integration environment available in CI? Who owns iPad UAT and signs it off?

### F20. “No migration” and the effort estimate are not credible after the duration finding

- **Status:** Confirmed issue
- **Priority:** P0
- **Type:** Delivery / migration / estimation
- **Relevant section:** 5, “Files”; complexity statement
- **Description:** Correct guest/occupancy duration handling likely requires a new or revised atomic database function, so “No migration” is no longer safe. The file table already lists ten files, while the text says roughly six files of real change. It also omits schedule contract/type changes, database integration tests, notification work, and possible repair tooling.
- **Rationale:** The backend fix is a prerequisite, not optional hardening. Database function changes require migration ordering, permissions, generated types, environment rollout, and rollback planning.
- **Impact:** Underestimation, incomplete implementation, and a frontend release against an unsafe backend.
- **Recommended action:** Re-estimate after product decisions and the backend spike. Add the RPC migration, generated database types if applicable, schedule/type contract changes, data preflight/repair decision, and deployment sequence. Backend must deploy before the new button is enabled.
- **Open questions:** What does complexity “3 (M)” mean in team planning terms? Is a repair required for old drag moves? Can UI and backend be feature-flagged independently?

### F21. Touch-drag changes are separate scope and not near-zero risk

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Scope / regression risk
- **Relevant section:** 3.7, “Fix the touch-drag path as well”
- **Description:** Adding `touch-action: none` changes scrolling behaviour when a gesture starts on a booking. Moving the measurement ref changes both time and table drag calculations. Neither change is needed to deliver the supported kiosk tap flow.
- **Rationale:** The timeline is horizontally scrollable. Preventing native touch handling over booking blocks can make panning harder, and measurement changes can alter every desktop drag snap.
- **Impact:** Regression risk and extra iPad/desktop test scope in an already under-specified release.
- **Recommended action:** Move touch-drag work to a separate ticket unless non-kiosk touch drag is an explicit acceptance criterion. If retained, add pan-versus-drag usability tests and regression tests for lane/table drag geometry.
- **Open questions:** Is non-kiosk touch drag used in practice? Is it more valuable than shipping the tap flow safely?

### F22. Accessibility requirements stop at touch-target size

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Accessibility
- **Relevant section:** 3.2; 3.5
- **Description:** The 44px/56px target sizes are good, but there are no requirements for keyboard navigation, focus placement, focus return, screen-reader labels, disabled reasons, current-time semantics, contrast, scroll-region labelling, or live error/loading announcements.
- **Rationale:** A disabled dimmed tile with a one-word visual reason is not enough for assistive technology. Auto-scrolling should not move focus unexpectedly. “Now” can mean the current clock rather than the booking's stored time.
- **Impact:** The modal may be unusable or confusing for keyboard and screen-reader users and may fail accessibility review.
- **Recommended action:** Require semantic buttons, accessible names including proposed time and state, visible and screen-reader disabled reasons, `aria-current` or equivalent for the stored time, focus on the heading/current selection, focus return to Change time, an announced local error/status region, and keyboard-operable scrolling. Test with keyboard and VoiceOver on iPad.
- **Open questions:** What accessibility standard is the project targeting? Should disabled slots remain focusable so their reason can be read, or should reasons be available in adjacent text?

### F23. Offline, session expiry, refresh failure, and uncertain success are unspecified

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Error handling / user journeys
- **Relevant section:** 3.3; 6
- **Description:** Only a 409 is described. Missing journeys include 400 validation, 401 session expiry, 403 permission change, 404 deletion, 500, offline fetch failure, malformed response, mutation success followed by schedule refresh failure, modal close during request, and rapid double tap.
- **Rationale:** The iPad is a mobile floor device and network interruption is a normal operating condition. The existing helper merges mutation and reload into one boolean, which cannot describe partial success.
- **Impact:** Staff may retry completed work, leave the screen stale, or be unable to recover without a full reload.
- **Recommended action:** Add an error matrix with user message, modal behaviour, refresh behaviour, and retry rule for each class. Disable all time controls while submitting. On unknown network outcome, keep the modal open, reload the booking/schedule, and show whether the requested time is already applied before enabling retry.
- **Open questions:** What should happen when the kiosk session expires mid-service? Is there an offline banner or standard reconnect pattern to reuse?

### F24. Release monitoring and operational measures are missing

- **Status:** Confirmed issue
- **Priority:** P2
- **Type:** Monitoring / support
- **Relevant section:** 3.6; 6
- **Description:** Audit logging is proposed, but there is no monitoring plan for endpoint latency, error rate, conflict rate, notification failures, high-chair reductions, outside oversubscription, or client refresh failures.
- **Rationale:** This change affects live floor allocation and guest communication. Audit rows help investigation but do not provide timely alerting or release health.
- **Impact:** Regressions may be found only through a guest complaint or floor disruption.
- **Recommended action:** Add structured logs and a short release dashboard/query for change count, 409 rate, 5xx rate, p95 response time, notification outcome, audit failures, and resource reductions. Define an owner and rollback threshold for the first week.
- **Open questions:** Which existing monitoring system should receive these signals? Who reviews them after release?

### F25. There are no complete, testable acceptance criteria

- **Status:** Confirmed issue
- **Priority:** P1
- **Type:** Delivery / requirements quality
- **Relevant section:** Whole specification; 6
- **Description:** The verification section lists commands and a few manual checks, but it does not provide a full pass/fail contract covering eligible bookings, exact time bounds, event linkage, notification states, resource changes, concurrency, accessibility, and error recovery.
- **Rationale:** Different developers and testers can reasonably implement different behaviour from the current prose.
- **Impact:** Rework, disputed completion, and production-only edge cases.
- **Recommended action:** Add Given/When/Then acceptance criteria after the open product decisions are made. Trace each P0/P1 finding to at least one automated or manual acceptance test.
- **Open questions:** Who is the product approver? Who owns developer completion, QA, and floor sign-off?

### F26. Use “Current booking time” instead of “Now”

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Wording / usability
- **Relevant section:** 3.2, current-time tile
- **Description:** “Now” can be read as the current clock time, especially on a live floor screen.
- **Rationale:** The tile represents the booking's stored time, which may be earlier or later than the actual current time.
- **Impact:** Small but avoidable operator confusion.
- **Recommended action:** Suggested wording: “Current” on the tile and “Current booking time” in its accessible name.
- **Open questions:** None.

### F27. Keep the first release to guest-requested rescheduling

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Scope simplification
- **Relevant section:** 3.2–3.4
- **Description:** The safest small release is a slot picker for active, unseated, non-event bookings where the guest has asked to move. Internal delay tracking, seated moves, touch drag, and arbitrary custom minutes can follow separately.
- **Rationale:** This removes the hardest notification and data-model contradictions while still solving the stated lack of a non-drag time change.
- **Impact:** Smaller test surface, clearer staff training, and lower operational risk.
- **Recommended action:** Rename the action internally as a guest reschedule, require a deliberate Apply step, and keep notification on by default subject to the final policy. Treat internal floor delay as a separate discovery item.
- **Open questions:** Does this narrower release still solve the floor team's immediate need?

### F28. Replace the cross-midnight guard with an explicit timestamp contract when needed

- **Status:** Optional improvement
- **Priority:** P3
- **Type:** Time handling / future-proofing
- **Relevant section:** 7, low-priority hardening
- **Description:** The current request sends only `HH:MM`, so it cannot distinguish the first and next calendar day in a cross-midnight service. It is also ambiguous during a repeated daylight-saving clock hour.
- **Rationale:** A guard can reject bad cases but cannot represent the intended date/day offset. The dormant risk is correctly noted, but the future fix needs a contract change rather than only a conditional check.
- **Impact:** No current impact if verified hours always end at 22:00; future late licences would make midnight selections unsafe.
- **Recommended action:** Keep an explicit guard now. If cross-midnight service is introduced, send an ISO local date plus time or an exact timestamp/day offset and validate it against the booking service date. Add DST tests.
- **Open questions:** Is there a configuration alert when closing time moves past midnight?

### F29. Consider server-produced availability instead of duplicating database rules in the browser

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Architecture / simplification
- **Relevant section:** 3.3
- **Description:** Mirroring `is_booking_live` and every conflict source in browser code creates a permanent drift risk. A comment pointing at SQL and unit tests do not prove parity after a future migration.
- **Rationale:** The server already owns authoritative time conversion, status, permissions, and database rules. Returning candidate availability on modal open costs one request but simplifies correctness and can expose stable reasons and completeness.
- **Impact:** Slightly more network use, but less duplicated logic and fewer misleading client states.
- **Recommended action:** Compare two explicit designs before implementation: (A) enriched, completeness-aware schedule data plus client calculation; or (B) a GET/availability response from the time route using server time and current database data. Choose based on measured iPad latency, not the assumption that any extra request is unacceptable.
- **Open questions:** Can the server calculate all 15-minute candidates in one database round trip? What is the acceptable modal-open latency on the venue network?

### F30. Use a short kiosk canary before general release

- **Status:** Optional improvement
- **Priority:** P2
- **Type:** Rollout / risk control
- **Relevant section:** 6
- **Description:** The feature is primarily for one known kiosk account, which makes a short canary practical.
- **Rationale:** Real iPad Safari, venue Wi-Fi, shared-account behaviour, and live floor timing are difficult to reproduce fully in automated tests.
- **Impact:** Small rollout overhead with a high chance of catching usability or latency problems early.
- **Recommended action:** Deploy backend first, enable the UI for the manager kiosk only for one or two services, review monitoring/audits, then enable it for other FOH editors. Keep a simple kill switch for the button.
- **Open questions:** Who will be present for the canary and collect staff feedback?

## 5. Required changes before implementation

1. Separate guest rescheduling from internal venue delay, or explicitly limit the first release to guest rescheduling.
2. Fix the guest-duration versus assignment-occupancy defect with an atomic backend design and migration.
3. Define and enforce eligible states, including `left_at`, seated state, expired holds, event linkage, and review states.
4. Decide notification defaults, suppression rules, copy, delivery reporting, and retry/deduplication.
5. Define authoritative availability data, exact overlap rules, service bounds, late slots, past times, and incomplete-data behaviour.
6. Add optimistic concurrency and reconcile the open modal with realtime changes.
7. Specify resource side effects, audit identity/contents, API schemas, and the complete error matrix.
8. Replace the current verification list with traceable acceptance criteria and database-backed tests.
9. Re-estimate the work and add migration, deployment ordering, monitoring, rollback, and iPad sign-off.

## 6. Unresolved decisions

- Is this action a guest reschedule, an internal delay, or two separate actions?
- May seated or departed bookings ever be changed?
- Are pending-payment and expired-hold bookings eligible?
- Are all event-linked table bookings excluded?
- Is guest notification checked by default, optional, or mandatory for unseated bookings?
- What must staff see when no message channel exists or delivery fails?
- Are past times and past service dates editable?
- Does a valid start only need to be before service close, or must the guest/resource window also finish before a boundary?
- Are food moves allowed outside kitchen hours when kitchen pacing and cut-off checks are bypassed?
- Should high-chair reduction block, warn, or silently continue?
- Is outside-capacity oversubscription acceptable, and for which role?
- Is shared-account audit sufficient, or is employee attribution required?
- Is client-computed availability still preferred after the completeness and drift findings?
- Is last-write-wins acceptable for simultaneous edits?

## 7. Major risks

1. **Data corruption:** booking end time can absorb the turnaround hold while `duration_minutes` stays unchanged.
2. **Live floor conflict:** moving a seated booking can free a table that is physically occupied.
3. **Integration drift:** event-linked table bookings can move away from their event.
4. **Guest harm:** accidental, duplicate, alarming, or inaccurate notifications.
5. **Stale overwrite:** two staff members can overwrite the same booking without warning.
6. **Misleading availability:** hidden assignments or incomplete schedule data can display blocked slots as free.
7. **Resource loss:** high-chair grants can be reduced without staff seeing it.
8. **Unknown outcome:** the booking can move even when notification or refresh causes the client to report failure.
9. **Weak accountability:** the shared kiosk account cannot identify the human operator.
10. **Delivery underestimation:** the current scope and “no migration” assumption omit necessary backend work.

## 8. Recommended next steps

1. Hold a short product decision session to answer the unresolved decisions, led by the floor owner and booking-system owner.
2. Run a backend spike against representative data to confirm turnaround settings, compare booking and assignment ends, count event-linked bookings, and check for existing inconsistencies caused by drag moves.
3. Design and test the corrected atomic RPC and route contract first.
4. Revise the specification with eligibility, notification, availability, error, concurrency, audit, resource, and acceptance rules.
5. Re-review the revised specification before UI implementation.
6. Build the UI only after the backend contract is stable, then complete automated tests and iPad preview UAT.
7. Release through a kiosk canary with monitoring and a kill switch.


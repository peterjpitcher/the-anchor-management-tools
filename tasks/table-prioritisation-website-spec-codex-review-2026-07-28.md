# Developer review: website and API table-prioritisation specification

Date: 2026-07-28

Reviewed specification: `tasks/table-prioritisation-website-spec-2026-07-28.md`

Related documents:

- `tasks/table-prioritisation-spec-v2-2026-07-27.md`
- `tasks/table-prioritisation-plan-2026-07-27.md`
- `tasks/table-prioritisation-codex-review-report-2026-07-28.md`

Code checked:

- Website `OJ-The-Anchor.pub` at `197ef06d`, plus cleanup commit `b9c52f82`
- AMS branch `feat/table-allocation-v06` at `8937f7a9`

Review scope: technical design, API and data contracts, live caller behaviour, security and privacy,
performance, accessibility, migration, delivery, deployment, monitoring, and testing.

The original specification was not changed. This is a separate developer-facing review.

## Overall readiness

**Assessment: not ready for implementation handoff or production rollout.**

The discovery work is strong and the central architectural direction is correct: table availability
must move to AMS, use the same allocator as create, fail closed when unknown, and be consumed consistently
by the website and agent paths.

However, the current document is not yet an implementation contract. There are seven release or design
blockers:

1. The live form has no food/drinks choice even though `purpose` is required before allocation.
2. Outside seating and high chairs are selected after availability; accessibility has no defined
   placement.
3. Local website code would continue to make availability and service-window decisions.
4. The canonical endpoint, version, envelope, field names, error statuses, and transition precedence are
   not frozen and conflict with the parent specification in places.
5. Availability and create are not tied to one atomic feature-flag state or compatibility matrix.
6. The underlying allocator branch still has unresolved P0/P1 findings in the separate branch review.
7. The proposed production journey suite is unsafe, non-deterministic, and not isolated from real
   inventory, payments, or communications.

Low-risk preparatory work can continue: agree product decisions, freeze and publish the schema, build
fixtures, define observability, and prepare the isolated test environment. Behaviour implementation
should not begin until findings CR-01 through CR-07 have an agreed disposition.

## Finding classification

### Priority

| Priority | Meaning |
|---|---|
| P0 | Can cause a production incident, customer harm, unsafe testing, or invalidate the release |
| P1 | Can produce wrong bookings, false availability, security/privacy exposure, or a blocked delivery |
| P2 | Can cause inconsistency, weak evidence, operational friction, or avoidable rework |
| P3 | Documentation or maintainability issue with limited direct production impact |

### Status

| Status | Meaning |
|---|---|
| Confirmed issue | Demonstrated by the specification, live code, or both |
| Confirmed contradiction | Two requirements or documents cannot both be followed as written |
| Unconfirmed assumption | Material claim has not been evidenced and must be verified |
| Optional improvement | Not required for correctness, but simplifies or de-risks delivery |

## Findings summary

| ID | Title | Priority | Type | Status |
|---|---|---:|---|---|
| CR-01 | No explicit food/drinks choice exists | P0 | Functional / UX | Confirmed issue |
| CR-02 | Table-qualifying choices occur after availability | P0 | Functional / State management | Confirmed issue |
| CR-03 | AMS would still not be the single decision authority | P0 | Architecture / Integration | Confirmed issue |
| CR-04 | The canonical contract is not frozen and conflicts with the parent spec | P0 | API contract | Confirmed contradiction |
| CR-05 | Rollout cannot guarantee availability/create parity | P0 | Migration / Rollout | Confirmed issue |
| CR-06 | The website depends on an allocator that is not release-ready | P0 | Dependency | Confirmed issue |
| CR-07 | The production journey suite is unsafe and non-deterministic | P0 | Testing / Release safety | Confirmed issue |
| CR-08 | Create-time conflict and alternatives behaviour is undefined | P1 | API / Concurrency | Confirmed contradiction |
| CR-09 | Field adapters and AI-agent error handling are incomplete | P1 | Integration | Confirmed issue |
| CR-10 | Accessibility persistence and privacy requirements are incomplete | P1 | Data / Privacy / Functional | Confirmed issue |
| CR-11 | High-chair semantics are contradictory and omitted from delivery tasks | P1 | Functional / Contract | Confirmed contradiction |
| CR-12 | Outside-seating semantics, weather handling, and copy are ambiguous | P1 | Functional / Content | Confirmed issue |
| CR-13 | Slot, date, time, duration, and timezone rules are missing | P1 | API / Functional | Confirmed issue |
| CR-14 | Party-size validation prevents the promised private-enquiry journey | P1 | Validation / UX | Confirmed issue |
| CR-15 | Internal reasons can still leave AMS and appear to customers | P1 | Security / Privacy / Content | Confirmed issue |
| CR-16 | `unknown` and partial/degraded-state behaviour has no truth table | P1 | Resilience / UX | Confirmed issue |
| CR-17 | Rate limiting and performance acceptance are underspecified | P1 | Performance / Abuse prevention | Confirmed issue |
| CR-18 | Turnstile and AI-agent authentication assumptions are unsafe | P1 | Security | Confirmed issue |
| CR-19 | Manage and cancellation authorization is weak and outside the security plan | P1 | Security / Privacy | Confirmed issue |
| CR-20 | Full journey logging would retain sensitive data and tokens | P1 | Privacy / Security | Confirmed issue |
| CR-21 | Fixtures, cleanup, payment, notification, and outage tests lack mechanisms | P1 | Testing / External integrations | Confirmed issue |
| CR-22 | WCAG requirements do not define a complete interaction pattern | P1 | Accessibility | Confirmed issue |
| CR-23 | Public table names conflict with movable soft assignments | P2 | UX / Data exposure | Confirmed issue |
| CR-24 | Production monitoring, thresholds, runbooks, and owners are not assigned | P1 | Observability / Governance | Confirmed issue |
| CR-25 | Shared schema distribution and legacy-client measurement are not implementable | P1 | CI / Contract lifecycle | Confirmed issue |
| CR-26 | Environment isolation, deployment, and rollback are incomplete | P1 | Delivery / Operations | Confirmed issue |
| CR-27 | CORS assumptions are factually wrong and test the wrong boundary | P2 | Security / Configuration | Confirmed issue |
| CR-28 | The document contains stale status, file targets, and resolved questions | P2 | Documentation / Scope | Confirmed contradiction |
| CR-29 | The availability/create test invariant ignores normal races | P2 | Testing / Concurrency | Confirmed issue |

## Detailed findings

### CR-01 — No explicit food/drinks choice exists

**Relevant sections:** 2.2, 3.1, 3.2, 6a journeys 8 and 12, open question 2

**Priority:** P0

**Type:** Functional / UX

**Status:** Confirmed issue

**Description:** The contract requires `purpose` before AMS can choose the correct house order, and the
form is expected to re-query when purpose changes. The live form has no purpose control. It currently
derives `food` or `drinks` from the selected slot's `kitchen_open` value after availability has already
been calculated.

**Rationale:** `ManagementTableBookingForm.tsx:1009-1019` sends only date, time, and party size.
Lines 1489-1508 derive purpose from the chosen slot. AMS cannot correctly allocate a slot by purpose if
the caller does not know the purpose until after receiving the slot.

**Impact:** The same request can be evaluated with the wrong house order, food and drinks can show the
same result when they should differ, and create can refuse a slot that availability advertised.

**Recommended action:** Add a required **Food** / **Drinks** choice on the Find step. Store purpose as
explicit state, send it on every availability and alternatives request, preserve it through review and
create, and include it in analytics and idempotency. Never switch purpose silently.

**Open questions:**

- What customer wording distinguishes “drinks” from “food” without implying a minimum spend?
- Is either option preselected?
- When food is unavailable but drinks are possible, should the switch be offered automatically or only
  after the customer asks?

### CR-02 — Table-qualifying choices occur after availability

**Relevant sections:** 3.1-3.4 and 3.2 form changes

**Priority:** P0

**Type:** Functional / State management

**Status:** Confirmed issue

**Description:** Outside seating and high-chair count currently appear on the guest-details step, after
a slot has been selected. The proposed accessibility control has no specified position. All three can
change which inventory qualifies, but high-chair count is omitted from the stated re-request triggers.

**Rationale:** The live controls are at `ManagementTableBookingForm.tsx:2393-2447`. A background
re-query during contact entry can invalidate the selected slot and force an unexplained backward jump.

**Impact:** A customer can enter details for a slot that was never valid for the final requirements,
lose work, or receive a create-time refusal.

**Recommended action:** Collect purpose, seating area, accessibility, and high-chair count on the Find
step before the first availability request. If product chooses a later position, specify a complete state
transition: cancel stale work, clear the slot, announce the change, re-query, return focus to the time
list, preserve entered details, and prevent create until a fresh valid slot is selected.

**Open questions:**

- Are these requirements all hard filters?
- What is the exact field order?
- Should changing any of them retain or clear previously loaded alternatives?

### CR-03 — AMS would still not be the single decision authority

**Relevant sections:** 2.1, 3.2, and the “single source” requirement in 3.1

**Priority:** P0

**Type:** Architecture / Integration

**Status:** Confirmed issue

**Description:** Moving the public availability route to AMS does not remove other local eligibility
decisions.

**Rationale:** Live code still contains:

- a fail-open business-hours availability fallback in `lib/api/client.ts:1073-1095`;
- a local service-window gate in `app/api/table-bookings/route.ts:445-473`;
- the same local gate in `app/api/booking/agent/route.ts:83-119`.

**Impact:** AMS can say available while a website pre-check refuses, or an AMS outage can be converted
into locally fabricated availability. Availability/create parity remains impossible.

**Recommended action:** Remove all local table and service eligibility decisions from availability and
create consumers. Keep only syntactic validation and display formatting locally. AMS create must remain
the atomic authority. On an availability failure, return `unknown` with no selectable slots.

**Open questions:**

- Is any other caller using `AnchorAPI.checkTableAvailability` and relying on its local fallback?
- Which business-hours helpers remain display-only after migration?

### CR-04 — The canonical contract is not frozen and conflicts with the parent spec

**Relevant sections:** 3.1, 5; parent specification section 4; parent plan B4/C1

**Priority:** P0

**Type:** API contract

**Status:** Confirmed contradiction

**Description:** The document leaves the endpoint as `/load` “or a new versioned endpoint” and does not
define an exact envelope. Cross-document details disagree:

- the parent specification shows `contract_version: 1`;
- this document omits `contract_version`;
- this document requires top-level `calculation_state`;
- the parent example has only per-slot `state`;
- the parent example uses `public_reason`, while this document says only “a public reason code”;
- request field names vary among `outside`, `outside_seating`, and `is_outside_seating`.

There is also a field collision: current AMS `/load` already uses root `slots` for 15-minute
kitchen-pacing rows, while the website consumes `time_slots` with different fields at 30-minute grain.
Reusing root `slots` for the new table contract is not safely additive unless the old and new namespaces
are separated.

**Rationale:** Generated types cannot resolve conceptual descriptions. Two developers can produce
incompatible implementations while both believe they followed the documents.

**Impact:** Contract drift, unsafe fallback precedence, failed rollout, and duplicated adapters.

**Recommended action:** B4 must publish one normative JSON Schema or OpenAPI document containing:

- exact route and version negotiation;
- required and optional request fields, types, bounds, defaults, and unknown-field policy;
- the full success, validation, unavailable, unknown, conflict, rate-limit, and server-error envelopes;
- legal combinations of `calculation_state` and slot `state`;
- the public reason enum and message fields;
- capabilities, limits, warnings, and compatibility fields;
- explicit precedence between new and legacy fields.

Use `contract_version: 1` if this is the first published availability contract, unless the parent
specification is deliberately revised.

The existing `docs/guides/api/openapi.yaml` cannot be used as the canonical source without repair: it
still documents a party maximum of 50, omits high chairs/outside/accessibility, and describes 409 only
for idempotency.

**Open questions:**

- Is the canonical route an evolved `/load` or a dedicated versioned availability endpoint?
- Which document owns the contract when the website and parent specifications disagree?
- Are unknown request fields rejected or ignored?

### CR-05 — Rollout cannot guarantee availability/create parity

**Relevant sections:** 3.1, 5; parent plan streams C, D, and I

**Priority:** P0

**Type:** Migration / Rollout

**Status:** Confirmed issue

**Description:** The sequence says AMS ships an additive response, the website is updated, and “the”
feature flag is flipped. It does not prove that availability and create switch to the same allocator at
the same time or define old/new/flag compatibility.

**Rationale:** AMS currently has separate route, RPC, accessibility, hold, and allocation gates. A new
availability result paired with old create logic, or the reverse, recreates the core defect.

**Impact:** False availability, false refusals, and rollback to a combination that has never been tested.

**Recommended action:** Add an explicit compatibility matrix covering old/new AMS, old/new website, each
relevant flag state, and agent consumers. Define one release-state decision that both availability and
create read. Deploy additive migrations first with flags off, prove shadow parity, deploy compatible
callers, then enable the paired paths together.

**Open questions:**

- Which exact flag controls availability and create?
- Can route-level percentage rollout preserve parity for a single customer journey?
- How are bookings created under v06 reconciled after rollback?

### CR-06 — The website depends on an allocator that is not release-ready

**Relevant sections:** 3.1, 5; separate review
`tasks/table-prioritisation-codex-review-report-2026-07-28.md`

**Priority:** P0

**Type:** Dependency

**Status:** Confirmed issue

**Description:** The website spec assumes the AMS availability primitive will be safe once B4 freezes
the shape. The separate allocator review reproduced P0/P1 defects involving malformed settings,
maintenance holds, event allocations, combination completeness, liveness parity, and trigger conflicts.

**Rationale:** A stable schema does not make incorrect allocation results safe.

**Impact:** The website may accurately display an unsafe or incomplete allocator decision.

**Recommended action:** Make closure of every P0/P1 allocator finding an explicit prerequisite for AMS
availability implementation, shadow comparison, and production activation. Contract design may proceed
in parallel; production acceptance may not.

**Open questions:**

- Who signs off allocator correctness?
- Which findings are accepted risks versus required fixes?

### CR-07 — The production journey suite is unsafe and non-deterministic

**Relevant sections:** 6a “How it runs,” journeys 6-19, and “The gate”

**Priority:** P0

**Type:** Testing / Release safety

**Status:** Confirmed issue

**Description:** The proposed production run deliberately takes the last table, fills the bar, consumes
outside inventory, creates concurrent races, depends on a private function, exercises live deposits, and
waits through hold expiry.

**Rationale:** A “future quiet date” is still sellable production inventory. Preconditions such as
“only four-tops are free” or “the sixth outside booking” cannot be guaranteed without constructing
significant live state. Cleanup can fail and cancellation does not necessarily undo messages, payments,
analytics, or audit records.

**Impact:** Real guests can be refused, money or notifications can be sent, and the release gate itself
can create a production incident.

**Recommended action:** Run the full deterministic suite only against isolated staging data, PayPal
sandbox, and communication sinks. Restrict production to read-only checks plus at most one
pre-authorised ordinary booking/manage/cancel smoke in reserved inventory. Never run capacity-filling,
payment-expiry, private-function, or fault-injection journeys in production.

**Open questions:**

- Is there a production-like isolated AMS/database?
- Can production inventory be reserved explicitly for one smoke booking?
- Who authorises and owns cleanup of the production smoke?

### CR-08 — Create-time conflict and alternatives behaviour is undefined

**Relevant sections:** 3.2, 5, 6, journey 10

**Priority:** P1

**Type:** API / Concurrency

**Status:** Confirmed contradiction

**Description:** The website is told to return nearest alternatives “on a 409,” but current AMS returns
HTTP 200 with `state: "blocked"` for ordinary unavailability. Existing 409 responses cover idempotency
conflicts. No alternatives schema or search rule is specified.

**Rationale:** `src/app/api/table-bookings/route.ts:542-547` sets blocked create responses to 200.
Changing the status on the existing endpoint is not additive.

**Impact:** The website can misclassify a blocked booking, show a generic error, or offer locally
calculated alternatives that do not satisfy the original requirements.

**Recommended action:** Define either a versioned 409 contract or compatible handling of legacy
200/blocked responses. Alternatives must come from AMS and preserve purpose, party size, seating area,
accessibility, and high chairs. Define count, ordering, same-day versus future-day search, expiry, and
the fact that alternatives remain advisory.

**Open questions:**

- Are same-day nearby times preferred over later dates?
- Does an idempotency-in-progress 409 use a different stable code?
- How many alternatives are returned and how far may the search range?

### CR-09 — Field adapters and AI-agent error handling are incomplete

**Relevant sections:** 2.3, 2.5, 3.2

**Priority:** P1

**Type:** Integration

**Status:** Confirmed issue

**Description:** The form, public proxy, AMS, shared API client, and agent use different field names and
payload shapes. The file list does not identify every converter that must change. The agent also loses
structured booking refusals.

**Rationale:**

- `lib/api/client.ts:224-270` maps `is_outside_seating` to `outside_seating` and must also carry
  accessibility.
- The agent POST uses camelCase customer fields and snake/camel variants for options.
- `AnchorAPI.createTableBooking` throws a plain structured object on a blocked result.
- `app/api/booking/agent/route.ts:191-199` treats only `Error` instances specially and otherwise returns
  a generic 500.
- The agent success body says “Booking confirmed” even when AMS returns `pending_payment`, and it does
  not expose the required payment next step.

**Impact:** The form may work while the agent drops a requirement or turns a normal refusal into an
internal error.

**Recommended action:** Define one canonical internal request type and small adapters at each public
boundary. Update `TableBookingRequest`, `ManagementTableBookingPayload`, the client converter,
idempotency inputs, and response mappers. Preserve safe structured error code, status, message, and
alternatives through the agent.

**Open questions:**

- Which snake/camel aliases remain supported and for how long?
- Is the AI endpoint an external public contract or only an internal adapter?

### CR-10 — Accessibility persistence and privacy requirements are incomplete

**Relevant sections:** 3.1, 3.2, 3.3, journey 15

**Priority:** P1

**Type:** Data / Privacy / Functional

**Status:** Confirmed issue, with an unconfirmed legal assumption

**Description:** The requirement is described as a hard filter, but the website spec does not explicitly
require persistence through create, moves, manage operations, notifications, and idempotency. Its legal
conclusion is categorical without a recorded privacy review. The live notes placeholder invites
“accessibility needs,” contradicting the no-free-text requirement.

**Rationale:** The AMS branch adds `table_bookings.requires_accessible_table`, but the current create
schema and RPC call do not forward it. Parent plan B6 also describes the public v06 RPC as taking only
the existing parameters, which would omit the new boolean.

**Impact:** A booking can be moved to an unsuitable table, a changed requirement can replay an older
idempotent request, or sensitive free text can be collected and sent to general logs/analytics.

**Recommended action:**

- Persist the boolean on the booking only and preserve it across every allocation or move.
- Add it to create schemas, RPC signatures, request hashes, website fingerprints, response fixtures, and
  staff displays.
- Remove accessibility wording from the free-text notes placeholder.
- Obtain privacy/legal review of purpose, lawful basis, retention, staff access, audit, privacy notice,
  and exclusion from analytics or conversion payloads.

**Open questions:**

- Which staff roles need to see the flag?
- Does it trigger an operational action such as preparing a ramp?
- What venue limitations must be disclosed near the checkbox?

### CR-11 — High-chair semantics are contradictory and omitted from delivery tasks

**Relevant sections:** 3.1, 3.2, 6a journey 16; parent plan C1/G1

**Priority:** P1

**Type:** Functional / Contract

**Status:** Confirmed contradiction

**Description:** `high_chair_count` changes table eligibility, but the form is not told to re-query when
it changes. The parent plan's C1 and G1 omit it entirely. The current create flow can grant fewer chairs
than requested, while the proposed availability request makes the count appear to be a hard
requirement.

**Rationale:** A requirement cannot simultaneously be a hard availability filter and a silently partial
post-create grant without a customer decision.

**Impact:** A family may receive a confirmed booking without the chair they relied on, or the website may
advertise a slot that cannot fulfil the request.

**Recommended action:** Decide one policy:

- **Hard requirement:** all requested chairs must be atomically available and granted, otherwise return
  unavailable with alternatives.
- **Preference:** availability and create may return a shortfall, but the customer must explicitly accept
  it before the booking is confirmed.

Add `high_chair_count` to B4, C1, G1, every request trigger, fixtures, contract tests, and agent tests.

**Open questions:**

- Is partial fulfilment acceptable for one or two requested chairs?
- Can outside bookings use the shared high-chair pool?

### CR-12 — Outside-seating semantics, weather handling, and copy are ambiguous

**Relevant sections:** 2.3, 3.1, 3.4, journeys 17 and 23

**Priority:** P1

**Type:** Functional / Content

**Status:** Confirmed issue, with unconfirmed venue assumptions

**Description:** The API treats outside as separate hard inventory with no indoor table. The live label
“I'd like an outside table (weather permitting)” reads as a preference. `false` is undefined: it could
mean indoor only or no preference. Accessible+outside and high-chair+outside behaviour are not defined.

The specification also says all five outside tables are unheated, while public beer-garden content
advertises heated areas. Those statements may refer to different seats, but the distinction is not
documented.

**Rationale:** Customers need to know whether selecting outside gives up any indoor fallback and what
happens in bad weather. Editable seasonal copy also needs safe settings, fallback, and channel rules.

**Impact:** Incorrect expectations, inaccessible allocations, inconsistent marketing, and avoidable
weather-day disputes.

**Recommended action:** Define a canonical seating-area model: strict indoor/outside, or a three-state
indoor/outside/no-preference model. Never switch areas silently. Define accessible and high-chair
qualification for outside inventory, weather closure and guest-contact behaviour, and where the
unheated warning appears. Audit all website, email, SMS, and agent copy about heated areas.

Add validated plain-text AMS settings for normal and October-April warnings, immutable safe defaults,
length limits, audit/versioning, and London-date boundary rules.

**Open questions:**

- Are the five bookable outside tables specifically unheated while other garden areas are heated?
- Is outside a hard request or a preference?
- Who contacts customers when outside seating closes for weather?

### CR-13 — Slot, date, time, duration, and timezone rules are missing

**Relevant sections:** 3.1, 6, journeys 7-8 and 25

**Priority:** P1

**Type:** API / Functional

**Status:** Confirmed issue

**Description:** The contract does not define slot cadence, opening/closing boundary rules, booking
duration derivation, turnaround gap, minimum notice, maximum booking horizon, date validation,
cross-midnight service, or Europe/London DST behaviour.

**Rationale:** Current AMS `/load` produces 15-minute slots while the website local flow uses 30-minute
slots. The preferred-time input can contain any minute and the UI selects a nearby returned slot.

**Impact:** Different callers can show different slot grids or allocate different occupancy windows.
Past/today validation can be wrong for travellers or during DST transitions.

**Recommended action:** Put all temporal semantics in the canonical contract and allocator:
Europe/London calendar dates, slot interval, inclusive/exclusive boundaries, turn-time source, maximum
horizon, same-day lead time, requested-time rounding, cross-midnight handling, and DST examples.

**Open questions:**

- Is the public slot interval 15 or 30 minutes?
- What is the maximum advance-booking horizon?
- Is preferred time a filter, a centring hint, or part of the authoritative request?

### CR-14 — Party-size validation prevents the promised private-enquiry journey

**Relevant sections:** 2.6, 3.2, open question 4, journey 9

**Priority:** P1

**Type:** Validation / UX

**Status:** Confirmed issue

**Description:** The live form clamps any value above 20 down to 20, so a customer entering 21 never
reaches the private-booking route. The availability route also silently converts malformed or
non-positive party sizes to two.

**Rationale:** `ManagementTableBookingForm.tsx:1147-1150` and 1991-2022 clamp to 20.
`app/api/table-bookings/availability/route.ts:14-19,139` defaults invalid input to two. AMS create still
has a hard-coded max of 20 while the branch introduces a configurable online maximum.

**Impact:** The system changes the customer's request, makes journey 9 impossible, and can diverge when
the setting changes.

**Recommended action:** Parse strictly. Retain an above-limit value within a sensible absolute input
bound, show a clear private-hire CTA, and prefill the enquiry with party size/date where appropriate.
Return `max_party_size_online` from the authoritative contract and use the same value in availability
and create validation.

**Open questions:**

- What exact page or form is the private-booking destination?
- Should date, party size, and purpose be carried into it?
- What upper input bound protects against abuse without hiding the enquiry path?

### CR-15 — Internal reasons can still leave AMS and appear to customers

**Relevant sections:** 2.4, 3.1, 3.2, “What gets checked”

**Priority:** P1

**Type:** Security / Privacy / Content

**Status:** Confirmed issue

**Description:** The spec correctly requires internal reasons to remain server-side, but current create
responses return raw `reason` and `private_booking_blocked`, and the form explicitly tells the customer a
private event exists.

**Rationale:**

- AMS `mapTableBookingBlockedReason` preserves `private_booking_blocked`.
- AMS create returns the raw RPC reason.
- `ManagementTableBookingForm.tsx:171-179` contains private-event copy.
- `lib/api/client.ts:287-307` contains the same leak for agent/client consumers.

The parent public enum also has no explicit mapping for accessibility or high-chair failures.

**Impact:** Disclosure of private functions or maintenance, inconsistent messages between channels, and
raw codes in analytics.

**Recommended action:** Define one exhaustive public allowlist and one AMS boundary mapper shared by
availability and create. Unknown internal codes map to a safe generic public code. Return only
`public_reason` and approved plain-text message publicly; log the internal cause separately. Recursively
test every public response and notification for forbidden codes, table identities, and function detail.

**Open questions:**

- Do accessibility and high-chair failures receive distinct public codes or map to `tables_full`?
- Who approves editable public messages?

### CR-16 — `unknown` and partial/degraded-state behaviour has no truth table

**Relevant sections:** 3.1, 3.2, 6, journey 24

**Priority:** P1

**Type:** Resilience / UX

**Status:** Confirmed issue

**Description:** The document permits per-slot `unknown` and top-level `calculation_state`, but does not
define legal combinations, HTTP status, retry behaviour, or whether known slots remain selectable in a
partially degraded response.

**Rationale:** Current form logic treats “no available slots” as a reason to load future alternatives
and show event suggestions. An unknown response could therefore trigger misleading downstream choices.

**Impact:** A degraded dependency can be presented as normal unavailability, or a partially trusted slot
can remain bookable.

**Recommended action:** Publish a truth table. Recommended minimum:

- complete calculation: HTTP 200; slots may be available or unavailable;
- whole-date unknown: HTTP 503 or a documented 200 degraded envelope; no selectable slots;
- per-slot unknown: never selectable;
- stale or unsupported contract version: unknown, not legacy fail-open.

Unknown must suppress automatic alternatives based on that failed calculation and show Retry plus a
clickable call path.

**Open questions:**

- Is partial calculation supported at all?
- What timeout creates unknown?
- Does the website retry automatically, and if so how often?

### CR-17 — Rate limiting and performance acceptance are underspecified

**Relevant sections:** 3.2, 4, 6a

**Priority:** P1

**Type:** Performance / Abuse prevention

**Status:** Confirmed issue

**Description:** The document says rate limiting is absent and needed, but does not define limits,
layers, keying, client controls, 429 behaviour, query budget, or performance SLOs.

**Rationale:** The public website route has no distributed availability limiter. AMS already rate-limits
by shared API key, so bursty re-queries can exhaust the website's entire key budget. Alternative
searches can fan out across dates. Process-local maps do not provide reliable serverless protection.

**Impact:** Normal interaction or scraping can starve availability, create, and manage calls; the UI can
show stale responses or retry storms.

**Recommended action:**

- collect hard filters before one request where possible;
- debounce numeric inputs, abort stale requests, deduplicate identical requests, and enforce
  latest-response-wins;
- add distributed per-IP/per-client and global budgets at the website edge;
- separate availability read capacity from create/manage API-key capacity;
- specify 429/`Retry-After`, limiter-failure behaviour, and safe customer copy;
- set p50/p95/p99, timeout, error/unknown, query-count, payload-size, and peak-RPS acceptance targets;
- load-test realistic history and overlap indexes.

**Open questions:**

- What are current traffic and latency baselines?
- What burst rate represents normal repeated form changes?
- Is there a dedicated availability API key or endpoint budget?

### CR-18 — Turnstile and AI-agent authentication assumptions are unsafe

**Relevant sections:** 2.5, 3.2, 4

**Priority:** P1

**Type:** Security

**Status:** Confirmed issue

**Description:** The website believes AMS verifies the forwarded Turnstile token, but the two current
paths skip verification. Separately, the “AI booking agent” is a real mutation channel without a defined
machine-authentication contract.

**Rationale:**

- Website create calls `checkSpamProtection(..., { skipTurnstile: true })`.
- It forwards an API key and Turnstile header to AMS.
- AMS skips Turnstile whenever an API key is present because it assumes the website already verified it.
- Agent POST uses browser-oriented timing/honeypot/Turnstile checks but has no scoped agent identity,
  nonce, replay protection, or durable per-client quota.

**Impact:** Website Turnstile is not an effective server-side control. The agent channel may be unusable
for a legitimate machine client or abusable as a public booking endpoint.

**Recommended action:** Assign exactly one verifier for website Turnstile and test it end to end. Define
agent callers and use scoped, rotatable authentication, nonce/timestamp replay protection, idempotency,
per-client quotas, audit, and a kill switch. If no trusted agent caller exists, defer the agent mutation
channel from this release.

**Open questions:**

- Which service is intended to verify the website's Turnstile token?
- Who calls the agent endpoint today?
- Is the agent endpoint public, partner-only, or internal?

### CR-19 — Manage and cancellation authorization is weak and outside the security plan

**Relevant sections:** 2, journeys 4, 5, and 26

**Priority:** P1

**Type:** Security / Privacy

**Status:** Confirmed issue

**Description:** The human-journey gate includes booking lookup and cancellation, but the spec treats
them only as test steps. Live routes accept booking reference plus customer email, including email in a
query parameter, and no distributed abuse controls are specified. More fundamentally, the website API
client currently returns `501 NOT_SUPPORTED` for both lookup and cancellation by reference, so journeys
4 and 5 cannot pass.

**Rationale:** `app/api/table-bookings/[reference]/route.ts:9-12` and 62-65 accept
`customer_email` in the URL. Reference plus a known email is a weak destructive-action credential and
URLs are commonly retained in logs/history.

**Impact:** Booking enumeration, personal-data leakage, or unauthorised cancellation.

**Recommended action:** Either explicitly exclude manage/cancel security changes from this release and
remove them as a claimed security gate, or target the existing AMS token-based `/g/{token}/table-manage`
journey and include a scoped remediation: opaque expiring signed token or OTP, no PII in URLs, uniform
not-found responses, distributed attempt limits, confirmation for cancellation, and redacted audit.

**Open questions:**

- Is self-service cancellation part of this release's acceptance scope?
- Are signed manage tokens already available from AMS?

### CR-20 — Full journey logging would retain sensitive data and tokens

**Relevant sections:** 6a “How it runs,” “What gets checked,” and “The gate”

**Priority:** P1

**Type:** Privacy / Security

**Status:** Confirmed issue

**Description:** The script is required to log full request and response bodies and keep its output with
release notes.

**Rationale:** Bodies can contain names, phone, email, notes, booking references, customer identifiers,
manage links, payment links, and notification details. A dedicated test contact is still personal and
operational data.

**Impact:** Release artifacts become a long-lived secondary sensitive-data store.

**Recommended action:** Use an allowlisted redacted log schema. Never log authorization, API keys,
cookies, Turnstile tokens, manage/payment tokens, free-text notes, or full contact data. Hash or redact
identifiers. Keep detailed artifacts access-controlled with short retention; keep only a redacted
summary with release notes. Add a secret/PII-pattern assertion.

**Open questions:**

- Where are release notes stored and who can read them?
- What retention applies to CI artifacts?

### CR-21 — Fixtures, cleanup, payment, notification, and outage tests lack mechanisms

**Relevant sections:** 6a

**Priority:** P1

**Type:** Testing / External integrations

**Status:** Confirmed issue

**Description:** Many journeys require exact venue state, payment progression, hold expiry, message
delivery, or an unreachable AMS, but the spec does not define how those conditions are created safely or
verified.

**Rationale:** The suite needs deterministic private blocks, last-table races, full bar/outside state,
high-chair inventory, paid/unpaid holds, PayPal, SMS/email polling, and fault injection. “Cancel at the
end” does not survive process termination or refund a payment.

**Impact:** Flaky tests, impractical run times, orphaned state, and false confidence.

**Recommended action:**

- create a versioned fixture manifest and seed/reset tool for isolated staging;
- tag every mutation with a run ID and persist a ledger immediately;
- use `try/finally`, an idempotent `--cleanup-run`, a TTL sweeper, and a named cleanup owner;
- use PayPal sandbox and mail/SMS sinks with pollable APIs;
- provide a controllable staging clock or shortened test-only expiry;
- inject upstream failure only in staging;
- separate automated delivery assertions from manual copy-quality checks.

**Open questions:**

- Can bookings carry a test run ID?
- Does cancellation release every dependent resource?
- Can communication providers be queried by a correlation ID?

### CR-22 — WCAG requirements do not define a complete interaction pattern

**Relevant sections:** 3.2 and 6

**Priority:** P1

**Type:** Accessibility

**Status:** Confirmed issue

**Description:** `aria-disabled`, `aria-describedby`, a live error region, no colour-only state, and one
375px walkthrough are not enough to specify the new disabled-slot interaction.

**Rationale:** Native disabled buttons cannot receive focus, which conflicts with exposing per-slot
reasons via `aria-describedby`. A large grid of focusable unavailable slots can also be burdensome.
Current wizard transitions scroll but do not move focus to the new heading.

**Impact:** Keyboard and screen-reader users may not discover reasons, may activate an unavailable slot,
or lose context after a re-query or 409.

**Recommended action:** Define:

- native disabled versus focusable `aria-disabled` behaviour and activation prevention;
- unique description IDs and concise reason presentation;
- keyboard navigation and selected-state semantics;
- loading, stale-selection, 409, and step-change announcements and focus placement;
- 320 CSS-pixel reflow, 400% zoom, 200% text, contrast, forced colours, touch targets, and reduced motion;
- automated axe plus manual keyboard and representative screen-reader tests.

**Open questions:**

- Should every unavailable slot be focusable, or should reasons be grouped/on demand?
- Which screen readers and browsers form the manual test matrix?

### CR-23 — Public table names conflict with movable soft assignments

**Relevant sections:** 6a “What gets checked”; current confirmation behaviour

**Priority:** P2

**Type:** UX / Data exposure

**Status:** Confirmed issue

**Description:** Current confirmation and agent responses can expose `table_name`. The new allocator can
move soft drinks assignments later.

**Rationale:** `ManagementTableBookingForm.tsx:1892-1901` displays the assigned table. A customer-visible
specific table becomes a promise that automatic reallocation may break and can reveal internal floor
terminology.

**Impact:** Customer confusion, complaints, and unnecessary disclosure of internal allocation.

**Recommended action:** Remove table identity from public form, agent, manage, SMS, and email contracts
unless the business commits never to move a disclosed assignment. Return a customer-meaningful seating
area only when needed. Keep table IDs/names in staff channels.

**Open questions:**

- Is any table currently promised to customers for operational reasons?
- Should outside/inside seating area be shown without table identity?

### CR-24 — Production monitoring, thresholds, runbooks, and owners are not assigned

**Relevant sections:** 5, 6a; parent plan Monitoring and Owners

**Priority:** P1

**Type:** Observability / Governance

**Status:** Confirmed issue

**Description:** The website spec records test latency but defines no runtime telemetry, correlation,
dashboard, alert, launch threshold, incident runbook, or named flag-control owner. Parent owners remain
“to assign.”

**Rationale:** A global allocation change cannot be judged from a single smoke script.

**Impact:** Rising unknown results, timeouts, 429s, availability/create mismatches, agent divergence, or
channel conversion drops may remain unnoticed.

**Recommended action:** Make parent M1-M3 mandatory dependencies. Emit redacted metrics for contract
version, latency p50/p95/p99, state/public reason, 409 after positive availability, false-available and
false-unavailable mismatches, 429/5xx/timeouts, channel, payment/hold failures, notification failures,
and test-cleanup failures. Add correlation IDs across website and AMS, dashboards, alert thresholds,
go/no-go limits, runbooks, and named primary/backup owners.

**Open questions:**

- Where will metrics and alerts live?
- Who can disable the flag without a deployment?
- What exact thresholds stop rollout?

### CR-25 — Shared schema distribution and legacy-client measurement are not implementable

**Relevant sections:** 5 and 6

**Priority:** P1

**Type:** CI / Contract lifecycle

**Status:** Confirmed issue

**Description:** “Generated from the schema,” “compared by hash,” and “remove after observed client usage
drops to zero” have no distribution or measurement mechanism.

**Rationale:** Separate repositories cannot compare a canonical artifact unless ownership, publication,
pinning, code generation, and CI commands are defined. When old and new fields share one response, the
server cannot observe which fields a client read.

**Impact:** Type drift can ship while CI is green, and the legacy sunset criterion can never be proven.

**Recommended action:** Publish one immutable, versioned schema artifact owned by AMS. Pin it in both
repos, provide deterministic codegen and a freshness check, and test shared fixtures. Require callers to
declare a contract version and stable non-secret client ID by endpoint or header; log version usage and
define a minimum observation window before removal.

**Open questions:**

- Which repository and owner publish the artifact?
- Is a package registry available?
- What consumers exist beyond the website and agent?

### CR-26 — Environment isolation, deployment, and rollback are incomplete

**Relevant sections:** 4, 5, and 6a “The gate”

**Priority:** P1

**Type:** Delivery / Operations

**Status:** Confirmed issue

**Description:** `ANCHOR_API_BASE_URL` defaults to production, yet the full suite is to run against a
preview. Website deployment is described only as manual `vercel --prod` from a clean checkout.
Rollback does not cover environment validation, exact commits, compatibility, or data reconciliation.

**Rationale:** A preview can mutate production if its environment variable is missing. A manual deploy
can target the wrong branch or environment. The cleanup commit `b9c52f82` is on a separate branch and is
not yet the website main commit named at the top of the spec.

**Impact:** Accidental production writes, wrong-version deployment, and rollback to an untested
combination.

**Recommended action:** Define an environment matrix for local/CI/preview/staging/production and fail
closed when a non-production environment resolves to the production AMS. Provide a checked deploy
runbook or protected workflow with expected commit SHA, env preflight, immutable deployment URL smoke,
alias verification, approval, rollback command, post-rollback checks, and reconciliation owner. Decide
whether the behaviour branch is based on or explicitly includes the cleanup commit.

**Open questions:**

- What AMS/database does Vercel preview use today?
- Who has production deploy authority?
- Can old code safely read every record created while v06 was enabled?

### CR-27 — CORS assumptions are factually wrong and test the wrong boundary

**Relevant sections:** 4 and journey 23

**Priority:** P2

**Type:** Security / Configuration

**Status:** Confirmed issue

**Description:** The spec says unset AMS CORS defaults to `*`. Current source defaults to
`https://www.the-anchor.pub`. Normal API responses, preflight responses, and global Next headers also
have potentially different origin behaviour.

**Rationale:** The website calls AMS server-to-server with an API key, so browser CORS is not the
authentication boundary. A Node/curl request with a disallowed Origin can still receive the response and
does not prove browser enforcement.

**Impact:** False security confidence or breakage of legitimate preview/apex origins.

**Recommended action:** First state whether any browser calls AMS directly. Verify deployed preflight
and normal response headers, including no-Origin/null-Origin and duplicate headers. Use API
authentication and permissions as the security boundary. If browser CORS is required, maintain an
environment-specific allowlist and test it in a real browser without exposing the API key.

**Open questions:**

- Does any live browser path call AMS directly?
- Must apex, www, and preview origins be supported?

### CR-28 — The document contains stale status, file targets, and resolved questions

**Relevant sections:** header, 1, diagram in 2, 3.2, and 7

**Priority:** P2

**Type:** Documentation / Scope

**Status:** Confirmed contradiction

**Description:**

- The header says the website is clean and untouched at `197ef06d`, but section 1 records cleanup
  `b9c52f82`.
- The component table calls `BookingConfirmation.tsx` live; later text says it was dead and deleted.
- Section 3.2 still assigns work to deleted `BookingConfirmation.tsx` and a redirect page.
- Open question 1 asks whether to delete files already deleted.
- The diagram says `app/api/business/hours/route.ts` builds slot lists; live code only proxies hours.
- The live inline confirmation already reports partial high-chair grants.

**Rationale:** The document repeats the exact dead-code targeting risk it was created to prevent.

**Impact:** Incorrect estimates, recreated dead code, or changes that never reach customers.

**Recommended action:** Update status and repo SHAs, mark the cleanup decision resolved, remove deleted
targets, point confirmation work to the live result UI in `ManagementTableBookingForm`, and treat the
business-hours route as display-only.

**Open questions:**

- Will `b9c52f82` merge before the behaviour branch or be included in it?
- Which notification templates also need the outside/high-chair copy?

### CR-29 — The availability/create test invariant ignores normal races

**Relevant sections:** 6 and journey 10

**Priority:** P2

**Type:** Testing / Concurrency

**Status:** Confirmed issue

**Description:** “Availability says yes and create must succeed” is valid only against a fixed snapshot.
Availability is advisory and another transaction can consume the resource before create.

**Rationale:** A separate submit-time GET cannot eliminate the race and adds latency. Create must
revalidate and allocate atomically.

**Impact:** A correct 409 can fail the release gate, or developers may add unsafe reservation-like
behaviour to make the assertion pass.

**Recommended action:** Define the invariant as:

- against deterministic fixtures and an unchanged snapshot, availability and create use the same
  eligibility rules;
- under real concurrency, exactly one last-resource create succeeds and the loser gets a safe conflict
  with fresh alternatives;
- zero double bookings and zero unexplained internal failures.

Treat the create call itself as the authoritative submit re-check; do not require an extra GET immediately
before POST.

**Open questions:**

- Is a separate submit-time availability request intended, or is atomic create the re-check?
- How is the customer's entered data preserved after a race-lost conflict?

## Optional improvements

### OI-01 — Prefer a dedicated versioned availability endpoint

**Relevant sections:** 3.1 and 5

**Priority:** P2

**Type:** Architecture simplification

**Status:** Optional improvement

**Description:** `/load` currently combines pacing, booking-load, capacity, and high-chair information.
Adding the full public table-allocation contract further overloads its meaning.

**Rationale:** A dedicated versioned endpoint creates a clean public DTO, explicit version usage, easier
sunset telemetry, and less risk that operational/internal fields leak into customer consumers.

**Impact:** Slightly more routing work, but simpler compatibility and security review.

**Recommended action:** Prefer a dedicated authenticated AMS availability endpoint consumed only by the
website proxy and agent adapter. Retain `/load` for legacy operational data until separately retired.

**Open questions:** Is endpoint proliferation considered more costly than maintaining two shapes in one
large response?

### OI-02 — Use one shared website server adapter for form and agent

**Relevant sections:** 2.5 and 3.2

**Priority:** P2

**Type:** Maintainability simplification

**Status:** Optional improvement

**Description:** Form, proxy, shared client, and agent currently repeat normalization and public-copy
logic.

**Rationale:** Repeated hand-written adapters caused the present purpose and reason-code divergence.

**Impact:** A shared adapter reduces code and makes parity tests smaller.

**Recommended action:** Put canonical request normalization, response validation, public error mapping,
and alternatives parsing in one server-only module. Keep only boundary-specific casing adapters in the
routes.

**Open questions:** Can the agent route call the same public website availability service directly
without recursion?

### OI-03 — Split the journey runner into explicit safety modes

**Relevant sections:** 6a

**Priority:** P3

**Type:** Test tooling simplification

**Status:** Optional improvement

**Description:** One broad dry-run/`--confirm` switch cannot express the safety differences among fixture
tests, staging mutations, production reads, and a controlled production smoke.

**Rationale:** Strong mode separation makes accidental production mutation harder.

**Impact:** Clearer operator intent and simpler approval rules.

**Recommended action:** Provide distinct `fixture`, `staging-full`, `production-readonly`, and
`production-controlled-smoke` modes, with target allowlists and separate guards.

**Open questions:** Which modes may run in CI versus only by an authorised operator?

### OI-04 — Bind the website rollout to shadow comparison

**Relevant sections:** 5; parent plan I3-I8

**Priority:** P2

**Type:** Delivery improvement

**Status:** Optional improvement

**Description:** The parent plan includes a shadow period, but this website spec does not make its
results an explicit activation condition.

**Rationale:** Dark-reading the new allocator before customers see it is the safest opportunity to find
contract, latency, and parity defects.

**Impact:** Additional telemetry work, with materially lower activation risk.

**Recommended action:** Record old/new outcomes without changing the customer result, review mismatch
categories and latency, and require agreed thresholds before enabling the website contract.

**Open questions:** What mismatch rate and observation period are acceptable?

## Unconfirmed assumptions requiring evidence

| Assumption | Why it matters | Required evidence |
|---|---|---|
| Preview deployments do not point to production AMS | Full preview tests otherwise mutate production | Vercel environment audit and a fail-closed runtime check |
| All five bookable outside tables are unheated | Drives mandatory customer copy | Venue/inventory confirmation and reconciliation with “heated areas” marketing |
| The test email and phone are controlled and machine-readable | Needed for delivery assertions | Named owner, provider access, retention, and polling design |
| Every relevant API consumer is known | Required for safe contract sunset | Usage inventory by API key/client ID and grep/runtime evidence |
| `CORS_ALLOWED_ORIGIN` production value | Document currently guesses | Deployed environment/header inspection |
| The accessibility-data conclusion is approved | Affects privacy notice, access, retention, and analytics | Recorded privacy/legal review |
| Cancellation releases every test resource | Required for cleanup claims | Integration tests for table, outside, chair, payment, notification, and audit effects |
| Website deployment is always manual | Determines release controls | Current Vercel project/deploy process confirmation |

## Specific wording changes recommended

These are targeted edits to the original specification, not a rewrite.

### Header and cleanup status

Replace the stale repo/status wording with:

> Website behaviour remains unchanged. Dead booking components were removed separately in website commit
> `b9c52f82`; the behaviour implementation must include or follow that commit. No availability behaviour
> code has been written.

Mark open question 1 resolved and remove deleted files from the section 3.2 implementation table.

### Contract endpoint

Replace:

> `GET /api/table-bookings/load` (or a new versioned endpoint)

with the exact selected endpoint and:

> The schema published by task B4 is normative. It defines `contract_version`, request bounds,
> `calculation_state`, slot state, public reasons/messages, limits, warnings, error envelopes, and legacy
> precedence. No caller may infer availability from legacy capacity fields when the new contract is
> active.

### No-store and concurrency

Replace:

> Caching a scarce resource is how you sell the same table twice.

with:

> Availability remains `no-store` to reduce stale customer information. It is advisory, not a
> reservation. Create must revalidate and allocate atomically; a race-lost create returns the documented
> conflict response and fresh alternatives.

### Availability/create testing

Replace:

> Availability says yes and create must succeed.

with:

> Against the same deterministic fixture snapshot, availability and create must apply identical
> eligibility rules. Under concurrent change, create may return the documented conflict response; it
> must never double-book or fail with an unexplained internal error.

### Production journey testing

Replace the current production gate wording with:

> The full journey suite runs only against isolated staging data with deterministic fixtures, sandboxed
> payment, and communication sinks. Production validation is a separate bounded mode containing
> read-only checks and at most one pre-authorised booking/manage/cancel smoke in reserved inventory.

### CORS

Replace the statement that unset CORS defaults to `*` with:

> Verify deployed CORS headers and enumerate any legitimate browser origins. AMS API-key authentication,
> permissions, and rate limits are the security boundary; CORS is browser enforcement and does not
> protect server-to-server calls.

### Accessibility data

Replace the categorical legal conclusion with:

> Collect only the booking-level seating requirement and do not ask for a diagnosis or reason. Confirm
> privacy classification, lawful basis, notice, access, retention, logging, and analytics treatment with
> the responsible privacy/legal reviewer before launch.

## Required changes before development handoff

1. Decide the Food/Drinks journey and place every hard availability input before search.
2. Freeze one normative contract, including endpoint, `contract_version`, exact fields, truth tables,
   HTTP statuses, limits, warnings, and legacy precedence.
3. Remove all local availability and create-eligibility decisions from website and agent paths.
4. Align parent tasks and RPC signatures for accessibility and `high_chair_count`.
5. Define high-chair and outside semantics, public reason mappings, seasonal warning settings, and
   notification behaviour.
6. Specify the atomic feature-flag/compatibility matrix and tested rollback.
7. Resolve all P0/P1 allocator findings before production activation.
8. Build isolated deterministic fixtures and replace the destructive production suite with bounded
   smoke testing.
9. Close the Turnstile verification gap and decide agent/manage authentication scope.
10. Define distributed rate limits, performance SLOs, observability, launch thresholds, runbooks, and
    named owners.
11. Implement an immutable shared-schema distribution and version-usage measurement mechanism.
12. Correct stale file targets, document status, and resolved questions.

## Unresolved decisions

| Decision | Recommended default |
|---|---|
| Food or drinks selection | Required explicit choice before availability |
| Placement of outside/accessibility/high chairs | Find step, before availability |
| High-chair fulfilment | Hard requirement unless the customer explicitly accepts a shortfall |
| Outside semantics | Strict explicit area; never silently switch indoor/outside |
| Canonical availability endpoint | Dedicated versioned endpoint, unless `/load` is deliberately chosen and documented |
| First contract version | `1`, matching the parent specification |
| Whole-date unknown | No selectable slots; safe retry and call path |
| Create race | Versioned conflict code with AMS-calculated alternatives |
| Submit re-check | Atomic create itself, not an extra GET |
| Full journey environment | Isolated staging only |
| Production validation | Read-only plus one controlled booking/cancel smoke |
| Agent channel | Defer unless trusted callers and scoped auth are confirmed |
| Public table identity | Do not expose movable table assignments |

## Major risks

1. **Customer correctness:** wrong-purpose or stale local decisions can still advertise a table that
   create cannot allocate.
2. **Production safety:** the proposed test suite can consume real inventory and create payment or
   notification incidents.
3. **Contract drift:** three documents and several callers currently use inconsistent fields and
   versions.
4. **Security/privacy:** Turnstile is not verified as assumed; agent/manage paths lack a complete
   security model; test logs retain sensitive data.
5. **Operational control:** no named owners, thresholds, environment isolation, or proven rollback
   matrix exists.
6. **Dependency risk:** a clean website implementation would still depend on unresolved allocator
   defects.

## Recommended next steps

1. Hold a short product/technical decision session for the unresolved decisions table.
2. Update B4, C1, G1, and the v06 public create signature to include every required dimension.
3. Publish the canonical contract and compatibility matrix before feature implementation.
4. Assign owners for AMS, website, schema, staging fixtures, production deploy, monitoring/flag control,
   security review, and failed-test cleanup.
5. Fix and re-review the allocator's P0/P1 findings.
6. Build the isolated fixture environment, schema CI gate, and observability before the customer-facing
   switch.
7. Implement AMS behind flags, then website and agent adapters, then run deterministic parity,
   concurrency, accessibility, security, and performance tests.
8. Shadow the new result, review thresholds, deploy the compatible website, enable gradually, and run
   only the bounded production smoke.

## Final assessment

The specification is a valuable discovery and scope document, but it is not yet a safe build contract.
The architecture can proceed once CR-01 through CR-07 are resolved and the remaining P1 findings have
owners and acceptance criteria. Production activation should remain blocked until the allocator review,
isolated test environment, security controls, observability, and rollback path are all proven.

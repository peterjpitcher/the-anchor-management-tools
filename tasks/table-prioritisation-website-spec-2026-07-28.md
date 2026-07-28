# Website and API spec: the-anchor.pub

Date: 2026-07-28. Status: **discovery complete, spec for review. No website code written.**
Repos: `OJ-The-Anchor.pub` at `197ef06d` (clean, untouched), AMS at `feat/table-allocation-v06`.
Parent plan: `tasks/table-prioritisation-plan-2026-07-27.md` (stream G).

**Nothing on the AMS branch has changed an API contract yet, so the website works today exactly as it
always has.** This spec describes what must change, and in what order, once the AMS availability
function exists.

---

## 1. The finding that changes the plan

`/book-table` renders **`ManagementTableBookingForm`**. There is a second, older component family that
is exported from the barrel and referenced by nothing live:

| Component | Status | Referenced by |
|-----------|--------|---------------|
| `ManagementTableBookingForm.tsx` | **LIVE** | `app/book-table/page.tsx:187` |
| `PayPalDepositSection.tsx` | **LIVE** | `ManagementTableBookingForm` |
| `BookingConfirmation.tsx` | **LIVE** | `app/booking-confirmation/page.tsx` |
| `TableBookingForm.tsx` | **DEAD** | only the barrel and `TableBookingWithTracking` |
| `TableBookingWithTracking.tsx` | **DEAD** | nothing at all |
| `AvailabilityChecker.tsx` | **DEAD** | only `TableBookingForm` |
| `CustomerDetails.tsx` | **DEAD** | only `TableBookingForm` |
| `BookingDatePicker.tsx` | **DEAD** | only `TableBookingForm` |

The parent plan's task G5 said "update `BookingDatePicker`". **That is a dead file.** Doing the work
there would have produced a change that looked right, tested green in isolation and did nothing at all.
This is the same dead-duplicate trap the AMS repo has with its `*Client.tsx` files.

The date picking that is actually live is inside `ManagementTableBookingForm`.

**Decision needed:** delete the dead family, or leave it. Recommend leaving it in this change and
removing it separately, so a behaviour release does not carry a deletion.

## 2. What talks to what today

```
Customer ──▶ the-anchor.pub
               │
               ├── GET  /api/table-bookings/availability   (local slot maths, see 2.1)
               ├── POST /api/table-bookings                (proxy to AMS)
               ├── POST /api/table-bookings/create         (identical: `export { POST } from '../route'`)
               ├── GET  /api/table-bookings/[reference]    (manage link, needs customer email)
               ├── POST /api/table-bookings/paypal/*       (deposit)
               ├── POST /api/booking/agent                 (AI agent, separate consumer)
               └── GET  /api/business/hours                (also builds slot lists)
                          │
                          ▼
               AMS  https://management.orangejelly.co.uk/api
                    auth: ANCHOR_API_KEY, base: ANCHOR_API_BASE_URL
```

`/api/table-bookings/create` is a one-line re-export of `/api/table-bookings`. Two public URLs, one
handler. Both must keep working.

### 2.1 The availability route is the whole problem

`app/api/table-bookings/availability/route.ts`:

- **Line 120: `void searchParams.get('purpose')`**, with a comment saying purpose is accepted "for
  backwards compatibility" and then discarded.
- It builds its slot list **locally** via `buildSlotsWithKitchenState(ranges, kitchenRanges, partySize,
  …)` from service windows plus a "busyness" figure.
- Line 89: `slot.available === true || (slot.available_capacity || 0) >= options.partySize`.
  `available_capacity` is a **covers** number. Party size affects the label, not whether a table exists.

So the website decides availability from opening hours and a kitchen covers estimate, and **never asks
whether a table exists**. That is the false-availability defect, seen from this side.

### 2.2 Create is already purpose-aware, availability is not

`app/api/table-bookings/route.ts` treats `purpose` as **required** and rejects the request without it
(a past incident, AB-001, is cited in the comments: coercing a missing purpose to `food` produced
misleading service-window errors). The same file also strips `sunday_lunch` and always forwards
`booking_type='regular'`.

So today: **create knows food from drinks, availability does not.** Once food and drinks use different
house orders, that mismatch stops being cosmetic and starts showing customers slots they cannot have.

### 2.3 Field names on the wire, which are not symmetrical

Documented in the route's own comments, and easy to get wrong:

| Website form / agent sends | Website proxy forwards to AMS |
|---|---|
| `is_outside_seating` | **`outside_seating`** |
| `high_chair_count` | `high_chair_count` |
| `purpose` (`food`\|`drinks`) | `purpose` |
| `party_size` | `party_size` |

AMS responds with `high_chairs_granted` and `is_outside_seating`.

### 2.4 The form already has a reason-code map

`ManagementTableBookingForm.tsx` lines 80-84 and 172-176 already map AMS blocked reasons to customer
copy, including `outside_hours` and `too_large_party`. **New reason codes plug into an existing
mechanism**, they do not need one building. The copy is currently hard-coded in the component.

### 2.5 The AI booking agent is a separate consumer

`app/api/booking/agent/route.ts` creates real bookings. It requires `purpose` (incident AB-002),
accepts high chairs and outside seating in both snake_case and camelCase, and returns
`high_chairs_granted`. **Every contract change has to be applied here too**, or the agent silently
diverges from the website form.

### 2.6 Party size is already capped at 20

`ManagementTableBookingForm.tsx:680`: `Math.min(Math.max(prefill?.partySize || 2, 1), 20)`. That already
matches the agreed online ceiling, so no change is needed unless the ceiling moves. It should read the
ceiling from the API rather than hard-coding it.

---

## 3. What must change

### 3.1 API contract, AMS side

`GET /api/table-bookings/load` (or a new versioned endpoint) becomes the single source of availability
and must accept:

| Parameter | Why |
|-----------|-----|
| `date` | as today |
| `party_size` | availability is currently not party-size aware |
| `purpose` | food and drinks now use different house orders and can differ in availability |
| `outside` | outside is capped separately and holds no indoor table |
| `requires_accessible_table` | step-free plus standard-height is a hard filter |
| `high_chair_count` | High 4 cannot take a high chair, so it changes which tables qualify |

and return, per slot: `state` (`available` | `unavailable` | `unknown`), a **public** reason code, and
the resolved customer message. Plus a top-level `calculation_state` so a whole-date failure is
expressible when the slot list itself cannot be built.

**Internal reason codes must never leave AMS.** A private booking and a maintenance block both surface
as `tables_full`; the customer is never told a function is on.

The response must be **additive** to the current shape for one release, so an un-deployed website keeps
working while AMS is ahead of it.

### 3.2 Website changes, by file

| File | Change |
|------|--------|
| `app/api/table-bookings/availability/route.ts` | Stop discarding `purpose`. Pass party size, purpose, outside, accessibility and high chairs to AMS. Stop building slots locally; render what AMS returns. Handle `unknown`. |
| `app/api/table-bookings/route.ts` | Forward `requires_accessible_table`. Keep the `is_outside_seating` to `outside_seating` mapping. Surface new blocked reasons. Return the nearest alternative times on a 409. |
| `app/api/booking/agent/route.ts` | Same additions as the proxy, in both snake_case and camelCase. Expose availability reasons so the agent can explain a refusal. |
| `components/features/TableBooking/ManagementTableBookingForm.tsx` | Re-request availability whenever party size, purpose, outside or accessibility changes (it does not today). Grey unavailable slots with the reason beneath rather than filtering them out. Add the accessibility checkbox. Read the party-size ceiling from the API. Route above the ceiling to the private-booking enquiry. Add the unheated-garden note. |
| `lib/api/client.ts` | New request and response types, generated from the AMS schema rather than hand-written. `fetchInternalTableAvailability` updated. |
| `lib/table-booking-slot-window.ts`, `lib/table-booking-service-windows.ts` | Reduced to formatting. The availability decision moves to AMS. |
| `app/api/business/hours/route.ts` | Also builds slot lists, including a hard-coded Sunday list. Must not contradict the new availability. |
| `app/booking-confirmation/page.tsx`, `BookingConfirmation.tsx` | Show the high-chair shortfall honestly when fewer were granted than asked for. Repeat the unheated-garden note for outside bookings. |
| `tests/api/table-bookings*.test.ts`, `tests/unit/ManagementTableBookingForm.test.tsx` | Updated throughout. |

### 3.3 The accessibility question

One checkbox, on the form and in the agent's vocabulary:

> I need an accessible table (step-free, with standard-height seating)

**No free-text reason prompt, and the reason is never stored.** Under UK GDPR a health reason is
special-category data; a seating requirement is not, provided we never record why. It is a hard filter
that is never released close to the sitting, unlike the minimum party sizes.

### 3.4 The unheated garden

All five outside tables are unheated. The customer must be told before confirming, not on arrival, with
stronger wording between October and April. Message text comes from the AMS settings so it can be
changed without a deploy.

---

## 4. Auth, CORS and configuration

| Item | State |
|------|-------|
| `ANCHOR_API_KEY` | Set. Server-side only. Must never reach the browser |
| `ANCHOR_API_BASE_URL` | Optional, defaults to `https://management.orangejelly.co.uk/api` |
| `CORS_ALLOWED_ORIGIN` on the AMS Vercel project | **Believed still unset**, so AMS defaults to `*`. Flagged in March 2026 and not actioned. Verify and set to `https://www.the-anchor.pub` |
| Rate limiting on the availability endpoint | None today. Availability will be called far more often once it re-requests on every party-size change. Needed before launch |

Availability must stay `no-store`. Caching a scarce resource is how you sell the same table twice.

---

## 5. Sequencing

The website cannot start until the AMS availability response shape is frozen (**task B4** in the parent
plan). Deliberately early in the AMS stream for this reason.

1. AMS freezes the contract and publishes the schema. Types generated from it, shared by both repos and
   compared by hash in CI.
2. AMS ships the new response **additively**, both shapes live.
3. Website updated to read the new shape, still tolerating the old.
4. Feature flag flipped in AMS.
5. Old shape removed only after observed client usage drops to zero, not after a fixed period.

AMS auto-deploys from `main`. **The website is a manual `vercel --prod` from a clean checkout**, and the
alias must be confirmed afterwards. A push is not a deploy.

---

## 6. Testing

- Contract tests generated from the shared schema, run in both repos.
- **Availability and create must agree.** A matrix of date, time, party size, purpose, outside and
  accessibility where availability says yes and create must succeed. This is the regression test for the
  whole project.
- The agent path tested to the same standard as the form. It is a real booking channel.
- Both proxy URLs (`/api/table-bookings` and `/api/table-bookings/create`) exercised.
- Component tests: re-request on party-size change, greyed slots carry reasons, `unknown` renders the
  call-us path, the accessibility checkbox reaches the payload.
- Accessibility: `aria-disabled` plus `aria-describedby` on unavailable slots, live region for errors,
  no colour-only state. WCAG 2.2 AA.
- The website's own lint, test and cold build must be in the release gate. It is a separate toolchain
  from the AMS one.

---

## 6a. Human-equivalent API testing

Automated tests prove the code does what it was written to do. This proves the **API behaves correctly
for a real person**, against the really deployed system, over the wire, with nothing mocked.

Delivered as a committed, re-runnable script (`scripts/api-journey-test.ts`), not a one-off session, so
it can be run again after any future change.

### How it runs

- Against the **real deployed API**, over HTTPS, using a real `ANCHOR_API_KEY`.
- Every request logged: method, URL, full request body, status, full response body, latency.
- **Dry-run by default.** Creating bookings requires `--confirm` plus an env guard, following the same
  pattern as the other mutating scripts in this repo.
- Uses a dedicated **test customer**: a phone number and email that belong to us, so no real guest is
  ever texted or emailed. Confirmations, reminders and cancellations all land somewhere we can read.
- Every booking it creates is **cancelled at the end**, and the script fails loudly if cleanup does not
  complete. It prints every reference it created so nothing can be orphaned silently.
- Run against a **future quiet date** so it cannot consume a table a real guest wants.

### The journeys, as a person would actually experience them

Each asserts both the API response **and** what a customer would see.

**Booking a table**

1. Check availability for two people at a normal time. Expect available slots with real times.
2. Book that slot. Expect a confirmation with a reference, a table, and the right duration.
3. Check availability again for the same slot. Expect the capacity to have visibly moved.
4. Look the booking up on the manage link with the customer email. Expect the same details back.
5. Cancel it. Confirm it is gone and the table is released.

**The things that go wrong for real people**

6. Ask for a party of six when only four-tops are free. Expect a clear refusal, not a slot that fails at
   the last step.
7. Ask for a time when the pub is closed. Expect "we are closed", not a generic error.
8. Ask ten minutes before the kitchen shuts. Expect the cut-off message.
9. Ask for a party of 21. Expect the private-booking route, with a real contact path.
10. Book the same last table twice at the same moment, in parallel. Expect exactly one to succeed and the
    other to get an honest refusal, never a double booking.

**The behaviour this project exists to fix**

11. Book a slot that overlaps a **private function in the Dining Room**. Expect to be offered a Main Bar
    table, not refused. This is the 9 May 2026 regression and it must be proven fixed against the real
    API, not just in a test database.
12. Ask for **food** and for **drinks** at the same time on the same date. Expect different tables:
    dining room for food, bar for drinks.
13. Fill the bar with drinks bookings, then book drinks again. Expect **overflow into the Dining Room**,
    not a refusal.
14. Book a party of seven. Expect a sensible joined pair, and expect the Dining Room's ability to seat a
    large group afterwards to be reported honestly.

**Access and family**

15. Book asking for **step-free, standard-height** seating. Expect never to be given Small Bay or High 4.
16. Book asking for a **high chair**. Expect never to be given High 4, and expect an honest answer if
    fewer chairs are available than asked for.
17. Book **outside**. Expect the unheated warning in the response and in the confirmation, and expect the
    outside cap to be enforced on the sixth concurrent booking.

**Money**

18. Book a party of ten. Expect a deposit to be required, a payment link to work, and the hold to expire
    correctly if unpaid.
19. Pay a deposit, then let the hold time pass. Expect the booking to **survive**, because it is paid.
    That is the defect where the faster cleanup job could cancel a paid booking.

**Every channel, not just the website**

20. The same core journey through the **AI booking agent** endpoint.
21. The same journey through **both** proxy URLs, `/api/table-bookings` and `/api/table-bookings/create`.
22. A direct API call with an **invalid key**, and with **no key**. Expect a clean 401, no data leaked.
23. A request from a **disallowed origin**, to confirm CORS is actually restricted.

**Degraded and hostile**

24. Availability when AMS is unreachable. Expect `unknown` and a "please call us" path, **never** a slot
    presented as bookable.
25. Malformed input: negative party size, a date in the past, a nonsense time, a purpose that is neither
    food nor drinks. Expect clean validation errors, never a stack trace and never a 500.
26. A booking reference that is not theirs, on the manage link. Expect a refusal, with no detail leaked
    about someone else's booking.

### What gets checked on every response

- The **customer-visible message** is plain English and does not expose an internal reason code, a table
  name a customer would not understand, or the existence of a private function.
- No internal reason code appears anywhere in the body.
- Latency is recorded; availability is the hot path and will be called on every party-size change.
- The confirmation SMS and email actually arrive at the test contact, and say the same thing as the API
  response. An API that is right while the text message is wrong is still a broken booking.

### The gate

The script prints a pass or fail per journey and exits non-zero on any failure. **It runs against a
preview deployment before production, and again against production immediately after the feature flag is
switched on**, as the smoke test in task I9 of the parent plan. Its output is kept with the release
notes.

Two journeys are explicitly manual, because a script cannot judge them: reading the confirmation email
as a customer would, and walking the booking form on a real phone at 375px.

---

## 7. Open questions

1. **Delete the dead component family** (`TableBookingForm`, `TableBookingWithTracking`,
   `AvailabilityChecker`, `CustomerDetails`, `BookingDatePicker`), or leave it? **Recommend leaving it
   here and removing it in a separate commit**, so a behaviour change does not carry a deletion.
2. **Should the website show that a slot is available for drinks but not food?** Now possible, since
   they use different house orders. **Recommend yes**, and offer the switch: "we are full for food at
   7pm, but we can seat you for drinks."
3. **Is `CORS_ALLOWED_ORIGIN` set on the AMS Vercel project?** Needs checking, not assuming. If unset,
   AMS is serving `*`.
4. **Should the party-size ceiling come from the API** rather than the hard-coded 20 in the form?
   **Recommend yes**, so changing it in settings does not need a website deploy.

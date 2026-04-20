# Sunday Lunch Booking Pipeline — Fix Spec

**Date:** 2026-04-18
**Owner:** Peter Pitcher
**Status:** Implementation in flight (Problem B shipped, Problem A in review)

## Implementation status (as of 2026-04-18 evening)

| Workstream | Status | Artefact |
|---|---|---|
| Problem B — PayPal capture 404 | **Merged to `main`** | commit `30a7e12e` on the-anchor-management-tools |
| Problem A — management API accepts structured fields | **PR open, awaiting review** | [management-tools#72](https://github.com/peterjpitcher/the-anchor-management-tools/pull/72) |
| Problem A — website proxy forwards structured fields | **PR open, awaiting review** | [the-anchor.pub#77](https://github.com/peterjpitcher/the-anchor.pub/pull/77) |
| Problem A — historical backfill (A3) | **Dropped** | Only 2 past Sunday bookings affected, zero future impact per audit script output |
| Stranded-booking outreach | **Dropped** | Owner decision: do not contact |
| Stranded test rows in the database | **Deleted** | `scripts/database/cleanup-paypal-fix-test-bookings.ts` run; 0 rows remaining |

Deploy order for Problem A: merge management PR first (so the API accepts the new fields), then website PR (so the forms start sending them).


**Related files:** `tasks/sunday-lunch-booking-findings-2026-04-18.md` (raw discovery notes)

## TL;DR

Two separate but related defects in the public table-booking pipeline (`the-anchor.pub` → `management.orangejelly.co.uk`). One is a production P0 that has been silently breaking every deposit-required booking since **2026-03-15**. The other is a long-standing data integrity issue where structured pre-order / customer data is flattened into a single `notes` text blob instead of being stored in its proper columns and the `table_booking_items` table.

| # | Title | Severity | Confidence | Recommended sequencing |
|---|---|---|---|---|
| B | PayPal capture `sunday_lunch` column bug | **P0** (customer-facing, blocks conversion) | Confirmed from prod logs | **Ship today** — 2-line fix |
| A | Pre-order items + customer details end up in `special_requirements` | P2 (data integrity, staff UX) | Confirmed by code trace | Design changes; ship in 2 or 3 PRs next week |

---

## 1. Context

- Public booking site: `OJ-The-Anchor.pub` (Next.js, deployed as `the-anchor.pub`).
- Staff management site / API: `OJ-AnchorManagementTools` (Next.js, deployed as `management.orangejelly.co.uk`).
- The public site proxies booking submissions through its own API routes, which authenticate with an API key (`ANCHOR_API_KEY`) and call the management tools' `POST /api/table-bookings`.
- Sunday lunch bookings require a £10/person deposit paid via PayPal (card via PayPal's guest-checkout). 7+ covers on any day also trigger a deposit.
- PayPal flow: booking is created in state `pending_payment` → PayPal order created against the booking id → user approves at PayPal/bank → client calls capture-order → booking moves to `confirmed`.
- Relevant prior review in memory: `project_booking_form_review.md` (2026-03-21).

## 2. Problem B — PayPal capture returns 404 "Booking not found"

### 2.1 Symptoms

Reproduced by the owner on 2026-04-18 at ~15:34 London time, party of (unspecified), Sunday lunch, paid by debit card via PayPal. Flow:

1. Form submits successfully.
2. Deposit panel shows correct amount.
3. PayPal loads, user completes 3DS with bank.
4. On return, UI shows: **"Payment error — Booking not found"**.

### 2.2 Evidence (Vercel production logs)

Same deployment (`dpl_9VxyEgWoUq1ZPuRimwynSBEVV7Jx`), same booking id (`6ac0fc03-6030-44f2-9767-89a4e542620a`):

```
15:34:53  POST /api/table-bookings                                       → 201
15:34:54  POST /api/external/table-bookings/6ac0fc03/paypal/create-order  → 200
15:36:19  POST /api/external/table-bookings/6ac0fc03/paypal/capture-order → 404
```

Create-order succeeded (it also fetches the booking row), so the booking existed at 15:34:54. No cron, no migration, nothing between those timestamps deletes table-booking rows. Evidence points at the capture endpoint itself.

### 2.3 Root cause

`src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts:42` runs:

```ts
const { data: booking, error: fetchError } = await supabase
  .from('table_bookings')
  .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, sunday_lunch, source')
  .eq('id', bookingId)
  .single();

if (fetchError || !booking) {
  return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
}
```

`sunday_lunch` is **not a column** on `table_bookings`. Verified against `src/types/database.generated.ts:9839-9897`. The Sunday lunch indicator is the `booking_type` enum (`'sunday_lunch' | 'regular'`). PostgREST rejects the select with an "unknown column" error, the handler treats any `fetchError` as row-not-found, and returns 404 with the misleading body `{ error: 'Booking not found' }`.

Line 136 of the same file then reads `sunday_lunch: booking.sunday_lunch ?? false`, reinforcing that the author assumed the column existed.

### 2.4 When it broke

Commit `e10f653a` — *"feat: defer confirmation notifications until deposit is captured"* — Sun 15 Mar 2026 10:15:42 UTC. The commit added the notification dispatch block and introduced the bad column reference. It has been live for about 34 days.

### 2.5 Blast radius

Every website booking that required a PayPal deposit has failed at capture since 2026-03-15:

- All Sunday lunch bookings (`£10/person` deposit is mandatory).
- All group bookings for 7–20 covers on any day (deposit required by `create_table_booking_v05` line 380).

Regular 1–6 cover weekday bookings do not require a deposit (`deposit_waived=true` via RPC) and therefore bypass this code path; they are unaffected.

Staff/FOH bookings go through a different endpoint (`/api/foh/bookings`) and are unaffected.

Webhook capture path (`/api/webhooks/paypal/table-bookings`) — **needs verification** (see §2.8). If that path has the same column reference it could mean captures stranded by the 404 were still silently completed by the webhook.

### 2.6 Proposed fix

Two-line change to `src/app/api/external/table-bookings/[id]/paypal/capture-order/route.ts`:

```diff
- .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, sunday_lunch, source')
+ .select('id, status, payment_status, paypal_deposit_order_id, paypal_deposit_capture_id, customer_id, party_size, start_datetime, booking_reference, booking_type, source')
```

```diff
-   sunday_lunch: booking.sunday_lunch ?? false,
+   sunday_lunch: booking.booking_type === 'sunday_lunch',
```

### 2.7 Defence-in-depth (same PR)

Change the error branch to log the underlying Supabase error before returning 404, so a future schema drift surfaces loudly instead of masquerading as "Booking not found":

```diff
  if (fetchError || !booking) {
+   if (fetchError) {
+     logger.error('Capture-order booking fetch failed', {
+       error: new Error(fetchError.message),
+       metadata: { bookingId, code: fetchError.code }
+     });
+   }
    return NextResponse.json({ error: 'Booking not found' }, { status: 404 });
  }
```

Apply the same pattern to `create-order/route.ts:27` where the same `fetchError || !booking` pattern exists.

### 2.8 Pre-implementation verification

Before shipping:

1. **Check the PayPal webhook capture path** — `src/app/api/webhooks/paypal/table-bookings/route.ts`. If it runs the same bad SELECT, every stranded booking's capture also failed there. If it runs a valid SELECT, the PayPal-side webhook may have completed captures that the client-side flow saw fail — we need to check for orphan `paypal_deposit_capture_id` values against bookings cancelled by the `event-booking-holds` cron.
2. **Check `sendTableBookingCreatedSmsIfAllowed` and `sendManagerTableBookingCreatedEmailIfAllowed` signatures** — confirm they accept `sunday_lunch: boolean` on `bookingResult` or whether the shape has drifted.
3. **Grep for any other `booking.sunday_lunch` or `.select(...sunday_lunch...)` in the repo** — ensure this is the only place with the bad column. (Initial grep shows only the two lines above, but worth a final sweep.)

### 2.9 Acceptance criteria

- [ ] Unit / integration test added: capture-order returns 200 on a valid `pending_payment` Sunday lunch booking. Current test suite has `tests/api/booking-submit-deposit.test.ts` on the website side; an equivalent is needed on the management side.
- [ ] Manual end-to-end test on preview: new Sunday lunch booking → deposit via PayPal sandbox → booking confirmed → customer SMS sent → manager email sent.
- [ ] Logger emits the underlying error message when a capture-order SELECT fails in the future.
- [ ] Vercel logs for capture-order POSTs return 200 for new bookings in production smoke test.

### 2.10 Rollback

Single commit. `git revert` is safe: the only downside of reverting is returning to the broken state we've lived with for 5 weeks.

### 2.11 Stranded-booking remediation

No money was captured — the 404 fires before `capturePayPalPayment()` runs — so no refunds are required. PayPal authorisations release automatically within ~30 days.

Recommended one-off query to quantify the damage (for owner visibility, not for customer contact):

```sql
SELECT COUNT(*) AS stranded, MIN(created_at), MAX(created_at)
FROM table_bookings
WHERE cancellation_reason = 'payment_hold_expired'
  AND created_at >= '2026-03-15'
  AND paypal_deposit_order_id IS NOT NULL
  AND paypal_deposit_capture_id IS NULL;
```

Not in scope for the fix PR.

---

## 3. Problem A — Pre-order items and customer details stored in `notes`

### 3.1 Symptoms

- Admin "Pre-order" tab on a website-originated Sunday lunch booking is empty (reads `table_booking_items`, which has no rows).
- Kitchen pre-order PDF (`/api/boh/table-bookings/preorder-sheet`) shows an empty pivot — kitchen must read a free-text blob from `special_requirements`.
- First-time customers show up in `customers` with only a phone number; `first_name`, `last_name`, `email` blank. The website form collected all of those.
- Dietary requirements and allergies are buried in free text instead of the dedicated `dietary_requirements` and `allergies` array columns.

### 3.2 Current data flow (as-is)

**Website side** — `OJ-The-Anchor.pub/app/api/table-bookings/route.ts`

1. Sunday lunch form (`components/features/TableBooking/SundayLunchBookingForm.tsx:475-492`) POSTs:
   ```ts
   {
     booking_type: 'sunday_lunch',
     date, time, party_size,
     customer: { first_name, last_name, email, mobile_number, sms_opt_in },
     special_requirements, dietary_requirements, allergies,
     menu_selections: [{ custom_item_name, item_type, quantity, guest_name, price_at_booking }],
     source: 'website'
   }
   ```
2. The proxy's `normaliseIncomingPayload` (line 186) checks `isNewShape` — true only if `phone`, `purpose`, or `sunday_lunch` are top-level. The Sunday lunch form nests customer data under `customer.*`, so it falls into the **legacy branch** (line 235).
3. Legacy branch (line 248-257) returns only `{phone, date, time, party_size, purpose, notes, sunday_lunch}` — it **drops** `first_name`, `last_name`, `email` entirely.
4. `buildLegacyNotes` (line 136-183) concatenates everything into one text blob:
   ```
   Name: John Smith
   Email: john@example.com
   Dietary requirements: vegetarian
   Allergies: nuts
   Sunday lunch pre-order: Guest 1: Roasted Chicken x1 | Guest 2: Crispy Pork Belly x1 | Table: Cauliflower Cheese x2
   ```
5. Blob is forwarded as `notes` to the management API.

**Management side** — `OJ-AnchorManagementTools/src/app/api/table-bookings/route.ts`

6. Zod schema (line 40-56) accepts `notes?: string` but has **no field** for structured pre-order items.
7. `ensureCustomerForPhone` is called (line 216) with `firstName: payload.first_name, lastName: payload.last_name, email: payload.email`. Because the website proxy dropped these, they arrive as `undefined` — the customer row gets a phone only (or keeps its existing values if the customer already exists).
8. The RPC `create_table_booking_v05` accepts `p_notes` text → stores in `table_bookings.special_requirements`. No pre-order items table insert.

**Result**

- `table_booking_items` stays empty for every website booking.
- `customers.first_name / last_name / email` not populated for new customers.
- `table_bookings.dietary_requirements` and `.allergies` array columns stay null; the data is inside the free-text blob.
- Admin pre-order UI, kitchen PDF, prep emails, analytics — all read the empty structured tables and miss the data.

### 3.3 Staff path (already works)

`src/app/api/foh/bookings/route.ts` already accepts `sunday_preorder_items: SundayPreorderItem[]` and calls `saveSundayPreorderByBookingId()` (line 1373 onwards) to populate `table_booking_items` correctly. It's used by the BOH/FOH admin UI only — never by the public website. The management side already has working code that just needs to be invoked from the public route.

### 3.4 Proposed data flow (to-be)

**Website proxy** — stop losing structured data:

1. Remove the `isNewShape` heuristic; parse known shapes explicitly (legacy form vs. new form). Both shapes should map to the same outbound payload.
2. Always extract first name, last name, email, dietary requirements, allergies, special requirements, and menu selections and forward them as structured fields.
3. Deprecate `buildLegacyNotes` — the management API should receive a clean `notes` field containing only the user's free-text notes (the "Special requirements" textarea contents), nothing else.
4. Forward `menu_selections` unchanged to the management API.

**Management API (public route)** — extend the schema and persist correctly:

5. Extend `CreateTableBookingSchema` in `src/app/api/table-bookings/route.ts`:
   ```ts
   dietary_requirements: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
   allergies: z.array(z.string().trim().min(1).max(100)).max(20).optional(),
   special_requirements: z.string().trim().max(500).optional(),
   sunday_preorder_items: z.array(SundayPreorderItemSchema).max(40).optional(),
   ```
6. Pass `dietary_requirements` and `allergies` through to `create_table_booking_v05` — **requires migration** to either add these parameters to the RPC or update the booking row post-insert.
7. After the RPC returns a `table_booking_id`, if `sunday_preorder_items` is non-empty, call the existing `saveSundayPreorderByBookingId(supabase, { bookingId, items, staffOverride: true })` — same pattern as the FOH route.
8. When `ensureCustomerForPhone` finds an existing customer, **don't overwrite** a populated name/email with a null one; but **do** fill in blanks for phone-only customers.

### 3.5 Scope & sequencing

Because of the RPC change and customer-merge nuances, this is split into three PRs that each land independently:

| PR | Scope | Ships alone? |
|----|---|---|
| A1 | Website proxy: parse both shapes uniformly, forward first/last/email + structured dietary/allergies, stop stuffing them into notes | Yes — management API already accepts first/last/email; dietary/allergies will simply be ignored until A2 lands |
| A2 | Management side: extend Zod schema, extend RPC (or post-update) to persist `dietary_requirements`, `allergies`, `sunday_preorder_items`, plus call `saveSundayPreorderByBookingId` | Depends on A1 to actually receive the fields |
| A3 | Backfill migration: for each `table_bookings` row with empty arrays and a populated `special_requirements` blob whose first line matches `Name: …`, parse the blob and back-populate customers and arrays. Dry-run first, then apply. Only if owner wants history rewritten. | Optional — cosmetic |

### 3.6 Open questions (for owner)

1. Should the website proxy's new-shape path also be consolidated? The form currently sends one shape; there's no clear reason for the proxy to keep supporting both. Recommend: kill the legacy branch.
2. Backfill of historical rows (A3) — nice-to-have or skip? The kitchen PDF stays non-ideal for pre-2026-04-18 bookings if we skip.
3. Customer merge behaviour — if a phone-only existing customer books again with their name filled in, do we want to write their name back to the `customers` row? Assuming yes unless told otherwise.
4. Should new-booking emails to the manager include pre-order items in the body (currently missing)? Out of scope unless confirmed.

### 3.7 Acceptance criteria

- A website-originated Sunday lunch booking produces: a `customers` row with first/last/email populated; a `table_bookings` row with populated `dietary_requirements` and `allergies` arrays and a `special_requirements` containing only the user's free-text note; one `table_booking_items` row per distinct pre-order line.
- Admin "Pre-order" tab on the new booking shows structured rows matching the customer's selection.
- Kitchen PDF for that Sunday shows the booking's pre-order items in the pivot.
- Pre-existing FOH/admin creation path is unchanged.
- No regression in total booking success rate.

### 3.8 Risks

- RPC signature change (A2) — must be additive with default parameters. A deploy-order mismatch between website and management API is already mitigated by the proxy: extending the schema is non-breaking.
- Customer merge behaviour — if we overwrite names carelessly we could lose curated data. A2 must only fill blanks.
- The "new shape" branch — any external integrator (if any exists) relying on the legacy shape would break if we drop it. Assumption: only the-anchor.pub site uses this endpoint. Worth confirming.

---

## 4. Delivery plan

| Day | Work |
|---|---|
| Today (2026-04-18) | Spec approval. Ship **Problem B fix** (2-line change + logger + test). Revenue restored. |
| 2026-04-21 | Ship PR A1 — website proxy refactor + tests. |
| 2026-04-22 or later | Ship PR A2 — management API + RPC migration + `table_booking_items` persistence + tests. |
| 2026-04-23+ | Decide on PR A3 (backfill) based on owner preference. |

## 5. Assumptions (please confirm)

1. The public website is the only external caller of `POST /api/table-bookings` on the management API. No third parties, no mobile apps.
2. The PayPal webhook (`/api/webhooks/paypal/table-bookings`) either already works correctly or can be fixed in the same PR as Problem B. To be verified before the fix ships.
3. No staff-created bookings have been affected (FOH path is separate). To be spot-checked.
4. Historic stranded bookings (5 weeks' worth of `payment_hold_expired` cancellations) do not need to be contacted — the money was never captured.
5. Sunday lunch deposit is still £10 per person and still applies to every party size (the log message mentions £5 — likely a stale copy in the business-hours status message; to be confirmed).

## 6. Out of scope

- Real table-availability check (Issue 3 from the 2026-03-21 review memo) — still tracked separately.
- Deposit-warning banner for groups of 7+ on the website form.
- Mobile scrolling / date-format improvements from the 2026-03-21 review.
- Redesigning the admin pre-order tab UI.
- Refactoring the deprecated `/api/booking/submit` website route.

## 7. Verification checklist before closing

- [ ] Problem B: Vercel logs show capture-order returning 200 for new production Sunday lunch bookings.
- [ ] Problem B: PayPal webhook path verified (no secondary bug hiding).
- [ ] Problem A: A new test Sunday lunch booking results in populated `table_booking_items`, populated customer columns, and populated dietary/allergy arrays.
- [ ] Problem A: Admin pre-order tab shows structured items for the new booking.
- [ ] Both: regression check on regular (non-Sunday, non-deposit) bookings — unchanged.

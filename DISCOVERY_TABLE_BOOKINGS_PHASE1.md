# Table Bookings System — Phase 1 Discovery Report

**Date:** 2026-03-07
**Scope:** Current state mapping of table-bookings system (public and admin flows)
**Status:** Comprehensive discovery complete

---

## EXECUTIVE SUMMARY

The table-bookings system is a sophisticated multi-state booking flow with two distinct payment paths:
1. **Card capture** (legacy)
2. **Deposit payment** (current standard)

Public bookings redirect to external domain (`the-anchor.pub/whats-on`). All core logic lives in Supabase RPC functions and server actions. Admin/staff use BOH (back-of-house) views for booking management. Event-linked bookings use an entirely separate RPC function and are exempt from deposit rules.

---

## 1. BOOKING CREATION FLOW

### Customer Journey (Public)

**Entry Point:** `POST /api/table-bookings/` (external form on the-anchor.pub)

**Required Input Fields:**
- `phone` (E.164 format after normalization)
- `date` (ISO 8601: `YYYY-MM-DD`)
- `time` (HH:MM or HH:MM:SS)
- `party_size` (integer: 1–20)
- `purpose` (enum: `'food'` | `'drinks'`)
- `first_name` (optional)
- `last_name` (optional)
- `email` (optional)
- `notes` (optional, max 500 chars)
- `sunday_lunch` (boolean, optional)
- `default_country_code` (optional, for phone normalization)

**Validation Layers:**
1. **Idempotency check** — request hash against previous requests
2. **Phone normalization** — validated to E.164 format
3. **Customer resolution** — creates or finds customer record
4. **RPC validation** — `create_table_booking_v05()` orchestrates all subsequent checks

**RPC Validation Steps (inside `create_table_booking_v05()`):**
1. **Service window validation** — calls `table_booking_matches_service_window_v05()`
   - Checks `business_hours.schedule_config` JSONB slots
   - Maps to error: `'outside_service_window'`
2. **Event conflict check** — prevents customer double-booking with event registrations
3. **Core booking creation** — calls `create_table_booking_v05_core()`
   - Creates `table_bookings` row with initial status
   - Table assignment via constraint triggers
   - Determines initial state based on deposit rules

**Possible States After Creation:**

| State | Reason | Next Step |
|-------|--------|-----------|
| `confirmed` | Party size < 7 AND not Sunday lunch | Booking confirmed; manage link sent |
| `pending_card_capture` | Card capture required (legacy flow) | Customer receives card capture link |
| `pending_payment` | Party size ≥ 7 OR Sunday lunch | Customer receives deposit payment link |
| `blocked` | Various validation failures | No booking created; error returned to customer |

**Blocked Reasons:**
- `outside_service_window` / `outside_hours` — not within pub/kitchen operating hours
- `cut_off` — advance booking cutoff violated
- `no_table` — no available table for party size
- `private_booking_blocked` — overlaps with private event
- `too_large_party` — exceeds max party size
- `customer_conflict` — customer has conflicting event booking
- `in_past` — booking date in past

### Admin Flow (Staff Portal)

**Location:** `/table-bookings/boh` (back-of-house view)

**Available Actions:**
- Create booking directly (walk-in or manual entry)
- View all bookings (filterable by status, date range, search)
- Update party size
- Mark seated / left / completed / no-show / cancelled
- Move table assignment
- Send SMS to customer
- Manage deposits (approve, request payment, collect no-show fee)

**Walk-in Bookings:** Bypass deposit requirements; marked with source `'walk-in'`.

---

## 2. BOOKING AMENDMENT FLOW

### Deposit Triggers (Party Size Threshold)

**Rule:** Deposit required if:
- **Sunday lunch** (any party size), OR
- **Party size ≥ 7** (any day)

**Deposit Amount:** £10 per person
**Source Code:** `DEPOSIT_PER_PERSON_GBP = 10` (src/lib/table-bookings/bookings.ts:16)

**RPC Definition:** Migration 20260425000000 generalizes to all 7+ bookings:
```sql
-- Line 48 of create_table_booking_v05_core():
IF COALESCE(p_sunday_lunch, false) = false AND COALESCE(p_party_size, 0) < 7 THEN
  RETURN v_result;
END IF;
```

### Customer-Facing Amendment

**Manage Link:** Guest token action type `'manage'`
**Expiry:** Min 1 hour, max 30 days; extends to booking start + 48 hours
**Current Status:** Supports seat increases only
**Limitations:**
- Cannot reduce party size (no reduction fee logic confirmed, but late-cancel fee exists)
- Cannot amend date/time (no reschedule logic found)
- Cannot amend guest name

**Amendment Limitations Enforced:**
- `can_cancel: false` blocks cancellation if within 24 hours of booking start
- `can_edit: false` blocks edits on cancelled/no-show bookings
- Three-day commit cutoff for party size reductions (fee applied)

### Admin Amendment

**Staff can update:**
- Party size (committed_party_size column)
- Status (seated, left, no_show, cancelled, confirmed, completed)
- Table assignment
- Payment status

**No direct support for:**
- Date/time changes
- Guest name edits
- Notes/special requirements edits (appears read-only)

---

## 3. BOOKING CANCELLATION FLOW

### Customer-Initiated Cancellation

**Via Manage Link:**
- POST `/g/[token]/manage-booking/action` with action `'cancel'`
- Late-cancel fee applied if within 24 hours of booking start
- Fee amount: stored in `charge_requests` table, requires staff approval
- Refund handled via `refund_request` table

**Refund Statuses:**
- `succeeded` — refund completed
- `pending` — awaiting bank processing
- `manual_required` — requires manager intervention
- `failed` — failed attempt

### Staff-Initiated Cancellation

**Via BOH or API:**
1. **DELETE endpoint:** `/api/boh/table-bookings/[id]` (HTTP DELETE)
   - Soft delete only (updates status to `'cancelled'`)
   - Records `cancelled_at`, `cancelled_by`, `cancellation_reason`
   - Blocks if booking already: completed, no_show, or cancelled

2. **Status update endpoint:** `/api/boh/table-bookings/[id]/status` (POST with action: `'cancelled'`)
   - Uses `buildStaffStatusTransitionPlan()` to validate state transition
   - Audit log recorded with `cancellation_reason`

**Soft Delete Logic:**
```typescript
status: 'cancelled',
cancelled_at: nowIso,
cancelled_by: 'staff',
cancellation_reason: 'boh_soft_delete'
```

### Deposit Refund on Cancellation

**Policy:** Unclear from code review
- Payment table records exist but refund logic not explicitly found in booking.ts
- Stripe webhook handlers process refunds for paid deposits
- Requires staff review for late cancellations

**Data Preservation:**
- All booking data retained (soft delete only)
- Payment records preserved with status and metadata
- No irreversible deletion of financial records

---

## 4. NO-SHOW HANDLING

### Definition
Status: `'no_show'`
Marked: Can only be set **after** booking start time
Blocks: Cannot mark as no-show before booking start

### Staff Action to Mark No-Show

**Endpoint:** `POST /api/boh/table-bookings/[id]/status` with action `'no_show'`

**Automatic Charge Request Creation:**
```javascript
const committedPartySize = Math.max(1, committed_party_size || party_size)
const feePerHead = await getFeePerHead(supabase)
const suggestedAmount = committedPartySize * feePerHead

const chargeRequest = await createChargeRequestForBooking(supabase, {
  bookingId: booking.id,
  customerId: booking.customer_id,
  type: 'no_show',
  amount: suggestedAmount,
  requestedByUserId: auth.userId,
  metadata: { fee_per_head, source: 'boh_manual_no_show' }
})
```

**Fee Per Head:** Configurable via `getFeePerHead()` — stored in `system_settings` or defaults to TBD

### No-Show Statuses & Visibility
- BOH filter shows `'no_show'` status
- Customer record shows problem bookings: regex `/cancel|no show|expired|failed|rejected/i`

---

## 5. SMS & EMAIL TEMPLATES — EXACT WORDING

### Created SMS Templates

**Source:** `src/lib/table-bookings/bookings.ts`

#### Template 1: Card Capture Required
**State:** `pending_card_capture`
**Function:** `sendTableBookingCreatedSmsIfAllowed()` (line 763–766)

```
The Anchor: Hi {firstName}, please add card details to hold your table
booking for {partySize} {seatWord} on {bookingMoment}. No charge now.
Complete here: {nextStepUrl}
```

**Or (if URL unavailable):**
```
The Anchor: Hi {firstName}, please add card details to hold your table
booking for {partySize} {seatWord} on {bookingMoment}. No charge now.
We will text your card details link shortly.
```

**Metadata Key:** `'table_booking_pending_card_capture'`

---

#### Template 2: Deposit Payment Required
**State:** `pending_payment`
**Function:** `sendTableBookingCreatedSmsIfAllowed()` (line 767–771)

```
The Anchor: Hi {firstName}, please pay your {depositKindLabel} of
{depositLabel} ({partySize} x GBP {DEPOSIT_PER_PERSON_GBP}) to secure
your table for {partySize} {seatWord} on {bookingMoment}.
Pay now: {nextStepUrl}
```

**Or (if URL unavailable):**
```
The Anchor: Hi {firstName}, please pay your {depositKindLabel} of
{depositLabel} ({partySize} x GBP {DEPOSIT_PER_PERSON_GBP}) to secure
your table for {partySize} {seatWord} on {bookingMoment}.
We will text your payment link shortly.
```

**Where:**
- `depositKindLabel`: `'Sunday lunch deposit'` if Sunday lunch, else `'table deposit'`
- `depositLabel`: Formatted currency e.g., `'£70.00'`

**Metadata Key:** `'table_booking_pending_payment'`

---

#### Template 3: Booking Confirmed (Immediate)
**State:** `confirmed`
**Function:** `sendTableBookingCreatedSmsIfAllowed()` (line 772–773)

```
The Anchor: Hi {firstName}, your table booking for {partySize} {seatWord}
on {bookingMoment} is confirmed. Manage booking: {manageLink}
```

**Or (if manage link unavailable):**
```
The Anchor: Hi {firstName}, your table booking for {partySize} {seatWord}
on {bookingMoment} is confirmed.
```

**Metadata Key:** `'table_booking_confirmed'`

---

#### Template 4: Confirmed After Card Capture
**Function:** `sendTableBookingConfirmedAfterCardCaptureSmsIfAllowed()` (line 917)

```
The Anchor: Hi {firstName}, card details are added and your table booking
for {partySize} {seatWord} on {bookingMoment} is confirmed.
Manage booking: {manageLink} {preorderCTA}
```

**Preorder CTA (Sunday Lunch only):**
- If 26–48 hours before booking: `"Final reminder: please complete your Sunday lunch pre-order. Complete here: {sundayPreorderLink}"`
- Otherwise: `"Please complete your Sunday lunch pre-order. Complete here: {sundayPreorderLink}"`

**Metadata Key:** `'table_booking_card_capture_confirmed'` or `'sunday_preorder_reminder_26h'` or `'sunday_preorder_reminder_48h'` or `'sunday_preorder_request'`

---

#### Template 5: Confirmed After Deposit Payment
**Function:** `sendTableBookingConfirmedAfterDepositSmsIfAllowed()` (line 1063)

```
The Anchor: Hi {firstName}, your {depositPhrase} is received and your
table booking for {partySize} {seatWord} on {bookingMoment} is confirmed.
Manage booking: {manageLink} {preorderCTA}
```

**Where:**
- `depositPhrase`: `'Sunday lunch deposit'` if Sunday lunch, else `'table deposit'`

**Preorder CTA:** Same as Template 4

**Metadata Key:** `'table_booking_deposit_confirmed'` or Sunday preorder variants

---

### Manager Email Template

**Recipient:** `manager@the-anchor.pub`
**Trigger:** New booking created (excluded: walk-in bookings)
**Function:** `sendManagerTableBookingCreatedEmailIfAllowed()` (line 277–394)

**HTML Body:**

```html
<p>A new table booking has been created.</p>
<ul>
  <li><strong>Reference:</strong> {bookingReference}</li>
  <li><strong>When:</strong> {bookingMoment}</li>
  <li><strong>Party size:</strong> {partySize}</li>
  <li><strong>Status:</strong> {status}</li>
  <li><strong>Type:</strong> {bookingType}</li>
  <li><strong>Purpose:</strong> {bookingPurpose}</li>
  <li><strong>Source:</strong> {source}</li>
  <li><strong>Created via:</strong> {createdVia}</li>
  <li><strong>Guest:</strong> {customerName}</li>
  <li><strong>Phone:</strong> {customerPhone}</li>
  <li><strong>Email:</strong> {customerEmail}</li>
  [<li><strong>Notes:</strong> {notes}</li> — if present]
</ul>
```

**Subject:** `New table booking: {bookingReference}`

---

### SMS Suffix: Reply Instruction

**Function:** `ensureReplyInstruction()` appends support phone
**Location:** `src/lib/sms/support.ts`

All booking SMSs include: "To reply, text {supportPhone}." or similar

**Support Phone:** `process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER` or `process.env.TWILIO_PHONE_NUMBER`

---

## 6. LEGACY "CREDIT CARD HOLD" LANGUAGE — AUDIT

### Search Results

**Found 0 instances** of:
- "credit card hold"
- "card hold"

**Found 1 instance** of phrase structure (but not legacy):
- File: `src/app/api/boh/table-bookings/[id]/status/route.ts` line 78
  - Text: `'Sunday lunch booking cannot be seated until the GBP 10 per person deposit is paid.'`
  - Context: Validation error, modern language ✓

### Current Terminology

All SMS and email use **deposit language** exclusively:
- "deposit" (table or Sunday lunch)
- "payment link"
- "secure your table"
- "card details" (for card capture flow, explicitly not a hold)

**Conclusion:** Legacy terminology appears to have been completely removed. All communication uses modern deposit/payment language.

---

## 7. EVENT-LINKED BOOKINGS — EXEMPTIONS

### Structural Separation

**Table Bookings RPC:** `create_table_booking_v05()`
**Event Bookings RPC:** `create_event_booking_v05()` or `create_event_table_reservation_v05()`

**Key Distinction (from migration 20260425000000, line 2–3):**
```sql
-- Event bookings are structurally excluded because they
-- use create_event_table_reservation_v05, never create_table_booking_v05.
```

### Deposit Exemption

**Event bookings:**
- Handled entirely by event RPC
- DO NOT call `create_table_booking_v05()`
- DO NOT trigger deposit logic
- Therefore, exempt from £10 per person rule

### Event Conflict Guard

**In Table Booking:** Checks if customer has conflicting event booking
**Blocks with:** `'customer_conflict'` reason

**Mechanism (migration 20260420000019):**
- Before creating table booking, verify customer is not registered for overlapping event
- If conflict: return blocked state

### Mixed Bookings Not Supported

No evidence of mixed table + event at same time slot. Separate RPC paths enforce separation.

---

## 8. CUSTOMER RECORD LINKING

### Customer Identification

**Phone:** Primary key for customer resolution
- Normalized to E.164 format (`+44...`)
- Created or merged via `ensureCustomerForPhone()`
- Library: `src/lib/sms/customers.ts`

**Fields Captured:**
- `first_name`
- `last_name`
- `email`
- `mobile_number` (E.164)
- `mobile_e164` (alias)
- `sms_status` (active/suspended)

**Booking Link:**
- `table_bookings.customer_id` (foreign key)
- Allows linking multiple bookings to one customer

### Booking Record

**Schema Columns:**
- `id` (UUID, primary key)
- `customer_id` (UUID, FK → customers.id)
- `booking_reference` (human-readable, unique)
- `booking_date`, `booking_time`, `start_datetime`
- `party_size`, `committed_party_size`
- `status`, `payment_status`, `card_capture_required`
- `seats_or_covers` (from table assignment)
- `table_ids` (denormalized from assignments)
- `booking_type` (e.g., `'sunday_lunch'`)
- `booking_purpose` (e.g., `'food'`, `'drinks'`)
- `special_requirements` (notes)
- `created_at`, `updated_at`
- `seated_at`, `left_at`, `no_show_at`, `cancelled_at`
- `cancelled_by`, `cancellation_reason`

---

## 9. ADMIN BOOKING MANAGEMENT UI

### Back-of-House (BOH) View

**Location:** `src/app/(authenticated)/table-bookings/boh/`
**Component:** `BohBookingsClient.tsx`

**Visible Data (per booking):**
| Field | Source |
|-------|--------|
| Reference | `booking_reference` |
| Date & Time | `start_datetime` formatted London time |
| Guest Name | `customer.first_name + customer.last_name` |
| Party Size | `party_size` / `committed_party_size` |
| Status | Visual mapping of `status` (confirmed, seated, left, no_show, cancelled, pending_payment, pending_card_capture, completed) |
| Tables | Assigned table names |
| Phone | `customer.mobile_number` |
| Purpose | `booking_purpose` (food/drinks) |
| Booking Type | `booking_type` (sunday_lunch, etc.) |
| Payment Status | `payment_status` |

**Available Actions:**

1. **Mark Status Change**
   - `seated` — customer arrived
   - `left` — customer departed
   - `no_show` — customer did not arrive
   - `cancelled` — cancel booking
   - `confirmed` — restore from other statuses
   - `completed` — mark booking as completed

2. **Move Table** — reallocate to different table
3. **Update Party Size** — adjust committed party size
4. **Delete Booking** — soft delete (becomes cancelled)
5. **Send SMS** — compose and send message to customer
6. **View Payment Status** — see deposit/payment state
7. **Filter & Sort**
   - By status (all, confirmed, pending payment, pending card capture, seated, left, no_show, cancelled, completed, etc.)
   - By date range (day, week, month views)
   - Search by reference, name, phone, table name

---

## 10. GAPS, CONTRADICTIONS & UNKNOWNS

### Data Inconsistencies

1. **`committed_party_size` vs `party_size`**
   - Logic uses `GREATEST(1, COALESCE(committed_party_size, party_size, ...)`
   - When/how is `committed_party_size` updated?
   - Amendment flow doesn't clarify: does it update `party_size` or `committed_party_size`?

2. **`payment_status` vs booking `status`**
   - `status` includes `pending_payment`
   - Separate `payment_status` column on `table_bookings`
   - Values unclear; not consistently set in code review

3. **Hold Expiry Calculation**
   - `hold_expires_at` set in RPC:
     - If booking in past: +15 minutes
     - If booking future: MIN(booking_start, now + 24 hours)
   - Validation of hold expiry happens **during SMS send alignment**
   - What happens if hold expires before SMS send? No clear flow

### Undefined Behaviors

4. **Late Cancellation Fee**
   - Code references `'late_cancel'` charge type
   - Cutoff: within 24 hours of booking start
   - Amount calculation: **unclear** (no explicit formula found)
   - Must review `createChargeRequestForBooking()` in manage-booking.ts

5. **Party Size Reduction**
   - Manage link shows reduction available
   - "Three-day commit cutoff" mentioned in manage-booking.ts:69
   - Fee calculation: **not found in code review**
   - Does reduction refund the deposit difference?

6. **No-Show Fee Amount**
   - `getFeePerHead()` calls supabase to fetch fee
   - Fee per head source: **undocumented**
   - Is it % of deposit, fixed amount, or system-configurable?

7. **Deposit Timeout**
   - If customer never completes card capture / deposit payment, what happens?
   - Hold expires, but booking remains `pending_payment` / `pending_card_capture`
   - Automatic cancellation? Manual cleanup? **Unclear**

### Missing Features / Undocumented

8. **Amendment via Manage Link**
   - Supports seat increases only
   - **No reschedule / date-time change**
   - **No guest name edits**
   - **No notes updates**

9. **Bulk Operations**
   - No evidence of bulk cancellations
   - No evidence of bulk status changes
   - Admin must update one-by-one

10. **Audit Trail**
    - Soft deletes and status changes are logged
    - Manage link usage (seat increase) audit: **unclear if logged**
    - No customer-visible audit log in code review

### Permission & Authorization

11. **Booking Deletion vs Status Cancellation**
    - DELETE endpoint requires `'manage'` permission
    - Status POST requires `'edit'` permission
    - Difference not documented; may be legacy remnant

12. **Walk-in Bookings**
    - Skip email to manager
    - Skip deposit requirements
    - But: no permission check preventing non-staff from creating walk-ins via API

### SMS/Email Edge Cases

13. **SMS Delivery Failures**
    - Safety checks exist for rate limits, suspension
    - But: what if SMS send scheduled for later, then booking is cancelled?
    - Scheduled SMS cancellation: **not found**

14. **Missing Phone Number**
    - Code falls back to `customer.mobile_number` or normalized phone
    - If neither exists: SMS not sent
    - Email to manager still sent (customer email may be empty)

---

## SCHEMA SNAPSHOT

### Key Tables

| Table | Purpose | Relevant Columns |
|-------|---------|------------------|
| `table_bookings` | Core booking record | id, customer_id, status, party_size, committed_party_size, hold_expires_at, payment_status, seated_at, left_at, no_show_at, cancelled_at, cancellation_reason |
| `customers` | Linked customer data | id, first_name, last_name, mobile_e164, email, sms_status |
| `booking_table_assignments` | Table-booking link | table_booking_id, table_id, start_datetime, end_datetime |
| `payments` | Payment records | id, table_booking_id, charge_type (table_deposit, no_show), amount, currency, status, stripe_checkout_session_id |
| `booking_holds` | Payment/card capture holds | id, table_booking_id, hold_type (payment_hold, card_capture_hold), status, expires_at, seats_or_covers_held |
| `card_captures` | Card capture transactions | table_booking_id, status, stripe_setup_intent_id, expires_at |
| `guest_tokens` | Manage links | hashed_token, action_type (manage, payment, card_capture), table_booking_id, customer_id, expires_at, consumed_at |
| `charge_requests` | Fee request tracking | id, table_booking_id, type (no_show, late_cancel, reduction_fee), amount, status, requested_by |

### RPC Entry Points

| RPC | Purpose | Permission |
|-----|---------|-----------|
| `create_table_booking_v05(customer_id, date, time, party_size, purpose, notes, sunday_lunch, source)` | Main booking creation | service_role |
| `create_table_booking_v05_core(...)` | Deposit/hold logic | service_role |
| `create_event_booking_v05(...)` | Event-linked bookings | service_role |
| `table_booking_matches_service_window_v05(date, time, purpose, sunday_lunch)` | Time validation | service_role |

---

## REPORT DEPENDENCIES & NEXT PHASE

### Data Required for Phase 2

1. **Deposit Timeout Policy** — When do `pending_payment` bookings auto-cancel?
2. **Late-Cancel Fee Schedule** — Amount / percentage for 24-hour window?
3. **No-Show Fee Per Head** — Stored in `system_settings`; value required
4. **Party Size Reduction Fee** — Is there a fee? Calculation logic?
5. **Event Booking Integration** — Full RPC spec for `create_event_booking_v05()` or `create_event_table_reservation_v05()`
6. **Sunday Preorder Flow** — Is preorder mandatory? Cutoff logic?

### Questions for Product/Ops

1. Should cancelled bookings be truly hard-deleted or remain soft-deleted indefinitely?
2. What refund policy applies to cancelled bookings (immediate, weekly, manual)?
3. Do event bookings have deposit rules or are they always free?
4. Can customers reschedule a table booking, or must they cancel + rebook?
5. Should failed deposit payments trigger auto-cancellation or manual review?

### Identified Risks

1. **Orphaned Hold Records** — If payment fails, holds may remain active indefinitely
2. **No-Show Dispute Resolution** — No evidence of appeal/override mechanism
3. **Customer Communication Gap** — No evidence of cancellation confirmation SMS/email
4. **Deposit Amount Mismatch** — If party size increases after payment, deposit shortfall unclear how resolved
5. **Timezone Edge Cases** — All times stored/calculated in Europe/London; DST transitions may cause issues

---

## DELIVERABLES COMPLETE

✅ Step-by-step flow maps (sections 1–5)
✅ All SMS/email templates with exact wording (section 5)
✅ Zero instances of legacy "credit card hold" language (section 6)
✅ Gaps, contradictions, and unknowns documented (section 10)
✅ Key files & code locations referenced throughout

**Ready for Phase 2:** Payments Specialist audit, Technical Lead architecture review, QA scenario mapping.

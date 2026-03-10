# Design: Per-Booking Deposit Waiver (FOH)

**Date:** 2026-03-10
**Status:** Approved
**Scope:** FOH table bookings only (`/foh` page). Does not affect website API bookings.

---

## Problem

Deposits (£10/person) are required automatically for all bookings with party size ≥7 or Sunday lunch. There is no way to waive the deposit for a specific booking without using the blunt "management override" (super admin only) which also bypasses hours, service windows, and all other rules — making it semantically wrong and too powerful for this use case.

## Solution

Add a targeted, per-booking deposit waiver:
- A dedicated toggle on the FOH booking form, visible to managers and super admins
- Recorded as `deposit_waived = true` on the booking row (immutable audit trail)
- Booking confirms immediately with the standard confirmation SMS
- "Deposit waived" badge shown on the booking card/modal afterwards

---

## Decision Log

| Question | Decision |
|---|---|
| Per-booking or per-customer? | Per-booking |
| Who can waive? | Managers and super admins |
| What happens after waiver? | Booking confirms immediately, standard confirmation SMS sent |
| Visible afterwards? | Yes — "Deposit waived" badge on booking card and modal |

---

## Section 1: Database

**Migration:** Add one column to `table_bookings`:

```sql
ALTER TABLE table_bookings
  ADD COLUMN deposit_waived BOOLEAN NOT NULL DEFAULT FALSE;
```

- Defaults to `false` — no change to existing bookings
- Set to `true` at creation time only (immutable — never updated after creation)
- Additive only, zero migration risk

---

## Section 2: API & Server-Side Logic

**File:** `src/app/api/foh/bookings/route.ts`

### Schema validation

Add `waive_deposit?: boolean` to the Zod input schema. Extend the `superRefine` deposit check:

```typescript
if (
  value.management_override !== true &&
  value.waive_deposit !== true &&  // new escape hatch
  (value.sunday_lunch === true || value.party_size >= 7) &&
  value.sunday_deposit_method == null
) {
  ctx.addIssue({ /* existing validation error */ });
}
```

### Permission check

After auth resolution, before processing:

```typescript
if (payload.waive_deposit) {
  const isManagerOrAbove = userRole === 'manager' || userRole === 'super_admin';
  if (!isManagerOrAbove) {
    return Response.json({ error: 'Insufficient permissions to waive deposit' }, { status: 403 });
  }
}
```

### Booking creation path

When `waive_deposit === true`:
- Skip the `sunday_deposit_method` branch entirely (no cash recording, no payment token, no Stripe session)
- Call `create_table_booking_v05` RPC with `p_status: 'confirmed'` and `p_deposit_waived: true`
- Send standard confirmation SMS (same path as bookings that never required a deposit)
- Booking is created in `confirmed` state with `deposit_waived = true`

---

## Section 3: FOH UI

**File:** `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`
**File:** `src/app/(authenticated)/table-bookings/foh/page.tsx`

### Waive deposit toggle

Displayed when:
- `party_size >= 7` OR `sunday_lunch === true`
- AND `createMode !== 'walk_in'`
- AND `canWaiveDeposit === true` (manager or super admin)

Toggle appears **above** the Cash / Payment link selector. When checked:
- Cash / Payment link selector is hidden and cleared
- `waive_deposit: true` included in API payload

Default: unchecked. Existing behaviour unchanged when unchecked.

`canWaiveDeposit` prop derived in `page.tsx` — check user role server-side, pass as prop to `FohScheduleClient`.

### Booking badge

In the booking detail modal (and timeline block), when `booking.depositWaived === true`:

```
[Confirmed] [Deposit waived]
```

Badge styled as a muted amber/grey pill, distinct from the status badge. Visible to all staff who can view bookings.

---

## Section 4: RPC & TypeScript Types

### RPC: `create_table_booking_v05`

Add parameter:

```sql
p_deposit_waived BOOLEAN DEFAULT FALSE
```

Written directly to `table_bookings.deposit_waived`. No other RPC logic changes.

### TypeScript types

In `src/types/database.ts` (or generated types):

```typescript
// DB (snake_case)
deposit_waived: boolean;

// App type (camelCase)
depositWaived: boolean;
```

`fromDb<T>()` handles the conversion automatically.

### Queries

All existing queries that select from `table_bookings` and map to a `TableBooking` object must include `deposit_waived` in their `SELECT`. Likely 2–4 locations — implementation agent to identify.

---

## Files Touched

| File | Change |
|---|---|
| `supabase/migrations/<timestamp>_deposit_waiver.sql` | Add `deposit_waived` column |
| RPC migration or inline SQL | Add `p_deposit_waived` param |
| `src/types/database.ts` | Add `deposit_waived` / `depositWaived` to booking type |
| `src/app/api/foh/bookings/route.ts` | Schema, permission check, waiver booking path |
| `src/app/(authenticated)/table-bookings/foh/page.tsx` | Derive + pass `canWaiveDeposit` prop |
| `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx` | Waive toggle, badge display |

---

## Out of Scope

- Website API bookings — no change
- Per-customer deposit exemption flags — not part of this feature
- Modifying existing confirmed bookings to add a waiver retrospectively
- The existing management override toggle — untouched

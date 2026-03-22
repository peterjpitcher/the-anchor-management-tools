# QA Findings Validation — HIGH Severity (Batch 1)

Validated against code as of commit `12d416a1` on `main`.

---

## HIGH-001: Public booking endpoint allows mass-assignment of internal fields

**Claim:** `src/app/api/public/private-booking/route.ts:156` spreads raw request body into `CreatePrivateBookingInput`, including `customer_id`, `deposit_amount`, `status`, `created_by`.

**Verdict: PARTIALLY CONFIRMED**

The code at lines 156-165 does spread the raw body:

```typescript
const bodyWithoutCountryCode = { ...(body as PublicBookingRequest) };
delete bodyWithoutCountryCode.default_country_code;
const bookingPayload: CreatePrivateBookingInput = {
    ...bodyWithoutCountryCode,       // <-- attacker-controlled fields spread first
    contact_phone: normalizedPhone || body.contact_phone,
    status: 'draft',                 // overrides status
    source: 'website',               // overrides source
    items: body.items
};
```

**What IS mitigated:**
- `status` is explicitly overwritten to `'draft'` (line 161) — an attacker cannot set an arbitrary status.
- `source` is explicitly overwritten to `'website'` (line 162).

**What is NOT mitigated — attacker can inject:**
- `customer_id` — could associate the booking with an arbitrary existing customer (type allows `string | null`, line 171 of `CreatePrivateBookingInput`)
- `deposit_amount` — could set an arbitrary deposit amount (type allows `number`, line 188)
- `created_by` — could impersonate a staff member as the creator (type allows `string`, line 192)
- `hold_expiry` — could set an arbitrary hold expiry date
- `balance_due_date` — could manipulate payment timelines
- `internal_notes`, `contract_note` — could inject content into internal-facing fields

The finding is partially confirmed: the spread is real and several sensitive fields are injectable, but `status` and `source` are explicitly hardcoded after the spread, reducing the severity for those two fields. The remaining injectable fields (`customer_id`, `deposit_amount`, `created_by`, `hold_expiry`, `balance_due_date`) are still a genuine concern.

**Severity assessment:** Medium-High. The `customer_id` injection is the most concerning — it could link a booking to the wrong customer record. The `deposit_amount` injection could cause financial discrepancies.

---

## HIGH-002: Duplicate Twilio webhooks increment failure counters

**Claim:** `src/app/api/webhooks/twilio/route.ts:258` — duplicate status callbacks still call `applySmsDeliveryOutcome()`, and each retry increments `sms_delivery_failures`.

**Verdict: CONFIRMED**

At lines 809-828 in `handleStatusUpdate()`, when the incoming status matches the already-stored status (a duplicate callback), the code explicitly calls `applySmsDeliveryOutcome()` before returning:

```typescript
if ((existingMessage.twilio_status || '').toLowerCase() === messageStatus) {
    await applySmsDeliveryOutcome(adminClient, {     // <-- called on duplicate
        customerId: existingMessage.customer_id,
        messageStatus,
        errorCode: errorCode || null
    })
    // ... logs 'duplicate_status' ...
    return NextResponse.json({ success: true, note: 'Duplicate status ignored' })
}
```

In `applySmsDeliveryOutcome()` at line 258, for failure statuses:

```typescript
const nextFailures = Number(customer.sms_delivery_failures || 0) + 1
```

Each call reads the current counter and increments it by 1. There is no idempotency guard — if Twilio sends the same `failed` callback 4 times for a single message, the counter increments 4 times. Since deactivation triggers at `nextFailures > 3` (line 259), a single genuinely failed message could cause deactivation if Twilio retries the webhook enough times.

The line number cited (258) matches exactly. The issue is real and the severity is accurate — a customer could be incorrectly deactivated from SMS due to webhook retries on a single failure.

---

## HIGH-003: Payroll approval can proceed with silently missing data

**Claim:** `src/app/actions/payroll.ts:143` — `getPayrollMonthData()` fetches multiple datasets in parallel but only checks `shiftsError`.

**Verdict: CONFIRMED**

At lines 141-191, six queries run in parallel:

```typescript
const [
    { data: shifts, error: shiftsError },
    { data: sessions },            // error discarded
    { data: paySettings },         // error discarded
    { data: rateOverrides },       // error discarded
    { data: ageBands },            // error discarded
    { data: bandRates },           // error discarded
] = await Promise.all([ ... ]);

if (shiftsError) return { success: false, error: shiftsError.message };
```

Only `shiftsError` is destructured and checked (line 191). The other five queries destructure only the `data` property, silently discarding any errors. If any of these fail:

- **sessions** fails: all actual hours show as `null`, payroll shows zero worked time
- **paySettings** fails: salaried employees are included in hourly payroll calculations
- **rateOverrides** fails: employee-specific rates are missed, falling back to age band rates or `null`
- **ageBands** fails: all age-band rate lookups return `null`, hourly rates show as missing
- **bandRates** fails: same as ageBands — no rates resolved

The code uses `(sessions ?? [])`, `(paySettings ?? [])`, etc. (e.g., line 193, 201, 218, 227, 233), so a failed query where `data` is `null` is treated identically to an empty result set. The payroll could be approved with completely wrong calculations and no error would surface.

---

## HIGH-004: Parking capacity can be oversold under concurrent bookings

**Claim:** `src/services/parking.ts:85` — availability checked, then booking inserted separately with no transaction.

**Verdict: CONFIRMED**

At lines 85-90 in `createPendingParkingBooking()`:

```typescript
if (!input.capacityOverride) {
    const capacity = await checkParkingCapacity(input.startAt, input.endAt)
    if (capacity.remaining <= 0) {
        throw new Error('No parking spaces remaining for the selected period')
    }
}
```

Then at lines 104-138, the booking is inserted via `insertParkingBooking()`. These are two separate database operations with no transactional wrapper.

`checkParkingCapacity()` (in `src/lib/parking/capacity.ts`, lines 5-33) calls `supabase.rpc('check_parking_capacity', ...)` which is a read-only check. Between this check returning `remaining: 1` and the subsequent `insertParkingBooking()` call, another concurrent request could also see `remaining: 1` and both would insert, resulting in overbooking.

There is also work between the check and insert (customer resolution at lines 92-98, pricing calculation, etc.) that widens the race window.

The `capacityOverride` flag (line 85) provides a manual bypass but does not solve the concurrency issue for normal bookings.

**Note:** The practical severity depends on booking volume. For a pub car park this is likely low-frequency, but the TOCTOU gap is architecturally real. A database-level constraint or `SELECT ... FOR UPDATE` within a transaction would be the proper fix.

---

## Summary

| Finding | Verdict | Severity Adjustment |
|---------|---------|-------------------|
| HIGH-001 | PARTIALLY CONFIRMED | Medium-High (status/source are mitigated, but customer_id/deposit_amount/created_by are not) |
| HIGH-002 | CONFIRMED | High (duplicate webhooks can incorrectly deactivate customer SMS) |
| HIGH-003 | CONFIRMED | High (payroll can be approved with silently missing rate/session data) |
| HIGH-004 | CONFIRMED | Medium (TOCTOU gap is real but practical risk depends on concurrency volume) |

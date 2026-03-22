# Validation: MED-severity Bug Findings

## MED-001: Bulk receipt rollback wipes prior vendor classification instead of restoring

**Verdict: CONFIRMED**

File: `src/app/actions/receipts.ts`, lines 2653-2668.

The rollback block at line 2655-2668 sets `vendor_name: null`, `vendor_source: null`, `vendor_rule_id: null` unconditionally. It does not capture the prior values of these fields before overwriting them at line 2618-2621. The initial SELECT at line 2573 only fetches `id, status, amount_in, amount_out` -- it does not include `vendor_name`, `vendor_source`, or `vendor_rule_id`.

This means if a row already had a vendor classification (e.g. from a previous rule or manual assignment), and the expense update fails, the "compensating revert" destroys the original vendor data rather than restoring it. The code comments at lines 2604-2607 acknowledge this is not atomic (tracked as DEF-007), but the null-wipe behaviour is a concrete data-loss bug beyond the atomicity gap.

---

## MED-002: Auto-send invoices can email a draft invoice and then leave it unsent forever

**Verdict: CONFIRMED**

File: `src/app/api/cron/auto-send-invoices/route.ts`, lines 149-223.

The sequence is:
1. Email sent at line 149 (`sendInvoiceEmail`)
2. Status updated to `'sent'` at line 171-180

If the email succeeds (line 167: `emailSent = true`) but the status update fails at line 182, the invoice remains in `draft` status. The code does handle this case -- it writes a fallback email log at line 184-193 with the note "Manual reconciliation required" and persists an idempotency response with `state: 'processed_with_error'` (lines 206-221).

However, the idempotency claim (`cron:auto-send-invoice:{id}:{date}`) is date-scoped. On the next day's cron run, a new idempotency key would be generated. Meanwhile the `invoice_email_logs` check at lines 93-115 would find the fallback log entry with `status: 'sent'` and skip the invoice (`skipped_already_sent`). So the invoice will not be re-sent, but it will remain in `draft` status permanently unless manually reconciled. The claim that it is "left unsent forever" is misleading -- the email IS sent, but the DB status is stuck at `draft`.

The real bug: the invoice status remains `draft` in the database despite having been emailed to the customer. This is a data consistency issue, not a "draft invoice emailed" issue.

---

## MED-003: London date helpers use host timezone, not London

**Verdict: CONFIRMED**

File: `src/lib/dateUtils.ts`, lines 27-38.

`getTodayIsoDate()` (line 27-32) uses `now.getTimezoneOffset()` which returns the host machine's UTC offset, not London's. Similarly, `toLocalIsoDate()` (line 34-38) uses `copy.getTimezoneOffset()`.

On Vercel, the host timezone is UTC. London is UTC+0 in winter but UTC+1 during BST (British Summer Time). So during BST (roughly late March through late October), these functions return the wrong date between midnight and 1am London time -- they would return yesterday's date instead of today's.

In contrast, `formatDateInLondon()` (line 7-14) and `formatDate()` (line 16-25) correctly use `timeZone: LONDON_TIMEZONE` via the Intl API. The inconsistency is clear: display functions are timezone-aware, but the ISO date computation functions are not.

---

## MED-004: RBAC revocation effective for up to 60s after admin removal

**Verdict: DISPUTED**

File: `src/services/permission.ts`, lines 82-98 and 382-384.

The cache does use `unstable_cache` with `revalidate: 60` and a tag `permissions-{userId}` (line 97). However, the `setUserRoles` method at line 384 explicitly calls `revalidateTag(`permissions-${userId}`)` after modifying roles. This means when an admin changes a user's roles through the standard `setUserRoles` path, the cache IS invalidated immediately.

The 60-second TTL is a fallback for edge cases (e.g., direct DB manipulation or if a different code path modifies roles without calling `revalidateTag`). For the normal admin UI flow, revocation takes effect on the next request after the role change, not after 60 seconds.

Note: `revalidateTag` is Next.js server-side cache invalidation and works within the same deployment. It would not propagate across multiple Vercel serverless instances instantaneously, but in practice, `unstable_cache` with tag-based revalidation in Next.js invalidates the data cache entry globally (it marks the tag as stale in the data cache store).

---

## MED-005: Booking discounts have no server-side bounds check

**Verdict: CONFIRMED**

File: `src/app/actions/privateBookingActions.ts`, lines 802-817, and `src/services/private-bookings.ts`, lines 868-900.

The server action at line 802 accepts `discount_amount: number` with no validation. It checks `private_bookings.edit` permission (line 810), but there is:
- No check that `discount_amount >= 0`
- No check that a percentage discount is <= 100
- No check that a fixed discount does not exceed the booking total
- No Zod schema validation on the input

The service method `PrivateBookingService.applyBookingDiscount` (lines 878-888) directly writes the provided `discount_amount` to the database with no bounds checking. A staff user with edit permission could set a negative discount (effectively a surcharge) or a percentage over 100%.

---

## MED-006: Webhook handlers persist untrusted payloads before verification

**Verdict: PARTIALLY CONFIRMED (Twilio only)**

**PayPal** (`src/app/api/webhooks/paypal/route.ts`): DISPUTED. The PayPal handler verifies the signature at line 105 (`verifyPayPalWebhook`) BEFORE any webhook_logs write with status `'received'` (line 133). The only pre-verification log writes are for configuration errors (line 91, status `'configuration_error'`) and signature failures (line 107, status `'signature_failed'`), which are legitimate audit entries. The claimed line 82 is just the start of the POST handler, not a log write.

**Twilio** (`src/app/api/webhooks/twilio/route.ts`): CONFIRMED. At line 358, `logWebhookAttempt(publicClient, 'received', ...)` is called BEFORE signature verification at line 366. The untrusted payload (headers, body, params) is written to `webhook_logs` before verifying the Twilio signature. This means an attacker could flood the webhook_logs table with forged requests.

---

## MED-007: View-only staff can mint non-expiring booking portal links

**Verdict: CONFIRMED**

File: `src/app/actions/privateBookingActions.ts`, lines 1624-1644, and `src/lib/private-bookings/booking-token.ts`, lines 1-53.

**Permission**: Line 1634 checks `private_bookings.view` -- any staff member who can view bookings can generate portal links. This is by design per the comment at line 1622, but it is a broader permission than might be expected for generating external-facing links.

**Deterministic token**: `generateBookingToken` (booking-token.ts line 16-23) produces HMAC(CRON_SECRET, "booking-portal:{bookingId}"). The output is fully deterministic -- the same bookingId always produces the same token. There is no nonce, timestamp, or random component.

**No expiry**: The token contains no timestamp or expiry field. `verifyBookingToken` (lines 29-53) only checks the HMAC signature, not any time-based validity. Once generated, a token is valid forever (until CRON_SECRET is rotated).

The combination means: (1) any view-permission staff can generate a link, (2) the link never expires, and (3) the same link is generated every time for the same booking. If a booking is cancelled or should no longer be accessible, the portal link remains valid. The only mitigation would be rotating CRON_SECRET, which would invalidate ALL booking portal links.

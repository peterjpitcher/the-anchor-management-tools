# Implementation plan: invoice a private booking

Companion to `tasks/spec-private-booking-invoice.md` (the design). This is the build order.

Date: 2026-08-27
Status: **BUILT on `feat/private-booking-invoice`. Migrations written, NOT applied.**

## Build status

| Phase | State |
|---|---|
| 0 Schema drift | Migration written, not applied |
| 1 Foundations | Migration written, not applied |
| 2 Atomic function | Migration written, not applied, **proven against production data** |
| 3 Server action | Done, 24 tests |
| 4 Document and email | Done, 16 tests |
| 5 UI | Done |
| 6 Rollout | Owner's call |

Gates: typecheck 0 errors, lint 0 warnings, 693 test files / 5795 tests all
passing, production build exit 0.

### What was proven against real production data

The whole of phase 1 and 2 was executed inside a transaction that was rolled
back, using booking `6932f051` (gross total £1,140.00):

- Both migrations apply cleanly to the live schema.
- First call created `INV-003WD`, total £1,140.00, paid £0.00, status `draft`,
  2 line items, booking stamped `held_separately`.
- **Second call returned `created: false` and the same invoice number.** The
  idempotency guard holds: no second invoice, no second number burnt.
- After rollback: 50 invoices (unchanged), `invoice_series` still at 52, no
  leaked column, no leaked function. Production was not modified.

One thing that verification surfaced: the function calls
`assert_rpc_permission('invoices','create')`, which raises `42501` unless the
caller presents a `service_role` JWT claim. The server action uses
`createAdminClient()`, which does, so it early-returns. Anything else is
refused, which is the intent.

### Not built, and why

- **Booking and invoice balances still diverge** (debt item 1 below). Eleven
  surfaces read `private_booking_payments` and none reads `invoice_payments`.
  Staff must keep recording payments on the booking.
- **No correction path.** Unchanged from the spec: a credit note cannot
  increase an invoice, and reissue is OJ-Projects only.
- **Mandatory email on confirm** is a separate change.

**How to use this.** Work top to bottom. Each task lists the files, the change, and how to
prove it worked before moving on. Do not skip the verification steps: two of them exist
because production and source control currently disagree.

---

## Part 1: what Peter actually sees

This is the whole point, so it goes first. Everything after this is how we get here.

### Pressing the button

On a confirmed private booking, in the Quick Actions card just under "Send Contract to
Customer":

> **Generate and send invoice**

If it cannot be used, the reason sits in plain text underneath, always visible:
"Add an email address to invoice this booking", or "Add priced items before invoicing".
Not a tooltip, because tooltips do not work on a tablet and cannot be read by a keyboard.

### The dialog: nothing hidden

Clicking it opens a dialog that asks the deposit question **at the moment of use**. This is
not a setting to find beforehand.

```
Invoice Susan Herd
susan@example.com

  Venue hire: The Dining Room     4 hrs @ £25.00   100% off      £0.00
  Finger Buffet                  20 @ £16.00                   £320.00
  ----------------------------------------------------------------------
  Subtotal (excl. VAT)                                          £950.00
  VAT at 20%                                                    £190.00
  Invoice total                                               £1,140.00

  How should the £250.00 deposit be treated?

  (o) Hold it separately  (standard)
      Susan pays £1,140.00 now.
      Deposit refunded within 48 hours after the event.

  ( ) Take it off this invoice  (account customer)
      Susan pays £890.00 now.
      Deposit is used up, nothing refunded afterwards.

  Payments already received                                    -£0.00
  ======================================================================
  BALANCE DUE                                                £1,140.00

  Their reference or PO number  (optional, prints on the invoice)
  [ Herd 50th, 15 October 2026                                       ]
  Leave as it is for a private customer. Businesses often need their
  own PO number here or their finance team will not pay it.

           [ Cancel ]        [ Send invoice to Susan ]
```

The figures update as the choice changes, so the consequence is on screen before sending.

Rules for the dialog:

- The **standard** deposit option is preselected. It matches the signed contract, so it is
  the safe default.
- If the booking has **no deposit paid**, the question is not shown at all. Instead:
  "No deposit has been paid on this booking." Do not ask a question with no consequence.
- If the same booking is invoiced again later, the previous choice is preselected, and
  labelled "you chose this last time".
- The choice is **saved on the booking**, so afterwards anyone can see which rule was used
  and why the invoice looks the way it does. Nothing about the invoice is unexplained.
- The reference box is **prefilled** with the customer name plus event date, so it is never
  blank and a private customer can just leave it. Editable and clearable.

### After sending

The Quick Actions card replaces the button with:

> Invoice INV-003WD sent 27 August 2026 to susan@example.com
> Deposit held separately. **View invoice**

If the email failed:

> Invoice INV-003WD created but the email did not send.
> **Retry sending** (this will not create a second invoice)

---

## Part 2: the deposit rule

Two modes, chosen per booking in the dialog above.

| Mode | Invoice total | Deposit | Customer pays |
|---|---|---|---|
| Hold separately (default) | gross total | Stated as held, refunded after event | Full total |
| Take off invoice | gross total | Written as a payment against the invoice | Total minus deposit |

**Both modes use the same invoice total.** In "take off" mode the deposit is recorded as a
payment received, not as a discount. This matters: a discount would reduce the VAT, which
would be wrong, because the supply is still the full amount. Recording it as a payment
keeps the VAT correct and makes the balance fall out of arithmetic the invoice module
already does.

**Guard:** if deposit plus payments already received is greater than the invoice total,
block with "The deposit and payments received exceed the invoice total. This booking is
owed a refund, not an invoice." Three live bookings hit this: Lorna Wright, Millie Prynn,
Lauren Harmes.

**For the accountant, section 8 of the spec.** Applying a refundable damage deposit to a
taxable supply creates a tax point on that amount. Worth confirming the treatment before
the first account customer is invoiced. It does not block the build.

---

## Phase 0: fix the schema drift (do this first, on its own)

Production and source control disagree. Until this is fixed, any test written against a
fresh database proves nothing.

### Task 0.1: prove the drift

```sql
SELECT column_name, is_generated, generation_expression
FROM information_schema.columns
WHERE table_name = 'invoice_line_items'
  AND column_name IN ('subtotal_amount','discount_amount','vat_amount','total_amount');
```

Expected: all four `ALWAYS` with expressions. Then confirm no migration in
`supabase/migrations/` creates them that way. Production is ahead.

### Task 0.2: bring source control up to production

New migration. Use a guarded `DO` block that no-ops when the column is already generated,
so it is safe to run against production and against a fresh database.

### Task 0.3: verify

Build a database from migrations alone, insert one line item, and confirm the four money
columns populate identically to production. **Do not start phase 1 until this passes.**

### Migration mechanics, read before writing any migration

1. **Do not run `npx supabase db push`.** `20260819100000_leave_reminder_ledger.sql` is in
   the repo but was never applied, so a push sweeps it into production too. Use MCP
   `apply_migration`.
2. Number above `20260827140000`. The two security migrations applied today live on an
   unpushed branch, so production is ahead of every branch.

---

## Phase 1: database foundations

One migration, additive only. No behaviour change yet.

### Task 1.1: link the booking to its invoice

```sql
ALTER TABLE private_bookings
  ADD COLUMN invoice_id uuid REFERENCES invoices(id),
  ADD COLUMN invoice_sent_at timestamptz,
  ADD COLUMN invoice_deposit_treatment text
    CHECK (invoice_deposit_treatment IN ('held_separately','deducted'));

CREATE UNIQUE INDEX private_bookings_invoice_id_key
  ON private_bookings (invoice_id) WHERE invoice_id IS NOT NULL;
```

`invoice_deposit_treatment` is the saved answer to the dialog question. Null until asked.

### Task 1.2: make the payment copy idempotent

```sql
ALTER TABLE invoice_payments
  ADD COLUMN source_payment_id uuid
    REFERENCES private_booking_payments(id) ON DELETE SET NULL,
  ADD COLUMN source_kind text CHECK (source_kind IN ('booking_payment','booking_deposit'));

CREATE UNIQUE INDEX invoice_payments_invoice_source_key
  ON invoice_payments (invoice_id, source_payment_id) WHERE source_payment_id IS NOT NULL;

CREATE UNIQUE INDEX invoice_payments_invoice_deposit_key
  ON invoice_payments (invoice_id) WHERE source_kind = 'booking_deposit';
```

The second index is what stops the deposit being written twice on a retry. The deposit has
no row in `private_booking_payments` to point at, so it needs its own guard.

### Task 1.3: line ordering

```sql
ALTER TABLE invoice_line_items ADD COLUMN display_order integer NOT NULL DEFAULT 0;
CREATE INDEX idx_invoice_line_items_invoice_order
  ON invoice_line_items (invoice_id, display_order);
```

Then add an explicit `order` to **every** query that reads invoice line items. Without it,
PDF line order can change between generating, retrying and downloading.

### Task 1.4: vendor identity

```sql
ALTER TABLE invoice_vendors ADD COLUMN customer_id uuid REFERENCES customers(id);
CREATE UNIQUE INDEX invoice_vendors_customer_id_key
  ON invoice_vendors (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_invoice_vendors_email_lower
  ON invoice_vendors (lower(btrim(email))) WHERE email IS NOT NULL;
```

Match on `customer_id` only. Email is not unique and never can be an upsert key.

### Task 1.5: separate "sent" from "paid"

An invoice with payments on it is born `partially_paid` or `paid`. Stamping it `sent` would
destroy that, because `invoices.status` holds both ideas in one column.

```sql
ALTER TABLE invoices
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN sent_to text,
  ADD COLUMN payment_state text GENERATED ALWAYS AS (
    CASE WHEN total_amount > 0 AND paid_amount >= total_amount THEN 'paid'
         WHEN paid_amount > 0 THEN 'part_paid'
         ELSE 'unpaid' END) STORED;
```

Backfill `sent_at` from the earliest successful `invoice_email_logs` row, then from
`invoice_date` for anything still in `sent|partially_paid|overdue|paid`.

**New rule from here on:** delivered means `sent_at IS NOT NULL`, never `status = 'sent'`.

### Task 1.6: update the three crons in the same deploy

`auto-send-invoices`, `invoice-reminders`, `recurring-invoices` must key off `sent_at`.
Verify each behaves identically on the 50 existing invoices before and after.

### Task 1.7: recreate the views

`private_bookings_with_details`, `private_booking_summary`,
`private_booking_sms_reminders`, `customer_communications` all select explicit column
lists, so the new columns will not appear until recreated. The monitor cron reads the view.

---

## Phase 2: the atomic function

Everything in one transaction, so two clicks cannot make two invoices.

### Task 2.1: write it

```
create_private_booking_invoice_atomic(
  p_booking_id uuid,
  p_invoice_date date,
  p_due_date date,
  p_deposit_treatment text,   -- 'held_separately' | 'deducted'
  p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog'
```

Body, in order:

1. `SELECT * FROM private_bookings WHERE id = p_booking_id FOR UPDATE`. Lock first.
2. If `invoice_id IS NOT NULL`, load and return `{created: false, invoice}`. This is what
   makes retry safe. Raise `private_booking_invoice_missing_or_deleted` if it is gone.
3. Recheck eligibility under the lock: confirmed, not cancelled, not date-TBD, has priced
   items.
4. Allocate the invoice number inline, same INV series.
5. Insert invoice and line items with `display_order`. **Never name the four money columns
   on `invoice_line_items`**, they are generated.
6. Copy each `private_booking_payments` row into `invoice_payments` with
   `source_payment_id` and `source_kind = 'booking_payment'`.
   Map the method: `cash` to `cash`, `card` to `card`, **`invoice` to `other`**. The
   invoice side rejects `invoice`, and it would do so after the number is burnt.
7. If `p_deposit_treatment = 'deducted'` and a deposit was paid, write one more row with
   `source_kind = 'booking_deposit'`, dated `deposit_paid_date`.
8. Set `paid_amount` from the sum, and `status` from that. Do **not** call
   `record_invoice_payment_transaction`: it increments rather than re-derives and has no
   idempotency key.
9. Assert the invoice total equals `gross_total` exactly. Raise
   `invoice_total_reconciliation_failed` rather than send a wrong figure.
10. Assert `paid_amount <= total_amount`, else `booking_payments_exceed_invoice_total`.
11. `UPDATE private_bookings SET invoice_id = ..., invoice_deposit_treatment = ...
    WHERE id = $1 AND invoice_id IS NULL`, raising if `NOT FOUND`.

### Task 2.2: lock it down, in the same migration

```sql
REVOKE ALL ON FUNCTION public.create_private_booking_invoice_atomic(uuid,date,date,text,uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_private_booking_invoice_atomic(uuid,date,date,text,uuid)
  TO service_role;
```

New public functions are granted to PUBLIC by default and anon is in PUBLIC. There is no
default-privileges rule and no CI check, so this revoke must be explicit.

### Task 2.3: prove concurrency, do not assume it

Database integration tests:

- Two simultaneous calls produce **one** invoice and **one** number.
- A second call after a failed send returns the same invoice, no duplicate payments.
- Fault injection after each step leaves a recoverable state.
- Booking `82359696` (two payments, £50 and £40) does not double-count on retry.

---

## Phase 3: the server action

### Task 3.1: `generatePrivateBookingInvoice(bookingId, depositTreatment)`

Order: auth, **super_admin check**, load booking, upsert vendor, call the function, fetch
the complete invoice, store the snapshot, send the email, stamp `sent_at`/`sent_to`, audit,
revalidate.

### Task 3.2: the super_admin gate

`checkUserPermission` is **not** a super_admin gate. Managers already hold
`invoices.create`, `invoices.edit`, `private_bookings.create` and `private_bookings.edit`,
so every obvious permission pair passes for them today.

Use the explicit role check at `src/app/actions/gdpr.ts:19-33`. Add a test proving a
manager is refused.

### Task 3.3: dates

- `invoice_date` = today (London).
- `due_date` = **`GREATEST(balance_due_date, today)`**.

The `GREATEST` is not optional: 15 of 19 priced bookings have a `balance_due_date` in the
past, by up to 411 days. Without it you would issue invoices that are already overdue and
trigger a chase email immediately.

### Task 3.4: the customer reference / PO number

Nothing new is needed in the database. `invoices.reference` already exists and the PDF
already prints it as the third meta field
(`src/lib/invoice-template-compact.ts:358` and `:434-435`).

It is already used exactly this way in production, which settles the format question:

- Kier Services: all 19 invoices carry `20520136`, their PO number.
- DHL: `DHL UK IT Christmas Party 2025`, a corporate party invoiced by hand. This is the
  closest thing to a private booking invoice you have ever raised manually, and it used a
  descriptive reference.
- Orange Jelly work: `OJ Projects 2026-07`, `Dukes Head website, stage 1`.

So the field takes either a PO number or a plain description, and both are normal.

Work needed:

1. Pass the dialog's reference value through the action into `invoices.reference`.
2. Prefill it as `<customer name> <event type>, <event date>`, e.g.
   "Herd 50th, 15 October 2026". Never leave it blank.
3. Trim, and cap at the column length. Store null when cleared.
4. **Add it to the email body.** `src/lib/microsoft-graph.ts` does not print the reference
   at all today (verified). A finance team that asked for a PO number needs to see it in
   the email, not only in the attachment.

### Task 3.5: freeze the recipient

`src/lib/invoice-recipients.ts:56` and the auto-send cron both prefer a vendor primary
contact over the booking email. Pass the confirmed address explicitly so the invoice goes
where the dialog said it would.

### Task 3.6: store the snapshot

Save the issued PDF and its inputs to `private_booking_documents` with
`document_type = 'invoice'`. Later downloads serve the snapshot. Without this you cannot
reproduce what was actually sent, and VAT records must be kept six years.

---

## Phase 4: the document and the email

### Task 4.1: PDF totals

In invoice mode, when `paid_amount > 0`, render Invoice Total, Total Paid and Balance Due.
The receipt mode already does exactly this at lines 486 to 500 of
`src/lib/invoice-template-compact.ts`. Reuse `outstandingBalance` from line 340.

### Task 4.2: the deposit panel

Rendered from the stored snapshot, never live booking data, and never part of any total.

| Booking state | Live rows | Panel |
|---|---|---|
| Held separately, method known | 24 | "Booking and damage deposit of £X received on DATE by METHOD. Held separately, refunded within 48 hours after your event." |
| Held separately, no method | 16 | Same, without "by METHOD" |
| Deducted | 0 today | "Deposit of £X received on DATE has been applied to this invoice." |
| Waived | 5 | No panel |
| Not paid | 11 | No panel. **Never print "received on null"** |

### Task 4.3: fix the email body

`src/lib/microsoft-graph.ts:141` currently prints `Amount Due: <full total>` and nothing
else, so a part-paid customer is asked for the whole amount again. It must print Invoice
Total, Payments Received and Balance Due.

### Task 4.4: the copy

- The email signs off "Orange Jelly Limited". A party host expects The Anchor. Add a
  private-booking variant.
- The PDF says "Card Payments: Subject to additional fees". Consumer card surcharges are
  restricted in the UK. Remove it or get it approved before a customer sees it.

---

## Phase 5: the UI

### Task 5.1: the button

Copy the "Send Contract to Customer" markup at
`PrivateBookingDetailClient.tsx:3229-3250`. Persistent reason text underneath, not a
tooltip.

### Task 5.2: the dialog

Use `Modal` from `@/ds`, following the existing `PaymentModal` and `StatusModal` in the
same file. Contents exactly as Part 1. The deposit question is a radio pair with live
figures, and it is hidden when no deposit was paid.

### Task 5.3: bind the preview to the data

Generate the preview server-side with a hash of everything billed. On confirm, re-read
under the lock and compare. If it changed, return "This booking changed while you were
looking. Review again." Never trust totals sent from the browser.

### Task 5.4: accessibility

Focus trap and restore, keyboard close, labelled totals, announced errors. This is a
financial action on a tablet, so it has to work by keyboard and touch.

---

## Phase 6: rollout

Behind a feature flag. Invoice one real booking yourself, check the PDF and the email, then
open it up.

---

## What is deliberately not fixed

Say these out loud rather than discover them later.

1. **Two balance figures will coexist.** Eleven screens compute the booking balance from
   `private_booking_payments` and **none reads `invoice_payments`**. So a customer who pays
   the invoice can still be chased by SMS. **Until this is closed, staff must keep
   recording payments on the booking, not the invoice.** Put that sentence in the UI.
2. **There is no working correction path.** A credit note cannot increase an invoice, does
   not reduce the total, and the UI caps it at what has already been paid. Void works only
   while unpaid. Reissue is OJ-Projects only. So phase 1 should only invoice bookings whose
   items are final.
3. **Email becomes mandatory on confirm** is a separate change. Until it lands, 8 of 18
   billable bookings cannot be invoiced.
4. **The accountant's quarterly export filters to Orange Jelly projects**, so these
   invoices would be left out.

---

## Test matrix

| Area | Must cover |
|---|---|
| Mapper | 100% discounted room hire, fixed-amount discount, booking-level discount, per-head odd guest count |
| Reconciliation | Computed total equals `gross_total` for all 18 live billable bookings |
| Deposit modes | Held vs deducted produce the right balance; deducted blocked when deposit exceeds total |
| Concurrency | Two calls, one invoice |
| Retry | No duplicate payments, no second number, deposit not written twice |
| Born paid | Booking `b8821e0a` (£232.98 paid in full) is `paid` with `sent_at` null |
| Born part paid | Booking `c4bf2e52` (£642.00, £400.00 paid) |
| Method mapping | `invoice` maps to `other` and does not raise |
| Permissions | A manager is refused |
| Crons | Identical behaviour on the 50 existing invoices before and after `sent_at` |
| Deposit panel | All five states, including "no method" and "not paid" |
| Reference | Prefill format, edited value saved, cleared value stores null, appears on both PDF and email |

Use anonymised fixtures. Do not commit customer names.

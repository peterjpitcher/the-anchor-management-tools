# Spec v2: generate and send an invoice from a private booking

Status: decisions taken, redesigned after developer review. No code written.
Date: 2026-08-27 (v1), revised 2026-08-27 (v2)
Complexity: 5 (XL). Section 14 splits it.

**v2 supersedes v1.** It answers the developer review in
`tasks/spec-private-booking-invoice-developer-review.md`. Of that review's 43 checkable
claims, 31 verified TRUE, 9 PARTLY TRUE, 3 FALSE. The review was substantially right and
v1's workflow was not transactionally safe. Section 3 lists what v1 got wrong.

---

## 1. Decisions taken

Owner: Peter Pitcher. Decided 2026-08-27. These are settled and not open for redesign.

| # | Decision | Consequence |
|---|---|---|
| D1 | The deposit stays refundable and separate. The invoice deducts **only real payments**, never the deposit | Section 4 |
| D2 | One click generates **and** sends, with a confirmation dialog. No draft review step | Section 8 |
| D3 | Booking invoices use the **same INV- series** as all other invoices | No change needed |
| D4 | An email address becomes **mandatory** before a booking can be confirmed | Separate change, section 13 |
| D5 | **No postal address will be captured.** Name-only Bill To is accepted | Section 12 |
| D6 | **Only super_admin** may generate a booking invoice | Section 11 |

Acceptance for the feature as a whole: a super_admin can press one button on a confirmed
private booking and the customer receives, once, an invoice PDF whose total equals the
gross total already on their contract, showing any payments received and the balance due,
with the deposit stated as held separately. Pressing it twice creates one invoice. A
failed email can be retried without creating a second invoice.

---

## 2. The deposit rule (unchanged from v1, confirmed by D1)

The signed contract tells the customer, at `src/lib/contract-template.ts:209`:

> "The booking and damage deposit is separate from the event price. It cannot be used
> towards the event balance, bar spend, catering, entertainment, venue hire, supplier
> charges or any other event cost."

Netting it off would contradict the signed contract, would give the deposit's value away
twice (once as a discount, once as the refund), and would produce a **negative invoice on
three of the eighteen billable bookings**: Lorna Wright (£135 total, £250 deposit),
Millie Prynn (£90 vs £100), Lauren Harmes (£232.98 vs £250).

The deposit appears on the invoice as a stated fact with its amount and date, never as a
deduction. Wording and its state table are in section 10.

This is safe by construction, not just by rule: all 8 live `private_booking_payments`
rows are balance payments, and none exceeds its booking's gross total, so copying that
table can never pull the deposit in.

---

## 3. Corrections to v1

Stated plainly because they changed the design.

1. **The auto-send cron claim was backwards.** v1 said any draft would be "posted the
   next morning, unreviewed". The cron filters `.eq('invoice_date', todayIso)` with no
   catch-up. A draft created after 07:00 UTC with `invoice_date = today` is therefore
   **never auto-sent**, silently orphaned forever with no alert. Only a draft created
   before 07:00 UTC on its own invoice date is auto-sent, about four hours later. D2 still
   stands, but the reason is silent non-delivery, not unreviewed delivery.
2. **"No postal address exists anywhere" was wrong.** `invoice_vendors.address` exists, is
   optional, and **is already printed** on the PDF (`invoice-template-compact.ts:417`).
   Three of seven live vendors have none, so five of fifty issued invoices already carry a
   name-only Bill To. The issuing VAT number is also already printed (`GB315203647`,
   `src/lib/pdf/document-chrome.ts:172`). D5 is therefore cheap: leave the field blank and
   the block degrades to a name.
3. **The RPC exposure was understated.** v1 said `create_invoice_transaction` and
   `record_invoice_payment_transaction` grant `authenticated` only. Wrong: their ACL entry
   `=X/postgres` is a **PUBLIC** grant and anon is a member of PUBLIC.
   `has_function_privilege('anon', oid, 'EXECUTE')` returns **true** for both, and for
   `convert_quote_to_invoice_atomic`, `create_credit_note_atomic` and
   `get_and_increment_invoice_series`. Section 11.
4. **"The email already prints Total Paid" was wrong.** That is the receipt branch only.
   The invoice branch prints `Amount Due: <full total_amount>` and nothing else
   (`src/lib/microsoft-graph.ts:141`). Section 10.
5. **The double-click guard did not work.** A unique index on
   `private_bookings.invoice_id` only stops one invoice being linked to two bookings. It
   never stops two invoices being created for one booking. Section 5.
6. **v1's rounding sentence was ambiguous, not wrong.** `calculateInvoiceTotals` rounds
   VAT per line and the final total, and does **not** round `baseAfterLineDiscount`.
   Section 7 states the arithmetic exactly.

---

## 4. What the invoice shows

```
Line items                    (one per private_booking_item, in order)
Subtotal                      net of VAT
VAT                           20%
Invoice Total                 must equal booking gross_total exactly
Less payments received        sum of private_booking_payments
BALANCE DUE                   the figure the customer pays
------------------------------------------------------------------
Booking and damage deposit    stated separately, never in the arithmetic
```

---

## 5. The atomic operation (fixes review C02, C03, C05, C21)

v1 did creation, payment replay, booking linkage and sending as four separate commits.
That allowed two concurrent clicks to create two invoices, a mid-replay failure to leave a
half-copied invoice, and a retry to double-count payments.

Replace all of it with **one plpgsql function**, modelled on the existing
`convert_quote_to_invoice_atomic`:

```
create_private_booking_invoice_atomic(
  p_booking_id uuid, p_invoice_date date, p_due_date date, p_actor_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_catalog'
```

Body, in order:

1. `SELECT * FROM private_bookings WHERE id = p_booking_id FOR UPDATE`. Lock first.
2. **Idempotent short circuit.** If `invoice_id IS NOT NULL`, load that invoice and
   return `{created: false, invoice}`. This is a deliberate divergence from the quote
   precedent, which raises. D2 sends in the same click, so a failed send must be
   retryable without burning a second number. If the linked invoice is missing or
   soft-deleted, raise `private_booking_invoice_missing_or_deleted`.
3. Recheck eligibility under the lock (section 9).
4. Allocate the invoice number inline (same base36 encoding, same INV series, per D3).
5. Insert the invoice and all line items. **Never name the four money columns on
   `invoice_line_items`**: they are `GENERATED ALWAYS` in production.
6. Copy every `private_booking_payments` row into `invoice_payments`, carrying
   `source_payment_id`, and set `paid_amount` and `status` from the resulting sum.
   Do **not** call `record_invoice_payment_transaction`: it increments rather than
   re-derives, has no idempotency key, and is anon-executable.
7. Assert the reconciliation (section 7). Raise rather than send a wrong invoice.
8. `UPDATE private_bookings SET invoice_id = ... WHERE id = $1 AND invoice_id IS NULL`,
   raising if `NOT FOUND`.

Named errors the server action must map to user copy: `booking_not_found`,
`private_booking_invoice_missing_or_deleted`, `booking_not_confirmed`,
`booking_cancelled`, `booking_date_tbd`, `booking_has_no_priced_items`,
`booking_item_precision_would_be_lost`, `booking_payments_exceed_invoice_total`,
`invoice_total_reconciliation_failed`, `payment_replay_mismatch`.

---

## 6. Delivery state versus payment state (fixes C05a)

`invoices.status` is a single column holding both. Its CHECK list is
`draft|sent|paid|partially_paid|overdue|void|written_off`, mutually exclusive. A private
booking invoice with payments is born `partially_paid` or `paid`, so stamping it `sent`
would destroy its payment state. Two live bookings prove it: booking `b8821e0a` is born
`paid`, booking `c4bf2e52` is born `partially_paid`.

Do not change `status`. Add alongside it:

```sql
ALTER TABLE invoices
  ADD COLUMN sent_at timestamptz,
  ADD COLUMN sent_to text,
  ADD COLUMN payment_state text GENERATED ALWAYS AS (
    CASE WHEN total_amount > 0 AND paid_amount >= total_amount THEN 'paid'
         WHEN paid_amount > 0 THEN 'part_paid'
         ELSE 'unpaid' END) STORED;

ALTER TABLE invoices ADD CONSTRAINT invoices_sent_to_requires_sent_at
  CHECK (sent_to IS NULL OR sent_at IS NOT NULL) NOT VALID;
```

**New rule:** delivery is `sent_at IS NOT NULL`, never `status = 'sent'`. Payment is
`payment_state`, never `status`. `status` becomes a compatibility mirror so every existing
Orange Jelly path keeps working untouched.

Backfill `sent_at` from the earliest non-failed `invoice_email_logs` row, then from
`invoice_date` for anything still null in `sent|partially_paid|overdue|paid`, so all three
crons behave identically before and after. The backfill and the cron filter changes must
ship in the same deploy.

---

## 7. Money arithmetic (fixes C09)

The invoice total must equal `private_bookings_with_details.gross_total` **exactly**,
because the customer already holds that figure on their contract and by SMS.

Booking method: round each discounted net line to 2dp, sum, apply VAT to the sum, round
once. Invoice method (`src/lib/invoiceCalculations.ts`): `baseAfterLineDiscount` is **not**
rounded, VAT **is** rounded per line, and the total is rounded once at the end.

The invoice adopts the booking's method. Implement as an assertion inside the function: if
the computed total differs from `gross_total` at all, raise
`invoice_total_reconciliation_failed`. Never silently absorb a penny.

**Schema drift blocks trustworthy tests.** The four money columns on `invoice_line_items`
are `GENERATED ALWAYS` in production but plain `DEFAULT 0` in every migration in the repo.
Production is ahead of version control. A database built from migrations alone produces
different line totals, so any test suite built on a fresh database today proves nothing.
Ship a corrective migration bringing source control up to production **before** anything
else in this feature.

---

## 8. Dates (fixes C06)

- `invoice_date` = `getTodayIsoDate()` (London).
- `due_date` = `GREATEST(balance_due_date, today)`.

The `GREATEST` matters: **15 of 19 priced bookings have a `balance_due_date` in the past**,
by up to 411 days, and 13 of those still owe money. Using `balance_due_date` directly would
issue invoices already overdue and trigger a chase email immediately.

Both are function parameters, not derived inside, matching the quote precedent.

---

## 9. Eligibility (fixes C16)

Checked twice: in the UI for the button state, and again inside the function under the
lock. The UI check is a courtesy; the function check is the guard.

| Condition | Result |
|---|---|
| `status <> 'confirmed'` | Blocked, `booking_not_confirmed` |
| `cancelled_at IS NOT NULL` | Blocked, `booking_cancelled` |
| `date_tbd = true` | Blocked, `booking_date_tbd` |
| No priced items (`SUM(line_total) <= 0`) | Blocked, `booking_has_no_priced_items` |
| No contact email | Button disabled, persistent reason shown below it |
| Already invoiced | Returns the existing invoice, no new number |
| Payments exceed the invoice total | Blocked, `booking_payments_exceed_invoice_total` |
| Fully paid already | Allowed. Invoice is born `paid`, `payment_state = 'paid'` |

Show the reason as persistent text under the button, not a tooltip. Tooltips on disabled
buttons are unavailable to keyboard and touch users (C22).

---

## 10. Document and email changes

### PDF (`src/lib/invoice-template-compact.ts`)

1. In **invoice** mode, when `paid_amount > 0`, render the three rows the receipt mode
   already renders at lines 486 to 500: Invoice Total, Total Paid, Balance Due. Reuse
   `outstandingBalance`, already computed at line 340.
2. Add the deposit panel, rendered from a **persisted snapshot**, never from live booking
   data. It must never contribute to any total.

### Deposit panel states

Refund states have **never occurred in production** (0 of 40 rows), so they are defined but
deprioritised. The states that are live today are the ones to build first.

| Booking state | Live count | Panel |
|---|---|---|
| Deposit paid, method known | 24 | "Booking and damage deposit of £X received on DATE by METHOD..." |
| Deposit paid, method NULL | 16 | Same, omit "by METHOD" |
| `deposit_waived = true` | 5 | Panel omitted |
| No `deposit_paid_date`, not waived | 11 (1 confirmed) | Panel omitted, do **not** print "received on null" |
| `deposit_refund_status` set | 0 | Defined but blocked, route to manual review |

### Email (`src/lib/microsoft-graph.ts`)

The invoice branch currently prints only `Amount Due: <full total>`. It must print Invoice
Total, Payments Received, and Balance Due, or a part-paid customer is asked for the whole
amount again.

### Snapshot (fixes C27)

Store the issued PDF plus its rendering inputs, recipient, message id and template version.
Reuse `private_booking_documents` with `document_type = 'invoice'` (it already holds
`contract`, 20 rows). Later downloads default to the snapshot. Without this the business
cannot reproduce what was actually issued, and VAT records must be kept six years.

### Copy (fixes C18)

- **Branding is settled: every invoice goes out from Orange Jelly Limited, and
  nothing else.** That is the official business name, so it is what appears on
  the document, in the email subject and in the sign-off, for private bookings
  and consultancy alike. There is no trading-name variant and no second
  template. Do not "fix" this to The Anchor later: it was considered and
  rejected by the owner on 2026-08-28. The venue may still be named in body
  copy where it describes the booking, never as the sender.
- The PDF states "Card Payments: Subject to additional fees". Consumer card surcharges are
  restricted in the UK. Get this removed or approved before a consumer ever sees it.

---

## 11. Security (fixes C17)

### The super_admin gate (D6)

`checkUserPermission` is **not** a super_admin gate. It short-circuits true for
super_admin but returns true for any role holding the row, and **manager already holds
`invoices.create`, `invoices.edit`, `private_bookings.create` and `private_bookings.edit`**.
Every obvious pair passes for managers today.

Use the explicit role check pattern at `src/app/actions/gdpr.ts:19-33`: after
`getUser()`, read roles and require `super_admin`. Add negative tests proving a manager is
refused.

### Function grants

New public functions in this project get EXECUTE to PUBLIC by default, and anon is a member
of PUBLIC. In the same migration as the CREATE FUNCTION:

```sql
REVOKE ALL ON FUNCTION public.create_private_booking_invoice_atomic(uuid,date,date,uuid)
  FROM public, anon;
GRANT EXECUTE ON FUNCTION public.create_private_booking_invoice_atomic(uuid,date,date,uuid)
  TO service_role;
```

### Dependency: now CLOSED

This is no longer a blocker. Two migrations were applied to production on 2026-08-27 and
independently verified from this session against the live database:

| Migration | Prod version |
|---|---|
| `scope_permission_policies_to_authenticated` | `20260827115556` |
| `revoke_anon_execute_security_definer_rpcs` | `20260827115216` |

Verified live, not taken on report:

- **0 of 217** public SECURITY DEFINER functions are anon-executable, down from 49.
- `has_function_privilege('anon', ...)` is now `false` for both
  `create_invoice_transaction` and `record_invoice_payment_transaction`.
- **0** policies remain both `TO public` and calling `user_has_permission` or
  `is_super_admin`. (99 policies are still `TO public`, but none of them calls a
  permission function, so they are not the hazard.)

**Keep the ordering lesson, not the exception list.** The 68 affected policies across 39
tables had to be re-scoped `TO authenticated` **before** the EXECUTE grant was revoked.
Revoking first turns a query that returns zero rows into a `42501` error, and
`business_hours` and `special_hours` are among those tables and are read by the public
website. `service_role` is unaffected either way, it has `rolbypassrls`.

Two earlier overstatements in this spec's own history, corrected: `create_credit_note_atomic`
always carried an internal `auth.uid()` plus `user_has_permission` guard as its first
statement, so it was never anon-exploitable; and `get_and_increment_invoice_series` is not
SECURITY DEFINER and anon holds no grant on `invoice_series`, so it could not burn invoice
numbers anonymously.

**Still open, and it is why our explicit REVOKE above matters:** there is no
`ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM public` and no
CI assertion, so the **next** new public function is again granted to PUBLIC by default.
Our migration must carry its own revoke rather than assume the estate is safe.

Two consequences for this feature:

1. `public.assert_rpc_permission(p_module text, p_action text)` now exists. If
   `create_private_booking_invoice_atomic` ever needs to be callable by the cookie client,
   call `PERFORM public.assert_rpc_permission('private_bookings','create');` as its first
   statement. It returns early for `service_role`, so it costs a service-role caller
   nothing. While our function stays service-role-only, it is not needed.
2. **Declare any new RLS policy `TO authenticated`, never `TO public`,** unless anon
   genuinely must read the table. `TO public` is what created this problem.

### Residual anon exposure, not fixed by those migrations

Verified live from this session 2026-08-27. None of these blocks this feature, but they are
open and the invoice work must not assume the estate is clean.

| Table | Policy | State |
|---|---|---|
| `timeclock_sessions` | "Anon can read open sessions for display", SELECT **TO anon**, qual `clock_out_at IS NULL` | **LIVE.** Anon holds the table SELECT grant, and the table has 21 columns including `manager_note`, `rate_override`, `rate_multiplier`, `premium_reason`. Anyone with the public anon key can read full rows for every clocked-in employee during trading. 0 open sessions at time of checking |
| `timeclock_sessions` | "Anon can clock in/out", INSERT **TO anon**, `with_check: true` | Latent. No constraint whatsoever, so on its face anyone could forge a clock-in for any employee. Fails closed only because anon's table grant is `SELECT` alone, with no `INSERT`. One `GRANT` from being live |
| `event_message_templates` | "Users can view event templates", SELECT TO public, qual `true` | Latent. Table is empty; leaks on first insert |
| `booking_reminders` | "Users can view reminders for accessible bookings", SELECT TO public, no identity scoping, 1,540 rows | Latent. Fails closed only because `has_table_privilege('anon','bookings','SELECT')` is false |

**Auditing lesson, worth more than the list.** Both `timeclock_sessions` policies are
declared **`TO anon`, not `TO public`**, so a `'public' = ANY(roles)` sweep never sees
them, including the only LIVE item in the table. The correct predicate is
`roles::text[] && array['public','anon']`. Reconciled counts: 99 policies are `TO public`,
4 involve `anon` directly, 103 together. The full `anon` set is
`event_images` (SELECT), `recruitment_job_postings` (SELECT), and the two
`timeclock_sessions` policies above.

Second lesson: three of these four are wide-open policies neutered only by a **missing
table grant**. "The policy is unscoped but anon lacks the grant" is not a safe resting
state, it is a latent leak waiting for someone to add a grant for an unrelated reason.

**Both `timeclock_sessions` anon policies are dead code.** Confirmed in the route, not
inferred: `src/app/(timeclock)/timeclock/page.tsx` is a server component using
`createAdminClient()`; `_components/TimeclockClient.tsx` has zero Supabase references and
imports only the `clockIn` / `clockOut` server actions; and
`src/app/actions/timeclock.ts:21` sets `const createClient = () => createAdminClient()`
with the comment that the kiosk works "without Supabase auth session". Since `service_role`
has `rolbypassrls`, the whole fix is a deletion, with no view and no column grants:

```sql
DROP POLICY "Anon can read open sessions for display" ON public.timeclock_sessions;
DROP POLICY "Anon can clock in/out" ON public.timeclock_sessions;
REVOKE ALL ON TABLE public.timeclock_sessions FROM anon;
```

Post-fix check is a `/timeclock` smoke test, because it is a public no-auth route. Raised
as separate work.

### Migration mechanics, read before adding any migration

1. The two applied migrations are committed to `claude/wizardly-bell-5c56e9` in a separate
   worktree and are **not pushed**, so fetching will not retrieve them. Production is
   currently ahead of every branch. Number any new migration above `20260827140000` and do
   not treat `supabase/migrations/` as a picture of production.
2. **Do not use `npx supabase db push`.** `20260819100000_leave_reminder_ledger.sql` is in
   the repo but was never applied (`schema_migrations` jumps from `20260819080000` to
   `20260819170814`), so a push would sweep it into production alongside this feature's
   migration. Use MCP `apply_migration`.

---

## 12. Schema changes

```sql
-- A. Booking link, with the real double-click guard as a backstop
ALTER TABLE private_bookings
  ADD COLUMN invoice_id uuid REFERENCES invoices(id),
  ADD COLUMN invoice_sent_at timestamptz;
CREATE UNIQUE INDEX private_bookings_invoice_id_key
  ON private_bookings (invoice_id) WHERE invoice_id IS NOT NULL;

-- B. Idempotent payment copy
ALTER TABLE invoice_payments
  ADD COLUMN source_payment_id uuid
    REFERENCES private_booking_payments(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX invoice_payments_invoice_source_key
  ON invoice_payments (invoice_id, source_payment_id) WHERE source_payment_id IS NOT NULL;

-- C. Line ordering
ALTER TABLE invoice_line_items ADD COLUMN display_order integer NOT NULL DEFAULT 0;
CREATE INDEX idx_invoice_line_items_invoice_order
  ON invoice_line_items (invoice_id, display_order);

-- D. Vendor identity
ALTER TABLE invoice_vendors ADD COLUMN customer_id uuid REFERENCES customers(id);
CREATE UNIQUE INDEX invoice_vendors_customer_id_key
  ON invoice_vendors (customer_id) WHERE customer_id IS NOT NULL;
CREATE INDEX idx_invoice_vendors_email_lower
  ON invoice_vendors (lower(btrim(email))) WHERE email IS NOT NULL;
```

Notes:

- **C is not cosmetic.** `invoice_line_items` has no ordering column and existing fetches
  do not order the embedded relationship, so PDF line order can differ between generation,
  retry and download. The 113 existing rows all get 0 and share a `created_at`, so no
  backfill can recover today's order: it was never deterministic. Every invoice line query
  must add an explicit `order`.
- **D matters because email is not unique.** `invoice_vendors` has exactly one constraint,
  its primary key. Matching must be on `customer_id` only. A `lower(btrim(email))` index
  supports a safe lookup but must not be treated as an upsert key.
- `private_bookings_with_details`, `private_booking_summary`,
  `private_booking_sms_reminders` and `customer_communications` all select an explicit
  column list, so the new columns will not appear until those views are recreated. The
  monitor cron reads the view.
- **Recipient must be frozen.** `src/lib/invoice-recipients.ts:56` and the auto-send cron
  both prefer a vendor primary contact over the booking email. The address confirmed in the
  dialog must be the address used, passed explicitly.

---

## 13. Accepted debt, stated openly

These are real and are **not** fixed in phase 1. Each needs an owner.

1. **Two balance figures will coexist (review C04, verified and understated).** Eleven
   surfaces compute the private booking balance from `private_booking_payments` via
   `calculate_private_booking_balance`, and **none of them reads `invoice_payments`**. So a
   customer who pays the invoice can still get a balance SMS and see an outstanding balance
   on the portal. `private-booking-monitor/route.ts:812` only skips on `final_payment_date`.
   Until this is closed, **staff must keep recording payments on the booking**, not the
   invoice. Say so in the UI.
2. **There is no working correction path.** A credit note cannot increase an invoice, does
   not reduce `total_amount` or `paid_amount`, and the UI caps it at the amount already
   paid, so a sent-but-unpaid booking invoice cannot be credited at all. Void works only
   while unpaid, and reissue is OJ-Projects-only. Phase 1 must therefore restrict itself to
   bookings whose items are final.
3. **The "invoice out of date" check must be a snapshot hash**, not a total comparison. A
   same-total change to description, quantity or VAT is invisible to a total check.
4. **D4 (mandatory email) is a separate change.** Until it lands, 8 of 18 billable bookings
   cannot be invoiced.
5. **The accountant's quarterly ZIP filters to Orange Jelly projects**, so booking invoices
   would be excluded.

---

## 14. Phasing

| Phase | Scope | Gate |
|---|---|---|
| 0 | Corrective migration bringing `invoice_line_items` generated columns into source control | Fresh DB matches prod |
| 1 | Schema A to D, `sent_at`/`sent_to`/`payment_state`, backfill, cron filter changes | All three crons green |
| 2 | The atomic function plus database integration tests: two-request concurrency, retry, fault injection | Concurrency proven |
| 3 | Server action, super_admin gate, vendor upsert, snapshot storage, audit | Negative permission tests pass |
| 4 | PDF and email changes, deposit panel, consumer copy | Copy approved |
| 5 | Button, confirmation dialog with source hash, accessible modal | Behind a flag, canary first |

Phases 0 and 1 must land before anything else. Phase 5 goes out behind a flag.

---

## 15. Tests

Beyond v1's mapper tests, which stand:

- **Concurrency:** two simultaneous calls produce one invoice and one number.
- **Retry:** a second call after a failed send returns the same invoice, no duplicate
  payments, no second number.
- **Payment replay:** booking `82359696` has two payments (£50 + £40), the duplicate case.
- **Born-paid:** booking `b8821e0a` (gross £232.98, paid £232.98) is born `paid` with
  `sent_at` NULL, the C05a case. Booking `c4bf2e52` (£642.00, £400.00) is born
  `partially_paid`.
- **Payment method mapping:** `cash` to `cash`, `card` to `card`, `invoice` to `other`.
  The invoice CHECK accepts `bank_transfer|cash|cheque|card|other`; the booking CHECK
  accepts `cash|card|invoice`. `invoice` would violate the invoice-side CHECK **after the
  number is burnt**. No live row uses it yet.
- **Fault injection** after every boundary, and cron eligibility before and after backfill.
- **Negative permission:** a manager is refused.
- **Fixtures must be anonymised.** Do not put production names into the repo (C26).

---

## 16. Still open

1. Where should staff record a payment that arrives after the invoice is sent, given debt
   item 1? Recommended: keep recording on the booking, and have the invoice read through,
   so there is one place to look.
2. Should phase 1 lock a booking's items once invoiced, given there is no working
   correction path? Recommended: yes, warn and block financial edits, with a super_admin
   override.
3. Can a completed or past-dated booking be invoiced? Recommended: yes, 15 of 19 priced
   bookings are already past their balance due date, so blocking them removes most of the
   value.
4. Who approves the removal of the card fee wording? (Branding is settled:
   every invoice comes from Orange Jelly Limited, decided 2026-08-28.)

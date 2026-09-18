# Private booking additional charges and final receipt

Status: discovery and proposed specification only. Local document, no implementation authorised.

## Outcome

Staff can add chargeable extras to an already invoiced private booking, issue a separate invoice for those extras, and send its payment link. Staff can later produce one final receipt showing the original charges, every additional charge, and all payments and refunds with their recorded dates.

The original invoice and its payment history remain unchanged. Multiple rounds of extras are supported. The final receipt summarises the invoices; it does not create another debt or duplicate turnover.

## Discovery evidence and limits

Reviewed on 18 September 2026 against checkout `63eea26f811481d68a4c014a7cdc8be9638f6236` and read-only catalogue queries on production Supabase project `tfcasgxopxegwrabvwat`. No customer records were needed. No booking, invoice, payment, email or SMS was created. No browser payment journey was executed, so these are verified code and schema findings, not an end-to-end certification of existing behaviour.

Current implementation:

| Area | Evidence | Meaning for this feature |
| --- | --- | --- |
| Booking invoice | `src/app/actions/privateBookingInvoice.ts`; live `private_bookings.invoice_id` and its unique index | A booking currently links to one invoice. Creation and resend assume that single link. |
| Permissions | `requireSuperAdmin` in the same action | Raising booking invoices currently requires a super admin. Keep this restriction for extras. |
| Charge editing | Live `guard_linked_booking_item_prices()` | Priced lines are protected after invoicing. A new supplementary flow must preserve protection of original charges. |
| Payment totals | Live `private_booking_settlement_rows()` and `src/lib/private-bookings/payment-ledger.ts` | Both combine booking payments with payments from the single original invoice. Copies of booking payments and deposit allocations must not count as new money. |
| Existing receipt | `src/app/actions/invoices.ts`, remittance dispatch | Receipts are for a particular invoice/payment, not a consolidated booking receipt. |
| Existing statement | `payment-statement.ts` and `payment-statement-loader.ts` under `src/lib/private-bookings/` | Useful date and payment presentation logic, but the current validator requires a positive balance due. It cannot serve as the final receipt validator. |
| Online payment | `src/lib/invoices/payment-link-footer.ts`, `src/app/invoice-portal/[token]/`, `src/lib/invoices/paypal-capture.ts` | Reuse the signed invoice portal and PayPal capture/reconciliation. Links collect that invoice's outstanding balance. |
| PayPal eligibility | `invoiceCanOfferPayPal()` | The invoice customer's `paypal_payments_enabled` setting must permit online payment. Do not silently change it. |
| Refund evidence | Live `payment_refunds` schema | Existing records include source, amount, status and completion date. Only completed refunds represent money returned. |
| Active screens | `[id]/page.tsx` imports `PrivateBookingDetailServer.tsx`, which imports `[id]/PrivateBookingDetailClient.tsx` | Change the routed component. Also cover the separate `[id]/items/page.tsx` editor. |

Another change is present in the checkout: `20260918075730_allow_zero_cost_items_on_invoiced_private_bookings.sql`. The live guard already contains the zero-value exception, but that exact migration version was absent from migration history at discovery time. This is an observed difference, not a diagnosis of a failed deployment. Re-check after the owner's other work is finished. Do not alter, apply or roll back that work as part of discovery.

## Proposed staff journey

1. Open an invoiced private booking and select **Add extra charges**. Available for confirmed or completed bookings, including those previously paid in full. Cancelled bookings are excluded from this first release.
2. Prepare a batch of extras using a catalogue item or a custom description. Each line has quantity, unit price, applicable VAT treatment and optional explicit line discount. Show net, VAT and gross clearly, following existing booking conventions.
3. Preview the separate invoice: extra lines only, recipient, due date, gross amount, payment eligibility and resulting booking balance. Require a staff-selected due date; do not invent payment terms or reuse a past date silently.
4. Select **Issue and send additional invoice**. Save the invoice and its booking association atomically, then send the PDF and signed invoice portal link through the existing invoice email route. Use the current Orange Jelly Limited identity resolver.
5. Show the new invoice beside the original, with its number, issue date, due date, total, paid amount, balance and delivery state. Support download, copy payment link and explicit resend. Email failure leaves a recoverable invoice, not another invoice on retry.
6. Payments update the individual invoice and the overall booking. Manual payments require selection of the invoice being paid. A payment covering several invoices requires explicit allocations whose sum equals the receipt amount.
7. Staff select **Preview final receipt**, then download or explicitly send it. Before settlement, the same view is a **Payment statement** and clearly shows money still due.

Draft extras do not increase the amount owed, enter reminders, or generate a payable link. Staff can edit or discard drafts. Invoice issue freezes the descriptions, prices, quantities, VAT and discount values for that batch. Further extras form another batch.

If online payment is disabled for the invoice customer, the preview must make this visible. Staff can use the existing authorised setting before sending a payment-link request, or explicitly issue an invoice without online payment. The interface must not promise a payment link when none can be offered.

## Charging and accounting rules

- A supplementary invoice contains only newly agreed extras, not the original invoice's unpaid balance. An unpaid original invoice remains separately payable.
- Preserve the original invoice, signed contract and original deposit treatment. Never void or rewrite the original simply to add extras.
- Do not apply a booking-wide historical discount to extras automatically. Extras receive only discounts explicitly entered for them. Preserve existing penny-accurate VAT and rounding conventions.
- Preserve a held refundable deposit as a separate liability. Never apply it again to an additional invoice. An already deducted deposit counts once across the whole booking.
- Do not copy old payments into every new invoice. Each actual receipt has one source identity; allocations are not additional cash receipts.
- All booking summaries, dashboard balances, reminders, cancellation calculations and final-payment stamps must use the same aggregate charges and settlement rules.
- A new issued supplementary invoice reopens the booking balance and clears any obsolete paid-in-full stamp. Paying it restores settlement only if all collectible invoices are settled.
- Keep invoice balances separate from the booking summary. An overpayment on one invoice does not silently pay another invoice. Show the credit and require an explicit authorised allocation or refund.
- Cancelling unpaid supplementary invoices must withdraw their payable link and remove the corresponding collectible charge atomically, while retaining history. Payments or active PayPal captures block unsafe cancellation. Original-invoice cancellation must not orphan supplementary invoices.
- Reductions to issued charges use the existing approved correction/credit process, not negative extras or deletion of payment history. A refund and a credit are different: a refund returns money; a credit reduces what was charged.
- Retained damage deposits must not be silently labelled payment for extras. Represent any authorised charge and allocation explicitly. Do not broaden the existing refund policy.

## Final receipt content and eligibility

The consolidated PDF contains:

- Receipt reference, issue time, booking reference, event date, customer and existing configured legal issuer details.
- Original invoice and each supplementary invoice, with invoice number, issue date, line descriptions, quantity, net amount, discount, VAT and gross total.
- Payments in date order, each showing date, amount, method, reference where recorded, and the invoice or deposit purpose it paid. A partial payment against several lines is identified against its invoice; do not invent line-level allocations.
- Credits and completed refunds, with their dates, amounts and source references. Pending refunds are visibly pending, never presented as money already returned.
- Separate deposit section: received, applied to the bill, refunded, retained against a documented charge, or still held.
- Totals for charges, credits, receipts, refunds, payment applied to charges, any credit balance, balance due and deposit still held.

**Final receipt** is available when every collectible invoice is settled, there are no unresolved draft extras, and no unresolved refund, dispute, unapplied credit or deposit balance prevents a complete account. Staff can still produce a current payment statement while these remain. A written-off balance is not payment and must not produce a paid-in-full claim.

Dates use the actual recorded payment date in London. Invoice payments have `payment_date`; historic booking payments currently have `created_at`, so label those as the recorded date unless independently supported. Do not manufacture a more precise historical date. New manual payment entry should record an explicit received date.

Store a versioned receipt snapshot and the exact generated PDF in private storage, with creator, generated time, source invoice/payment IDs and reconciliation totals. Reuse `storeContractSnapshot` in `src/lib/private-bookings/contract-lifecycle.ts`, which already supports document type `receipt`, extending its version metadata only where necessary. Re-downloading an issued receipt returns that version. Later charges or corrections require a new receipt version; old versions remain available and are marked superseded in the staff view. Sending is explicit and audited, not automatically triggered by the last payment.

## Proposed technical design

This is a feature spanning billing and booking settlement, not just a new button. Complexity: L (4), requiring staged delivery.

1. Introduce a booking-to-invoices association supporting one original invoice and multiple supplementary invoices. Recommended logical entity: `private_booking_invoices`, with unique invoice identity, booking identity, original/supplementary kind and creation metadata. Backfill existing links without regenerating documents or payments. Keep `private_bookings.invoice_id` as the original-invoice compatibility pointer during rollout, with consistency enforced.
2. Introduce supplementary charge batches and their draft lines, linked to their issued invoice. Drafts remain separate from original `private_booking_items`, avoiding accidental inclusion in the original invoice and its booking-wide discount. Issue copies immutable lines into the existing `invoice_line_items` and links the batch in one transaction. Preserve source item IDs where applicable.
3. Introduce one aggregate booking financial projection: original booking charges plus issued supplementary charges, less recorded credits, with separately reconciled invoice balances, cash receipts, refunds and deposit treatment. Do not globally add extras to `get_booking_gross_total` without separating the original-invoice reconciliation that currently depends on it. Update readers to consume the appropriate original or aggregate total explicitly.
4. Expand SQL settlement and TypeScript ledger readers to all linked invoices. Keep booking-payment copy exclusions. New manual payments must be invoice-specific; multi-invoice payments need a receipt identity and explicit allocations. Historical unallocated booking payments keep their known original attribution. Lock booking before invoices in a deterministic order and enforce one-time issuance server-side.
5. Reuse the existing invoice token, PDF, email transport, PayPal portal, webhook, capture deduplication and reconciliation. Broaden reverse invoice-to-booking lookup so payment completion invalidates the correct booking and updates its settlement. Preserve vendor PayPal eligibility checks.
6. Add a dedicated consolidated receipt model and reconciler. Reuse presentation helpers, not the reminder validator that rejects zero balances. Refuse final receipt generation if records are missing or totals disagree; show staff an actionable error.

Proposed entity names are design suggestions, not migration instructions. Before implementation, re-read the live schema, constraints, policies, functions and all callers after the current work lands. No SQL migration has been drafted or applied for this feature. Production migrations require the separate `prod-migrate` workflow and explicit approval.

Known views to review: `private_bookings_with_details`, `private_booking_summary`, `private_booking_sms_reminders` and `customer_communications`. Function-body searches must supplement catalogue dependency checks. New records and receipt storage are private, permission checked and audited; signed invoice access must not expose other invoices or the whole booking.

## Implementation surfaces

| Surface | Expected scope |
| --- | --- |
| `src/app/actions/privateBookingInvoice.ts` | Batch preview/issue/resend, shared permissions and delivery reuse. Split supplementary actions into a focused sibling module if needed. |
| `src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx`, `InvoiceBookingModal.tsx`, `[id]/items/page.tsx` | Extras editor, multiple invoices, explicit payment allocation and receipt controls. |
| `src/app/(authenticated)/private-bookings/[id]/page.tsx`, `PrivateBookingDetailServer.tsx`, `src/services/private-bookings/queries.ts`, `src/types/private-bookings.ts` | Load and expose additional charges, invoices and reconciled totals. |
| `src/lib/private-bookings/payment-ledger.ts`, `payment-statement.ts`, `payment-statement-loader.ts`; `src/services/private-bookings/payments.ts`, `financial.ts` | Aggregate settlement, dated payment history, cancellation/refund totals and reminder compatibility. |
| `src/lib/private-bookings/invoice-mapper.ts`, `vat.ts` | Reuse exact money rules while keeping original totals distinct from supplementary totals. |
| `src/app/actions/invoices.ts`, `invoicePayPalActions.ts`, `src/lib/invoices/paypal-capture.ts` and associated webhook/reconciliation paths | Multiple-invoice booking association, lifecycle guards and payment allocation. |
| New booking receipt model, renderer and protected download/send action | Versioned consolidated PDF and audit record. |
| SQL settlement functions, affected views, new associations/batches and generated types | Atomic issue, locking, guards, compatibility and backfill. |
| Dashboard balances, booking monitor/reminders, contract and event-sheet consumers | Show consistent totals; preserve original signed documents and include agreed extras in current operational views. |

No public website change is expected: this journey is in the management app and existing invoice portal. Verify counterpart consumers before implementation. The supplier `/receipts` section is unrelated and remains untouched. Existing table-booking deposit rules and historical Stripe paths remain untouched.

## Delivery sequence after authorisation

1. Add backward-compatible invoice associations and reconciliation foundations, with existing single-invoice behaviour unchanged and regression coverage.
2. Add supplementary draft/issue flow and staff UI with PayPal payment and manual allocation support. Release the feature only when all booking totals and reminders consume the aggregate model.
3. Add consolidated statement/final receipt generation, private versioned storage, download and explicit sending.

Each stage needs its own reviewable change and working compatibility path. Rebase on the owner's completed change first. Prepare the detailed implementation plan only when implementation is requested.

## Acceptance criteria

- A paid original invoice plus a new batch produces exactly one new numbered invoice containing only the new lines; the original PDF, prices and payments do not change.
- Multiple batches work while the original invoice is paid, partially paid or unpaid. Each link collects only its own outstanding amount.
- Double-clicks, retries and two staff issuing the same batch concurrently create one invoice. Stale previews are rejected.
- Failed email can be retried without duplicating charges; suspended communications do not get bypassed.
- Duplicate PayPal return/webhook/reconciliation events record one receipt. A manual payment made while a portal is open cannot cause a stale amount to be silently accepted as the correct balance.
- Manual payments select the intended invoice; split allocations reconcile to one actual receipt. Booking and invoice copies are never double-counted.
- Held and deducted deposits, cash, card, bank transfer, PayPal, partial payments, overpayments, credits and completed/pending refunds are covered by reconciled fixtures.
- Original discounted bookings do not silently discount extras. Fractional quantities, mixed existing VAT treatments and rounding reconcile to the penny.
- Issue, payment, credit and cancellation update booking balance, invoice status, final-payment stamp, dashboard, reminders and current operational views consistently.
- Zero-cost operational items retain the behaviour of the owner's separately completed change.
- Final receipt includes every charge and dated payment with its purpose, and refuses a paid-in-full label while anything collectible or unresolved remains.
- Unauthorized users cannot issue invoices, send receipts, read another booking's documents or access private receipt files through a guessed URL.
- PDFs and emails render correctly for long descriptions and multi-page histories; downloaded and emailed copies match the stored version.
- Run SQL transaction/concurrency tests, London and UTC date tests, relevant application tests, lint, types and clean build. Execute the actual staff-to-guest payment journey against isolated test data and PayPal sandbox, with customer delivery disabled or routed to approved test recipients.
- After separately authorised deployment and migrations, verify the intended deployment and read-only production state. Do not create a real charge or customer message merely to test deployment.

## Completion of discovery

Specification saved locally. Application files, existing task tracking, other work, live data and communications are unchanged by this discovery. The recommended defaults above are proposals for later implementation, not approval to build or deploy.

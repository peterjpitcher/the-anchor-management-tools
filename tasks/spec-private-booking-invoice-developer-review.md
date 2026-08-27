# Developer review: private booking invoice specification

**Specification reviewed:** `tasks/spec-private-booking-invoice.md`  
**Review date:** 2026-08-27  
**Review basis:** the specification, current application code, current migrations, cron configuration, and official GOV.UK invoice guidance. No production data was queried during this review.  
**Source document changed:** no

## Overall verdict

**Not ready for approval or implementation.**

The deposit policy is well reasoned, and reuse of the existing invoice module is sensible. However, the proposed workflow is not transactionally safe and does not define a reliable source of truth after an invoice exists. Concurrent requests can create duplicate invoices, retries can duplicate payments, later payments can leave the booking and invoice showing different balances, and the proposed `invoice_id` index does not prevent those failures.

There are also unresolved business and compliance decisions: invoice and supply dates, payment due date, billing address, who may issue an invoice, how completed and fully paid bookings behave, how corrections and extra charges work, and what “sent” means when email delivery fails.

Nine P0 blockers must be resolved before implementation starts.

## Labels used

- **Status — Confirmed issue:** a defect, contradiction, or missing requirement evidenced by the specification or current code.
- **Status — Optional improvement:** not essential for correctness, but likely to simplify delivery or reduce operational risk.
- **Priority P0:** release blocker.
- **Priority P1:** required before general release.
- **Priority P2:** should be planned and accepted explicitly.
- **Priority P3:** useful refinement.

## Findings summary

| ID | Priority | Status | Type | Title |
|---|---|---|---|---|
| C01 | P1 | Confirmed issue | Requirements | Referenced approval questions do not exist |
| C02 | P0 | Confirmed issue | Data integrity | The double-click guard does not prevent duplicate invoices |
| C03 | P0 | Confirmed issue | Data integrity | Historical payment replay is neither atomic nor idempotent |
| C04 | P0 | Confirmed issue | Functional / integration | Booking and invoice balances will diverge after invoicing |
| C05 | P0 | Confirmed issue | Delivery / state model | “Sent”, email delivery, payment status, retry, and cron behaviour conflict |
| C06 | P1 | Confirmed issue | Requirements / integration | Invoice date, supply date, due date, reference, and reminder rules are missing |
| C07 | P0 | Confirmed issue | Compliance / data | Name-only billing details are not demonstrably sufficient |
| C08 | P0 | Confirmed issue | Functional / data model | The stated correction path cannot handle common booking changes |
| C09 | P1 | Confirmed issue | Technical assumption | The stated invoice arithmetic and schema facts conflict with versioned code |
| C10 | P1 | Confirmed issue | Money / VAT | Discount conversion is not generally exact or transparent |
| C11 | P0 | Confirmed issue | Concurrency / UX | The confirmation preview can differ from what is sent |
| C12 | P1 | Confirmed issue | Integration | The send step lacks a complete invoice and durable deposit context |
| C13 | P1 | Confirmed issue | Data model | Booking line order cannot be preserved reliably |
| C14 | P1 | Confirmed issue | Data / delivery | Vendor matching and recipient selection are ambiguous and race-prone |
| C15 | P1 | Confirmed issue | Functional | Deposit refund and abnormal deposit states are ignored |
| C16 | P1 | Confirmed issue | User journeys | Eligibility and lifecycle journeys are incomplete |
| C17 | P0 | Confirmed issue | Security / authorisation | Privileged money operations and feature permissions are not safely defined |
| C18 | P0 | Confirmed issue | Compliance / content | Existing consumer-facing invoice text needs correction before reuse |
| C19 | P1 | Confirmed issue | Accounting / reporting | Accounting export and revenue treatment are unresolved |
| C20 | P1 | Confirmed issue | Data integrity | The proposed “out of date” test misses material changes |
| C21 | P1 | Confirmed issue | Error handling | Partial-failure recovery and soft-delete behaviour are undefined |
| C22 | P1 | Confirmed issue | Accessibility | The UI and document accessibility requirements are incomplete |
| C23 | P1 | Confirmed issue | Testing | The test plan omits the highest-risk behaviour |
| C24 | P1 | Confirmed issue | Monitoring | Monitoring, reconciliation, and operational ownership are unspecified |
| C25 | P1 | Confirmed issue | Delivery | The proposed phases are not safe release units |
| C26 | P2 | Confirmed issue | Privacy / maintainability | Production evidence contains PII and will become stale |
| C27 | P1 | Confirmed issue | Records / audit | The sent invoice is not preserved as an immutable snapshot |
| C28 | P1 | Confirmed issue | Integration / migration | Required type, query, constraint, and UI data changes are missing |
| O01 | P2 | Optional improvement | Simplification | Use a first-class invoice source relationship |
| O02 | P2 | Optional improvement | Simplification | Narrow the first release to stable bookings |
| O03 | P2 | Optional improvement | Delivery | Decouple manual review from the legacy auto-send cron |
| O04 | P2 | Optional improvement | Reliability / performance | Use an email outbox rather than a long synchronous action |
| O05 | P3 | Optional improvement | Operations | Add a preflight and data-readiness view |
| O06 | P3 | Optional improvement | UX | Preview the actual generated PDF before dispatch |

## Confirmed issues

### C01 — Referenced approval questions do not exist

- **Relevant section:** 1, 4, document status
- **Description:** Sections 1 and 4 refer to “question 1” and “question 2”, but the document has no questions or decisions section. “Discovery complete, spec for approval” also does not identify an approver, acceptance criteria, or recorded decision.
- **Rationale:** The two missing questions change contract policy and send workflow. They are not minor implementation details.
- **Impact:** A developer can implement a design that the business has not actually approved.
- **Recommended action:** Add a decision log with named owner, decision, date, and acceptance criteria. At minimum cover deposit treatment and direct-send versus draft review.
- **Open questions:** Who approves policy, accounting, and operational workflow? Is deposit netting definitively rejected for this release?
- **Priority:** P1
- **Type:** Requirements
- **Status:** Confirmed issue

### C02 — The double-click guard does not prevent duplicate invoices

- **Relevant section:** 3 steps 1–6, 7 “Clicked twice”, 9
- **Description:** A unique index on `private_bookings.invoice_id` only prevents the *same invoice* being linked to two booking rows. It does not prevent two different invoices being created for one booking. Two concurrent actions can both see `invoice_id IS NULL`, create separate invoices, replay payments, and then race to update the single booking row. One invoice can be orphaned and still be sent or auto-sent.
- **Rationale:** Invoice creation, payment replay, booking linkage, and sending are separate commits. The proposed index is on the wrong side of the relationship to enforce “one invoice per booking”.
- **Impact:** Duplicate customer invoices, duplicate accounting records, burnt numbers, duplicate reminders, and manual cleanup.
- **Recommended action:** Create a dedicated atomic database operation. Lock the booking with `FOR UPDATE`, recheck eligibility, allocate the number, create the invoice and lines, copy payments idempotently, and link the booking in one transaction. Enforce source uniqueness with a source key on the invoice or a dedicated link table.
- **Suggested wording:** Replace “Blocked by the unique index on `private_bookings.invoice_id`” with: “Creation is idempotent at database level. A transaction locks the booking and enforces one active invoice for the booking source. Concurrent requests return the already-created invoice.”
- **Open questions:** Is the real rule one lifetime invoice, one active invoice, or multiple invoices for supplements/reissues?
- **Priority:** P0
- **Type:** Data integrity
- **Status:** Confirmed issue

### C03 — Historical payment replay is neither atomic nor idempotent

- **Relevant section:** 3 step 4, 7 “Customer pays”, 13
- **Description:** Payments are inserted one RPC call at a time after invoice creation. A failure on payment N leaves a partly copied invoice. Retrying re-inserts earlier payments because `invoice_payments` has no source booking payment ID or unique constraint. In addition, booking method `invoice` is not accepted by the invoice payment constraint, which only accepts `bank_transfer`, `cash`, `cheque`, `card`, or `other`.
- **Rationale:** `record_invoice_payment_transaction` protects one invoice row during one payment, not the whole replay. It has no source idempotency key.
- **Impact:** Duplicate or missing payments, incorrect `paid_amount`, failed retries, wrong status, and a possible overpayment rejection that leaves the workflow stuck.
- **Recommended action:** Copy all historical payments inside the same invoice-creation transaction. Add `source_private_booking_payment_id` with a unique constraint, define a method mapping, copy notes and original payment date, and make a retry return the existing copied row.
- **Open questions:** What does booking method `invoice` mean, and what invoice payment method should it become? Should payment date use the London calendar date of `created_at`? Must `recorded_by` be retained in audit metadata?
- **Priority:** P0
- **Type:** Data integrity
- **Status:** Confirmed issue

### C04 — Booking and invoice balances will diverge after invoicing

- **Relevant section:** 3 rationale, 7 “Customer pays”, 11 item 1
- **Description:** The specification says later payments are recorded on the invoice and explicitly defers updating `private_bookings.final_payment_date`. More importantly, it does not add a row to `private_booking_payments`. The booking portal, booking detail, SMS reminders, and private-booking monitor continue to calculate their balance from `private_booking_payments`, while invoice reminders use `invoice_payments`.
- **Rationale:** The system already has customer-visible booking balance flows. Copying payments creates a second source of truth unless future changes are synchronised.
- **Impact:** A customer can pay an invoice and still receive an SMS or portal balance saying they owe money. The reverse is also possible if staff record payment through the booking screen.
- **Recommended action:** Decide and enforce one canonical payment workflow. A safe option is a single atomic “record private booking invoice payment” operation that inserts one source payment and its linked invoice payment, updates both statuses, and is idempotent. Suppress duplicate booking and invoice reminders after linkage.
- **Suggested wording:** Replace “No new money maths, no second source of truth” with an explicit source-of-truth rule and synchronisation contract.
- **Open questions:** Where must staff record a post-invoice payment? Which customer balance is authoritative? Should the booking portal show the invoice and its payment history?
- **Priority:** P0
- **Type:** Functional / integration
- **Status:** Confirmed issue

### C05 — “Sent”, email delivery, payment status, retry, and cron behaviour conflict

- **Relevant section:** 4, 7 “Email fails”, 9 `invoice_sent_at`, 10
- **Description:** Replaying any payment changes a draft invoice to `partially_paid` or `paid` before email is sent. It therefore cannot also be stamped `sent` without losing its payment status. `invoice_sent_at` is placed on the booking but its meaning is not defined. If email fails for a part-paid invoice, the invoice reminder cron can still select it; if fully paid, neither auto-send nor reminders will recover it. The existing manual email path sends first and then marks a draft sent, while the auto-send cron marks sent first. The spec does not choose a consistent rule.
- **Rationale:** Payment state and delivery state are separate concepts but share one `invoices.status` column. Current `invoice_email_logs` already carries delivery evidence.
- **Impact:** False “sent” labels, invoices that were emailed but appear unsent, invoices that appear sent but were not delivered, unexpected reminder emails, and unsafe retries.
- **Recommended action:** Define independent delivery state, for example `delivery_status`, `first_sent_at`, `last_send_error`, and `sent_to`, or make successful `invoice_email_logs` the authoritative delivery record and update all crons to require it. Specify idempotency for uncertain provider outcomes and retry.
- **Suggested wording:** “Successful creation and successful email delivery are separate outcomes. Payment status is never used as evidence of delivery. Reminder and auto-send jobs only act when the invoice’s delivery state allows it.”
- **Open questions:** Does “sent” mean handed to Graph, accepted by Graph, or delivered? May a failed send be retried automatically? Should a failed initial send ever trigger a reminder?
- **Priority:** P0
- **Type:** Delivery / state model
- **Status:** Confirmed issue

### C06 — Invoice date, supply date, due date, reference, and reminder rules are missing

- **Relevant section:** 3, 4, 5, 7, 10
- **Description:** `InvoiceService.createInvoiceAsAdmin` requires `invoice_date` and `due_date`, but the spec defines neither. It also does not map the event/supply date or a useful booking reference. `balance_due_date` may be today, future, or already past. The invoice reminder cron can send a due-today email shortly after the initial invoice or mark an old booking invoice overdue immediately.
- **Rationale:** These dates affect the PDF, tax point, customer expectations, status, and automated reminders.
- **Impact:** Invalid or confusing invoices, duplicate same-day emails, immediate overdue status, and inconsistent contract terms.
- **Recommended action:** Define each date separately. Confirm tax-point treatment with the accountant. Define how `due_date` is derived from `balance_due_date`, including past/completed events and a same-day send grace period. Include event date and booking reference on the invoice.
- **Open questions:** Is invoice date always the generation date? Is supply date the event date or an earlier payment tax point? Can an invoice be issued after its contractual due date? Should invoice reminders replace or supplement booking reminders?
- **Priority:** P1
- **Type:** Requirements / integration
- **Status:** Confirmed issue

### C07 — Name-only billing details are not demonstrably sufficient

- **Relevant section:** 2 “Data readiness”, 8, 10
- **Description:** The spec acknowledges that no postal address is available and accepts a name-only “Bill To”. It also omits an explicit supply date. Official guidance lists the customer name/address and supply date among invoice details. HMRC guidance says supplies over £250 require a full or modified VAT invoice when a VAT invoice is required. See [GOV.UK invoice requirements](https://www.gov.uk/invoicing-and-taking-payment-from-customers/invoices-what-they-must-include) and [VAT Notice 700/21](https://www.gov.uk/guidance/record-keeping-for-vat-notice-70021).
- **Rationale:** Several live totals described in the spec exceed £250. The proposed invoice is not demonstrably complete for all customer/accounting cases.
- **Impact:** Customers may receive incomplete documents, business customers may be unable to use them as VAT evidence, and accounting records may need reissue.
- **Recommended action:** Get accountant approval on the required invoice form. Add billing address capture and a supply/tax-point field where required. Define when a simplified invoice is permitted and block sending when required data is missing.
- **Open questions:** Are these intended as VAT invoices for all customers, normal consumer invoices, or both? Are any hosts booking on behalf of VAT-registered businesses? Who owns address capture and validation?
- **Priority:** P0
- **Type:** Compliance / data
- **Status:** Confirmed issue

### C08 — The stated correction path cannot handle common booking changes

- **Relevant section:** 3 source-of-truth statement, 7 “Items edited after sending”
- **Description:** A credit note can reduce an invoice but cannot add later charges. The current credit-note implementation also does not reduce `invoice.total_amount` or the reminder cron’s `total_amount - paid_amount` balance. A same-total change to description, quantity, or VAT is not corrected by a total comparison. The single `private_bookings.invoice_id` design has no place for a replacement or supplementary invoice.
- **Rationale:** Private bookings commonly change guest counts, catering, suppliers, and extra charges. “Allowed” edits need an accounting consequence.
- **Impact:** Incorrect invoices remain live, reminders chase the pre-credit amount, increases cannot be invoiced, and staff have no supported recovery path.
- **Recommended action:** Choose one model before schema design: lock financial booking fields after invoicing; support void/reissue before payment and credit/reissue after payment; or support one-to-many supplementary invoices and credits. Ensure outstanding calculations include credits.
- **Suggested wording:** Replace “Correction is a credit note” with a decision table for decrease, increase, same-total content change, cancellation, payment already received, and fully paid invoice.
- **Open questions:** Can bookings change financially after invoice issue? Are extra post-event charges expected? Is a replacement invoice legally and operationally preferred to a supplement?
- **Priority:** P0
- **Type:** Functional / data model
- **Status:** Confirmed issue

### C09 — The stated invoice arithmetic and schema facts conflict with versioned code

- **Relevant section:** 2 invoices module, 5, 6
- **Description:** The spec states that invoice line money columns are `GENERATED ALWAYS`, but the versioned schema defines normal numeric columns with defaults. No later migration in the repository changes them to generated columns. If production is generated, production and migrations have drifted. The spec also says `calculateInvoiceTotals` rounds discounted net per line; current code does not round `baseAfterLineDiscount`, although it does round VAT per line and the final total.
- **Rationale:** The mapping and reconciliation design relies on these exact behaviours.
- **Impact:** Local, test, staging, and production environments can calculate or store different totals. A clean deployment may create zero line totals or fail assumptions that only hold in production.
- **Recommended action:** Compare the live `information_schema` definition with migrations, add a corrective migration or correct the spec, and create a database-backed arithmetic contract test. Do not implement against an undocumented production-only schema.
- **Open questions:** Which schema is authoritative? Are the live columns truly generated? Which consumers read stored line totals rather than recalculating them?
- **Priority:** P1
- **Type:** Technical assumption
- **Status:** Confirmed issue

### C10 — Discount conversion is not generally exact or transparent

- **Relevant section:** 5, 6
- **Description:** Reducing `unit_price` cannot always represent a fixed discount or pro-rata booking discount because invoice `unit_price` is limited to two decimals. For example, a required line net divided across three units may need recurring decimals. Adjusting unit prices also hides the original price and exact discount amount. The solution is only checked against today’s 20% VAT data and does not define future mixed or zero-rate treatment.
- **Rationale:** “Exact on every live row” is a data observation, not a future-safe rule. A fail-only reconciliation gives staff no correction path.
- **Impact:** Valid future bookings may become impossible to invoice, or customers may see a discount that is financially correct but not understandable.
- **Recommended action:** Define a decimal/penny allocation algorithm and a transparent invoice representation. Consider a supported fixed-discount field or an explicit adjustment line with defined VAT treatment. Add mixed-rate and adversarial rounding tests.
- **Open questions:** Must original unit prices and discount reasons be shown? Are mixed VAT rates expected? Is a one-penny adjustment line acceptable to the accountant and customer?
- **Priority:** P1
- **Type:** Money / VAT
- **Status:** Confirmed issue

### C11 — The confirmation preview can differ from what is sent

- **Relevant section:** 4 confirmation dialog, 7 guards
- **Description:** The spec does not bind the preview to a data version. Email, line items, discounts, VAT, deposit, or payments can change after the dialog opens. The server action can then send different figures or to a different address while the user believes they confirmed the preview.
- **Rationale:** Client-side disabled state and a confirmation modal are not concurrency controls.
- **Impact:** The wrong customer, amount, or terms can be sent despite an apparently exact confirmation step.
- **Recommended action:** Generate the preview server-side with a stable source hash/version. On confirm, lock and re-read the booking, compare the hash, and return “Booking changed; review again” on mismatch. Never trust client-supplied totals or recipient data.
- **Open questions:** Which fields form the confirmation hash? Can contact-only changes proceed, or must every change force re-preview?
- **Priority:** P0
- **Type:** Concurrency / UX
- **Status:** Confirmed issue

### C12 — The send step lacks a complete invoice and durable deposit context

- **Relevant section:** 3 steps 3–6, 10
- **Description:** `createInvoiceAsAdmin` returns only the invoice header. It does not return vendor, lines, or newly recorded payments. `sendInvoiceEmail` needs `InvoiceWithDetails` to render the PDF. The spec does not require a refetch or assembly step. The proposed deposit context is not persisted, so retries, reminders, later downloads, and template changes cannot reproduce the original panel.
- **Rationale:** A direct call with the creation result can produce a PDF with missing lines and customer details. Reading current booking deposit data later can rewrite history.
- **Impact:** Blank or incomplete attachments and deposit wording that changes after issue or refund.
- **Recommended action:** Persist the deposit disclosure as immutable invoice metadata or notes, then fetch a complete invoice snapshot after the atomic creation step. Use the same snapshot for initial email, retry, reminder, download, and audit.
- **Open questions:** Should deposit payment method be shown? Must the panel remain after refund? Where is the sent PDF stored?
- **Priority:** P1
- **Type:** Integration
- **Status:** Confirmed issue

### C13 — Booking line order cannot be preserved reliably

- **Relevant section:** 5 “in `display_order`”
- **Description:** `private_booking_items` has `display_order`, but `invoice_line_items` does not. Array insertion order is not a durable query order, and invoice fetches do not order the embedded relationship.
- **Rationale:** PostgreSQL/PostgREST does not guarantee row order without an explicit ordered column.
- **Impact:** PDF and screen line order can change between generation, retry, and download.
- **Recommended action:** Add and populate `display_order` on invoice lines and order every invoice line query, or explicitly remove ordering as a requirement.
- **Open questions:** Must invoice order exactly match the contract order?
- **Priority:** P1
- **Type:** Data model
- **Status:** Confirmed issue

### C14 — Vendor matching and recipient selection are ambiguous and race-prone

- **Relevant section:** 3 step 1, 7 “Repeat customer”, 8
- **Description:** “Upsert by customer ID, then exact email” is not a real upsert because email has no unique constraint. Exact email matching is case/whitespace sensitive and can return multiple rows. A shared address can attach the wrong customer. Existing invoice send paths may prefer an invoice-vendor primary contact over the booking email shown in the dialog. The spec also does not state which name, phone, email, address, payment terms, or active state are written or updated.
- **Rationale:** Vendor identity and email recipient are separate decisions. Reusing a mutable vendor row can also change later renderings of old invoices.
- **Impact:** Duplicate vendor records, wrong recipients, stale data, and historical invoice drift.
- **Recommended action:** Require a valid `customer_id` where possible and use its unique link only. Define a safe fallback for legacy null-customer bookings. Freeze the confirmed `to` address for this dispatch and do not silently substitute another contact. Define field mapping and update rules.
- **Open questions:** Can one customer have multiple billing identities? Are CC recipients allowed? Should changed booking email update the shared invoice vendor?
- **Priority:** P1
- **Type:** Data / delivery
- **Status:** Confirmed issue

### C15 — Deposit refund and abnormal deposit states are ignored

- **Relevant section:** 1 deposit wording, 7, 10
- **Description:** The data model has `deposit_refund_status`, but the panel only distinguishes waived versus shown. It does not define behaviour for unpaid amount with no paid date, partial refund, full refund, retained deposit, missing amount, corrected payment date, or a confirmed legacy booking without a valid deposit state. “Will be refunded” becomes false after a refund or retained deduction.
- **Rationale:** The panel is a factual statement on a financial document and must reflect a stable state.
- **Impact:** Misleading customer communication and inconsistent records.
- **Recommended action:** Define a deposit-state decision table and snapshot the exact sentence at issue. Block impossible states and route them to data repair.
- **Open questions:** Should refunded deposits be shown as refunded, omitted, or retained as historical information? Is the refund promise conditional on full event balance and inspections exactly as in the contract?
- **Priority:** P1
- **Type:** Functional
- **Status:** Confirmed issue

### C16 — Eligibility and lifecycle journeys are incomplete

- **Relevant section:** 3 guard, 7, 8
- **Description:** The spec covers draft, confirmed, cancelled, no email, and zero total, but not completed bookings, date-TBD bookings, confirmed bookings with no contract sent, fully paid bookings, overpaid/inconsistent bookings, historical events, refunded payments, disputes, deleted/void invoices, or a booking whose email becomes invalid. It also says draft is hidden, cancelled is blocked, and the generic pre-invoice state is disabled, which is internally inconsistent UI behaviour.
- **Rationale:** The live evidence includes old events and inconsistent payment flags. These are not theoretical cases.
- **Impact:** Staff cannot predict availability or recovery steps, and customers may receive an invoice when a receipt or manual review is more appropriate.
- **Recommended action:** Add an eligibility matrix with server behaviour, UI behaviour, message, and recovery action for every booking/payment/invoice state. Decide whether contract sent/signed and address are prerequisites.
- **Open questions:** Can completed bookings be invoiced? Should a fully paid booking send a paid invoice or a receipt? Must a contract have been sent first? What happens when `date_tbd = true`?
- **Priority:** P1
- **Type:** User journeys
- **Status:** Confirmed issue

### C17 — Privileged money operations and feature permissions are not safely defined

- **Relevant section:** 3, 8, 11 item 2
- **Description:** The server action is proposed to use a service-role invoice creator but no server-side permission contract is specified. The current 2026-08-27 security migration explicitly lists `create_invoice_transaction` and `record_invoice_payment_transaction` among SECURITY DEFINER functions still executable by `anon`. The invoice module has a `send` permission, but existing email code checks `edit`. The booking page has separate private-booking permissions.
- **Rationale:** UI visibility is not authorisation. Service-role code bypasses RLS, and the underlying RPCs do not form a safe boundary.
- **Impact:** Unauthorised invoice/payment mutation, RBAC bypass, and inconsistent access between UI and direct action/RPC calls.
- **Recommended action:** Make closure of the two relevant RPCs a release dependency. Give new atomic functions a fixed `search_path`, internal permission checks, and narrowly scoped grants. Require an authenticated user plus explicit private-booking and invoice create/send permissions in the action. Add negative permission tests.
- **Open questions:** Which roles may generate and send? Are `private_bookings.manage`, `generate_contracts`, or a new `generate_invoices` permission required? Is invoice view permission required for the post-send link?
- **Priority:** P0
- **Type:** Security / authorisation
- **Status:** Confirmed issue

### C18 — Existing consumer-facing invoice text needs correction before reuse

- **Relevant section:** 10, current invoice/email templates
- **Description:** The standard invoice email currently presents `Amount Due` as the full `total_amount`, not the outstanding balance. The spec incorrectly says the standard email already prints Total Paid. The PDF also states “Card Payments: Subject to additional fees”. UK guidance prohibits many consumer payment surcharges; see [GOV.UK payment surcharge guidance](https://www.gov.uk/government/publications/payment-surcharges). The generic reminder and email copy is Orange Jelly branded while the contract is with Orange Jelly Limited trading as The Anchor.
- **Rationale:** This feature takes a mainly B2B template into a consumer private-booking journey.
- **Impact:** Customers can be asked for the wrong amount, see potentially unlawful fee wording, or be confused about the trading identity.
- **Recommended action:** Add a consumer-safe private-booking email/template variant or correct the shared template. Show invoice total, paid amount, balance due, event reference, trading identity, and accurate payment options. Remove or obtain legal approval for fee wording before release.
- **Open questions:** Which trading name should be primary? Are card payments offered, and without surcharge? Should reminder copy use The Anchor tone and contact details?
- **Priority:** P0
- **Type:** Compliance / content
- **Status:** Confirmed issue

### C19 — Accounting export and revenue treatment are unresolved

- **Relevant section:** 2 invoices module, 11 item 5
- **Description:** The spec explicitly says the accountant’s quarterly ZIP excludes Anchor invoices, then leaves that out of scope. It also does not confirm whether creating invoices causes booking revenue to be counted twice in P&L, VAT, dashboard, or sales reports, or whether historical payments need a different tax/accounting treatment.
- **Rationale:** Creating a sales invoice is an accounting event, not only a customer PDF action.
- **Impact:** Missing sales invoices in accountant records, duplicate revenue, incorrect VAT periods, and unreconciled cash.
- **Recommended action:** Map every downstream invoice/report/export consumer before release. Have the accountant approve invoice date/tax point, historical payments, deposit disclosure, VAT, credit handling, and export inclusion. Add reconciliation tests.
- **Open questions:** Where is private-booking revenue recognised today? Which report becomes authoritative? Must all issued invoices and credits appear in the quarterly pack?
- **Priority:** P1
- **Type:** Accounting / reporting
- **Status:** Confirmed issue

### C20 — The proposed “out of date” test misses material changes

- **Relevant section:** 7 “Items edited after sending”
- **Description:** Comparing only `booking.gross_total` with invoice total misses description changes, quantity/unit-price changes that net to the same total, VAT redistribution, discounts, event date, customer identity, and payment changes.
- **Rationale:** A financial document can be materially wrong while its grand total remains unchanged.
- **Impact:** Staff see “up to date” for an invoice that no longer matches the booking or contract.
- **Recommended action:** Store a canonical source snapshot/hash containing all billed and customer-visible fields. Compare the current canonical hash with the invoiced hash and show what changed.
- **Open questions:** Which non-financial booking changes invalidate an invoice? Does a contact email change require reissue or only affect future sends?
- **Priority:** P1
- **Type:** Data integrity
- **Status:** Confirmed issue

### C21 — Partial-failure recovery and soft-delete behaviour are undefined

- **Relevant section:** 3 workflow, 7 email failure, 9
- **Description:** There is no state/recovery table for failures at vendor creation, number allocation, invoice insert, payment N, booking link, PDF generation, Graph send, email log, booking timestamp, audit, or revalidation. A linked draft invoice can be soft-deleted by current invoice code, but `ON DELETE SET NULL` will not run on a soft delete, leaving the booking linked to an invisible invoice.
- **Rationale:** The design is a distributed saga even after database creation is made atomic because email cannot be part of the database transaction.
- **Impact:** Stuck bookings, orphan invoices, duplicate sends, broken “View invoice” links, and manual database repair.
- **Recommended action:** Define a failure-state matrix and retry ownership. Prevent soft deletion of source-linked invoices or atomically unlink with audited recovery. Make every retry safe and return stable outcome codes.
- **Open questions:** Who can abandon a failed invoice? Can a failed, never-delivered invoice be voided and replaced? What should happen after an audit/log write failure when Graph already accepted the email?
- **Priority:** P1
- **Type:** Error handling
- **Status:** Confirmed issue

### C22 — The UI and document accessibility requirements are incomplete

- **Relevant section:** 4, 7, 8, 10
- **Description:** A tooltip on a disabled button is commonly unavailable to keyboard and touch users. The confirmation dialog has no requirements for focus management, keyboard close, accessible name/description, busy state, or announced errors. The PDF accessibility of the current Chromium output is not assessed.
- **Rationale:** This is a staff workflow and a customer financial document. Both need usable alternatives.
- **Impact:** Some staff cannot understand or operate the action, and some customers cannot read the attachment.
- **Recommended action:** Show a persistent reason below the button, not tooltip-only. Use an accessible modal with focus trap/restore, labelled totals, keyboard controls, and live error messages. Keep the email body as a complete text alternative and assess PDF tagging/read order.
- **Open questions:** What accessibility standard is required? Is an accessible HTML invoice view available to customers?
- **Priority:** P1
- **Type:** Accessibility
- **Status:** Confirmed issue

### C23 — The test plan omits the highest-risk behaviour

- **Relevant section:** 13
- **Description:** Tests cover mapper examples and simple guards but omit concurrency, transaction rollback, retry idempotency, post-invoice payment sync, source change after preview, recipient drift, Graph uncertain/failure outcomes, cron interactions, permission denial, soft deletion, completed/fully paid bookings, payment method mapping, mixed VAT, line ordering, credits/reissues, accounting exports, accessibility, and visual PDF overflow.
- **Rationale:** Most serious failures occur between steps rather than inside the pure mapper.
- **Impact:** Tests can pass while duplicate invoices, wrong reminders, missing payments, and unauthorised calls remain possible.
- **Recommended action:** Add database integration tests around the atomic RPC, two-request concurrency tests, fault injection after every boundary, retry tests, cron eligibility tests, server-action permission tests, rendered PDF/email snapshots, accessibility tests, and accounting reconciliation. Use anonymised fixtures, not production PII.
- **Open questions:** Is a local Supabase integration environment available in CI? How are Graph calls safely stubbed? Who approves visual and accounting fixtures?
- **Priority:** P1
- **Type:** Testing
- **Status:** Confirmed issue

### C24 — Monitoring, reconciliation, and operational ownership are unspecified

- **Relevant section:** 3 “audit”, 7 errors, 12
- **Description:** “Audit” is not defined. There are no metrics, alerts, dashboards, reconciliation queries, or owners for duplicate/orphan invoices, source/payment drift, mismatched totals, failed sends, repeated retries, reminder-before-initial-send, or missing accountant export.
- **Rationale:** Email and multi-system financial workflows will have partial failures even with good code.
- **Impact:** Failures can remain invisible until a customer complains or accounting closes the quarter.
- **Recommended action:** Define structured audit fields and alerts. Monitor creation, initial delivery, retries, payment-sync drift, orphan links, total/hash mismatch, and cron actions. Provide a daily reconciliation query and named owner/runbook.
- **Open questions:** Which alert channel and response time apply? How long may an initial send remain failed? Who resolves data mismatches?
- **Priority:** P1
- **Type:** Monitoring
- **Status:** Confirmed issue

### C25 — The proposed phases are not safe release units

- **Relevant section:** 12
- **Description:** Phase 3 introduces an action before the PDF/email contract is ready. “Unreachable” is not a reliable security or release boundary. The plan has no feature flag, deployment order for types/migrations, rollback approach, migration verification, canary, owner, or release acceptance gate. A target line count is not a delivery outcome.
- **Rationale:** The riskiest pieces—atomicity, payment sync, permissions, and delivery state—cross the proposed PR boundaries.
- **Impact:** Half-built behaviour can reach production, or later phases can discover schema decisions that invalidate earlier work.
- **Recommended action:** Rephase around deployable outcomes: (1) approved domain/state model plus secure atomic DB foundation and integration tests; (2) complete document/email path behind a disabled feature flag; (3) accessible UI, canary, monitoring, and controlled rollout. Verify rollback and forward-fix steps.
- **Open questions:** Is a feature flag system available? Which environment has representative data without real recipients? Who signs off database, accounting, and customer copy?
- **Priority:** P1
- **Type:** Delivery
- **Status:** Confirmed issue

### C26 — Production evidence contains PII and will become stale

- **Relevant section:** 1 live examples, 2 live counts, 11
- **Description:** The specification includes customer names, event dates, payment amounts, and an example email. It also treats current production counts as durable requirements.
- **Rationale:** Repository documents and fixtures should minimise production personal data, and current counts will change immediately.
- **Impact:** Unnecessary privacy exposure and tests/spec assumptions that become stale.
- **Recommended action:** Redact or pseudonymise examples before commit. Record the observation date and reproducible aggregate queries. Build future-safe rules rather than logic tied to “18 bookings” or “all 20% VAT”.
- **Open questions:** Is the `tasks` directory committed or shared externally? What is the approved handling policy for production examples?
- **Priority:** P2
- **Type:** Privacy / maintainability
- **Status:** Confirmed issue

### C27 — The sent invoice is not preserved as an immutable snapshot

- **Relevant section:** 3 source-of-truth statement, 7 corrections, 10
- **Description:** Current invoice PDFs are generated from mutable vendor data and the current template. The new deposit panel would also depend on mutable booking data unless persisted. The spec does not store the exact PDF or canonical rendering inputs sent to the customer.
- **Rationale:** GOV.UK says VAT records, including issued sales invoices and even cancelled/mistaken invoices, should be kept for at least six years; see [GOV.UK VAT record keeping](https://www.gov.uk/charge-reclaim-record-vat/keeping-vat-records). Regenerating later can produce a different document.
- **Impact:** The business may be unable to reproduce what was actually issued during a dispute, audit, template change, customer update, or deposit refund.
- **Recommended action:** Store the issued PDF or immutable canonical snapshot, content hash, recipient, message ID, template version, and issue timestamp. Later downloads should default to the issued snapshot.
- **Open questions:** Should this reuse `private_booking_documents` or a general invoice-document store? What is the retention/deletion policy?
- **Priority:** P1
- **Type:** Records / audit
- **Status:** Confirmed issue

### C28 — Required type, query, constraint, and UI data changes are missing

- **Relevant section:** 8, 9, 12
- **Description:** The migration does not mention regenerated database types, private-booking types, invoice/deposit snapshot types, or how the booking detail query obtains invoice number, status, total, sent recipient, and delivery failure. `invoice_sent_at` has no consistency constraint and no `sent_to`. The booking page may be viewable by a user without invoice-view permission, so simply joining the invoice can fail RLS expectations.
- **Rationale:** The proposed status line and retry flow need more than `invoice_id`.
- **Impact:** Type errors, missing UI data, permission leaks or failures, and inconsistent timestamps.
- **Recommended action:** Specify all generated/manual type updates and a permission-safe read model. Add consistency constraints or remove redundant booking-level send fields. Define indexes and query plans for source lookup, payment sync, and failed delivery.
- **Open questions:** Can private-booking viewers see invoice amounts and PDFs? Should “View invoice” require a separate invoice permission? Is the latest successful email log sufficient for the status line?
- **Priority:** P1
- **Type:** Integration / migration
- **Status:** Confirmed issue

## Optional improvements

### O01 — Use a first-class invoice source relationship

- **Relevant section:** 3, 9
- **Description:** Instead of only `private_bookings.invoice_id`, add an invoice source relation such as `invoices.source_type/source_id` or a dedicated `invoice_sources` table.
- **Rationale:** It gives direct uniqueness, audit, source queries, and room for replacements or supplementary invoices.
- **Impact:** Slightly larger migration, but a cleaner long-term model.
- **Recommended action:** Prefer a dedicated link table if one booking may have multiple invoice documents; otherwise use a unique source key on `invoices`.
- **Open questions:** Will other modules need the same source-link pattern?
- **Priority:** P2
- **Type:** Simplification
- **Status:** Optional improvement

### O02 — Narrow the first release to stable bookings

- **Relevant section:** 7, 12
- **Description:** V1 could require a confirmed future booking, contract sent, valid customer ID/email/address, no dispute, positive balance, supported payments, and finalised line items. Financial edits could be locked after issue.
- **Rationale:** This avoids solving historical, completed, fully paid, and correction cases in the first release.
- **Impact:** Fewer bookings are immediately eligible, but delivery is safer and smaller.
- **Recommended action:** If chosen, make exclusions explicit and provide staff recovery actions rather than silently hiding the button.
- **Open questions:** Does this reduced scope still meet the business need?
- **Priority:** P2
- **Type:** Simplification
- **Status:** Optional improvement

### O03 — Decouple manual review from the legacy auto-send cron

- **Relevant section:** 4
- **Description:** Add an explicit `auto_send_enabled` or invoice origin/delivery policy and make the cron select only opted-in automated invoices.
- **Rationale:** The current cron runs once daily and selects only drafts whose invoice date is *that same day*. A draft created after the run is not automatically sent “the next morning”, because tomorrow’s date no longer matches. The spec’s rationale for mandatory one-click sending is therefore incomplete.
- **Impact:** A real draft-review workflow becomes possible without affecting recurring/automated invoices.
- **Recommended action:** Make send policy explicit rather than inferred from status and invoice date.
- **Open questions:** Which existing invoice creators depend on current broad cron behaviour?
- **Priority:** P2
- **Type:** Delivery
- **Status:** Optional improvement

### O04 — Use an email outbox rather than a long synchronous action

- **Relevant section:** 3, 4, 7
- **Description:** Commit the invoice and a dispatch job, then let a worker generate/store the PDF and send with retries.
- **Rationale:** PDF generation and Graph calls are slow and cannot share a database transaction. An outbox makes timeouts and retry ownership clearer.
- **Impact:** The UI becomes “queued/sending” rather than blocking, with slightly more infrastructure.
- **Recommended action:** Consider this if the existing email system can support a durable idempotent job. It is not needed for throughput, but improves reliability.
- **Open questions:** Is there an existing job/outbox framework suitable for invoice delivery?
- **Priority:** P2
- **Type:** Reliability / performance
- **Status:** Optional improvement

### O05 — Add a preflight and data-readiness view

- **Relevant section:** 2, 7, 8
- **Description:** Show why each booking is or is not invoice-ready and provide direct links to fix email, address, contract, item, payment, or data-consistency problems.
- **Rationale:** Many current bookings are missing essential data, and a disabled button alone does not help staff resolve it.
- **Impact:** Small extra UI effort; fewer support questions and failed actions.
- **Recommended action:** Reuse the same server eligibility function for the list, detail page, preview, and final transaction.
- **Open questions:** Should readiness appear on the booking list or only the detail page?
- **Priority:** P3
- **Type:** Operations
- **Status:** Optional improvement

### O06 — Preview the actual generated PDF before dispatch

- **Relevant section:** 4 confirmation dialog
- **Description:** Offer the exact immutable PDF snapshot in the confirmation dialog, not only a reconstructed line summary.
- **Rationale:** It lets staff verify legal details, page breaks, recipient, deposit wording, bank details, and amount before sending.
- **Impact:** More preview-generation work and possible delay, but stronger confidence.
- **Recommended action:** Use the same preview hash and snapshot that the confirm action will issue.
- **Open questions:** Is the summary sufficient for the business, or is visual approval required?
- **Priority:** P3
- **Type:** UX
- **Status:** Optional improvement

## Readiness assessment

### Current readiness

- **Business policy:** partly ready; deposit treatment is clear, but approval questions are missing.
- **Functional design:** not ready; payment, corrections, eligibility, and lifecycle journeys are incomplete.
- **Technical design:** not ready; atomicity, idempotency, state, arithmetic, and schema assumptions need redesign.
- **Security:** not ready; permissions and exposed money RPCs are release blockers.
- **Compliance/accounting:** not ready; billing address, supply/tax date, card-fee copy, retention, and exports need approval.
- **Delivery:** not ready; phases, rollback, canary, monitoring, and recovery are incomplete.
- **Testing:** not ready; current plan does not exercise the main risks.

## Key required changes

1. Replace the multi-call create/link/payment workflow with one secure, idempotent database transaction.
2. Define a single post-invoice payment source of truth and synchronise booking and invoice balances atomically.
3. Separate payment status from delivery state and update auto-send/reminder eligibility.
4. Decide invoice date, supply/tax date, due date, reference, reminder timing, and customer billing-address requirements.
5. Choose a supported correction model for decreases, increases, cancellation, paid invoices, and supplements.
6. Resolve schema/arithmetic drift and use deterministic decimal allocation with database integration tests.
7. Make permission checks and RPC grants safe before exposing the action.
8. Correct the consumer email/PDF copy, including balance due and card-fee wording.
9. Persist an immutable issued snapshot and durable delivery evidence.
10. Rephase delivery behind a feature flag with fault, concurrency, cron, accessibility, and accounting tests.

## Unresolved decisions

1. Is deposit netting definitively out of scope, and who signs that decision off?
2. Is V1 immediate-send only, or should reviewed drafts be supported after fixing cron scope?
3. What is the canonical source of truth for payments after invoice issue?
4. Which invoice/supply/due dates apply, especially for old, short-notice, and completed bookings?
5. Are billing addresses mandatory, and for which customer/invoice types?
6. Can one booking have supplements, replacements, or more than one invoice?
7. What happens when booked items change after issue?
8. Which statuses are eligible, including completed and fully paid bookings?
9. Must a contract be sent or signed before invoicing?
10. What exactly constitutes successful sending and who owns retries?
11. Which roles may create, send, retry, view, void, and correct a booking invoice?
12. How are these invoices included in accountant exports, VAT reporting, and revenue reports?

## Major risks

- Duplicate or orphan customer invoices caused by concurrent requests.
- Incorrect customer balances and contradictory SMS, portal, invoice, and reminder messages.
- Incomplete or misleading invoices due to missing address, date, balance, or deposit state.
- Unauthorised money mutations through service-role code or exposed SECURITY DEFINER RPCs.
- No valid correction route when the booking changes.
- Accounting/VAT omissions or double counting.
- Email failures that appear successful, or reminders sent before the initial invoice.
- Inability to reproduce the exact invoice sent during an audit or dispute.

## Key dependencies

- Business-owner approval of deposit, eligibility, reminder, and correction policy.
- Accountant approval of invoice fields, tax point, VAT, historical payments, credits, and exports.
- A corrected and verified invoice schema across local, test, staging, and production.
- Secure invoice/payment RPC grants and an agreed RBAC permission model.
- A durable email-delivery/idempotency mechanism and safe test-recipient setup.
- Customer billing-address capture if required by the approved invoice form.
- A feature-flagged deployment path, database integration CI, and an operational owner.

## Recommended next steps

1. Hold a short decision review with the business owner, accountant, and developer to answer the unresolved decisions above.
2. Write the payment, delivery, correction, and eligibility state tables before choosing columns.
3. Prototype the atomic database operation and prove two-request concurrency plus retry safety in a database integration test.
4. Confirm live schema versus migrations and add any corrective migration first.
5. Approve the consumer invoice/email template and required customer data.
6. Update the specification with decisions and acceptance criteria; do not start UI work before this gate.
7. Build the complete flow behind a disabled feature flag, canary it with a safe test recipient, then roll out with reconciliation monitoring.

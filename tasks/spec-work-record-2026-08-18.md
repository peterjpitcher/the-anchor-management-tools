# Spec: the Work Record

**Date:** 2026-08-18
**Status:** draft for review. No code written.
**Complexity:** L. Three independently deployable pieces, roughly 600 to 700 lines, mostly layout and tests.

---

## 1. What it is

A PDF you can send a client that says what work was done, what it was worth, and which invoice
charged it. It is a sibling of the Account Statement: same logo, same layout, same house style. It
never asks for money and carries no bank details.

Heading: **WORK RECORD**. Not "Statement of Work", which means a contract, and not "Account
Statement", which is the one that chases payment.

## 2. Why the obvious design is wrong

Grouping work by month and calling that "the invoice" would be a lie for any capped client.
Golden Barrels' 28.25 hours logged in January 2026 are spread across five invoices, because they
pay a flat GBP 500 a month and the rest carries forward.

Verified against production: **no Golden Barrels invoice sums from the work attached to it.**

| Invoice | Invoice ex VAT | Work | Recurring | Unexplained by entries |
|---|---|---|---|---|
| INV-003VL | 416.67 | 384.83 | 30.00 | 1.84 |
| INV-003VP | 416.67 | 375.00 | 30.00 | 11.67 |
| INV-003VS | 416.67 | 375.00 | 30.00 | 11.67 |
| INV-003VW | 416.67 | 375.00 | 40.00 | 1.67 |
| INV-003VZ | 416.67 | 365.00 | 40.00 | 11.67 |
| INV-003WC | 416.67 | 218.75 | 40.00 | 157.92 |
| INV-003W9 | 416.67 | 375.00 | 40.00 | 1.67 |
| INV-003VI | 416.67 | 0.00 | 0.00 | **416.67** |
| INV-003VM | 416.67 | 0.00 | 0.00 | **416.67** |

So every invoice block must close with an explicit carry-forward line, or the document contradicts
your own invoices.

## 3. What the client sees

**Page 1, the answer.** Designed so most clients read this and stop.

1. Header: logo, company block, client name, period. Identical to the account statement.
2. One plain sentence: "This record covers the billable work carried out for Golden Barrels
   Limited between 3 December 2025 and 18 August 2026: 70.75 hours across 3 projects."
3. **Where the time went.** Project, what it covers, entries, hours. Sorted by hours. Hours only,
   no money.
4. **How it was invoiced.** The carry-forward strip:

   ```
   January 2026    28.25 h    INV-003VL, INV-003VP, INV-003VS, INV-003VW, INV-003VZ
   May 2026        21.50 h    INV-003VZ, plus 18.00 h not yet charged
   ```

   With one sentence beneath it for capped clients: "You pay a fixed GBP 500 including VAT each
   month while there is a balance on your account, so a month's work is charged over several
   invoices."
5. Page break. Page 1 stands alone as a complete answer.

**Pages 2 onward, the evidence.**

6. One block per invoice, oldest first: invoice number, date, total, paid or not. Then its entries:
   date, project, what was done, hours or miles. Then the closing lines that make it add up:

   ```
   Work on this invoice              5.00 hours      450.00
   Hosting and maintenance                            36.00
   Payment towards earlier work carried forward       14.00
   Invoice total                                     500.00
   ```

7. **Work done, not yet charged.** Same table, no invoice column, no due date, placed last so it
   cannot read as a bill.
8. **Work already settled, invoice reference not recorded.** Appears only when it applies.
9. Footer: company registration, VAT number, address, contact. No bank details.

## 4. Rules that fall out of the data

- **Recurring charges must be included.** Hosting lives in `oj_recurring_charge_instances`, not in
  entries, and runs at GBP 30 to GBP 40 ex VAT on every Golden Barrels invoice. Omit it and no
  invoice ever adds up.
- **Void invoices are excluded**, matching the account statement. Their work has moved to the
  reissued invoice, so including both would show the same work twice.
- **If the arithmetic does not close, the client never sees it.** The account statement prints its
  mismatch on the page; this document must not. The check runs at generation, and a failure blocks
  the PDF and reports on screen instead.
- **Internal notes are never shown.** Five entries carry them today.
- **Per-entry money is computable.** No time entry is missing a rate snapshot.
- **The invoice link is reliable.** All 228 linked entries point at a real, non-void invoice.

## 5. What gets built, what is reused

**Reused, so this is not a fifth PDF design:**
`src/lib/pdf/document-chrome.ts`, `src/lib/pdf/document-logo.ts`, `src/lib/pdf-generator.ts` at A4
with 8mm margins, the date and money formatting from `src/lib/oj-statement.ts`, the invoice scoping
and date validation from `client-statement.ts`, the permission gate and route shape of
`statement-pdf/route.ts`, and the drawer's existing date controls.

**Built, in three deployable pieces:**

1. **Move the pricing helpers out of the billing cron.** `getEntryCharge` and `getRecurringCharge`
   sit inside a 3,800-line route file. Move them to `src/lib/oj-projects/charges.ts` unchanged and
   have the cron import them back. About 30 lines, no behaviour change. Two copies of the pricing
   rules would guarantee a document that disagrees with your own invoices.
2. **The calculator.** A pure function taking entries, recurring charges and invoices, returning the
   groups, the carry-forward strip and the totals. No database, no HTML, so the arithmetic is
   directly testable.
3. **The document.** Template, server action, PDF route, a Work Record button beside the existing
   Statement button, and an on-screen preview. Download only at first; you attach it to your own
   email, because these descriptions have never left the building before.

**Later, not now:** rebuild the existing timesheet attachment on the same calculator and delete
`src/lib/oj-timesheet.ts`, the one PDF still hand-rolling its own layout.

## 6. What could go wrong

- Entry descriptions were written for internal use and have never been read by a client. The
  preview exists so nothing goes out unseen.
- A long period produces a long document. The same pagination rules as the statement apply, and the
  60-plus row fixture carries over.
- If a capped invoice ever fails to close, generation stops rather than printing a contradiction.

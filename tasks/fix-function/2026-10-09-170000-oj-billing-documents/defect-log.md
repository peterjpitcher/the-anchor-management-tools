# OJ Projects billing documents: defect log

Run started 9 October 2026 from base commit `1c0a6a4c` (clean worktree, nothing dirty at the start).
Mode: continuous remediation. Scope: the account statement, the Work Record, the client drawer balance
and the capped billing run they depend on.

## Evidence

Live figures for Golden Barrels Limited on 9 October 2026, after the day's ledger correction:

| Figure (inc VAT) | Amount |
|---|---|
| Invoiced to date | 6,355.00 |
| Paid to date | 4,355.00 |
| Invoiced and unpaid (4 invoices) | 2,000.00 |
| Work done, not yet invoiced | 2,100.00 |
| Regular charges, not yet invoiced | 192.00 |
| Already invoiced on account | 256.98 before the backfill, 69.48 after |
| Total for all work to date | 4,035.02 |

Gap between each capped invoice and the work attached to it (ex VAT): VL 1.84, VP 11.67, VS 11.67,
VW 1.67, VZ 11.67, WC 157.92, W9 1.67, WG 1.67, WW 14.40. Total 214.18. No other client is affected:
Golden Barrels is the only client on a flat monthly amount.

## Log

| ID | Type | Severity | Finding | Root cause | Status |
|---|---|---|---|---|---|
| FF-001 | Data risk | High | Money invoiced with no work attached is asked for again later | The run tops each invoice up to the flat amount (`applyStatementCapTopUp`), splits time only in 15 minute blocks, counts unpaid invoices in the target, and a reissue detaches older work while keeping the total. Nothing records the top-up. | Documents and drawer now deduct it (fixed, verified). The billing run itself is unchanged: awaiting approval. |
| FF-002 | UX gap | High | Statement showed only invoiced and unpaid, so GBP 2,000 for a GBP 4,035 position | Statement never loaded unbilled work | Fixed, verified |
| FF-003 | UX gap | High | Work Record gave no value for unbilled work, no unpaid total and no view of invoices to come | Not in the original design | Fixed, verified |
| FF-004 | Bug | Medium | Regular charges not yet invoiced were invisible on the Work Record | Only instances linked to an invoice were read | Fixed, verified |
| FF-005 | UX gap | Medium | "Time spent on this stage, 0.00 hours" on a fixed-price invoice with no time logged | Row printed unconditionally | Fixed, verified |
| FF-006 | Bug | Medium | "Payment towards earlier work carried forward" on the first invoice of an account | One label for two different things | Fixed, verified. Wording now differs for a flat monthly invoice and one raised by hand. |
| FF-007 | UX gap | Low | Date and project columns wrapped on some tables and not others | Automatic table layout, no column widths | Fixed, verified in a rendered PDF |
| FF-008 | Data risk | Medium | Drawer, statement and Work Record each summed the position separately | Three implementations | Fixed: one pure function, one loader |
| FF-009 | Data risk | Medium | The projection in the notes on each invoice ignores regular charges and the on-account balance | Separate arithmetic inside the cron | Out of scope here: part of the billing run change (FF-001) |
| FF-010 | UX gap | Low | A refused Work Record download shows raw JSON in a new tab | Route returns JSON, button opens a tab | Fixed: both downloads are fetched and a refusal shows as a message on the client screen |
| FF-011 | Data risk | High | Barons Pubs: 55 logged time entries (105 hours) marked paid with no invoice, and four invoices with no work linked, so a Work Record from before January 2026 was refused | Time tracking was added in January 2026 and earlier work was entered afterwards without links | Fixed by backfill `20261009162347`, verified on live data |
| FF-012 | Data risk | Medium | INV-003WC carried GBP 157.92 ex VAT on account after the 17 August reissue | Reissue detached older work and kept the total | Fixed by backfill: 2.5 hours of the unbilled 31 May entry split onto it. Gap now GBP 1.67, the same as its neighbours |
| FF-013 | Bug | Low | A one penny difference between an invoice and its individually rounded entries printed as a discrepancy | No tolerance for per-entry rounding | Fixed: labelled Rounding |
| FF-014 | Data risk | Low | Eight Barons Pubs mileage entries from September to December 2025 (GBP 94.08) are marked paid but are on no invoice | Entered after the event; the hand-raised invoices carried time only | Open: owner decision |

## Sibling checks

- Other clients with a gap between invoice and attached work: queried every `OJ Projects` invoice; only Golden Barrels.
- Other readers of the position: `getClientBalance` (drawer) now shares the loader. The billing cron and
  `statement-cap.ts` keep their own sum on purpose until FF-001 is approved.
- Other callers of the templates: `scripts/design/generate-sample-pack.ts` passes no position, which stays valid because the field is optional.

## Verification

- `npm run lint`: clean.
- `npx tsc --noEmit` and `npm run typecheck:tests`: clean.
- `npm test`: 1266 files, 13,325 passed, 2 skipped.
- New tests under `TZ=UTC`: 78 passed.
- `npm run build` with CI placeholders: passed.
- Both documents rendered to PDF from live data with the new code and read back.

## After the backfill (live data, 9 October 2026)

All four OJ Projects clients build a Work Record that reconciles with no unexplained invoices: Golden
Barrels, Barons Pubs, ASE Associates and Mitch McKee. Golden Barrels: work not yet invoiced 1,912.50,
regular charges 192.00, on account 69.48, still to be invoiced 2,035.02, total for all work 4,035.02.
The total is unchanged by the backfill, as it should be: work moved from "not yet invoiced" to an
invoice that had already charged for it.

Known and accepted: the billing run still tops each flat monthly invoice up to the monthly amount, so
a few pounds go on account each month. The documents and the drawer deduct it. The run itself does not,
by the owner's decision of 9 October 2026.

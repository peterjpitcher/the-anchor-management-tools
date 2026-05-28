# Receipts: New Expense Category Proposals

**Date:** 2026-05-27
**Status:** Awaiting decision — these categories are not yet in `receiptExpenseCategorySchema`.

## Context

Expense categories are not free text. They are a fixed Zod enum in `src/lib/validation.ts:164` (`receiptExpenseCategorySchema`) and wired into P&L reporting in `src/lib/pnl/constants.ts:33` (`EXPENSE_METRIC_DEFS`) and the Greene King benchmark mapping. Adding a category is a business decision (it changes the P&L taxonomy and the benchmark comparison) — not a code-only change.

This document collects the five buckets where existing rules deliberately leave `set_expense_category` null because no enum value fits. Each one shows the gross spend impact today.

## Why this matters

Across the receipts database today, 1,508 of 2,939 transactions have no expense category. After the rule-patching session on 2026-05-27, ~219 of those have been filled. The buckets below explain most of what's still uncategorised. They cover **£525k+ in tracked flow** that currently doesn't land in any P&L row.

---

## 1. Pubco Rent / Tied Lease — **£284k, 125 transactions**

Greene King direct-debit payments are the single biggest unclassified flow.

| Vendor | Hits | Spend |
|---|---|---|
| Greene King | 125 | £284,111.76 |

**Why no existing category fits:** Greene King payments mix tied rent, tied beer purchase, and machine income deductions. They don't belong in any of the operating cost lines (`Heat/Light/Power`, `Premises Repairs`, etc.). Pubco rent is a fundamentally different cost line in pub accounts.

**Note:** `src/lib/pnl/constants.ts` already has a manual P&L row called `rent` in the `occupancy` group, but it's not wired to the receipts category enum. There's also a non-wired `royalty` row.

**Recommended category name:** `Pubco Rent / Tied Lease` (or split into two: `Tied Lease - Rent`, `Tied Lease - Beer Tie`)
**P&L mapping:** New `occupancy` group rows, OR map to the existing manual `rent` / `royalty` rows.

---

## 2. IT / Software Subscriptions — small spend, growing fast

| Vendor | Hits | Spend |
|---|---|---|
| Vercel | 6 (here) + more categorised | £115.89 |
| Apple | 2 here + 28 elsewhere | (mixed devices and subs) |
| OpenAI | 1 here + 30 elsewhere | mostly billed already |
| Cursor, Supabase, Twilio, ClaudeAI, Spotify, Karafun | scattered | mostly being mis-classified as `Marketing/Promotion/Advertising` or `Entertainment` |

**Why no existing category fits:** The closest current values are:
- `Marketing/Promotion/Advertising` — wrong for hosting/dev tools
- `Sky / PRS / Vidimix` — only for broadcast/music licensing
- `Maintenance and Service Plan Charges` — meant for physical plant
- `Entertainment` — wrong for back-office software

Software-as-a-service subscriptions don't fit any of them, so they're currently scattered across three wrong buckets, distorting the marketing line.

**Recommended category name:** `IT / Software Subscriptions`
**Volume forecast:** Will grow — the venue is adding more SaaS tooling (Vercel, Supabase, Cursor, ClaudeAI, etc.) over time.

---

## 3. Food / Wet Stock — **£25k+, 178 transactions**

Wholesale food and bar-supply purchases that today are either uncategorised or being lumped into `Sundries/Consumables`.

| Vendor | Hits | Spend |
|---|---|---|
| Booker | 129 | £19,328.06 |
| Bidfood | 26 | £2,915.60 |
| Brakes | 23 | £3,061.79 |

**Why no existing category fits:** `Sundries/Consumables` is the catch-all. Food costs are usually tracked separately from sundries in pub P&L because they're the input to **food gross margin** — one of the most-watched KPIs. The current `EXPENSE_METRIC_DEFS` array doesn't have a food cost line at all; food cost is currently a *manual* P&L input via `total_food` (GP %), not derived from receipts.

**Recommended category split:**
- `Food Stock` (Brakes, Bidfood, Costco for bulk food)
- `Wet Stock / Bar Supplies` (Booker mixed wet/dry sundries)

**Caveat:** Booker hits include cleaning products, soft drinks, snacks, and food. Without line-level detail, "Booker" → one category will always be an approximation. The accountant may prefer to keep these as Sundries/Consumables and rely on Booker invoice splits for food vs non-food.

---

## 4. Director Loan / Capital Movement — **£185k, 185 transactions**

| Vendor | Hits | Net £ |
|---|---|---|
| Orange Jelly Limited | 165 | –£165,340 (incoming cash deposits) |
| DLA (standing order) | 20 | £19,375 (outgoing) |

**Why no existing category fits:** These aren't expenses at all — they're balance-sheet movements (director loan account in/out, intra-company transfers). They should be **excluded from the P&L**, not assigned an expense category.

**Recommended approach:** Don't add a category. Instead, introduce a `kind` value (already an enum: `standard`, `payroll`, `tax`, `income_settlement`, `utility`, `bank_fee`, `receipt_not_required`) called `capital_movement` so the exporters and reports can route these out of P&L explicitly.

**Smaller change:** Just patch the existing rules to use `kind = 'income_settlement'` (closest existing value) — though semantically it's not income.

---

## 5. Tax (HMRC) — **£55k, 24 transactions**

| Vendor | Hits | Spend |
|---|---|---|
| HMRC VAT | 10 | £44,376.81 |
| HMRC PAYE | 9 | £6,853.68 |
| HMRC MGD | 5 | £4,484.00 |

**Why no existing category fits:** Tax payments are not operating expenses (VAT is a pass-through; PAYE is already in Total Staff via payroll; MGD is a separate tax line). They're correctly excluded from P&L.

The `HMRC PAYE auto-tag` rule already uses `kind = 'tax'`, so the export pipeline can already identify these.

**Recommended approach:** No new category. Either:
- Leave `set_expense_category` null on all three HMRC rules (current state)
- Or change all three to use `kind = 'tax'` (currently only HMRC PAYE does) — would standardise behaviour.

---

## Summary table

| Bucket | New category? | New kind? | Volume impact |
|---|---|---|---|
| Pubco Rent / Tied Lease | **Yes** — `Pubco Rent / Tied Lease` | No | 125 rows, £284k |
| IT / Software Subscriptions | **Yes** — `IT / Software Subscriptions` | No | ~50 rows, growing |
| Food / Wet Stock | **Maybe** — `Food Stock` (split from Sundries) | No | 178 rows, £25k |
| Director Loan / Capital | No new category | **Maybe** — `capital_movement` kind | 185 rows, £185k flow |
| Tax (HMRC) | No new category | Standardise existing `tax` kind | 24 rows, £55k |

## Required follow-up if approved

For each new category added:
1. Append to `receiptExpenseCategorySchema` in `src/lib/validation.ts:164`
2. Add an entry to `EXPENSE_METRIC_DEFS` in `src/lib/pnl/constants.ts:33` (decides whether it appears as a P&L row)
3. Decide Greene King benchmark mapping in `src/lib/pnl/greene-king-benchmark.ts` — does the new category map to one of their cost lines, or is it standalone?
4. Patch the relevant `receipt_rules` rows to set `set_expense_category` to the new value
5. Run the same backfill SQL pattern used on 2026-05-27 to fill historical transactions

For each new `kind` value added:
1. Append to `receiptRuleKindSchema` in `src/lib/validation.ts:192`
2. Update the receipts exporters (`src/lib/receipts/export/`) to handle the new kind appropriately
3. Patch the relevant rules

## Open question for Peter

The single biggest decision is **Greene King**. £284k flowing through with no category line is the largest signal in the dataset. Two paths:
- **Quick fix:** Add `Pubco Rent / Tied Lease` and accept it's a blended figure
- **Proper fix:** Split Greene King receipts at source into rent vs tied beer vs machine — needs invoice-level detail, not bank-statement-level

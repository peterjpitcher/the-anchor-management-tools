---
title: Cashing Up
aliases:
  - Cash Reconciliation
  - Daily Cash Up
  - Financial Reporting
tags:
  - type/reference
  - module/cashing-up
  - status/active
module: cashing-up
route: /cashing-up
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Cashing Up

Daily cash reconciliation and financial reporting for The Anchor. Records opening and closing floats, income by category, and expenses with receipts. Supports weekly summaries, financial trend insights, and bank statement import.

---

## Routes

| Route | Purpose |
|---|---|
| `/cashing-up` | Module entry point |
| `/cashing-up/dashboard` | Overview of recent daily records |
| `/cashing-up/daily` | Create or edit a daily cash-up record |
| `/cashing-up/weekly` | Weekly summary view |
| `/cashing-up/insights` | Financial trends and P&L insights |
| `/cashing-up/import` | Import bank statement data |

---

## Permissions

| Permission | Description |
|---|---|
| `cashing_up.view` | View daily records and summaries |
| `cashing_up.create` | Create a new daily cash-up record |
| `cashing_up.edit` | Edit an existing record (before locking) |
| `cashing_up.lock` | Lock a completed daily record |
| `cashing_up.unlock` | Unlock a previously locked record |

> [!NOTE]
> Outstanding incomplete cash-up records are surfaced as a count badge in the navigation. Visible to any user with `cashing_up.view`.

> [!DANGER]
> Unlocking a previously locked record (`cashing_up.unlock`) is an elevated action. It should only be used to correct errors, and any unlock should be accompanied by an internal note explaining the reason.

---

## Key Features

### Daily Record
Each day's cash-up captures:

| Field | Description |
|---|---|
| Opening float (cash) | Cash in the till at start of day |
| Opening float (card) | Card machine starting balance |
| Closing float (cash) | Cash in the till at end of day |
| Closing float (card) | Card machine closing balance |
| Income by category | Bar, food, events, private hire, etc. |
| Expenses | Individual expense items with receipt attachments |

### Lock / Unlock
Once a daily record is complete and reviewed, it can be locked to prevent further edits.

```
Draft → Reviewed → Locked
                     ↑ unlock (elevated permission)
```

### Weekly Summary
Aggregates all daily records for a given week. Provides:
- Total income by category
- Total expenses
- Net position for the week
- Comparison to prior week

### Insights & Reporting
Financial trend views across configurable date ranges:

- Revenue trends by category
- Expense trends
- P&L overview
- Week-on-week and month-on-month comparisons

> [!TIP]
> Use the Insights view for management reporting and budget planning. The weekly view is for operational review.

### Bank Statement Import
Import CSV exports from the bank to reconcile against recorded income and expenses.

- Parses standard bank CSV formats
- Highlights unmatched transactions for manual review
- Does not auto-reconcile — all matching is confirmed manually

---

## Database Tables

`cashing_up`-prefixed tables hold all daily, weekly, and import records. Refer to the schema for the full table list.

---

## TypeScript Types

| File | Types |
|---|---|
| `src/types/cashing-up.ts` | `DailyCashUp`, `WeeklySummary` |

---

## Code References

| File | Purpose |
|---|---|
| `src/types/cashing-up.ts` | Type definitions |
| `src/services/cashing-up.service.ts` | Business logic service (~30KB) |

---

## Related

- [[Modules MOC]]
- [[Receipts]]
- [[Invoices]]

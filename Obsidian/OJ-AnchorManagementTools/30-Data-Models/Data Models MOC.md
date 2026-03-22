---
title: "Data Models MOC"
aliases:
  - "Data Models"
  - "Types"
  - "Schema"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Data Models — Map of Content

← [[Home]]

## Core Models

| Model | Table(s) | TypeScript File |
|---|---|---|
| [[Event Model]] | `events` | `src/types/event.ts` |
| [[Customer Model]] | `customers` | `src/types/customers.ts` |
| [[Private Booking Model]] | `private_bookings`, `private_booking_items` | `src/types/private-bookings.ts` |
| [[Employee Model]] | `employees` + 6 related tables | `src/types/database.ts` |
| [[Invoice Model]] | `invoices`, `invoice_line_items` | `src/types/invoices.ts` |

---

## Conventions

> [!NOTE] snake_case ↔ camelCase
> Database columns are always `snake_case`. TypeScript types are `camelCase` with `Date` objects.
> Always wrap DB results with `fromDb<T>()` from `src/lib/utils.ts`.

> [!NOTE] Full Types Reference
> The master type file is `src/types/database.ts` (850+ lines). The auto-generated Supabase types are in `src/types/database.generated.ts` — do not edit manually.

---

```dataview
LIST
FROM "OJ-AnchorManagementTools/30-Data-Models"
WHERE type != "moc"
SORT file.name ASC
```

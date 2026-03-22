---
title: Batch 7 - Global Search
aliases:
  - Global Search
  - Batch 7
tags:
  - type/reference
  - status/complete
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 7 — Global Search

**Stream:** [[Stream 2 - Product Experience]]
**Priority:** Medium — the single highest-impact discoverability gap in the platform.

> [!info] User Problem
> To find anything, staff must navigate to the correct module first. A manager receiving a phone call about "the Johnson wedding" currently has to check private bookings, customers, and invoices separately. Global search collapses this into a single keystroke.

## G1 — No cross-entity global search

### Problem

There is no search bar that spans modules. All search is scoped to the page the user is currently on.

### Scope

Search results should cover:

| Entity | Fields to search |
|--------|-----------------|
| Customers | Name, email, phone |
| Private bookings | Booking reference, customer name, event name |
| Table bookings | Booking reference, customer name |
| Events | Event name, date |
| Invoices | Invoice number, customer name |

### UX Specification

- Search bar embedded in the `AppNavigation` header — always accessible from any page
- Results grouped by entity type in a dropdown panel
- Keyboard navigable: arrow keys to move between results, Enter to navigate, Escape to dismiss
- Minimum 3 characters before search fires
- Debounced — no request on every keystroke

### Implementation Options

**Option A — PostgreSQL `websearch_to_tsquery` with `tsvector` columns**

| Aspect | Detail |
|--------|--------|
| Performance | Best — native full-text index, sub-10ms on large tables |
| Complexity | Requires migration to add `tsvector` columns and `GIN` indexes |
| Maintenance | Trigger-maintained `tsvector` columns need to stay in sync with schema changes |

**Option B — Parallel Supabase `.ilike()` queries across entities**

| Aspect | Detail |
|--------|--------|
| Performance | Acceptable at current scale — parallel queries via `Promise.all` |
| Complexity | Simple — no migration required |
| Maintenance | Low — standard query pattern already used throughout the codebase |

> [!tip] Recommendation
> Implement Option B first. It is sufficient for current data volume and can be shipped quickly. Migrate to `tsvector` when search query latency becomes a staff complaint, not before.

### Files to Create or Modify

| File | Action |
|------|--------|
| `src/components/ui-v2/navigation/AppNavigation.tsx` | Add search bar to header |
| `src/app/api/search/route.ts` | New API route — parallel entity queries, returns grouped results |
| `src/components/features/search/GlobalSearch.tsx` | New client component — search input, results dropdown, keyboard navigation |

### Permission Gating

Search results must respect RBAC. A viewer without `private-bookings.view` must not see private booking results. The search API route must check permissions before including each entity type in the result set.

## Related

- [[Stream 2 - Product Experience]]
- [[Batch 4 - UI UX Polish]]
- [[Batch 8 - Customer Experience]]

---
title: Batch 2 - Performance
aliases:
  - Performance Optimisation
  - Batch 2
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 2 — Performance

**Stream:** [[Stream 1 - Platform Stability]]
**Priority:** High — reduce DB round-trips and page load times across all authenticated pages.

> [!info] Target
> P95 page load < 2s across all authenticated pages. Permission check reduced to ≤ 1 DB call per page load.

## Items

### P1 — Per-page permission DB calls

**Impact:** High

| Field | Detail |
|-------|--------|
| Problem | 4–5 separate `checkUserPermission` round-trips per page load. The `get_user_permissions` RPC already exists and is used on the dashboard. |
| Fix | Cache permissions with `unstable_cache` keyed on `userId`, or call `get_user_permissions` once per page and derive all flags from the result. |
| Saving | 3–4 DB round-trips eliminated on every authenticated page load |

---

### P2 — Private bookings list fires 2 extra queries

**Impact:** High

| Field | Detail |
|-------|--------|
| File | `src/services/private-bookings.ts:1900-1930` |
| Problem | After pagination completes, 2 additional queries fire to fetch `hold_expiry` and payment balances — fields that could be in the view. |
| Fix | Add `hold_expiry` and payment balance fields to the `private_bookings_with_details` DB view |

---

### P3 — Customers page is 100% client-side

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/customers/page.tsx` |
| Problem | Entire page is marked `'use client'`, fetches all data from the browser after mount, creating a double loading phase (shell render → data fetch → content render). |
| Fix | Convert to Server Component + Client Component pattern, following the same approach as `invoices/page.tsx` |

> [!tip] Reference Pattern
> See `src/app/(authenticated)/invoices/page.tsx` for the correct SSR + client hydration pattern to follow.

---

### P4 — Employees list fires 7 DB calls

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/services/employees.ts:1060-1078` |
| Problem | 5 separate count queries (one per status) + 1 filtered count + 1 data query = 7 sequential round-trips for a single page load. |
| Fix | Use a single `GROUP BY status` count query to replace the 5 individual counts |

---

### P5 — Balance payment makes 4 sequential queries

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/services/private-bookings.ts:1555-1614` |
| Problem | Recording a balance payment requires 4 sequential DB queries in application code. |
| Fix | Move to a single PostgreSQL RPC function that handles all 4 operations atomically |

---

### P6 — Dashboard aggregations fetch all rows

**Impact:** Medium

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/dashboard/dashboard-data.ts:998` |
| Problem | All non-deleted quotes are fetched to the application layer for client-side summing with no `LIMIT`. As booking volume grows, this becomes a large unbounded fetch. |
| Fix | Push aggregation to SQL via `SUM(CASE WHEN ...)` query — return only the totals |

---

### P7 — Dashboard not invalidated after mutations

**Impact:** Low

| Field | Detail |
|-------|--------|
| Problem | Booking, invoice, and message mutations do not call `revalidateTag('dashboard')`. The dashboard shows stale counts for up to 60 seconds after staff take actions. |
| Fix | Add `revalidateTag('dashboard')` to key server actions: booking create/update, invoice create/update, message send |

## Summary

| ID | Impact | Area | Status |
|----|--------|------|--------|
| P1 | High | Permission caching | Open |
| P2 | High | Private bookings query | Open |
| P3 | Medium | Customers page SSR | Open |
| P4 | Medium | Employees list queries | Open |
| P5 | Medium | Balance payment RPC | Open |
| P6 | Medium | Dashboard aggregation | Open |
| P7 | Low | Dashboard cache invalidation | Open |

## Related

- [[Stream 1 - Platform Stability]]
- [[Batch 1 - Security Fixes]]
- [[Batch 3 - Architecture]]

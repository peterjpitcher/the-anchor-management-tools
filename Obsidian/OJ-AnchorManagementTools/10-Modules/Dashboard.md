---
title: Dashboard
aliases:
  - Home Dashboard
  - Overview Dashboard
tags:
  - type/reference
  - module/dashboard
  - status/active
module: dashboard
route: /dashboard
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Dashboard

The Dashboard is the landing page for all authenticated staff. It provides a real-time summary of pending actions and key metrics across every module, helping staff triage work at a glance.

---

## Route & Access

| Property | Value |
|---|---|
| Route | `/dashboard` |
| Required permission | `dashboard.view` |
| Auth | Required — `(authenticated)` layout group |

---

## What It Shows

The dashboard surfaces outstanding counts and quick-access links across all major modules:

| Section | What is shown |
|---|---|
| [[Table Bookings]] | Pending / unconfirmed table reservations |
| [[Private Bookings]] | Enquiries and tentative bookings awaiting action |
| [[Messages & SMS]] | Unanswered inbound messages |
| [[Receipts]] | Unprocessed / unreviewed receipts |
| [[Invoices]] | Outstanding (unpaid) invoices |
| [[Parking]] | Pending parking notifications or unresolved incidents |
| [[Events]] | Upcoming events within the next 7 days |

Each count drives the badge counter displayed in the navigation sidebar for the corresponding module. A badge of zero hides the counter.

---

## Outstanding Counts API

Outstanding badge counts are fetched from a dedicated endpoint:

```
GET /api/outstanding-counts
```

- Called on every dashboard load and periodically polled in the background
- Returns a flat object of `{ module: count }` pairs
- Used both on the dashboard summary cards and injected into the navigation component via `AppNavigation.tsx`
- The navigation in `src/components/ui-v2/navigation/AppNavigation.tsx` consumes this data to render module-level badges

> [!TIP]
> If a badge count appears stale, the outstanding counts endpoint is the first place to debug. Check the Supabase query in that API route for filter logic issues.

---

## Data Loading

Dashboard data is pre-aggregated using a snapshot loader:

- **Function**: `loadDashboardSnapshot()`
- **Location**: `src/app/(authenticated)/dashboard/`
- This function is called server-side at page render and batches the pending count queries for all modules
- It returns a typed snapshot object consumed by the dashboard page component

> [!NOTE]
> `loadDashboardSnapshot()` is designed to be fast — it runs aggregation queries, not full table scans. Avoid adding full row fetches here; keep it to `COUNT` queries and lightweight joins.

---

## Architecture Notes

- The dashboard page lives inside the `(authenticated)` route group and inherits auth enforcement from `src/app/(authenticated)/layout.tsx`
- There is no separate dashboard-specific layout; the shared `AppNavigation` sidebar handles the outer chrome
- Outstanding counts are shared state — any module that introduces a new "pending" concept should consider whether it needs a badge counter and update the `/api/outstanding-counts` endpoint accordingly

> [!WARNING]
> The middleware at `src/middleware.ts` is currently **disabled** (renamed `.disabled`). Auth for dashboard and all authenticated routes is enforced exclusively in the `(authenticated)/layout.tsx` via `supabase.auth.getUser()`. Do not rely on middleware-level auth for this section.

---

## Related

- [[Modules MOC]] — full list of all modules
- [[Events]] — upcoming events summary
- [[Private Bookings]] — enquiry pipeline
- [[Table Bookings]] — pending reservations
- [[Messages & SMS]] — unanswered messages
- [[Invoices]] — outstanding invoices
- [[Receipts]] — unprocessed receipts
- [[Parking]] — pending parking actions

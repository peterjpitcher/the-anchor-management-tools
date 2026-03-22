---
title: Batch 1 - Security Fixes
aliases:
  - Security Fixes
  - Batch 1
tags:
  - type/reference
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 1 — Security Fixes

**Stream:** [[Stream 1 - Platform Stability]]
**Priority:** IMMEDIATE — these are bugs, not features. Nothing else ships until these are resolved.

> [!danger] Treat as Bugs
> All five items in this batch are security vulnerabilities present in production. They must be triaged and fixed before any new feature development begins.

## Items

### S1 — Dashboard cache key shared across users

**Severity:** CRITICAL

| Field | Detail |
|-------|--------|
| File | `src/app/(authenticated)/dashboard/dashboard-data.ts:1153` |
| Problem | Cache key is static `['dashboard-snapshot']` — all users share one cached snapshot for up to 60 seconds. User A (admin) can see User B (viewer)'s permission-filtered data. |
| Fix | Change cache key array to include userId: `['dashboard-snapshot', userId]` |

> [!danger] S1 is Critical
> This is a data leakage bug. Admin-only data can be served to viewers if an admin loads the dashboard first. Fix immediately.

---

### S2 — Employee sensitive data over-exposed

**Severity:** HIGH

| Field | Detail |
|-------|--------|
| Files | `src/services/employees.ts`, `src/app/actions/employeeDetails.ts` |
| Problem | `getEmployeeByIdWithDetails()` fetches bank account numbers, NI numbers, sort codes, and full health records to any user with `employees.view`. No separate `view_financial` or `view_health` permission check. |
| Fix | Add granular permission checks before fetching financial and health sub-tables |

---

### S3 — Public self-registration possible

**Severity:** HIGH

| Field | Detail |
|-------|--------|
| Files | `src/services/auth.ts`, `src/app/actions/auth.ts` |
| Problem | `signUp()` function is exported and callable as a server action, despite the platform's invite-only policy. Any person with the URL can create an account. |
| Fix | Remove or block the `signUp` server action entirely |

---

### S4 — PayPal webhook handler missing

**Severity:** MEDIUM

| Field | Detail |
|-------|--------|
| Problem | PayPal env vars and types exist. `PAYPAL_WEBHOOK_ID` confirms webhooks are configured in the PayPal dashboard, but no handler exists at `src/app/api/webhooks/paypal/route.ts`. Payment events are silently dropped. |
| Fix | Create PayPal webhook handler with PayPal signature verification |

---

### S5 — Cron auth inconsistency

**Severity:** LOW

| Field | Detail |
|-------|--------|
| Files | `src/app/api/cron/rota-auto-close/route.ts`, `src/app/api/cron/rota-manager-alert/route.ts`, `src/app/api/cron/rota-staff-email/route.ts` |
| Problem | Three cron routes use inline string comparison (`authHeader !== \`Bearer ${cronSecret}\``) instead of the `authorizeCronRequest()` utility already used by `parking-notifications`. |
| Fix | Replace inline comparison with `authorizeCronRequest()` from `src/lib/cron-auth.ts` |

## Summary

| ID | Severity | Area | Status |
|----|----------|------|--------|
| S1 | CRITICAL | Dashboard caching | Open |
| S2 | HIGH | Employee data access | Open |
| S3 | HIGH | Auth / registration | Open |
| S4 | MEDIUM | PayPal webhooks | Open |
| S5 | LOW | Cron authentication | Open |

## Related

- [[Stream 1 - Platform Stability]]
- [[Batch 2 - Performance]]
- [[Batch 3 - Architecture]]

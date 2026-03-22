---
title: "RBAC & Permissions"
aliases:
  - "RBAC"
  - "Permissions"
  - "Roles"
  - "Access Control"
tags:
  - type/reference
  - status/active
module: architecture
created: 2026-03-14
updated: 2026-03-14
---

# RBAC & Permissions

← [[Architecture MOC]]

---

## System Roles

| Role | Access |
|---|---|
| `super_admin` | Full platform access, user and role management |
| `manager` | Operational permissions — events, customers, bookings, employees |
| `staff` | Limited — view own shifts, clock in/out, view customers |
| Custom roles | Defined in the database per venue/organisation |

**Role hierarchy:** `super_admin (3) ≥ manager (2) ≥ staff (1)`

Permission checks use `>=`, not `===` — an admin always passes an editor-level check.

---

## Permission Structure

Every permission is a combination of **module** + **action**.

```typescript
await checkUserPermission('module', 'action', userId)
```

### Modules

```
dashboard, events, performers, customers, employees,
messages, sms_health, settings, reports, users, roles,
private_bookings, table_bookings, invoices, oj_projects,
receipts, loyalty, quotes, parking, short_links,
menu_management, cashing_up, rota, leave, timeclock, payroll
```

### Actions

```
view, create, edit, delete, export, manage, send, convert,
view_documents, upload_documents, delete_documents,
view_templates, manage_templates, manage_roles,
view_pricing, manage_deposits, view_vendor_costs,
manage_spaces, manage_catering, manage_vendors,
generate_contracts, view_sms_queue, approve_sms,
enroll, redeem, refund, submit, approve,
lock, unlock, publish, request, clock
```

---

## Storage

Roles are stored in `user.app_metadata.role` (Supabase JWT). **Never** use `user_metadata` — it is user-modifiable and must never be trusted for authorisation decisions.

Role updates are made only via the Supabase Admin API (service-role client).

---

## Server-Side Helpers

| Helper | Location | Used In |
|---|---|---|
| `requireAuth()` | `src/lib/auth/` | Server Components — redirects if unauthenticated |
| `getCurrentUser()` | `src/lib/auth/` | Server Components — returns user or null |
| `requireAdmin()` | `src/lib/auth/` | Server Components — redirects if not admin |
| `withAuth(handler)` | `src/lib/auth/` | API Route Handlers — 401 if unauthenticated |
| `withAdminAuth(handler)` | `src/lib/auth/` | API Route Handlers — 403 if not admin |
| `withAuthAndCSRF(handler)` | `src/lib/auth/` | Mutation routes — auth + CSRF combined |
| `checkUserPermission()` | `src/services/permission.ts` | Any server action |

---

## Enforcement Rules

> [!WARNING] UI Hiding is Not Enough
> Server actions **must always re-verify permissions server-side**. Never rely on UI buttons being hidden as the only access control.

> [!WARNING] Role Demotion
> When a user's role is demoted, `destroyAllSessionsForUser()` must be called immediately so the demoted user's active sessions do not retain elevated privileges.

---

## Database Tables

| Table | Purpose |
|---|---|
| `roles` | Role definitions |
| `permissions` | All valid module + action combinations |
| `role_permissions` | Maps role → permission |
| `user_roles` | Maps user → role |

---

## Related
- [[Auth & Security]]
- [[Users & Roles]]
- [[Database Schema]]

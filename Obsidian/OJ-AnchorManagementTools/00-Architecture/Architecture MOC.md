---
title: "Architecture MOC"
aliases:
  - "Architecture"
  - "System Design"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Architecture — Map of Content

← [[Home]]

## Notes in This Section

- [[Tech Stack]] — Frameworks, libraries, and tooling choices
- [[Database Schema]] — All PostgreSQL tables, relationships, and RLS policies
- [[Auth & Security]] — Authentication flows, session management, CSRF, middleware
- [[RBAC & Permissions]] — Roles, modules, actions, and permission enforcement
- [[Deployment & Infrastructure]] — Vercel config, cron jobs, environment setup

---

## Design Principles

> [!TIP] Core Principles
> - **Server Components by default** — `'use client'` only for interactivity
> - **Server Actions for mutations** — all writes go through `'use server'` functions
> - **RLS always on** — every table enforces row-level security
> - **Service layer for business logic** — `src/services/` owns domain logic, not components

---

## Route Groups

| Group | Purpose | Auth |
|---|---|---|
| `(authenticated)/` | Staff portal — all management pages | Required |
| `(staff-portal)/portal/` | Employee self-service | Required |
| `(timeclock)/timeclock/` | Public clock-in kiosk | None |
| `(employee-onboarding)/` | New employee flows | Token |
| `auth/` | Login, password reset, confirm | None |
| Public routes | Table booking, event pages, short links | None |

---

```dataview
LIST
FROM "OJ-AnchorManagementTools/00-Architecture"
WHERE type != "moc"
SORT file.name ASC
```

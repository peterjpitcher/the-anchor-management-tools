---
title: "Modules MOC"
aliases:
  - "Modules"
  - "Features"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Application Modules — Map of Content

← [[Home]]

## Primary Modules

| Module | Route | Purpose |
|---|---|---|
| [[Dashboard]] | `/dashboard` | Metrics overview and pending-action counts |
| [[Events]] | `/events` | Public event scheduling and promotion |
| [[Customers]] | `/customers` | CRM and customer records |
| [[Private Bookings]] | `/private-bookings` | Full-service event packages |
| [[Table Bookings]] | `/table-bookings` | Table reservations for public events |
| [[Employees]] | `/employees` | Employee lifecycle management |
| [[Rota]] | `/rota` | Shift scheduling, timeclock, payroll |
| [[Messages & SMS]] | `/messages` | Two-way SMS with customers |
| [[Parking]] | `/parking` | Guest parking allocation |
| [[Menu Management]] | `/menu-management` | Event menu configuration |

## Finance Modules

| Module | Route | Purpose |
|---|---|---|
| [[Invoices]] | `/invoices` | Invoice creation and payment tracking |
| [[Quotes]] | `/quotes` | Quote templates and conversion |
| [[Cashing Up]] | `/cashing-up` | Daily cash reconciliation |
| [[Receipts]] | `/receipts` | AI-powered bank transaction classification |
| [[OJ Projects]] | `/oj-projects` | Internal time-tracking |

## Support Modules

| Module | Route | Purpose |
|---|---|---|
| [[Short Links]] | `/short-links` | URL shortener for SMS campaigns |
| [[Performers]] | `/performers` | Performer/entertainment management |
| [[Settings]] | `/settings` | System-wide configuration |
| [[Users & Roles]] | `/users`, `/roles` | RBAC and user management |

---

## Navigation Badge Counters

The nav bar shows pending-action counts for these modules:

```dataview
TABLE route, module
FROM "OJ-AnchorManagementTools/10-Modules"
WHERE type != "moc"
SORT file.name ASC
```

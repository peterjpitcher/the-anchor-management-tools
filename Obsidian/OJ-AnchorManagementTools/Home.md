---
title: "Anchor Management Tools — Home"
aliases:
  - "Home"
  - "Index"
  - "Root"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Anchor Management Tools

> [!INFO] About This Vault
> This vault documents the **OJ-AnchorManagementTools** application — a full-stack venue management system for The Anchor pub. Built with Next.js 15, Supabase, and TypeScript. Deployed on Vercel.

## Sections

| Section | Description |
|---|---|
| [[Architecture MOC]] | Tech stack, database, auth, deployment |
| [[Modules MOC]] | All 19 application modules |
| [[Integrations MOC]] | Twilio, Microsoft Graph, OpenAI, Stripe, PayPal |
| [[Data Models MOC]] | Key TypeScript types and database tables |
| [[Operations MOC]] | Cron jobs, webhooks, environment variables |
| [[Business Rules MOC]] | Domain policies, deposits, SMS, employee lifecycle |

---

## Quick Reference

### Core Business Modules
- [[Events]] — Public event scheduling and promotion
- [[Private Bookings]] — Full-service event packages (spaces, catering, vendors)
- [[Table Bookings]] — Table reservations for public events
- [[Customers]] — CRM and customer records
- [[Employees]] — Employee lifecycle management
- [[Rota]] — Shift scheduling and payroll

### Finance
- [[Invoices]] — Invoice creation and payment tracking
- [[Cashing Up]] — Daily cash reconciliation
- [[Receipts]] — Bank transaction classification with AI

### Communications
- [[Messages & SMS]] — Two-way SMS via Twilio
- [[Parking]] — Guest parking allocation

### Configuration
- [[Settings]] — System-wide configuration hub
- [[Users & Roles]] — RBAC and user management

---

## Tech Stack at a Glance

- **Framework:** Next.js 15 App Router + React 19
- **Database:** Supabase (PostgreSQL + Auth + RLS)
- **Styling:** Tailwind CSS v4
- **Hosting:** Vercel
- **Language:** TypeScript (strict)

→ See [[Tech Stack]] for full detail.

---

## All Notes

```dataview
TABLE tags, module
FROM "OJ-AnchorManagementTools"
WHERE type != "moc"
SORT file.name ASC
```

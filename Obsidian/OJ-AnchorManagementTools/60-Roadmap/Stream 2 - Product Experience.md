---
title: Stream 2 - Product Experience
aliases:
  - Product Experience Stream
  - Stream 2
tags:
  - type/reference
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Stream 2 — Product Experience

This stream improves the day-to-day usability of the platform for staff and introduces self-service capability for customers. It runs in parallel with [[Stream 3 - Business Automation]] after [[Stream 1 - Platform Stability]] has resolved critical security issues.

## Team

| Role | Responsibility |
|------|---------------|
| Product Designer | UX patterns, accessibility audit, component specifications |
| Frontend Engineer (Design Systems) | ui-v2 component completion, consistency enforcement |
| Full Stack Engineer (Next.js) | SSR conversion, global search, customer portal |

## Timeline

**Months 2–4**

## Batches

| Batch | Focus | Priority |
|-------|-------|----------|
| [[Batch 4 - UI UX Polish]] | Accessibility, consistency, error handling | Medium-High |
| [[Batch 7 - Global Search]] | Cross-entity search in AppNavigation | Medium |
| [[Batch 8 - Customer Experience]] | Self-service payments, portal, contracts | Lower (Phase 3) |

## Key Deliverables

- [ ] All `window.confirm` calls replaced with accessible `ConfirmDialog` components
- [ ] Mobile filter bar restored on private bookings list
- [ ] Customers page converted from full client-side to SSR + Client Component pattern
- [ ] Global search live across customers, bookings, events, and invoices
- [ ] Customer self-service deposit payment flow end-to-end

## Outcome

A usable product with consistent UI language, no accessibility regressions, and self-service capability that reduces inbound staff queries about booking status and payments.

> [!tip] Sequencing
> [[Batch 4 - UI UX Polish]] should begin immediately once [[Batch 1 - Security Fixes]] is closed. [[Batch 7 - Global Search]] and [[Batch 8 - Customer Experience]] can follow sequentially or in parallel depending on team capacity.

## Related

- [[Batch 4 - UI UX Polish]]
- [[Batch 7 - Global Search]]
- [[Batch 8 - Customer Experience]]
- [[Stream 1 - Platform Stability]]
- [[Stream 3 - Business Automation]]
- [[Team Structure]]

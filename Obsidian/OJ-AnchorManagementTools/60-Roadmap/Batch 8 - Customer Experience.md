---
title: Batch 8 - Customer Experience
aliases:
  - Customer Experience
  - Batch 8
tags:
  - type/reference
  - status/planned
created: 2026-03-14
updated: 2026-03-14
---

← [[Roadmap MOC]]

# Batch 8 — Customer Experience

**Stream:** [[Stream 2 - Product Experience]]
**Priority:** Lower — Phase 3 work. Platform stability and internal UX must be solid before exposing customer-facing surfaces.

> [!warning] Phase 3 Only
> Do not begin this batch until [[Batch 1 - Security Fixes]], [[Batch 2 - Performance]], and [[Batch 4 - UI UX Polish]] are complete. Customer-facing surfaces have higher reliability and security requirements than internal staff tools.

## Items

### E1 — No online deposit payment link

**Impact:** High

| Field | Detail |
|-------|--------|
| Problem | Deposits are recorded manually by staff. Stripe and PayPal are integrated at the backend but no customer-facing payment link flow exists from the private booking detail screen. |
| Fix | "Send deposit payment link" action on private booking detail → generates a Stripe checkout session → customer pays → webhook updates booking status |
| Dependencies | Stripe webhook handler already exists; PayPal handler needed (see [[Batch 1 - Security Fixes]] item S4) |

> [!tip] Prerequisite
> S4 in [[Batch 1 - Security Fixes]] (PayPal webhook handler) must be completed before E1 can support PayPal payments. Stripe-only deposit links can ship independently.

---

### E2 — No e-signature for contracts

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | Contracts are generated as PDFs but require an in-person signature or a scanned copy returned by email. There is no digital sign-off flow. |
| Fix | Integrate a signing workflow: either embed signature capture in a customer-facing portal page, or integrate a third-party service (e.g. DocuSign or HelloSign) |

---

### E3 — No customer booking status portal

**Impact:** Medium

| Field | Detail |
|-------|--------|
| Problem | Customers have no URL to check their booking status, outstanding balance, or event details. Staff receive inbound calls and emails asking for information that could be self-served. The `g/[code]` route exists as a redirect handler but not as a portal. |
| Fix | Build `src/app/g/[code]/booking-portal/page.tsx` — a customer-facing, read-only booking view accessible via the short-link code |
| Auth | No staff auth — access controlled by knowledge of the booking code only |

---

### E4 — No calendar invite on confirmation

**Impact:** Low

| Field | Detail |
|-------|--------|
| Problem | No `.ics` calendar invite is sent when a booking is confirmed. Customers making bookings months in advance have no automatic reminder in their calendar. |
| Fix | Generate and attach an `.ics` file to the confirmation email sent via Microsoft Graph |

## Summary

| ID | Impact | Area | Status |
|----|--------|------|--------|
| E1 | High | Online deposit payment | ✅ Complete |
| E2 | Medium | E-signature for contracts | Open |
| E3 | Medium | Customer booking portal | ✅ Complete |
| E4 | Low | Calendar invite on confirmation | ✅ Complete |

## Related

- [[Stream 2 - Product Experience]]
- [[Batch 4 - UI UX Polish]]
- [[Batch 7 - Global Search]]
- [[Batch 1 - Security Fixes]]

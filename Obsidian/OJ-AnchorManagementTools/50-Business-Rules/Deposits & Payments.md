---
title: Deposits & Payments
aliases:
  - deposit policy
  - payment methods
  - payments
tags:
  - type/reference
  - section/business-rules
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Business Rules MOC]]

# Deposits & Payments

This note defines the deposit policy and accepted payment methods for The Anchor's booking and invoicing systems.

## Deposit Policy

A deposit is required for larger bookings to secure the reservation.

- **Threshold**: Groups of **7 or more** guests
- **Amount**: **£10 per person**
- **Type**: **Cash deposit** — collected in-person at the venue
- **Refund**: Refundable at venue discretion

This policy applies to both [[Table Bookings]] and [[Private Bookings]].

### Exemptions

Events **hosted by the venue itself** (e.g. staff events, venue-organised functions) are **exempt** from the deposit requirement.

> [!DANGER] Legacy "Credit Card Hold" Language
> A previous version of the system used credit card holds for deposits. This functionality has been **removed and replaced** with cash deposits. Any reference to "credit card hold" anywhere in the codebase, UI text, email templates, or documentation is a **bug** and must be corrected immediately.

> [!NOTE] Deposit is Not Processed via Payment Gateway
> The deposit is a cash transaction recorded manually on the booking. It does not flow through [[Stripe]] or [[PayPal]]. The `deposit_paid` boolean on the booking record is set manually by staff when the cash is received.

## Payment Methods

The following payment methods are available across the system:

| Method | Used In | Processed Via |
|---|---|---|
| Cash | Table Bookings, Private Bookings, Cashing Up | Manual recording — no gateway |
| Card (Stripe) | Invoices, Private Bookings | [[Stripe]] |
| PayPal | Invoices | [[PayPal]] |
| Invoice terms | Invoices | Manual recording — net terms agreed with client |

## Invoice Payment Status Lifecycle

```
draft → sent → partial → paid
                      ↘ overdue → cancelled
```

| Status | Meaning |
|---|---|
| `draft` | Invoice being prepared; not sent to customer |
| `sent` | Invoice emailed to customer |
| `partial` | Partial payment received |
| `paid` | Invoice fully settled |
| `overdue` | Past due date; unpaid or partially paid |
| `cancelled` | Invoice will not be collected |

## Relevant Data Fields

- `private_bookings.deposit_amount` — computed as `£10 × guest_count` when `guest_count ≥ 7`
- `private_bookings.deposit_paid` — boolean set manually when cash is received
- `invoices.status` — tracks invoice payment lifecycle
- `invoices.payment_method` — records how the invoice was settled

## Related

- [[Business Rules MOC]]
- [[Private Bookings]]
- [[Table Bookings]]
- [[Invoices]]
- [[Private Booking Model]]
- [[Invoice Model]]
- [[Stripe]]
- [[PayPal]]

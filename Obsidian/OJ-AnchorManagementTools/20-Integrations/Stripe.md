---
title: Stripe
aliases:
  - Stripe Payments
  - Card Payments
tags:
  - type/reference
  - integration/stripe
  - status/active
integration: stripe
created: 2026-03-14
updated: 2026-03-14
---

← [[Integrations MOC]]

## Overview

Stripe provides card and digital wallet payment processing for invoices. It is one of two payment processors available (see also [[PayPal]]). When an invoice is marked for card payment, Stripe handles the transaction and notifies the system via webhook once payment is confirmed.

## Environment Variables

| Variable | Purpose |
|---|---|
| `STRIPE_SECRET_KEY` | Server-side API key — never exposed to the client |
| `STRIPE_WEBHOOK_SECRET` | Signature secret used to verify incoming webhook payloads |

> [!DANGER] Keep STRIPE_SECRET_KEY server-side only
> This key must never appear in client components, `NEXT_PUBLIC_` variables, or browser-accessible API responses. All Stripe calls happen exclusively in server actions and API route handlers.

## Library Files

| File | Purpose |
|---|---|
| `src/lib/payments/stripe.ts` | Stripe API client, payment link creation, and webhook verification |

## Webhook

`POST /api/webhooks/stripe` receives payment event callbacks from Stripe.

| Event | Action taken |
|---|---|
| `payment_intent.succeeded` | Invoice payment status updated to `paid` |
| `payment_intent.payment_failed` | Invoice payment status updated to `failed`; staff notified |
| `charge.refunded` | Invoice payment status updated to `refunded` |

All webhook payloads are verified against `STRIPE_WEBHOOK_SECRET` using Stripe's signature verification before processing. Unverified payloads are rejected with `400`.

> [!WARNING] Webhook signature verification is mandatory
> Never process a Stripe webhook payload without first verifying the `Stripe-Signature` header. Skipping this allows anyone to spoof payment events.

## Used By

| Module | Purpose |
|---|---|
| [[Invoices]] | Card payment processing for customer invoices |
| [[Private Bookings]] | Payment recording against booking deposits and balances |

## Payment Flow

```
Invoice marked as "pay by card"
  → Stripe payment link or checkout session created
  → Link sent to customer (via email or manual share)
  → Customer completes payment on Stripe-hosted page
  → Stripe fires webhook to POST /api/webhooks/stripe
  → Invoice payment status updated to "paid"
  → Customer record updated
```

> [!NOTE] Payment recording vs processing
> Stripe is used both to process live card payments and to record payments that have already been taken through Stripe terminals or links. The invoice module supports both flows — online payment links and manual "mark as paid via Stripe" recording.

## Deposits & Partial Payments

When used with [[Private Bookings]], Stripe can record:
- Deposit payments (partial amount)
- Balance payments (remaining amount after deposit)

Both are tracked against the booking and reflected in the invoice status. See [[Deposits & Payments]] for the full payment lifecycle.

## Related

- [[Invoices]]
- [[Private Bookings]]
- [[Deposits & Payments]]
- [[Webhooks]]
- [[PayPal]]
- [[Integrations MOC]]

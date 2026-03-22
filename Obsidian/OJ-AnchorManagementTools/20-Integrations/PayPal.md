---
title: PayPal
aliases:
  - PayPal Payments
  - PayPal Integration
tags:
  - type/reference
  - integration/paypal
  - status/active
integration: paypal
created: 2026-03-14
updated: 2026-03-14
---

← [[Integrations MOC]]

## Overview

PayPal provides an alternative payment processing option for invoices alongside [[Stripe]]. When a customer prefers to pay via PayPal, the system creates a PayPal order and receives payment confirmation via webhook. The flow mirrors the [[Stripe]] integration.

## Environment Variables

| Variable | Purpose |
|---|---|
| `PAYPAL_CLIENT_ID` | PayPal application client ID |
| `PAYPAL_CLIENT_SECRET` | PayPal application secret — server-side only |
| `PAYPAL_WEBHOOK_ID` | Identifies the registered webhook for signature verification |
| `PAYPAL_ENVIRONMENT` | Controls sandbox vs live mode (`sandbox` or `live`) |

> [!WARNING] PAYPAL_ENVIRONMENT must be set correctly per environment
> Using `sandbox` in production silently accepts test payments without moving real money. Verify this variable is set to `live` on the Vercel production deployment.

> [!DANGER] Keep PAYPAL_CLIENT_SECRET server-side only
> Like `STRIPE_SECRET_KEY`, this must never appear in client components or `NEXT_PUBLIC_` variables.

## Library Files

| File | Purpose |
|---|---|
| `src/lib/paypal.ts` | PayPal API client, order creation, and webhook verification |

## Webhook

`POST /api/webhooks/paypal` receives payment notifications from PayPal.

| Event | Action taken |
|---|---|
| `PAYMENT.CAPTURE.COMPLETED` | Invoice payment status updated to `paid` |
| `PAYMENT.CAPTURE.DENIED` | Invoice payment status updated to `failed` |
| `PAYMENT.CAPTURE.REFUNDED` | Invoice payment status updated to `refunded` |

All webhook payloads are verified against `PAYPAL_WEBHOOK_ID` using PayPal's signature verification before processing.

> [!WARNING] Webhook verification is mandatory
> Always verify the PayPal webhook signature before acting on the payload. PayPal provides a verification API endpoint — use it. Do not trust unverified events.

## Used By

| Module | Purpose |
|---|---|
| [[Invoices]] | PayPal payment processing for customer invoices |

## Payment Flow

```
Invoice marked as "pay by PayPal"
  → PayPal order created via API
  → Payment link sent to customer
  → Customer completes payment on PayPal-hosted page
  → PayPal fires webhook to POST /api/webhooks/paypal
  → Invoice payment status updated to "paid"
```

This flow mirrors [[Stripe]] — the two integrations are parallel payment options for the same invoice payment workflow. The choice of processor is made per invoice, not per customer.

## Sandbox vs Live Mode

The `PAYPAL_ENVIRONMENT` variable switches between PayPal's sandbox (test) and live environments. In sandbox mode:
- No real money is moved
- Test PayPal accounts must be used
- Webhook events come from PayPal's sandbox webhook infrastructure

> [!TIP] Local development
> Set `PAYPAL_ENVIRONMENT=sandbox` in `.env.local` for development and testing. The sandbox environment is functionally identical to live for integration testing purposes.

## Related

- [[Invoices]]
- [[Deposits & Payments]]
- [[Webhooks]]
- [[Stripe]]
- [[Integrations MOC]]

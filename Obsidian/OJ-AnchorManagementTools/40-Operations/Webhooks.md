---
title: Webhooks
aliases:
  - inbound webhooks
  - webhook endpoints
tags:
  - type/reference
  - section/operations
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

← [[Operations MOC]]

# Webhooks

Webhooks are inbound HTTP callbacks from external services that notify the application of asynchronous events — payment completions, SMS delivery receipts, and similar. Each webhook endpoint validates the inbound request signature before processing.

## Webhook Endpoints

| Route | Service | Events Handled |
|---|---|---|
| `/api/webhooks/twilio` | [[Twilio]] | SMS delivery status (delivered, failed, undelivered), inbound messages |
| `/api/webhooks/stripe` | [[Stripe]] | Payment succeeded, payment failed, refund created |
| `/api/webhooks/paypal` | [[PayPal]] | Payment completed, payment reversed |

## Security

> [!WARNING] Always Validate Signatures
> Every webhook endpoint MUST validate the inbound request signature before processing the payload. Processing without validation exposes the application to replay attacks and spoofed events.

### Twilio

- Validates the `X-Twilio-Signature` header
- Uses `TWILIO_AUTH_TOKEN` to compute the expected HMAC-SHA1 signature
- Rejects requests with a missing or invalid signature

### Stripe

- Validates using `stripe.webhooks.constructEvent()`
- Uses `STRIPE_WEBHOOK_SECRET` (the webhook signing secret, not the API key)
- Each webhook endpoint has its own signing secret in Stripe's dashboard

### PayPal

- Validates using the PayPal API signature verification endpoint
- Uses `PAYPAL_WEBHOOK_ID` to identify the correct webhook for validation
- PayPal signatures are verified against PayPal's public certificate

## CSRF Exemption

Webhook endpoints are exempt from CSRF token validation. They use service-specific signature verification instead, which provides equivalent or stronger protection.

> [!NOTE] CSRF vs Signature Verification
> CSRF protection guards against requests originating from malicious third-party pages in a user's browser session. Webhooks are server-to-server calls with no browser session — signature verification is the appropriate security mechanism here.

## Event Handling

### Twilio Events

- **delivered**: SMS was successfully delivered; no action needed
- **failed / undelivered**: Increments `customers.delivery_failure_count` for the recipient; triggers alerting if threshold exceeded
- **inbound messages**: Handles customer replies, including opt-out keywords (STOP, UNSUBSCRIBE)

### Stripe Events

- **payment_intent.succeeded**: Marks the associated invoice or booking deposit as paid
- **payment_intent.payment_failed**: Records failure; notifies staff if relevant
- **charge.refunded**: Updates payment records to reflect refund status

### PayPal Events

- **PAYMENT.CAPTURE.COMPLETED**: Marks the associated invoice as paid
- **PAYMENT.CAPTURE.REVERSED**: Records reversal; flags for manual review

## Related

- [[Operations MOC]]
- [[Twilio]]
- [[Stripe]]
- [[PayPal]]
- [[Messages & SMS]]
- [[Invoices]]
- [[Environment Variables]]

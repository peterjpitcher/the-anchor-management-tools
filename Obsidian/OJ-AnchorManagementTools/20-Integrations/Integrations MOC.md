---
title: "Integrations MOC"
aliases:
  - "Integrations"
  - "External Services"
tags:
  - type/moc
  - status/active
created: 2026-03-14
updated: 2026-03-14
---

# Integrations — Map of Content

← [[Home]]

## External Services

| Integration | Purpose | Used By |
|---|---|---|
| [[Twilio]] | Outbound + inbound SMS | [[Messages & SMS]], [[Private Bookings]], [[Table Bookings]], [[Parking]] |
| [[Microsoft Graph]] | Email via Microsoft 365 | [[Invoices]], [[Rota]], auth flows |
| [[OpenAI]] | AI receipt classification | [[Receipts]] |
| [[Stripe]] | Card payment processing | [[Invoices]] |
| [[PayPal]] | PayPal payment processing | [[Invoices]] |

---

## Integration Pattern

All external service calls follow the same pattern:

1. **Wrapper library** in `src/lib/<service>/` — handles auth, retries, rate limits
2. **Service layer** in `src/services/` — calls the wrapper, applies business logic
3. **Server action** — calls the service, returns `{ success, error }` to the UI
4. **Webhook** (where applicable) — `/api/webhooks/<service>` receives callbacks

```dataview
LIST
FROM "OJ-AnchorManagementTools/20-Integrations"
WHERE type != "moc"
SORT file.name ASC
```

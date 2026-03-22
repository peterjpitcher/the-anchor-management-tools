---
title: Invoices
aliases:
  - Invoice Management
  - Billing
tags:
  - type/reference
  - module/invoices
  - status/active
module: invoices
route: /invoices
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Invoices

Invoice creation, payment tracking, and chasing. Supports multiple payment methods (cash, card via [[Stripe]], [[PayPal]]), PDF generation, direct email delivery to customers, and recurring invoice schedules.

---

## Route

| Route | Purpose |
|---|---|
| `/invoices` | Invoice list, creation, and management |

---

## Permissions

| Permission | Description |
|---|---|
| `invoices.view` | View invoices and payment status |
| `invoices.create` | Create new invoices |
| `invoices.edit` | Edit existing invoices |
| `invoices.delete` | Delete invoices |

> [!NOTE]
> Outstanding unpaid invoices are surfaced as a count badge in the navigation. This badge is visible to any user with `invoices.view`.

---

## Payment Methods

| Method | Provider | Notes |
|---|---|---|
| Cash | — | Manual confirmation by staff |
| Card | [[Stripe]] | Online card payment |
| PayPal | [[PayPal]] | PayPal checkout |
| Invoice terms | — | Payment by bank transfer on agreed terms |

---

## Payment Status Lifecycle

```
Unpaid → Partial → Paid
              ↘
            Overdue
```

| Status | Description |
|---|---|
| `unpaid` | Invoice issued, no payment received |
| `partial` | Partial payment received |
| `paid` | Fully settled |
| `overdue` | Past payment terms, still unpaid or partial |

> [!WARNING]
> Overdue invoices should be chased promptly. The system marks an invoice overdue automatically based on payment terms, but does not send automated chaser emails — this is a manual action.

---

## Key Features

### Line Items
Each invoice contains one or more line items:

| Field | Description |
|---|---|
| Description | What is being charged for |
| Quantity | Number of units |
| Unit price | Price per unit (ex VAT) |
| VAT | VAT rate applied |

Total, VAT amount, and grand total are calculated from line items.

### PDF Generation
Invoices are rendered to PDF via Puppeteer. The PDF includes:
- Company details and logo
- Customer details
- Line items with VAT breakdown
- Payment terms
- Total due

### Email Delivery
Invoices can be emailed directly to customers as PDF attachments. Emails are sent via [[Microsoft Graph]].

### Recurring Invoices
Invoices can be scheduled to recur on a defined frequency (e.g. monthly retainers). Each recurrence generates a new invoice record.

### Invoice Templates
Configurable defaults for:
- Company name, address, VAT number
- Payment terms (e.g. 30 days)
- Footer text

### Convert from Quote
Quotes can be converted directly into invoices. See [[Quotes]] for the quote lifecycle.

---

## Database Tables

| Table | Purpose |
|---|---|
| `invoices` | Invoice header: customer, dates, status, totals |
| `invoice_line_items` | Individual line items for each invoice |

---

## TypeScript Types

| File | Types |
|---|---|
| `src/types/invoices.ts` | `Invoice`, `InvoiceLine`, `PaymentStatus` |

---

## Code References

| File | Purpose |
|---|---|
| `src/types/invoices.ts` | Type definitions |
| `src/services/invoices.ts` | Invoice business logic service |

---

## Integrations

| Integration | Purpose |
|---|---|
| [[Microsoft Graph]] | Email invoices to customers with PDF attachment |
| [[Stripe]] | Card payment processing |
| [[PayPal]] | PayPal payment processing |
| [[Quotes]] | Source for invoice conversion |

---

## Related

- [[Modules MOC]]
- [[Invoice Model]]
- [[Deposits & Payments]]
- [[Quotes]]
- [[Microsoft Graph]]
- [[Stripe]]
- [[PayPal]]

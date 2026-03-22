---
title: Invoice Model
aliases:
  - invoices table
  - Invoice
tags:
  - type/reference
  - section/data-models
  - status/active
created: 2026-03-14
updated: 2026-03-14
table: invoices
typescript: src/types/invoices.ts
---

← [[Data Models MOC]]

# Invoice Model

The `invoices` and `invoice_line_items` tables manage all formal billing for The Anchor — typically used for private hire, vendor accounts, and trade clients. Invoices support multiple payment methods including Stripe card payments and PayPal.

## Primary Table: `invoices`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `customer_id` | uuid | FK → customers |
| `invoice_number` | text | Unique; human-readable reference (e.g. `INV-00123`) |
| `status` | text | `draft` \| `sent` \| `partial` \| `paid` \| `overdue` \| `cancelled` |
| `payment_method` | text | `cash` \| `card` \| `paypal` \| `invoice_terms` |
| `due_date` | date | Payment due date |
| `issued_date` | date | Date the invoice was issued to the customer |
| `subtotal` | numeric | Pre-VAT total |
| `vat_amount` | numeric | Total VAT |
| `total` | numeric | Grand total (subtotal + VAT) |
| `notes` | text | Notes printed on the invoice |
| `email_sent_at` | timestamptz | Timestamp when the invoice email was sent |
| `created_at` | timestamptz | Auto-set on insert |
| `updated_at` | timestamptz | Auto-updated on change |

## Related Table: `invoice_line_items`

Each invoice is composed of one or more line items.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `invoice_id` | uuid | FK → invoices |
| `description` | text | Line item description |
| `quantity` | numeric | Number of units |
| `unit_price` | numeric | Price per unit (ex-VAT) |
| `vat_rate` | numeric | VAT rate as a percentage (e.g. `20` for 20%) |
| `line_total` | numeric | `quantity × unit_price` |

## Status Lifecycle

```
draft → sent → partial → paid
                       ↘ overdue → cancelled
```

- **draft**: Being prepared; not visible to customer
- **sent**: Emailed to customer via [[Microsoft Graph]]
- **partial**: Partial payment received
- **paid**: Fully settled
- **overdue**: Past due date, unpaid or partially paid
- **cancelled**: Invoice will not be collected

## Payment Methods

| Method | Processed Via |
|---|---|
| `cash` | Manual recording only |
| `card` | [[Stripe]] |
| `paypal` | [[PayPal]] |
| `invoice_terms` | Manual recording (net terms agreed) |

## Key TypeScript Types

- `Invoice` — maps to the `invoices` table
- `InvoiceLine` — maps to `invoice_line_items`
- `PaymentStatus` — union of status values

> [!TIP] Quotes vs Invoices
> The [[Quotes]] module uses the same underlying structure as invoices but with quote-specific statuses. A quote can be converted to an invoice once accepted.

## Used By

- [[Invoices]] — full invoice management: create, edit, send, record payments
- [[Quotes]] — quote flow that converts to invoices on acceptance

## Related

- [[Data Models MOC]]
- [[Customer Model]]
- [[Private Booking Model]]
- [[Invoices]]
- [[Quotes]]
- [[Stripe]]
- [[PayPal]]
- [[Deposits & Payments]]

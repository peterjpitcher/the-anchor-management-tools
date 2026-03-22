---
title: Quotes
aliases:
  - Quote Proposals
  - Sales Quotes
tags:
  - type/reference
  - module/quotes
  - status/active
module: quotes
route: /quotes
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Quotes

The Quotes module provides quote proposal creation, delivery, and conversion to invoices. It supports the sales process for private events and group bookings by allowing staff to issue formal quotes to prospects before a booking is confirmed.

---

## Permissions

| Permission | Description |
|---|---|
| `quotes.view` | View all quotes |
| `quotes.create` | Create new quotes |
| `quotes.edit` | Edit draft and pending quotes |
| `quotes.delete` | Delete quotes |
| `quotes.convert` | Convert an accepted quote into an invoice |

---

## Key Features

### Quote Construction

Each quote is built from line items:

| Field | Description |
|---|---|
| Description | What the line item covers |
| Quantity | Number of units |
| Unit price | Price per unit |
| Line total | Calculated automatically |

Quotes carry a header with the prospect's name and contact details, a reference number, and an expiry date.

### Email Delivery

Quotes are emailed directly to prospects via [[Microsoft Graph]]. The email includes the quote as a PDF attachment.

### PDF Generation

PDF versions of quotes are generated server-side using Puppeteer. The PDF is both attached to the outbound email and available for download from the quote detail view.

### Quote-to-Invoice Conversion

When a prospect accepts a quote, staff can convert it directly to an invoice using the `quotes.convert` permission. The conversion copies all line items across, preserving the original quote as a record.

> [!TIP]
> Converted quotes are linked to their resulting invoice. The invoice view displays a "Created from quote #XXXX" reference for traceability.

---

## Business Rules

> [!NOTE]
> Only users with `quotes.convert` permission can trigger the conversion workflow. This is typically restricted to managers to prevent premature invoicing.

> [!WARNING]
> Once a quote is converted to an invoice, it cannot be converted again. The original quote record is retained in read-only state.

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/services/` | Quotes service — quote CRUD and conversion logic |

---

## Integrations

- [[Microsoft Graph]] — email delivery of quote PDFs
- [[Invoices]] — target of quote conversion

---

## Related

- [[Modules MOC]]
- [[Invoices]]
- [[Microsoft Graph]]
- [[Private Bookings]]

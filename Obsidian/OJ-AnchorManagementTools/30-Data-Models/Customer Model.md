---
title: Customer Model
aliases:
  - customers table
  - Customer
tags:
  - type/reference
  - section/data-models
  - status/active
created: 2026-03-14
updated: 2026-03-14
table: customers
typescript: src/types/customers.ts
---

← [[Data Models MOC]]

# Customer Model

The `customers` table is the central record for all guests and clients of The Anchor. It is referenced by bookings, invoices, SMS communications, and event-related modules.

## Table: `customers`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `first_name` | text | Customer first name |
| `last_name` | text | Customer last name |
| `email` | text | Contact email address |
| `phone` | text | E.164 format — e.g. `+441234567890` |
| `sms_opt_in` | bool | Must be `true` before any SMS can be sent |
| `sms_opt_out_date` | timestamptz | Timestamp when the customer opted out of SMS |
| `delivery_failure_count` | int | Incremented on each failed SMS delivery |
| `labels` | text[] | Array of custom tags for filtering/segmentation |
| `notes` | text | Internal staff notes |
| `created_at` | timestamptz | Auto-set on insert |
| `updated_at` | timestamptz | Auto-updated on change |

## Phone Number Format

All phone numbers are stored as **E.164 format** (e.g. `+441234567890`) using `libphonenumber-js` normalisation. This is enforced at the point of entry — raw numbers entered by staff are normalised before saving.

> [!WARNING] Phone Normalisation
> Never store a phone number without passing it through `libphonenumber-js`. Inconsistent formats break SMS delivery and duplicate detection.

## SMS Rules

Two conditions must both be true before an SMS can be sent to a customer:

1. `sms_opt_in = true`
2. `delivery_failure_count` is below the configured threshold

See [[SMS Policy]] for full detail on rate limiting, quiet hours, and opt-out handling.

> [!NOTE] Opt-In is Mandatory
> The SMS library enforces opt-in server-side. Hiding the send button in the UI is not sufficient — the library will reject the request.

## Duplicate Merging

The `CustomerService.mergeCustomers()` method supports merging duplicate customer records. The merge:
- Reassigns all related bookings, invoices, and SMS history to the surviving record
- Preserves the surviving record's opt-in state
- Deletes the duplicate record after transfer

## Used By

- [[Customers]] — primary management UI for viewing, editing, and searching customers
- [[Messages & SMS]] — SMS broadcast and individual messaging
- [[Table Bookings]] — customer linked to each table booking
- [[Private Bookings]] — customer linked to each private booking
- [[Invoices]] — invoices reference a customer

## Related

- [[Data Models MOC]]
- [[Event Model]]
- [[Private Booking Model]]
- [[Invoice Model]]
- [[Customers]]
- [[Messages & SMS]]
- [[SMS Policy]]
- [[Table Bookings]]
- [[Private Bookings]]

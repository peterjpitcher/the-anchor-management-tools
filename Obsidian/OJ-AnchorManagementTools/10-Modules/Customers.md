---
title: Customers
aliases:
  - CRM
  - Customer Records
  - Customer Management
tags:
  - type/reference
  - module/customers
  - status/active
module: customers
route: /customers
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Customers

The Customers module is the venue's CRM. Every person who makes a [[Table Bookings|table booking]], [[Private Bookings|private booking]], or has been contacted via [[Messages & SMS]] has a customer record. Staff can view booking history, spending, communication preferences, and manage labels for segmentation.

---

## Route & Access

| Property | Value |
|---|---|
| Route | `/customers` |
| Auth | Required — `(authenticated)` layout group |

### Permissions

| Permission | Description |
|---|---|
| `customers.view` | View customer list and individual records |
| `customers.create` | Create new customer records manually |
| `customers.edit` | Edit customer details, labels, and opt-in status |
| `customers.delete` | Delete customer records |

---

## Key Features

### Customer Record Fields

| Field | Notes |
|---|---|
| Name | Full name (first + last) |
| Email | Optional; used for email communications |
| Phone | E.164 format (e.g. `+447911123456`); normalised via `libphonenumber-js` |
| SMS opt-in status | Whether the customer has consented to receive SMS |
| Labels | Free-form tags for segmentation (e.g. `VIP`, `Regular`, `Corporate`) |
| Notes | Internal staff notes — never shown to customers |
| Delivery failure flag | Set when SMS delivery consistently fails for this number |

> [!NOTE]
> All phone numbers are stored and displayed in **E.164 international format** (`+44...`). The `libphonenumber-js` library handles normalisation from various input formats. Never store a phone number in any other format — this ensures consistent matching across bookings, SMS records, and opt-out lookups.

### Booking History
Each customer record displays a consolidated view of:
- All linked [[Table Bookings]]
- All linked [[Private Bookings]]
- Total visit count and total spend (derived from completed bookings)

### Spending History
Aggregated from confirmed/completed bookings. Useful for identifying high-value customers and applying appropriate service levels.

### Merge Duplicate Records
When the same customer appears multiple times (e.g. booked once with a nickname, once with a full name):
- Staff can search for the duplicate and initiate a merge
- The merge operation consolidates all bookings, messages, and labels onto the primary record
- The secondary record is deleted after a successful merge

> [!WARNING]
> Customer merges are **irreversible**. Ensure the correct primary record is selected before confirming. All booking references are re-pointed to the primary record's ID.

### Search & Filtering
The customer list supports:
- Free-text search by name, email, or phone number
- Filter by label
- Filter by SMS opt-in status
- Filter by delivery failure flag

### SMS Delivery Failure Tracking
When a Twilio delivery receipt returns a permanent failure status for a customer's number (e.g. number disconnected, not in service), the customer record is flagged. This prevents repeated SMS sends to dead numbers and helps staff identify records that need updating.

---

## Database

| Table | Purpose |
|---|---|
| `customers` | Core customer records |

---

## TypeScript Types

- **File**: `src/types/customers.ts`
- Key types: `Customer`, `CustomerLabel`, `CustomerWithBookings`

---

## Service Layer

- **File**: `src/services/customers.ts`
- **Class**: `CustomerService`
- Key methods:
  - `lookupByPhone(phone)` — find a customer by E.164 phone number; used during booking creation to auto-link or create
  - `mergeCustomers(primaryId, secondaryId)` — consolidate duplicate records
  - `updateLabel(customerId, label, add)` — add or remove a label from a customer
  - `updateSmsOptIn(customerId, status)` — toggle opt-in consent
  - `markDeliveryFailure(customerId)` — flag persistent SMS delivery failure

> [!TIP]
> When creating a [[Private Bookings|private booking]] or [[Table Bookings|table booking]], the booking creation flow calls `CustomerService.lookupByPhone()` first. If a matching customer exists, the booking is linked to them. If not, a new customer record is created automatically. Staff should avoid manually creating duplicate records — search first.

---

## Architecture Notes

- Customer records are created automatically when a booking is made via the public form or when staff create a booking and the phone number does not match an existing record
- The `customers` table is referenced by foreign key in `table_bookings`, `private_bookings`, and `messages`
- Opt-in status is enforced at the SMS send level — [[Messages & SMS]] and [[Private Bookings]] SMS queue both check opt-in before allowing a message to be sent

> [!DANGER]
> Do not delete customer records that have active or recent bookings. Deletion cascades are intentionally restricted at the database level. Archive or merge instead.

---

## Related

- [[Modules MOC]] — full module list
- [[Customer Model]] — database schema and type reference
- [[Messages & SMS]] — SMS communication history per customer
- [[Private Bookings]] — full-service event bookings linked to customers
- [[Table Bookings]] — table reservations linked to customers
- [[Dashboard]] — pipeline overview

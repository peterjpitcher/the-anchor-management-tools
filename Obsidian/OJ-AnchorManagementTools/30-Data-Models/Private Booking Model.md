---
title: Private Booking Model
aliases:
  - private_bookings table
  - Private Booking
tags:
  - type/reference
  - section/data-models
  - status/active
created: 2026-03-14
updated: 2026-03-14
table: private_bookings
typescript: src/types/private-bookings.ts
---

← [[Data Models MOC]]

# Private Booking Model

Private bookings represent hired events at The Anchor — birthday parties, corporate functions, wakes, and similar. They involve spaces, catering packages, and vendors, and carry specific deposit and contract requirements.

## Primary Table: `private_bookings`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `customer_id` | uuid | FK → customers |
| `status` | text | `enquiry` \| `tentative` \| `confirmed` \| `completed` \| `cancelled` |
| `event_date` | date | Date of the private event |
| `guest_count` | int | Expected number of guests |
| `total_price` | numeric | Total booking value |
| `deposit_amount` | numeric | £10 × guest_count if guest_count ≥ 7 |
| `deposit_paid` | bool | Whether the deposit has been received |
| `payment_method` | text | `cash` \| `card` \| `invoice` |
| `contract_generated` | bool | Whether a contract has been produced |
| `notes` | text | Internal notes |
| `created_at` | timestamptz | Auto-set on insert |
| `updated_at` | timestamptz | Auto-updated on change |

## Related Table: `private_booking_items`

Line items that make up the booking — spaces, catering packages, and vendors.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `booking_id` | uuid | FK → private_bookings |
| `item_type` | text | `space` \| `catering` \| `vendor` |
| `name` | text | Display name of the item |
| `quantity` | int | Number of units |
| `unit_price` | numeric | Price per unit |
| `notes` | text | Item-level notes |

## Related Table: `private_booking_documents`

Stores references to generated contracts and other booking documents.

## Related Table: `private_booking_sms_queue`

Holds SMS messages for this booking that are awaiting manager approval before sending. See [[SMS Policy]].

## Status Lifecycle

```
enquiry → tentative → confirmed → completed
                              ↘ cancelled
```

- **enquiry**: Initial contact; details being gathered
- **tentative**: Provisional hold on space/date; not yet confirmed
- **confirmed**: Booking locked in; contract should be generated
- **completed**: Event has taken place
- **cancelled**: Booking will not proceed

## Business Rules

> [!DANGER] Deposit Policy
> Deposits are **£10 per person** for groups of **7 or more** guests. This is a **cash deposit** — NOT a credit card hold. Any reference to "credit card hold" in code or UI is a bug and must be fixed immediately.

> [!NOTE] Contract Requirement
> A contract **must** be generated for all confirmed bookings. The `contract_generated` flag tracks this. Bookings should not be marked `confirmed` without a contract.

> [!NOTE] Deposit Exemption
> Events hosted by the venue itself (e.g. staff parties, venue-organised functions) are **exempt** from deposit rules.

## Key TypeScript Types

- `PrivateBooking` — maps to `private_bookings`
- `PrivateBookingItem` — maps to `private_booking_items`
- `VenueSpace` — available spaces that can be booked
- `CateringPackage` — catering options available to add to a booking
- `Vendor` — external vendors (e.g. photographers, entertainers)
- `BookingStatus` — union of status values
- `PaymentMethod` — union of payment method values

## Used By

- [[Private Bookings]] — full management UI for enquiries through to completion

## Related

- [[Data Models MOC]]
- [[Customer Model]]
- [[Invoice Model]]
- [[Private Bookings]]
- [[Deposits & Payments]]
- [[SMS Policy]]
- [[Customers]]

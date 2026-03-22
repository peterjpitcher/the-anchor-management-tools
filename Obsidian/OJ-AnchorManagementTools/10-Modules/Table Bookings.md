---
title: Table Bookings
aliases:
  - Table Reservations
  - Event Reservations
  - Public Booking Form
tags:
  - type/reference
  - module/table-bookings
  - status/active
module: table-bookings
route: /table-bookings
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Table Bookings

Table Bookings manages event-linked table reservations for The Anchor's public [[Events|events]]. Customers can book seats at a specific event via the public-facing booking form. Staff manage all reservations through the authenticated management interface.

---

## Route & Access

| Property | Value |
|---|---|
| Staff management route | `/table-bookings` |
| Public booking form | `/table-booking` (unauthenticated) |
| Guest view / modify | `/table-booking/[reference]` (unauthenticated) |
| Booking confirmation | `/booking-success/[id]` |
| Auth | Required for staff management; public form is unauthenticated |

### Permissions

| Permission | Description |
|---|---|
| `table_bookings.view` | View all table bookings in the management interface |
| `table_bookings.create` | Create bookings on behalf of customers |
| `table_bookings.edit` | Edit existing bookings (guest count, table, notes) |
| `table_bookings.delete` | Delete booking records |

---

## Key Features

### Reservations Linked to Events
Every table booking is associated with a specific [[Events|event]]. The public booking form can be pre-filtered by event via a query parameter. Staff can also browse bookings filtered by event.

### Guest and Seating Details

| Field | Notes |
|---|---|
| Guest count | Number of guests in the party |
| Table assignment | Optional — specific table number or area |
| Seating notes | Accessibility requirements, preferences, etc. |
| Special requirements | Dietary needs, celebrations, etc. |

### Deposits

> [!DANGER]
> For groups of **7 or more guests**, a deposit of **£10 per person** is required. This is a **cash deposit collected at the venue** — not a card pre-authorisation or hold. Do not refer to this as a "credit card hold" anywhere in the UI or communications.

| Rule | Detail |
|---|---|
| Threshold | 7 or more guests |
| Amount | £10 per person |
| Collection method | Cash at the venue |

### Payment Methods

| Method | Notes |
|---|---|
| Cash | Collected at the venue; recorded manually |
| Card | Via [[Stripe]] integration (where applicable) |
| Invoice | For group/corporate bookings; generates an [[Invoices|invoice]] |

### Cancellation Tracking
Cancellations record:
- The reason (if provided by the customer or staff)
- Who cancelled (customer self-service vs. staff)
- Timestamp
- Whether a deposit was taken and how it was handled

---

## Public Booking Flow

### 1. Booking Form (`/table-booking`)
- Accessible without authentication
- Customer enters: name, phone, email, party size, preferred event
- Phone number normalised to E.164 via `libphonenumber-js`
- On submission: customer record created or matched via `CustomerService.lookupByPhone()` (see [[Customers]])
- Booking reference generated and returned

### 2. Confirmation Page (`/booking-success/[id]`)
- Displays booking summary and reference number
- SMS confirmation sent via [[Twilio]] (subject to customer opt-in)
- Reminder SMS scheduled for before the event date

### 3. Guest Self-Service (`/table-booking/[reference]`)
- Customers can view their booking details using their reference number
- Allows the guest to cancel their booking without needing to call
- No authentication required — the reference number acts as the access token

> [!NOTE]
> The guest self-service URL is accessible by anyone with the booking reference. References are generated as sufficiently random strings to prevent enumeration. Do not expose sequential IDs here.

### Short Link Sharing
Event booking links can be shortened via [[Short Links]] for sharing on social media, flyers, or SMS blasts. This insulates shared links from changes to slugs or URL structure.

---

## SMS Notifications

[[Twilio]] sends the following automated messages (subject to customer opt-in):

| Trigger | Message |
|---|---|
| Booking confirmed | Confirmation SMS with booking reference and event details |
| Reminder | Reminder SMS sent before the event (configured in `booking_reminders`) |
| Cancellation | Cancellation confirmation SMS |

> [!TIP]
> SMS sends are gated by the customer's opt-in status stored on their [[Customers|customer record]]. If a customer reports they did not want SMS messages, check and update their opt-in flag — do not suppress sends at the booking level only.

---

## Database

| Table | Purpose |
|---|---|
| `table_bookings` | Core table reservation records |
| `bookings` | Base booking records (shared with other booking types) |
| `booking_reminders` | Scheduled reminder records for SMS dispatch |

---

## TypeScript Types

- Key types: `TableBooking`, `BookingReminder`, `BookingStatus`
- Types reference the shared `Customer` type from `src/types/customers.ts`

---

## Architecture Notes

- Table bookings are always linked to an [[Events|event]] — standalone table reservations without an event context are not supported by this module (see [[Private Bookings]] for event-agnostic private hire)
- The public booking form lives in the unauthenticated route group — it has no access to staff session data
- Booking reference generation must produce strings that are long enough to be non-enumerable; UUID-based references or equivalent are appropriate
- The `booking_reminders` table is consumed by the Vercel cron job at `/api/cron/` to dispatch reminder SMS messages on schedule

> [!WARNING]
> The public booking routes (`/table-booking`, `/booking-success`, `/table-booking/[reference]`) are explicitly allowlisted as public in the auth layer. Do not add auth requirements to these routes — they must remain publicly accessible for the guest self-service flow to work.

---

## Related

- [[Modules MOC]] — full module list
- [[Events]] — events that table bookings are linked to
- [[Customers]] — customer records auto-created or matched on booking
- [[Deposits & Payments]] — deposit rules for large groups
- [[Short Links]] — shareable event booking links
- [[Twilio]] — SMS confirmation and reminder dispatch
- [[Stripe]] — card payment processing
- [[Invoices]] — invoice generation for group bookings
- [[Private Bookings]] — full-service private event packages
- [[Dashboard]] — pending reservations summary

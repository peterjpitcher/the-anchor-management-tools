---
title: Private Bookings
aliases:
  - Private Events
  - Event Packages
  - Private Hire
tags:
  - type/reference
  - module/private-bookings
  - status/active
module: private-bookings
route: /private-bookings
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Private Bookings

Private Bookings is the core revenue module for The Anchor. It manages full-service private event packages — corporate events, parties, celebrations, and private hire. Every private booking has a lifecycle from initial enquiry through to completion, and encompasses venue spaces, catering packages, vendors, deposits, contracts, and SMS communications.

---

## Route & Access

| Property | Value |
|---|---|
| Route | `/private-bookings` |
| Auth | Required — `(authenticated)` layout group |

### Permissions

| Permission | Description |
|---|---|
| `private_bookings.view` | View booking list and details |
| `private_bookings.create` | Create new bookings and enquiries |
| `private_bookings.edit` | Edit booking details and line items |
| `private_bookings.delete` | Delete bookings |
| `private_bookings.generate_contracts` | Generate PDF contracts for customers |
| `private_bookings.manage_deposits` | Record and manage deposit payments |
| `private_bookings.view_pricing` | View cost and pricing breakdowns |
| `private_bookings.manage_catering` | Add or edit catering packages on a booking |
| `private_bookings.manage_vendors` | Add or edit vendor line items (DJ, photographer, etc.) |
| `private_bookings.manage_spaces` | Assign or change venue spaces on a booking |
| `private_bookings.view_sms_queue` | View staged SMS messages awaiting approval |
| `private_bookings.approve_sms` | Approve or reject staged SMS messages for sending |

---

## Booking Status Lifecycle

Private bookings progress through a defined lifecycle. Status transitions are tracked with timestamps and recorded in the audit trail.

```
Enquiry → Tentative → Confirmed → Completed
                    ↘ Cancelled
```

| Status | Meaning |
|---|---|
| `enquiry` | Initial contact received; not yet committed |
| `tentative` | Verbal agreement; awaiting deposit or contract |
| `confirmed` | Deposit received and contract signed |
| `completed` | Event has taken place; booking closed |
| `cancelled` | Booking cancelled at any stage |

> [!NOTE]
> A booking should only move to `confirmed` once both a deposit has been received (where applicable) and a contract has been generated and acknowledged. The system does not enforce this automatically — staff judgment applies.

---

## Line Items

Each booking is composed of one or more line items across three categories:

| Category | Examples |
|---|---|
| Venue spaces | Main bar, private dining room, garden area |
| Catering packages | Buffet, set menu, canapés, drinks packages |
| Vendors | DJ, live band, photographer, florist |

Line item configuration (available spaces, catering packages, vendor types) is managed in [[Catering and Venues → Settings]].

---

## Deposits & Payments

> [!DANGER]
> The deposit policy is **£10 per person for groups of 7 or more**. This is a **cash deposit** — not a credit card hold or pre-authorisation. Any reference to "credit card hold" in the codebase or templates is a legacy bug and must be corrected.

| Rule | Detail |
|---|---|
| Threshold | Groups of 7 or more guests |
| Amount | £10 per person |
| Method | Cash payment at the venue |
| Purpose | Secures the booking; deducted from the final bill |

Payment methods for the booking itself (not the deposit):

| Method | Notes |
|---|---|
| Cash | Recorded manually by staff |
| Card (Stripe) | Card payment via [[Stripe]] integration |
| Invoice | For corporate bookings; generates an [[Invoices|invoice]] |

---

## Contract Generation

> [!WARNING]
> **Contracts MUST be generated for all private bookings.** This is a non-negotiable business rule. A booking should not progress to `confirmed` without a contract on file.

- Contracts are generated as PDF documents using **Puppeteer**
- Generated PDFs are stored in Supabase storage under a booking-specific path
- Stored document records are tracked in the `private_booking_documents` table
- Staff can regenerate a contract if booking details change after initial generation
- The contract PDF is sent to the customer via email (via [[Microsoft Graph]])

---

## SMS Queue

Private bookings have a staged SMS workflow to ensure all customer communications are reviewed before sending:

1. Staff compose a message in the booking view
2. The message is added to the SMS queue (`private_booking_sms_queue` table) with status `pending`
3. A user with `private_bookings.approve_sms` reviews and approves or rejects the message
4. Approved messages are dispatched via [[Twilio]]

> [!TIP]
> The SMS queue exists to prevent accidental or premature customer communications. Always review message content and timing before approving — customers receive these messages on their personal phones.

- The [[Dashboard]] surfacing of unanswered messages is distinct from this queue; this queue is booking-specific
- Opt-in status is checked against the [[Customers|customer record]] before any SMS is dispatched

---

## Audit Trail

All changes to a private booking are recorded with:
- Timestamp
- User who made the change
- Previous and new values for changed fields
- Operation type (`create`, `update`, `status_change`, `document_generated`, `payment_recorded`, etc.)

This audit trail is surfaced in the booking detail view and stored via `logAuditEvent()`.

---

## Database

| Table | Purpose |
|---|---|
| `private_bookings` | Core booking records |
| `private_booking_items` | Line items (spaces, catering, vendors) per booking |
| `private_booking_documents` | Generated contract PDFs and other documents |
| `private_booking_sms_queue` | Staged SMS messages awaiting approval |

---

## TypeScript Types

- **File**: `src/types/private-bookings.ts`
- Key types: `PrivateBooking`, `PrivateBookingItem`, `PrivateBookingDocument`, `SmsQueueItem`, `BookingStatus`

---

## Service Layer

- **File**: `src/services/private-bookings.ts`
- **Size**: ~112 KB — this is the largest service in the codebase and encapsulates the full business logic for the module
- Covers: booking CRUD, status transitions, line item management, deposit recording, contract generation triggers, SMS queue management, audit logging

> [!NOTE]
> The size of this service reflects the genuine complexity of the domain. Resist the temptation to split it arbitrarily — changes should stay cohesive. If a clear bounded sub-domain emerges (e.g. a dedicated contract service), extract it with intent, not as a reflex.

---

## Integrations

| Integration | Purpose |
|---|---|
| [[Twilio]] | SMS queue dispatch |
| [[Stripe]] | Card payment processing |
| [[Microsoft Graph]] | Email delivery of contracts and confirmations |

---

## Related

- [[Modules MOC]] — full module list
- [[Private Booking Model]] — database schema and type reference
- [[Deposits & Payments]] — deposit rules and payment tracking
- [[Customers]] — customer records linked to bookings
- [[Catering and Venues → Settings]] — space and catering package configuration
- [[Twilio]] — SMS dispatch integration
- [[Stripe]] — card payment integration
- [[Invoices]] — invoice generation for corporate bookings
- [[Dashboard]] — enquiry pipeline summary

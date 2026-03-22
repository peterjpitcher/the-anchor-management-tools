---
title: Parking
aliases:
  - Guest Parking
  - Parking Allocations
tags:
  - type/reference
  - module/parking
  - status/active
module: parking
route: /parking
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Parking

The Parking module manages guest parking allocation for events at The Anchor. Staff allocate spaces, record vehicle details, and trigger SMS reminders to guests. A public kiosk-style view allows guests to check their allocation without logging in.

---

## Permissions

| Permission | Description |
|---|---|
| `parking.view` | View all parking allocations |
| `parking.create` | Create new allocations |
| `parking.edit` | Update allocation details |
| `parking.delete` | Remove allocations |

---

## Routes

| Route | Auth | Description |
|---|---|---|
| `/parking` | Required | Staff management view — all allocations |
| `/parking/guest` | None (public) | Guest kiosk view — no authentication required |

> [!NOTE]
> `/parking/guest` is explicitly listed as a public path prefix in the auth middleware. No credentials are needed to access it.

---

## Key Features

### Space Allocation

Staff link a parking space to a guest for a specific event. Each allocation records:

| Field | Description |
|---|---|
| Guest name | Name as it will appear in the SMS |
| Vehicle registration | Plate number for identification |
| Space identifier | Slot label or number |
| Event | The event the allocation relates to |
| Notes | Any special instructions for the guest |

### SMS Reminders

Guests are sent an SMS reminder about their parking space. Messages are dispatched via [[Twilio]] and include the space identifier and any relevant instructions.

> [!TIP]
> The daily cron job (`parking-notifications`) runs at 5am UTC and sends reminders for allocations due that day. Staff can also trigger reminders manually from the allocation detail view.

### Navigation Badge

A pending parking count is shown in the navigation badge. This reflects allocations where SMS reminders have not yet been sent.

### Public Guest View

The `/parking/guest` route provides a simple, unauthenticated view guests can access via a short link. It displays their allocated space without exposing any other system data.

---

## Business Rules

> [!WARNING]
> SMS messages sent via this module count against the Twilio rate limits. Bulk manual triggers should be avoided outside the scheduled cron window to prevent throttling. See [[Twilio]] for daily and hourly limits.

---

## Database Tables

| Table | Purpose |
|---|---|
| `parking_allocations` | Primary record of space-to-guest assignments |

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/types/parking.ts` | TypeScript types: `ParkingAllocation`, `GuestParking` |
| `src/services/parking.ts` | Business logic service layer |

---

## Cron Job

| Job | Schedule | Description |
|---|---|---|
| `parking-notifications` | `0 5 * * *` | Sends daily SMS reminders for that day's parking allocations |

See [[Cron Jobs]] for the full cron schedule and implementation details.

---

## Related

- [[Modules MOC]]
- [[Events]]
- [[Customers]]
- [[Twilio]]
- [[Cron Jobs]]
- [[Messages & SMS]]
- [[Short Links]]

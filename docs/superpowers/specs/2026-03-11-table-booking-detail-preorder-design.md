# Design Spec: Table Booking Detail Page & Pre-order Management

**Date:** 2026-03-11
**Status:** Approved
**Scope:** Sunday lunch pre-orders only

---

## Overview

Two staff-facing improvements:

1. **New booking detail page** at `/table-bookings/[id]` — a full management page replacing the BOH modal, with tabs for Overview, Pre-order, and SMS.
2. **FOH colour-coded cards** — Sunday lunch booking cards in the FOH swimlane get a coloured left-border indicating pre-order status.

---

## 1. Booking Detail Page

### Route
`/app/(authenticated)/table-bookings/[id]/page.tsx`

### Structure
- **Server Component** — fetches booking data server-side, enforces auth via the authenticated layout
- Renders `PageLayout` (ui-v2 pattern) with title = booking reference + guest name
- Back button navigates to `/table-bookings/boh`
- Passes booking data to `BookingDetailClient` (Client Component) which manages tab state

### Tabs

#### Overview
- **Status strip** — booking status badge, party size, table assignment, booking type, deposit status
- **Guest panel** — name, mobile, SMS status, lifecycle timestamps (seated, left, no-show)
- **Notes panel** — special requirements, dietary requirements, allergies (conditional: only shown if present)
- **Quick actions** — Seat guests, Mark left, Mark confirmed, Mark completed, Edit party size, Move table (dropdown), Copy deposit link
- **Danger zone** — Cancel booking, Mark no-show, Delete booking (permission-gated)
- **Pre-order banner** — shown only on `sunday_lunch` bookings:
  - Green banner: "✓ Pre-order submitted — 4 mains · 4 sides · 2 extras → View in Pre-order tab"
  - Amber banner: "⏳ Pre-order not yet submitted → View in Pre-order tab"

#### Pre-order
- Only rendered for `sunday_lunch` bookings; tab hidden for all other booking types
- **Read view** (default):
  - Shows cutoff datetime and submission status
  - Items grouped by type: Mains, Sides, Extras
  - Each item row: name + quantity badge
  - "No pre-order submitted" empty state with Create button if nothing exists yet
  - "Edit pre-order" button switches to edit view
- **Edit view** (inline, no modal):
  - Full Sunday lunch menu fetched via `getSundayPreorderPageDataByBookingId()`
  - Items grouped by type with number inputs (min 0)
  - Existing quantities pre-populated
  - Items at qty 0 are greyed but accessible
  - Save calls `saveSundayPreorderByBookingId()` server action
  - On success: returns to read view with updated data
  - No cutoff enforcement — staff can always edit
  - Cancel button returns to read view without saving

#### SMS
- Text area for message body (640 character limit with counter)
- Send SMS button
- Logic ported directly from existing BOH modal SMS section

### Files to Create
- `src/app/(authenticated)/table-bookings/[id]/page.tsx` — Server Component
- `src/app/(authenticated)/table-bookings/[id]/BookingDetailClient.tsx` — Client Component (tabs, actions, modal state)
- `src/app/(authenticated)/table-bookings/[id]/PreorderTab.tsx` — Client Component (read/edit toggle, form)

### Existing Service Layer (reuse, no changes)
- `getSundayPreorderPageDataByBookingId(bookingId)` — loads pre-order state + menu for staff
- `saveSundayPreorderByBookingId(bookingId, items)` — saves staff-initiated pre-order

---

## 2. FOH Colour-Coded Cards

### Behaviour
Sunday lunch booking cards in the FOH swimlane get a left-border accent:

| State | Border colour | Label |
|---|---|---|
| `sunday_preorder_completed_at` is not null | Green (`#16a34a`) | `✓ Pre-order done` |
| `sunday_lunch` type, `sunday_preorder_completed_at` is null | Amber (`#d97706`) | `⏳ Pre-order pending` |
| Non-Sunday-lunch booking | No change | — |

### Data
Check whether `sunday_preorder_completed_at` is already included in the FOH booking query. If not, add it to the select. No new API endpoints required.

### Files to Modify
- FOH swimlane card component (wherever booking cards are rendered in `FohScheduleClient.tsx` or related components)
- FOH booking data query (if `sunday_preorder_completed_at` is not already fetched)

---

## 3. BOH Navigation Change

### Change
In `BohBookingsClient.tsx`, the "Manage" button changes from opening a modal to navigating:

```typescript
// Before
onClick={() => setSelectedBookingId(booking.id)}

// After
router.push(`/table-bookings/${booking.id}`)
```

### Cleanup
- Remove all modal state: `selectedBookingId`, `moveTableId`, `smsBody`, `lastInteractionAtMs`
- Remove the modal JSX from `BohBookingsClient`
- The modal logic moves to the new booking detail page

---

## Permissions

- Pre-order tab visible to anyone with `table-bookings: view` permission
- Pre-order edit available to anyone with `table-bookings: edit` permission
- Danger zone actions (delete, cancel) remain permission-gated as they are today in the modal

---

## Out of Scope

- Pre-orders for non-Sunday-lunch booking types
- Guest-facing pre-order flow (already exists, no changes)
- Pre-order cron job / SMS reminders (no changes)
- Pre-order analytics or reporting
- Marking pre-orders as "confirmed/finalised" by staff

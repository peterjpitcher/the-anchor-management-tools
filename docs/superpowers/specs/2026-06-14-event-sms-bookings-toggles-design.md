# Design Spec: Event SMS & Bookings Toggles

**Date:** 2026-06-14
**Status:** Approved
**Scope:** OJ-AnchorManagementTools + OJ-The-Anchor.pub

## Summary

Add two independent boolean toggles to the event setup form: **"Send SMS for this event"** (`sms_enabled`) and **"Accept bookings for this event"** (`bookings_enabled`). Both default to `true` so all existing events keep current behaviour.

## Requirements

- Staff can independently control whether an event sends SMS and/or accepts bookings
- Toggles are available on the event create and edit forms
- SMS cron jobs respect `sms_enabled` — no reminders, follow-ups, or cross-promo for disabled events
- Booking APIs reject new bookings when `bookings_enabled = false`
- Public site hides booking UI but still lists the event
- Existing bookings are NOT cancelled when `bookings_enabled` is toggled off
- Event categories have default values for the toggles so new events in a category inherit sensible defaults

## Design

### 1. Database (OJ-AnchorManagementTools)

Add two columns to `events` table:

```sql
ALTER TABLE events ADD COLUMN sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN bookings_enabled BOOLEAN NOT NULL DEFAULT true;
```

Add two columns to `event_categories` table:

```sql
ALTER TABLE event_categories ADD COLUMN default_sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE event_categories ADD COLUMN default_bookings_enabled BOOLEAN NOT NULL DEFAULT true;
```

Update `create_event_transaction()` and `update_event_transaction()` (latest in migration `20260528000000_event_seo_keyword_engine.sql`) to accept and persist both fields from `p_event_data` JSONB, with COALESCE defaulting to `true`.

### 2. Type Updates (OJ-AnchorManagementTools)

Add to `Event` interface in `src/types/event.ts`:

```typescript
sms_enabled: boolean
bookings_enabled: boolean
```

Add to `EventFormData`:

```typescript
sms_enabled?: boolean
bookings_enabled?: boolean
```

Add to `EventCategory` interface in `src/types/event.ts`:

```typescript
default_sms_enabled: boolean
default_bookings_enabled: boolean
```

### 3. Event Form UI (OJ-AnchorManagementTools)

In `src/components/features/events/EventFormGrouped.tsx`:

- Add two state variables: `smsEnabled` and `bookingsEnabled`, initialised from `event?.sms_enabled ?? true` (for new events, fall back to the selected category's `default_sms_enabled` / `default_bookings_enabled`)
- Add a new **"Visibility & Communications"** collapsible section (or append to an existing relevant section) with two toggle switches
- When `bookingsEnabled` is false, show an info message: "Bookings are turned off — this event won't appear in booking flows on the public site."
- Include both fields in the `onSubmit` data payload

### 4. Event Category Defaults (OJ-AnchorManagementTools)

In the event category settings page (`src/app/(authenticated)/settings/event-categories/`):

- Add two toggle fields: **"Default SMS enabled"** and **"Default bookings enabled"** to the category edit form
- These set `default_sms_enabled` and `default_bookings_enabled` on the `event_categories` table
- When creating a new event and selecting a category, the form pre-fills `smsEnabled` and `bookingsEnabled` from the category defaults (same pattern as existing defaults like `default_price`, `default_is_free`, etc.)
- When editing an existing event, the event's own values take precedence over category defaults

### 5. SMS Suppression (OJ-AnchorManagementTools)

**Event Guest Engagement cron** (`src/app/api/cron/event-guest-engagement/route.ts`):
- Filter out events where `sms_enabled = false` from all SMS queries:
  - 1-day reminder SMS
  - Post-event review follow-up SMS
  - Cross-promo SMS (exclude events with `sms_enabled = false` from the promo pool)

**Other event SMS crons** (if they query events directly):
- `event-checklist-reminders` — add `sms_enabled` check
- `event-booking-holds` — add `sms_enabled` check
- `event-waitlist-offers` — add `sms_enabled` check
- `post-event-followup` — add `sms_enabled` check

**Booking confirmation SMS**: Still sends if a booking is somehow created (e.g. staff creates it manually in the management tool). The `sms_enabled` flag controls promotional/automated outbound SMS, not transactional confirmations tied to a specific user action.

### 6. Booking Suppression — Management Tools API (OJ-AnchorManagementTools)

**Event Bookings API** (`src/app/api/event-bookings/route.ts`):
- Before creating a booking, check `event.bookings_enabled`
- If `false`, return `{ error: 'Bookings are not available for this event' }` with 400/409 status

### 7. Public Site — The Anchor.pub

**6a. Event Listing (`/whats-on`)**
- Events with `bookings_enabled = false` still appear in the listing
- `EventBookingButton` component: when `bookings_enabled = false`, render "No booking required" or hide the button instead of showing "Book Now"

**6b. Event Detail Page (`/events/[id]`)**
- The 4 booking CTA locations (hero, mobile sidebar, desktop sidebar, bottom section) check `bookings_enabled`
- When `false`: hide `ManagementEventBookingForm`, replace with a message like "This event doesn't require booking — just turn up on the night"

**6c. Event Booking API** (`/app/api/event-bookings` POST):
- Server-side guard: reject bookings for events with `bookings_enabled = false`
- This is belt-and-braces even if the UI hides the form

**6d. Availability Check** (`/api/events/[id]/availability`):
- When `bookings_enabled = false`, return a response indicating bookings aren't accepted rather than checking seat counts

**6e. Data Flow**
- The `bookings_enabled` field flows through from the management tools API automatically since it's on the events table
- Public site components read it to conditionally render booking UI
- `sms_enabled` is NOT exposed to the public site (backend-only concern)

### 8. What Doesn't Change

- Events with either toggle off still appear in the management tool calendar/list
- Staff can still view and edit the event internally
- `sms_enabled` has no effect on the public site
- Existing bookings are not cancelled when `bookings_enabled` is toggled off — only new bookings are blocked
- Booking confirmation SMS still sends for manually created bookings (transactional, not promotional)

## Key Files

### OJ-AnchorManagementTools
| File | Change |
|------|--------|
| `supabase/migrations/[new]` | Add columns to events + event_categories, update transaction functions |
| `src/types/event.ts` | Add `sms_enabled`, `bookings_enabled` to Event; add defaults to EventCategory |
| `src/components/features/events/EventFormGrouped.tsx` | Add toggle UI, pre-fill from category defaults |
| `src/app/(authenticated)/settings/event-categories/` | Add default toggle fields to category edit form |
| `src/app/api/cron/event-guest-engagement/route.ts` | Filter by `sms_enabled` |
| `src/app/api/cron/event-booking-holds/route.ts` | Filter by `sms_enabled` |
| `src/app/api/cron/event-waitlist-offers/route.ts` | Filter by `sms_enabled` |
| `src/app/api/cron/event-checklist-reminders/route.ts` | Filter by `sms_enabled` |
| `src/app/api/cron/post-event-followup/route.ts` | Filter by `sms_enabled` |
| `src/app/api/event-bookings/route.ts` | Guard with `bookings_enabled` |

### OJ-The-Anchor.pub
| File | Change |
|------|--------|
| `components/EventBookingButton.tsx` | Conditional render when bookings disabled |
| `app/events/[id]/page.tsx` | Hide booking CTAs and form |
| `app/api/event-bookings/route.ts` | Server-side booking guard |
| `app/api/events/[id]/availability/route.ts` | Return "not bookable" response |

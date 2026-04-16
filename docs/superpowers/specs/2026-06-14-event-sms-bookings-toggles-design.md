# Design Spec: Event SMS & Bookings Toggles

**Date:** 2026-06-14
**Status:** Approved (revised after adversarial review)
**Scope:** OJ-AnchorManagementTools + OJ-The-Anchor.pub

## Summary

Add two independent boolean toggles to the event setup form: **"Promotional SMS"** (`promo_sms_enabled`) and **"Accept bookings"** (`bookings_enabled`). Both default to `true` so all existing events keep current behaviour. `bookings_enabled` is an admin override that works alongside the existing `booking_open` runtime flag.

## Key Decisions (from adversarial review)

1. **Column naming:** `promo_sms_enabled` (not `sms_enabled`) — makes it clear that transactional SMS is exempt.
2. **Relationship with `booking_open`:** `bookings_enabled` is a separate admin override. `booking_open` remains as runtime state (auto-managed on cancellation/sell-out). Bookings are only allowed when `booking_open = true AND bookings_enabled = true`.
3. **Bulk messages:** `promo_sms_enabled = false` does NOT block manual bulk messages — staff intent overrides automation.
4. **Waitlist:** `bookings_enabled = false` blocks new waitlist entries, new offers, and accepting offers. Existing entries stay (dormant) until re-enabled.
5. **Category defaults:** Forward-looking only — changing a category default never cascades to existing events.
6. **Staff manual bookings:** Staff can still create bookings via the management tool even when `bookings_enabled = false` (staff override).

## SMS Classification

| SMS Type | Respects `promo_sms_enabled`? |
|----------|-------------------------------|
| Event reminder (1 day before) | **Yes** — skip if false |
| Post-event review request | **Yes** — skip if false |
| Cross-promo / follow-up | **Yes** — skip if false |
| Waitlist offer | **Yes** — skip if false (also blocked by `bookings_enabled`) |
| Booking confirmation | No — always sends |
| Event cancellation notification | No — always sends |
| Hold expiry notification | No — always sends |
| Manual bulk message by staff | No — always sends |

## Requirements

- Staff can independently control whether an event sends promotional SMS and/or accepts public bookings
- Toggles are available on the event create and edit forms
- Automated SMS cron jobs respect `promo_sms_enabled` — no reminders, follow-ups, or cross-promo for disabled events
- Transactional SMS (booking confirmations, cancellations, hold expiry) always sends regardless of toggle
- Public booking APIs reject new bookings when `bookings_enabled = false`; staff manual bookings bypass this
- Waitlist entries, offers, and acceptances are blocked when `bookings_enabled = false`
- Public site hides booking UI but still lists the event
- Existing bookings are NOT cancelled when `bookings_enabled` is toggled off
- Event categories have default values for the toggles so new events inherit sensible defaults (forward-looking only)

## Design

### 1. Database (OJ-AnchorManagementTools)

Add two columns to `events` table:

```sql
ALTER TABLE events ADD COLUMN promo_sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE events ADD COLUMN bookings_enabled BOOLEAN NOT NULL DEFAULT true;
```

Add two columns to `event_categories` table:

```sql
ALTER TABLE event_categories ADD COLUMN default_promo_sms_enabled BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE event_categories ADD COLUMN default_bookings_enabled BOOLEAN NOT NULL DEFAULT true;
```

Update `create_event_transaction()` (latest in `20260528000000_event_seo_keyword_engine.sql`):
- Add both columns to the `INSERT INTO events (...)` column list and matching `VALUES` list
- Use `COALESCE((p_event_data->>'promo_sms_enabled')::boolean, true)` (safe because all fields are provided on create)

Update `update_event_transaction()`:
- Use the existing partial-update pattern: `CASE WHEN p_event_data ? 'promo_sms_enabled' THEN (p_event_data->>'promo_sms_enabled')::boolean ELSE promo_sms_enabled END`
- **Not** bare COALESCE — that would re-enable disabled events on unrelated updates

Update booking/waitlist RPCs to check `bookings_enabled`:
- `create_event_booking_v05` — add `AND bookings_enabled = true` to the booking-allowed check alongside existing `booking_open` check
- `create_event_waitlist_entry_v05` — block when `bookings_enabled = false`
- `create_next_waitlist_offer_v05` — block when `bookings_enabled = false`
- `accept_waitlist_offer_v05` — block when `bookings_enabled = false`

### 2. Type Updates (OJ-AnchorManagementTools)

Add to `Event` interface in `src/types/event.ts`:

```typescript
promo_sms_enabled: boolean
bookings_enabled: boolean
```

Add to `EventFormData`:

```typescript
promo_sms_enabled?: boolean
bookings_enabled?: boolean
```

Add to `EventCategory` interface in `src/types/event-categories.ts`:

```typescript
default_promo_sms_enabled: boolean
default_bookings_enabled: boolean
```

Also update `src/types/database.ts` if it mirrors generated types.

### 3. Event Form UI (OJ-AnchorManagementTools)

In `src/components/features/events/EventFormGrouped.tsx`:

- Add two state variables: `promoSmsEnabled` and `bookingsEnabled`, initialised from `event?.promo_sms_enabled ?? true` (for new events, fall back to the selected category's defaults)
- Apply category defaults in `handleCategoryChange` (client-side, ~line 278) — same pattern as existing defaults like price/is_free
- Also apply in server-side `prepareEventDataFromFormData()` in `src/app/actions/events.ts` — use explicit check, not the `is_free` pattern which loses explicit `false` when category default is `true`
- Add a new **"Visibility & Communications"** collapsible section with two toggle switches
- When `bookingsEnabled` is false, show an info message: "Bookings are turned off — this event won't appear in booking flows on the public site."
- Include both fields in the `onSubmit` data payload

### 4. Event Category Defaults (OJ-AnchorManagementTools)

In `src/components/features/events/EventCategoryFormGrouped.tsx`:

- Add two toggle fields: **"Default promotional SMS"** and **"Default accept bookings"**
- These set `default_promo_sms_enabled` and `default_bookings_enabled` on the `event_categories` table
- Update `src/app/actions/event-categories.ts` and `src/services/event-categories.ts` to persist the new fields
- Category default changes are **forward-looking only** — they never update existing events' values

### 5. SMS Suppression (OJ-AnchorManagementTools)

**Event Guest Engagement cron** (`src/app/api/cron/event-guest-engagement/route.ts`):
- Add `promo_sms_enabled` filter to all event SMS queries:
  - Booking reminder query (~line 612): add `.eq('events.promo_sms_enabled', true)` or in-memory filter
  - Cross-promo event query (~line 1555): add `.eq('promo_sms_enabled', true)`
  - Follow-up event query (~line 1580): add `.eq('promo_sms_enabled', true)`
- Also update related RPCs if they select promo-eligible events:
  - `get_follow_up_recipients` (migration `20260613000001`)
  - Cross-promo general audience RPC (migration `20260612000000`)

**Event Booking Holds cron** (`src/app/api/cron/event-booking-holds/route.ts`):
- Hold expiry logic (~line 55) must ALWAYS run (data integrity — phantom holds block capacity)
- Hold expiry SMS (~line 137) is **transactional** — always sends regardless of `promo_sms_enabled`

**Event Waitlist Offers cron** (`src/app/api/cron/event-waitlist-offers/route.ts`):
- Check both `promo_sms_enabled` (suppress offer SMS) and `bookings_enabled` (suppress offer creation)
- Also update `src/lib/events/waitlist-offers.ts` where offers are actually created/sent

**NOT in scope** (removed after review):
- `event-checklist-reminders` — sends email, not SMS
- `post-event-followup` — queries `private_bookings`, not `events`

### 6. Booking Suppression — Management Tools API (OJ-AnchorManagementTools)

**Event Bookings API** (`src/app/api/event-bookings/route.ts`):
- Add `bookings_enabled` to the event select (~line 114): `select('id, name, date, start_datetime, booking_mode, bookings_enabled')`
- If `bookings_enabled = false`, return `{ error: 'bookings_disabled', message: 'Bookings are not available for this event' }` with 409 status
- This is the API-level guard; the RPC-level guard in `create_event_booking_v05` is the hard backstop

**Staff manual bookings** via `EventDetailClient.tsx` bypass this check — staff can always create bookings for any event.

### 7. Management API Response Projection (OJ-AnchorManagementTools)

The management API explicitly maps event fields in responses. Must add `bookings_enabled` to:
- `src/app/api/events/route.ts` (~line 161) — list endpoint response object
- `src/app/api/events/[id]/route.ts` (~line 174) — detail endpoint response object
- `src/lib/api/schema.ts` `eventToSchema()` (~line 225)

`promo_sms_enabled` must **NOT** be exposed in public-facing API responses. Tighten any `select('*')` paths in:
- `src/app/api/events/today/route.ts`
- `src/app/api/events/recurring/route.ts`

### 8. Public Site — The Anchor.pub

**8a. Event Type & Lifecycle**
- Add `bookings_enabled` to the `Event` type in `lib/api/events.ts`
- Add `'bookings_disabled'` as a new reason in `getEventBookingBlockReason()` in `lib/event-lifecycle.ts`

**8b. Event Listing (`/whats-on`)**
- Events with `bookings_enabled = false` still appear in the listing
- `EventBookingButton` component: when `bookingBlockReason === 'bookings_disabled'`, render "No booking required" or hide the button

**8c. Event Detail Page (`/events/[id]`)**
- All 4 booking CTA locations (hero ~line 330, mobile sidebar ~line 433, desktop sidebar ~line 478, bottom ~line 745) already gate on `bookingBlockReason` — adding the new reason flows through
- When `bookings_disabled`: hide `ManagementEventBookingForm`, show "This event doesn't require booking — just turn up on the night"
- Also handle the Mother's Day special branch (~line 302) if it bypasses the normal gate

**8d. Event Booking API** (`app/api/event-bookings/route.ts` POST):
- Server-side guard: before proxying to management API, fetch event and check `bookings_enabled`
- Return customer-facing error: `{ error: 'bookings_disabled', message: 'Bookings are not currently available for this event.' }` with 409 status

**8e. Availability Check** (`app/api/events/[id]/availability/route.ts`):
- When `bookings_enabled = false`, return `{ available: false, reason: 'bookings_disabled' }`
- Update `EventAvailability` component (`components/EventAvailability.tsx`) to handle this reason (not show it as "sold out")

**8f. Event Waitlist API** (`app/api/event-waitlist/route.ts`):
- Reject waitlist entries when `bookings_enabled = false`

### 9. What Doesn't Change

- Events with either toggle off still appear in the management tool calendar/list
- Staff can still view, edit, and manually create bookings for the event internally
- `promo_sms_enabled` has no effect on the public site (backend-only concern)
- Existing bookings are not cancelled when `bookings_enabled` is toggled off — only new bookings are blocked
- Transactional SMS (booking confirmations, cancellation notifications, hold expiry) always sends
- Manual bulk messages by staff always send regardless of `promo_sms_enabled`
- The existing `booking_open` flag continues to work as before — `bookings_enabled` is an additional admin override

## Key Files

### OJ-AnchorManagementTools
| File | Change |
|------|--------|
| `supabase/migrations/[new]` | Add columns to events + event_categories, update create/update transaction functions, update booking/waitlist RPCs |
| `src/types/event.ts` | Add `promo_sms_enabled`, `bookings_enabled` to Event and EventFormData |
| `src/types/event-categories.ts` | Add `default_promo_sms_enabled`, `default_bookings_enabled` to EventCategory |
| `src/types/database.ts` | Mirror new fields if needed |
| `src/components/features/events/EventFormGrouped.tsx` | Add toggle UI, pre-fill from category defaults in `handleCategoryChange` |
| `src/components/features/events/EventCategoryFormGrouped.tsx` | Add default toggle fields to category form |
| `src/app/actions/events.ts` | Add fields to `prepareEventDataFromFormData`, Zod schema, create/update actions |
| `src/app/actions/event-categories.ts` | Persist new category default fields |
| `src/services/events.ts` | Add fields to event schema, RPC payload builder |
| `src/services/event-categories.ts` | Add fields to category update service |
| `src/services/event-bookings.ts` | Booking creation service (RPC handles guard) |
| `src/app/api/events/route.ts` | Add `bookings_enabled` to response projection; tighten `select('*')` |
| `src/app/api/events/[id]/route.ts` | Add `bookings_enabled` to response projection |
| `src/lib/api/schema.ts` | Add `bookings_enabled` to `eventToSchema()` |
| `src/app/api/cron/event-guest-engagement/route.ts` | Filter by `promo_sms_enabled` on all SMS queries |
| `src/app/api/cron/event-waitlist-offers/route.ts` | Check both `promo_sms_enabled` and `bookings_enabled` |
| `src/lib/events/waitlist-offers.ts` | Check both flags in offer creation/send |
| `src/app/api/event-bookings/route.ts` | Add `bookings_enabled` to select, guard with 409 |
| `src/app/(authenticated)/events/[id]/EventDetailClient.tsx` | Display toggle state; staff booking bypasses `bookings_enabled` |

### OJ-The-Anchor.pub
| File | Change |
|------|--------|
| `lib/api/events.ts` | Add `bookings_enabled` to Event type |
| `lib/event-lifecycle.ts` | Add `'bookings_disabled'` to `getEventBookingBlockReason()` |
| `components/EventBookingButton.tsx` | Handle `bookings_disabled` block reason |
| `components/EventAvailability.tsx` | Handle `bookings_disabled` (not show as sold out) |
| `app/events/[id]/page.tsx` | Hide booking CTAs and form (flows through block reason) |
| `app/api/event-bookings/route.ts` | Server-side booking guard with customer-facing error |
| `app/api/events/[id]/availability/route.ts` | Return `bookings_disabled` reason |
| `app/api/event-waitlist/route.ts` | Reject waitlist entries when bookings disabled |

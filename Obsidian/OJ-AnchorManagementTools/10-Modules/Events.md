---
title: Events
aliases:
  - Public Events
  - Gigs
  - Event Management
tags:
  - type/reference
  - module/events
  - status/active
module: events
route: /events
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Events

The Events module manages all public-facing events hosted at The Anchor — gigs, performances, quiz nights, themed evenings, and other special nights. Events are the primary driver of [[Table Bookings]] and are promoted via [[Short Links]] and SEO-optimised public pages.

---

## Route & Access

| Property | Value |
|---|---|
| Route | `/events` |
| Public event detail page | `/m/[slug]` |
| Auth | Required for management; public detail pages are unauthenticated |

### Permissions

| Permission | Description |
|---|---|
| `events.view` | View event list and details |
| `events.create` | Create new events |
| `events.edit` | Edit existing events |
| `events.delete` | Delete events |
| `events.publish` | Publish or unpublish events to the public page |

---

## Key Features

### Event Details
- Title, description, and rich text content
- Date, time, and duration
- Venue space assignment (links to [[Settings]] for space configuration)
- Event category — categories are managed in [[Settings]]
- Performer name, bio, and external booking/website URL

### Media
- Hero image upload (stored in Supabase storage)
- Video embed URL (YouTube / Vimeo)
- Gallery images (optional)

### SEO Fields
Every event has a dedicated set of SEO fields for the public detail page:

| Field | Purpose |
|---|---|
| `slug` | URL-safe identifier — used in `/m/[slug]` |
| `meta_description` | 160-character page meta description |
| `keywords` | Comma-separated keyword list |

> [!TIP]
> Slugs must be unique. The system auto-generates a slug from the event title, but staff can customise it. Changing a slug after publishing breaks any existing shared links — use [[Short Links]] for sharing to insulate against slug changes.

### Pricing Models

| Model | Description |
|---|---|
| Free | No charge, no deposit required |
| Ticketed | Fixed ticket price per person |
| Deposit | Deposit required to hold a table (see [[Deposits & Payments]]) |

### FAQs
Events support an optional FAQ section displayed on the public detail page. FAQs are stored as structured JSON (question/answer pairs).

### Publish Control
Events can be toggled between published and unpublished states without deleting them. Only published events appear on public-facing pages.

---

## Public Event Pages

The public-facing event detail page is served at `/m/[slug]`:

- **SEO-optimised**: uses `meta_description`, `keywords`, and Open Graph tags
- **Unauthenticated**: no login required for public visitors
- **Table booking CTA**: links to the public table booking form (`/table-booking`) pre-filtered for this event
- Rendered as a Next.js dynamic route with ISR (Incremental Static Regeneration) where appropriate

> [!NOTE]
> The `/m/` prefix stands for "marketing" pages — a separate route group from the authenticated staff portal. These pages are intentionally lightweight and SEO-focused.

---

## Database

| Table | Purpose |
|---|---|
| `events` | Core event records |
| `event_categories` | Taxonomy of event types (managed in [[Settings]]) |

---

## TypeScript Types

- **File**: `src/types/event.ts`
- **Key types**:
  - `Event` — full event record
  - `EventCategory` — category taxonomy
  - `PerformerSubmission` — performer details and contact info

---

## Architecture Notes

- Events have no direct integration with Twilio or email — SMS for event-related communications flows through [[Private Bookings]] and [[Table Bookings]]
- The `events.publish` permission is intentionally separate from `events.edit` to allow staff to draft events without accidentally publishing them
- Event categories are a shared lookup table managed by admins in [[Settings]] — avoid hardcoding category values in application code

> [!WARNING]
> Deleting an event that has associated [[Table Bookings]] must be handled carefully — the booking records reference the event by foreign key. Soft-delete (unpublish) is preferred over hard delete for any event with existing bookings.

---

## Related

- [[Modules MOC]] — full module list
- [[Table Bookings]] — reservations linked to specific events
- [[Short Links]] — share event URLs without exposing slugs directly
- [[Settings]] — event category management and venue space configuration
- [[Performers]] — performer records and submission handling
- [[Private Bookings]] — full-service event packages (separate from public events)
- [[Event Model]] — database schema and type reference
- [[Dashboard]] — upcoming events summary

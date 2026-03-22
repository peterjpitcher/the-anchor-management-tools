---
title: Event Model
aliases:
  - events table
  - Event
tags:
  - type/reference
  - section/data-models
  - status/active
created: 2026-03-14
updated: 2026-03-14
table: events
typescript: src/types/event.ts
---

← [[Data Models MOC]]

# Event Model

The `events` table stores all events hosted at The Anchor, from live music nights to quiz events and private functions. Events drive the public-facing `/m/[slug]` event pages as well as internal scheduling across several modules.

## Table: `events`

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key |
| `title` | text | Display name of the event |
| `slug` | text | Unique; used for SEO URLs at `/m/[slug]` |
| `description` | text | Public-facing description |
| `date` | date | Event date |
| `start_time` | time | Event start time |
| `end_time` | time | Event end time |
| `status` | text | `draft` \| `published` \| `cancelled` |
| `event_category_id` | uuid | FK → event categories |
| `pricing_model` | text | `free` \| `ticketed` \| `deposit` |
| `ticket_price` | numeric | Ticket price (if ticketed) |
| `max_capacity` | int | Maximum guest capacity |
| `performer_name` | text | Name of performer or act |
| `booking_url` | text | External booking link (if applicable) |
| `image_url` | text | Event image |
| `meta_description` | text | SEO meta description |
| `meta_keywords` | text | SEO meta keywords |
| `is_featured` | bool | Whether the event appears in featured listings |
| `created_at` | timestamptz | Auto-set on insert |
| `updated_at` | timestamptz | Auto-updated on change |

## Status Lifecycle

```
draft → published → cancelled
         ↑
    (re-publishable)
```

- **draft**: Not visible publicly; being prepared by staff
- **published**: Live on the public event page `/m/[slug]`
- **cancelled**: Event will not go ahead; page can display cancellation notice

## SEO Fields

The `slug`, `meta_description`, and `meta_keywords` fields power the public event detail page at `/m/[slug]`.

> [!NOTE] Slug Uniqueness
> The `slug` column has a unique constraint. Changing a slug after publishing will break any external links — treat published slugs as permanent.

## Related TypeScript Types

- `Event` — main type mapping to this table
- `EventCategory` — the category record referenced by `event_category_id`
- `PerformerSubmission` — performer applications associated with events

## Used By

- [[Events]] — primary management UI for creating, editing, and publishing events
- [[Table Bookings]] — events can be linked to table booking contexts
- [[Private Bookings]] — events can be the basis of a private hire
- [[Menu Management]] — event-specific menus can be attached
- [[Parking]] — parking notification reminders reference event dates

## Related

- [[Data Models MOC]]
- [[Customer Model]]
- [[Private Booking Model]]
- [[Events]]
- [[Table Bookings]]
- [[Menu Management]]
- [[Parking]]

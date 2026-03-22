---
title: Short Links
aliases:
  - URL Shortener
  - Guest Links
  - Short URLs
tags:
  - type/reference
  - module/short-links
  - status/active
module: short-links
route: /short-links
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Short Links

The Short Links module provides a URL shortener for SMS campaigns and marketing links. Short links keep SMS messages concise while directing recipients to booking pages, event details, or other system URLs. Per-link click analytics are available.

---

## Permissions

| Permission | Description |
|---|---|
| `short_links.view` | View all short links and their analytics |
| `short_links.create` | Create new short links |
| `short_links.edit` | Update destination URLs and metadata |
| `short_links.delete` | Remove short links |

---

## Routes

| Route | Auth | Description |
|---|---|---|
| `/short-links` | Required | Staff management view — create and monitor links |
| `/g/[token]` | None (public) | Guest-facing redirect — public access |
| `/r/[token]` | None (public) | Internal/staff redirect — public access |

> [!NOTE]
> Both `/g/` and `/r/` are listed as public path prefixes in the auth middleware. No login is required to follow a short link — the token itself provides the access control for the destination.

---

## Token Types

| Prefix | Purpose |
|---|---|
| `/g/[token]` | Guest links — used in customer-facing SMS and marketing messages |
| `/r/[token]` | Internal/staff links — used in operational messages where a shorter URL is still useful |

> [!TIP]
> When embedding a short link in an SMS campaign via [[Messages & SMS]], prefer `/g/` tokens for all customer-facing messages. This makes it easier to segment click analytics by audience.

---

## Key Features

### Link Creation

Any URL on the platform (booking pages, event pages, parking kiosk, table booking flow) can be shortened. Staff provide the destination URL and an optional label for internal reference.

### Click Analytics

Each short link records click events. The management view shows total clicks, unique clicks, and a time-series breakdown per link.

### SMS Integration

Short links are created primarily for inclusion in [[Messages & SMS]] campaigns. The SMS composer can look up and insert short links directly.

---

## Business Rules

> [!WARNING]
> Short link tokens are not secret — anyone with the token can access the destination. Do not use short links to gate access to sensitive information. For protected resources, use proper auth flows.

---

## Database Tables

| Table | Purpose |
|---|---|
| `short_links` | Short link records: token, destination URL, label, click count |

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/services/short-links.ts` | Business logic service layer — creation, resolution, click recording |

---

## Related

- [[Modules MOC]]
- [[Messages & SMS]]
- [[Events]]
- [[Table Bookings]]
- [[Private Bookings]]

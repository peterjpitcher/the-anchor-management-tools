---
title: Performers
aliases:
  - Entertainment
  - Performer Submissions
  - Acts
tags:
  - type/reference
  - module/performers
  - status/active
module: performers
route: /performers
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Performers

The Performers module manages entertainment submissions and bookings for The Anchor. It provides a workflow for receiving performer applications, reviewing them, and linking accepted performers to events.

---

## Permissions

| Permission | Description |
|---|---|
| `performers.view` | View performer submissions and profiles |
| `performers.create` | Create performer records manually |
| `performers.edit` | Update submission details, status, and notes |
| `performers.delete` | Remove performer records |

---

## Key Features

### Submission Management

Performer submissions are reviewed through a status workflow:

| Status | Description |
|---|---|
| New | Submission received, not yet reviewed |
| Reviewing | Under active consideration |
| Accepted | Performer approved for booking |
| Rejected | Submission declined |

### Performer Profile

Each performer record captures:

| Field | Description |
|---|---|
| Name / Act name | Stage name or band name |
| Contact info | Email and phone for booking enquiries |
| Genre | Musical style or entertainment type |
| Set length | Typical or required set duration |
| Fee | Requested or agreed performance fee |
| Internal notes | Staff-only notes on the performer |

### Event Linking

Accepted performers can be tagged to specific events, creating a record of which act is booked for which night.

> [!TIP]
> When a performer is linked to an event, their details become visible in the [[Events]] detail view, giving staff a single place to see all entertainment for a given night.

---

## Business Rules

> [!NOTE]
> Performer submissions may arrive via an external intake form or be entered manually by staff. The source of the submission should be noted in the internal notes field.

> [!WARNING]
> Fee information is for internal reference only. Do not share fee data with other performers or in any customer-facing context.

---

## Related

- [[Modules MOC]]
- [[Events]]

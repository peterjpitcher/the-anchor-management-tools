---
title: Menu Management
aliases:
  - Menus
  - Event Menus
  - Catering Menus
tags:
  - type/reference
  - module/menu-management
  - status/active
module: menu-management
route: /menu-management
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Menu Management

The Menu Management module allows staff to create and maintain per-event menus — defining menu items, prices, and dietary information. Menus are assigned to events and optionally linked to private bookings. Budget targets can be tracked against actual spend per event.

---

## Permissions

| Permission | Description |
|---|---|
| `menu_management.view` | View menus and menu items |
| `menu_management.create` | Create new menus and items |
| `menu_management.edit` | Update menu item details |
| `menu_management.delete` | Remove menus or items |

---

## Key Features

### Menu Item Configuration

Each menu item records:

| Field | Description |
|---|---|
| Name | Display name of the dish or drink |
| Description | Optional description for guests |
| Price | Per-item price |
| Dietary flags | Vegetarian, vegan, gluten-free, dairy-free, nut-free, etc. |

### Event Assignment

Menus are assigned to specific events, making them available for selection during event setup and private booking configuration.

### Budget Target Tracking

Each event menu can have a target spend. The system tracks actual spend against that target, surfacing over- and under-budget items for review.

> [!TIP]
> Budget targets are configured in [[Settings]] under Menu Targets. The per-event budget is compared against the sum of item costs multiplied by expected covers.

---

## Relationship to Catering Packages

> [!NOTE]
> Menu Management and catering packages serve different purposes:
>
> - **Menu Management** (`/menu-management`) handles the per-event item-level menu — what dishes are on offer, what they cost, and dietary flags.
> - **Catering Packages** (configured in [[Settings]]) are reusable templates that define the overall catering offer — pricing model, serving style, minimum guests. Packages are selected during booking; menus fill in the detail.

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/services/menu.ts` | Business logic service layer |

---

## Related

- [[Modules MOC]]
- [[Events]]
- [[Private Bookings]]
- [[Settings]]

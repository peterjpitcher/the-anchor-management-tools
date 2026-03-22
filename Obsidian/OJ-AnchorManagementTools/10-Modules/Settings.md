---
title: Settings
aliases:
  - System Settings
  - Configuration
  - Admin Settings
tags:
  - type/reference
  - module/settings
  - status/active
module: settings
route: /settings
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Settings

Settings is the system-wide configuration hub for Anchor Management Tools. It is divided into sub-sections, each governing a distinct area of platform behaviour. Access is restricted to users with manager or super-admin roles.

---

## Permissions

| Permission | Description |
|---|---|
| `settings.view` | View all settings sections |
| `settings.manage` | Edit any settings section |

> [!WARNING]
> Settings changes affect platform-wide behaviour. Changes to business hours, deposit thresholds, or pay bands take effect immediately. Test in staging if available before applying to production.

---

## Sub-sections

### Business Hours

Defines the venue's opening times per day of the week. Used by the table booking engine and calendar to determine availability windows. Includes configuration for bank holidays and ad-hoc closures.

- Service: `src/services/business-hours.ts`
- TypeScript: `src/types/business-hours.ts`

### Calendar Notes

Special labels attached to specific dates and shown on booking calendars (e.g. "Sold Out", "Unavailable", "Private Event"). Allows staff to communicate capacity constraints without blocking the date entirely.

### Event Categories

The tag taxonomy applied to events. Categories such as Live Music, DJ Night, Quiz, Karaoke, and Private Hire allow filtering and reporting across the events module.

See [[Events]] for how categories are applied.

### Table Booking Settings

Controls auto-confirmation rules and deposit thresholds for table bookings. Configures the party-size threshold above which a deposit is required (£10 per person for groups of 7 or more).

> [!DANGER]
> The deposit rule is £10 per person for groups of 7 or more. This is a direct charge — not a credit card hold. Any code or template referencing "credit card hold" language is a bug and must be corrected.

See [[Table Bookings]] for the deposit workflow.

### Catering Packages

Reusable catering package templates that staff can assign to events and private bookings. Each package defines the overall catering offer rather than individual menu items (see [[Menu Management]] for per-item menus).

Each `CateringPackage` record contains:

| Field | Description |
|---|---|
| `name` | Display name of the package (e.g. "Buffet for 20") |
| `pricing_model` | How the package is priced: `per_head` or `flat` |
| `minimum_guests` | Minimum party size for this package to apply |
| `serving_style` | One of: `buffet`, `sit_down`, `canapes`, `drinks`, `pizza` |
| `description` | Free-text description shown to customers |

- TypeScript: `src/types/catering.ts`

> [!NOTE]
> Catering packages are templates. The actual menu items for a specific event are configured in [[Menu Management]].

### Menu Targets

Budget targets per event type. Used by [[Menu Management]] to track actual spend against planned cost per event.

### Pay Bands

Employee pay rate bands used by the payroll module. Each band defines a name and hourly rate range.

See [[Employees]] for how pay bands are assigned to staff members.

### Message Templates

Reusable SMS template text for common communications (e.g. booking confirmations, parking reminders). Templates can include merge fields for personalisation.

See [[Messages & SMS]] for how templates are used in campaigns.

### API Keys

Management interface for third-party API key configuration. Displays connection status for integrated services.

### Audit Logs

Read-only view of all recorded audit events across the platform. Every create, update, and delete operation in server actions writes an audit record. Filterable by user, resource type, and date range.

> [!TIP]
> The audit log is the first place to check when investigating unexpected data changes. Every mutation in the system is traceable to a specific user and timestamp.

### GDPR

Data export tools for subject access requests. Allows export of all data held for a specific customer record.

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/services/business-hours.ts` | Business hours CRUD and availability calculation (25KB) |
| `src/types/business-hours.ts` | TypeScript types for business hours configuration |
| `src/types/catering.ts` | TypeScript types for `CateringPackage` |

---

## Related

- [[Modules MOC]]
- [[Events]]
- [[Rota]]
- [[Messages & SMS]]
- [[Employees]]
- [[RBAC & Permissions]]
- [[Table Bookings]]
- [[Private Bookings]]
- [[Menu Management]]

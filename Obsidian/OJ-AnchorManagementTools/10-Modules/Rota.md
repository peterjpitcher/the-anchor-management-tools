---
title: Rota
aliases:
  - Shift Scheduling
  - Timeclock
  - Payroll
  - Leave Management
tags:
  - type/reference
  - module/rota
  - status/active
module: rota
route: /rota
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# Rota

Shift scheduling, timeclock, payroll processing, and leave management for The Anchor. The Rota module spans multiple route groups — including a public kiosk route for employee clock-in/out that requires no authentication.

---

## Routes

### Staff-Facing (Authenticated)

| Route | Purpose |
|---|---|
| `/rota` | Main shift calendar (week/month view) |
| `/rota/leave` | Leave request management |
| `/rota/timeclock` | Admin view of clock-in/out records |
| `/rota/dashboard` | Labour cost overview |
| `/rota/payroll` | Payroll processing |
| `/rota/templates` | Rota templates for recurring schedules |

### Public Kiosk (No Auth Required)

| Route | Purpose |
|---|---|
| `/timeclock` | Employee clock-in/out kiosk |

> [!NOTE]
> `/timeclock` is in the `(timeclock)` route group, which is explicitly excluded from the authentication gate. It is a public-facing kiosk designed for use on a dedicated device in the venue.

### Staff Portal (Read-Only)

| Route | Purpose |
|---|---|
| `/portal/shifts` | Staff view of their own upcoming shifts |

---

## Permissions

| Permission | Description |
|---|---|
| `rota.view` | View the shift calendar |
| `rota.create` | Add shifts to the rota |
| `rota.edit` | Modify existing shifts |
| `rota.manage` | Full rota management (approve, publish, close) |
| `timeclock.clock` | Clock in or out via the kiosk |
| `payroll.view` | View payroll data and reports |
| `leave.view` | View leave requests |
| `leave.submit` | Submit a leave request (staff) |
| `leave.approve` | Approve or reject leave requests (manager) |

---

## Sub-Modules

### Shift Calendar
Visual week and month view of all scheduled shifts. Supports drag-and-drop assignment of employees to shifts.

- Published rotas visible to staff via `/portal/shifts`
- Unpublished rotas visible to managers only
- Shifts linked to employees from [[Employees]]

### Leave Management
Workflow for requesting and approving annual leave, sick leave, and other absence types.

```
Staff submits request → Manager reviews → Approved/Rejected → Reflected in rota
```

- Leave requests visible in the rota calendar once approved
- Rejected requests returned with optional reason

### Timeclock
Admin-side view of all clock-in/out records. Used to verify actual vs scheduled hours.

- Records created via the public `/timeclock` kiosk
- Discrepancies flagged for manager review
- Data feeds into payroll hour calculations

### Labour Cost Dashboard
Overview of scheduled labour cost vs budget for the current period.

- Aggregated by week/month
- Cost calculated from pay bands and scheduled hours

### Payroll Processing
Calculates pay for each employee based on:

- Scheduled and clocked hours
- Configured pay bands
- Leave taken

> [!WARNING]
> Payroll data is sensitive. Access is controlled by `payroll.view` and should be restricted to managers and above.

### Rota Templates
Reusable shift patterns for recurring weekly schedules. Allows managers to generate a new rota from a saved template rather than building from scratch each week.

---

## Publish & Email Notifications

When a rota week is published (or re-published), staff receive email notifications about their shifts. The behaviour differs depending on whether the week is being published for the first time or updated.

### Initial Publish

Sends each employee a full schedule email for the week — every shift they are assigned, plus any open shifts available to claim.

- Template: `buildStaffRotaEmailHtml`
- Email type logged: `staff_rota`
- Only employees with at least one assigned shift and a valid email address receive a message

### Re-publish (After Changes)

If a week is already in `published` status and is re-published, only employees whose shifts actually changed receive an email. Staff with no changes are skipped entirely.

- Template: `buildRotaChangeEmailHtml`
- Email type logged: `staff_rota_change`
- The email shows a **changes section** (colour-coded: added in green, removed in red with strikethrough, modified in amber with before→after) followed by the employee's **full schedule for the week**
- Changes are detected by diffing the previous published snapshot against the new one, matching shifts by their `id` (preserved from `rota_shifts` to `rota_published_shifts` at publish time)
- Three change types: `added` (new shift in this publish), `removed` (shift deleted since last publish), `modified` (same ID but different date, time, or department)

### Source Files

| File | Purpose |
|---|---|
| `src/lib/rota/send-rota-emails.ts` | `sendRotaWeekEmails()` (initial) and `sendRotaWeekChangeEmails()` (re-publish) |
| `src/lib/rota/email-templates.ts` | `buildStaffRotaEmailHtml()` and `buildRotaChangeEmailHtml()` |
| `src/app/actions/rota.ts` | `publishRotaWeek()` server action — routes to the correct sender |

> [!NOTE]
> Both email functions fire as void (fire-and-forget) and do not block the publish operation returning to the caller. Failures are logged to `rota_email_log` but do not surface to the user.

---

## Cron Jobs

| Job | Schedule | Purpose |
|---|---|---|
| `rota-auto-close` | `0 5 * * *` | Automatically close completed rotas |
| `rota-manager-alert` | `0 18 * * 0` | Weekly summary email to managers |
| `rota-staff-email` | `0 21 * * 0` | Weekly schedule email to all staff (uses `sendRotaWeekEmails`) |

> [!TIP]
> Cron endpoints live at `/api/cron/` and require `Authorization: Bearer CRON_SECRET`. See [[Cron Jobs]] for details on how crons are configured.

Weekly emails are sent via [[Microsoft Graph]]. See [[Microsoft Graph]] for authentication and sending configuration.

---

## Integrations

| Integration | Purpose |
|---|---|
| [[Microsoft Graph]] | Weekly manager summary and staff schedule emails |
| [[Employees]] | Shift assignment and payroll data source |

---

## Related

- [[Modules MOC]]
- [[Employees]]
- [[Employee Lifecycle]]
- [[Cron Jobs]]
- [[Microsoft Graph]]
- [[Payroll]]

---
title: OJ Projects
aliases:
  - Time Tracking
  - Internal Projects
  - Project Time Entries
tags:
  - type/reference
  - module/oj-projects
  - status/active
module: oj-projects
route: /oj-projects
created: 2026-03-14
updated: 2026-03-14
---

← [[Modules MOC]]

# OJ Projects

OJ Projects is an internal time-tracking module for logging operational work against clients, projects, and work types. It is used by Orange Jelly staff to record billable and non-billable time. It is not customer-facing.

---

## Permissions

| Permission | Description |
|---|---|
| `oj_projects.view` | View time entries, projects, clients, and work types |
| `oj_projects.create` | Log new time entries and create projects/clients |
| `oj_projects.edit` | Update existing entries and project details |
| `oj_projects.delete` | Remove entries, projects, or clients |

---

## Routes

| Route | Description |
|---|---|
| `/oj-projects` | Time entries list — the primary view |
| `/oj-projects/projects` | Project management — create and manage projects |
| `/oj-projects/clients` | Client management — create and manage clients |
| `/oj-projects/work-types` | Work type categories — define billable work categories |

---

## Key Features

### Time Entry Logging

Each time entry records:

| Field | Description |
|---|---|
| Client | The client the work was performed for |
| Project | The specific project under that client |
| Work type | The category of work performed (e.g. Development, Consulting, Admin) |
| Duration | Time spent — recorded as a duration value, not a start/end time pair |
| Date | The date the work was performed |
| Notes | Optional description of the work done |

> [!NOTE]
> Start time was removed from time entries in commit `72ea4fb7`. Only duration is recorded. Historical entries that previously held a start time retain that data but it is no longer displayed or editable.

### Billing and Costing Reports

Entries can be filtered and summarised by client, project, work type, and date range for billing and cost analysis purposes.

### Work Types

Work types act as a taxonomy for categorising effort. They allow reports to break down time by the nature of the work (e.g. separating client-billable development from internal admin).

---

## Business Rules

> [!NOTE]
> This module is for internal Orange Jelly operational use only. It does not expose data to The Anchor customers or guests.

---

## Database Tables

| Table | Purpose |
|---|---|
| `oj_project_clients` | Client records |
| `oj_project_work_types` | Work type category definitions |
| `oj_project_entries` | Individual time entry records |

---

## Code Locations

| Path | Purpose |
|---|---|
| `src/types/oj-projects.ts` | TypeScript types: `Project`, `Client`, `WorkType`, `TimeEntry` |

---

## Related

- [[Modules MOC]]
- [[Invoices]]

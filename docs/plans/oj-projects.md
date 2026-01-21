# OJ Projects — PRD

Status: Draft (ready for sign-off)
Owner: Peter
Last updated: 2026-01-20

## Summary
Add a new authenticated module (“OJ Projects”) to manage client projects, log time and mileage, and automatically invoice clients monthly with a clear breakdown of work (including work types like consulting/development/photography).

This module must integrate with the existing Invoicing system (vendors, invoices, email sending) and run fully automated monthly billing on the 1st.

## Goals
### What success looks like
- Peter can create/manage projects per client (vendor) with a project code, project name, and brief.
- Peter can quickly add time entries (any date, including past) with start/end times and automatic duration calculation.
- Time is billed in **15-minute blocks**, always **rounded up**.
- Peter can add mileage entries billed at **£0.42/mile** with **0% VAT**.
- Peter can tag entries with a **work type** (picklist) so invoices show work-type totals in the notes.
- Peter can see month-to-date totals and what’s unbilled/billed/paid.
- On the 1st of each month, invoices are automatically created + emailed to the client, with:
  - **One invoice line per project** (aggregated hours)
  - **Recurring charges** added to every invoice (e.g., hosting)
  - **One mileage line** for the month (total miles)
  - Invoice notes containing a full breakdown (by project → by work type → by entry)
- Three days before and one day before the 1st, an email reminder is sent to `peter@orangejelly.co.uk` to review timesheets ahead of billing.
- Once invoices are sent, included entries are marked `billed`; once invoices are paid in full, linked entries are marked `paid`.

## Non-goals (MVP)
- Multi-user time tracking (only Peter uses it).
- Retroactively editing already-billed entries (handled via new adjustment entries or next-month billing).
- Partial payments being allocated to entries (entries remain `billed` until invoice is paid in full).

## Discovery notes (existing system)
- Invoicing exists with `invoice_vendors`, `invoices`, `invoice_line_items`, `invoice_payments`, and server actions/services.
- Invoices/quotes can be emailed via Microsoft Graph.
- Cron routes already exist for recurring invoices and auto-sending draft invoices by `invoice_date`.
- RBAC/RLS patterns exist using `user_has_permission(...)`.

## Core Concepts
### Clients
- Reuse existing **Invoice Vendors** (`invoice_vendors`) as the client list.
- OJ Projects must let Peter manage vendors from either module (Invoices or OJ Projects) without duplication.

### Contacts & invoice recipients
- Contacts are managed on vendors and are internal-only for tagging and project context.
- The invoice “To” address uses the vendor email(s) configured in the Invoices section.
- Add a per-contact checkbox to mark “Receive invoice copy” (CC) so Peter can include extra recipients without encoding them in the vendor email string.

### Projects
Each project belongs to one vendor and includes:
- `project_code`: auto-generated, **non-sequential**, includes a client abbreviation (e.g., `OJP-ABC-4F7K2`).
- `project_name`, `brief`
- `internal_notes` (never client-facing)
- `deadline` (optional)
- `budget_ex_vat` (optional) and remaining-to-bill view (ex VAT)
- tagged contacts (internal-only)

### Entries (time + mileage)
Peter can add:
- **Time entries**: date, start time, end time (crossing midnight allowed), description, internal notes, work type, billable flag.
- **Mileage entries**: date, miles, description, internal notes, billable flag.

Entry lifecycle:
- `unbilled` → `billed` (linked to invoice) → `paid` (only when invoice paid in full).
- Only `unbilled` entries are editable/deletable.

## Billing Modes (per client)
Every client is configured as one of:

Note: “Retainer included hours” is an **internal target** for alerting/reporting only. It does not change the billing calculation in MVP (billing is driven only by Pay in full vs Monthly cap, plus recurring charges and mileage).

### 1) Pay in full (default)
- Bill all eligible unbilled entries (previous calendar month) plus recurring charges and mileage.

### 2) Monthly cap (carry-forward)
Used for clients who pay **up to £X/month** with overflow deferred:
- The cap is **inclusive of VAT** and applies to **all charges** (time, mileage, and recurring charges).
- Example: if the month’s total is £800 (inc VAT), invoice £500 (inc VAT) this month, and bill the remaining £300 (inc VAT) next month.
- If invoices hit the cap, the remainder stays `unbilled` and carries forward into future billing runs.
- Invoice notes must include a **carried-forward summary** (what remains unbilled and will be billed later).

Allocation rule (deterministic):
- Billing selection happens at the **entry/charge level**, then the billed selection is **aggregated into one invoice line per project**.
- Prioritize items for billing in this order:
  1) Recurring charges for the period
  2) Mileage for the period
  3) Time entries FIFO (oldest unbilled first)
- MVP rule: time entries are **indivisible** (an entry is either billed this run or carried forward). This can leave some cap headroom unused.
- MVP rule: recurring charges and mileage are also treated as indivisible items; if an item would breach the cap, it is carried forward and billing continues with later eligible items only if they fit the remaining headroom.
- Phase 2 option: allow splitting the final time entry (in 15-minute blocks) or prorating a recurring charge to use cap headroom precisely.

## Recurring Charges
Per vendor, Peter can configure recurring charges (e.g., hosting):
- Description, amount (ex VAT), VAT rate, active flag
- Included in every monthly invoice for that vendor
- Count toward the monthly cap (if vendor is on cap mode)

## Work Types (picklist)
Peter manages a list of work types (e.g., Consulting, Development, Photography).
- Time entries require a work type (or allow “Unspecified”).
- Invoice notes include totals by work type per project and for the invoice overall.

## Invoice generation (monthly)
### Definitions (periods, timezone, cut-offs)
- All date grouping and “month boundaries” are defined in **Europe/London**.
- Each billing run is keyed by a `period_end` date (last day of the previous calendar month in London time).
- Reporting views may focus on “work performed in month X”, but billing must be resilient to late entry and carry-forward.

### Schedule
- **Reminder emails**: T-3 days and T-1 day before the 1st, to `peter@orangejelly.co.uk`.
- **Billing run**: on the **1st of each month** for the **previous calendar month**.

### Eligibility rules
- Only `unbilled` + `billable` entries are eligible.
- Eligibility for a billing run is: **all eligible entries with `entry_date <= period_end`** (regardless of how old they are).
  - This avoids “stranded” entries and supports cap carry-forward.
  - It also matches the rule: if an entry for last month is created after the 1st, it will be picked up on the next billing run (because `period_end` advances).

### Invoice structure
- Line items:
  - One line per project: total billed hours × hourly rate (vendor-specific, default £75/hr ex VAT).
  - Recurring charges: one line per charge.
  - Mileage: one line with total miles × £0.42, VAT 0%.
- Notes:
  - Detailed breakdown of billed work:
    - Grouped by project
    - Work-type totals
    - Itemised time entries (date, start–end, rounded duration, work type, description)
    - Itemised mileage entries (date, miles, description)
  - For cap clients: include “carried forward / not billed yet” totals.

### Post-send effects
- On successful send:
  - invoice status set to `sent`
  - linked entries set to `billed` with `invoice_id`
- When invoice becomes `paid`:
  - linked entries updated to `paid` (only when invoice paid in full)

## UI Requirements (MVP)
### OJ Projects dashboard
- Month selector
- Month-to-date totals:
  - Hours logged, unbilled value, billed value, paid value
  - Cap usage (for cap vendors) and warnings when nearing/exceeding
  - Retainer included-hours warning (UI-only; no rollover)

### Vendor (client) settings
- Hourly rate ex VAT (default 75), VAT rate, mileage rate (default 0.42)
- Billing mode: pay in full vs monthly cap (cap amount stored **inc VAT**)
- Recurring charges management
- Contacts list with “Receive invoice copy” checkbox

### Projects
- Create/edit project (code auto-generated)
- Internal notes, deadline, tagged contacts
- Budget (ex VAT) and “remaining to bill” view (ex VAT)
- Project-level totals for selected month

### Entries
- Quick add entry modal (time/mileage toggle) optimised for speed
- Entries list with filters (vendor/project/work type/status/date range)
- Edit/delete only unbilled entries

## Edge cases & safeguards
- Time crossing midnight: interpret end as next day when end < start.
- Cross-month time entries (e.g., 31st 23:30 → 1st 00:30): attribute the full entry to the **start date** (no split at midnight in MVP).
- Rounding is applied **per entry** (round up to the next 15-minute block), then summed (do not round at the project level).
- Start time == end time: reject by default (0-minute entries not billable) unless explicitly supported later.
- Overlapping time entries: allow but warn in UI.
- Vendor missing invoice email(s): billing run records an error and does not silently drop invoices.
- Email not configured: billing run records an error; UI shows blockers.
- Duplicate cron executions: use a billing-run lock/idempotency record per vendor+period.
- Cap smaller than recurring charges: treat as a configuration problem (warn prominently and log). In MVP the oversized charge carries forward until the cap is increased (Phase 2: allow prorating a charge to fit the cap).
- VAT rounding consistency: ensure totals match existing invoice calculation logic.
- Invoice send failure after invoice creation: do not mark entries billed; allow retrying send of the same invoice without generating duplicates.
- Invoice void/refund after entries marked paid: treat as admin-only/manual in MVP; prevent voiding invoices that have linked entries unless explicitly overridden (Phase 2: “reopen/unbill” flow).

## Rate/VAT snapshotting (to prevent retroactive billing changes)
- Snapshot `hourly_rate_ex_vat`, `vat_rate`, and `mileage_rate` onto each entry at entry creation (or at latest before it becomes eligible).
- Snapshot the work type display name (or store stable IDs and store the display name used on the invoice in the billing run record) so renames don’t change historical invoices.

## Invoice notes size strategy
- Default: include the full breakdown in invoice notes as specified.
- If notes exceed practical limits (PDF layout/email payload):
  - Include totals + an abbreviated breakdown in notes, and attach a “Timesheet” PDF containing the full details.
  - Notes must clearly state that the full breakdown is attached.

## Acceptance Criteria (MVP)
- Vendors can be managed from OJ Projects and remain the same records used in Invoices.
- Projects can be created with auto project code, brief, internal notes, deadline, and optional budget ex VAT.
- Work types are manageable and selectable on time entries.
- Time and mileage entries can be created for any historical date and are rounded/billed correctly.
- Monthly reminders are sent (T-3 and T-1) to `peter@orangejelly.co.uk`.
- On the 1st, invoices are auto-created and emailed; entries update to `billed`; invoice notes include detailed breakdown and carried-forward summary (cap clients).
- When an invoice is marked paid in full, linked entries become `paid`.

## Acceptance scenarios (high-value)
1) Late entry: create an entry dated last month after the 1st → it is billed on the next billing run (not stranded).
2) Cross-month entry: 31st 23:30 → 1st 00:30 → billed based on the start date, with correct rounding.
3) Cap boundary: recurring + mileage + time entries under a cap → selection respects priority and carried-forward summary is correct.
4) Rate change: change vendor hourly rate before billing → existing unbilled entries use their snapshot rate.
5) Send failure: invoice creation occurs but email send fails → entries remain unbilled; rerun does not create duplicates.
6) Paid in full: invoice part-paid then fully paid → entries only switch to `paid` on full payment.

## Phasing (recommended)
- MVP: projects + time/mileage entry + work types + recurring charges + monthly billing run + reminders.
- Phase 2: richer reporting, “adjustment entries”, project profitability views, and configurable cap allocation priority.

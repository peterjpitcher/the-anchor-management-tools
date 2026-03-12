# Design: Remove Start Time from OJ-Projects Quick Entry

**Date:** 2026-03-12
**Status:** Approved
**Complexity:** M (4 files + 1 migration)

---

## Problem

The quick entry form for time entries in `/oj-projects` requires a start time (HH:MM). The user no longer wants to track when work started — only how many hours were logged on a given date.

## Goal

Remove start time entirely from the time entry flow. Users submit: date, client, project, duration, work type, description, billable flag.

## Out of Scope

- Mileage entries — unchanged
- One-off charge entries — unchanged
- Billing rate calculations — unaffected (already use `duration_minutes_rounded`)
- Historical data — existing entries keep their `start_at`/`end_at` values

---

## Approach

Option A: Relax the DB constraint and store NULL for new time entries. Keep the columns so existing data is preserved. Update all consumers to handle NULL gracefully.

---

## Changes

### 1. Database Migration

- Drop and recreate `chk_oj_entries_time_fields` CHECK constraint
- New constraint allows `start_at`/`end_at` to be NULL for `entry_type = 'time'`
- `start_at` and `end_at` columns remain; no data is deleted

### 2. Server Actions (`src/app/actions/oj-projects/entries.ts`)

- Remove `start_time` field from `TimeEntrySchema` Zod schema
- In `createTimeEntry`: stop computing `start_at`/`end_at`; write both as `NULL`
- In `updateEntry`: same — stop computing timestamps, write NULL for time entries
- Remove overlap detection block from both create and update paths (relies on timestamps)

### 3. Quick Entry Form (`src/app/(authenticated)/oj-projects/page.tsx`)

- Remove `startTime` from form state
- Remove the start time input field from the time entry tab UI
- No other fields change

### 4. Entries List Page (`src/app/(authenticated)/oj-projects/entries/page.tsx`)

- Remove `start_time`/`end_time` fields from the edit modal
- Update table display: replace `HH:MM–HH:MM` with just duration (e.g. `1.50h`)
- `toLondonTimeHm` helper no longer called (can be removed or left in place)

### 5. Invoice Notes (`src/app/api/cron/oj-projects-billing/route.ts`)

- Update `buildInvoiceNotes` to handle NULL `start_at`
- When `start_at` is NULL: format as `YYYY-MM-DD (Xh) [Work Type] Description`
- When `start_at` is present (existing entries): keep current format `YYYY-MM-DD HH:MM–HH:MM (Xh) [Work Type] Description`

---

## Data Flow (After Change)

```
User input: date + duration + client + project
     ↓
createTimeEntry server action
     ↓
DB write: entry_date, duration_minutes_raw, duration_minutes_rounded,
          start_at = NULL, end_at = NULL
     ↓
Billing cron: uses duration_minutes_rounded × rate (unchanged)
Invoice notes: YYYY-MM-DD (Xh) [Work Type] Description
```

---

## Risk & Rollback

- **Risk:** Low. Billing is unaffected. Invoice notes change is backwards-compatible.
- **Rollback:** Revert migration to restore the CHECK constraint. Old entries unaffected. New NULL entries would need start_time re-added if rolled back — acceptable since this is a forward-only simplification.
- **No PII, no auth changes, no breaking API changes.**

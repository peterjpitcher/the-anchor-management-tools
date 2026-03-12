# Design: Remove Start Time from OJ-Projects Quick Entry

**Date:** 2026-03-12
**Status:** Approved
**Complexity:** M (5 files + 1 migration)

---

## Problem

The quick entry form for time entries in `/oj-projects` requires a start time (HH:MM). The user no longer wants to track when work started — only how many hours were logged on a given date.

## Goal

Remove start time entirely from the time entry flow. Users submit: date, client, project, duration, work type, description, billable flag.

## Out of Scope

- Mileage entries — unchanged
- One-off charge entries — unchanged
- Billing rate calculations — unaffected (already use `duration_minutes_rounded`)
- Historical `start_at`/`end_at` values on existing entries — preserved, never overwritten

---

## Approach

Relax the DB CHECK constraint to allow `start_at`/`end_at` to be NULL for time entries. Keep the columns so existing data is preserved. New time entries store NULL. Update all consumers to handle NULL gracefully.

---

## Changes

### 1. Database Migration

Drop and recreate `chk_oj_entries_time_fields` with:

```sql
CHECK (
  -- time entries: duration required; start_at/end_at optional but must be paired
  (entry_type = 'time'
    AND duration_minutes_raw IS NOT NULL
    AND duration_minutes_rounded IS NOT NULL
    AND miles IS NULL
    AND amount_ex_vat_snapshot IS NULL
    AND (start_at IS NULL) = (end_at IS NULL)   -- both set or both NULL, never partial
  )
  OR
  (entry_type = 'mileage'
    AND miles IS NOT NULL
    AND duration_minutes_raw IS NULL
    AND start_at IS NULL
    AND end_at IS NULL
    AND amount_ex_vat_snapshot IS NULL
  )
  OR
  (entry_type = 'one_off'
    AND amount_ex_vat_snapshot IS NOT NULL
    AND duration_minutes_raw IS NULL
    AND start_at IS NULL
    AND end_at IS NULL
    AND miles IS NULL
  )
)
```

The `(start_at IS NULL) = (end_at IS NULL)` clause enforces that the two fields are always paired — both populated or both NULL. Partial population is not a valid DB state.

No data is deleted. Existing rows with populated `start_at`/`end_at` remain valid.

### 2. Server Actions (`src/app/actions/oj-projects/entries.ts`)

**`TimeEntrySchema` (create):**
- Remove `start_time` field entirely

**`UpdateEntrySchema` (update — separate schema):**
- Remove `start_time` field entirely

**`createTimeEntry`:**
- Stop computing `start_at`/`end_at`; write both as `NULL`
- Remove overlap detection block entirely — this is a deliberate product decision. The feature tracked time windows to warn about double-booked slots; since start times are no longer captured, time-window overlap detection is no longer meaningful. The user has accepted the loss of this warning.

**`updateEntry`:**
- Stop accepting or computing `start_time`
- **Preserve existing `start_at`/`end_at` on edit**: read the current row's `start_at` before updating and pass it through unchanged if present. Do not overwrite with NULL.
- If the user edits `entry_date` on a historical entry, the preserved `start_at`/`end_at` will reference a different calendar date — this is intentional and acceptable. The timestamps become informational only and do not affect billing or invoice amounts.
- Remove overlap detection block

### 3. Quick Entry Form (`src/app/(authenticated)/oj-projects/page.tsx`)

- Remove `startTime` from form state
- Remove the start time `<input type="time">` field from the time entry tab UI
- No other fields change

### 4. Entries List Page (`src/app/(authenticated)/oj-projects/entries/page.tsx`)

- Remove `start_time`/`end_time` fields from the edit modal (no longer submitted to server)
- Update table display: replace `HH:MM–HH:MM` column with just duration (e.g. `1.50h`)
- Remove `toLondonTimeHm` helper and its import entirely — do not leave it as dead code (lint enforces zero unused imports)

### 5. Invoice Notes (`src/app/api/cron/oj-projects-billing/route.ts`)

Update `buildInvoiceNotes`. Since `start_at`/`end_at` are always paired (enforced by DB constraint), a single NULL check on `start_at` is sufficient:

- When `start_at` is NULL → `YYYY-MM-DD (Xh) [Work Type] Description`
- When `start_at` is present → `YYYY-MM-DD HH:MM–HH:MM (Xh) [Work Type] Description`

### 6. TypeScript Types (`src/types/oj-projects.ts`)

No changes required. `OJEntry` already types `start_at: string | null` and `end_at: string | null`.

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

## Deployment Order

**Migration must be applied before the new application code is deployed.** Reversed order (new code first, old constraint active) would cause `createTimeEntry` to fail when writing NULL `start_at`/`end_at` against the old constraint. Deploy sequence: run migration → deploy app.

---

## Risk & Rollback

- **Risk:** Low. Billing is unaffected. Invoice notes change is backwards-compatible. Preservation of existing timestamps on edit means no silent historical data loss.
- **Overlap detection loss:** Intentional. Users will no longer see a warning if two time entries cover the same date. Accepted trade-off.
- **Rollback:** The DB migration can be reverted to restore the original CHECK constraint, but only before any new time entries are written. New entries have NULL `start_at`/`end_at` which would violate the restored constraint. After production data exists, a safe rollback requires backfilling `start_at`/`end_at` before re-applying the constraint — treat this as a forward-only change once deployed.
- **No PII, no auth changes, no breaking API changes.**

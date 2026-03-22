# Remove Service Slots Configuration UI

**Date**: 2026-03-22
**Complexity**: XS (3 files touched, 1 deleted)
**Status**: Approved

## Problem

The business hours settings page (`/settings/business-hours`) includes a "Service Slots Configuration" section in both the regular weekly hours modal and the exceptions calendar modal. This section allows staff to define named service windows (lunch, dinner, events) with time ranges, capacity, and booking types.

Nobody has ever used this feature. It adds confusion to the UI without providing value.

## Discovery Summary

A full dependency analysis revealed:

- **`schedule_config` is load-bearing** — the `table_booking_matches_service_window_v05()` PostgreSQL RPC reads it on every booking creation to validate times against service windows.
- **Empty config is safe** — the RPC handles empty/null `schedule_config` gracefully by returning `true` and deferring to pub/kitchen hour validation.
- **Sunday Lunch has its own UI** — `SpecialHoursModal` has dedicated time pickers and a "Sunday Lunch Closed" toggle that are completely independent of `ScheduleConfigEditor`. These write `sunday_lunch` entries into `schedule_config` under the hood.
- **Seeded data exists** — migrations populated `schedule_config` with Sunday Lunch slots (Sunday) and regular service slots (other days). This data has never been modified through the UI.
- **Dead infrastructure exists** — the `service_slots` table, `auto_generate_weekly_slots()` RPC, and `/api/cron/generate-slots` cron job are all legacy and unused. Out of scope for this change.

## Decision

Remove the `ScheduleConfigEditor` UI component and its integration points. Keep all backend infrastructure (`schedule_config` column, booking validation RPC, Sunday Lunch merge logic, seeded data).

## Changes

### Delete

| File | Reason |
|------|--------|
| `src/app/(authenticated)/settings/business-hours/ScheduleConfigEditor.tsx` | Entire component is the unused UI |

### Modify

| File | Change |
|------|--------|
| `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx` | Remove `ScheduleConfigEditor` import and the JSX block rendering it (the "Service Slots Configuration" section). **Important**: the `scheduleConfig` state variable, its initialisation in `useEffect`/`fetchDefaults`, and its use in `handleSubmit` must all be retained — they carry existing non-sunday-lunch seeded slot data through the save without data loss. Only the `<ScheduleConfigEditor>` JSX and its label text are removed. |
| `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx` | Remove `ScheduleConfigEditor` import, `Settings` icon import from `lucide-react`, `editingConfigDay` state, `handleConfigChange` function, the "Slots" column/button in the DataTable, and the `editingConfigDay` modal block. |

### Keep (no changes)

- `schedule_config` JSONB column on `business_hours` and `special_hours` tables
- `table_booking_matches_service_window_v05()` RPC
- `ScheduleConfigItem` type in `src/types/business-hours.ts` (still used by Sunday Lunch merge logic)
- Service layer `schedule_config` FormData handling in `src/services/business-hours.ts`
- API endpoints that return `schedule_config` data
- All seeded `schedule_config` data in migrations

## Out of Scope

- Dropping the `schedule_config` column or writing migrations
- Rewriting the booking validation RPC
- Removing the dead `service_slots` table, `auto_generate_weekly_slots()` RPC, or generate-slots cron job
- Changing the `ScheduleConfigItem` type

## Risk Assessment

| Area | Risk | Rationale |
|------|------|-----------|
| Booking validation | None | RPC reads existing seeded data from column, which remains untouched |
| Sunday Lunch | None | Dedicated UI is independent of `ScheduleConfigEditor` |
| API responses | None | `/api/business/hours` still reads and returns `schedule_config` data |
| Future extensibility | Low | If a new service type is needed, either restore the UI or use a migration |

## Future Considerations

- The dead `service_slots` infrastructure could be cleaned up in a separate task
- If `schedule_config` is ever to be fully removed, the RPC already handles empty config — it falls back to pub/kitchen hours

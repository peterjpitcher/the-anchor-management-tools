# Remove Service Slots Configuration UI

**Date**: 2026-03-22
**Complexity**: S (4 files modified, 1 deleted)
**Status**: Approved

## Problem

The business hours settings page (`/settings/business-hours`) includes a "Service Slots Configuration" section in both the regular weekly hours modal and the exceptions calendar modal. This section allows staff to define named service windows (lunch, dinner, events) with time ranges, capacity, and booking types.

Nobody has ever used this feature. It adds confusion to the UI without providing value.

## Discovery Summary

A full dependency analysis revealed:

- **`schedule_config` is load-bearing** — the `table_booking_matches_service_window_v05()` PostgreSQL RPC reads it on every booking creation to validate times against service windows. The `/api/business/hours` endpoint also derives Sunday Lunch service details and lunch/dinner windows from it.
- **Empty config is safe** — the RPC handles empty/null `schedule_config` gracefully by returning `true` and deferring to pub/kitchen hour validation.
- **Sunday Lunch UI is visually separate but shares the `schedule_config` data path** — `SpecialHoursModal` has dedicated time pickers and a "Sunday Lunch Closed" toggle that don't use `ScheduleConfigEditor`. However, persistence still flows through the shared `scheduleConfig` state, which carries all slot data (including non-sunday-lunch seeded entries) through the save cycle. Similarly, `BusinessHoursManager` has dedicated Sunday Lunch columns that read/write `schedule_config` via `handleSundayLunchTimeChange` and `getSundayLunchTime`.
- **Seeded data exists** — migrations populated `schedule_config` with Sunday Lunch slots (Sunday) and regular service slots (other days).
- **Legacy infrastructure exists** — the `service_slots` table, `auto_generate_weekly_slots()` RPC, and `/api/cron/generate-slots` cron job are legacy and non-authoritative for booking validation (the RPC reads `schedule_config` directly). They are still called in ~7 places but are out of scope for this change.

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
| `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx` | Remove `ScheduleConfigEditor` import and the JSX block rendering it (the "Service Slots Configuration" section). **Important**: the `scheduleConfig` state variable, its initialisation in `useEffect`/`fetchDefaults`, and its use in `handleSubmit` must all be retained — they carry existing non-sunday-lunch seeded slot data through the save without data loss. Only the `<ScheduleConfigEditor>` JSX and its label text are removed. Add a comment at each `setScheduleConfig` call explaining retention (e.g. `// Retained: carries existing seeded schedule_config through save without overwriting`). |
| `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx` | Remove `ScheduleConfigEditor` import, `Modal` import from `@/components/ui-v2/overlay/Modal`, `Settings` icon import from `lucide-react`, `editingConfigDay` state, `handleConfigChange` function, the "Slots" column/button in the DataTable, and the `editingConfigDay` modal block. **Must preserve**: `handleSundayLunchTimeChange`, `getSundayLunchTime`, the Sunday Lunch Start/End columns, and the `schedule_config_*` FormData serialisation in `handleSubmit` — these are adjacent to code being removed but are load-bearing. |
| `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx` | Update the calendar description text (lines 155–158) to remove reference to "adjust service slots" — this copy becomes inaccurate after the editor UI is removed. |

### Keep (no changes)

- `schedule_config` JSONB column on `business_hours` and `special_hours` tables
- `table_booking_matches_service_window_v05()` RPC
- `ScheduleConfigItem` type in `src/types/business-hours.ts` (still used by `BusinessHours` and `SpecialHours` interfaces, `SpecialHoursModal` typed state, and Sunday Lunch merge logic)
- Service layer `schedule_config` FormData handling in `src/services/business-hours.ts`
- API endpoints that return and derive data from `schedule_config` (`/api/business/hours` and `/api/business-hours`)
- All seeded `schedule_config` data in migrations

## Out of Scope

- Dropping the `schedule_config` column or writing migrations
- Rewriting the booking validation RPC
- Removing the legacy `service_slots` table, `auto_generate_weekly_slots()` RPC, or generate-slots cron job
- Changing the `ScheduleConfigItem` type

## Risk Assessment

| Area | Risk | Rationale |
|------|------|-----------|
| Booking validation | Low | RPC is independent of the editor component, but correctness depends on preserving `schedule_config` on save via the retained FormData paths in both `BusinessHoursManager` and `SpecialHoursModal` |
| Sunday Lunch | Low | Dedicated UI is visually independent of `ScheduleConfigEditor`, but shares the `schedule_config` data model. Weekly Sunday Lunch uses `handleSundayLunchTimeChange`/`getSundayLunchTime` in `BusinessHoursManager`; exception Sunday Lunch uses the `scheduleConfig` merge logic in `SpecialHoursModal`. Both must remain intact. |
| API responses | Low | `/api/business/hours` derives Sunday Lunch service details, slot timing, and capacity from `schedule_config` — not just a passthrough. `/api/business-hours` also exposes `schedule_config` on special hours. |
| Future extensibility | Low | If a new service type is needed, either restore the UI or use a migration |

## Verification

Post-change, the following must pass with zero errors:
- `npm run lint`
- `npx tsc --noEmit`
- `npm run build`

Regression checks: verify that weekly Sunday Lunch edits, Sunday special-hours edits, and non-Sunday special-hours saves all preserve existing seeded service windows.

## Future Considerations

- The legacy `service_slots` infrastructure could be cleaned up in a separate task
- If `schedule_config` is ever to be fully removed, the RPC already handles empty config — it falls back to pub/kitchen hours

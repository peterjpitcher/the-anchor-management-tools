# Spec Compliance Audit

Spec reviewed: `docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md`

Scope reviewed:
- `src/app/(authenticated)/settings/business-hours/ScheduleConfigEditor.tsx`
- `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx`
- `src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx`
- `src/app/(authenticated)/settings/business-hours/SpecialHoursCalendar.tsx`
- `src/types/business-hours.ts`
- `src/services/business-hours.ts`
- `src/app/api/business/hours/route.ts`
- `src/app/api/business-hours/route.ts`
- `src/app/actions/business-hours.ts`
- Supporting migrations and booking call sites where needed

## Verdict

The spec is partially accurate, but not fully sufficient as written.

If implemented literally, it would remove the right component and the two real import sites, and it correctly calls out the critical need to retain `scheduleConfig` in `SpecialHoursModal`.

However, it also has gaps:
- it misses at least one user-facing copy update in `SpecialHoursCalendar.tsx`
- it understates the code coupling around `schedule_config`
- it incorrectly describes `service_slots` / `auto_generate_weekly_slots()` as "unused"
- its `Risk: None` labels are too aggressive for areas that depend on preserving existing `schedule_config` data paths

## Direct Answers

1. `ScheduleConfigEditor.tsx` is the correct file to delete. The only code imports are in `BusinessHoursManager.tsx:12` and `SpecialHoursModal.tsx:8`. There are no other code importers.
2. The modification list is incomplete.
   `SpecialHoursModal.tsx` is described correctly.
   `BusinessHoursManager.tsx` misses removal of the now-unused `Modal` import at `BusinessHoursManager.tsx:11`.
   The spec also misses a required copy change in `SpecialHoursCalendar.tsx:155-158`, which still tells users they can "adjust service slots."
3. The "Keep" list is directionally correct, but a few items are described too narrowly. `ScheduleConfigItem` remains needed for more than Sunday Lunch merge logic, and API usage is broader than the spec's risk table suggests.
4. `Risk: None` is not accurate across the board. Booking validation, Sunday Lunch behavior, and API responses are low-risk only if `schedule_config` preservation paths remain intact.
5. `ScheduleConfigItem` is still needed after removal.
6. The spec is correct that `scheduleConfig` state in `SpecialHoursModal` must be retained.

## Findings

### 1. The deletion target and import graph are correct

Verified:
- `ScheduleConfigEditor.tsx` is a standalone UI component (`ScheduleConfigEditor.tsx:1-116`).
- Only two code files import it:
  - `BusinessHoursManager.tsx:12`
  - `SpecialHoursModal.tsx:8`

Result:
- The spec's delete target is correct.
- There are no additional code importers beyond the files already listed in the spec.

### 2. `SpecialHoursModal.tsx` is specified correctly, and the `scheduleConfig` retention note is critical

Verified:
- Editor import: `SpecialHoursModal.tsx:8`
- Editor render block: `SpecialHoursModal.tsx:392-403`
- `scheduleConfig` state: `SpecialHoursModal.tsx:47`
- Initialization from existing special hours: `SpecialHoursModal.tsx:51-60`
- Initialization from default weekly hours: `SpecialHoursModal.tsx:94-121`
- Submit merge path: `SpecialHoursModal.tsx:156-202`

Why this matters:
- `scheduleConfig` carries existing non-Sunday-Lunch slot data.
- `handleSubmit` clones `scheduleConfig` into `finalConfig`, then merges/removes only the `sunday_lunch` entry before posting it.
- If `scheduleConfig` state, its initialization, or its submit-time use were removed, saving an exception would silently drop existing seeded slot data.

Result:
- The spec is correct here.
- This is the strongest and most important preservation note in the whole spec.

### 3. `BusinessHoursManager.tsx` is only partially specified

Verified current editor integration:
- `Modal` import: `BusinessHoursManager.tsx:11`
- `ScheduleConfigEditor` import: `BusinessHoursManager.tsx:12`
- `Settings` icon import: `BusinessHoursManager.tsx:13`
- `editingConfigDay` state: `BusinessHoursManager.tsx:33`
- `handleConfigChange`: `BusinessHoursManager.tsx:39-44`
- "Slots" column/button: `BusinessHoursManager.tsx:264-274`
- Modal block: `BusinessHoursManager.tsx:341-358`

Spec accuracy:
- Correctly identifies the editor integration to remove.
- Misses the now-unused `Modal` import at `BusinessHoursManager.tsx:11`.

Important preservation paths not called out explicitly:
- Sunday Lunch weekly UI remains active through:
  - `handleSundayLunchTimeChange`: `BusinessHoursManager.tsx:100-132`
  - `getSundayLunchTime`: `BusinessHoursManager.tsx:134-137`
  - Sunday Lunch columns: `BusinessHoursManager.tsx:240-263`
- Full `schedule_config` preservation on save remains active through:
  - `formData.append(\`schedule_config_\${day}\`, ...)`: `BusinessHoursManager.tsx:151-159`

Result:
- The spec is directionally correct for this file, but incomplete.
- It should explicitly say to remove the `Modal` import.
- It would be safer to explicitly say the Sunday Lunch fields and `schedule_config_*` FormData submission must remain untouched.

### 4. The spec misses a required change in `SpecialHoursCalendar.tsx`

Verified:
- Calendar description still says: `"Click any date to close the venue, change hours, or adjust service slots."`
- Location: `SpecialHoursCalendar.tsx:155-158`

Impact:
- After removing the editor UI from `SpecialHoursModal`, this description becomes inaccurate user-facing copy.

Result:
- This is a real gap.
- The spec's "3 files touched, 1 deleted" estimate is therefore incomplete if the implementation is expected to leave the UI consistent.

### 5. The "dead infrastructure is unused" claim is inaccurate

Spec claim:
- `docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md:21`

What the code shows:
- `service_slots` is still updated in `BusinessHoursService`:
  - override create: `src/services/business-hours.ts:295-353`
  - override delete: `src/services/business-hours.ts:356-414`
  - Sunday Lunch service status toggles: `src/services/business-hours.ts:416-513`
- `auto_generate_weekly_slots()` is still called after:
  - weekly hours save: `src/services/business-hours.ts:247-251`
  - special hours create: `src/services/business-hours.ts:599-603`
  - special hours update: `src/services/business-hours.ts:661-665`
  - special hours delete: `src/services/business-hours.ts:690-694`
  - service status changes: `src/services/business-hours.ts:506-509`
- `/api/cron/generate-slots` still executes the same RPC: `src/app/api/cron/generate-slots/route.ts:1-59`

What is accurate:
- This infrastructure is not the booking-validation source of truth anymore.
- Booking validation reads `schedule_config` directly from `business_hours` / `special_hours` via `table_booking_matches_service_window_v05`.

What is inaccurate:
- Calling it "unused" is false in the current codebase.

Result:
- Reword to "legacy, non-authoritative for booking validation, and out of scope" rather than "unused."

### 6. The keep-list is mostly correct, but some rationale is too narrow

Verified independent items:
- `schedule_config` columns exist and are seeded/migrated:
  - `supabase/migrations/20251123120000_squashed.sql:15787-15814`
- Booking validation RPC reads `schedule_config` directly:
  - `supabase/migrations/20260501000001_fix_service_window_validation.sql:46-73`
- Service layer accepts and persists `schedule_config`:
  - weekly hours: `src/services/business-hours.ts:201-253`
  - special hours create/update: `src/services/business-hours.ts:529-667`
- API routes still expose or derive from `schedule_config`:
  - public business hours API: `src/app/api/business/hours/route.ts:92-121`, `283-399`
  - secondary business-hours API includes `schedule_config` on special hours: `src/app/api/business-hours/route.ts:32-38`, `73-78`

Nuance on `ScheduleConfigItem`:
- It remains needed, but not only for Sunday Lunch merge logic.
- It is still referenced by:
  - `BusinessHours.schedule_config`: `src/types/business-hours.ts:9-20`
  - `SpecialHours.schedule_config`: `src/types/business-hours.ts:23-35`
  - `SpecialHoursModal` typed state: `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx:10`, `47`

Result:
- Keep-list is broadly correct.
- The `ScheduleConfigItem` rationale should be expanded.

### 7. The risk table should not say "None" for all three operational areas

#### Booking validation

Why "None" is too strong:
- The RPC itself is safe and independent of the editor component.
- But correctness still depends on preserving existing `schedule_config` on save, especially in:
  - `BusinessHoursManager.tsx:151-159`
  - `SpecialHoursModal.tsx:156-202`

Assessment:
- Recommended risk: `Low`, not `None`

#### Sunday Lunch

Why "None" is too strong:
- The Sunday Lunch UI is independent of `ScheduleConfigEditor`, but not independent of the `schedule_config` data model.
- Weekly Sunday Lunch UI uses `schedule_config` in `BusinessHoursManager.tsx:100-137` and `240-263`.
- Exception Sunday Lunch UI uses `schedule_config` in `SpecialHoursModal.tsx:156-202`.

Assessment:
- Recommended risk: `Low`, not `None`

#### API responses

Why "None" is too strong:
- `/api/business/hours` does not just return `schedule_config`; it also derives Sunday Lunch service details and lunch/dinner windows from it:
  - `src/app/api/business/hours/route.ts:283-399`
- `/api/business-hours` also continues to expose `schedule_config` on special hours:
  - `src/app/api/business-hours/route.ts:32-38`, `73-78`

Assessment:
- Recommended risk: `Low`, not `None`

#### Future extensibility

Assessment:
- `Low` is reasonable.

### 8. Two product assertions in the spec are not verifiable from source

Not verifiable from code:
- "Nobody has ever used this feature"
- "This data has never been modified through the UI"

Why:
- Source code can show capability, not real-world usage history.
- The current UI does permit modification:
  - weekly editor modal: `BusinessHoursManager.tsx:341-358`
  - exception modal editor: `SpecialHoursModal.tsx:392-403`

Result:
- These should be treated as product/analytics assertions, not code-verified facts.

## Requirements Coverage Matrix

| Spec Area | Claim | Evidence | Status | Gap / Correction |
|---|---|---|---|---|
| Delete | Delete `ScheduleConfigEditor.tsx` | `ScheduleConfigEditor.tsx:1-116` is the full standalone UI | Covered | None |
| Delete | No other importers beyond listed integration points | Only `BusinessHoursManager.tsx:12` and `SpecialHoursModal.tsx:8` import it | Covered | None |
| Modify | `SpecialHoursModal.tsx`: remove editor import + JSX only | Import at `:8`, JSX at `:392-403` | Covered | None |
| Modify | Retain `scheduleConfig` state/init/submit in `SpecialHoursModal.tsx` | State `:47`, init `:51-60`, defaults `:94-121`, submit `:156-202` | Covered | This must stay exactly as the spec says |
| Modify | `BusinessHoursManager.tsx`: remove editor integration | Import `:12`, state `:33`, handler `:39-44`, Slots column `:264-274`, modal `:341-358` | Partial | Also remove `Modal` import at `:11`; better to explicitly preserve Sunday Lunch + `schedule_config_*` submit path |
| Modify | No other UI file changes needed | `SpecialHoursCalendar.tsx:155-158` still references service slots | Incorrect | Add `SpecialHoursCalendar.tsx` copy update |
| Keep | Keep `schedule_config` DB columns | `20251123120000_squashed.sql:15787-15793` | Covered | None |
| Keep | Keep booking validation RPC | `20260501000001_fix_service_window_validation.sql:13-138` | Covered | None |
| Keep | Keep `ScheduleConfigItem` type | `src/types/business-hours.ts:1-35`, `SpecialHoursModal.tsx:10,47` | Covered | Rationale should mention interfaces/state, not just merge logic |
| Keep | Keep service-layer `schedule_config` FormData handling | `src/services/business-hours.ts:201-253`, `529-667` | Covered | None |
| Keep | Keep API endpoints returning `schedule_config` | `src/app/api/business/hours/route.ts:92-121,283-399`; `src/app/api/business-hours/route.ts:32-38,73-78` | Covered | Risk text should mention both API consumers |
| Keep | Keep seeded `schedule_config` migration data | `20251123120000_squashed.sql:11339-11356`, `15795-15814`; `20251129204730_update_sunday_lunch_hours.sql:7-23` | Covered | None for existence; usage history is unverifiable |
| Discovery | Empty/null config is safe | `20260501000001_fix_service_window_validation.sql:69-73`, `128-133` | Covered | None |
| Discovery | Sunday Lunch UI is independent of the editor | `SpecialHoursModal.tsx:288-377`, `156-202`; weekly UI also independent in `BusinessHoursManager.tsx:100-137,240-263` | Covered | Rationale should mention both Sunday Lunch UIs and their shared dependence on `schedule_config` |
| Discovery | Dead service-slot infrastructure is unused | `src/services/business-hours.ts:247-251,295-353,356-414,416-513,599-603,661-665,690-694`; cron route `src/app/api/cron/generate-slots/route.ts:1-59` | Incorrect | Reword "unused" to "legacy / non-authoritative for booking validation" |
| Risk | Booking validation risk is None | RPC is independent, but save paths preserve config | Partial | Recommend `Low` |
| Risk | Sunday Lunch risk is None | UI is independent of editor, not of `schedule_config` | Partial | Recommend `Low` |
| Risk | API responses risk is None | API derives behavior from `schedule_config` | Partial | Recommend `Low` |
| Risk | Future extensibility risk is Low | Reasonable given current coupling | Covered | None |
| Problem / Discovery | Feature has never been used; data never modified via UI | Not derivable from source | Unverifiable | Support with analytics/audit evidence or remove from code-based justification |

## Final Assessment

The spec is not fully compliant as a code-grounded implementation guide.

Minimum corrections before treating it as implementation-ready:
- add `SpecialHoursCalendar.tsx` to the modification list and remove the stale "adjust service slots" copy
- add removal of the unused `Modal` import from `BusinessHoursManager.tsx`
- reword the `service_slots` / `auto_generate_weekly_slots()` discovery note from "unused" to "legacy, non-authoritative, out of scope"
- downgrade `Risk: None` to `Risk: Low` for Booking validation, Sunday Lunch, and API responses
- expand the `ScheduleConfigItem` rationale to reflect its continued use in core types and `SpecialHoursModal` state

With those corrections, the spec would accurately describe the code paths it is relying on and would be safe to implement.

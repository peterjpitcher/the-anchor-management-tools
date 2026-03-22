### BUG-001: SpecialHours "independent" claim contradicts the real save path
- File: docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md:19
- Severity: High
- Category: Logic
- Description: The spec says the Sunday Lunch UI in `SpecialHoursModal` is "completely independent" of `ScheduleConfigEditor`, but the code still persists Sunday Lunch by hydrating and rewriting the shared `scheduleConfig` array (`src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx:47-59`, `:94-120`, `:156-202`). That directly conflicts with the warning later in the spec that `scheduleConfig` must be retained.
- Impact: An implementer who trusts the discovery summary more than the change table can delete the shared `scheduleConfig` hydration/submit path and silently lose seeded non-Sunday-Lunch windows or fail to persist Sunday Lunch edits for special hours.
- Suggested fix: Reword the discovery summary to say the Sunday Lunch controls are visually separate, but persistence still flows through shared `schedule_config` state. Explicitly call out `scheduleConfig`, `setScheduleConfig`, `fetchDefaults`, and the Sunday Lunch merge logic as required keepers.

### BUG-002: Weekly Sunday Lunch persistence is not explicitly protected in `BusinessHoursManager`
- File: docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md:40
- Severity: High
- Category: Data Integrity
- Description: The `BusinessHoursManager` change list only enumerates removals. It does not explicitly preserve the remaining Sunday Lunch path, which is still `schedule_config`-backed through `handleSundayLunchTimeChange`, `getSundayLunchTime`, and `formData.append(\`schedule_config_\${day}\`)` in `handleSubmit` (`src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx:100-159`, `:240-257`). Those are easy to delete during "cleanup" because they live beside the Slots modal code being removed.
- Impact: A broad cleanup can leave the Sunday Lunch Start/End inputs visible but non-persistent after save/refresh, breaking the regular weekly Sunday Lunch flow even though the UI still appears to work.
- Suggested fix: Add an explicit keep note for `handleSundayLunchTimeChange`, `getSundayLunchTime`, the `Sun Lunch Start/End` columns, and the `schedule_config_*` FormData serialization in `BusinessHoursManager`.

### BUG-003: The spec misses `/api/business/hours` as a load-bearing `schedule_config` consumer
- File: docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md:64
- Severity: Medium
- Category: Logic
- Description: The spec frames API risk as "none" because endpoints still return `schedule_config`, but `/api/business/hours` is not a passive passthrough. It derives `currentStatus.services.sundayLunch`, generated Sunday slots, and lunch/dinner service timing metadata from `schedule_config` (`src/app/api/business/hours/route.ts:104-121`, `:283-420`). That dependency is absent from the discovery summary and related keep/risk sections.
- Impact: Regression scope is too narrow. An implementation can preserve the booking-validation RPC yet still ship broken public Sunday Lunch/service timing data because the API-derived service metadata was not treated as part of the contract.
- Suggested fix: Add `src/app/api/business/hours/route.ts` to the dependency analysis and regression checklist, and state explicitly that `schedule_config` still powers public service metadata, not just booking validation.

### BUG-004: Risk assessment wrongly says `schedule_config` remains untouched after this change
- File: docs/superpowers/specs/2026-03-22-remove-service-slots-ui.md:62
- Severity: Medium
- Category: Partial Failure
- Description: The risk table says booking validation is safe because the RPC reads seeded data "which remains untouched." That is inaccurate. Both settings flows still rewrite `schedule_config` on save via the UI submit paths and service layer (`src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx:151-159`, `src/app/(authenticated)/settings/business-hours/SpecialHoursModal.tsx:191-202`, `src/services/business-hours.ts:212-230`, `:544-570`, `:619-645`).
- Impact: This understates the real failure mode. The RPC itself may remain unchanged while save/edit flows quietly corrupt or stop updating `schedule_config`, producing a bug that the spec currently labels as zero risk.
- Suggested fix: Change the rationale to acknowledge that `schedule_config` is still written on every save and add explicit regression cases for weekly Sunday Lunch edits, Sunday special-hours edits, and non-Sunday special-hours saves that must preserve existing seeded windows.

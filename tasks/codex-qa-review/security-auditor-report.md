# Security Audit: Remove Service Slots Configuration UI

## Summary

- I did not find a new unauthenticated or permissionless `schedule_config` write path. The three write actions that persist business hours data still call `requireSettingsManagePermission()` before using the admin Supabase client.
- The main security issue is different: the spec preserves a writable, load-bearing `schedule_config` surface, but the server still validates it as `z.array(z.any())`. Once the UI editor is removed, crafted server-action `FormData` becomes the only practical way to mutate that JSON, and the backend will still trust it.
- The spec's "API responses: None" risk assessment is too optimistic. The public `/api/business/hours` route still exposes raw `schedule_config` data and service-override `created_by` metadata.

### SEC-001: Hidden `schedule_config` write surface still accepts arbitrary JSON after the UI is removed
- File: `src/services/business-hours.ts:29`, `src/services/business-hours.ts:141`, `src/services/business-hours.ts:201`, `src/services/business-hours.ts:529`, `src/services/business-hours.ts:608`
- Severity: Medium
- Category: Input Validation
- Description: The backend still accepts `schedule_config` from client-controlled `FormData` in `updateBusinessHours()`, `createSpecialHours()`, and `updateSpecialHours()`. Those paths only `JSON.parse()` the payload and validate it as `z.array(z.any())`, so there is no server-side enforcement of item shape, allowed `booking_type` values, time format, capacity bounds, or array size. The removed `ScheduleConfigEditor` was the only place constraining most of that structure in the first-party UI. After this change, a caller with `settings.manage` can still invoke the server actions directly and submit arbitrary `schedule_config` JSON even though there is no supported UI for it anymore.
- Impact: A compromised or malicious settings manager can inject malformed or semantically invalid slot definitions, disable or widen service-window enforcement in `table_booking_matches_service_window_v05()`, block bookings by creating mismatched slot data, or persist config that the UI can no longer inspect or repair.
- Suggested fix: If non-Sunday-Lunch editing is no longer supported, stop accepting raw `schedule_config` from the client entirely. Load the existing row server-side and merge only the supported Sunday Lunch fields on the server. If client writes must remain, replace `z.array(z.any())` with a strict `ScheduleConfigItem` schema, whitelist booking types, validate time ordering, and cap payload size.

### SEC-002: Malformed `schedule_config` can break the public hours API and downstream consumers
- File: `src/app/api/business/hours/route.ts:390`
- Severity: Medium
- Category: Input Validation
- Description: The public `GET /api/business/hours` route assumes each `schedule_config` entry has string `name` and `booking_type` fields and calls `s.name.toLowerCase()` / `s.booking_type.toLowerCase()` without type checks. Because the write path stores arbitrary JSON, a crafted `schedule_config` item such as `{"name":null}` or `{"booking_type":{}}` can trigger a runtime exception in `findServiceTimes()`. Similar unchecked `.find(c => c.booking_type === 'sunday_lunch')` access exists in the business-hours settings components.
- Impact: An attacker with `settings.manage` can poison the stored config and force the public hours endpoint into its fallback error response for all visitors, while also risking crashes in the internal settings UI. This is a practical denial-of-service against public operational data derived from `schedule_config`.
- Suggested fix: Enforce strict `schedule_config` validation on write, and harden all readers to treat untrusted JSON defensively: check `typeof s?.name === 'string'`, `typeof s?.booking_type === 'string'`, and validate `starts_at` / `ends_at` before using them.

### SEC-003: Public hours API exposes internal `schedule_config` and creator metadata
- File: `src/app/api/business/hours/route.ts:10`, `src/app/api/business/hours/route.ts:67`, `src/app/api/business/hours/route.ts:104`, `src/app/api/business/hours/route.ts:121`, `src/app/api/business/hours/route.ts:138`, `src/app/api/business/hours/route.ts:408`
- Severity: Low
- Category: Data Exposure
- Description: The route is intentionally public and uses the admin client to return raw `schedule_config` arrays for regular and special hours, plus `created_by` values for service-status overrides. If `schedule_config` is now intended to remain backend-only load-bearing data after UI removal, continuing to expose it publicly is unnecessary. The `created_by` field is internal operator metadata and should not be present in a public response.
- Impact: Anonymous callers can enumerate internal slot/capacity definitions and staff user identifiers. That disclosure makes targeted payload crafting easier and leaks internal metadata that is unrelated to the public business-hours use case.
- Suggested fix: Return a minimal public DTO instead of raw database rows. Omit `created_by` entirely, and only expose derived public-safe service information rather than raw `schedule_config` unless there is a clear product requirement for it.

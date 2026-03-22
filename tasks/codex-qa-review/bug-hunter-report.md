### BUG-001: Orphan cleanup can delete valid events from the next rota week
- **File:** [src/lib/google-calendar-rota.ts#L141](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L141); [src/lib/google-calendar-rota.ts#L147](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L147); [src/lib/google-calendar-rota.ts#L168](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L168)
- **Severity:** Critical
- **Category:** Logic
- **Description:** `timeMax` is built from `weekEnd + 'T23:59:59Z'` and then advanced by one full day, so orphan recovery scans almost the entire following day. Any event in that window whose `shiftId` is not in the current week is treated as stale and queued for deletion.
- **Impact:** Syncing week N can delete legitimate Monday events from week N+1. In the full resync route, final calendar state becomes order-dependent.
- **Suggested fix:** Make the recovery window end at the start of the day after `weekEnd`, not the end of that day, and never delete an event solely because its `shiftId` is absent from the current week without verifying it belongs to this week.

### BUG-002: A failed published-shifts query is treated as “no shifts”, which wipes that week from Google Calendar
- **File:** [src/app/api/rota/resync-calendar/route.ts#L42](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L42); [src/app/api/rota/resync-calendar/route.ts#L48](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L48)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** The route ignores the `error` from `rota_published_shifts`. If that query fails, `shifts ?? []` is passed into `syncRotaWeekToCalendar`.
- **Impact:** The sync engine interprets the empty array as “all shifts were removed” and deletes every mapped event for that week.
- **Suggested fix:** Capture and handle the query error explicitly; skip the week and report failure instead of syncing unknown data.

### BUG-003: Cancelled shifts can never produce `STATUS:CANCELLED` tombstones in either ICS feed
- **File:** [src/app/api/rota/feed/route.ts#L62](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/feed/route.ts#L62); [src/app/api/portal/calendar-feed/route.ts#L49](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/portal/calendar-feed/route.ts#L49)
- **Severity:** High
- **Category:** Data Integrity
- **Description:** Both feeds only serialize rows currently present in `rota_published_shifts`, but the publish pipeline excludes cancelled shifts at [src/app/actions/rota.ts#L935](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/rota.ts#L935). The `shift.status === 'cancelled'` branches in the feed routes are effectively dead.
- **Impact:** When a published shift is cancelled, subscribers never receive a matching VEVENT with `STATUS:CANCELLED`; stale shifts remain in Google/Apple/Outlook calendars.
- **Suggested fix:** Preserve cancelled rows in the published snapshot, or generate tombstone VEVENTs from the previous snapshot when a published shift disappears.

### BUG-004: Google event mappings can drift silently because write/delete failures are ignored
- **File:** [src/lib/google-calendar-rota.ts#L127](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L127); [src/lib/google-calendar-rota.ts#L188](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L188); [src/lib/google-calendar-rota.ts#L223](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L223); [src/lib/google-calendar-rota.ts#L362](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L362); [src/lib/google-calendar-rota.ts#L394](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L394)
- **Severity:** High
- **Category:** Partial Failure
- **Description:** Supabase `upsert()`/`delete()` results are never checked, and delete callers remove mapping rows even though `safeDeleteEvent()` swallows Google delete failures.
- **Impact:** The code can report success after Google insert/update/delete calls while the mapping table is wrong, causing duplicates, missed updates, or stale events that no longer have a reliable cleanup path.
- **Suggested fix:** Check every Supabase write result, make `safeDeleteEvent()` return success/failure, and only remove mappings after the Google delete is confirmed.

### BUG-005: Conditional GET can return `304 Not Modified` for a feed whose body has changed
- **File:** [src/app/api/rota/feed/route.ts#L53](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/feed/route.ts#L53); [src/app/api/rota/feed/route.ts#L160](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/feed/route.ts#L160); [src/app/api/portal/calendar-feed/route.ts#L41](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/portal/calendar-feed/route.ts#L41); [src/app/api/portal/calendar-feed/route.ts#L140](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/portal/calendar-feed/route.ts#L140)
- **Severity:** High
- **Category:** Logic
- **Description:** The ICS body changes as the rolling `-28/+84 day` window moves, but `Last-Modified` is derived only from `published_at`. The code also accepts `If-Modified-Since` as sufficient even when the ETag/body changed.
- **Impact:** Clients can be told “unchanged” while events have actually entered or left the feed window, so boundary shifts appear late or linger too long.
- **Suggested fix:** Treat ETag as the primary validator when present, and do not use `published_at` alone as a proxy for whole-feed freshness when the window itself changes the payload.

### BUG-006: Overnight ICS events can become invalid if `is_overnight` is wrong
- **File:** [src/app/api/rota/feed/route.ts#L107](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/feed/route.ts#L107); [src/app/api/portal/calendar-feed/route.ts#L88](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/portal/calendar-feed/route.ts#L88)
- **Severity:** Medium
- **Category:** Edge Case
- **Description:** The feed routes trust `is_overnight` blindly when choosing `endDate`. Unlike the Google sync engine, they do not auto-detect `end_time <= start_time`.
- **Impact:** A bad or missing `is_overnight` flag produces `DTEND` earlier than `DTSTART`, which many calendar clients render incorrectly or reject.
- **Suggested fix:** Mirror the Google sync logic: treat `end_time <= start_time` as overnight even if the flag is false.

### BUG-007: The manual sync UI reports success even when weeks or shifts failed
- **File:** [src/app/api/rota/resync-calendar/route.ts#L59](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L59); [src/app/(authenticated)/rota/RotaFeedButton.tsx#L22](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/rota/RotaFeedButton.tsx#L22)
- **Severity:** Medium
- **Category:** Partial Failure
- **Description:** The API always returns `success: true` unless auth/week lookup fails, and the client toast keys only off `result.success`.
- **Impact:** Operators get a success message even when `errors` is non-empty or `totalFailed > 0`, so incomplete syncs can go unnoticed in production.
- **Suggested fix:** Return partial success explicitly, or set `success: false` when any week/shift fails and surface the counts/errors in the UI.

No production-impacting bugs found in [src/lib/ics/utils.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/ics/utils.ts) or [src/lib/portal/calendar-token.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/portal/calendar-token.ts) for the categories you asked me to review.
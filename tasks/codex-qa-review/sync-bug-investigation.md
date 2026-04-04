### BUG-001: Resync reports success even when shift-level syncs fail
- File: [src/app/api/rota/resync-calendar/route.ts:151](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L151), [src/app/api/rota/resync-calendar/route.ts:181](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L181), [src/lib/google-calendar-rota.ts:487](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L487)
- Severity: High
- Description: The API marks the run as successful as long as no whole-week exception escapes, even if individual shifts fail. That matches “68 weeks synced” without guaranteeing any events were actually recreated.
- Evidence: The route aggregates `totalFailed` but still returns `success: true` unconditionally; audit status is based only on `errors.length`. In the sync function, failed shifts increment `result.failed++`.
- Suggested fix: Treat `totalFailed > 0` as partial failure in the API response and audit log, and make the caller distinguish full success from partial success.

### BUG-002: Rate-limit retry is reading the wrong error shape and ignores 429
- File: [src/lib/google-calendar-rota.ts:410](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L410), [node_modules/gaxios/build/cjs/src/gaxios.js:154](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/node_modules/gaxios/build/cjs/src/gaxios.js#L154), [node_modules/gaxios/build/cjs/src/common.js:121](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/node_modules/gaxios/build/cjs/src/common.js#L121), [node_modules/gaxios/build/cjs/src/common.js:181](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/node_modules/gaxios/build/cjs/src/common.js#L181)
- Severity: High
- Description: `withRateLimitRetry()` checks `err.errors?.[0]?.reason`, but `GaxiosError` does not expose Google API `errors` at the top level. The parsed API payload is passed in as the cause/response data. The helper also never retries `429`.
- Evidence: Retry logic reads `err.errors?.[0]?.reason`. `gaxios` throws `new GaxiosError(..., translatedResponse, errorInfo)`, sets top-level `status` from `response.status`, and keeps API error details under the extracted `errorInfo`, not as a top-level `errors` field on the `GaxiosError`.
- Suggested fix: Read the reason from `err.response?.data?.error?.errors?.[0]?.reason` or `err.cause`, and retry both retryable `403` reasons and `429`, ideally with backoff / `Retry-After`.

### BUG-003: Re-created events are counted as updated, not created
- File: [src/lib/google-calendar-rota.ts:447](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L447), [src/lib/google-calendar-rota.ts:475](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L475)
- Severity: Medium
- Description: When an `update` gets `404/410`, the code inserts a new Google event, but because `existingEventId` is still truthy, it increments `updated` rather than `created`.
- Evidence: The recovery path calls `calendar.events.insert(...)`, then the counters use `if (existingEventId) result.updated++ else result.created++`.
- Suggested fix: Track a `recreated` flag, or count successful `404/410` fallback inserts as `created`.

### BUG-004: Write concurrency is high enough to amplify rate-limit failures
- File: [src/app/api/rota/resync-calendar/route.ts:157](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L157), [src/lib/google-calendar-rota.ts:343](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L343)
- Severity: Medium
- Description: The route runs 3 weeks concurrently, and each week runs up to 10 shift writes concurrently. That is roughly 30 in-flight Google Calendar writes against one shared auth/calendar, which makes throttling plausible.
- Evidence: `mapWithConcurrency(..., 3, ...)` in the route, and per-week batching of `10` active shifts in the sync function.
- Suggested fix: Reduce overall write concurrency or centralize throttling so retries are coordinated across weeks, not just inside one shift call.

**Direct answers**
1. `isGoogleApiError()` / `getGoogleApiStatus()` are not the main bug. For a real `GaxiosError`, `status` should carry the HTTP 404, and `getGoogleApiStatus()` prefers `status` first. See [src/lib/google-calendar-rota.ts:15](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L15) and [node_modules/gaxios/build/cjs/src/common.d.ts:57](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/node_modules/gaxios/build/cjs/src/common.d.ts#L57).
2. The catch block’s `errCode` can realistically be `404`. That path looks valid. See [src/lib/google-calendar-rota.ts:447](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L447).
3. `withRateLimitRetry()` does not swallow a later 404. If the retried call throws 404, it bubbles to the outer catch, which should hit the recreate branch.
4. `existingMap` definitely includes stale DB event IDs because it is loaded directly from `rota_google_calendar_events`. See [src/lib/google-calendar-rota.ts:166](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/google-calendar-rota.ts#L166).
5. `maxDuration = 300` might be tight under heavy throttling, but there is no clear evidence here that it is the reason for “68 weeks synced.” See [src/app/api/rota/resync-calendar/route.ts:10](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L10).
6. `totalCreated`, `totalUpdated`, and `totalFailed` are tracked and returned by the endpoint. See [src/app/api/rota/resync-calendar/route.ts:185](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/rota/resync-calendar/route.ts#L185).
7. The toast already includes those totals when they are non-zero. Seeing only “Synced 68 weeks” means the API returned zeros for all three counters on that run. See [src/app/(authenticated)/rota/RotaFeedButton.tsx:49](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/rota/RotaFeedButton.tsx#L49).

Most important conclusion: I do not see a bug in the 404 detection itself. The strongest code issues are misleading success reporting and broken rate-limit retry. If the user truly saw only `weeksSynced` with `0 updated` and `0 failed`, then the next thing to verify is data scope: whether those 45 stale mappings belong to currently `published` weeks and still have matching active rows in `rota_published_shifts`, because this endpoint only processes published weeks.
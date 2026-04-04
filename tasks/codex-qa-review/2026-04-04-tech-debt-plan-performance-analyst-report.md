# Performance Analyst Review: Technical Debt Remediation Plan

**Plan under review:** `docs/superpowers/plans/2026-04-04-technical-debt-remediation.md`
**Source report:** `tasks/technical-debt-report.md`
**Reviewer:** Performance Analyst (Codex QA)
**Date:** 2026-04-04

---

## Executive Summary

The plan addresses 39 of 42 debt items across 6 phases. From a performance perspective, it covers the 3 N+1 query patterns (PF-1) and the hourly cron misfire (PF-3), but **defers or ignores** 3 of 5 performance debt items (PF-2, PF-4, PF-5). The FohScheduleClient decomposition (Task 3.1) carries meaningful regression risk due to 43 `useState` hooks, 8 realtime channel subscriptions, and tightly coupled callback refs. The proposed N+1 fixes are partially correct -- one is wrong (event-images) and one is impractical (projects unique code).

**Findings: 2 High, 4 Medium, 3 Low**

---

## Findings

### PERF-001 [HIGH] FohScheduleClient decomposition risks performance regressions

**Location:** Plan Task 3.1, source `src/app/(authenticated)/table-bookings/foh/FohScheduleClient.tsx`

The plan proposes extracting sub-components (FohHeader, FohTimeline, FohBookingModal, FohBookingCard, FohStatusBar) and hooks (useFohBookings, useFohRealtime). This is the right goal, but the plan does not address critical performance hazards:

1. **43 `useState` hooks** live in the root component. When state is passed as props to extracted children, every state change triggers re-renders in all children unless each child is wrapped in `React.memo` with stable prop references. The plan does not mention `React.memo` at all.

2. **Realtime subscription coupling.** The realtime effect (lines 1199-1275) subscribes to 8 Postgres tables and triggers a full schedule reload via `reloadSchedule`. If this hook is extracted to `useFohRealtime`, the `reloadSchedule` callback must remain stable (it uses `useCallback` at line 1178). If the extracted hook recreates the subscription on any dependency change, it will cause subscription churn -- dropping and re-establishing the Supabase channel repeatedly. This degrades real-time responsiveness and creates unnecessary WebSocket traffic.

3. **Drag state interaction.** The realtime refresh explicitly checks `isDraggingRef.current` (line 1208) to suppress refreshes during drag operations. If the drag context and realtime hook are split into separate sub-components or hooks, this ref-based coordination must be preserved carefully. A naive extraction that passes `isDragging` as a prop (instead of a ref) would cause stale closures or missed suppression.

4. **15+ `useMemo` / `useCallback` hooks** depend on `schedule`, `date`, or other frequently-changing state. Extracting these into child components without preserving the memoisation boundaries will cause recomputation on every render.

**Recommendation:** Task 3.1 should include explicit sub-steps:
- Map every `useState` and determine which sub-component owns it vs. which need lifting
- Mandate `React.memo` on all extracted sub-components with complex props
- Keep the realtime subscription in the root component (or in a hook that receives a stable ref), not in a child
- Add a performance checkpoint: measure render count before and after using React DevTools Profiler
- Consider using a context provider for shared state instead of prop drilling 43 state values

---

### PERF-002 [HIGH] N+1 fix for event-images.ts is incorrect -- `getPublicUrl` is not a database query

**Location:** Plan Task 6.2 Step 4, source `src/app/actions/event-images.ts:262-271`

The plan identifies the image URL loop as an N+1 query pattern and proposes "batch public URL generation." However, reading the actual code:

```typescript
for (const img of images) {
  const { data: { publicUrl } } = supabase.storage
    .from(BUCKET_NAME)
    .getPublicUrl(img.storage_path)
  if (publicUrl === imageUrl) {
    imageToDelete = img
    break
  }
}
```

`getPublicUrl()` is a **synchronous, client-side URL construction** -- it does not make a network request. It simply concatenates the bucket URL with the storage path. This is NOT an N+1 query. The loop is O(n) string comparisons, which is negligible.

The real performance issue here is architectural: the function receives `imageUrl` (a public URL) and must reverse-map it to a storage path by iterating all images. A better fix would be to derive the storage path directly from the URL (strip the bucket prefix) or store the public URL in the `event_images` table, eliminating the loop entirely.

**Recommendation:** Remove event-images.ts from the N+1 fix task. If optimization is desired, replace the reverse-lookup loop with direct path derivation.

---

### PERF-003 [MEDIUM] N+1 fix for projects.ts unique code loop -- `.in()` filter won't work as proposed

**Location:** Plan Task 6.2 Step 3, source `src/app/actions/oj-projects/projects.ts:77-87`

The plan says: "Replace the loop that checks for unique project codes with a single query that gets all existing codes, then generates a unique one in memory."

The current code generates a random code and checks if it exists, up to 10 times:

```typescript
for (let i = 0; i < 10; i++) {
  const code = `OJP-${clientCode}-${randomSuffix(5)}`
  const { data: existing } = await supabase
    .from('oj_projects')
    .select('id')
    .eq('project_code', code)
    .maybeSingle()
  if (!existing) return code
}
```

The proposed batch approach (fetch all existing codes, generate in memory) is problematic:
- You cannot pre-generate all candidate codes because the suffix is random
- Fetching ALL project codes from the table to check against is wasteful if the table grows large
- The original pattern makes at most 10 queries, and statistically hits on the first try (5-char random suffix = 60^5 = 777M possibilities, collision near-zero for small projects table)

This is a **theoretical** N+1, not a practical one. Maximum 10 queries, expected 1 query.

**Recommendation:** Deprioritise this fix. If addressed, use a `UNIQUE` constraint on `project_code` (likely already exists) and use INSERT ... ON CONFLICT to retry, or generate the code in a Supabase RPC with a loop. Do not fetch all codes.

---

### PERF-004 [MEDIUM] N+1 fix for rota.ts is correct but needs care with query size

**Location:** Plan Task 6.2 Step 2, source `src/app/actions/rota.ts:1079-1094`

The plan correctly identifies this as a real N+1: for each published week, a separate query fetches all shifts for that week. The proposed fix using `.in('week_id', weekIds)` is correct and would reduce N+1 queries to a single query.

However, two caveats:
1. **Result set size.** If there are many published weeks (the query has no date range filter -- it selects ALL published weeks), the single batch query could return a very large result set. A rota with 52 weeks x 30 employees x 5 shifts = 7,800 rows per year. This is manageable but should have a reasonable limit or date window.
2. **Post-query grouping.** After batching, the code must group shifts by `week_id` before passing to `syncRotaWeekToCalendar`. The plan does not mention this grouping step.

**Recommendation:** Add a date window filter (e.g., only sync weeks from the last 12 weeks) to cap the result set. Mention the grouping step explicitly in the plan.

---

### PERF-005 [MEDIUM] PF-2 (3,434-line billing cron) not adequately addressed

**Location:** Debt report PF-2, plan Phase 6

The debt report identifies `src/app/api/cron/oj-projects-billing/route.ts` (3,434 lines, `maxDuration: 300`) as a performance risk due to function timeout potential and inability to unit test. The plan's Phase 3 decomposes 3 god objects (FohScheduleClient, receipts, private-bookings) but does NOT decompose the billing cron route, despite it being the 4th-largest file and having a 5-minute timeout.

The plan only addresses PF-2 indirectly through DS-2 (service layer boundaries), which is deferred as "ongoing architectural refactor."

**Recommendation:** Add the billing cron route decomposition to Phase 3 or Phase 6. A 3,434-line route handler with a 5-minute timeout is both a performance and reliability risk. At minimum, extract the billing logic into a service module so it can be tested and profiled independently.

---

### PERF-006 [MEDIUM] PF-5 (4 routes with maxDuration 300s) not addressed

**Location:** Debt report PF-5

The report identifies 4 routes with 300-second timeouts: `receipts/export`, `invoices/export`, `rota/resync-calendar`, `cron/event-guest-engagement`. The actual count from the codebase is also 4 routes at 300s (plus `oj-projects-billing`). The plan does not investigate why these routes need 5 minutes or propose background job processing.

The `rota/resync-calendar` route calls the same N+1 code in `resyncRotaCalendar()` -- fixing the N+1 (PERF-004) may reduce its runtime, but the plan does not connect these two items.

**Recommendation:** Add an investigation step to Phase 6 for the 300s-timeout routes. For export routes (`receipts/export`, `invoices/export`), evaluate streaming responses or background job + polling patterns. Note the connection between PF-1 (rota N+1) and PF-5 (rota resync 300s timeout).

---

### PERF-007 [LOW] CI pipeline will add 2-4 minutes with test coverage

**Location:** Plan Task 1.3 and Task 4.1

The plan adds `npm test` to CI (Task 1.3) and later upgrades to `npm run test:coverage` (Task 4.1). Currently CI runs lint + typecheck + build. With 252+ test files (growing to ~260 after Phase 4), the test step will add time.

Vitest is fast for unit tests, and these are primarily mock-based. Expected addition: 30-90 seconds for tests, plus ~30 seconds for coverage instrumentation. Total CI time should stay under the plan's target of 5 minutes for the `build-and-lint` job.

However, `test:coverage` generates coverage reports on every PR. If no coverage threshold is configured in `vitest.config.ts`, this is wasted compute. If a threshold IS set and the bar is too low, it provides false confidence.

**Recommendation:** This is acceptable. Ensure `vitest.config.ts` has a `coverage.thresholds` config with meaningful minimums. Consider running coverage only on main branch merges (not on every PR push) to keep PR feedback fast.

---

### PERF-008 [LOW] Missing performance opportunity: parallelise financial page fetches (TODO in code)

**Location:** `src/services/financials.ts:92`, debt report DC-1

The debt report lists a TODO at `financials.ts:92`: "Parallelise page fetches with Promise.all." The plan converts this TODO to a GitHub Issue (Task 6.5) but does not actually implement the fix. The current code does sequential pagination:

```typescript
for (let from = 0; ; from += RECEIPT_PAGE_SIZE) {
  const { data, error } = await supabase.from('receipt_transactions')...range(from, to);
}
```

This is a genuine performance issue for large datasets -- each page waits for the previous one. A two-pass approach (first query to get count, then parallel page fetches) would reduce latency proportionally to the number of pages.

**Recommendation:** Consider adding this to Phase 6 alongside the N+1 fixes, rather than deferring to a future issue. It is a straightforward parallel fetch pattern.

---

### PERF-009 [LOW] Missing performance opportunity: messages JS grouping (TODO in code)

**Location:** `src/app/actions/messagesActions.ts:66`, debt report DC-1

The TODO says: "Replace this JS-based conversation grouping with a `get_recent_conversations` RPC that groups by customer_id in SQL." Currently, 150 messages are fetched and grouped in JavaScript. This is not urgent (150 rows is small), but moving the grouping to SQL would reduce payload size and client-side CPU.

The plan converts this to a GitHub Issue but does not implement it.

**Recommendation:** Low priority but worth noting. The 150-row fetch limit is a reasonable mitigation for now.

---

## Coverage Matrix: Performance Debt Items

| ID | Description | Severity | Plan Coverage | Adequacy |
|----|-------------|----------|---------------|----------|
| PF-1 | N+1 query patterns (3 locations) | Medium | Task 6.2 | Partial -- 1 of 3 is not a real N+1 (PERF-002), 1 is impractical (PERF-003), 1 is correct (PERF-004) |
| PF-2 | 3,434-line billing cron route | Medium | Not addressed | Gap (PERF-005) |
| PF-3 | Weekly summary runs hourly | Medium | Task 5.4 | Adequate |
| PF-4 | 12,096-line generated types file | Low | Not addressed | Acceptable -- generated file, mitigation is IDE config |
| PF-5 | 4 routes with maxDuration 300s | Low | Not addressed | Gap (PERF-006) |

**Score: 2 of 5 performance items adequately addressed, 1 partially addressed, 2 not addressed.**

---

## Summary of Recommendations

| Finding | Severity | Action |
|---------|----------|--------|
| PERF-001 | High | Add explicit memoisation and render-performance sub-steps to FohScheduleClient decomposition |
| PERF-002 | High | Remove event-images.ts from N+1 fix task -- `getPublicUrl` is not a network call |
| PERF-003 | Medium | Deprioritise projects unique code fix; collision is near-impossible |
| PERF-004 | Medium | Add date window filter and grouping step to rota N+1 fix |
| PERF-005 | Medium | Add billing cron decomposition to the plan |
| PERF-006 | Medium | Investigate 300s-timeout routes; connect rota N+1 fix to resync timeout |
| PERF-007 | Low | Configure coverage thresholds; consider coverage-on-merge-only |
| PERF-008 | Low | Consider implementing financial page parallelisation in Phase 6 |
| PERF-009 | Low | Low priority; current 150-row limit is acceptable mitigation |

---

*Report generated by Performance Analyst agent as part of Codex QA review.*

### BUG-001: MGD cannot share the existing `Q{N}/{YYYY}` export contract without exporting the wrong date range
- **Spec Section:** 1, 3.3, 7.1-7.5 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L16](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L16), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L170](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L170), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L242](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L242))
- **Severity:** Critical
- **Category:** Logic
- **Description:** The spec plugs MGD into the existing quarterly export, but that export is calendar-quarter based while MGD is Feb-Apr / May-Jul / Aug-Oct / Nov-Jan. The current export UI/API already use Jan-Mar, Apr-Jun, Jul-Sep, Oct-Dec ([src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx#L42](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/receipts/_components/ui/ReceiptExport.tsx#L42), [src/app/api/receipts/export/route.ts#L233](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L233)).
- **Impact:** A `Q1 2026` bundle will be correct for receipts/expenses but wrong or misleading for MGD, because a single `Q/year` selector cannot represent both period systems.
- **Suggested fix:** Separate MGD return export from the calendar-quarter receipts bundle, or redefine the bundle to carry explicit date ranges plus a separately labelled MGD return period instead of a shared `Q/year`.

### BUG-002: “Single transaction” does not prevent concurrent mileage recalculations from corrupting annual totals
- **Spec Section:** 3.1, 4.1, 10 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L77](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L77), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L180](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L180), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L346](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L346))
- **Severity:** Critical
- **Category:** Race Condition
- **Description:** Manual trip saves and OJ trigger writes can recalculate the same tax year concurrently. Each transaction can read the same pre-threshold cumulative miles and then overwrite overlapping `mileage_trips` rows with stale amounts.
- **Impact:** Trips around 10,000 miles will intermittently get the wrong split, especially during rapid OJ inserts/updates/deletes or batch sync.
- **Suggested fix:** Route all mileage mutations through one SQL function that locks the affected tax year, applies the mutation, and recomputes ordered trips under that lock.

### BUG-003: The cumulative-mile calculation has no deterministic ordering for trips on the same date
- **Spec Section:** 3.1 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L77](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L77))
- **Severity:** High
- **Category:** Ambiguity
- **Description:** The spec says “all subsequent trips” must be recalculated, but it never defines the sort order beyond `trip_date`. Two trips on the same date near the threshold can be allocated different per-trip amounts depending on implementation order.
- **Impact:** Reimbursement records and exports become nondeterministic; editing or reimporting same-day trips can reshuffle which trip is shown as straddling the threshold.
- **Suggested fix:** Add an explicit stable ordering key for rate allocation, such as `trip_date + sequence_on_day` or `trip_date + immutable created_at/id`, and require all recalculations to use it.

### BUG-004: Moving a trip across the 5 April / 6 April boundary leaves one tax year stale
- **Spec Section:** 3.1 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L82](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L82))
- **Severity:** High
- **Category:** Logic
- **Description:** The spec only says to recalculate “the same tax year.” On update, a trip can move from one tax year to another, which means both the old year and the new year need recomputation.
- **Impact:** Later trips in the old year can remain stuck at £0.25 when they should move back to £0.45, or vice versa.
- **Suggested fix:** Specify that UPDATE logic compares `OLD` and `NEW` dates and recomputes both affected tax years whenever a trip crosses a tax-year boundary.

### BUG-005: The OJ sync design misses `entry_type` transitions in and out of mileage
- **Spec Section:** 3.1, 4.1 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L84](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L84), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L182](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L182))
- **Severity:** High
- **Category:** Logic
- **Description:** “UPDATE” is described as “update the corresponding row,” but the spec does not define behavior when an `oj_entries` row changes from non-mileage to mileage or from mileage to another type.
- **Impact:** The system can leave orphaned `mileage_trips` rows behind or fail to create them when a row becomes mileage later.
- **Suggested fix:** Define trigger behavior using both `OLD` and `NEW`: create on entering mileage, update on remaining mileage, delete on leaving mileage, and handle hard deletes separately.

### BUG-006: OJ “single-leg round trip” does not fit the proposed leg model
- **Spec Section:** 3.1, 4.1 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L84](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L84), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L86](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L86), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L182](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L182))
- **Severity:** High
- **Category:** Data Integrity
- **Description:** The spec says an OJ entry creates a “single-leg” trip but also says it represents `Anchor → destination → Anchor`. That is two legs, and OJ does not store a destination anyway.
- **Impact:** Implementation will either invent invalid leg rows, allow `NULL → NULL` pseudo-legs, or leave OJ trips without a coherent route representation for list/export.
- **Suggested fix:** Define OJ trips as either summary-only rows with no child legs, or add a dedicated synced-route representation that is explicitly exempt from manual leg rules.

### BUG-007: The distance-cache uniqueness rule is not enforceable with `NULL = The Anchor`
- **Spec Section:** 3.1 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L53](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L53), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L58](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L58))
- **Severity:** High
- **Category:** Edge Case
- **Description:** PostgreSQL unique constraints do not treat `NULL` values as equal, so `(NULL, destination)` can be inserted multiple times even if canonical ordering is applied.
- **Impact:** Anchor-to-destination cache entries can duplicate, causing inconsistent prefill and last-write-wins behavior on updates.
- **Suggested fix:** Replace `NULL` Anchor with a real sentinel destination ID, or use functional/partial unique indexes that normalize Anchor before uniqueness is checked.

### BUG-008: Multi-stop leg integrity is not enforceable from the current schema
- **Spec Section:** 3.1, 6 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L97](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L97), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L226](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L226))
- **Severity:** High
- **Category:** Data Integrity
- **Description:** `UNIQUE(trip_id, leg_order)` is the only hard rule. It does not guarantee contiguous ordering, a valid first/last leg, chain continuity, or reindexing when a middle stop is removed.
- **Impact:** A saved trip can end up with gaps like `1,3`, broken chains like `A -> B` followed by `C -> Anchor`, or stale downstream legs after stop deletion.
- **Suggested fix:** Require the save action to replace the full leg set atomically and validate contiguous `1..N` ordering, `first.from IS NULL`, `last.to IS NULL`, and `leg_n.to = leg_n+1.from`.

### BUG-009: `rate_per_mile`, the live total, and CSV export are self-contradictory for threshold-crossing trips
- **Spec Section:** 3.1, 6, 7.3 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L81](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L81), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L235](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L235), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L295](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L295))
- **Severity:** High
- **Category:** Logic
- **Description:** The spec stores `£0.45` in `rate_per_mile` for a split trip, shows a live total as `miles × current rate`, and exports a single “Rate (£/mi)” column. For a threshold-crossing trip, those surfaces no longer reconcile to `amount_due`.
- **Impact:** Users will see/export records like `100 miles @ £0.45` with `£35.00` due, which looks wrong and is hard to audit.
- **Suggested fix:** Replace the single display rate with an effective rate plus a split note, or store/export `miles_at_45` and `miles_at_25`; the live preview must call the same split-calculation logic used on save.

### BUG-010: `total_miles` can drift away from the leg rows
- **Spec Section:** 3.1, 6 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L68](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L68), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L236](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L236))
- **Severity:** Medium
- **Category:** Data Integrity
- **Description:** The parent trip stores `total_miles`, but the child legs also store miles and no DB rule guarantees the two stay equal.
- **Impact:** Threshold calculation, list totals, and exports can disagree depending on which field an implementation reads.
- **Suggested fix:** Make `total_miles` derived from the legs in the same transaction, or enforce a trigger/check that recalculates the parent total from child rows before commit.

### BUG-011: The Nov-Jan MGD period is under-specified at the year boundary
- **Spec Section:** 3.3, 10 ([docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L170](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L170), [docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L347](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md#L347))
- **Severity:** Medium
- **Category:** Ambiguity
- **Description:** The cycle names are given, but the spec never states the exact mapping rule for January dates or how the period year is labelled. `2026-01-31` should belong to `2025-11-01 → 2026-01-31`, but that is not written down.
- **Impact:** A naive implementation can map January collections into the wrong return row or label the return inconsistently in UI/export.
- **Suggested fix:** Add an explicit month-to-period mapping table with examples, including `31 Jan`, and define whether return labels use start year, end year, or both.

No additional material defects stood out in the expense receipt naming/storage design or the basic `net_take * 0.20` MGD formula itself.
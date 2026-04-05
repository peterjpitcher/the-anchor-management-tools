# Performance Analyst Report: Mileage, Expenses & MGD Design Spec

**Date:** 2026-04-05
**Spec:** `docs/superpowers/specs/2026-04-05-mileage-expenses-mgd-design.md`
**Scale assumptions:** ~200 mileage trips/year, ~600 expenses/year, ~25 MGD collections/year, single pub

---

## Findings

### PERF-001: Quarterly export ZIP could exceed Vercel function timeout with hundreds of expense receipt images
- **Spec Section:** 7.1 ZIP Bundle Structure, 8.1 Upload Flow
- **Severity:** High
- **Category:** Export
- **Impact:** Export hangs or times out for quarters with many expense receipts; user sees a failed download
- **Description:** The existing export route has `maxDuration = 300` (5 minutes) and downloads receipt images from Supabase storage at a concurrency of 4. The spec adds expense receipt images on top of existing receipt files. A busy quarter could have 150 expenses with 1-3 images each (150-450 files). Each Supabase storage download takes 100-500ms depending on file size. At 450 files with concurrency 4, the download phase alone could take 45-112 seconds, plus the existing receipt downloads. Combined with PDF generation, 3 new CSVs, and ZIP compression, the 300-second budget is tight but probably survivable at this scale. However, each downloaded image is held in memory as a Buffer before being appended to the archiver. With optimised images (max 2000px, 80% quality), each is roughly 200-500KB. At 450 images, that is 90-225MB of buffers in memory simultaneously, which could cause heap pressure on a 1024MB Vercel function.
- **Suggested fix:** (1) Stream expense receipt images directly into the archiver instead of buffering the entire file first -- download the blob and pipe it rather than calling `arrayBuffer()` then `Buffer.from()`. (2) Increase `DOWNLOAD_CONCURRENCY` to 6-8 for the image-only phase since expense receipts are smaller than full receipt scans. (3) Consider generating the expense-receipts portion in batches, appending to the archive and allowing GC between batches. (4) Add a progress indicator or async job pattern if the export consistently approaches 4+ minutes.

### PERF-002: Mileage HMRC rate recalculation cascades on every trip mutation
- **Spec Section:** 3.1 Mileage (HMRC rate logic)
- **Severity:** Medium
- **Category:** Database
- **Impact:** Saving or deleting a trip causes a brief delay while all subsequent trips in the tax year are recalculated
- **Description:** The spec says "on any trip INSERT, UPDATE, or DELETE, all subsequent trips in the same tax year must have their rates and amounts recalculated." At 200 trips/year, editing a trip from April (the start of the tax year) means recalculating up to 200 rows. Each recalculation needs cumulative miles up to that trip, then recomputes `rate_per_mile` and `amount_due`. If done naively (one query per trip), this is 200 sequential updates. Even in a single transaction, this could take 1-2 seconds on Supabase.
- **Suggested fix:** Use a single SQL CTE/window function approach: compute cumulative miles for all trips in the tax year in one query using `SUM(total_miles) OVER (ORDER BY trip_date, created_at ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`, then apply the HMRC rate logic in the same statement and batch-update all affected rows. This turns N sequential queries into 1 query. At 200 rows this is comfortably under 100ms.

### PERF-003: OJ-Projects sync trigger performs HMRC rate calculation inside a PL/pgSQL trigger
- **Spec Section:** 4.1 Mileage Sync (OJ-Projects trigger)
- **Severity:** Medium
- **Category:** Database
- **Impact:** Every OJ-Projects mileage entry INSERT/UPDATE/DELETE adds latency to the OJ-Projects server action; potential for deadlocks if the trigger and a manual mileage edit race on the same tax year
- **Description:** The spec places a trigger on `oj_entries` that creates/updates `mileage_trips` rows and applies HMRC rate calculations. This means: (a) the OJ-Projects entry save now has a hidden dependency on the mileage module -- if the HMRC recalculation (PERF-002) is done inside the trigger, every OJ-Projects mileage entry save recalculates all subsequent trips in the tax year; (b) the trigger runs in the same transaction as the OJ-Projects mutation, so any slowness or lock contention in `mileage_trips` blocks the OJ-Projects save; (c) if HMRC recalculation acquires row-level locks on `mileage_trips`, a concurrent manual mileage edit could deadlock.
- **Suggested fix:** (1) Keep the trigger lightweight -- only INSERT/UPDATE/DELETE the single `mileage_trips` row for the synced entry. (2) Defer the HMRC rate recascade to the server action layer, not the trigger. The mileage server action already needs the recalculation logic (PERF-002); call it after the OJ-Projects save completes, or use `pg_notify` to trigger an async recalculation. (3) If the trigger must do the rate calculation, use the CTE approach from PERF-002 and add an advisory lock on the tax year to prevent concurrent recalculations.

### PERF-004: Claim Summary PDF generation adds blocking work to the export route
- **Spec Section:** 7.2 Claim Summary PDF
- **Severity:** Low
- **Category:** Export
- **Impact:** Adds 0.5-2 seconds to export time; negligible in isolation but contributes to the PERF-001 timeout budget
- **Description:** The spec calls for server-side PDF generation using `pdfkit` or `@react-pdf/renderer`. Generating a simple summary PDF is fast (under 1 second for a page or two), but `@react-pdf/renderer` pulls in a React rendering pipeline and is significantly heavier than `pdfkit`. At this scale, the PDF itself is not a bottleneck, but library choice matters.
- **Suggested fix:** Use `pdfkit` (lightweight, streaming-capable) rather than `@react-pdf/renderer`. Pipe the PDF output directly into the archiver stream rather than buffering the entire PDF in memory first. This keeps the PDF generation off the critical path for memory.

### PERF-005: Server-side sharp image processing blocks the server action during upload
- **Spec Section:** 8.1 Upload Flow
- **Severity:** Low
- **Category:** Processing
- **Impact:** Upload of a large HEIC photo (10-15MB) could block the server action for 2-5 seconds while sharp resizes and converts it
- **Description:** The spec says images are processed server-side via `sharp` -- resize to 2000px, compress to 80%, HEIC-to-JPEG conversion. Sharp is native and fast, but HEIC decoding is the most expensive operation. A 15MB HEIC file from an iPhone could take 2-5 seconds to decode and re-encode. During this time, the server action is blocked. With multiple files uploaded at once, this compounds.
- **Suggested fix:** (1) Process images in parallel using `Promise.all` when multiple files are uploaded. (2) Add a client-side file size limit (e.g., 20MB) with a user-friendly error to prevent unexpectedly huge files. (3) Consider a reasonable timeout on the sharp operation (10 seconds) with a fallback to storing the original if processing fails. At this scale (a few uploads per day), this is a minor UX concern rather than a system issue.

### PERF-006: Distance cache canonical pair lookup is fine at this scale
- **Spec Section:** 3.1 mileage_destination_distances
- **Severity:** Low (informational)
- **Category:** Database
- **Impact:** Negligible -- included for completeness
- **Description:** The canonical pair ordering (smaller UUID first) requires normalisation on every lookup. With ~43 destinations and at most ~900 possible pairs, this table is tiny. A simple `WHERE (from_destination_id = $1 AND to_destination_id = $2) OR (from_destination_id = $2 AND to_destination_id = $1)` query, or application-side normalisation before a single-condition lookup, runs in sub-millisecond time. The UNIQUE constraint provides the index.
- **Suggested fix:** No change needed. Application-side normalisation (sort the two UUIDs, use NULL-first convention) before querying is the cleanest approach and avoids the OR condition. This is already implied by the spec's "store with the smaller UUID first" constraint.

### PERF-007: MGD return recalculation trigger is negligible at this scale
- **Spec Section:** 3.3 MGD (Totals recalculated on each collection mutation)
- **Severity:** Low (informational)
- **Category:** Database
- **Impact:** Negligible -- included for completeness
- **Description:** With ~25 collections per year and 4 quarterly returns, each trigger fires an aggregate query over at most 6-8 rows per quarter. This is sub-millisecond work.
- **Suggested fix:** No change needed. A simple `SUM()` aggregate with a date range filter on a handful of rows is perfectly fine as a trigger. Ensure the trigger uses `AFTER` (not `BEFORE`) so it sees the committed state.

---

## Summary

| ID | Severity | One-liner |
|----|----------|-----------|
| PERF-001 | **High** | Expense receipt images could push quarterly export past memory/timeout limits |
| PERF-002 | **Medium** | HMRC rate cascade should use a single CTE, not per-row queries |
| PERF-003 | **Medium** | OJ-Projects trigger should be lightweight; defer rate cascade |
| PERF-004 | **Low** | Use pdfkit (not @react-pdf/renderer) and stream into archiver |
| PERF-005 | **Low** | Sharp HEIC conversion can block for seconds; process files in parallel |
| PERF-006 | **Low** | Distance cache lookup is fine at this scale |
| PERF-007 | **Low** | MGD return recalculation is fine at this scale |

**Bottom line:** The only finding that could cause a user-visible failure is PERF-001 (export timeout/memory with many expense receipt images). PERF-002 and PERF-003 are worth addressing in the implementation to avoid unnecessary latency, but neither would cause failures at this scale. Everything else is informational.

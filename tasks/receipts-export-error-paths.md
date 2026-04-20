# Receipts Export Error Path Trace

All throw/error paths that bubble up to the outer `try/catch` in `route.ts` line 198.

---

## 1. `route.ts` — Main Route Handler

| Line | Error Source | Description |
|------|-------------|-------------|
| 45 | `checkUserPermission()` | Async call — could reject if Supabase is unreachable or the RBAC query fails internally. Caught by outer try/catch. |
| 50 | `new URL(request.url)` | Could throw `TypeError` if `request.url` is malformed (extremely unlikely from Next.js). |
| 54 | `receiptQuarterExportSchema.safeParse()` | Safe — `.safeParse` never throws, returns `{ success: false }`. NOT a throw risk. |
| 66 | `createAdminClient()` | Synchronous. Could throw if `SUPABASE_SERVICE_ROLE_KEY` or `NEXT_PUBLIC_SUPABASE_URL` env vars are missing (Supabase client construction fails). |
| 67-73 | Supabase query `.from('receipt_transactions').select(...)` | Returns `{ error }` — handled at line 75. NOT a throw. However, the `.select('*, receipt_files(*)')` FK join will silently return `null` for `receipt_files` if the FK relationship doesn't exist (Supabase returns error in `error` field). |
| 81 | `buildSummaryCsv()` | Sync-heavy, but `Papa.unparse()` at line 275 could throw if given unexpected input (very unlikely with string arrays). |
| 83 | `archiver('zip', ...)` | Could throw if archiver module fails to initialise. |
| 124 | `supabase.storage.from().download()` | Inside a task closure — if the download promise rejects unexpectedly (network error, not a Supabase error response), it would propagate through `runWithConcurrency` → `Promise.all` at line 389 → caught by outer try/catch. Note: Supabase storage normally returns `{ error }` not a rejection. |
| 130 | `normaliseToBuffer()` | `(data as Blob).arrayBuffer()` at line 368 could reject if the Blob is corrupted. Would propagate up from the task. |
| 138 | `runWithConcurrency()` | `Promise.all` at line 389 propagates any unhandled rejection from a download task. |
| 146-150 | `Promise.all([buildMileageCsv, buildExpensesCsv, buildMgdCsv])` | **KEY THROW POINT** — any of these three can `throw new Error(...)`. See sections 2-4. If ANY one throws, the entire `Promise.all` rejects. |
| 153 | `mileageResult.csv` | If `buildMileageCsv` threw, we never reach here. But if the result shape was wrong (undefined), accessing `.csv` would throw `TypeError`. Unlikely given TS typing. |
| 165 | `appendExpenseImages()` | Could throw if the Supabase query at expense-images.ts:43 rejects (network-level, not error-field). The individual download tasks are try/caught internally (line 81-83), so individual download failures are safe. |
| 168 | `appendClaimSummaryPdf()` | **KEY THROW POINT** — see section 6. The `new PDFDocument()` constructor and font operations can throw. |
| 184 | `archive.finalize()` | Could throw/reject if the archive is in a bad state (e.g., already finalized, or a stream error occurred). |
| 185 | `streamDone` promise | Rejects if `passthrough.on('error', reject)` fires — i.e., the PassThrough stream encounters an error during archiving. |

---

## 2. `mileage-csv.ts` — `buildMileageCsv()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 56-78 | Supabase query | Returns `{ error }`. |
| **82** | **`throw new Error('Failed to load mileage data for export')`** | **Explicit throw** when Supabase returns an error. Bubbles to `Promise.all` in route.ts:146. |
| 89 | `getTaxYearBounds(startDate)` | Called with `startDate` which is a `YYYY-MM-DD` string. See section 8 for analysis. **Could produce `NaN` if `startDate` is malformed**, but will not throw. |
| 90-94 | Second Supabase query (tax year miles) | Returns `{ data, error }` but **error is not checked**. If this query fails, `taxYearTrips` is `null`, and line 96 uses `?? []` so it degrades to 0 miles. NOT a throw. |
| 71 | FK join `mileage_destinations!mileage_trip_legs_from_destination_id_fkey` | If the FK name is wrong, Supabase returns an error in the main query's `error` field (line 80), which triggers the throw at line 82. |
| 163 | `buildCsvBuffer()` | See section 7. |

---

## 3. `expenses-csv.ts` — `buildExpensesCsv()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 45-50 | Supabase query | Returns `{ error }`. |
| **54** | **`throw new Error('Failed to load expenses data for export')`** | **Explicit throw** when Supabase returns an error. |
| 47 | FK join `expense_files ( id )` | Implicit FK. If the relationship doesn't exist, Supabase returns error, triggers throw at line 54. |
| 103 | `buildCsvBuffer()` | See section 7. |

---

## 4. `mgd-csv.ts` — `buildMgdCsv()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 63 | `getCalendarQuarterMgdOverlap()` | Pure switch statement, always returns for valid quarter 1-4. Cannot throw. The TS type `1 | 2 | 3 | 4` ensures exhaustiveness. |
| 65-70 | Supabase query | Returns `{ error }`. |
| **74** | **`throw new Error('Failed to load MGD data for export')`** | **Explicit throw** when Supabase returns an error. |
| 127 | `buildCsvBuffer()` | See section 7. |

---

## 5. `expense-images.ts` — `appendExpenseImages()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 43-48 | Supabase query with FK join `expenses!expense_files_expense_id_fkey` | Returns `{ error }`. Error is handled at line 50: logs and returns 0. **Does NOT throw.** |
| 45 | FK join syntax | If FK name is wrong, Supabase returns error → handled gracefully (returns 0). |
| 66-73 | Individual storage downloads | Wrapped in try/catch at line 81-83. Failures are logged and skipped. **Does NOT throw.** |
| 75 | `normaliseToBuffer()` | Inside the try/catch. Safe. |
| 86 | `runWithConcurrency()` | Individual tasks are try/caught. However, if `queue.shift()` returns undefined and `await task()` is called on undefined — but the `if (!task) return` guard at line 202 prevents this. Safe. |

**Verdict: `appendExpenseImages` is defensively coded and will NOT throw to the caller.** It degrades gracefully to returning 0.

---

## 6. `claim-summary-pdf.ts` — `appendClaimSummaryPdf()`

| Line | Error Source | Description |
|------|-------------|-------------|
| **38** | **`new PDFDocument({...})`** | pdfkit constructor. Could throw if pdfkit cannot load its bundled AFM font metrics files. This happens in serverless environments where the `pdfkit/js/data` directory is not included in the bundle. **This is the most likely runtime failure in the entire flow.** |
| **61** | **`.font('Helvetica-Bold')`** | pdfkit built-in font. If the AFM data for Helvetica-Bold is missing from the bundle, this throws synchronously. |
| 50 | `doc.pipe(passthrough)` | Stream pipe — could throw if doc is in error state. |
| 56 | `passthrough.on('error', reject)` | If the passthrough stream errors, the promise rejects. Bubbles up to route.ts. |
| 191 | `doc.end()` | Could throw if doc is in error state. |
| 194 | `passthrough.on('end', resolve)` | If the PDF generation completed but the stream never ends (broken pipe), the promise hangs forever — **potential timeout, not a throw**. |
| 71 | `quarterMonthRange(quarter)` | Pure lookup, returns `''` for invalid quarter. Cannot throw. |

**Key risk: pdfkit font loading.** pdfkit bundles Helvetica AFM data as files. In Vercel serverless, if tree-shaking or bundling excludes `node_modules/pdfkit/js/data/*.afm`, the constructor or `.font()` calls throw `Error: ENOENT: no such file or directory`.

---

## 7. `csv-helpers.ts` — `buildCsvBuffer()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 48 | `Papa.unparse(rows, { newline: '\n' })` | Could throw `TypeError` if `rows` is not an array. In practice, always called with `string[][]`. **Extremely unlikely to throw.** |
| 49 | `Buffer.from(...)` | Cannot throw with a valid string argument. |

**Verdict: Effectively safe. No realistic throw paths.**

---

## 8. `hmrcRates.ts` — `getTaxYearBounds()`

| Line | Error Source | Description |
|------|-------------|-------------|
| 34 | `tripDate.split('-')` | **Could throw `TypeError`** if `tripDate` is `undefined` or `null`. In the export flow, called with `startDate` from `deriveQuarterRange()` which always returns a valid `YYYY-MM-DD` string. |
| 35-37 | `parseInt(yearStr, 10)` etc. | Returns `NaN` if the string is not numeric, but **does not throw**. Subsequent arithmetic with `NaN` produces `NaN`, leading to tax year bounds like `"NaN-04-06"`. This would cause the follow-up Supabase query to return 0 rows (dates don't match), resulting in 0 tax year miles. **Silent data error, not a crash.** |

**Verdict: Cannot throw in the export flow** because `startDate` is always well-formed. However, if ever called with malformed input, it silently produces garbage rather than throwing.

---

## Summary: Ranked Throw Risks

| Priority | Source | Line | Throws? | Impact |
|----------|--------|------|---------|--------|
| **1** | `claim-summary-pdf.ts` — `new PDFDocument()` / `.font()` | 38, 61 | Yes — ENOENT if AFM fonts not bundled | Kills entire export for super_admin |
| **2** | `mileage-csv.ts` — Supabase query error | 82 | Explicit `throw` | Kills entire export (Promise.all) |
| **3** | `expenses-csv.ts` — Supabase query error | 54 | Explicit `throw` | Kills entire export (Promise.all) |
| **4** | `mgd-csv.ts` — Supabase query error | 74 | Explicit `throw` | Kills entire export (Promise.all) |
| **5** | `route.ts` — `archive.finalize()` | 184 | Possible if archive errored | Kills entire export |
| **6** | `route.ts` — `streamDone` promise | 185 | Rejects on stream error | Kills entire export |
| **7** | `route.ts` — `createAdminClient()` | 66 | Missing env vars | Kills entire export |
| **8** | `route.ts` — `checkUserPermission()` | 45 | Network/DB failure | Kills entire export |
| **9** | `route.ts` — storage download in task | 124-130 | Unexpected rejection | Kills entire export |
| **10** | `mileage-csv.ts` FK join name mismatch | 71 | Via Supabase error → throw | Kills entire export |

### Paths that are safe (do NOT throw):
- `appendExpenseImages` — fully try/caught internally
- `buildCsvBuffer` — pure transformation, no realistic failure
- `getTaxYearBounds` — no throw, but can produce NaN silently
- `getCalendarQuarterMgdOverlap` — exhaustive switch
- `deriveQuarterRange` — pure arithmetic
- `escapeCsvCell` — pure string operation

### Unhandled error at mileage-csv.ts line 90-94:
The second Supabase query (tax year cumulative miles) does **not** check `error`. If this query fails, the error is silently swallowed and `taxYearTotalMiles` defaults to 0. This is a **silent data correctness bug** — the CSV and PDF will show 0 cumulative tax year miles without any indication of failure.

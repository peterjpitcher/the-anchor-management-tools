**Critical**
1. Archive-side failures can leave the export request hanging instead of rejecting.
Affected: [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L52), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L195), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L94), [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/receipts/export/route.ts#L184)
Why it matters: `appendClaimSummaryPdf()` resolves when the PDF source stream ends, not when archiver has successfully incorporated the entry. In a failure path, the PDF promise can resolve, `archive` only logs the error, and `archive.finalize()` never settles, so the request hangs until timeout.
Suggested fix: Treat `archive` errors as fatal and wire them into the awaited control flow. Use an `archiveError`/`archiveDone` promise in the route, and either make `appendClaimSummaryPdf()` observe `archive` failure too or generate the PDF fully before `archive.append()`.

**High**
2. `addRow()` leaks `doc.x` into later sections, so subsequent free-positioned text starts in the right column.
Affected: [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L218), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L113), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L121), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L150), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L167)
Why it matters: after each row, `doc.x` remains `350`. That pushes section headings, the footer heading, and the supporting-documents text toward the right margin; some of that content can wrap badly or render partially off-page.
Suggested fix: Render rows from a captured `rowY`, then explicitly restore `doc.x` to `doc.page.margins.left` and set `doc.y` for the next row. A small table helper is safer than relying on ambient cursor state.

3. `addRow()` anchors the value to the label’s post-wrap cursor, so long labels/values misalign and page-break incorrectly.
Affected: [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L218), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L220)
Why it matters: the value is drawn at `doc.y - doc.currentLineHeight()` after the label has already advanced `doc.y`. For wrapped text, the value aligns with the label’s last line, not the row start. Near the page bottom, long rows can jump pages and become unreadable.
Suggested fix: Measure both cells from the same starting Y with `heightOfString()`, use `rowHeight = Math.max(...)`, draw both at the original Y, then advance once. Add a page-break check before drawing rows that will not fit.

4. “Tax year cumulative miles” is calculated for the whole tax year, not for the tax year up to the quarter end.
Affected: [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L87), [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L94), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L108)
Why it matters: the PDF and mileage CSV can overstate cumulative miles whenever there are later trips in the same tax year. That makes the HMRC-threshold context misleading.
Suggested fix: query from `taxYear.start` through `endDate` (or `min(endDate, taxYear.end)`), and fail the export if that second query errors.

**Medium**
5. Monetary totals are accumulated in binary floating point and only rounded at display time.
Affected: [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L96), [expenses-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/expenses-csv.ts#L60), [mgd-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mgd-csv.ts#L80), [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L159)
Why it matters: repeated float addition can drift by 1p, so summary totals and the grand total can differ from the sum of displayed row values.
Suggested fix: sum in integer pence, or round after each addition with a dedicated money helper before formatting.

6. Expenses CSV rows can show VAT on entries marked as not VAT-applicable.
Affected: [expenses-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/expenses-csv.ts#L61), [expenses-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/expenses-csv.ts#L96)
Why it matters: the summary excludes VAT when `vat_applicable` is false, but row data always writes `vat_amount`. That can make the detail CSV contradict its own summary and the PDF’s reclaimable-VAT figure.
Suggested fix: emit `0.00` or blank when `vat_applicable` is false, or normalize the source data before both row and summary generation.

**Low**
7. `addRow()` does not restore the caller’s prior font state; bold rows hard-reset to `Helvetica`.
Affected: [claim-summary-pdf.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/claim-summary-pdf.ts#L214)
Why it matters: current callers mostly use Helvetica, so this is latent, but the helper is brittle and will leak style if reused from a differently styled section.
Suggested fix: save and restore the prior font, or make `addRow()` set both label and value fonts explicitly without mutating ambient state.

8. Mileage CSV summary rows format miles with the currency formatter.
Affected: [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L127), [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L129), [mileage-csv.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/receipts/export/mileage-csv.ts#L132)
Why it matters: the summary uses money-style two-decimal formatting for distance, while row data and the PDF use mileage-style formatting. It is a consistency bug in the exported CSV.
Suggested fix: add a dedicated `formatMiles()` helper for summary fields and keep `formatCurrency()` for GBP only.

No empty-array crash stood out in these paths; the zero-data case mostly produces zeroed summaries. I also did not find a separate fill-color leak in the current PDF flow; the main cross-section state leak is the cursor position.
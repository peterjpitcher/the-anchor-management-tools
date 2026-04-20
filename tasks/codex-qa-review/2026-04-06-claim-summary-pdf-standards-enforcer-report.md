# Standards Enforcer Report — Claim Summary PDF Redesign

**Spec**: `docs/superpowers/specs/2026-04-06-claim-summary-pdf-redesign.md`
**Date**: 2026-04-06
**Reviewer**: Standards Enforcer (automated)

---

## Overall Verdict

The spec is broadly well-scoped and consistent with the project's conventions. Several lower-priority issues need attention before implementation begins, and one medium-priority concern around date handling requires a decision.

---

## PASS — Architecture & File Structure

- The files listed in the "Files Modified" table exactly match the files that exist in the codebase. No phantom files referenced.
- The change is correctly confined to `src/lib/receipts/export/` and `src/app/api/receipts/export/route.ts`. No other modules need to change.
- Keeping `drawTable` as a private helper inside `claim-summary-pdf.ts` (not a shared component) is correct. This is a pdfkit-specific utility with no other consumers.
- The `appendClaimSummaryPdf` function is correctly server-side only (no `'use client'`). It lives in a pure Node.js module — no RSC boundary concerns.
- The route file uses `export const runtime = 'nodejs'` already, so pdfkit's Node.js stream usage remains compatible.

---

## PASS — Data Flow Pattern

- The spec's proposed data-flow change (adding `rows` to each CSV builder's return value alongside the existing `csv` and `summary`) is consistent with the pattern already used. All three builders (`buildMileageCsv`, `buildExpensesCsv`, `buildMgdCsv`) already accumulate typed `rows` arrays internally — the spec simply asks them to surface those arrays in the return type rather than re-querying.
- The approach avoids a second database round-trip, which is correct. The alternative (querying from the PDF module directly) would require passing `supabase` into `appendClaimSummaryPdf`, violating the current separation of concerns where the PDF module is a pure rendering layer.
- Passing rows through `ClaimSummaryInput` as an extended interface is the right pattern. The existing `ClaimSummaryInput` interface is self-contained — extending it with `mileageRows`, `expensesRows`, `mgdRows` fields follows the same shape.

---

## PASS — TypeScript & Typing

- `MileageTripRow`, `ExpenseRow`, and `MgdCollectionRow` are currently declared as non-exported (`interface`, not `export interface`) in their respective modules. The spec correctly identifies that these must be exported. This is a straightforward change with no downstream risk.
- The spec does not introduce any `any` types. Row type re-use from the CSV modules keeps types DRY.
- Return type change for all three builders — from `Promise<{ csv: Buffer; summary: T }>` to `Promise<{ csv: Buffer; summary: T; rows: TRow[] }>` — is additive and backward-compatible. The call site in `route.ts` already destructures these results; adding `rows` to the destructuring is non-breaking.

---

## MEDIUM CONCERN — Date Rendering in PDF Uses Raw `new Date()` / `toLocaleString`

- **Current code** (line 81 of `claim-summary-pdf.ts`) uses `new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' })` for the "Generated" timestamp. This is a direct `new Date()` call, which the workspace CLAUDE.md prohibits for user-facing output: *"Never use raw `new Date()` or `.toISOString()` for user-facing dates — default timezone: Europe/London — use dateUtils."*
- **The spec does not address this.** It reproduces the same pattern in the redesigned header without flagging the violation.
- **Fix before implementation**: The generated timestamp should use `formatDateInLondon()` (or equivalent) from `src/lib/dateUtils.ts`. Check that `dateUtils` exports a suitable datetime formatter. If it only formats dates (not datetimes), a new `formatDatetimeInLondon()` utility should be added there, not inline in the PDF module.
- The detail table renderers will also format row dates. The spec says data is "sorted by date ascending" but does not specify how dates are rendered in the PDF table. The CSV builders use `formatDateDdMmYyyy` from `csv-helpers.ts` for this purpose — the PDF should reuse the same helper (or `dateUtils`) rather than introducing a third formatting path.

---

## LOW CONCERN — Hardcoded Hex Colour in `#666666`

- `claim-summary-pdf.ts` already uses `fillColor('#666666')` (lines 81, 127). The workspace CLAUDE.md states: *"No hardcoded hex colours — use design tokens."* However, pdfkit has no concept of CSS design tokens, so this rule cannot be applied literally. The spec does not introduce new colour values beyond what already exists.
- **Recommendation**: Add a short comment in the file acknowledging that pdfkit forces inline colour values and these are intentional. This prevents a future linting rule or reviewer flagging them incorrectly.

---

## LOW CONCERN — `generateTimestamp` Inline Logic Duplication Risk

- The spec adds a "Payment reference" field (e.g. "Mileage Expenses 2025 Q4"). This string is constructed from `year` and `quarter`, which are already in scope. No issue. But if this same reference string is needed elsewhere (e.g. email notifications, bank transfer instructions), it should be extracted to a shared utility rather than built inline. The spec treats it as PDF-only for now, which is fine — just flag as future debt.

---

## LOW CONCERN — `drawTable` Page-Break Logic Not Fully Specified

- The spec says: *"Handles page breaks by checking remaining page height before each row and calling `doc.addPage()` when needed, re-drawing the table header on the new page."*
- This is correct in principle but the spec does not define what "remaining page height" means in concrete terms (i.e. what threshold triggers a page break). pdfkit exposes `doc.page.height`, `doc.page.margins`, and `doc.y` — the implementer will need to calculate `remainingHeight = doc.page.height - doc.page.margins.bottom - doc.y`. This is an implementation detail, but the spec should at least document the expected minimum row height constant to ensure consistency across all three tables (mileage, expenses, MGD). Suggest adding this to the spec before implementation.

---

## LOW CONCERN — `MileageTripLegRow` Not Needed by PDF

- `MileageTripRow` has an optional `mileage_trip_legs` field (used by `buildRouteDescription` in the CSV module). The PDF detail table only needs: `trip_date`, route string (already computed by `buildRouteDescription`), `total_miles`, `amount_due`.
- If `rows: MileageTripRow[]` is passed directly to the PDF, the PDF module will receive the full interface including leg data it doesn't need. This is not a bug, but it couples the PDF to the full query shape.
- **Recommendation**: Either (a) pass pre-formatted row objects (date, route string, miles, amount) instead of raw `MileageTripRow[]`, or (b) accept it and document that `buildRouteDescription` must be called inside the PDF module (requiring it to be exported from `mileage-csv.ts`). The spec currently does neither — it implies the PDF receives raw `MileageTripRow[]` but does not say how route descriptions are generated for the PDF table.
- This is a **spec gap** that must be resolved before implementation to avoid duplicating `buildRouteDescription` logic.

---

## LOW CONCERN — `ExpenseRow.expense_files` in PDF Context

- Similar to the mileage concern above: `ExpenseRow` includes `expense_files?: Array<{ id: string }>` which is irrelevant to the PDF. This is harmless but the spec should clarify whether raw `ExpenseRow[]` or a leaner projected type is passed.

---

## NO ISSUE — Server Action / Auth

- `appendClaimSummaryPdf` is not a server action — it's a pure rendering utility called from within an already-authenticated route handler (`GET /api/receipts/export`). No auth re-check is needed here. Correct.
- The enhanced bundle (including the PDF) is already gated behind `isSuperAdmin` in `route.ts`. The spec correctly scopes this as an existing gate — no new permission surface.

---

## NO ISSUE — Audit Logging

- PDF generation is a read/export operation, not a mutation. No `logAuditEvent()` call is required. The existing audit pattern in the codebase applies to creates, updates, and deletes only.

---

## Summary Table

| Area | Status | Priority |
|------|--------|----------|
| Architecture & file scope | PASS | — |
| Data flow (rows passthrough) | PASS | — |
| TypeScript typing | PASS | — |
| Date handling (Generated timestamp + table rows) | CONCERN | Medium |
| Hardcoded hex colours (pdfkit limitation) | CONCERN | Low |
| `drawTable` page-break threshold not specified | CONCERN | Low |
| Route description in PDF — spec gap | CONCERN | Low (blocks implementation) |
| `ExpenseRow.expense_files` in PDF context | CONCERN | Low |
| Auth / permissions | PASS | — |
| Audit logging | PASS | — |

---

## Recommended Actions Before Implementation

1. **[Medium]** Decide how the "Generated" timestamp and row dates are formatted in the PDF. Either use `formatDateInLondon()` from `dateUtils.ts` or, if a datetime formatter doesn't exist there, add one. Update the spec to specify the formatter.
2. **[Low — blocks impl]** Clarify in the spec whether `buildRouteDescription` is exported from `mileage-csv.ts` and called by the PDF module, or whether the PDF receives pre-formatted strings. This must be resolved before writing the PDF code.
3. **[Low]** Add a concrete page-break threshold constant to the spec (e.g. `MIN_ROW_HEIGHT = 18` points) so all three table renderers are consistent.
4. **[Low]** Add a comment in the implementation about intentional inline pdfkit colours to prevent future reviewer confusion.

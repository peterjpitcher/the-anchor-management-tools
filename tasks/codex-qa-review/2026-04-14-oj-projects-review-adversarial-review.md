# Adversarial Review: OJ Projects Spec

**Date:** 2026-04-14
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** OJ Projects section — bugs, client statement, payment receipts, completeness
**Spec:** docs/superpowers/specs/2026-04-14-oj-projects-review-design.md

## Inspection Inventory

### Inspected
- All 6 OJ Projects UI pages under `src/app/(authenticated)/oj-projects/`
- All 8 server action files under `src/app/actions/oj-projects/`
- `src/app/actions/invoices.ts` — `recordPayment()`, `sendRemittanceAdviceForPaidInvoice()`
- `src/types/oj-projects.ts` and `src/types/invoices.ts` — full type definitions
- `src/app/api/cron/oj-projects-billing/route.ts` — function inventory, split logic, statement mode, cap handling
- `src/lib/invoice-template-compact.ts` — `InvoiceDocumentKind`, remittance rendering
- `src/lib/microsoft-graph.ts` — email send paths, PDF generation
- `src/lib/pdf-generator.ts` — `generateInvoicePDF()`, `generatePDFFromHTML()`
- 10 OJ-related Supabase migrations including core, one_off, constraint relaxation, statement_mode
- `src/app/actions/oj-projects/client-balance.ts` — full balance computation logic
- `src/services/invoices.ts` — `InvoiceService`, status transitions

### Not Inspected
- Full 3,434 lines of billing cron (sampled key sections: split logic, statement mode, entry filtering)
- Invoice email logging schema (`invoice_email_logs` table structure — inferred from usage patterns)
- RLS policies on `invoices` and `invoice_payments` tables (migration files not individually audited)
- `src/lib/oj-timesheet.ts` (referenced as PDF pattern but not read in full)

---

## Executive Summary

The spec is well-structured and accurately identifies real bugs (one_off balance exclusion, missing type, duplicated code). However, three areas have critical gaps that will cause implementation failures or data integrity issues: (1) the partial payment receipt dedup mechanism is unimplementable without schema changes the spec does not specify, (2) voiding invoices with existing payments has undefined behaviour for money already received, and (3) the `sendRemittanceAdviceForPaidInvoice()` function has a double-guard that the spec only partially addresses.

## What Appears Solid

- **Phase 1 bug identification is accurate.** The one_off constraint gap (1.1), balance exclusion (1.2), missing type (1.3), and duplicated `deriveClientCode` (1.5) are all confirmed against real code. The billing cron does handle one_off entries separately (line 1407), validating the spec's finding.
- **Client statement architecture (Phase 2)** follows the established pattern of `client-balance.ts` and `oj-timesheet.ts`. Placement in `src/app/actions/oj-projects/` is consistent with precedent.
- **PDF generation approach** correctly identifies `generatePDFFromHTML()` as the right pipeline, matching the `oj-timesheet.ts` pattern.
- **Permission model** is consistent — all existing OJ actions use `checkUserPermission('oj_projects', 'view')` with cookie-based auth client. The spec correctly follows this.
- **`InvoiceStatus` already includes `'void'`** (confirmed in `src/types/invoices.ts` line 17), so Phase 4.4 void support has type-level foundation.
- **Invoices have a direct `vendor_id` column** (confirmed in `src/types/invoices.ts` line 24 and `database.generated.ts`), so statement vendor filtering is viable.

---

## Critical Risks

### CR-001: Receipt dedup is unimplementable without schema change
**Severity:** Critical | **Blocking** | **Sources:** Workflow (WF-010, WF-013), Security, Spec Trace

The spec says "use the existing `invoice_email_logs` table to check for recent sends against the same invoice + payment combination." The `invoice_email_logs` table has no `payment_id` column — only `invoice_id`, `sent_to`, `sent_at`, `subject`, `body`, `status`. Without `payment_id`, there is no reliable way to deduplicate payment-specific receipts. Two rapid partial payments would race through the check.

**Required:** Add `payment_id uuid REFERENCES invoice_payments(id)` column to `invoice_email_logs` in the migration. Use INSERT with ON CONFLICT or SELECT FOR UPDATE for atomic dedup.

---

### CR-002: Voiding invoices with existing payments has undefined behaviour
**Severity:** Critical | **Blocking** | **Sources:** Workflow (WF-015), Security, Spec Trace

The spec says void "sets status to void, records reason and timestamp, reverses linked oj_entries to unbilled." It does not address what happens to money already received. An invoice with partial payments (e.g., 200 of 500 paid) would be voided, entries set to unbilled and re-billed — but the 200 payment is orphaned.

**Required:** Add a guard: `if (invoice.paid_amount > 0) return { error: 'Cannot void an invoice with payments. Issue a credit note instead.' }` Or define explicit refund/credit-note-creation behaviour.

---

### CR-003: Double-guard on remittance advice will silently skip partial receipts
**Severity:** Critical | **Blocking** | **Sources:** Integration Architecture (ARCH-004), Spec Trace, Assumption Breaker

`sendRemittanceAdviceForPaidInvoice()` has a hard guard at line 129: `if (invoice.status !== 'paid') return { sent: false, skippedReason: 'invoice_not_paid' }`. The caller in `recordPayment()` (lines 743-748) also only triggers when status transitions to `paid`. Both guards must be updated. The spec mentions renaming and extending the trigger condition but does not explicitly call out the internal function guard — an implementer changing only the caller will get silently failing receipts.

**Required:** Spec must explicitly list both locations requiring change: (1) caller condition in `recordPayment()`, (2) internal guard in the function body.

---

### CR-004: Migration ordering for one_off constraint
**Severity:** Critical | **Blocking** | **Sources:** Workflow (WF-001)

The spec says to add a constraint and "also add a data-fix query." If the constraint is added before the data-fix UPDATE, the migration fails and deployment is blocked. The spec must mandate explicit ordering: (1) UPDATE to null out spurious values, (2) ALTER TABLE to add constraint. Include a pre-migration audit query.

---

## Spec Defects

### SD-001: Invoice filtering strategy is ambiguous
**Severity:** High | **Advisory** | **Sources:** Integration Architecture (ARCH-001), Assumption Breaker

The spec says filter invoices "via `reference ILIKE 'OJ Projects %'` **or** `vendor_id` join through `oj_entries`." The existing `client-balance.ts` uses **both** filters simultaneously (`.eq('vendor_id', vendorId).ilike('reference', 'OJ Projects %')`). The "or" phrasing could lead an implementer to use only one, pulling in non-OJ invoices or missing some. Spec must mandate the dual-filter pattern.

### SD-002: Three different "balance" concepts undefined
**Severity:** High | **Advisory** | **Sources:** Integration Architecture (ARCH-007)

Three balance calculations will exist: (1) client balance page — vendor-level total including unbilled work, (2) statement — invoiced balance only, (3) receipt — single-invoice outstanding. These are legitimately different numbers. The spec does not distinguish them, so users will report discrepancies as bugs. Statement should label as "Invoiced Balance" with a note that unbilled work is excluded.

### SD-003: Opening balance must exclude void/written_off/draft invoices
**Severity:** High | **Advisory** | **Sources:** Workflow (WF-005)

The spec says "sum of all unpaid invoice amounts with `created_at < dateFrom`." This would include voided and draft invoices. The existing `client-balance.ts` already filters out `void` and `written_off`. The statement must do the same, and must also clarify whether `draft` invoices are included.

### SD-004: Cap-mode split rounding strategy unspecified
**Severity:** Medium | **Advisory** | **Sources:** Workflow (WF-002, WF-003)

The spec says "split by monetary amount proportion" but does not define rounding. Proportional allocation produces sub-penny values. Must specify: banker's rounding to 2 decimal places, remainder applied to last entry. Also handle zero-value entries (division by zero if total batch amount is 0).

### SD-005: Credit note table missing key columns
**Severity:** Medium | **Advisory** | **Sources:** Integration Architecture (ARCH-005), Spec Trace

The spec defines `credit_notes` with: `id`, `invoice_id`, `vendor_id`, `amount`, `reason`, `created_at`, `created_by`. Missing: `status` (draft/issued/void), `credit_note_number` (for PDF/reference), `vat_rate` or `amount_inc_vat` (VAT handling). Also, standalone credit notes (no `invoice_id`) create a fourth data source for balance computation — `client-balance.ts` must be updated.

### SD-006: No empty state handling for statements
**Severity:** Medium | **Advisory** | **Sources:** Workflow (WF-004)

The spec does not address vendors with zero transactions in the selected date range. The UI should show "No transactions found." The PDF should still be generatable. The "Email to Client" button should warn.

---

## Implementation Defects

### ID-001: client-balance.ts select clause missing amount_ex_vat_snapshot
**Severity:** High | **Blocking** | **Sources:** Integration Architecture (ARCH-008), Repo Reality Mapper

`client-balance.ts` line 66-67 selects only: `entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot`. It does NOT select `amount_ex_vat_snapshot`. Even after adding one_off logic, the fix will produce zero totals unless this column is added to the select clause.

### ID-002: Billing cron uses `any` extensively for recurring charge instances
**Severity:** Medium | **Advisory** | **Sources:** Repo Reality Mapper, Spec Trace

`src/types/oj-projects.ts` has `selected_entry_ids: any | null` (line 104). The billing cron uses `any` for recurring charge instance types throughout. The spec correctly identifies this (1.3) but the fix scope should also cover the `selected_entry_ids` field.

---

## Architecture & Integration Defects

### AI-001: Billing cron at 3,434 lines — alerting must be extracted
**Severity:** High | **Advisory** | **Sources:** Integration Architecture (ARCH-006)

Adding alerting logic inline would push the billing cron past 3,500 lines. The alerting feature (email composition, recipient resolution, error aggregation) should be extracted to `src/lib/oj-projects/billing-alerts.ts` and called as a single function at the end of the billing run.

### AI-002: Statement needs shared data utility with client-balance
**Severity:** Medium | **Advisory** | **Sources:** Integration Architecture (ARCH-002)

The statement action queries `invoices` + `invoice_payments`, deepening coupling between oj-projects actions and the invoices domain. Extract invoice+payment fetching into a shared utility (e.g., `InvoiceService.getInvoicesWithPaymentsForVendor()`) so both `client-balance.ts` and `client-statement.ts` use the same data source.

---

## Workflow & Failure-Path Defects

### WF-A: Vendor with no billing email — "Email to Client" will fail ungracefully
**Severity:** High | **Advisory** | **Sources:** Workflow (WF-006, WF-014)

The spec does not address the case where a vendor has no email. The "Email to Client" button should be disabled when no email is available. The existing `resolveInvoiceRecipientsForVendor()` returns `{ to: null, cc: [] }` in this case. For receipts, the existing `sendRemittanceAdviceForPaidInvoice` already handles this (returns `skippedReason: 'no_recipient'`). Both patterns must be preserved.

### WF-B: Race condition — statement generated during active billing run
**Severity:** High | **Advisory** | **Sources:** Workflow (WF-008)

During billing, entries are in `billing_pending` limbo. The statement should be based exclusively on committed `invoices` and `invoice_payments`, not entry status. The spec should state this explicitly. Add a note about timing relative to billing runs.

### WF-C: PDF pagination for long statements
**Severity:** Medium | **Advisory** | **Sources:** Workflow (WF-007)

Vendors with many transactions could produce 100+ rows. The PDF template must include CSS page-break rules, repeating table headers, and page numbers. The existing invoice PDF does not face this because invoices rarely exceed 2 pages.

---

## Security & Data Risks

### SR-001: Cross-vendor data isolation in statement action
**Severity:** High | **Advisory** | **Sources:** Security

The statement action must enforce vendor scoping. All existing OJ actions scope queries by `vendor_id`. The new statement action must use the dual-filter pattern (vendor_id + ILIKE reference) and the existing `checkUserPermission()` gate. No additional risk if these patterns are followed, but the spec should mandate them explicitly.

### SR-002: Billing cron error emails could leak vendor financial data
**Severity:** Medium | **Advisory** | **Sources:** Security (Workflow WF-017)

The spec proposes alert emails containing "which vendors failed, error messages." Error messages from Supabase can contain column values and query fragments. Alert emails should sanitize error content: include vendor name and failure type, but not raw error messages or financial amounts. Send to a configured admin address only.

### SR-003: PDF Puppeteer injection from vendor names
**Severity:** Low | **Advisory** | **Sources:** Security

Vendor names rendered in HTML templates could contain script tags or HTML. The existing `oj-timesheet.ts` uses HTML string concatenation. The statement template must use `escapeHtml()` for all vendor-supplied data (name, reference, description). This helper exists but is duplicated between `invoice-template-compact.ts` and `oj-timesheet.ts` — consolidate.

---

## Unproven Assumptions

| # | Claim | Verdict | Evidence |
|---|-------|---------|----------|
| 1 | client-balance.ts excludes one_off entries | **CONFIRMED** | Line 60-80: only queries `time` and `mileage` entry type logic; `amount_ex_vat_snapshot` not in select |
| 2 | one_off not in original DB constraint | **CONFIRMED** | `20260120130000_oj_projects_core.sql` line 115: `CHECK (entry_type IN ('time', 'mileage'))` — later amended by `20260226120000_oj_entries_one_off.sql` |
| 3 | Cap-mode splitting requires start_at/end_at | **PARTIALLY CORRECT** | The cron has `splitRecurringInstanceForCap()` at line 640 which splits recurring charges by monetary headroom. Time entry splitting does reference start_at/end_at but also has monetary fallback paths |
| 4 | Receipt template supports outstanding balance | **CONFIRMED** | `InvoiceRemittanceDetails` interface includes `paymentAmount`, and the template renders it. Outstanding balance is computed per-invoice |
| 5 | sendRemittanceAdviceForPaidInvoice only fires on paid | **CONFIRMED** | Line 129: `if (invoice.status !== 'paid')` hard guard. Caller at line 743-748 also checks status transition to paid |
| 6 | OJRecurringChargeInstance type missing | **CONFIRMED** | `src/types/oj-projects.ts` has no such interface. Billing cron uses `any` for these records |
| 7 | deriveClientCode duplicated | **CONFIRMED** | Found in both `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts` |
| 8 | No client statement page/action exists | **CONFIRMED** | No `statement` route or action file found. Statement mode logic exists only in billing cron |
| 9 | statement_mode has UI toggle | **CONFIRMED** | Clients page has `statement_mode` checkbox in settings form (line 313: `statement_mode: !!s?.statement_mode`) |
| 10 | No credit_notes table exists | **CONFIRMED** | No migration creates a `credit_notes` table |

---

## Recommended Fix Order

1. **CR-004** — Fix migration ordering (data-fix before constraint) — blocks deployment
2. **CR-001** — Add `payment_id` to `invoice_email_logs` schema — blocks Phase 3
3. **CR-002** — Add void guard for invoices with payments — blocks Phase 4.4
4. **CR-003** — Document double-guard in spec — blocks Phase 3 implementation
5. **SD-001** — Mandate dual-filter pattern for invoice isolation — blocks Phase 2
6. **ID-001** — Add `amount_ex_vat_snapshot` to client-balance select — blocks Phase 1.2
7. **SD-002** — Define and label three balance types — blocks Phase 2 UI
8. **SD-003** — Specify opening balance exclusion filters — blocks Phase 2
9. **AI-001** — Extract billing alerting to separate module — before Phase 4.2
10. **SD-005** — Complete credit_notes table definition — before Phase 4.4
11. Remaining Medium/Low items can be addressed during implementation

## Follow-Up Review Required

- After spec revision: re-check that migration SQL ordering is explicit and includes audit queries
- After Phase 3 implementation: verify both guards updated in `recordPayment()` and `sendPaymentReceipt()`
- After Phase 4.4: verify void guard prevents voiding invoices with payments; verify credit notes appear correctly in statement balance
- After billing alerting: verify error emails do not contain raw Supabase error messages with financial data
- After statement feature: verify dual-filter pattern used; verify balance labelling distinguishes from client balance page

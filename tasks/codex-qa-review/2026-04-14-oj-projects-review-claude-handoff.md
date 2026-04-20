# Claude Hand-Off Brief: OJ Projects Spec

**Generated:** 2026-04-14
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High

---

## DO NOT REWRITE

These areas are sound and should be preserved as-is:

- **Phase 1.1** one_off constraint gap identification — correct, verified against `20260120130000_oj_projects_core.sql` and `20260226120000_oj_entries_one_off.sql`
- **Phase 1.2** client balance exclusion finding — confirmed in `src/app/actions/oj-projects/client-balance.ts`
- **Phase 1.3** missing `OJRecurringChargeInstance` type — confirmed absent from `src/types/oj-projects.ts`
- **Phase 1.5** duplicated `deriveClientCode` — confirmed in both `src/app/actions/oj-projects/projects.ts` and `src/app/api/cron/oj-projects-retainer-projects/route.ts`
- **Phase 2** overall architecture — statement as read-time aggregation, PDF via `generatePDFFromHTML()`, placement in oj-projects actions, permission model
- **Phase 3** direction — extending receipt flow to partial payments is correct approach
- **Phase 4.1** payment history on project detail — straightforward join through `oj_entries` -> `invoices` -> `invoice_payments`
- **Phase 4.3** statement mode UI clarity — simple enhancement, no issues found

---

## SPEC REVISION REQUIRED

Apply these changes to `docs/superpowers/specs/2026-04-14-oj-projects-review-design.md`:

### Phase 1.1 — Migration ordering
- [ ] Add explicit ordering: (1) audit query to count violating rows, (2) UPDATE to null out spurious values on one_off entries, (3) ALTER TABLE to add constraint
- [ ] Include the exact SQL snippet for the audit/fix/constraint sequence

### Phase 1.2 — client-balance select clause
- [ ] Note that `amount_ex_vat_snapshot` must be added to the `.select()` clause in `client-balance.ts` (currently missing — line 66-67 only selects `entry_type, duration_minutes_rounded, miles, hourly_rate_ex_vat_snapshot, vat_rate_snapshot, mileage_rate_snapshot`)

### Phase 1.4 — Cap-mode split rounding
- [ ] Specify rounding strategy: banker's rounding to 2 decimal places, remainder (positive or negative penny) applied to the last entry
- [ ] Specify handling of zero-value entries: skip splitting, log warning, pass through without consuming cap

### Phase 2 — Client Statement
- [ ] Change "via `reference ILIKE 'OJ Projects %'` **or** `vendor_id` join" to mandate the dual-filter pattern: `.eq('vendor_id', vendorId).ilike('reference', 'OJ Projects %')` — matching existing `client-balance.ts`
- [ ] Add opening balance filter: `status NOT IN ('void', 'written_off', 'draft')` — consistent with `client-balance.ts` line 55 pattern
- [ ] Define the three balance types and how they differ:
  - Client balance page: vendor-level total including unbilled work
  - Statement: invoiced balance only (label as "Invoiced Balance")
  - Receipt: single-invoice outstanding balance
- [ ] Add: "Statement should note: This reflects invoiced amounts only. Unbilled work in progress is not included."
- [ ] Add empty state handling: "No transactions found" message in UI, PDF still generatable with zero rows, confirmation before emailing empty statement
- [ ] Add: "Email to Client" button disabled when no billing email configured (check `resolveInvoiceRecipientsForVendor()` pattern)
- [ ] Add: statement should be based on committed `invoices` and `invoice_payments` only, immune to billing_pending intermediate state
- [ ] Add: PDF must include CSS page-break rules (`page-break-inside: avoid` on rows, `thead { display: table-header-group }`, page numbers in footer)

### Phase 3 — Partial Payment Receipts
- [ ] Add to migration: `ALTER TABLE invoice_email_logs ADD COLUMN payment_id uuid REFERENCES invoice_payments(id)` — required for dedup
- [ ] Specify dedup key explicitly: check for existing row with same `payment_id` using INSERT ON CONFLICT or SELECT FOR UPDATE
- [ ] List BOTH locations requiring change:
  1. Caller condition in `recordPayment()` (lines 743-748) — trigger on `partially_paid` OR `paid`
  2. Internal guard in `sendRemittanceAdviceForPaidInvoice()` (line 129) — accept `partially_paid` OR `paid`
- [ ] Note: existing function returns `{ sent: false, skippedReason: 'no_recipient' }` when vendor has no email — preserve this pattern

### Phase 4.4 — Void/Credit Note
- [ ] Add void guard: `if (invoice.paid_amount > 0) return { error: 'Cannot void an invoice with payments. Issue a credit note instead.' }`
- [ ] Expand `credit_notes` table to include: `status` (draft/issued/void), `credit_note_number` (sequential reference), `vat_rate` or `amount_inc_vat`
- [ ] Define how voided invoices render on statement timeline (debit at creation date, credit at void date, net zero)
- [ ] Note that `client-balance.ts` must also be updated to subtract standalone credit notes
- [ ] Define whether negative vendor balances (credit note exceeds outstanding) are permitted — recommend: allow with warning

### Phase 4.2 — Billing Cron Alerting
- [ ] Extract alerting to `src/lib/oj-projects/billing-alerts.ts` — do not add inline to the 3,434-line cron file
- [ ] Define failure tiers: hard failure (exception), soft failure (anomalous invoice), skipped vendor, zero-vendor run, email failure
- [ ] Sanitize error content in alert emails — vendor name and failure type only, no raw Supabase error messages

---

## IMPLEMENTATION CHANGES REQUIRED

### Files to modify (existing bugs, before new features):

1. **`src/app/actions/oj-projects/client-balance.ts`** — Add `amount_ex_vat_snapshot` to select clause (line 66-67). Add third branch in unbilled total loop for `one_off` entries.

2. **`src/types/oj-projects.ts`** — Add `OJRecurringChargeInstance` interface. Also fix `selected_entry_ids: any | null` (line 104) to a proper type.

3. **`src/app/actions/oj-projects/projects.ts`** — Remove `deriveClientCode()` duplication. Import from new `src/lib/oj-projects/utils.ts`.

4. **`src/app/api/cron/oj-projects-retainer-projects/route.ts`** — Import `deriveClientCode` from shared utils instead of local copy.

### New files required:

5. **`src/lib/oj-projects/utils.ts`** — Shared utilities starting with `deriveClientCode()`.

6. **`src/lib/oj-projects/billing-alerts.ts`** — Extracted billing run alerting logic.

7. **`src/app/actions/oj-projects/client-statement.ts`** — New statement server action.

8. **`src/lib/oj-statement.ts`** — Statement PDF HTML template (follow `oj-timesheet.ts` pattern).

9. **New migration** — one_off constraint fix (data-fix first), `payment_id` column on `invoice_email_logs`, `credit_notes` table.

### Files to modify (new features):

10. **`src/app/actions/invoices.ts`** — Rename `sendRemittanceAdviceForPaidInvoice` to `sendPaymentReceipt()`. Update BOTH the internal guard (line 129) and the caller condition (lines 743-748). Add dedup check using `payment_id`.

11. **`src/app/(authenticated)/oj-projects/clients/page.tsx`** — Add Statement button/modal with date range picker, PDF download, email-to-client. Add statement_mode help text/tooltip.

12. **`src/app/(authenticated)/oj-projects/projects/[id]/page.tsx`** — Add Payments tab/section.

13. **`src/app/api/cron/oj-projects-billing/route.ts`** — Add call to extracted alerting function at end of billing run. Replace `any` types with `OJRecurringChargeInstance`.

---

## ASSUMPTIONS TO RESOLVE

These require human decisions before implementation:

1. **Should draft invoices be included in statement opening balance?** They are technically unpaid but may not have been sent. Current `client-balance.ts` does not explicitly exclude them.

2. **Should void guard on invoices with payments be absolute, or allow override with confirmation?** Recommendation: absolute block, force credit note path.

3. **Are standalone credit notes (no `invoice_id`) genuinely needed?** They add complexity to balance computation. If always tied to an invoice, data integrity is simpler.

4. **What is the admin email for billing cron alerts?** The spec proposes `OJ_PROJECTS_BILLING_ALERT_EMAIL` env var — confirm the address and add to `.env.example`.

5. **Should the billing cron continue processing remaining vendors when one fails?** Currently unclear — exceptions may crash the entire run. Recommend: wrap each vendor in try/catch, aggregate errors, alert at end.

---

## REPO CONVENTIONS TO PRESERVE

These patterns are established in the existing OJ Projects code and must be followed:

- **Auth pattern:** `createClient()` + `checkUserPermission('oj_projects', 'view')` for user-initiated actions. `createAdminClient()` for cron/system operations only.
- **Audit logging:** All mutations call `logAuditEvent()` with `user_id`, `operation_type`, `resource_type`, `operation_status`.
- **Invoice filtering:** Dual-filter: `.eq('vendor_id', vendorId).ilike('reference', 'OJ Projects %')` — see `client-balance.ts`.
- **PDF generation:** HTML template function + `generatePDFFromHTML()` — see `src/lib/oj-timesheet.ts`.
- **Email sending:** `sendEmail()` from `src/lib/email/emailService.ts` for non-invoice emails. `sendInvoiceEmail()` from `src/lib/microsoft-graph.ts` for invoice-related emails with PDF attachment.
- **Money rounding:** `roundMoney()` function using `Math.round((v + Number.EPSILON) * 100) / 100` — present in both `client-balance.ts` and billing cron.
- **Zod validation:** All server action inputs validated with Zod schemas before processing.
- **Error returns:** `{ error: string }` on failure, `{ success: true }` on success — never throw from server actions.
- **HTML escaping:** Use `escapeHtml()` for all user-supplied data in PDF templates — consolidate the duplicated copies in `invoice-template-compact.ts` and `oj-timesheet.ts`.

---

## RE-REVIEW REQUIRED AFTER FIXES

1. After spec revision: verify migration SQL ordering is explicit with data-fix before constraint
2. After Phase 3: verify both guards updated in `sendPaymentReceipt()` — test with partial payment to confirm receipt sends
3. After Phase 4.4: verify void guard blocks invoices with payments; verify credit notes appear correctly in statement balance computation
4. After billing alerting: verify error emails do not contain raw database error messages
5. After statement feature: verify dual-filter pattern; verify three balance types are clearly labelled in UI
6. After all phases: run full verification pipeline (`npm run lint && npx tsc --noEmit && npm test && npm run build`)

---

## REVISION PROMPT

Use this prompt to apply the spec corrections:

```
Read the adversarial review at tasks/codex-qa-review/2026-04-14-oj-projects-review-adversarial-review.md and the spec at docs/superpowers/specs/2026-04-14-oj-projects-review-design.md.

Apply ALL items from the "SPEC REVISION REQUIRED" section of the hand-off brief at tasks/codex-qa-review/2026-04-14-oj-projects-review-claude-handoff.md.

For each checklist item:
1. Find the relevant section in the spec
2. Add or modify the text to address the finding
3. Preserve existing content that is correct

Key changes:
- Phase 1.1: Add migration ordering (data-fix before constraint) with SQL snippet
- Phase 1.2: Note amount_ex_vat_snapshot must be added to select clause
- Phase 1.4: Specify rounding strategy and zero-value entry handling
- Phase 2: Mandate dual-filter, add opening balance filters, define three balance types, add empty state and email guard, add PDF pagination rules, add billing_pending immunity note
- Phase 3: Add payment_id column to migration, specify dedup key, list BOTH guard locations, preserve no-recipient pattern
- Phase 4.4: Add void guard for invoices with payments, expand credit_notes schema, define void rendering on statement
- Phase 4.2: Extract alerting to separate module, define failure tiers, sanitize error emails

Do NOT change the overall structure or phase numbering. Add content within existing sections. Mark the spec status as "Revised" with today's date.
```

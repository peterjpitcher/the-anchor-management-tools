# Implementation Plan: Multi-Frequency Recurring Charges

**Spec:** `tasks/recurring-charge-frequency-spec.md`
**Complexity:** 3 (M)
**Review:** `tasks/codex-qa-review/2026-04-22-recurring-charge-frequency-adversarial-review.md`

## Step 1: Database Migration

**File:** `supabase/migrations/20260622000001_add_recurring_charge_frequency.sql`

Add `frequency` column to `oj_vendor_recurring_charges`:
```sql
ALTER TABLE public.oj_vendor_recurring_charges
  ADD COLUMN frequency text NOT NULL DEFAULT 'monthly'
  CONSTRAINT oj_vendor_recurring_charges_frequency_check
  CHECK (frequency IN ('monthly', 'quarterly', 'annually'));
```

All existing rows get `'monthly'` — fully backwards compatible. No changes to `oj_recurring_charge_instances` needed.

**Verify:** `npx supabase db push --dry-run`

---

## Step 2: Server Actions

**File:** `src/app/actions/oj-projects/recurring-charges.ts`

Changes:
1. Add `frequency: z.enum(['monthly', 'quarterly', 'annually']).default('monthly')` to `RecurringChargeSchema`
2. In `createRecurringCharge`: include `frequency: parsed.data.frequency` in insert payload
3. In `updateRecurringCharge`: include `frequency: parsed.data.frequency` in update payload
4. In `getRecurringCharges`: add `frequency` to the select string

**Verify:** Lint + typecheck

---

## Step 3: Billing Cron — Period Helpers

**File:** `src/app/api/cron/oj-projects-billing/route.ts`

Add two helper functions near the existing `getPreviousMonthPeriod`:

### `getRecurringChargePeriod(frequency, billingPeriod)`

Takes a frequency and the billing period from `getPreviousMonthPeriod()`. Returns `null` if the charge isn't due, or `{ period_yyyymm, period_start, period_end }` if it is.

Logic:
- `monthly`: always due. Returns the same period as `getPreviousMonthPeriod()`.
- `quarterly`: due when the billing month is the last month of a quarter (3, 6, 9, 12). Returns `period_yyyymm` as `YYYY-QN`, with `period_start` = first day of quarter, `period_end` = last day of quarter.
- `annually`: due when the billing month is 12. Returns `period_yyyymm` as `YYYY`, with `period_start` = Jan 1, `period_end` = Dec 31.

### `formatPeriodLabel` update

Update the existing `formatPeriodLabel` function (line 72) to handle quarterly (`2026-Q1` → `Q1 2026`) and annual (`2026` → `2026`) formats, not just `YYYY-MM`.

---

## Step 4: Billing Cron — Virtual Instance Generation

**File:** `src/app/api/cron/oj-projects-billing/route.ts`

In `buildDryRunPreview` (around line 1436):

1. When fetching recurring charge defs, the query already selects `*` — `frequency` will be included automatically after migration
2. Before generating virtual instances, for each charge def:
   - Call `getRecurringChargePeriod(charge.frequency, period)` 
   - If `null`, skip this charge (not due this period)
   - If non-null, use the returned period info for the virtual instance
3. Update the existing-instance lookup to use the frequency-appropriate `period_yyyymm` for each charge
4. Add overlap guard: for non-monthly charges, check no instances exist for the same `recurring_charge_id` with overlapping date ranges before generating

**Important:** The `existingPeriodChargeIds` set (line 1428) currently checks by `period_yyyymm` match. For non-monthly charges, we need to check using the frequency-specific period label, not the monthly one.

---

## Step 5: UI — Clients Page

**File:** `src/app/(authenticated)/oj-projects/clients/page.tsx`

### Form state
Add `frequency: string` to `ChargeFormState` (line 68). Default `'monthly'`.

### Form fields
Add a `<Select>` dropdown between description and amount fields:
```
<FormGroup label="Frequency">
  <Select value={chargeForm.frequency} onChange={...}>
    <option value="monthly">Monthly</option>
    <option value="quarterly">Quarterly</option>
    <option value="annually">Annually</option>
  </Select>
</FormGroup>
```

### Form submission
Add `fd.append('frequency', chargeForm.frequency)` in `saveCharge`.

### Edit population
When setting `chargeForm` for edit (line 924), include `frequency: c.frequency || 'monthly'`.

### Form reset
Update the cancel/reset to include `frequency: 'monthly'`.

### Charge list display
Update the charge display line (line 912) to show frequency:
`£{amount} + VAT · {vatRate}% VAT · {frequency label}`
Only show the label for non-monthly charges (to keep the UI clean for the common case).

### Cap warning
Update `recurringChargesIncVat` memo (line 154) to only sum charges that are due in the current billing period. Determine the current month from the selected `entryDate` and filter charges by frequency using the same `isChargeDueThisRun` logic. This requires extracting the due-check logic into a shared utility or inlining it.

**Pragmatic approach:** Since the cron is the source of truth for billing, and the cap warning is advisory, a simpler approach is to just note the frequency in the warning text. But per the spec revision, we should filter properly.

---

## Step 6: Verify

1. `npm run lint`
2. `npx tsc --noEmit`
3. `npm run build`
4. Apply migration: `npx supabase db push`
5. Manual test: create monthly/quarterly/annually charges, verify display
6. Verify billing preview shows correct period labelling

---

## Dependency Order

```
Step 1 (migration) → Step 2 (actions) → Step 3+4 (cron, parallel) → Step 5 (UI) → Step 6 (verify)
```

Steps 3 and 4 are in the same file and should be done together. Step 5 can start after Step 2 completes (it only needs the server actions to accept frequency). Step 6 is last.

## Risk Notes

- The billing cron is the highest-risk change — period determination logic must be thoroughly tested
- The overlap guard for frequency changes adds complexity but prevents double-billing
- All existing monthly charges are unaffected (default value + existing code paths unchanged)

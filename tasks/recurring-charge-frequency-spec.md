# Spec: Multi-Frequency Recurring Charges

## Problem Statement

Recurring charges are hardcoded as monthly. There is no way to set a charge to bill weekly, quarterly, or annually. The `oj_vendor_recurring_charges` table has no frequency column, the billing cron always generates one instance per calendar month via `getPreviousMonthPeriod()`, and the UI has no frequency selector.

## Success Criteria

- Users can set a recurring charge to one of: `monthly`, `quarterly`, `annually`
- The billing cron correctly generates instances only when a charge is due (e.g. quarterly charges bill every 3 months)
- Existing monthly charges continue to work identically (backwards compatible)
- The UI shows the frequency for each charge and allows selection when creating/editing
- Invoice line items correctly reflect the period covered by each charge

## Scope

**In scope:**
- New `frequency` column on `oj_vendor_recurring_charges` (default `'monthly'`)
- Updated billing cron logic to determine which charges are due in a given billing run
- Updated UI form with frequency dropdown
- Updated server actions (create/update) to handle frequency
- Updated charge display to show frequency

**Out of scope:**
- Weekly charges (the billing cron runs monthly, so weekly billing would require a separate mechanism)
- Custom intervals (e.g. "every 6 weeks")
- Pro-rating partial periods
- Changing the billing cron schedule itself

## Supported Frequencies

| Frequency | Bills when | Period label format | Instance period |
|-----------|-----------|-------------------|----------------|
| `monthly` | Every billing run | `2026-04` | 1st–last of that month |
| `quarterly` | When billing month is end of Q (Mar, Jun, Sep, Dec) | `2026-Q1` | 1st Jan–31st Mar etc. |
| `annually` | When billing month is December | `2026` | 1st Jan–31st Dec |

### Quarterly alignment

Quarters follow the standard calendar:
- Q1: January–March (bills in April run, covering previous quarter)
- Q2: April–June (bills in July run)
- Q3: July–September (bills in October run)
- Q4: October–December (bills in January run)

The billing cron runs for the **previous month**. So:
- A billing run in April processes March → end of Q1 → quarterly charges for Q1 are due
- A billing run in July processes June → end of Q2 → quarterly charges for Q2 are due

### Annual alignment

Annual charges bill when the billing run processes December (i.e. the cron runs in January, billing the previous month December → end of year → annual charges are due).

## Database Changes

### Migration: Add `frequency` column

```sql
ALTER TABLE public.oj_vendor_recurring_charges
  ADD COLUMN frequency text NOT NULL DEFAULT 'monthly'
  CHECK (frequency IN ('monthly', 'quarterly', 'annually'));
```

No changes needed to `oj_recurring_charge_instances` — the `period_yyyymm` column can store quarterly (`2026-Q1`) and annual (`2026`) labels. The unique constraint `(vendor_id, recurring_charge_id, period_yyyymm)` still works because period labels are unique per frequency.

### Instance period fields

For non-monthly instances, `period_start` and `period_end` will span the full quarter/year:

| Frequency | `period_yyyymm` | `period_start` | `period_end` |
|-----------|-----------------|----------------|--------------|
| monthly | `2026-03` | `2026-03-01` | `2026-03-31` |
| quarterly | `2026-Q1` | `2026-01-01` | `2026-03-31` |
| annually | `2026` | `2026-01-01` | `2026-12-31` |

## Server Action Changes

### `recurring-charges.ts`

1. Add `frequency` to `RecurringChargeSchema`: `z.enum(['monthly', 'quarterly', 'annually']).default('monthly')`
2. Include `frequency` in `createRecurringCharge` insert payload
3. Include `frequency` in `updateRecurringCharge` update payload
4. Return `frequency` in `getRecurringCharges` select list

## Billing Cron Changes

### `route.ts` — Period determination for recurring charges

Add a helper function `getRecurringChargePeriod(frequency, billingPeriod)` that:
1. Takes the frequency and the current billing period (from `getPreviousMonthPeriod()`)
2. Determines if this charge is due in this billing run
3. Returns `null` if not due, or the period info (`period_yyyymm`, `period_start`, `period_end`) if due

```
function isChargeDueThisRun(frequency, billingMonth):
  if frequency === 'monthly': return true
  if frequency === 'quarterly':
    return billingMonth is last month of a quarter (3, 6, 9, 12)
  if frequency === 'annually':
    return billingMonth === 12
```

### Virtual instance generation

In `buildDryRunPreview`, when generating virtual instances for recurring charges:
1. Fetch recurring charge defs **with their frequency**
2. Filter out charges whose frequency doesn't match the current billing period
3. For matching charges, generate the correct `period_yyyymm`, `period_start`, `period_end` based on frequency

### Existing instance lookup

When checking for already-existing instances, the lookup must use the frequency-appropriate `period_yyyymm` (e.g. `2026-Q1` for quarterly, not `2026-03`).

## UI Changes

### `clients/page.tsx`

1. Add `frequency` to `ChargeFormState`
2. Add a frequency `<Select>` dropdown to the recurring charge form with options: Monthly, Quarterly, Annually
3. Display frequency in the charge list (e.g. "£50.00 + VAT · 20% VAT · Quarterly")
4. When editing, populate frequency from existing charge
5. Default to `'monthly'` for new charges

### `page.tsx` (main OJ Projects dashboard)

The vendor summary already calculates `recurringExVat` from all active charges. No change needed — the total is correct regardless of frequency (it shows the per-period amount, not annualised).

However, the cap warning (`recurringChargesIncVat > cap`) may need context — a quarterly charge of £300 shouldn't warn against a monthly cap of £200 every month, only when it's actually due. This is a minor UX concern but not blocking.

## Invoice Display

Invoice line items for recurring charges already use `description_snapshot` and `amount_ex_vat_snapshot` from instances. The period covered is rendered in invoice notes via the `period_start`/`period_end` fields. Verify that the existing `buildInvoiceNotes` function correctly displays the period range for non-monthly instances (e.g. "Jan 2026 – Mar 2026" for quarterly). If the existing rendering only shows `period_yyyymm` as a month label, update it to handle the `Q1`/year format or use the date range instead.

## Business Rules (clarified post-review)

### Mid-period charge creation

Non-monthly charges bill for the **full containing period** regardless of when the charge was created. A quarterly charge created in February will first bill for Q1 (in the April run), covering January–March in full. This matches how monthly charges already work — a charge created mid-month still generates a full-month instance. No pro-rating.

### Frequency changes

Frequency changes take effect from the **next unopened period only**. Past instances remain as-is under their original frequency. When generating virtual instances, the cron uses the charge's current frequency. If instances already exist for overlapping date ranges under a previous frequency (e.g. monthly `2026-01` instances exist and a quarterly `2026-Q1` would overlap), the cron must skip generation to prevent double-billing.

Concretely: when generating a virtual instance for a non-monthly charge, check whether any instances already exist for that `recurring_charge_id` with `period_start` or `period_end` falling within the new instance's date range. If so, skip.

### Cap warning behaviour

The monthly cap warning on the clients page should only sum charges that are due in the current billing period. A quarterly charge of £300 should not trigger the cap warning in months when it isn't due. Filter by frequency when calculating `recurringChargesIncVat` for cap comparison.

## Edge Cases

1. **Disabling a charge mid-period**: A disabled charge won't generate new instances (the cron already filters by `is_active`). Any existing unbilled instances for past periods are still eligible for billing.

2. **Carried-forward instances**: The cron already handles unbilled instances from previous periods. A quarterly instance from Q4 2025 that was never billed will be picked up in the next run regardless of current period.

## Acceptance Criteria

- [ ] New `frequency` column on `oj_vendor_recurring_charges` with CHECK constraint
- [ ] Default value is `'monthly'` — all existing charges continue unchanged
- [ ] Server actions accept and persist `frequency`
- [ ] UI form has frequency dropdown (Monthly/Quarterly/Annually)
- [ ] Charge list displays frequency
- [ ] Billing cron only generates instances for charges due in the current period
- [ ] Quarterly charges bill in April/July/October/January runs
- [ ] Annual charges bill in January run (for previous December)
- [ ] Instance `period_yyyymm` uses correct format per frequency
- [ ] Instance `period_start`/`period_end` span the full period
- [ ] Existing monthly billing is unaffected
- [ ] Frequency changes only affect future periods (no retroactive re-billing)
- [ ] No double-billing when frequency is changed mid-period
- [ ] Invoice notes display period range correctly for quarterly/annual instances
- [ ] Cap warning only counts charges due in the current billing period
- [ ] Unit tests cover `isChargeDueThisRun` and period label generation for all frequencies
- [ ] Builds, lints, type-checks cleanly

## Complexity Score

**3 (M)** — 5-6 files touched, moderate logic changes, one schema migration, no breaking changes.

## Files to Modify

1. `supabase/migrations/NEW_add_recurring_frequency.sql` — migration
2. `src/app/actions/oj-projects/recurring-charges.ts` — server actions
3. `src/app/api/cron/oj-projects-billing/route.ts` — billing cron
4. `src/app/(authenticated)/oj-projects/clients/page.tsx` — UI form
5. `src/types/oj-projects.ts` — type updates (if `OJRecurringCharge` type exists)

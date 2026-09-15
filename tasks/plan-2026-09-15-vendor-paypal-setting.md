# Vendor PayPal Setting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let staff enable card and PayPal invoice payments for selected vendors only, with Sidemen Entertainment Limited initially enabled.

**Architecture:** Store a fail-closed boolean on `invoice_vendors` and read it through the existing vendor relation. A shared eligibility helper controls email footers, staff actions and the public payment page, while completed PayPal captures remain recordable after the setting is disabled.

**Tech Stack:** PostgreSQL and Supabase migrations, Next.js 15 App Router, React 19, TypeScript strict, Zod, Vitest and the existing design system.

**Spec:** `tasks/spec-2026-09-15-vendor-paypal-setting-design.md`

## Global Constraints

- `paypal_payments_enabled` is `boolean NOT NULL DEFAULT false`.
- Sidemen Entertainment Limited vendor id `ed3bb6b9-01a5-4894-b54f-b83fe73cc52b` is the only existing vendor enabled during rollout.
- The invoice PDF never contains the payment link.
- Missing or unknown vendor settings fail closed.
- Disabling the setting prevents new PayPal orders but never prevents a completed capture from being recorded.
- Manual invoice sends, chasers, reminders and automatic sends use the same rule.
- Existing email suspension, recipient validation, PayPal idempotency, amount validation, webhook and reconciliation safeguards remain unchanged.
- Use Node 20 from `.nvmrc`.
- Use the `prod-migrate` and `supabase:supabase` skills for migration work.
- Do not apply a production migration, deploy, send an invoice or create a live PayPal order without the required explicit approval.
- Preserve the unrelated existing changes in `tasks/todo.md`.
- Complexity is L. Keep the schema and application work as separate reviewable commits and deploy the schema before the application.

---

### Task 1: Add the fail-closed vendor setting

**Files:**

- Create: `supabase/migrations/20260915090000_vendor_paypal_payments_enabled.sql`
- Create: `tests/source/vendorPayPalMigration.test.ts`
- Modify: `src/types/invoices.ts`
- Modify: `src/types/database.generated.ts`

**Interfaces:**

- Produces database column: `public.invoice_vendors.paypal_payments_enabled boolean NOT NULL DEFAULT false`.
- Produces TypeScript field: `InvoiceVendor.paypal_payments_enabled: boolean`.
- Later tasks consume the field through `invoice.vendor`.

- [ ] **Step 1: Write the failing migration contract test**

Create a source test that reads the exact migration and proves the default, nullability and one enabled vendor are explicit:

```ts
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const sql = readFileSync(
  'supabase/migrations/20260915090000_vendor_paypal_payments_enabled.sql',
  'utf8',
)

describe('vendor PayPal setting migration', () => {
  it('fails closed and enables only the approved vendor', () => {
    expect(sql).toMatch(/paypal_payments_enabled\s+boolean\s+not null\s+default false/i)
    expect(sql).toContain('ed3bb6b9-01a5-4894-b54f-b83fe73cc52b')
    expect(sql).toContain('Sidemen Entertainment Limited')
    expect(sql).not.toMatch(/default true/i)
  })
})
```

- [ ] **Step 2: Run the contract test and confirm it fails**

Run: `source ~/.nvm/nvm.sh && nvm use && npx vitest run tests/source/vendorPayPalMigration.test.ts`

Expected: FAIL because the migration file does not exist.

- [ ] **Step 3: Create the additive migration**

Create the migration with no grant, policy or view changes:

```sql
ALTER TABLE public.invoice_vendors
  ADD COLUMN paypal_payments_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.invoice_vendors.paypal_payments_enabled IS
  'Whether invoice emails and pages may offer card or PayPal payment for this vendor.';

UPDATE public.invoice_vendors
SET paypal_payments_enabled = true,
    updated_at = now()
WHERE id = 'ed3bb6b9-01a5-4894-b54f-b83fe73cc52b'::uuid
  AND name = 'Sidemen Entertainment Limited';
```

- [ ] **Step 4: Update handwritten and generated types**

Add `paypal_payments_enabled: boolean` to `InvoiceVendor`. Regenerate `src/types/database.generated.ts` from the linked project, then verify its `invoice_vendors` Row, Insert and Update shapes contain the field. Retain the existing live `customer_id` field surfaced by regeneration and review all other generated drift before keeping it.

- [ ] **Step 5: Validate the migration without applying production changes**

Run the full migration in a rolled-back transaction against the linked database or an isolated validation database. Confirm:

```sql
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'invoice_vendors'
  AND column_name = 'paypal_payments_enabled';
```

Expected after the transaction statement: boolean, `NO`, default `false`.

Also run the migration contract test and `npx tsx scripts/security/assert-anon-surface.ts`. Do not run `npx supabase db push` without production approval.

- [ ] **Step 6: Commit the schema increment**

```bash
git add supabase/migrations/20260915090000_vendor_paypal_payments_enabled.sql tests/source/vendorPayPalMigration.test.ts src/types/invoices.ts src/types/database.generated.ts
git commit -m "feat(db): add vendor PayPal setting"
```

---

### Task 2: Centralise PayPal eligibility and gate invoice emails

**Files:**

- Modify: `src/lib/invoices/payment-link-footer.ts`
- Modify: `src/lib/invoices/__tests__/payment-link-footer.test.ts`
- Modify: `src/app/api/cron/auto-send-invoices/route.ts`
- Modify: `src/app/api/cron/invoice-reminders/route.ts`
- Create: `tests/source/invoicePayPalVendorProjection.test.ts`

**Interfaces:**

- Consumes: `InvoiceVendor.paypal_payments_enabled` from Task 1.
- Produces: `invoiceCanOfferPayPal(invoice: PaymentLinkInvoice): boolean`.
- `buildInvoicePaymentLinkFooter` remains the only place that creates the email payment block.

- [ ] **Step 1: Write failing eligibility tests**

Update the test fixture so normal payable cases explicitly enable PayPal:

```ts
function invoice(overrides: Record<string, unknown> = {}) {
  return {
    id: INVOICE_ID,
    status: 'sent',
    total_amount: 975.6,
    paid_amount: 0,
    vendor: { paypal_payments_enabled: true },
    ...overrides,
  }
}
```

Add tests proving that `false`, `null`, a missing vendor and a missing field produce no footer. Add one test proving an enabled vendor with an outstanding balance still receives the portal link.

- [ ] **Step 2: Run the helper tests and confirm they fail**

Run: `npx vitest run src/lib/invoices/__tests__/payment-link-footer.test.ts`

Expected: FAIL because vendor eligibility is not checked.

- [ ] **Step 3: Add the shared eligibility helper**

Extend the invoice shape and keep the existing balance helper separate:

```ts
export type PaymentLinkInvoice = {
  id: string
  status?: string | null
  total_amount?: number | string | null
  paid_amount?: number | string | null
  vendor?: { paypal_payments_enabled?: boolean | null } | null
}

export function invoiceCanOfferPayPal(invoice: PaymentLinkInvoice): boolean {
  return invoice.vendor?.paypal_payments_enabled === true
    && invoiceHasBalanceToCollect(invoice)
}
```

Change `buildInvoicePaymentLinkFooter` to return an empty string unless `invoiceCanOfferPayPal(invoice)` is true. Do not change PDF generation.

- [ ] **Step 4: Cover explicit cron projections**

Add `paypal_payments_enabled` to the explicit `vendor:invoice_vendors(...)` projections in automatic invoice sending and invoice reminders. Add a source test that reads both route files and checks the field appears inside their vendor projection. Paths that load `vendor:invoice_vendors(*)` require no query change.

- [ ] **Step 5: Run focused tests**

Run:

```bash
npx vitest run src/lib/invoices/__tests__/payment-link-footer.test.ts tests/source/invoicePayPalVendorProjection.test.ts tests/api/recurringInvoicesCronA046.test.ts
```

Expected: PASS, with disabled vendors receiving no footer and existing recurring sends unchanged.

- [ ] **Step 6: Commit the email eligibility increment**

```bash
git add src/lib/invoices/payment-link-footer.ts src/lib/invoices/__tests__/payment-link-footer.test.ts src/app/api/cron/auto-send-invoices/route.ts src/app/api/cron/invoice-reminders/route.ts tests/source/invoicePayPalVendorProjection.test.ts
git commit -m "feat(invoices): gate PayPal links by vendor"
```

---

### Task 3: Add the setting to vendor setup

**Files:**

- Modify: `src/app/(authenticated)/invoices/vendors/page.tsx`
- Modify: `src/app/actions/vendors.ts`
- Modify: `src/services/vendors.ts`
- Create: `src/app/actions/__tests__/vendors-paypal-setting.test.ts`
- Create: `tests/components/VendorsPagePayPalSetting.test.tsx`

**Interfaces:**

- Consumes: `InvoiceVendor.paypal_payments_enabled` from Task 1.
- Produces form field: `paypal_payments_enabled`, serialised as `'true'` or `'false'`.
- Existing permissions remain `invoices:create` and `invoices:edit`.

- [ ] **Step 1: Write failing action persistence tests**

Mock `VendorService`, permission checks and audit logging. Submit create and update `FormData` with `paypal_payments_enabled: 'true'`, then assert:

```ts
expect(VendorService.updateVendor).toHaveBeenCalledWith(
  'vendor-1',
  expect.objectContaining({ paypal_payments_enabled: true }),
)
expect(logAuditEvent).toHaveBeenCalledWith(
  expect.objectContaining({
    new_values: expect.objectContaining({ paypal_payments_enabled: true }),
  }),
)
```

Add a create case with the field absent and assert `false`, so direct callers also fail closed.

- [ ] **Step 2: Write the failing vendor form test**

Render the vendor page with mocked actions, permissions, router and Supabase provider. Assert a new vendor form starts unchecked. Open an existing enabled vendor, assert the checkbox is checked, untick it, submit, and assert the outgoing `FormData` contains `'false'`.

- [ ] **Step 3: Run the action and component tests and confirm they fail**

Run:

```bash
npx vitest run src/app/actions/__tests__/vendors-paypal-setting.test.ts tests/components/VendorsPagePayPalSetting.test.tsx
```

Expected: FAIL because the setting is not parsed, displayed or saved.

- [ ] **Step 4: Persist the setting through the server boundary**

Add the Zod field and explicit parser:

```ts
paypal_payments_enabled: z.boolean().default(false)
```

```ts
paypal_payments_enabled: formData.get('paypal_payments_enabled') === 'true'
```

Add the required boolean to both `VendorService` input types and payloads. Include the resulting value in create and update audit `new_values`.

- [ ] **Step 5: Add the vendor checkbox**

Extend `VendorFormData`, new-form defaults and edit hydration. Add the design-system checkbox inside the vendor modal:

```tsx
<Checkbox
  checked={formData.paypal_payments_enabled}
  onChange={(checked: boolean) =>
    setFormData({ ...formData, paypal_payments_enabled: checked })
  }
  label="Offer PayPal/card payment"
  description="Adds a secure online payment link to this vendor's invoice emails."
/>
```

Keep the default unchecked. The existing `Object.entries(formData)` submit loop serialises the boolean.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npx vitest run src/app/actions/__tests__/vendors-paypal-setting.test.ts tests/components/VendorsPagePayPalSetting.test.tsx tests/services/mutation-race-guards.test.ts
```

Expected: PASS, including the existing vendor not-found guard.

- [ ] **Step 7: Commit the vendor setup increment**

```bash
git add 'src/app/(authenticated)/invoices/vendors/page.tsx' src/app/actions/vendors.ts src/services/vendors.ts src/app/actions/__tests__/vendors-paypal-setting.test.ts tests/components/VendorsPagePayPalSetting.test.tsx
git commit -m "feat(invoices): configure PayPal by vendor"
```

---

### Task 4: Enforce the setting on staff and public payment routes

**Files:**

- Modify: `src/app/actions/invoicePayPalActions.ts`
- Modify: `src/app/actions/__tests__/invoice-paypal.test.ts`
- Modify: `src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx`
- Create: `tests/components/InvoiceDetailPayPalSetting.test.tsx`
- Modify: `src/app/invoice-portal/[token]/page.tsx`
- Create: `tests/components/guest-routes/invoicePaymentPage.test.tsx`

**Interfaces:**

- Consumes: `invoiceCanOfferPayPal` from Task 2.
- Server actions return `PayPal payments are not enabled for this vendor.` when the setting is off.
- `captureInvoicePaymentByToken` remains independent of the vendor setting.

- [ ] **Step 1: Write failing server-action tests**

Set the existing invoice fixture vendor to enabled by default. Add disabled-vendor cases for `getInvoicePortalLink`, `sendInvoicePaymentLink` and `createInvoicePaymentOrderByToken`. Each must return the disabled message and never call `createSimplePayPalOrder` or `sendInvoicePaymentLinkEmail`.

Add a capture case with `vendor.paypal_payments_enabled: false` and a completed PayPal order. Assert the atomic recording RPC still runs and the result succeeds or reports already recorded.

- [ ] **Step 2: Write failing staff and portal tests**

For the invoice detail component, render the same payable invoice twice. Assert **Email payment link** and **Copy payment link** are present when enabled and absent when disabled, while **Email** remains present.

For the public page, mock the invoice query and render the async page. Assert:

- enabled and collectible shows the Pay button;
- disabled and collectible shows `Online payment is not available for this invoice.` and no Pay button;
- disabled with `payment_pending=1` and a PayPal token still renders `InvoicePayCaptureClient` so a completed return can be recorded.

- [ ] **Step 3: Run the focused tests and confirm they fail**

Run:

```bash
npx vitest run src/app/actions/__tests__/invoice-paypal.test.ts tests/components/InvoiceDetailPayPalSetting.test.tsx tests/components/guest-routes/invoicePaymentPage.test.tsx
```

Expected: FAIL because the setting is not enforced.

- [ ] **Step 4: Gate server-side order creation**

Add `paypal_payments_enabled` to the explicit vendor projection in `INVOICE_COLUMNS`. Import the shared helper and make `describeUnpayable` return the disabled message only after existing cancelled, written-off, paid, unissued and zero-balance checks.

Do not add this check to `captureInvoicePaymentByToken`, `settleInvoicePayPalOrder`, the webhook or reconciliation recording paths.

- [ ] **Step 5: Hide staff payment-link controls**

Require `invoice.vendor?.paypal_payments_enabled === true` in `canShowPaymentLinkActions`. Keep the server-side guard because hiding controls is not authorisation.

- [ ] **Step 6: Separate public collection from capture recovery**

Add the field to the public portal query and derive:

```ts
const invoiceCollectible = !settled && !withdrawn && !notYetIssued
const paypalEnabled = vendor?.paypal_payments_enabled === true
const payable = invoiceCollectible && paypalEnabled
```

Render the capture client when `invoiceCollectible && paymentPending && paypalOrderId`, not only when `payable`. Show a notice when `invoiceCollectible && !paypalEnabled`. Do not render `InvoicePayClient` or the PayPal trust line in that state.

- [ ] **Step 7: Run focused tests**

Run:

```bash
npx vitest run src/app/actions/__tests__/invoice-paypal.test.ts tests/components/InvoiceDetailPayPalSetting.test.tsx tests/components/guest-routes/invoicePaymentPage.test.tsx tests/lib/invoicePaymentLinkEmail.test.ts
```

Expected: PASS, including completed-capture recovery after disabling.

- [ ] **Step 8: Commit the route enforcement increment**

```bash
git add src/app/actions/invoicePayPalActions.ts src/app/actions/__tests__/invoice-paypal.test.ts 'src/app/(authenticated)/invoices/[id]/InvoiceDetailClient.tsx' tests/components/InvoiceDetailPayPalSetting.test.tsx 'src/app/invoice-portal/[token]/page.tsx' tests/components/guest-routes/invoicePaymentPage.test.tsx
git commit -m "feat(invoices): enforce vendor PayPal setting"
```

---

### Task 5: Complete quality gates and prepare the production approval packet

**Files:**

- Modify: `tasks/plan-2026-09-15-vendor-paypal-setting.md` to tick completed steps and record results.
- Do not modify or commit the unrelated `tasks/todo.md` changes.

**Interfaces:**

- Consumes all deliverables from Tasks 1 to 4.
- Produces a verified local branch and an exact production migration approval packet.

- [ ] **Step 1: Check the final diff and generated artefacts**

Run `git diff --check`, inspect `git status -sb`, confirm no em dash characters were added, and verify only intended files are staged or committed. Confirm the PDF template and PDF generator have no payment-link changes.

- [ ] **Step 2: Run the full local quality pipeline**

Run in order:

```bash
source ~/.nvm/nvm.sh && nvm use
npm run lint
npx tsc --noEmit
npm test
npm run build
npx supabase db push --dry-run
npx tsx scripts/security/assert-anon-surface.ts
```

Expected: every command passes. The dry run must list only the new additive migration. Do not apply it.

- [ ] **Step 3: Exercise the local user journeys**

Using a local development server and non-production test data:

1. Open vendor setup, confirm a new vendor starts disabled, enable it and save.
2. Open a payable invoice for an enabled vendor, confirm payment-link controls appear and the email payload contains the portal link plus the PDF attachment.
3. Disable the vendor, confirm controls disappear and the email payload still contains the PDF attachment without the portal link.
4. Open the signed public page in both states and confirm only the enabled state can create a new PayPal order.
5. Simulate a completed return after disabling and confirm the payment is still recorded exactly once.

Do not send a real email or call live PayPal.

- [ ] **Step 4: Prepare the production migration approval packet**

Report the exact migration filename, checksum, SQL summary, dry-run output, verified live target, rollback approach and the Sidemen vendor id. Ask for one explicit approval to apply the migration. Do not deploy the application first.

- [ ] **Step 5: After approval, apply and verify in order**

Only after explicit approval:

1. Apply `20260915090000_vendor_paypal_payments_enabled.sql` to the verified production project.
2. Query the new column and confirm exactly one enabled row, Sidemen Entertainment Limited.
3. Push the application commits and wait for the Vercel production deployment.
4. Verify the vendor setup screen and invoice `INV-003WP` in the authenticated live app.
5. Confirm the PDF still has no PayPal link and the email preview explains the attached PDF. Do not send the invoice without separate send approval.

- [ ] **Step 6: Record final evidence**

Tick the plan, record test results, migration id and deployment id, then commit only this plan update if it contains no unrelated user work.


# Private booking extras implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use the implement-plan skill to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Issue separate invoices for extra booking charges and produce a complete dated final receipt.

**Architecture:** Preserve the original invoice pointer and original booking prices. Add invoice associations and immutable supplementary batches, extend settlement, and use existing invoice payment infrastructure. Generate versioned consolidated receipts from reconciled source records.

**Tech Stack:** Next.js 15, React 19, TypeScript, Supabase PostgreSQL, PayPal, Vitest, existing PDF tooling.

**Spec:** `tasks/spec-2026-09-18-private-booking-additional-charges.md`.

## Global constraints

- Work in the isolated `codex/private-booking-extras` worktree based on `origin/main` after the zero-cost booking change.
- No real customer messages, bookings or charges in verification. Use isolated PostgreSQL, mocked providers and sandbox only.
- Preserve original invoice and deposit allocation. Count actual receipts once.
- Permission checks, private storage, exact money reconciliation and explicit dates are mandatory.
- No em dashes, new packages or unrelated changes.
- Target production: `the-anchor-management-tools`, `tfcasgxopxegwrabvwat`, verified against repo environment URL and connected project identity.

## Ownership and dependencies

Wave 1 has three independent owners: database foundations, server actions/domain, and consolidated receipts. Root owns the staff interface, integration, gate review, final verification and deployment. Shared contracts are agreed before dependent edits. All agents work in the same isolated worktree with disjoint file ownership. A fresh reviewer follows integration because billing is high risk.

## Task 1: Atomic supplementary billing and settlement

Files: new migration and rollback under `supabase/`, `scripts/testing/private-booking-extras-postgres.py`, regression fixtures under `tests/fixtures/private-booking-settlement/`.

Produces association `private_booking_invoices(booking_id, invoice_id, kind)`, versioned draft batches, issue/cancel RPCs and explicit manual receipt allocation. Retains `get_booking_gross_total` for original invoice reconciliation and adds aggregate booking total helper.

- [x] Read fresh columns, constraints, policies, functions, views and affected row counts.
- [x] Create migration with the CLI and implement atomic draft/issue/cancel operations, permissions and compatibility links.
- [x] Broaden invoice-to-booking settlement lookup, locking, final-payment stamps and view totals without duplicating legacy payments.
- [x] Exercise actual transactions, rollback and concurrent requests in isolated PostgreSQL.

Regression invariants include:

```sql
SELECT fixture_assert(
  (SELECT count(*) = 1 FROM private_booking_invoices WHERE invoice_id = fixture_invoice_id),
  'one booking owns each invoice'
);
```

The executable fixture supplies the generated IDs. Verify duplicate issue returns the same invoice, drafts do not affect balances, original invoice remains unchanged, and pending PayPal orders prevent unsafe cancellation.

## Task 2: Actions and ledger

Files: `src/app/actions/privateBookingExtras.ts`, `src/lib/private-bookings/extra-charges.ts`, existing `privateBookingInvoice.ts`, `payment-ledger.ts`, related service files and tests.

Consumes Task 1 RPCs. Produces typed billing load, draft save, preview, issue/send, resend, cancel and allocated payment actions.

```ts
type ExtraChargeLine = {
  description: string
  quantity: number
  unit_price: number
  discount_percentage: number
  vat_rate: number
  catalog_item_id?: string | null
}
```

- [x] Validate with Zod and existing invoice money calculations; require explicit due date and preview revision.
- [x] Enforce super-admin issue permissions and server checks for every read/write.
- [x] Issue atomically before delivery; retries reuse the invoice and expose failed delivery.
- [x] Aggregate all associated invoice payments while preserving source deduplication and deposit treatment.
- [x] Test permission denial, stale preview, email failure, multiple invoices and payment allocation.

## Task 3: Consolidated receipt

Files: new `booking-receipt*.ts` under `src/lib/private-bookings/`, `src/app/actions/privateBookingReceipt.ts`, protected download route and tests.

Consumes invoice associations, existing invoice lines, payment ledger, credit and refund records. Produces preview, generation, private download and explicit sending.

```ts
type ReceiptKind = 'payment_statement' | 'final_receipt'
// Final eligibility is derived from verified balances and unresolved records,
// never accepted as a client-provided assertion.
```

- [x] Create a pure reconciler that retains charge descriptions, dates and payment provenance.
- [x] Block final label for balances, drafts, pending refunds, disputes and unresolved deposits or credit.
- [x] Render all invoices and transactions over multiple pages using existing PDF tooling.
- [x] Persist exact PDF bytes and snapshot metadata before reporting generation successful.
- [x] Protect download/send and preserve old versions; render fixtures and inspect PDF pages.

## Task 4: Staff interface and integration

Files: new `PrivateBookingBilling.tsx` and `PrivateBookingReceiptPanel.tsx` in `src/components/private-bookings/`, active `[id]/PrivateBookingDetailClient.tsx`, separate `[id]/items/page.tsx`, targeted component tests.

- [x] Add draft extras editor, real catalogue picker, net/VAT/gross preview and explicit due date.
- [x] Show original and additional invoices with individual balances, links and delivery state.
- [x] Add manual allocations and receipt preview/download/send controls.
- [x] Use aggregate totals in booking overview and disable ambiguous legacy manual payments when invoices exist.
- [x] Verify keyboard labels, mobile layout, errors, duplicate clicks and actual browser interactions with isolated data/provider boundaries.
- [x] Check dashboard, reminder, event-sheet and contract consumers; preserve signed historical contracts.

## Gate, release and verification

- [x] Review each stream for coverage, exact interface compatibility, owned files and substantive defects.
- [x] Run isolated PostgreSQL harnesses and focused tests, then lint, uncached types, London and UTC suites and cold production build.
- [x] Obtain fresh adversarial review; repair and rerun affected tests.
- [x] Prepare exact migration SQL, checksum, impact, rollback and verification packet. Resolve required production approval before apply.
- [ ] Commit only this feature's files, push, review CI, apply authorised migration and merge in the order needed to preserve compatibility.
- [ ] Verify the resulting production deployment ID, permissions, schema, logs and read-only live UI. Record any sandbox/provider testing limitation explicitly.
- [ ] Tidy the feature branch once deployed and record final evidence here.

## Release evidence

See `tasks/release-2026-09-18-private-booking-extras.md` for exact SQL, checksums, risk, validation and rollback. Migration applied and verified live as `20260918160300`; application merge and deployment verification pending.

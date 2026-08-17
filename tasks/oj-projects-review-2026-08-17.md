# OJ Projects: end to end review and remediation spec

**Date:** 2026-08-17
**Status:** all 13 findings implemented in the working tree. Not committed, not deployed,
and the production database is untouched. See section 0.
**Scope:** `/oj-projects` UI, its 10 server action files, `src/lib/oj-projects/`, the 3 crons, the 2 REST endpoints, and the 2 Postgres RPCs that mutate OJ rows.
**Verification run:** 85 tests pass (10 files), `tsc --noEmit` clean for the section.

> Note on quoting: this document describes em dash defects without reproducing the character,
> because a write hook blocks it. Wherever it says "[EMDASH]", the real string contains U+2014.

---

## 0. Implementation status

All 13 findings are fixed in the working tree. Owner decision 2 (drafts are not receivables)
is implemented. Owner decision 1 (how to clear INV-003WC) is still open, so **no production
data has been changed**.

| Finding | Status | Where |
|---|---|---|
| FF-001 | Fixed | `recoverRunlessLockedRows` in the billing route, plus migration `20260817170000` |
| FF-002 | Fixed | "Preview Next Invoice" and "Download PDF" restored in `ClientsClient.tsx` |
| FF-003 | Fixed | `sendStatementEmail` now requires `oj_projects edit` |
| FF-004 | Fixed | `buildDetailedLineItems` VAT fallback, plus the same class of bug found and fixed in `buildInvoiceNotes` |
| FF-005 | Fixed | Drafts excluded from `unpaidInvoiceBalance`, surfaced as `draftInvoiceTotal` |
| FF-006 | Fixed | `client-balance` now passes the client's configured rates to `resolveRate` |
| FF-007 | Fixed | New shared `src/lib/oj-projects/retainer-projects.ts`, used by both callers |
| FF-008 | Fixed | Alert now fires when a run raises no invoices |
| FF-009 | Fixed | Unique index in migration `20260817170000`, plus conflict recovery in the helper |
| FF-010 | Fixed | Explicit `UNPAGED_ENTRY_LIMIT` in `getEntries` |
| FF-011 | Fixed | Statement defaults use `getTodayIsoDate` |
| FF-012 | Fixed | `resolveRate` used in reissue and revision |
| FF-013 | Fixed | Em dashes removed from invoice lines, statement subject, timesheet and project names |
| FF-014 | Fixed | Rebuilding a capped statement invoice dropped it below the contracted monthly amount. New shared `statement-cap.ts` |

**Verification.** Lint clean, `tsc --noEmit` clean, 5,422 tests pass across 657 files
(97 in this section, up from 85), production build succeeds. The migration was validated
against production inside a transaction that was rolled back, so nothing was applied.

**Two things found while implementing, beyond the original 13:**

1. `buildInvoiceNotes` carried the same VAT and rate fallback bug as FF-004 in its
   carry-forward totals, on customer-facing invoice and timesheet text. It now routes through
   `getEntryCharge` and `getRecurringCharge` rather than re-deriving the maths, and the
   timesheet re-send path loads the rate columns it needs.
2. Unifying the retainer paths initially moved the client-name lookup ahead of the
   closed-retainer check, which an existing test caught. The lookup is now lazy, so the common
   case costs one query and never touches `invoice_vendors`.

### FF-014 (Critical, found late): rebuilding a capped invoice under-bills the client

**The rule.** Golden Barrels is billed a flat £500 inc VAT per month while they owe anything.
Work that does not fit accrues as debt. That is what `statement_mode` plus `billing_mode='cap'`
implements, via `applyStatementCapTopUp`, which raises the "Account balance payment" line until
the invoice totals the cap.

**The defect.** Only the billing cron applied it. Both rebuild paths, the invoice reissue and
the revise-on-entry-edit path, summed the remaining linked items and stopped. So any edit to an
entry on a capped client's invoice silently reduced that invoice below the agreed monthly
amount, and the shortfall was never collected: it did not roll into the debt, it simply
vanished from the bill.

**Live instance.** Marking one mileage entry non-billable on 17 August rebuilt Golden Barrels'
June invoice from £500 to £460.50, losing £39.50.

**Fix.** `applyStatementCapTopUp` and the new `computeStatementCapTargetIncVat` moved into
`src/lib/oj-projects/statement-cap.ts`, now used by the cron, the reissue path and the
entry-edit path.

**The trap inside the fix.** A rebuild can target any past month, and by the time it runs the
client may already hold later invoices. Topping June up against today's balance would bill money
that August is already collecting. So the balance is measured as at the invoice's own date:
the invoice query is bounded by `invoice_date`, excludes the invoice being rebuilt, and excludes
drafts and voids. Work is bounded by the period end. There is a test asserting those bounds.

**Effect on INV-003WC.** Rebuilding it now yields exactly £500: £460.50 of linked items topped
up from the £1,000 of May work still unbilled. The two 18 July entries and the 1 August invoice
are correctly excluded. The client's total owed returns to what it was before the edit.

---

**Data changed in production (one statement, approved):** the "possible duplicate" note was
stripped from both 26 May entry descriptions. It was factually wrong (the pair is a cap split
of a single one-hour call, not a duplicate) and it printed on the client-facing invoice PDF via
`invoice-template-compact.ts:665`.

**Not done deliberately:** rebuilding INV-003WC to £500, the deploy, and
`npx supabase db push`. When the cron next runs with this code, it will report INV-003WC under
`recovered_runs.orphan_needs_review` and leave its rows alone, because releasing rows attached
to a draft could duplicate that draft. So the fix is safe to ship before the decision is made.

---

## 1. Headline

There is one live money defect. Six time entries and one hosting charge for Golden Barrels
(£460.50 inc VAT) have been frozen since 1 July 2026. They are attached to a draft invoice
that was never sent, they cannot be billed again, and paying that invoice would not release
them either. Nothing in the app can see them: they are excluded from every "unbilled" figure.

Separately, the UI redesign silently dropped the only screen that let you check what the
billing cron was about to invoice before it auto-sent it to clients. That preview endpoint
still exists and works. Only the button is gone.

---

## 2. Defect log

| ID | Sev | Type | Summary |
|----|-----|------|---------|
| FF-001 | Critical | Data / money | Reissued invoice rows strand at `billing_pending` permanently |
| FF-002 | High | Lost feature | Billing preview and statement PDF download dropped from the UI |
| FF-003 | High | Permissions | Client-facing statement email is gated on `view`, not `edit` |
| FF-004 | Medium | Correctness | One-off entry VAT differs between cap accounting and the invoice line |
| FF-005 | Medium | Correctness | Draft invoices counted as receivables in the client balance |
| FF-006 | Medium | Correctness | Client balance ignores the client's configured rates |
| FF-007 | Low | Consistency | Two retainer project naming and coding conventions live in production |
| FF-008 | Low | Observability | Billing alert never fires when a run invoices nobody |
| FF-009 | Low | Data risk | No unique constraint on retainer project per client and month |
| FF-010 | Low | Correctness | `getEntries` with no page or limit relies on an implicit server cap |
| FF-011 | Low | Correctness | Statement date defaults use raw `toISOString()` |
| FF-012 | Low | Maintainability | Rate resolution hand-rolled in 5 places instead of `resolveRate` |
| FF-013 | Low | House style | Em dashes in a customer-facing email subject and in project names |

---

### FF-001 (Critical): reissued invoice rows strand at `billing_pending` permanently

**Evidence.**

Both RPCs that rebuild an OJ invoice deliberately null the run link:

- `reissue_oj_invoice_transaction`: `SET invoice_id = target_invoice_id, billing_run_id = NULL, status = 'billing_pending'`
- `replace_oj_invoice_transaction`: identical

Nothing can then move those rows on:

1. `recoverUnfinishedBillingRuns` ([route.ts:173](src/app/api/cron/oj-projects-billing/route.ts:173)) collects
   locked rows but immediately discards any whose `billing_run_id` is null, then looks the
   remainder up in `oj_billing_runs`. Rows with no run are invisible to it. The function's own
   docstring claims it is "driven off the LOCKED ROWS, not the run's status", which is the
   intent, but the implementation still funnels through the run id.
2. `oj_mark_entries_paid_on_invoice_paid` only updates rows `WHERE status = 'billed'`. So even
   marking the invoice paid leaves them at `billing_pending`.
3. Every eligibility query in the cron selects `status = 'unbilled'`, so they are never re-billed.
4. There is no code path anywhere that moves a row from `billing_pending` to `billed` except
   one keyed on `billing_run_id`, which is null here.

**Live state.**

```
INV-003WC  draft  2026-07-01  £460.50  Golden Barrels Limited  ref "OJ Projects 2026-06"
  holds 6 oj_entries + 1 oj_recurring_charge_instance, all status='billing_pending', billing_run_id=NULL
```

The June run raised INV-003W5 (£500). That invoice was voided and reissued as INV-003WC
(£460.50), which was never sent. The £460.50 reconciles exactly: (£343.75 entries + £40.00
hosting) x 1.2.

Diagnostic (all three should be zero outside a run, currently 6 / 1 / 0):

```sql
select (select count(*) from oj_entries where status='billing_pending') as entries_locked,
       (select count(*) from oj_recurring_charge_instances where status='billing_pending') as charges_locked,
       (select count(*) from oj_billing_runs where run_finished_at is null and status in ('processing','failed')) as unfinished_runs;
```

Note the third counter is 0, which is why the August 2026 run reported healthy. The existing
diagnostic in `reference_oj_billing_run_lifecycle` catches the old stranding shape but not
this one.

**Impact.** Work is neither invoiced nor invoiceable. It does not appear in
`getBillableUnbilledCount`, in the client balance unbilled totals, or in any billing preview.
It is only visible by filtering the entries list to "Billing Pending". Any future reissue
reproduces the state.

**Fix.**

1. Make `billing_pending` recoverable without a run. In `recoverUnfinishedBillingRuns`, handle
   run-less locked rows as a separate branch keyed on the row's `invoice_id`:
   - invoice sent / overdue / partially paid: set `billed`
   - invoice paid: set `paid`
   - invoice void, deleted, or missing: release to `unbilled`, clear `invoice_id`
   - invoice still draft: leave alone but report it, and count it in the run summary
2. Broaden `oj_mark_entries_paid_on_invoice_paid` to settle `billing_pending` as well as
   `billed`, so paying a reissued invoice closes its rows.
3. Add a settle step when an OJ invoice moves from draft to sent, so reissued rows become
   `billed` at the point the invoice actually goes out. A trigger on `invoices` status change
   is the least invasive place.
4. Add a drift check to the reminders cron: if any row is `billing_pending` and its invoice is
   draft or missing for more than N days, alert.

**Acceptance criteria.**
- Reissue a sent invoice in a test client, then run the billing cron with `force=true`: rows
  end at `billed` against the new invoice, never stuck.
- Mark a reissued draft as sent, then paid: rows reach `paid`.
- Void a reissued draft: rows return to `unbilled` and appear in the next preview.
- The three-counter diagnostic returns zeroes after a run.

**Data remediation for INV-003WC: owner decision required, see section 4.**

---

### FF-002 (High): billing preview and statement PDF download dropped from the UI

**Evidence.** `git log -S` shows commit `4506a72a` ("feat(03-03): build entries, clients, and
work-types sub-pages") rewrote `clients/page.tsx` into `ClientsClient.tsx` and removed both
callers:

```
-      const res = await fetch(`/api/oj-projects/billing-preview?vendor_id=${vendorId}`)
-    const url = `/api/oj-projects/statement-pdf?vendorId=${vendorId}&dateFrom=${...}&dateTo=${...}`
```

`/api/oj-projects/billing-preview` and `/api/oj-projects/statement-pdf` now have zero callers
anywhere in `src/`. Both still work. Every other OJ server action does have a UI caller, so
these two endpoints are the only orphans.

**Impact.** The billing cron auto-raises and emails invoices to real clients at 01:05 on the
1st with no human gate. The preview was the only way to see what it would send. Its loss is
the reason a wrong invoice reaches a client before anyone notices. The statement PDF can still
be emailed to the client but not downloaded for internal use.

**Fix.** Restore both controls in `ClientsClient.tsx`: a "Preview next invoice" action in the
client drawer that calls the existing endpoint, and a "Download PDF" button next to the
existing "Email statement" action. No server work needed.

**Acceptance criteria.** Preview renders the same figures the cron would bill for that client
for the previous month, including cap carry-forward. PDF downloads with the existing filename
format.

---

### FF-003 (High): client-facing statement email gated on `view`

**Evidence.** [client-statement.ts:304](src/app/actions/oj-projects/client-statement.ts:304):

```ts
const hasPermission = await checkUserPermission('oj_projects', 'view')
```

The function then sends a real email with a PDF attachment to the client's billing address.

**Impact.** Anyone with read-only access to OJ Projects can send a client their account
statement. Every other outward-facing action in the section requires `edit`.

**Fix.** Change to `checkUserPermission('oj_projects', 'edit')`. Verify the roles that hold
`oj_projects view` but not `edit` before shipping.

**Sibling check.** All other OJ actions were checked: 18 `view`, 13 `edit`, 6 `create`,
3 `delete`. `sendStatementEmail` is the only mutation or send behind `view`.

---

### FF-004 (Medium): one-off entry VAT differs between cap accounting and the invoice line

**Evidence.** Two functions in the same file disagree on the fallback:

- [route.ts:641](src/app/api/cron/oj-projects-billing/route.ts:641) `getEntryCharge`, used for cap
  accounting: `Number(entry.vat_rate_snapshot ?? settings?.vat_rate ?? 20)`
- [route.ts:1503](src/app/api/cron/oj-projects-billing/route.ts:1503) `buildDetailedLineItems`, which
  builds the actual invoice line: `Number(e.vat_rate_snapshot || 0)`

Time entries use `??` in both places and are correct. Recurring instances intentionally use
`|| 0` and carry a real snapshot, so they are fine. One-off entries are the odd one out.

**Impact.** A one-off charge with a null `vat_rate_snapshot` would be invoiced at 0% VAT while
the cap accounting counted it at 20%. That is an under-charge of VAT and a cap overrun in the
same transaction. The reissue path (`invoice-revision.ts:192`) would then re-invoice the same
entry at 20%, so a reissue would silently change the VAT on a line.

**Live exposure.** None today: all 3 one-off entries in production carry a VAT snapshot. This
is latent, not active.

**Fix.** Change line 1503 to `Number(e.vat_rate_snapshot ?? input.settings?.vat_rate ?? 20)`,
matching `getEntryCharge` and the revision builder. Add a test asserting the cap accounting
and the generated line item agree on VAT for a null-snapshot one-off.

---

### FF-005 (Medium): draft invoices counted as receivables

**Evidence.** [client-balance.ts:63](src/app/actions/oj-projects/client-balance.ts:63):

```ts
.not('status', 'in', '(paid,void,written_off)')
```

`draft` is not excluded, so an unsent draft counts toward `unpaidInvoiceBalance` and therefore
`totalOutstanding`.

**Impact.** Golden Barrels' Total Outstanding currently includes £460.50 for INV-003WC, an
invoice the client has never seen. Against 2 open invoices totalling £960.50, that is 48% of
the reported balance.

**Fix.** Decide whether a draft is a receivable. Recommended: exclude `draft` from
`unpaidInvoiceBalance` and surface it as its own "Draft, not yet sent" line in the drawer so
it is visible without inflating what the client owes.

---

### FF-006 (Medium): client balance ignores the client's configured rates

**Evidence.** [client-balance.ts:118](src/app/actions/oj-projects/client-balance.ts:118) and
[:123](src/app/actions/oj-projects/client-balance.ts:123):

```ts
const rate = resolveRate(entry.hourly_rate_ex_vat_snapshot, DEFAULT_HOURLY_RATE_EX_VAT)
const mileageRate = resolveRate(entry.mileage_rate_snapshot, DEFAULT_MILEAGE_RATE)
```

The billing engine passes the client's setting in between:

```ts
resolveRate(e.hourly_rate_ex_vat_snapshot, settings?.hourly_rate_ex_vat, DEFAULT_HOURLY_RATE_EX_VAT)
```

**Impact.** For an entry with a null rate snapshot, the drawer values the work at £75/hour
while billing would charge £62.50, overstating unbilled work by 20%. The file already loads
`oj_vendor_billing_settings` for `vat_rate`, so the settings row is in hand.

**Live exposure.** None today: no production entry has a null hourly rate snapshot. Latent.

**Fix.** Select `hourly_rate_ex_vat, mileage_rate` alongside `vat_rate` and pass them as the
middle candidate in both calls.

---

### FF-007 (Low): two retainer naming and coding conventions in production

**Evidence.** Two code paths create retainer projects and disagree:

- Cron [oj-projects-retainer-projects/route.ts:159](src/app/api/cron/oj-projects-retainer-projects/route.ts:159):
  code `OJP-BP-RET-202608`, name `Barons Pubs [EMDASH] Retainer (Aug 2026)`
- Entries [entries.ts:233](src/app/actions/oj-projects/entries.ts:233):
  code `OJP-BP-54FEC` (random suffix), name `Barons Pubs Retainer (Jul 2026)`

Live data shows all three conventions coexisting, including a legacy `RET-BAR-2025-09` set:

```
RET-BAR-2026-01      Monthly Retainer - January 2026
OJP-BP-RET-202606    Barons Pubs [EMDASH] Retainer (Jun 2026)   <- cron
OJP-BP-54FEC         Barons Pubs Retainer (Jul 2026)            <- entries path, created 26 Jun
OJP-BP-RET-202608    Barons Pubs [EMDASH] Retainer (Aug 2026)   <- cron
```

July diverged because someone logged a July-dated entry on 26 June, so the entries path
created the project first and the cron skipped it on 1 July.

**Fix.** Extract one `resolveRetainerProject` helper used by both the cron and the entries
action, producing the `OJP-<CLIENT>-RET-<YYYYMM>` code and one name format. Drop the em dash.
Backfill the July row's code and name to match.

---

### FF-008 (Low): billing alert never fires when a run invoices nobody

**Evidence.** [billing-alerts.ts:73](src/lib/oj-projects/billing-alerts.ts:73):

```ts
const failedVendors = results.vendors.filter((v) => v.status === 'failed')
if (failedVendors.length === 0) return
```

The `zero_vendor_run` failure tier is declared in the type union and never assigned anywhere.

**Impact.** A month where the cron finds no eligible clients, or skips everyone, sends no
alert. Billing silently not happening looks identical to billing happening cleanly.

**Fix.** Alert when `results.sent === 0`, and populate the `zero_vendor_run` tier, so a month
with no invoices raised is always reported.

---

### FF-009 (Low): no unique constraint on retainer project per client and month

**Evidence.** `oj_projects` has a unique constraint on `project_code` only. Both
`resolveRetainerProject` ([entries.ts:257](src/app/actions/oj-projects/entries.ts:257)) and the
cron use `.maybeSingle()` on `(vendor_id, is_retainer, retainer_period_yyyymm)`.

**Impact.** Two concurrent entry creations at the start of a month can both find nothing and
both insert. After that, `.maybeSingle()` throws on every subsequent entry for that client and
month, so entry logging hard-fails until someone deletes a row. No duplicates exist today.

**Fix.** Add a partial unique index and let the insert conflict rather than racing:

```sql
create unique index concurrently oj_projects_retainer_period_uniq
  on oj_projects (vendor_id, retainer_period_yyyymm) where is_retainer;
```

---

### FF-010 (Low): `getEntries` with no page or limit relies on an implicit cap

**Evidence.** [entries.ts:847](src/app/actions/oj-projects/entries.ts:847) applies `.range()` only
when `pageSize` is set and `.limit()` only when `limit` is set. The overview page calls
`getEntries({ ...currentMonthRange, ...vendorFilter })` with neither, so the result is capped
by the PostgREST default (1000) with no indication of truncation.

**Fix.** Give `getEntries` an explicit default limit and have the overview pass one.

---

### FF-011 (Low): statement date defaults use raw `toISOString()`

**Evidence.** `ClientsClient.tsx:263-264` builds the default statement range with
`new Date().toISOString().split('T')[0]`, against the project rule to use `src/lib/dateUtils.ts`.

**Impact.** Between midnight and 01:00 BST the default range starts and ends a day early.

**Fix.** Use `getTodayIsoDate()` and `shiftIsoDate()`.

---

### FF-012 (Low): rate resolution hand-rolled instead of `resolveRate`

**Evidence.** `invoice-reissue.ts:165,170` and `invoice-revision.ts:94,106,200` re-implement the
fallback chain with `??` and hardcoded `75` / `0.55` rather than importing `resolveRate` and
the `DEFAULT_*` constants.

These are correct for a zero rate (`??` preserves zero, unlike the `||` bug fixed in August),
so this is maintainability, not a live defect. The risk is drift: the constants are duplicated
in two files, and an empty-string rate resolves to 0 here but is skipped by `resolveRate`.

**Fix.** Import `resolveRate`, `DEFAULT_HOURLY_RATE_EX_VAT`, `DEFAULT_MILEAGE_RATE`.

---

### FF-013 (Low): em dashes in customer-facing output

**Evidence.**
- [client-statement.ts:343](src/app/actions/oj-projects/client-statement.ts:343): the statement
  email subject sent to clients is `Account Statement [EMDASH] {name} [EMDASH] {from} to {to}`
- Retainer cron project names, per FF-007
- `buildDetailedLineItems` project labels join code and name with the same character, so it
  appears on invoice line descriptions

**Fix.** Replace with a comma, colon, or brackets per house style.

---

## 3. What is healthy

Checked and found correct, recorded so it is not re-investigated:

- **Permissions.** Consistent `oj_projects` module naming across all 40 call sites, and the
  module exists in the DB with all 5 actions granted. Only FF-003 is wrong.
- **Audit logging.** Every one of the 26 mutating server actions calls `logAuditEvent`.
- **RLS.** Enabled with policies on all 8 `oj_*` tables.
- **No dead duplicate clients.** All 6 pages import from their own `_components` directory.
- **Numeric handling.** `typeof x === 'number'` on numeric columns is safe here: cap mode
  demonstrably works in production (Golden Barrels invoices land at exactly £500.00 with
  `carried_forward_inc_vat` persisted), so PostgREST is returning numerics as JS numbers.
- **Mileage VAT.** Zero-rated consistently in cap accounting, invoice lines, and the balance.
- **Period maths.** `getPreviousMonthPeriod` is correct across year boundaries and both DST
  changes.
- **Dry run safety.** `billing-preview` cannot mutate: recovery is skipped and the handler
  returns before the write loop.
- **Recurring frequency.** The August 2026 anniversary fix is intact and shared by all three
  callers.
- **Rate zero handling.** `resolveRate` is correctly used throughout the cron.
- **Uncommitted work in progress.** The server-side entry filtering in `entries.ts` and
  `EntriesClient.tsx` type-checks, passes its 120 lines of new tests, and correctly guards
  against out-of-order responses with a request sequence. One caveat: the `.or()` clause can
  embed up to 1000 UUIDs, roughly 37KB of URL, which will exceed server URL limits on a large
  client. Cap the id lists or move the search to an RPC before this scales.

---

## 4. Owner decisions required

### Decision 1: how to clear INV-003WC

Golden Barrels currently has £1,250 ex VAT of genuinely unbilled work queued behind this, and
is on a £500/month cap, so the backlog matters.

| Option | Effect |
|---|---|
| **A. Release (recommended)** | Void INV-003WC, return the 6 entries and 1 charge to `unbilled`. The 1 September run picks them up inside the cap, oldest first. Nothing is lost, the client sees one clean invoice. |
| B. Send as-is | Send INV-003WC now for £460.50. Needs FF-001 fixed first, or the rows stay stuck even after payment. |
| C. Force settle | Mark the 7 rows `billed` against INV-003WC and send. Fastest, but leaves the June period reporting two invoices. |

Option A is recommended because the invoice is 6 weeks stale, the client has never seen it,
and the cap means the work will be billed in an orderly queue anyway.

### Decision 2: are draft invoices receivables (FF-005)?

Recommended: no. Exclude them from Total Outstanding and show them separately, so the balance
reflects what the client has actually been asked to pay.

---

## 5. Suggested delivery order

Each phase is independently deployable.

| Phase | Contents | Complexity |
|---|---|---|
| 1 | FF-001 code fix (recovery branch, trigger, settle-on-send), then the FF-001 data remediation once Decision 1 is made | M |
| 2 | FF-002 restore preview and PDF buttons, FF-003 permission fix | S |
| 3 | FF-004, FF-005, FF-006 correctness fixes with tests | S |
| 4 | FF-007 to FF-013 cleanup, plus the FF-009 index | M |

Do not apply the FF-009 unique index before FF-007 unifies the two creation paths, or a
concurrent create will start failing instead of racing.

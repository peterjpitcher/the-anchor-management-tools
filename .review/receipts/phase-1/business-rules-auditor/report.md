# Business Rules Auditor Report — Receipts Module

**Date:** 2026-03-07
**Scope:** Phase 1 business rules audit
**Auditor role:** Policy drift, value mismatches, stale logic, misleading language

---

## 1. Rules Inventory

| Rule | Source | Code Location | Value in Code | Expected Value | Verdict |
|---|---|---|---|---|---|
| CSV max upload size | Brief | `receipts.ts:35` | `15 * 1024 * 1024` (15 MB) | 15 MB | PASS |
| CSV format: Date, Details, Transaction Type, In, Out, Balance | Brief | `receipts.ts:69-76` (`CsvRow` type) | Matches exactly | Matches | PASS |
| Dedupe hash prevents duplicate import | Brief | `receipts.ts:581-592` | SHA-256 of all 6 fields joined by `\|` | Robust hash | PASS (see §7) |
| AI batch classification: single OpenAI call | Brief | `ai-classification.ts:198` | Single `classifyReceiptTransactionsBatch` call | Single call | PASS |
| AI usage logged to DB | Brief | `ai-classification.ts:231` | `recordAIUsage(...)` after batch | Required | PASS |
| Failure logs `ai_classification_failed` | Brief | `ai-classification.ts:213-228` | Inserts `action_type: 'ai_classification_failed'` | Required | PASS |
| Re-queue targets `vendor_name IS NULL AND vendor_source IS NULL` | Brief | `receipts.ts:3239-3243` | `.is('vendor_name', null).is('vendor_source', null)` | Both conditions | PASS (see §5) |
| Classification sources: `ai`, `rule`, `manual` | Brief | Multiple | Used consistently | Required | PASS |
| Rules match on `details` string | Brief | `rule-matching.ts:84-108` | Matches `match_description` needles against `details` | Required | PASS |
| Rules have direction `in`/`out`/`both` | Brief | `rule-matching.ts:52-59` | Enforced before any other matching | Required | PASS (see §6) |
| Rules applied at import AND retro-run | Brief | `receipts.ts:1338`, `receipts.ts:1015` | Both paths confirmed | Required | PASS |
| Rule preview shows overlap count | Brief | `receipts.ts:3352-3366` | Counts per existing rule, top 5 returned | Required | PASS |
| Permissions: `receipts`/`view` and `receipts`/`export` | Brief | `page.tsx:29-30`, `export/route.ts:24` | Both checked | Required | PASS |
| All server actions re-verify auth server-side | Brief | All major actions | `checkUserPermission(...)` at top of every exported action | Required | PASS |
| OUTSTANDING_STATUSES includes only `pending` | Brief/Code | `receipts.ts:41` | `['pending']` | Likely correct | FLAG (see §10) |
| Expense categories enforced via Zod enum | Brief | `receipts.ts:39` | `receiptExpenseCategorySchema.options` | Required | PASS |
| `auto_completed` status set by rule | Brief | `receipts.ts:842-855` | Rule's `auto_status` applied | Required | PASS |
| `completed` set on receipt upload | Brief | `receipts.ts:1729` | `status: 'completed'` on upload | Required | PASS |
| P&L view: groups by expense category and vendor | Brief | `receipts.ts:3041-3115` (vendor trends), monthly insights | Provided via RPCs | Required | PASS |
| Vendor summary shows trend per vendor across months | Brief | `receipts.ts:3041-3115` | `get_receipt_vendor_trends` RPC | Required | PASS |
| Expense can only be set on outgoing transactions | Domain rule | `receipts.ts:1547-1549`, `receipts.ts:1961-1963` | Enforced in `updateReceiptClassification` and `createReceiptRule`/`updateReceiptRule` | Required | PASS |

---

## 2. Value Audit

| Constant | Location | Value in Code | Expected | Verdict |
|---|---|---|---|---|
| `MAX_RECEIPT_UPLOAD_SIZE` | `receipts.ts:35` | `15 * 1024 * 1024` (15,728,640 bytes) | 15 MB | PASS |
| `DEFAULT_PAGE_SIZE` | `receipts.ts:36` | `25` | Not specified — reasonable | PASS |
| `MAX_MONTH_PAGE_SIZE` | `receipts.ts:37` | `5000` | Not specified | PASS |
| `RECEIPT_AI_JOB_CHUNK_SIZE` | `receipts.ts:38` | `10` | Not specified | NOTE: This is the job enqueue chunk size, not the AI batch size. Each job of 10 IDs triggers a single batch call. Reasonable. |
| `OUTSTANDING_STATUSES` | `receipts.ts:41` | `['pending']` | Not defined in brief | FLAG — see §10 |
| `RETRO_CHUNK_SIZE` | `receipts.ts:996` | `100` | Not specified | PASS |
| `refreshAutomationForPendingTransactions` limit | `receipts.ts:2729` | `.limit(500)` | Not specified | NOTE: Cap of 500 means if there are >500 pending transactions when a rule is toggled on, not all will be re-evaluated. Silent truncation. |
| `runReceiptRuleRetroactively` time budget | `receipts.ts:2740` | `12_000` ms (12 seconds) | Not specified | NOTE: Partial completion silently returns `done: false`. Callers (the step-based hook) handle pagination, so this is only relevant for the non-step version. |
| `previewReceiptRule` sample size | `receipts.ts:3307` | `.limit(2000)` | Not specified | PASS — UI labels this as "sample of up to 2000 transactions" |
| Signed URL expiry | `receipts.ts:2862` | `60 * 5` (5 minutes) | Not specified | PASS — reasonable for view-only links |
| Vendor name max length | `receipts.ts:386`, `receipts.ts:526` | 120 chars (Zod + normalizer) | Not specified | PASS — consistent |
| `DOWNLOAD_CONCURRENCY` (export) | `export/route.ts:14` | `4` | Not specified | PASS |
| `RECEIPT_BUCKET` | `receipts.ts:34`, `export/route.ts:13` | `'receipts'` | Consistent | PASS |

---

## 3. Status Transition Audit

### Which transitions are possible via the UI?

The `handleStatusUpdate` function in `ReceiptTableRow.tsx` calls `markReceiptTransaction`, which accepts any valid status. There are no server-side guards preventing any-to-any transitions. The UI renders buttons conditionally:

- "Mark as done" (`completed`) — shown when status is NOT `completed`
- "Skip (no receipt needed)" (`no_receipt_required`) — shown when status is NOT `no_receipt_required`
- "Mark as missing" (`cant_find`) — shown when status is NOT `cant_find`
- "Reopen" (`pending`) — shown when status is NOT `pending`

**`auto_completed` is NOT reachable via any UI button in `ReceiptTableRow`.** It can only be set by a rule. A user can, however, move away from `auto_completed` to any other status (the "Reopen" and other buttons show when the current status is `auto_completed`).

### Status reachability summary

| Status | Set by UI? | Set by rule? | Set by upload? | Can be reset to `pending`? |
|---|---|---|---|---|
| `pending` | Yes (Reopen button) | No — rules never set `pending` as a meaningful outcome (though rules can have `auto_status: 'pending'`) | No (reverts to `pending` on file delete if no files remain) | N/A |
| `completed` | Yes (Mark as done button) | No (rules don't set `completed`) | Yes (receipt upload) | Yes (Reopen button) |
| `auto_completed` | No | Yes | No | Yes (Reopen button) |
| `no_receipt_required` | Yes (Skip button) | Yes (most common rule outcome) | No | Yes (Reopen button) |
| `cant_find` | Yes (Missing button) | No | No | Yes (Reopen button) |

**Finding:** `auto_completed` is unreachable as a manual UI action — only rules set it. This appears intentional. However, the `ReceiptRules` component exposes `auto_completed` as a selectable `autoStatus` for new rules, which is the correct creation path.

**Finding:** `completed` → `pending` transition is allowed and correctly handled: when `deleteReceiptFile` removes the last receipt file, it resets the transaction to `pending` (server-side, `receipts.ts:1886-1911`). When a user clicks "Reopen" on a `completed` transaction, this is also allowed — but the receipt files are NOT automatically deleted. This means a transaction can be `pending` with receipt files still attached. This is a minor policy ambiguity — no business rule explicitly forbids it, but it is inconsistent.

---

## 4. Admin/Staff-Facing Language Audit

### Status Labels (`utils.ts` and duplicated in `ReceiptRules.tsx`, `ReceiptBulkReviewClient.tsx`)

| DB value | Label shown | Verdict |
|---|---|---|
| `pending` | "Pending" | PASS |
| `completed` | "Completed" | PASS |
| `auto_completed` | "Auto completed" | PASS — matches brief |
| `no_receipt_required` | "No receipt required" | PASS — matches brief |
| `cant_find` | "Can't find" | PASS |

**Finding:** The status label `auto_completed` is displayed in `ReceiptStats.tsx` as **"Auto-matched"** (`title="Auto-matched"`), not "Auto completed". This is an inconsistency. Everywhere else the status is called "Auto completed". The stat card heading diverges from the status name used in filters, table badges, and the export CSV.

### Export CSV friendly names (`export/route.ts:241-253`)

| DB value | Export label | Verdict |
|---|---|---|
| `auto_completed` | "Auto completed" | PASS — consistent with brief |
| `no_receipt_required` | "No receipt req." | MINOR — truncated abbreviation differs from the full label used everywhere else |

### Rule creation UI (`ReceiptRules.tsx` and `ReceiptBulkReviewClient.tsx`)

- Both components expose all 5 statuses as valid `autoStatus` options for rules. This includes `completed` and `cant_find`, which are unusual choices for an automation rule but not technically wrong.
- The UI label "Rule preview (sample of up to 2000 transactions)" correctly communicates the limitation.

---

## 5. Re-queue Logic Audit

**Stated rule:** Re-queue targets `vendor_name IS NULL AND vendor_source IS NULL`.

**Code (`receipts.ts:3239-3243`):**
```typescript
const { data, error } = await supabase
  .from('receipt_transactions')
  .select('id, batch_id')
  .is('vendor_name', null)
  .is('vendor_source', null)
  .limit(5000)
```

Both conditions are enforced: `.is('vendor_name', null)` AND `.is('vendor_source', null)`.

**PASS — the implementation matches the stated rule exactly.**

However, one observation: the re-queue targets transactions with no vendor data, but does NOT filter on `expense_category`. A transaction that has a vendor but no expense category would not be re-queued by this function. The `classifyReceiptTransactionsWithAI` function handles the expense-only case (it checks `needsExpense` separately), but the re-queue entry point only admits transactions with neither vendor_name nor vendor_source. If AI previously set a vendor but failed to set an expense category (e.g. due to a partial batch failure), those transactions would not be re-queued by `requeueUnclassifiedTransactions`.

**Flag:** Potential gap — transactions with `vendor_name` set by AI but `expense_category` still null are excluded from re-queue. The brief does not explicitly address this case.

---

## 6. Rule Direction Logic Audit

**In `rule-matching.ts:52-59`:**
```typescript
if (rule.match_direction !== 'both' && rule.match_direction !== context.direction) {
  return { matched: false, ... }
}
```

The direction context is derived in `receipts.ts:607-612`:
```typescript
function getTransactionDirection(tx): 'in' | 'out' {
  if (amountIn && amountIn > 0) return 'in'
  return 'out'
}
```

**Finding — Direction detection is asymmetric.** A transaction with `amount_in > 0` is always classified as `'in'`, even if it also has a non-zero `amount_out`. A transaction with `amount_in = null` or `amount_in = 0` is always `'out'`, even if `amount_out` is also null/zero. This means a transaction with both amounts populated (rare but possible in some bank export formats) will be treated as `'in'` only, and a rule with `direction: 'out'` will not match it.

A different direction derivation is used in `ai-classification.ts:19-22`:
```typescript
function getTransactionDirection(tx: ReceiptTransaction): 'in' | 'out' {
  if (tx.amount_in && tx.amount_in > 0) return 'in'
  return 'out'
}
```

The two implementations are identical in behaviour — this is consistent. However, the `deriveDirection` function used in `buildGroupSuggestion` (`receipts.ts:573-579`) uses a more sophisticated comparison:
```typescript
function deriveDirection(amountIn, amountOut): 'in' | 'out' {
  const outValue = amountOut ?? 0
  if (outValue > 0 && outValue >= inValue) return 'out'
  if (inValue > 0) return 'in'
  return outValue > inValue ? 'out' : 'in'
}
```

**Flag:** Three direction-derivation functions exist in the codebase for the receipts domain. Two (`getTransactionDirection` in receipts.ts and ai-classification.ts) are identical but duplicated. The third (`deriveDirection`) is more nuanced and only used in one context (bulk group AI suggestions). There is no single canonical direction function. This is a policy consistency risk — if the canonical rule changes, it must be updated in multiple places.

**Verdict for stated rule:** `direction: 'in'` correctly only matches transactions where `amount_in > 0`. `direction: 'out'` correctly matches all other transactions. `direction: 'both'` skips the direction check entirely. **PASS for the core stated rule**, but the duplication and edge case noted above are risks.

---

## 7. Dedupe Logic Audit

**Hash computation (`receipts.ts:581-592`):**
```typescript
function createTransactionHash(input: {
  transactionDate: string
  details: string
  transactionType: string | null
  amountIn: number | null
  amountOut: number | null
  balance: number | null
}): string {
  const hash = createHash('sha256')
  hash.update([
    input.transactionDate,
    input.details,
    input.transactionType ?? '',
    input.amountIn ?? '',
    input.amountOut ?? '',
    input.balance ?? ''
  ].join('|'))
  return hash.digest('hex')
}
```

**Findings:**

1. **Balance is included in the hash.** This is appropriate — it makes collisions between superficially identical transactions in different positions in the statement impossible. However, it also means that if the bank reformats the balance column (e.g. rounding differences), the same transaction could re-import with a different hash. This is an edge-case risk but not a defect given the current CSV format.

2. **Number-to-string coercion risk.** `amountIn ?? ''` coerces a `number` directly to string using JavaScript's default `toString()`. `Number(1.1).toString()` is `'1.1'` and `Number(1.10).toString()` is also `'1.1'`, so trailing zero stripping is not an issue. However, floating point imprecision is a theoretical risk: `parseCurrency` rounds to 2 decimal places before returning (`Number(result.toFixed(2))`), so the values going into the hash are always 2dp. **This is handled correctly.**

3. **The `details` field is sanitized** (trimmed + whitespace collapsed) before hashing. If a bank statement re-exports the same transaction with extra whitespace, the sanitization ensures the hash is identical. **PASS.**

4. **`transactionType ?? ''` means a null type and an empty-string type hash the same way.** This is a minor collision risk for banks that sometimes emit an empty transaction type vs null. Given that the sanitizer converts empty strings to null (`sanitizeText(record['Transaction Type'] || '') || null`), this is handled consistently at parse time. **PASS.**

**Overall:** The dedupe hash is reasonably robust for the expected input format. It is not immune to bank-side reformatting of the same transaction (e.g. balance rounding) but this is an inherent limitation of any field-based hash.

---

## 8. Bulk Apply Logic Audit

**`applyReceiptGroupClassification` (`receipts.ts:2430-2611`):**

The function selects matching transactions using:
```typescript
supabase
  .from('receipt_transactions')
  .select('id, status, amount_in, amount_out')
  .eq('details', parsed.data.details)
  .in('status', statuses)
```

The match criterion is **exact string match on `details`** combined with a **status filter**.

**Findings:**

1. **The `statuses` parameter passed from the UI is the bulk review filter's current status list** (from `initialData.config.statuses`). This means the bulk apply only updates transactions matching the statuses the user was browsing. If the user was viewing only `pending` transactions, clicking "Apply" will only update `pending` transactions with that description, even if `auto_completed` transactions with the same description exist. This is arguably correct (you apply to what you're reviewing) but not made explicit to the user in the UI — there is no confirmation dialog stating "this will update X pending transactions".

2. **Expense category skip for incoming-only transactions.** The code correctly identifies `isIncomingOnlyTransaction` and skips expense updates for those rows. The vendor update still applies to all matched rows regardless of direction. This matches the domain rule that expense categories are only for outgoing transactions. **PASS.**

3. **The `bulkGroupApplySchema` validates `details` as `z.string().min(1)`.** This prevents empty-string group applies. **PASS.**

4. **Fuzzy grouping:** The bulk review page supports a "fuzzy group similar transactions" toggle (via `use_fuzzy_grouping` RPC parameter). However, when fuzzy grouping is active, the `applyReceiptGroupClassification` still matches on **exact `details`** (not the normalized/fuzzy details). This means the apply scope may be narrower than what the user sees in fuzzy mode — the user sees a fuzzy-grouped card but the apply only updates transactions whose raw `details` field exactly matches the group's canonical `details` string.

**Flag:** The discrepancy between fuzzy display grouping and exact-match application is a policy ambiguity. A user who sees 12 transactions grouped fuzzy-together may apply a vendor and find only 5 were actually updated (those with the exact `details` string, not the normalized variants).

---

## 9. Export Accuracy Audit

**CSV columns produced by `buildSummaryCsv` (`export/route.ts:174-187`):**

```
Date | Details | Transaction type | Vendor | Vendor source | Expense category |
Expense category source | AI confidence | Amount in (GBP) | Amount out (GBP) | Status | Notes
```

**Comparison against UI columns:**

The workspace table shows: Date, Details/Type, Vendor (+badge), Expense (+badge), Amount In, Amount Out, Status, Files, Notes.

The export includes all data-carrying columns. It does not include the receipt file list (files are included as attachments in the ZIP alongside the CSV), which is correct.

**Findings:**

1. **`ai_suggested_keywords` is NOT in the export.** This field is stored on the transaction and visible implicitly through the rule suggestion workflow, but it is not exposed in the CSV. It is an internal/operational field, so its absence from the export is not a policy violation.

2. **`balance` (running balance from the bank statement) is NOT in the export.** It is imported and stored but not shown in the UI or included in the export. Not required by any stated rule, but a completeness note.

3. **"AI confidence" column is present** in the export — confirmed at `export/route.ts:202`. This matches the memory note that the export was recently updated to include AI confidence. **PASS.**

4. **`Vendor source` and `Expense category source` are in the export** — confirmed at `export/route.ts:199-201`. **PASS.**

5. **The export uses `friendlyStatus()` which maps `auto_completed` → `"Auto completed"`.** The CSV header is "Status". The value is human-readable, not the raw DB enum value. This is appropriate for an accountant-facing export but means the exported CSV cannot be round-tripped back into the system without status re-mapping.

6. **Export permission:** `checkUserPermission('receipts', 'export')` checked at route level. **PASS.**

7. **`no_receipt_required` is abbreviated to `"No receipt req."` in the export friendly label**, whereas it is "No receipt required" everywhere else. Minor inconsistency.

---

## 10. Policy Drift Findings

### 10.1 `OUTSTANDING_STATUSES` only includes `pending`

**Location:** `receipts.ts:41`
```typescript
const OUTSTANDING_STATUSES: ReceiptTransaction['status'][] = ['pending']
```

This constant controls the "Show only outstanding" filter. The filter treats only `pending` as outstanding. This excludes `cant_find` transactions from the outstanding view — which arguably should also need attention. The brief says `cant_find` means "receipt cannot be located", which is an unresolved state requiring follow-up.

**Flag:** If the business considers `cant_find` to be "outstanding" (needing attention), this filter is wrong. If it is intentional that `cant_find` is a terminal state requiring no further action, the constant is correct. No business rule explicitly clarifies this. The `needsAttentionValue` in the summary is also set to `pending` only (`receipts.ts:2715`).

### 10.2 Status label mismatch in `ReceiptStats`

**Location:** `ReceiptStats.tsx:83`
```tsx
<SummaryCard title="Auto-matched" value={summary.totals.autoCompleted} tone="info" />
```

The status is called `auto_completed` in the DB, "Auto completed" in all label maps, and "Auto completed" in the export. The stats card is the only place it appears as "Auto-matched". This is misleading — a user who sees "Auto-matched" in the stat card and then tries to filter by status will find a filter called "Auto completed", not "Auto-matched".

**Policy drift verdict: FAIL** — inconsistent naming of `auto_completed` status in the stats component.

### 10.3 Rule application silently skips non-pending transactions without `includeClosed`

**Location:** `receipts.ts:779-781`
```typescript
const isPending = transaction.status === 'pending'
if (!includeClosed && !isPending) continue
```

When `applyAutomationRules` is called at import time (via `importReceiptStatement`), `includeClosed` defaults to `false`. This means rules are only applied to newly imported `pending` transactions. This is correct — it prevents rules from overwriting manually resolved transactions on re-import.

However, `refreshAutomationForPendingTransactions` (called when a rule is toggled active) also uses default `includeClosed: false`, which is correct: it refreshes only pending transactions. **PASS.**

### 10.4 `getTransactionDirection` direction bias for zero-amount transactions

Both direction functions in the codebase return `'out'` as the default when `amount_in` is null/zero. A transaction with `amount_in = null` and `amount_out = null` is classified as `'out'`. Such transactions are filtered out at parse time (`receipts.ts:465`) — they don't enter the DB — so this edge case does not arise in practice. **PASS.**

### 10.5 Rule expense constraint on direction is validated at creation but not enforced at run-time

**Location:** `receipts.ts:1961-1963`
```typescript
if (parsed.data.set_expense_category && parsed.data.match_direction !== 'out') {
  return { error: 'Expense auto-tagging rules must use outgoing direction' }
}
```

This constraint is enforced in `createReceiptRule` and `updateReceiptRule`. However, at rule *application* time in `applyAutomationRules`, the expense update is conditionally applied:
```typescript
const shouldUpdateExpense = Boolean(
  matchingRule.set_expense_category &&
    direction === 'out' &&        // <-- runtime direction check
    !expenseLocked && ...
)
```

The runtime check (`direction === 'out'`) provides a second layer of protection even if a rule with an expense set somehow had `direction: 'both'` in the DB (e.g., created before this validation existed, or modified directly in the DB). **PASS — defence in depth is correct.**

### 10.6 `createReceiptRuleFromGroup` does not enforce the expense/direction constraint at its own layer

**Location:** `receipts.ts:2614-2662`

`createReceiptRuleFromGroup` delegates to `createReceiptRule` via `FormData`, which applies the validation. However, if the caller passes `direction: 'both'` and `expenseCategory` is set, the validation in `createReceiptRule` will reject it. The caller (`ReceiptBulkReviewClient`) does not pre-validate this combination client-side before submitting. The server will return an error, which the UI will surface as a toast. This is not a bug but is a UX inconsistency — the UI does not disable the "Include expense" option when direction is not `'out'`. **Minor UX flag.**

### 10.7 `deleteReceiptFile` logs `new_status: 'pending'` before checking if there are remaining files

**Location:** `receipts.ts:1860-1870`
```typescript
await supabase.from('receipt_transaction_logs').insert({
  ...
  new_status: 'pending',   // <-- always 'pending' in the log
  action_type: 'receipt_deleted',
  ...
})
```

The log always says `new_status: 'pending'`, but the actual transaction status is only reset to `pending` if there are no remaining receipt files. If the user had 2 receipts and deleted 1, the log says `new_status: 'pending'` but the transaction stays `completed`. The log is incorrect in the multi-file case.

**Policy drift verdict: FAIL** — audit log `new_status` does not reflect the actual resulting status when multiple receipt files exist.

### 10.8 `markReceiptTransaction` clears `rule_applied_id` on every manual update

**Location:** `receipts.ts:1451`
```typescript
rule_applied_id: null,
```

Every time a user manually marks a status (any status, including moving a rule-auto-completed transaction back to `pending`), the `rule_applied_id` is cleared. This is correct business logic — a manual action supersedes the rule. However, if the user later manually sets it back to `no_receipt_required` (the same status the rule would have set), the `rule_applied_id` is gone — the system loses the link between the transaction and the rule that originally matched it. Not a bug, but a historical traceability gap.

### 10.9 `ReceiptTableRow` uses `receipts/manage` permission, not `receipts/edit`

**Location:** `ReceiptTableRow.tsx:75`
```typescript
const canManageReceipts = hasPermission('receipts', 'manage')
```

The brief specifies module `receipts` with actions `view` and `export`. The code uses `receipts/manage` for all mutations. The `manage` action is not mentioned in the brief's permissions section. This may indicate the brief is incomplete (likely `manage` is the write action), but it is worth confirming that `manage` is the intended RBAC action for receipt mutations.

**Flag:** Brief lists only `view` and `export` as receipts permissions. All mutation actions require `receipts/manage`. The brief may be incomplete regarding permissions.

### 10.10 `requeueUnclassifiedTransactions` uses `batch_id` of the first result for all jobs

**Location:** `receipts.ts:3257`
```typescript
const batchId = rows[0]?.batch_id ?? 'requeue'
```

When re-queuing up to 5,000 transactions (potentially from many different batches), all jobs are tagged with the `batch_id` of the first result. This is used only as a job metadata tag and does not affect transaction processing, but it means the re-queue is attributed to a single batch for logging purposes even if transactions span multiple batches.

**Minor flag:** Not a business rule violation, but the logging attribution is misleading.

---

## Summary of Findings by Severity

### FAIL (must be reviewed)

| # | Finding | Location |
|---|---|---|
| 4.1 | `auto_completed` stat card label is "Auto-matched" instead of "Auto completed" — inconsistent with all other labels | `ReceiptStats.tsx:83` |
| 10.7 | `deleteReceiptFile` always logs `new_status: 'pending'` regardless of whether the transaction actually reverts | `receipts.ts:1862` |

### FLAG (needs policy clarification or is a latent risk)

| # | Finding | Location |
|---|---|---|
| 3 | `completed` → `pending` (Reopen) leaves receipt files attached — status becomes `pending` with files present | `ReceiptTableRow.tsx:453-462` |
| 5 | Re-queue does not cover transactions with vendor set but expense missing | `receipts.ts:3239-3243` |
| 6 | Three separate direction-derivation functions exist; not canonical | `receipts.ts:607`, `ai-classification.ts:19`, `receipts.ts:573` |
| 8 | Fuzzy grouping display vs exact-match apply mismatch in bulk review | `receipts.ts:2474`, `ReceiptBulkReviewClient.tsx` |
| 9.7 | Export `no_receipt_required` label abbreviated to "No receipt req." — inconsistent | `export/route.ts:248` |
| 10.1 | `OUTSTANDING_STATUSES = ['pending']` excludes `cant_find` — policy intent unclear | `receipts.ts:41` |
| 10.9 | Brief lists only `view`/`export` as receipts permissions; code also uses `manage` | `ReceiptTableRow.tsx:75` and many actions |

### PASS

All other stated rules verified as correctly implemented.

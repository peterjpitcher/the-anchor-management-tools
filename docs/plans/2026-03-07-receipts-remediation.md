# Receipts Module Remediation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 25 defects identified in the Phase 1 receipts module audit, grouped into three priority tiers: Critical (A), Structural (B), and Enhancement (C).

**Architecture:** All fixes are within `src/app/actions/receipts.ts`, `src/lib/receipts/ai-classification.ts`, `src/app/api/receipts/export/route.ts`, and the `ReceiptStats.tsx` UI component. No schema changes required. No new dependencies.

**Tech Stack:** Next.js 15 App Router, TypeScript (strict), Supabase (admin client), Vitest for tests.

**Test runner:** `npx vitest run tests/lib/path.test.ts` or `npx vitest run tests/actions/path.test.ts`
**Lint:** `npm run lint`
**Typecheck:** `npx tsc --noEmit`
**Build:** `npm run build`

**Policy decision (DEF-023):** `cant_find` IS included in `OUTSTANDING_STATUSES` — it represents an unresolved state needing follow-up, not a terminal one.

---

## Group A — Critical Fixes

---

### Task A1: Add file size limit to CSV upload schema (DEF-001)

**Files:**
- Modify: `src/app/actions/receipts.ts:369–373`
- Test: `tests/lib/receipts-import.test.ts` (new file)

**Context:** `fileSchema` validates CSV uploads but has no upper bound on file size. `receiptFileSchema` (for receipt attachments) has the 15 MB guard but `fileSchema` does not.

Current code at line 369:
```typescript
const fileSchema = z.instanceof(File, { message: 'Please attach a CSV file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })
```

**Step 1: Write the failing test**

Create `tests/lib/receipts-import.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

// Re-implement the schema for testing — we test the logic, not the import
const MAX_RECEIPT_UPLOAD_SIZE = 15 * 1024 * 1024

// Current schema (missing size limit) — used to verify test fails first
const fileSchemaWithoutLimit = z.instanceof(File)
  .refine((file) => file.size > 0)
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'))

// Target schema (with size limit)
const fileSchemaWithLimit = z.instanceof(File)
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'CSV file is too large. Please keep statements under 15MB.'
  })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })

function makeFile(sizeBytes: number, name = 'statement.csv', type = 'text/csv'): File {
  const content = 'x'.repeat(sizeBytes)
  return new File([content], name, { type })
}

describe('fileSchema size limit', () => {
  it('rejects a CSV file larger than 15 MB', () => {
    const oversizedFile = makeFile(MAX_RECEIPT_UPLOAD_SIZE + 1)
    const result = fileSchemaWithLimit.safeParse(oversizedFile)
    expect(result.success).toBe(false)
    expect(result.error?.issues[0]?.message).toContain('too large')
  })

  it('accepts a CSV file exactly at 15 MB', () => {
    const exactFile = makeFile(MAX_RECEIPT_UPLOAD_SIZE)
    const result = fileSchemaWithLimit.safeParse(exactFile)
    expect(result.success).toBe(true)
  })

  it('accepts a normal small CSV file', () => {
    const smallFile = makeFile(1024)
    const result = fileSchemaWithLimit.safeParse(smallFile)
    expect(result.success).toBe(true)
  })

  it('still rejects empty files', () => {
    const emptyFile = makeFile(0)
    const result = fileSchemaWithLimit.safeParse(emptyFile)
    expect(result.success).toBe(false)
  })

  it('still rejects non-CSV files', () => {
    const exeFile = makeFile(1024, 'malware.exe', 'application/octet-stream')
    const result = fileSchemaWithLimit.safeParse(exeFile)
    expect(result.success).toBe(false)
  })
})
```

**Step 2: Run test to verify it compiles**
```
npx vitest run tests/lib/receipts-import.test.ts
```
Expected: All tests pass (they test the local schema definition, not the production code).

**Step 3: Apply fix to production code**

Edit `src/app/actions/receipts.ts:369–373`. Add the size limit refine between the `size > 0` check and the type check:
```typescript
const fileSchema = z.instanceof(File, { message: 'Please attach a CSV file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'CSV file is too large. Please keep bank statements under 15MB.'
  })
  .refine((file) => file.type === 'text/csv' || file.name.endsWith('.csv'), {
    message: 'Only CSV bank statements are supported'
  })
```

**Step 4: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```
Expected: Zero errors.

**Step 5: Commit**
```bash
git add src/app/actions/receipts.ts tests/lib/receipts-import.test.ts
git commit -m "fix: add 15 MB size limit to CSV upload fileSchema (DEF-001)"
```

---

### Task A2: Fix "Auto-matched" label in ReceiptStats (DEF-005)

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx:82`

**Context:** Line 82 renders `title="Auto-matched"`. Every other component, filter, and export CSV uses "Auto completed". This breaks the stat card → filter workflow.

**Step 1: Apply the fix**

In `ReceiptStats.tsx`, change line 82:
```tsx
// Before:
<SummaryCard title="Auto-matched" value={summary.totals.autoCompleted} tone="info" />

// After:
<SummaryCard title="Auto completed" value={summary.totals.autoCompleted} tone="info" />
```

**Step 2: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx
git commit -m "fix: rename 'Auto-matched' stat card label to 'Auto completed' (DEF-005)"
```

---

### Task A3: Fix `deleteReceiptFile` audit log — always logs `new_status: 'pending'` (DEF-006)

**Files:**
- Modify: `src/app/actions/receipts.ts` — `deleteReceiptFile` function (~line 1800–1920)

**Context:** The audit log insert at line 1860 always writes `new_status: 'pending'`, but the status only actually changes if no remaining receipt files exist. If a transaction has 2 receipts and one is deleted, the log is wrong.

**Fix approach:** Move the log insert to after the remaining-files check, using the actual resulting status.

**Step 1: Locate the full deleteReceiptFile log section**

The current order is:
1. Delete DB record
2. Remove from storage (with rollback on failure)
3. **INSERT log with `new_status: 'pending'`** ← this is wrong
4. Check remaining files
5. If no remaining → update transaction to `pending`

The correct order should be:
1. Delete DB record
2. Remove from storage
3. Check remaining files
4. Determine actual new status (pending if none remain, keep current if some remain)
5. **INSERT log with actual new_status**
6. Update transaction status if needed

**Step 2: Apply the fix**

Find the log insert block (around line 1860) and the remaining-files check (around line 1876). Restructure so the log insert happens AFTER we know whether the transaction status changed.

Replace this section:
```typescript
  const now = new Date().toISOString()

  const { error: deleteLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: receipt.transaction_id,
    previous_status: transaction?.status ?? null,
    new_status: 'pending',
    action_type: 'receipt_deleted',
    note: 'Receipt removed by user',
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  if (deleteLogError) {
    console.error('Failed to record receipt deletion transaction log:', deleteLogError)
  }

  // If there are no receipts left, revert to pending
  const { data: remaining, error: remainingError } = await supabase
    .from('receipt_files')
    .select('id')
    .eq('transaction_id', receipt.transaction_id)

  if (remainingError) {
    console.error('Failed to check for remaining receipts:', remainingError)
    return { error: 'Receipt was removed, but failed to verify remaining receipt files.' }
  }
```

With:
```typescript
  const now = new Date().toISOString()

  // Check remaining files BEFORE writing the log, so we can record the correct new_status
  const { data: remaining, error: remainingError } = await supabase
    .from('receipt_files')
    .select('id')
    .eq('transaction_id', receipt.transaction_id)

  if (remainingError) {
    console.error('Failed to check for remaining receipts:', remainingError)
    // Conservative: reset transaction to pending since we can't confirm files remain
    await supabase
      .from('receipt_transactions')
      .update({ status: 'pending', receipt_required: true, marked_by: null, marked_by_email: null, marked_by_name: null, marked_at: null, marked_method: null, rule_applied_id: null })
      .eq('id', receipt.transaction_id)
    return { error: 'Receipt was removed, but failed to verify remaining receipt files.' }
  }

  const hasRemainingFiles = (remaining?.length ?? 0) > 0
  const actualNewStatus = hasRemainingFiles ? (transaction?.status ?? 'pending') : 'pending'

  const { error: deleteLogError } = await supabase.from('receipt_transaction_logs').insert({
    transaction_id: receipt.transaction_id,
    previous_status: transaction?.status ?? null,
    new_status: actualNewStatus,
    action_type: 'receipt_deleted',
    note: 'Receipt removed by user',
    performed_by: user_id,
    rule_id: null,
    performed_at: now,
  })

  if (deleteLogError) {
    console.error('Failed to record receipt deletion transaction log:', deleteLogError)
  }
```

Then remove the old `remainingError` check block that follows (it's now at the top), and update the `if (!remaining?.length)` block to use `if (!hasRemainingFiles)`.

**Step 3: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: deleteReceiptFile logs correct new_status based on remaining files (DEF-006)"
```

---

### Task A4: Fix `deleteReceiptFile` — conservative reset on remaining-files query failure (DEF-004)

**Context:** This is handled as part of Task A3. When `remainingError` occurs, the conservative status reset to `pending` is now included in the restructured code above. No separate task needed — verify it's in the A3 code.

**Step 1: Verify the remainingError path in the A3 code includes the conservative reset**

Confirm the `if (remainingError)` block now:
- Resets transaction to `pending`
- Returns the error message

**Step 2: Commit note**
This fix is included in the A3 commit. Reference DEF-004 in the commit message:

```bash
# Amend A3 commit to reference both:
# "fix: deleteReceiptFile logs correct new_status + conservatively resets on query failure (DEF-004, DEF-006)"
```

Or if already committed, add a follow-up commit verifying the conservative reset is present.

---

### Task A5: Wrap `applyAutomationRules` in try/catch inside import (DEF-003)

**Files:**
- Modify: `src/app/actions/receipts.ts:1337–1338`

**Context:** Line 1337 calls `applyAutomationRules(insertedIds)` with no try/catch. The AI enqueue call directly below (line 1343) IS wrapped. If automation throws, the action returns 500 even though the batch + transactions were already committed. Staff believe the import failed and may retry.

**Step 1: Apply the fix**

Replace lines 1337–1338:
```typescript
const { statusAutoUpdated: autoApplied, classificationUpdated: autoClassified } =
  await applyAutomationRules(insertedIds)
```

With:
```typescript
let autoApplied = 0
let autoClassified = 0
try {
  const automationResult = await applyAutomationRules(insertedIds)
  autoApplied = automationResult.statusAutoUpdated
  autoClassified = automationResult.classificationUpdated
} catch (automationError) {
  console.error('Failed to apply automation rules after import — import data committed, retro-run can recover:', automationError)
}
```

**Step 2: Confirm the variables are no longer declared before the try block**

The original code declared `autoApplied` and `autoClassified` as destructured from the `await` result. The new code declares them with `let` before the try block. Ensure they are not declared again downstream.

**Step 3: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```
Expected: Zero errors.

**Step 4: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: wrap applyAutomationRules in try/catch inside importReceiptStatement (DEF-003)"
```

---

### Task A6: Compensating delete for orphaned batch record on transaction insert failure (DEF-002)

**Files:**
- Modify: `src/app/actions/receipts.ts:1330–1333`

**Context:** When the transaction upsert fails (line 1330), the code returns an error but the `receipt_batches` record created at line 1282 remains with `row_count > 0` and no associated transactions. Staff see a ghost "last import".

**Step 1: Apply the fix**

Replace lines 1330–1333:
```typescript
  if (insertError) {
    console.error('Failed to insert receipt transactions:', insertError)
    return { error: 'Failed to store the transactions.' }
  }
```

With:
```typescript
  if (insertError) {
    console.error('Failed to insert receipt transactions:', insertError)
    // Compensating delete: remove the orphaned batch record so it doesn't appear as a ghost import
    const { error: batchCleanupError } = await supabase
      .from('receipt_batches')
      .delete()
      .eq('id', batch.id)
    if (batchCleanupError) {
      console.error('Failed to cleanup orphaned batch record after transaction insert failure:', batchCleanupError)
    }
    return { error: 'Failed to store the transactions.' }
  }
```

**Step 2: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: delete orphaned batch record when transaction upsert fails (DEF-002)"
```

---

## Group B — Structural Fixes

---

### Task B1: Surface AI enqueue failure in import response (DEF-008)

**Files:**
- Modify: `src/app/actions/receipts.ts:1343–1349` and `1389–1396`

**Context:** The try/catch around `enqueueReceiptAiClassificationJobs` swallows the error completely. The import returns `{ success: true }` with no indication that AI classification won't happen. Transactions silently remain unclassified.

**Step 1: Apply the fix**

Modify the catch block at line 1347:
```typescript
// Before:
  } catch (error) {
    console.error('Failed to enqueue receipt AI classification jobs', error)
  }

// After:
  } catch (error) {
    console.error('Failed to enqueue receipt AI classification jobs', error)
    aiJobsFailed = insertedIds.length // All IDs failed to enqueue
  }
```

Then modify the return value at line 1389 to include a `warning` field when `aiJobsFailed > 0` and `aiJobsQueued === 0`:
```typescript
  return {
    success: true,
    inserted: insertedIds.length,
    skipped: rows.length - insertedIds.length,
    autoApplied,
    autoClassified,
    batch,
    ...(aiJobsQueued === 0 && aiJobsFailed > 0 && {
      warning: 'AI classification could not be queued. Use the "Re-queue" button on the receipts page to retry.',
    }),
  }
```

**Step 2: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: surface AI enqueue failure as warning in import response (DEF-008)"
```

---

### Task B2: Move `recordAIUsage` to after the per-transaction update loop (DEF-009)

**Files:**
- Modify: `src/lib/receipts/ai-classification.ts:231` (move to after the for loop at ~line 311)

**Context:** `recordAIUsage` is called at line 231, BEFORE the `for (const transaction of toClassify)` loop. If the process crashes mid-loop, usage is recorded but classifications aren't saved. On retry, OpenAI is called again and usage is recorded twice.

**Step 1: Write the test first**

Add to `tests/lib/receipt-ai-classification.test.ts`:
```typescript
describe('recordAIUsage ordering', () => {
  it('does not record usage if all transaction updates fail', async () => {
    mockedGetOpenAIConfig.mockResolvedValue({ apiKey: 'test-key' })
    mockedClassifyBatch.mockResolvedValue({
      results: [{ id: 'tx-1', vendorName: 'ACME', expenseCategory: null, reasoning: null, confidence: 90, suggestedRuleKeywords: null }],
      usage: { model: 'gpt-4o-mini', promptTokens: 100, completionTokens: 50, totalTokens: 150, cost: 0.001 },
    })

    const aiUsageInserts: unknown[] = []
    const supabase = {
      from: vi.fn((table: string) => {
        if (table === 'receipt_transactions') {
          return {
            select: vi.fn().mockReturnValue({
              in: vi.fn().mockResolvedValue({
                data: [{ id: 'tx-1', details: 'ACME LTD', amount_in: null, amount_out: 50, vendor_name: null, vendor_source: null, expense_category: null, expense_category_source: null, status: 'pending', ai_confidence: null, ai_suggested_keywords: null, transaction_type: null, vendor_rule_id: null, expense_rule_id: null }],
                error: null,
              }),
            }),
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('DB failure') }),
                }),
              }),
            }),
          }
        }
        if (table === 'receipt_transaction_logs') {
          return { insert: vi.fn().mockResolvedValue({ error: null }), select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue({ limit: vi.fn().mockResolvedValue({ data: [], error: null }) }) }) }) }
        }
        if (table === 'ai_usage_events') {
          return { insert: vi.fn((rows: unknown) => { aiUsageInserts.push(rows); return Promise.resolve({ error: null }) }) }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    await classifyReceiptTransactionsWithAI(supabase as any, ['tx-1'])

    // Usage should NOT be recorded if updates all failed
    // (This test will initially fail because usage is recorded before the loop)
    expect(aiUsageInserts).toHaveLength(0)
  })
})
```

**Step 2: Run test to verify it fails**
```
npx vitest run tests/lib/receipt-ai-classification.test.ts
```
Expected: The new test FAILS (usage is currently recorded before the loop).

**Step 3: Apply the fix**

In `src/lib/receipts/ai-classification.ts`, move the `recordAIUsage` call from line 231 (before the loop) to after the loop (after line 311 where `logs.length` check is).

Current structure:
```typescript
  // Record usage once for the entire batch
  await recordAIUsage(supabase, batchOutcome.usage, `receipt_classification_batch:${toClassify.length}`)

  for (const transaction of toClassify) {
    // ... update each transaction, push to logs array ...
  }

  if (logs.length) {
    await client.from('receipt_transaction_logs').insert(logs)
  }
```

New structure:
```typescript
  let successfullyUpdated = 0

  for (const transaction of toClassify) {
    // ... same loop body ...
    // At the point where we currently push to logs, also increment successfullyUpdated
    if (changeNotes.length) {
      logs.push({ ... })
      successfullyUpdated++
    }
  }

  // Record usage AFTER the loop — only if at least one transaction was successfully updated
  // This prevents double-billing on retried jobs where the process crashed mid-loop
  if (successfullyUpdated > 0) {
    await recordAIUsage(supabase, batchOutcome.usage, `receipt_classification_batch:${toClassify.length}`)
  }

  if (logs.length) {
    await client.from('receipt_transaction_logs').insert(logs)
  }
```

**Step 4: Run tests to verify they pass**
```
npx vitest run tests/lib/receipt-ai-classification.test.ts
```
Expected: All tests pass including the new one.

**Step 5: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 6: Commit**
```bash
git add src/lib/receipts/ai-classification.ts tests/lib/receipt-ai-classification.test.ts
git commit -m "fix: move recordAIUsage to after update loop to prevent double-billing on retry (DEF-009)"
```

---

### Task B3: Per-transaction AI failure — add `ai_classification_failed` log (DEF-014)

**Files:**
- Modify: `src/lib/receipts/ai-classification.ts:242–244` and `287–294`

**Context:** Two `continue` paths emit no log entry:
1. `if (!classificationResult) { continue }` — transaction absent from OpenAI response map
2. `if (updateError) { console.error(...); continue }` — DB update fails for a specific transaction

Both silently skip transactions with no audit trail.

**Step 1: Apply the fix**

**Gap 1** — missing result from batch (line 242–244):
```typescript
// Before:
    if (!classificationResult) {
      continue
    }

// After:
    if (!classificationResult) {
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: transaction.status,
        action_type: 'ai_classification_failed',
        note: 'Transaction absent from AI batch response',
        performed_by: null,
        rule_id: null,
        performed_at: now,
      })
      continue
    }
```

**Gap 2** — DB update failure (line 287–294):
```typescript
// Before:
    if (updateError) {
      console.error('Failed to persist AI classification', updateError)
      continue
    }

// After:
    if (updateError) {
      console.error('Failed to persist AI classification', updateError)
      logs.push({
        transaction_id: transaction.id,
        previous_status: transaction.status,
        new_status: transaction.status,
        action_type: 'ai_classification_failed',
        note: 'Failed to save AI classification result to database',
        performed_by: null,
        rule_id: null,
        performed_at: now,
      })
      continue
    }
```

**Step 2: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/lib/receipts/ai-classification.ts
git commit -m "fix: log ai_classification_failed for per-transaction failures in AI batch (DEF-014)"
```

---

### Task B4: Surface failed classification jobs in workspace summary (DEF-010)

**Files:**
- Modify: `src/app/actions/receipts.ts` — `getReceiptWorkspaceSummary` function
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx`
- Modify: `src/app/actions/receipts.ts` — `ReceiptWorkspaceSummary` type

**Context:** After 3 retry attempts, classification jobs are marked `failed` in the `jobs` table. There is no UI indicator. Staff cannot see that transactions are permanently unclassified.

**Step 1: Add `failedAiJobs` to the summary type**

In `receipts.ts`, find `ReceiptWorkspaceSummary` type (~line 128):
```typescript
export type ReceiptWorkspaceSummary = {
  totals: { ... }
  needsAttentionValue: number
  lastImport?: ReceiptBatch | null
  openAICost: number
  aiUsageBreakdown?: AIUsageBreakdown | null
  failedAiJobs: number  // ADD THIS
}
```

**Step 2: Query failed jobs in `getReceiptWorkspaceSummary`**

Find the function `getReceiptWorkspaceSummary` (or wherever the summary is assembled). Add a query for failed classification jobs:

```typescript
const { count: failedAiJobCount } = await supabase
  .from('jobs')
  .select('id', { count: 'exact', head: true })
  .eq('type', 'classify_receipt_transactions')
  .eq('status', 'failed')

// Include in returned summary:
failedAiJobs: failedAiJobCount ?? 0,
```

**Step 3: Display in ReceiptStats**

In `ReceiptStats.tsx`, add a warning banner when `failedAiJobs > 0`:
```tsx
export function ReceiptStats({ summary }: ReceiptStatsProps) {
  return (
    <div className="space-y-4">
      {summary.failedAiJobs > 0 && (
        <div className="rounded-md bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <strong>{summary.failedAiJobs} AI classification {summary.failedAiJobs === 1 ? 'job has' : 'jobs have'} permanently failed</strong> after 3 retries.
          Use the <strong>Re-queue</strong> button to retry unclassified transactions.
        </div>
      )}
      <div className="hidden md:grid md:grid-cols-2 md:gap-4 xl:grid-cols-6">
        ...
      </div>
    </div>
  )
}
```

**Step 4: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 5: Commit**
```bash
git add src/app/actions/receipts.ts src/app/(authenticated)/receipts/_components/ui/ReceiptStats.tsx
git commit -m "fix: surface failed AI classification jobs as warning in receipts workspace (DEF-010)"
```

---

### Task B5: CSV export formula injection escaping (DEF-011)

**Files:**
- Modify: `src/app/api/receipts/export/route.ts`

**Context:** `buildSummaryCsv` passes raw transaction `details`, `vendor_name`, and `notes` to `Papa.unparse` without escaping. Values starting with `=`, `+`, `-`, `@` are treated as formulas by Excel/LibreOffice.

**Step 1: Write the test**

Create `tests/api/receipts-export.test.ts`:
```typescript
import { describe, expect, it } from 'vitest'

// The escape function to implement
function escapeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `\t${value}`
  }
  return value
}

describe('escapeCsvCell', () => {
  it('prefixes formula-starting cells with a tab', () => {
    expect(escapeCsvCell('=SUM(A1:A10)')).toBe('\t=SUM(A1:A10)')
    expect(escapeCsvCell('+44 7700 900000')).toBe('\t+44 7700 900000')
    expect(escapeCsvCell('-50.00')).toBe('\t-50.00')
    expect(escapeCsvCell('@CMD')).toBe('\t@CMD')
  })

  it('does not modify safe strings', () => {
    expect(escapeCsvCell('PAYPAL PAYMENT')).toBe('PAYPAL PAYMENT')
    expect(escapeCsvCell('Tesco Stores Ltd')).toBe('Tesco Stores Ltd')
    expect(escapeCsvCell('')).toBe('')
  })

  it('does not modify strings that start with numbers', () => {
    expect(escapeCsvCell('1234 High Street')).toBe('1234 High Street')
  })
})
```

**Step 2: Run test to verify it fails**
```
npx vitest run tests/api/receipts-export.test.ts
```
Expected: FAIL — function not yet in production code.

**Step 3: Add helper and apply to export**

In `src/app/api/receipts/export/route.ts`, add after the imports section:
```typescript
/** Prevent CSV formula injection when opened in Excel/LibreOffice. */
function escapeCsvCell(value: string): string {
  if (/^[=+\-@]/.test(value)) {
    return `\t${value}`
  }
  return value
}
```

Then in `buildSummaryCsv`, wrap free-text columns in the `dataRows` mapping:
```typescript
  const dataRows = transactions.map((tx) => {
    const amountIn = typeof tx.amount_in === 'number' ? tx.amount_in.toFixed(2) : ''
    const amountOut = typeof tx.amount_out === 'number' ? tx.amount_out.toFixed(2) : ''
    const notes = sanitiseMultiline(tx.notes)

    return [
      formatDate(tx.transaction_date),
      escapeCsvCell(tx.details ?? ''),          // was: tx.details ?? ''
      escapeCsvCell(tx.transaction_type ?? ''), // was: tx.transaction_type ?? ''
      escapeCsvCell(tx.vendor_name ?? ''),      // was: tx.vendor_name ?? ''
      friendlySource(tx.vendor_source),
      tx.expense_category ?? '',
      friendlySource(tx.expense_category_source),
      tx.ai_confidence != null ? String(tx.ai_confidence) : '',
      amountIn,
      amountOut,
      friendlyStatus(tx.status),
      escapeCsvCell(notes),                     // was: notes
    ]
  })
```

**Step 4: Run tests**
```
npx vitest run tests/api/receipts-export.test.ts
```
Expected: All pass.

**Step 5: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 6: Commit**
```bash
git add src/app/api/receipts/export/route.ts tests/api/receipts-export.test.ts
git commit -m "fix: escape CSV formula injection characters in export (DEF-011)"
```

---

### Task B6: Fix bulk apply partial mutation — merge vendor+expense update (DEF-007)

**Files:**
- Modify: `src/app/actions/receipts.ts:2503–2551`

**Context:** Vendor and expense are updated in two separate DB calls. If vendor succeeds and expense fails, vendor is permanently committed. The user sees an error but half the data is changed.

**Fix approach:** When both vendor and expense need updating, merge them into a single update payload applied to the appropriate row sets. Since expense applies to a different set (non-incoming only), we handle the merge by doing a combined update for rows that need both, then a vendor-only update for incoming-only rows.

**Step 1: Apply the fix**

Replace the existing vendor+expense two-call pattern with a merged approach:

```typescript
  // Build separate update payloads
  const vendorPayload: Record<string, unknown> = vendorProvided ? {
    updated_at: now,
    vendor_name: normalizedVendor,
    vendor_source: normalizedVendor ? 'manual' : null,
    vendor_rule_id: null,
    vendor_updated_at: now,
  } : {}

  const expensePayload: Record<string, unknown> = expenseProvided ? {
    updated_at: now,
    expense_category: normalizedExpense ?? null,
    expense_category_source: normalizedExpense ? 'manual' : null,
    expense_rule_id: null,
    expense_updated_at: now,
  } : {}

  const expenseEligibleIds = matchRows
    .filter((row) => !incomingOnlyIds.has(row.id))
    .map((row) => row.id)

  const incomingOnlyIdList = matchRows
    .filter((row) => incomingOnlyIds.has(row.id))
    .map((row) => row.id)

  // For expense-eligible rows: apply vendor + expense together in one call
  if (expenseEligibleIds.length > 0 && (vendorProvided || expenseProvided)) {
    const combinedPayload = { ...vendorPayload, ...expensePayload }
    const { error: combinedUpdateError } = await supabase
      .from('receipt_transactions')
      .update(combinedPayload)
      .in('id', expenseEligibleIds)

    if (combinedUpdateError) {
      console.error('Failed to apply bulk classification to expense-eligible transactions', combinedUpdateError)
      return { error: 'Failed to apply changes' }
    }
    expenseEligibleIds.forEach((id) => updatedIdSet.add(id))
  }

  // For incoming-only rows: apply vendor only (expense does not apply)
  if (incomingOnlyIdList.length > 0 && vendorProvided) {
    const { error: vendorOnlyError } = await supabase
      .from('receipt_transactions')
      .update(vendorPayload)
      .in('id', incomingOnlyIdList)

    if (vendorOnlyError) {
      console.error('Failed to apply vendor to incoming-only transactions', vendorOnlyError)
      return { error: 'Failed to apply changes' }
    }
    incomingOnlyIdList.forEach((id) => updatedIdSet.add(id))
  }
```

Remove the old `if (vendorProvided)` and `if (expenseProvided)` blocks.

**Step 2: Verify `skippedIncomingCount` still works correctly**

`skippedIncomingCount` is used for the summary note. After the refactor, it should reflect `incomingOnlyIdList.length` when expense was intended.

**Step 3: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: merge vendor+expense into single DB call in bulk apply to prevent partial mutation (DEF-007)"
```

---

### Task B7: Retro-run time budget — call finalize/revalidate on partial exit (DEF-013)

**Files:**
- Modify: `src/app/actions/receipts.ts:2808–2831`

**Context:** When the 12-second time budget is exhausted, `runReceiptRuleRetroactively` returns early without calling `finalizeReceiptRuleRetroRun`. This skips `revalidatePath` calls and the audit log. The workspace UI shows stale data.

**Step 1: Locate `finalizeReceiptRuleRetroRun`**

Find the function definition to understand what it does (it writes audit log and calls `revalidatePath`).

**Step 2: Apply the fix**

In the time-budget return block (line 2808–2831), call the finalize function with a `partial: true` indicator before returning:

```typescript
    if (Date.now() - start > timeBudgetMs) {
      console.warn('[retro] time budget exceeded, returning partial result', { ruleId, scope, offset, totals, totalRecords })
      // Still finalize so cache is revalidated and audit log is written for partial run
      await finalizeReceiptRuleRetroRun(ruleId, {
        ...totals,
        samples,
        scope,
        partial: true,
        processedCount: offset,
      })
      return {
        success: true,
        ruleId,
        // ... same fields as before ...
        done: false,
        nextOffset: offset,
        total: totalRecords,
      }
    }
```

If `finalizeReceiptRuleRetroRun` doesn't accept a `partial` parameter, either add it to the function signature or inline the `revalidatePath` calls and a partial audit log write directly in the time-budget branch.

**Step 3: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 4: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: call finalize on retro-run time budget exit to revalidate cache and write audit log (DEF-013)"
```

---

### Task B8: Orphaned storage file — write audit record on double-failure (DEF-012)

**Files:**
- Modify: `src/app/actions/receipts.ts:1851–1853`

**Context:** If DB record delete succeeds, storage remove fails, AND the rollback re-insert also fails, the storage file is orphaned with no trace. Currently only a `console.error` is emitted.

**Step 1: Apply the fix**

In the double-failure path (after the rollback `if (rollbackError)` block):
```typescript
    if (rollbackError) {
      console.error('Failed to rollback receipt file record after storage delete failure:', rollbackError)
      // Write an audit record so operators can track down the orphaned storage file
      await logAuditEvent({
        operation_type: 'storage_cleanup_required',
        resource_type: 'receipt_file',
        resource_id: fileId,
        operation_status: 'failure',
        additional_info: {
          storage_path: receipt.storage_path,
          transaction_id: receipt.transaction_id,
          reason: 'DB delete succeeded, storage remove failed, DB rollback also failed — storage file is orphaned',
        },
      })
    }
```

**Step 2: Lint and typecheck**
```
npm run lint && npx tsc --noEmit
```

**Step 3: Commit**
```bash
git add src/app/actions/receipts.ts
git commit -m "fix: write audit event for orphaned storage file on double rollback failure (DEF-012)"
```

---

## Group C — Enhancements

---

### Task C1: Reject negative amounts in CSV parse (DEF-015)

**Files:**
- Modify: `src/app/actions/receipts.ts:514–520` (`parseCurrency`)

**Step 1: Add test to receipts-import.test.ts**

```typescript
describe('parseCurrency', () => {
  // parseCurrency is not exported — test it via the CSV parse behaviour.
  // For direct unit test, we copy the logic inline:
  function parseCurrency(value: string | null | undefined): number | null {
    if (!value) return null
    const cleaned = value.replace(/,/g, '').trim()
    if (!cleaned) return null
    const result = Number.parseFloat(cleaned)
    if (!Number.isFinite(result)) return null
    if (result < 0) return null  // ← new guard
    return Number(result.toFixed(2))
  }

  it('rejects negative values', () => {
    expect(parseCurrency('-50.00')).toBeNull()
    expect(parseCurrency('-0.01')).toBeNull()
  })

  it('accepts positive values', () => {
    expect(parseCurrency('50.00')).toBe(50)
    expect(parseCurrency('1,234.56')).toBe(1234.56)
  })

  it('returns null for empty or invalid', () => {
    expect(parseCurrency('')).toBeNull()
    expect(parseCurrency('abc')).toBeNull()
    expect(parseCurrency(null)).toBeNull()
  })
})
```

**Step 2: Apply the fix in `receipts.ts:514–520`**

```typescript
function parseCurrency(value: string | null | undefined): number | null {
  if (!value) return null
  const cleaned = value.replace(/,/g, '').trim()
  if (!cleaned) return null
  const result = Number.parseFloat(cleaned)
  if (!Number.isFinite(result)) return null
  if (result < 0) return null  // Bank CSVs should not have negative In/Out values
  return Number(result.toFixed(2))
}
```

**Step 3: Run tests, lint, typecheck, commit**
```bash
npx vitest run tests/lib/receipts-import.test.ts
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts tests/lib/receipts-import.test.ts
git commit -m "fix: reject negative amounts in CSV parseCurrency (DEF-015)"
```

---

### Task C2: Document matchDescription OR semantics in UI (DEF-016)

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx` — `MatchDescriptionTokenPreview` component

**Step 1: Find `MatchDescriptionTokenPreview`**

Read the component and find where keyword chips are rendered.

**Step 2: Add tooltip or label**

Add a small label or tooltip near the token chips explaining OR semantics:
```tsx
// After the chips row, add a helper text line:
<p className="text-xs text-gray-400 mt-1">
  Matches if <em>any</em> of these words appear in the transaction description.
</p>
```

Or, if chips are inline, wrap in a group with the label.

**Step 3: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx
git commit -m "fix: label matchDescription keywords as OR logic in rule UI (DEF-016)"
```

---

### Task C3: File type allowlist for receipt attachments (DEF-017)

**Files:**
- Modify: `src/app/actions/receipts.ts:375–380` (`receiptFileSchema`)

**Step 1: Apply the fix**

```typescript
const ALLOWED_RECEIPT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/heic',
  'image/heif',
  'application/pdf',
])

const ALLOWED_RECEIPT_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|heic|heif|pdf)$/i

const receiptFileSchema = z.instanceof(File, { message: 'Please choose a receipt file' })
  .refine((file) => file.size > 0, { message: 'File is empty' })
  .refine((file) => file.size <= MAX_RECEIPT_UPLOAD_SIZE, {
    message: 'File is too large. Please keep receipts under 15MB.'
  })
  .refine(
    (file) => ALLOWED_RECEIPT_MIME_TYPES.has(file.type) || ALLOWED_RECEIPT_EXTENSIONS.test(file.name),
    { message: 'Only image files (JPG, PNG, GIF, WEBP, HEIC) and PDFs are accepted as receipts.' }
  )
```

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts
git commit -m "fix: add MIME type allowlist to receiptFileSchema (DEF-017)"
```

---

### Task C4: Rule preview — order by most recent (DEF-018)

**Files:**
- Modify: `src/app/actions/receipts.ts` — `previewReceiptRule` function (~line 3307)

**Step 1: Apply the fix**

Find the query in `previewReceiptRule` that uses `.limit(2000)`. Add `.order('transaction_date', { ascending: false })` before `.limit(2000)`:

```typescript
// Before:
  .limit(2000)

// After:
  .order('transaction_date', { ascending: false })
  .limit(2000)
```

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts
git commit -m "fix: order rule preview sample by most-recent transaction date (DEF-018)"
```

---

### Task C5: Fuzzy grouping — show exact match count before applying (DEF-019)

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx`

**Context:** When fuzzy grouping is active, the card shows N fuzzy-grouped transactions, but Apply only updates those matching the exact `details` string. The user may apply to fewer transactions than they expect.

**Step 1: Read `ReceiptBulkReviewClient.tsx`**

Understand where the group card renders the transaction count.

**Step 2: Apply the fix**

When fuzzy mode is active and a group's `transactionCount` differs from a group's exact-match count, display a note:
```tsx
{isFuzzyMode && group.transactionCount !== group.needsVendorCount && (
  <p className="text-xs text-amber-600">
    Applying will update transactions with exactly this description.
    Other similar transactions in this group will not be updated.
  </p>
)}
```

Or more precisely, pass the `exactMatchCount` from the server and display a note when it differs from `transactionCount`. If this requires a backend change, a simpler approach is to add a static note in the fuzzy mode UI:

```tsx
{fuzzy && (
  <p className="text-xs text-gray-400 mt-1">
    Fuzzy mode groups similar descriptions together. "Apply" updates only exact matches.
  </p>
)}
```

**Step 3: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/(authenticated)/receipts/_components/ReceiptBulkReviewClient.tsx
git commit -m "fix: add fuzzy mode note explaining exact-match apply scope (DEF-019)"
```

---

### Task C6: Canonical direction function (DEF-020)

**Files:**
- Create: `src/lib/receipts/direction.ts`
- Modify: `src/app/actions/receipts.ts` — remove local `getTransactionDirection`
- Modify: `src/lib/receipts/ai-classification.ts` — remove local `getTransactionDirection`

**Step 1: Create canonical module**

`src/lib/receipts/direction.ts`:
```typescript
/**
 * Derives transaction direction from amount fields.
 * Uses amount_out as primary signal: if amount_out > 0 and >= amount_in, it's outgoing.
 * Falls back to amount_in presence for incoming.
 */
export function getTransactionDirection(tx: {
  amount_in: number | null
  amount_out: number | null
}): 'in' | 'out' {
  const outValue = tx.amount_out ?? 0
  const inValue = tx.amount_in ?? 0
  if (outValue > 0 && outValue >= inValue) return 'out'
  if (inValue > 0) return 'in'
  return outValue > inValue ? 'out' : 'in'
}
```

**Step 2: Update imports**

In `receipts.ts`: remove the local `getTransactionDirection` function and add:
```typescript
import { getTransactionDirection } from '@/lib/receipts/direction'
```

In `ai-classification.ts`: remove the local `getTransactionDirection` and add:
```typescript
import { getTransactionDirection } from '@/lib/receipts/direction'
```

Also remove `deriveDirection` from `receipts.ts` and replace its usages with `getTransactionDirection`.

**Step 3: Add test**

In `tests/lib/receipts-import.test.ts`:
```typescript
import { getTransactionDirection } from '@/lib/receipts/direction'

describe('getTransactionDirection', () => {
  it('returns out when amount_out > 0 and >= amount_in', () => {
    expect(getTransactionDirection({ amount_in: null, amount_out: 50 })).toBe('out')
    expect(getTransactionDirection({ amount_in: 10, amount_out: 50 })).toBe('out')
  })

  it('returns in when amount_in > 0 and amount_out is zero', () => {
    expect(getTransactionDirection({ amount_in: 100, amount_out: null })).toBe('in')
    expect(getTransactionDirection({ amount_in: 100, amount_out: 0 })).toBe('in')
  })

  it('returns out when both are null', () => {
    expect(getTransactionDirection({ amount_in: null, amount_out: null })).toBe('out')
  })
})
```

**Step 4: Run tests, lint, typecheck, commit**
```bash
npx vitest run tests/lib/receipts-import.test.ts
npm run lint && npx tsc --noEmit
git add src/lib/receipts/direction.ts src/app/actions/receipts.ts src/lib/receipts/ai-classification.ts tests/lib/receipts-import.test.ts
git commit -m "refactor: extract canonical getTransactionDirection to src/lib/receipts/direction.ts (DEF-020)"
```

---

### Task C7: Re-queue also covers vendor-set, expense-missing transactions (DEF-021)

**Files:**
- Modify: `src/app/actions/receipts.ts` — `requeueUnclassifiedTransactions` (~line 3235)

**Step 1: Apply the fix**

After the existing query (vendor_name IS NULL AND vendor_source IS NULL), add a second query for expense-missing outgoing transactions:

```typescript
  // Also re-queue outgoing transactions that have a vendor but are missing an expense category
  const { data: expenseMissingRows, error: expenseMissingError } = await supabase
    .from('receipt_transactions')
    .select('id, batch_id')
    .is('expense_category', null)
    .is('expense_category_source', null)
    .not('amount_out', 'is', null)
    .gt('amount_out', 0)
    .not('vendor_source', 'in', '("manual","rule")') // don't re-queue if vendor is locked
    .limit(5000)

  if (!expenseMissingError && expenseMissingRows?.length) {
    // Merge IDs (deduplicate)
    const allIds = [...new Set([...(rows ?? []).map(r => r.id), ...expenseMissingRows.map(r => r.id)])]
    // ... use allIds for enqueue instead of rows
  }
```

Note: The exact implementation depends on the existing code structure. The key is to identify the two row sets, deduplicate, and enqueue all of them.

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts
git commit -m "fix: re-queue also targets vendor-set, expense-missing outgoing transactions (DEF-021)"
```

---

### Task C8: Fix unchecked log insert results — systematic sweep (DEF-022)

**Files:**
- Modify: `src/app/actions/receipts.ts` — 4 locations
- Modify: `src/lib/receipts/ai-classification.ts` — 1 location

**Step 1: Find all unchecked insert calls**

Search for `receipt_transaction_logs').insert` in both files. For each, ensure the result is captured:

```typescript
// Before (typical pattern):
await supabase.from('receipt_transaction_logs').insert(logs)

// After:
const { error: logError } = await supabase.from('receipt_transaction_logs').insert(logs)
if (logError) {
  console.error('Failed to insert transaction logs:', logError)
}
```

**Locations to fix:**
1. `receipts.ts:1363` — import log insert
2. `receipts.ts:951` — rule application log insert
3. `receipts.ts:1470` — markReceiptTransaction log insert
4. `receipts.ts:2580` — bulk classification log insert
5. `ai-classification.ts:313` — AI classification log insert

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts src/lib/receipts/ai-classification.ts
git commit -m "fix: check and log errors from receipt_transaction_logs insert calls (DEF-022)"
```

---

### Task C9: OUTSTANDING_STATUSES — add `cant_find` and document intent (DEF-023)

**Files:**
- Modify: `src/app/actions/receipts.ts:41`

**Step 1: Apply the fix**

```typescript
// Before:
const OUTSTANDING_STATUSES: ReceiptTransaction['status'][] = ['pending']

// After:
// 'cant_find' is included because it represents an unresolved state requiring follow-up,
// not a terminal state. Staff need to locate or re-confirm the receipt.
const OUTSTANDING_STATUSES: ReceiptTransaction['status'][] = ['pending', 'cant_find']
```

Also update `needsAttentionValue` in the workspace summary if it is calculated separately (find the reference and ensure it also counts `cant_find`).

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/actions/receipts.ts
git commit -m "fix: include cant_find in OUTSTANDING_STATUSES (DEF-023)"
```

---

### Task C10: Fix export label abbreviation (DEF-024)

**Files:**
- Modify: `src/app/api/receipts/export/route.ts:247`

**Step 1: Apply the fix**

```typescript
// Before:
    case 'no_receipt_required':
      return 'No receipt req.'

// After:
    case 'no_receipt_required':
      return 'No receipt required'
```

**Step 2: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/api/receipts/export/route.ts
git commit -m "fix: use full label 'No receipt required' in export (DEF-024)"
```

---

### Task C11: Signed URL expiry — add UI note (DEF-025)

**Files:**
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx` or wherever receipt file links are rendered

**Step 1: Find where signed URLs are displayed**

Read `ReceiptTableRow.tsx` and find the receipt file link rendering.

**Step 2: Add a small helper note**

Near the receipt file link(s):
```tsx
<p className="text-xs text-gray-400 mt-1">
  Links are valid for 5 minutes. Refresh the page if a link stops working.
</p>
```

Or add it as a tooltip on the file link icon.

**Step 3: Lint, typecheck, commit**
```bash
npm run lint && npx tsc --noEmit
git add src/app/(authenticated)/receipts/_components/ui/ReceiptTableRow.tsx
git commit -m "fix: note signed URL 5-minute expiry near receipt file links (DEF-025)"
```

---

## Final Verification

After all tasks are complete:

**Step 1: Run full test suite**
```
npm test
```
Expected: All tests pass.

**Step 2: Lint**
```
npm run lint
```
Expected: Zero warnings.

**Step 3: Typecheck**
```
npx tsc --noEmit
```
Expected: Zero errors.

**Step 4: Build**
```
npm run build
```
Expected: Successful production build.

**Step 5: Smoke check UI**
- Open receipts workspace — verify "Auto completed" label on stat card
- Upload a small CSV — verify success with no errors
- Verify export downloads without formula-injection characters
- Verify bulk review fuzzy mode shows OR semantics note

---

## Defect → Task Cross-Reference

| Defect | Task | Group |
|--------|------|-------|
| DEF-001 | A1 | Critical |
| DEF-002 | A6 | Critical |
| DEF-003 | A5 | Critical |
| DEF-004 | A3 (part of) | Critical |
| DEF-005 | A2 | Critical |
| DEF-006 | A3 | Critical |
| DEF-007 | B6 | Structural |
| DEF-008 | B1 | Structural |
| DEF-009 | B2 | Structural |
| DEF-010 | B4 | Structural |
| DEF-011 | B5 | Structural |
| DEF-012 | B8 | Structural |
| DEF-013 | B7 | Structural |
| DEF-014 | B3 | Structural |
| DEF-015 | C1 | Enhancement |
| DEF-016 | C2 | Enhancement |
| DEF-017 | C3 | Enhancement |
| DEF-018 | C4 | Enhancement |
| DEF-019 | C5 | Enhancement |
| DEF-020 | C6 | Enhancement |
| DEF-021 | C7 | Enhancement |
| DEF-022 | C8 | Enhancement |
| DEF-023 | C9 | Enhancement |
| DEF-024 | C10 | Enhancement |
| DEF-025 | C11 | Enhancement |

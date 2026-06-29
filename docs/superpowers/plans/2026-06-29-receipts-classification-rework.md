# Receipts classification rework — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make automation rules the source-agnostic source of truth, turn AI into a *guarded* rule-suggestion author (never a silent value-applier), and simplify the rule corpus — so `/receipts` classifies bank and Amex consistently, deterministically, and cheaply.

**Architecture:** (1) Loosen the matcher so a typeless (Amex) transaction isn't blocked by a `match_transaction_type` requirement, except for type-only rules. (2) Repurpose the AI job to create grouped, deduped, confidence-gated rule *suggestions* (with impact preview) instead of writing values onto rows; rows stay `pending`. (3) Make approval atomic (Postgres RPC) and have it re-apply rules to pending rows; add server-side pagination + bulk approve. (4) One-time backed-up migration to strip bank `transaction_type` from description-bearing rules + a reviewed duplicate consolidation.

**Tech Stack:** Next.js 15, TypeScript (strict, 2-space, single quotes, **no semicolons** in receipts service/lib files), Supabase (service-role admin client; RLS service-role-only on `receipt_*`), Vitest (globals), Postgres RPCs (SECURITY DEFINER, `*_atomicity` pattern).

**Spec:** `docs/superpowers/specs/2026-06-29-receipts-classification-rework-design.md`
**Working location:** worktree `/Users/peterpitcher/Cursor/OJ-AnchorManagementTools-amex`, branch `feat/receipts-classification-rework`. Use `./node_modules/.bin/vitest` and `./node_modules/.bin/tsc` (not bare `npx`). Migrations are applied to prod via the Supabase MCP `apply_migration` at deploy time (this project's prod history uses apply-time timestamps, not file names) — the plan only creates the migration files.

**Ship order (each independently deployable):** Move 1 (Tasks 1) → Move 2 (Tasks 2-5) → Move 2c (Tasks 6-8) → Move 3 (Tasks 9-10) → UI (Task 11) → Verify (Task 12).

---

## Task 1: Matcher — `transaction_type` non-blocking for typeless rows

**Files:**
- Modify: `src/lib/receipts/rule-matching.ts:113-126`
- Test: `src/lib/receipts/rule-matching.amex.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

Create `src/lib/receipts/rule-matching.amex.test.ts`:

```ts
import { describe, expect, it } from 'vitest'
import { getRuleMatch } from './rule-matching'

const baseRule = {
  id: 'r1', priority: 1000, created_at: '2026-01-01',
  match_description: 'tesco', match_transaction_type: 'Card Transaction',
  match_direction: 'out' as const, match_min_amount: null, match_max_amount: null,
}
const ctx = { direction: 'out' as const, amountValue: 20 }

describe('getRuleMatch with typeless (Amex) transactions', () => {
  it('matches a description rule on a typeless row, ignoring the type requirement', () => {
    const r = getRuleMatch(baseRule, { details: 'TESCO STORE 2047 STAINES', transaction_type: null }, ctx)
    expect(r.matched).toBe(true)
    expect(r.hasTransactionTypeMatch).toBe(false)
  })

  it('still requires the type to match when the row HAS a type', () => {
    const r = getRuleMatch(baseRule, { details: 'TESCO STORE 2047', transaction_type: 'Direct Debit' }, ctx)
    expect(r.matched).toBe(false)
  })

  it('does NOT match a type-only rule (no description) against a typeless row', () => {
    const typeOnly = { ...baseRule, id: 'r2', match_description: null, match_transaction_type: 'Cash Deposit', match_direction: 'in' as const }
    const r = getRuleMatch(typeOnly, { details: 'PAYMENT RECEIVED', transaction_type: null }, { direction: 'in', amountValue: 100 })
    expect(r.matched).toBe(false)
  })

  it('still matches a typed row for the type-only rule (regression)', () => {
    const typeOnly = { ...baseRule, id: 'r2', match_description: null, match_transaction_type: 'Cash Deposit', match_direction: 'in' as const }
    const r = getRuleMatch(typeOnly, { details: 'X', transaction_type: 'Cash Deposit' }, { direction: 'in', amountValue: 100 })
    expect(r.matched).toBe(true)
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd /Users/peterpitcher/Cursor/OJ-AnchorManagementTools-amex && ./node_modules/.bin/vitest run src/lib/receipts/rule-matching.amex.test.ts`
Expected: FAIL (typeless rows currently hard-fail the type gate).

- [ ] **Step 3: Implement** — replace the type block at `rule-matching.ts:113-126`:

```ts
  let hasTransactionTypeMatch = false
  if (rule.match_transaction_type) {
    const transactionTypeLower = (transaction.transaction_type ?? '').toLowerCase()
    if (transactionTypeLower) {
      // Transaction has a type → it must contain the rule's type, as before.
      if (!transactionTypeLower.includes(rule.match_transaction_type.toLowerCase())) {
        return {
          matched: false,
          matchedNeedleLength,
          hasTransactionTypeMatch: false,
          isDirectionSpecific: false,
          amountConstraintCount,
        }
      }
      hasTransactionTypeMatch = true
    } else {
      // Typeless row (e.g. Amex): the type requirement is indeterminate. Allow the
      // match ONLY if the rule also matched on description; a type-only rule (no
      // description) must NOT match a typeless row (would over-match every credit).
      if (!rule.match_description) {
        return {
          matched: false,
          matchedNeedleLength,
          hasTransactionTypeMatch: false,
          isDirectionSpecific: false,
          amountConstraintCount,
        }
      }
      hasTransactionTypeMatch = false
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run src/lib/receipts/rule-matching.amex.test.ts src/lib/receipts/rule-matching.test.ts` (the second is the existing suite — confirm no regression).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/receipts/rule-matching.ts src/lib/receipts/rule-matching.amex.test.ts
git commit -m "feat(receipts): rules match typeless (Amex) rows by description (Move 1)"
```

---

## Task 2: `sanitizeRuleKeywords` — keyword hygiene

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts`
- Test: `src/services/receipts/receiptHelpers.keywords.test.ts` (new)

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest'
import { sanitizeRuleKeywords } from './receiptHelpers'

describe('sanitizeRuleKeywords', () => {
  it('extracts the distinctive vendor token from details', () => {
    expect(sanitizeRuleKeywords('TESCO STORE 2047 2047TE STAINES', null)).toBe('tesco')
  })
  it('prefers AI keywords but drops generic/stopword/short tokens', () => {
    expect(sanitizeRuleKeywords('x', 'the,uk,ltd,amazon,store')).toBe('amazon')
  })
  it('caps at 3 keywords', () => {
    expect(sanitizeRuleKeywords('costco wickes wholesale sunbury hanworth', null)?.split(',').length).toBeLessThanOrEqual(3)
  })
  it('returns null when nothing distinctive remains', () => {
    expect(sanitizeRuleKeywords('THE UK LTD STORE', 'the,uk,ltd')).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/receipts/receiptHelpers.keywords.test.ts`
Expected: FAIL — `sanitizeRuleKeywords` not exported.

- [ ] **Step 3: Implement** — add to `receiptHelpers.ts`:

```ts
// Words too generic to be a useful OR-keyword in a rule's match_description.
const RULE_KEYWORD_STOPLIST = new Set([
  'the', 'and', 'ltd', 'limited', 'plc', 'uk', 'gbr', 'gb', 'store', 'stores', 'card',
  'payment', 'purchase', 'refund', 'london', 'account', 'ref', 'www', 'com', 'co',
  'shop', 'online', 'services', 'service', 'group', 'holdings', 'retail',
])

// Produce a comma-separated, de-noised keyword list for a rule's match_description.
// Prefers AI-suggested keywords, falls back to the transaction details. Returns null
// if nothing sufficiently distinctive remains (caller should then NOT create a rule).
export function sanitizeRuleKeywords(details: string, aiKeywords?: string | null): string | null {
  const raw = (aiKeywords && aiKeywords.trim().length > 0 ? aiKeywords : details) || ''
  const seen = new Set<string>()
  const keywords: string[] = []
  for (const token of raw.split(/[\s,]+/)) {
    const cleaned = token.replace(/[^a-zA-Z0-9&]/g, '').toLowerCase()
    if (cleaned.length < 4) continue
    if (/^\d+$/.test(cleaned)) continue
    if (RULE_KEYWORD_STOPLIST.has(cleaned)) continue
    if (seen.has(cleaned)) continue
    seen.add(cleaned)
    keywords.push(cleaned)
    if (keywords.length >= 3) break
  }
  return keywords.length ? keywords.join(',') : null
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/receipts/receiptHelpers.keywords.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/receiptHelpers.keywords.test.ts
git commit -m "feat(receipts): sanitizeRuleKeywords for rule keyword hygiene (Move 2)"
```

---

## Task 3: `buildRuleSuggestion` — stop emitting `transaction_type`; use keyword hygiene

**Files:**
- Modify: `src/services/receipts/receiptHelpers.ts` (`buildRuleSuggestion` ~442-486; `RuleSuggestion` type in `./types`)
- Modify: `src/services/receipts/receiptGovernance.ts:321` (the insert that maps `match_transaction_type`)
- Test: `src/services/receipts/receiptHelpers.keywords.test.ts` (extend)

- [ ] **Step 1: Add failing tests** (append to the keywords test file)

```ts
import { buildRuleSuggestion } from './receiptHelpers'

describe('buildRuleSuggestion (Move 2/3)', () => {
  const tx: any = { details: 'TESCO STORE 2047 STAINES', transaction_type: 'Card Transaction', amount_in: null, amount_out: 20 }
  it('no longer emits transactionType', () => {
    const s = buildRuleSuggestion(tx, { vendorName: 'Tesco', expenseCategory: null, suggestedRuleKeywords: null })
    expect(s).not.toHaveProperty('transactionType')
  })
  it('uses sanitized keywords for matchDescription', () => {
    const s = buildRuleSuggestion(tx, { vendorName: 'Tesco', expenseCategory: null, suggestedRuleKeywords: null })
    expect(s?.matchDescription).toBe('tesco')
  })
  it('returns null when no distinctive keyword exists', () => {
    const s = buildRuleSuggestion({ ...tx, details: 'THE UK LTD' }, { vendorName: 'X', expenseCategory: null, suggestedRuleKeywords: 'the,uk,ltd' })
    expect(s).toBeNull()
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `./node_modules/.bin/vitest run src/services/receipts/receiptHelpers.keywords.test.ts`
Expected: FAIL — `transactionType` still present; matchDescription not sanitized.

- [ ] **Step 3: Implement**

In `src/services/receipts/types.ts`, remove `transactionType` from the `RuleSuggestion` type.

Replace `buildRuleSuggestion` body's keyword derivation and return (in `receiptHelpers.ts`):

```ts
  const matchDescription = sanitizeRuleKeywords(details, updates.suggestedRuleKeywords)
  if (!matchDescription) {
    // No distinctive keyword → don't propose an over-broad rule.
    return null
  }

  const suggestedNameBase = updates.vendorName ?? updates.expenseCategory ?? 'Receipt rule'
  const suggestedName = `${suggestedNameBase} auto-tag`

  return {
    suggestedName,
    matchDescription,
    direction,
    amountValue,
    details,
    setVendorName: updates.vendorName ?? null,
    setExpenseCategory: updates.expenseCategory ?? null,
  }
```

In `receiptGovernance.ts:321`, change the insert mapping so suggestions never carry a bank type:

```ts
      match_transaction_type: null,
```

- [ ] **Step 4: Run to verify it passes**

Run: `./node_modules/.bin/vitest run src/services/receipts/receiptHelpers.keywords.test.ts`
Expected: PASS. Then `./node_modules/.bin/tsc --noEmit` — fix any reference to the removed `transactionType` (there should be none beyond the governance insert).

- [ ] **Step 5: Commit**

```bash
git add src/services/receipts/receiptHelpers.ts src/services/receipts/types.ts src/services/receipts/receiptGovernance.ts src/services/receipts/receiptHelpers.keywords.test.ts
git commit -m "feat(receipts): suggestion-created rules are description-only, no transaction_type (Move 2/3)"
```

---

## Task 4: Shared suggestion-builder/dedupe helper

**Files:**
- Modify: `src/services/receipts/receiptGovernance.ts` (extract from `performSuggestReceiptRules:251-350`)

- [ ] **Step 1: Extract a shared helper.** Add `buildRuleSuggestionInserts` and refactor `performSuggestReceiptRules` to use it. The helper groups transactions into suggestion-insert rows, deduping against existing rules + pending/approved suggestions:

```ts
type SuggestionSource = 'manual_corrections' | 'ai_classification'

export function suggestionDedupeKey(parts: {
  matchDescription: string | null
  direction: string
  vendorName: string | null
  expenseCategory: string | null
}): string {
  return [
    normalizeReceiptVendorKey(parts.matchDescription),
    parts.direction ?? 'both',
    normalizeReceiptVendorKey(parts.vendorName),
    parts.expenseCategory ?? '',
  ].join('|')
}

// Builds receipt_rule_suggestions insert rows from (transaction, vendor, expense) inputs.
// minOccurrences: manual=2, ai=1. existingKeys must already include active rules + pending/approved suggestions.
export function buildRuleSuggestionInserts(
  inputs: Array<{ transaction: ReceiptTransaction; vendorName: string | null; expenseCategory: ReceiptExpenseCategory | null; suggestedRuleKeywords: string | null; confidence: number | null }>,
  opts: { source: SuggestionSource; minOccurrences: number; existingKeys: Set<string>; cap: number }
): any[] {
  const groups = new Map<string, { suggestion: NonNullable<ReturnType<typeof buildRuleSuggestion>>; transactionIds: string[]; confidence: number | null }>()
  for (const input of inputs) {
    const suggestion = buildRuleSuggestion(input.transaction, {
      vendorName: input.vendorName, expenseCategory: input.expenseCategory, suggestedRuleKeywords: input.suggestedRuleKeywords,
    })
    if (!suggestion?.matchDescription) continue
    const key = suggestionDedupeKey({ matchDescription: suggestion.matchDescription, direction: suggestion.direction, vendorName: suggestion.setVendorName, expenseCategory: suggestion.setExpenseCategory })
    if (opts.existingKeys.has(key)) continue
    const group = groups.get(key) ?? { suggestion, transactionIds: [], confidence: input.confidence }
    group.transactionIds.push(input.transaction.id)
    group.confidence = group.confidence ?? input.confidence
    groups.set(key, group)
  }
  return Array.from(groups.values())
    .filter((g) => g.transactionIds.length >= opts.minOccurrences)
    .slice(0, opts.cap)
    .map((g) => ({
      suggested_name: g.suggestion.suggestedName,
      match_description: g.suggestion.matchDescription,
      match_transaction_type: null,
      match_direction: g.suggestion.direction,
      set_vendor_name: g.suggestion.setVendorName,
      set_expense_category: g.suggestion.setExpenseCategory,
      auto_status: 'pending',
      evidence_transaction_ids: g.transactionIds.slice(0, 20),
      evidence: { source: opts.source, transaction_count: g.transactionIds.length, details_sample: g.suggestion.details, ai_confidence: g.confidence },
    }))
}
```

Refactor `performSuggestReceiptRules` to build `existingKeys` (as today, lines 277-285) and call `buildRuleSuggestionInserts(inputs, { source: 'manual_corrections', minOccurrences: 2, existingKeys, cap: 10 })`. Behaviour unchanged for the manual path (still ≥2, cap 10, type null per Task 3).

- [ ] **Step 2: Typecheck + existing tests**

Run: `./node_modules/.bin/tsc --noEmit` and `./node_modules/.bin/vitest run tests/services/ src/services/receipts/` (whichever cover governance) — expect green; the manual path output is unchanged except `match_transaction_type` is now null.

- [ ] **Step 3: Commit**

```bash
git add src/services/receipts/receiptGovernance.ts
git commit -m "refactor(receipts): shared rule-suggestion builder for manual + AI paths (Move 2)"
```

---

## Task 5: AI job creates guarded suggestions instead of applying values

**Files:**
- Modify: `src/lib/receipts/ai-classification.ts` (the per-transaction apply at `269-309`, candidate filter unchanged)
- Modify: `src/services/receipts/receiptGovernance.ts` (add `previewSuggestionMatchCount` helper, used here and in the UI query)
- Test: `tests/lib/receipt-ai-classification.test.ts` (extend)

- [ ] **Step 1: Add a confidence constant** in `ai-classification.ts` near the top:

```ts
export const AI_SUGGESTION_MIN_CONFIDENCE = 70
```

- [ ] **Step 2: Replace the apply with suggestion accumulation.** In `classifyReceiptTransactionsWithAI`, instead of building `updatePayload` and the row `update` (`269-309`), accumulate per-transaction inputs when confidence clears the floor, and after the loop insert grouped suggestions. The row is left untouched (stays `pending`).

Concretely: inside the loop, replace the `updatePayload`/`update` block with:

```ts
    if (confidence != null && confidence < AI_SUGGESTION_MIN_CONFIDENCE) continue
    if (!vendorName && !expenseCategory) continue
    suggestionInputs.push({
      transaction,
      vendorName: needsVendor ? vendorName ?? null : null,
      expenseCategory: needsExpense ? (expenseCategory as ReceiptExpenseCategory | null) ?? null : null,
      suggestedRuleKeywords: suggestedRuleKeywords ?? null,
      confidence: confidence ?? null,
    })
```

Declare `const suggestionInputs: Array<…> = []` before the loop. After the loop, build `existingKeys` (query active rules + pending/approved suggestions, mirroring `performSuggestReceiptRules:256-285`) and insert via the shared helper with `source: 'ai_classification', minOccurrences: 1, cap: 25`. For each insert, compute and attach `evidence.preview_match_count = await previewSuggestionMatchCount(client, insert)`. Insert with the service-role `client`. Remove the `ai_classification`-apply log/signal writes (`343-374`); optionally push an `ai_suggested_rule` signal instead.

- [ ] **Step 3: Add the preview helper** in `receiptGovernance.ts`:

```ts
// Count transactions a proposed rule's criteria would match (impact preview).
export async function previewSuggestionMatchCount(
  supabase: AdminClient,
  criteria: { match_description: string | null; match_direction: string }
): Promise<number> {
  if (!criteria.match_description) return 0
  const needles = criteria.match_description.split(',').map((n) => n.trim()).filter(Boolean)
  if (!needles.length) return 0
  const or = needles.map((n) => `details.ilike.%${n}%`).join(',')
  let q = supabase.from('receipt_transactions').select('id', { count: 'exact', head: true }).or(or)
  if (criteria.match_direction === 'out') q = q.not('amount_out', 'is', null)
  else if (criteria.match_direction === 'in') q = q.not('amount_in', 'is', null)
  const { count } = await q
  return count ?? 0
}
```

- [ ] **Step 4: Tests** — extend `tests/lib/receipt-ai-classification.test.ts` (mock OpenAI + Supabase):
  - below-confidence result → no suggestion insert and **no** `receipt_transactions.update` call;
  - above-confidence unmatched rows → grouped suggestion insert with `match_transaction_type: null`, merged `evidence_transaction_ids`, `evidence.ai_confidence` set;
  - a row whose vendor already matches an active rule / has an existing pending suggestion → skipped (dedupe).

Run: `./node_modules/.bin/vitest run tests/lib/receipt-ai-classification.test.ts`. Expected: PASS.

- [ ] **Step 5: Typecheck + commit**

Run: `./node_modules/.bin/tsc --noEmit` (green).

```bash
git add src/lib/receipts/ai-classification.ts src/services/receipts/receiptGovernance.ts tests/lib/receipt-ai-classification.test.ts
git commit -m "feat(receipts): AI generates guarded rule suggestions instead of applying values (Move 2)"
```

---

## Task 6: Atomic approval RPC (migration)

**Files:**
- Create: `supabase/migrations/<ts>_approve_receipt_rule_suggestion_rpc.sql`

- [ ] **Step 1: Write the migration** (model on `20260708000025_cashup_session_atomicity.sql`):

```sql
-- Atomic approval: insert the rule + mark the suggestion approved in ONE transaction,
-- so a failure can't leave a rule with a still-pending suggestion. Idempotent: returns
-- the existing approved_rule_id if already approved; raises if not found/declined.
CREATE OR REPLACE FUNCTION public.approve_receipt_rule_suggestion(
  p_suggestion_id uuid,
  p_user_id uuid,
  p_active boolean
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.receipt_rule_suggestions%ROWTYPE;
  v_vendor_id uuid;
  v_rule_id uuid;
BEGIN
  SELECT * INTO v_suggestion FROM public.receipt_rule_suggestions
  WHERE id = p_suggestion_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Suggestion not found';
  END IF;
  IF v_suggestion.status = 'approved' THEN
    RETURN v_suggestion.approved_rule_id; -- idempotent
  END IF;
  IF v_suggestion.status <> 'pending' THEN
    RAISE EXCEPTION 'Suggestion is not pending';
  END IF;

  v_vendor_id := v_suggestion.set_vendor_id;

  INSERT INTO public.receipt_rules (
    name, description, match_description, match_transaction_type, match_direction,
    match_min_amount, match_max_amount, auto_status, set_vendor_name, set_expense_category,
    vendor_id, priority, kind, is_active, created_by, updated_by, reviewed_at, reviewed_by
  ) VALUES (
    v_suggestion.suggested_name, 'Created from receipt rule suggestion evidence.',
    v_suggestion.match_description, NULL, v_suggestion.match_direction,
    v_suggestion.match_min_amount, v_suggestion.match_max_amount, v_suggestion.auto_status,
    v_suggestion.set_vendor_name, v_suggestion.set_expense_category,
    v_vendor_id, 1000, 'standard', COALESCE(p_active, true), p_user_id, p_user_id, now(), p_user_id
  ) RETURNING id INTO v_rule_id;

  UPDATE public.receipt_rule_suggestions
  SET status = 'approved', approved_rule_id = v_rule_id, reviewed_at = now(), reviewed_by = p_user_id
  WHERE id = p_suggestion_id;

  RETURN v_rule_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.approve_receipt_rule_suggestion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.approve_receipt_rule_suggestion(uuid, uuid, boolean) TO service_role;
```

- [ ] **Step 2: Validate SQL parses** (eyeball; it's a single function). Confirm `receipt_rules` columns match the insert (cross-check the table's columns).

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<ts>_approve_receipt_rule_suggestion_rpc.sql
git commit -m "feat(receipts): atomic approve_receipt_rule_suggestion RPC (Move 2c)"
```

---

## Task 7: Approval uses the RPC + re-runs rules over pending rows

**Files:**
- Modify: `src/services/receipts/receiptGovernance.ts` (`performApproveReceiptRuleSuggestion:352-447`)
- Test: governance test (new or extend)

- [ ] **Step 1: Replace the two-step insert/update** in `performApproveReceiptRuleSuggestion` with a single RPC call, then trigger the refresh:

```ts
  const { data: ruleId, error: rpcError } = await supabase.rpc('approve_receipt_rule_suggestion', {
    p_suggestion_id: suggestionId,
    p_user_id: userId,
    p_active: options.active ?? true,
  })
  if (rpcError || !ruleId) {
    console.error('Failed to approve receipt rule suggestion', rpcError)
    return { error: 'Failed to create rule from suggestion.' }
  }
  const { data: rule } = await supabase.from('receipt_rules').select('*').eq('id', ruleId).maybeSingle()
  // … existing recordReceiptClassificationSignals(...) using evidence ids …
  await refreshAutomationForPendingTransactions()
  return { success: true, rule: rule as ReceiptRule }
```

Import `refreshAutomationForPendingTransactions` from `./receiptMutations` (watch for circular imports — if present, move the refresh trigger into the action layer instead, calling it after `performApproveReceiptRuleSuggestion`).

- [ ] **Step 2: Test** (mock Supabase rpc + the refresh): approving calls `approve_receipt_rule_suggestion` once and then `refreshAutomationForPendingTransactions` once; on rpc error, returns `{ error }` and does NOT refresh.

Run: `./node_modules/.bin/vitest run <governance test>`. Expected: PASS.

- [ ] **Step 3: Typecheck + commit**

```bash
git add src/services/receipts/receiptGovernance.ts <test>
git commit -m "feat(receipts): atomic approval + re-run rules over pending rows (Move 2b/2c)"
```

---

## Task 8: Bulk approve (server-side, over selected ids)

**Files:**
- Modify: `src/services/receipts/receiptGovernance.ts` (add `performApproveReceiptRuleSuggestions`)
- Modify: `src/app/actions/receipts.ts` (add `approveReceiptRuleSuggestions` action, ~after line 820)
- Test: governance test

- [ ] **Step 1: Service** — add `performApproveReceiptRuleSuggestions(userId, ids: string[], options)` that loops the RPC per id (each atomic), collects successes/failures, then calls `refreshAutomationForPendingTransactions()` **once** at the end. Returns `{ approved: number; failed: number }`.

- [ ] **Step 2: Action** — mirror `approveReceiptRuleSuggestion` (super_admin gate via `currentUserCanGovernReceiptRules`), accept `ids: string[]`, call the service, audit-log `approve_suggestions_bulk`, `revalidateReceiptPaths()`.

```ts
export async function approveReceiptRuleSuggestions(ids: string[], options: { active?: boolean } = {}) {
  const canManage = await checkUserPermission('receipts', 'manage')
  if (!canManage) return { error: 'Insufficient permissions' }
  const { user_id } = await requireCurrentUser()
  if (!(await currentUserCanGovernReceiptRules())) return { error: 'Only super admins can approve suggested rules.' }
  const result = await performApproveReceiptRuleSuggestions(user_id, ids, options)
  await logAuditEvent({ operation_type: 'approve_suggestions_bulk', resource_type: 'receipt_rule_suggestion', operation_status: 'success', additional_info: { ...result, count: ids.length } })
  revalidateReceiptPaths()
  return result
}
```

- [ ] **Step 3: Test** — bulk approve of N ids calls the RPC N times and `refreshAutomationForPendingTransactions` once; a failing id doesn't abort the others.

Run: `./node_modules/.bin/vitest run <test>`. Expected PASS. Then `./node_modules/.bin/tsc --noEmit`.

- [ ] **Step 4: Commit**

```bash
git add src/services/receipts/receiptGovernance.ts src/app/actions/receipts.ts <test>
git commit -m "feat(receipts): server-side bulk approve of rule suggestions (Move 2c)"
```

---

## Task 9: Move 3.1 — backup + null bank `transaction_type` (migration)

**Files:**
- Create: `supabase/migrations/<ts>_receipts_rules_drop_bank_transaction_type.sql`

- [ ] **Step 1: Pre-check** — grep for code/functions depending on `match_transaction_type` being set:

Run: `grep -rniE "match_transaction_type" src supabase/migrations | grep -viE "test|\.md" | head -30`
Confirm it's only read in the matcher (handled in Task 1) and written by rule CRUD/suggestions — no trigger/function depends on it being non-null.

- [ ] **Step 2: Write the migration** (backup table + count-checked null):

```sql
CREATE TABLE IF NOT EXISTS public.receipt_rules_transaction_type_backup (
  id uuid PRIMARY KEY,
  match_transaction_type text NOT NULL,
  match_description text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE v_backup int; v_nulled int;
BEGIN
  INSERT INTO public.receipt_rules_transaction_type_backup (id, match_transaction_type, match_description)
  SELECT id, match_transaction_type, match_description FROM public.receipt_rules
  WHERE match_transaction_type IS NOT NULL AND match_description IS NOT NULL AND btrim(match_description) <> ''
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_backup = ROW_COUNT;

  UPDATE public.receipt_rules SET match_transaction_type = NULL
  WHERE match_transaction_type IS NOT NULL AND match_description IS NOT NULL AND btrim(match_description) <> '';
  GET DIAGNOSTICS v_nulled = ROW_COUNT;

  RAISE NOTICE 'receipt rules: backed up %, nulled %', v_backup, v_nulled;
  IF v_backup <> v_nulled THEN
    RAISE EXCEPTION 'Backup/null count mismatch (% vs %)', v_backup, v_nulled;
  END IF;
END $$;
```

(Type-only rules — `match_description` null/blank — keep their `match_transaction_type`.)

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<ts>_receipts_rules_drop_bank_transaction_type.sql
git commit -m "feat(receipts): back up + null bank transaction_type on description rules (Move 3.1)"
```

---

## Task 10: Move 3.2 — reviewed duplicate consolidation (migration)

**Files:**
- Create: `supabase/migrations/<ts>_receipts_rules_dedupe.sql`

- [ ] **Step 1: List duplicates first.** Run (read-only) against the DB at deploy time to produce the list the user reviews:

```sql
SELECT lower(coalesce(match_description,'')) d, match_direction dir, match_min_amount, match_max_amount,
       match_transaction_type, set_vendor_name, set_vendor_id, set_expense_category, auto_status, kind,
       count(*), array_agg(id ORDER BY priority, created_at) ids
FROM receipt_rules WHERE is_active
GROUP BY 1,2,3,4,5,6,7,8,9,10 HAVING count(*) > 1;
```

Show the list to the user before deactivating anything.

- [ ] **Step 2: Write the migration** — deactivate all but the first (lowest priority, then oldest) of each exact-duplicate group, keyed on **all** discriminating + action fields:

```sql
WITH dupes AS (
  SELECT id, row_number() OVER (
    PARTITION BY lower(coalesce(match_description,'')), match_direction, match_min_amount, match_max_amount,
                 match_transaction_type, coalesce(set_vendor_name,''), set_vendor_id, coalesce(set_expense_category,''),
                 auto_status, kind
    ORDER BY priority ASC, created_at ASC
  ) AS rn
  FROM public.receipt_rules WHERE is_active
)
UPDATE public.receipt_rules r
SET is_active = false, deactivated_at = now()
FROM dupes WHERE r.id = dupes.id AND dupes.rn > 1;
```

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/<ts>_receipts_rules_dedupe.sql
git commit -m "feat(receipts): deactivate exact-duplicate rules (Move 3.2, reviewed)"
```

---

## Task 11: UI — accurate count, pagination, preview, multi-select bulk approve

**Files:**
- Modify: `src/services/receipts/receiptGovernance.ts` (`queryReceiptGovernanceItems:116-149` — paginate + count + preview)
- Modify: `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx`

- [ ] **Step 1: Query** — change the suggestions select to support a page/limit and return a server `count`. Add `preview_match_count` per suggestion (read from `evidence.preview_match_count`, or compute via `previewSuggestionMatchCount` for legacy rows). Return `{ conflicts, suggestions, suggestionsTotal }`.

- [ ] **Step 2: UI** — in `ReceiptRules.tsx`:
  - Show `suggestionsTotal` (server count), not the loaded length; remove the `.slice(0,5)` cap and page through.
  - Render each suggestion's evidence count, `evidence.ai_confidence`, and `preview_match_count` ("would match N transactions") so the reviewer sees breadth.
  - Add checkboxes + an "Approve selected" button wired to a new `onApproveSelected(ids)` handler calling the `approveReceiptRuleSuggestions` action; keep per-row Approve/Decline. Gate all on `canGovernRules`.

- [ ] **Step 3: Verify** — `./node_modules/.bin/tsc --noEmit` (green); manual check deferred to Task 12. Commit:

```bash
git add src/services/receipts/receiptGovernance.ts "src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx"
git commit -m "feat(receipts): suggestions UI — count, pagination, impact preview, bulk approve (Move 2c)"
```

---

## Task 12: Full verification + live validation

- [ ] **Step 1:** `./node_modules/.bin/vitest run` — all pass.
- [ ] **Step 2:** `npm run lint` — zero warnings.
- [ ] **Step 3:** `./node_modules/.bin/tsc --noEmit` — clean.
- [ ] **Step 4:** `npm run build` — succeeds.
- [ ] **Step 5 (at deploy):** apply the three migrations (Tasks 6, 9, 10) to prod via Supabase MCP `apply_migration` in order; run the Task 10 Step-1 duplicate query first and confirm the list with the user.
- [ ] **Step 6 (post-deploy validation):** re-run rules over the 30 pending Amex rows (`refreshAutomationForPendingTransactions`); confirm Tesco/Amazon/Wickes/Costco classify by `rule`; confirm AI now produces guarded suggestions (with previews) for B&Q/Waitrose/M&S/The Range/Lovisa/BBQWorld/Dojo rather than stamping values; approve one and confirm the rule re-runs and classifies its rows.

---

## Self-review notes (author)

- **Spec coverage:** Move 1 → T1; keyword hygiene → T2; transaction_type-not-emitted → T3; shared helper → T4; AI→suggestions (confidence floor, preview, dedupe, no writes) → T5; atomic approval RPC → T6; approval re-run → T7; bulk approve → T8; backed-up type migration → T9; reviewed dedupe → T10; UI count/pagination/preview/bulk → T11; verification + live → T12.
- **Naming consistency:** `sanitizeRuleKeywords`, `buildRuleSuggestionInserts`, `suggestionDedupeKey`, `previewSuggestionMatchCount`, `approve_receipt_rule_suggestion`, `performApproveReceiptRuleSuggestions`, `approveReceiptRuleSuggestions`, `AI_SUGGESTION_MIN_CONFIDENCE` used identically across tasks.
- **Investigate-then-edit** (T7 circular-import check, T9 grep, T10 duplicate list) each carry the concrete change + a verification, not a placeholder.

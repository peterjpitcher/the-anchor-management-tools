# Receipts classification rework — design

**Date:** 2026-06-29
**Status:** Draft — pending user review
**Author:** Peter Pitcher (with Claude)
**Branch:** `feat/receipts-classification-rework`

## Goal

Make `/receipts` automation rules the deterministic, source-agnostic source of truth, and turn AI from a silent value-applier into a **rule-suggestion author**. Concretely:

1. **Unblock matching** — rules stop failing on credit-card (Amex) rows that have no bank `transaction_type`.
2. **AI suggests, doesn't apply** — when no rule matches a transaction, AI proposes a *rule* (for human approval) instead of writing vendor/expense onto the row. Unmatched rows stay `pending` until an approved rule classifies them.
3. **Simplify the rule model** — stop pinning rules to bank `transaction_type`; new rules are description/vendor based; one-time cleanup of the existing corpus.

## Background (why)

After importing Amex statements, only **Costco** classified by rule; everything else was classified by **AI** (`vendor_source='ai'`), with errors (Waitrose→Entertainment, Lovisa→no category) and OpenAI cost. Root cause: **122 of 165 active rules require `match_transaction_type`** (bank concepts: `Card Transaction`, `Direct Debit`, `Inward Payment`), and all 38 Amex rows have `transaction_type = NULL`. `getRuleMatch` hard-fails a type requirement against a null type, so those rules can never match Amex. The Costco rule is the one with no `match_transaction_type`.

Rule-corpus shape (active, typed):

| transaction_type | dir | count | has description |
|---|---|---|---|
| Card Transaction | out | 65 | all |
| Direct Debit | out | 19 | all |
| Outward Faster Payment | out | 18 | all |
| Card Transaction | in | 7 | all |
| Inward Payment | in | 7 | all |
| BACS Payment Received | in | 3 | all |
| TRANSFER | in | 2 | all |
| Cash Deposit | in | 1 | **none (type-only)** |

→ **121 typed rules have a description** (safe to simplify); **1 is type-only** (must keep its type).

## Decisions (confirmed with user)

| # | Decision | Choice |
|---|----------|--------|
| A | Scope | **Full rework**: Move 1 + Move 2 + Move 3 |
| B | Unmatched-row behaviour | **Stay `pending`** until an approved rule classifies them — AI never writes values directly |

## Current state (discovery — exact anchors)

- **AI apply path:** import → `enqueueReceiptAiClassificationJobs` (`receiptMutations.ts:559`) → job `classify_receipt_transactions` → `classifyReceiptTransactionsWithAI` (`src/lib/receipts/ai-classification.ts:137-387`). Payload built `:269-296` (`vendor_source='ai'` `:276`, `expense_category_source='ai'` `:284`, `ai_confidence`, `ai_suggested_keywords`); **the write is `ai-classification.ts:304-309** — `client.from('receipt_transactions').update(updatePayload).eq('id', …)`. Candidate filter `:168-176` skips `vendor_source IN (manual|rule|import)` and `expense_category_source='manual'`.
- **Matcher:** `src/lib/receipts/rule-matching.ts` — type gate at **`:113-126`** (hard-fail on missing type); ranking rewards `hasTransactionTypeMatch` at `:164-165`.
- **Apply engine:** `applyAutomationRules` (`receiptMutations.ts:161-553`); re-run entry points: `refreshAutomationForPendingTransactions` (`:591-602`), retroactive `runReceiptRuleRetroactivelyStep` (`receipts.ts:963-1041`, supports `targetRuleId`).
- **Suggestion lifecycle (reuse):** table `receipt_rule_suggestions` (`migrations/20260701000010_receipts_v2_foundations.sql:129-149` — `status`, `suggested_name`, `match_description`, `match_transaction_type`, `match_direction`, `match_min/max_amount`, `set_vendor_id`, `set_vendor_name`, `set_expense_category`, `auto_status`, `evidence_transaction_ids UUID[]`, `evidence JSONB`, `approved_rule_id`). `buildRuleSuggestion` (`receiptHelpers.ts:442-486`). Manual creator `performSuggestReceiptRules` (`receiptGovernance.ts:251-350`, groups by `description|direction|vendor|expense`, **≥2 occurrences**, dedupes vs pending suggestions + active rules). Approve `performApproveReceiptRuleSuggestion` (`receiptGovernance.ts:352-447`) → inserts `receipt_rules`, marks `approved` — **does NOT re-run rules (gap)**. Actions `approveReceiptRuleSuggestion`/`declineReceiptRuleSuggestion` (`receipts.ts:788-850`), **super_admin** gated (`currentUserCanGovernReceiptRules` `:182-212`). UI `ReceiptRules.tsx` suggestions panel `:434-477`.

## Design

### Move 1 — matcher: type non-blocking when the transaction has no type

In `getRuleMatch` (`rule-matching.ts:113-126`), replace the hard-fail:

- If `transaction.transaction_type` is non-empty → behave exactly as today (must `.includes` the rule's type).
- If `transaction.transaction_type` is empty/null:
  - If the rule **also has a `match_description`** (and it matched, which is already enforced earlier in the function) → **ignore** the type requirement (do not fail). Set `hasTransactionTypeMatch = false` so tie-breaks don't over-reward it.
  - If the rule has **no `match_description`** (type-only rule, e.g. Cash Deposit) → **no match** (return `matched:false`). A type-only rule has no other discriminator, so it must not match a typeless row (prevents swallowing every Amex credit).

This is the entire behavioural fix for Amex matching. Bank rows (which have a type) are completely unaffected. After this, the 65 `Card Transaction/out` vendor rules (and the in/refund/settlement rules) match Amex by description+direction+amount.

> Implementation note: the function already requires a description match before reaching the type block when `match_description` is set, and `matchedNeedleLength>0` indicates a description matched. Use "rule has `match_description`" (not just "matched") to decide; an empty `match_description` is the type-only case.

### Move 2 — AI generates rule suggestions instead of applying values

Change `classifyReceiptTransactionsWithAI` so that, instead of `update`-ing the transaction row (`:304-309`), it **creates/updates a rule suggestion** from the AI output:

- Keep the OpenAI call and per-transaction result (`vendorName`, `expenseCategory`, `suggestedRuleKeywords`, `confidence`).
- For each transaction the AI would have classified, build a suggestion via `buildRuleSuggestion(transaction, {vendorName, expenseCategory, suggestedRuleKeywords})` (already returns `match_description`, `direction`, `set_vendor_name`, `set_expense_category`).
- **Group + dedupe**: collapse suggestions by a normalized key (`match_description | direction | set_vendor_name | set_expense_category`); accumulate the contributing transaction ids into `evidence_transaction_ids`; store AI `confidence`/`suggestedRuleKeywords` in `evidence` JSONB. **Allow single-evidence suggestions** (unlike the manual ≥2 path) — one Amex Tesco the first time should still propose a rule.
- **Skip** a suggestion if: an **active rule already matches** the transaction (after Move 1 it would have classified it, so this is rare), OR a **pending suggestion with the same key already exists** (upsert/merge evidence instead of duplicating). Reuse the dedupe loaders already used by `performSuggestReceiptRules`.
- **Do NOT** write `vendor_name`/`expense_category`/`*_source`/`ai_confidence` onto the transaction row. The row stays `pending`.
- Use the **service-role admin client** for the suggestion insert (confirm which of `supabase`/`client` in `ai-classification.ts` is service-role; `receipt_*` is RLS service-role-only).
- Logging/signals: record an `ai_suggested_rule` signal (not an `ai_classification` apply) for auditability.

**Refactor:** extract the grouping/dedupe-vs-rules-and-pending logic from `performSuggestReceiptRules` into a shared helper (e.g. `buildRuleSuggestionsFromTransactions` in `receiptGovernance.ts` or `receiptHelpers.ts`) consumed by **both** the manual path and the new AI path. No behaviour change to the manual path beyond using the shared helper.

### Move 2b — approval re-runs rules (close the gap)

In `performApproveReceiptRuleSuggestion` (`receiptGovernance.ts:352-447`), after the rule is created, **enqueue a retroactive run** so the new rule classifies existing rows:

- Reuse the retroactive mechanism (`runReceiptRuleRetroactivelyStep` / a `reapply_receipt_rules` job with `targetRuleId = approved_rule_id`) scoped to **all `pending` rows** (not just `evidence_transaction_ids`) — the new rule may match historical rows beyond the evidence. This runs async (job queue), consistent with import.
- Result: approve a suggestion → its rule immediately (within the job cycle) reclassifies all matching pending rows, source `rule`.

### Move 3 — simplify the rule corpus (one-time migration + defaults)

1. **Migration** `*_receipts_rules_drop_bank_transaction_type.sql`:
   ```sql
   UPDATE receipt_rules
   SET match_transaction_type = NULL
   WHERE match_transaction_type IS NOT NULL
     AND match_description IS NOT NULL AND btrim(match_description) <> '';
   ```
   This nulls type on the **121** description-bearing rules and **keeps** it on the **1** type-only rule. Direction and amount bounds are untouched (still valid, source-agnostic discriminators). Per workspace rule, first grep migrations/functions for `match_transaction_type` references (it's nulling values, not dropping the column — low risk, but verify no trigger/function depends on it being set).
2. **Duplicate consolidation (reviewable):** after nulling type, identify exact-duplicate active rules by `(lower(match_description), set_vendor_name, set_expense_category, match_direction)`; **list them for confirmation**, then deactivate the redundant copies (keep the oldest/highest-priority). Done as a second, explicitly-reviewed migration — **not** auto-applied without showing the list. (e.g. the disabled "Card Purchase TESCO STORES 2047" / "Amazon auto-tag" typeless duplicates already hint at prior manual attempts.)
3. **Defaults going forward:** confirm `buildRuleSuggestion` does not emit `match_transaction_type` (it doesn't appear to). New rules created from suggestions (`performApproveReceiptRuleSuggestion`) and via `performCreateReceiptRule` default to description/vendor-based.

### UI

- `ReceiptRules.tsx` suggestions panel will now receive many more (AI-sourced) suggestions. Add a **bulk-approve** affordance (approve-selected / approve-all-pending) so the quarterly review is fast. Keep the super_admin gate.
- Surface "needs a rule" pending rows clearly (they no longer get an AI value) — the existing pending/outstanding filters already cover this; add a count of open suggestions to the workspace summary so the user knows there's a review queue.

## Data flow (after)

```
Import → applyAutomationRules (Move 1: matches Amex too) → still-pending rows
      → AI job → builds grouped rule SUGGESTIONS (no row writes) → receipt_rule_suggestions (pending)
User reviews suggestions → approve → create rule → enqueue retro run over pending → rows classified by rule
                         → decline → suggestion closed; row stays pending for manual handling
```

## Error handling / edge cases

- Move 1: type-only rule never matches a typeless row (explicit test).
- Move 2: AI returns nothing for a row → no suggestion, row stays pending (manual classification still works and can spawn a manual suggestion via the existing ≥2 path).
- Dedupe: never create a suggestion duplicating an active rule or an existing pending suggestion (merge evidence).
- Approval retro-run failures are surfaced as warnings (consistent with import job warnings); the rule still exists and will apply on the next import/refresh.

## Testing

- `rule-matching` unit tests: (a) typeless txn + description rule → match, `hasTransactionTypeMatch=false`; (b) typeless txn + type-only rule → no match; (c) typed txn unchanged (regression); (d) ranking: a typed-row type match still outranks a typeless description-only match.
- AI suggestion path (mock OpenAI + Supabase): unmatched rows produce grouped suggestions with merged evidence; **no** writes to `receipt_transactions`; dedupe vs existing rule and vs existing pending suggestion; single-evidence allowed.
- Approval: approving a suggestion creates a rule and enqueues a retro run; the targeted pending rows get `vendor_source='rule'`.
- Move 3 migration: 121 rules nulled, 1 type-only retained; bank rules still classify (regression on a sample); the duplicate list is produced.
- Live validation: re-run over the 30 pending Amex rows → Tesco/Amazon/Wickes/Costco classify by rule; remaining vendors (B&Q, Waitrose, M&S, The Range, Lovisa, BBQWorld, Dojo-venue) generate suggestions for review.

## Files touched

| File | Change |
|------|--------|
| `src/lib/receipts/rule-matching.ts` | Move 1 type-gate change + ranking tweak |
| `src/lib/receipts/ai-classification.ts` | Move 2: replace row UPDATE with suggestion creation |
| `src/services/receipts/receiptGovernance.ts` | shared suggestion-builder helper; approval enqueues retro run |
| `src/services/receipts/receiptHelpers.ts` | (verify) `buildRuleSuggestion` defaults; possibly host shared helper |
| `src/services/receipts/receiptMutations.ts` | retro-run entry reused by approval (if not already callable) |
| `src/app/actions/receipts.ts` | approval action wires retro-run; (bulk-approve action) |
| `supabase/migrations/*_receipts_rules_drop_bank_transaction_type.sql` | Move 3 migration (null type on description rules) |
| `supabase/migrations/*_receipts_rules_dedupe.sql` | Move 3 duplicate consolidation (reviewed) |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx` | bulk-approve; open-suggestion count |
| tests | `rule-matching`, AI-suggestion, approval, migration |

## Rollback

- Move 1: revert the matcher change (pure code).
- Move 2: revert the AI job change (returns to direct apply). Suggestions already created are harmless (pending).
- Move 3: the type-null migration is data-only; rollback would require restoring `match_transaction_type` from a backup — so **snapshot the affected rules' `(id, match_transaction_type)` into the migration as a comment / a backup table** before nulling, for reversibility.

## Assumptions / defaults

- The post-import AI job is **repurposed** (not removed) to generate suggestions; it no longer writes to rows.
- AI suggestions never propose `auto_status` changes (rows stay pending after classify).
- Approval re-runs over **all pending** rows (not just evidence) for completeness.
- Super_admin remains the gate for approving suggestions/creating rules.

## Complexity

Score **4 (L)** — touches the matcher, the AI job, the suggestion lifecycle, two data migrations, and UI. Independently shippable in order: Move 1 (matcher) first (immediate Amex win, lowest risk), then Move 2/2b (AI→suggestions + approval re-run), then Move 3 (cleanup). Each is separately deployable.

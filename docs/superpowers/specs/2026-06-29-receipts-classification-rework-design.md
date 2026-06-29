# Receipts classification rework — design

**Date:** 2026-06-29
**Status:** Draft v2 — review feedback incorporated; pending user re-review
**Author:** Peter Pitcher (with Claude)
**Branch:** `feat/receipts-classification-rework`

## Goal

Make `/receipts` automation rules the deterministic, source-agnostic source of truth, and turn AI from a silent value-applier into a **rule-suggestion author** — with tight guardrails so a single AI guess can't silently become a broad rule.

1. **Unblock matching** — rules stop failing on credit-card (Amex) rows that have no bank `transaction_type`.
2. **AI suggests, doesn't apply** — when no rule matches, AI proposes a *rule* (human-approved, with impact preview) instead of writing vendor/expense onto the row. Unmatched rows stay `pending`.
3. **Simplify the rule model** — stop pinning rules to bank `transaction_type` (including future suggestion-created rules); cleanup of the existing corpus with a real backup.

## Background (why)

After importing Amex statements, only **Costco** classified by rule; everything else by **AI** (`vendor_source='ai'`) with errors and cost. Root cause: **122/165 active rules require `match_transaction_type`** (bank concepts) and all Amex rows have `transaction_type = NULL`; `getRuleMatch` hard-fails a type requirement on a null type. The Costco rule is the one with no `match_transaction_type`.

Active typed rules: 65 `Card Transaction/out`, 19 `Direct Debit/out`, 18 `Outward Faster Payment/out`, 7 `Card Transaction/in`, 7 `Inward Payment/in`, 3 `BACS/in`, 2 `TRANSFER/in`, **1 `Cash Deposit/in` with no description (type-only)**. → 121 typed rules have a description (safe to simplify); 1 is type-only (must keep its type). *(Counts are as of 2026-06-29 and may drift — the migration keys off the WHERE clause, not these numbers.)*

## Decisions

| # | Decision | Choice |
|---|----------|--------|
| A | Scope | **Full rework**: Move 1 + 2 + 3 |
| B | Unmatched-row behaviour | **Stay `pending`** until an approved rule classifies them |
| C | Single-evidence AI suggestions | **Allowed, but guarded** — confidence floor + keyword hygiene + impact preview + always human-approved (never auto-applied) |
| D | Retro-run mechanism | Reuse existing **`refreshAutomationForPendingTransactions()`** once after an atomic approve — no new job type |
| E | Approval atomicity | **Postgres RPC** (codebase `*_atomicity` pattern) — rule insert + suggestion update in one transaction |
| F | transaction_type on new rules | **Never emitted** by the suggestion path (fixes manual path too) |

## Current state (verified anchors)

- **AI apply path:** `classifyReceiptTransactionsWithAI` (`src/lib/receipts/ai-classification.ts:137-387`); payload `:269-296` (`vendor_source='ai'` `:276`, `expense_category_source='ai'` `:284`); **write at `:304-309`** (`client.from('receipt_transactions').update(updatePayload)…`). Candidate filter `:168-176`.
- **Matcher:** `rule-matching.ts` — type gate **`:113-126`** (hard-fail on missing type); ranking rewards `hasTransactionTypeMatch` `:164-165`.
- **Suggestion builder (BUG):** `buildRuleSuggestion` (`receiptHelpers.ts:442-486`) returns `transactionType: transaction.transaction_type`; `performSuggestReceiptRules` (`receiptGovernance.ts:251-350`) maps it at **`:321`** (`match_transaction_type: group.suggestion.transactionType`); approval copies it to the rule at **`:382`**. → suggestion-created rules inherit the bank type.
- **Manual suggestion creator:** `performSuggestReceiptRules` groups by `description|direction|vendor|expense`, dedupes vs pending+approved suggestions and active rules (`:256-285`), **≥2 occurrences** (`:316`), caps 10 (`:317`).
- **Approval (NON-atomic):** `performApproveReceiptRuleSuggestion` (`receiptGovernance.ts:352-447`) — inserts rule `:376-399`, **then** updates suggestion `:406-414` (separate writes; failure of the 2nd leaves a rule + a still-`pending` suggestion). **No retro-run.** Actions `receipts.ts:788-850`, super_admin gated.
- **Apply/re-run:** `applyAutomationRules` (`receiptMutations.ts:161-553`); **`refreshAutomationForPendingTransactions`** (`:591-602`) applies active rules to all `pending` rows; retro `runReceiptRuleRetroactivelyStep` (`receipts.ts:963-1041`) is a server-action/client-loop, **not** a background job (no `reapply_receipt_rules` type exists).
- **UI:** `ReceiptRules.tsx` suggestions panel; governance query loads ~20 and the panel shows the first 5 — no pagination, no server-side bulk action, count reflects only the loaded subset.

## Design

### Move 1 — matcher: type non-blocking when the transaction has no type

In `getRuleMatch` (`rule-matching.ts:113-126`):
- Transaction **has** a type → behave exactly as today.
- Transaction type **empty/null**:
  - Rule has a `match_description` → **ignore** the type requirement (it already matched on description); set `hasTransactionTypeMatch = false` (don't over-reward in tie-breaks).
  - Rule has **no** `match_description` (type-only, e.g. Cash Deposit) → **no match**.

Bank rows unaffected. Tests: (a) typeless+description→match; (b) typeless+type-only→no match; (c) typed unchanged; (d) ranking — a typed-row type match still outranks a typeless description-only match.

### Move 2 — AI generates *guarded* rule suggestions instead of applying values

Change `classifyReceiptTransactionsWithAI` to stop the row UPDATE (`:304-309`) and instead create suggestions, via a **shared helper** extracted from `performSuggestReceiptRules` (so manual + AI paths share grouping/dedupe). Guardrails (decision C):

1. **Confidence floor** — only produce a suggestion when AI `confidence ≥ AI_SUGGESTION_MIN_CONFIDENCE` (default **70**; configurable). Below it: no suggestion, row stays pending for manual handling.
2. **Keyword hygiene** — new `sanitizeRuleKeywords(details, aiKeywords)`: lowercase; drop tokens `< 4` chars; drop a stoplist (`the, ltd, limited, uk, store, card, payment, purchase, london, account, ref` …); prefer distinctive vendor tokens; cap to **3** keywords; **reject (no suggestion)** if nothing distinctive remains. Prevents a single generic word (OR-matched) becoming a broad rule.
3. **Impact preview** — at creation, compute and store in `evidence.preview_match_count` the number of transactions the proposed `match_description`/`direction`/amount would match (run the matcher over recent transactions). Surfaced at approval time so the reviewer sees breadth before approving.
4. **Group + dedupe** — collapse by `normalizedDescription|direction|vendor|expense`; accumulate `evidence_transaction_ids`; **single-evidence allowed** (guarded by 1–3 + human approval). Skip if an **active rule already matches** or a **pending suggestion with the same key exists** (merge evidence). Reuse the existing dedupe loaders.
5. **No row writes** — never set `vendor_*`/`expense_*`/`ai_confidence` on the transaction; it stays `pending`. Store AI `confidence`/keywords in `evidence` JSONB only.
6. **`match_transaction_type = NULL`** on every generated suggestion (decision F) — fixes the manual path too. Update `buildRuleSuggestion` to stop returning `transactionType` (and the inserts to set null).
7. Use the **service-role admin client** (`createAdminClient`) for the insert; record an `ai_suggested_rule` signal (not an apply).

### Move 2b — approval applies rules to pending rows (close the gap)

After an approval (single or bulk) commits, call the existing **`refreshAutomationForPendingTransactions()`** **once** — it evaluates all active rules against all `pending` rows in chunks, so the newly-approved rule(s) immediately classify matching rows (source `rule`), and bulk-approve costs a single pass. No new job type (decision D).

### Move 2c — atomic, guarded approval (+ bulk)

- **Atomicity (decision E):** add a Postgres RPC `approve_receipt_rule_suggestion(p_suggestion_id uuid, p_user_id uuid, p_active boolean)` (SECURITY DEFINER, service_role-only) that, in **one transaction**: re-checks `status='pending'`, inserts the `receipt_rules` row (`match_transaction_type = NULL`), updates the suggestion to `approved` + `approved_rule_id`, returns the rule. Idempotent (no-op if not pending). `performApproveReceiptRuleSuggestion` calls the RPC instead of two separate writes; signals + the single `refreshAutomationForPendingTransactions()` run after it commits.
- **Bulk approve (server-side):** a new action `approveReceiptRuleSuggestions(ids: string[])` loops the RPC per id (each atomic), then one `refreshAutomationForPendingTransactions()`. Operates on **explicit selected ids** (not "approve all loaded"); super_admin gated. A separate "approve all pending" is allowed only as a server-side operation over a server-fetched pending set, with the per-suggestion guardrails still applied.

### Move 3 — simplify the corpus (backed-up migration + reviewed dedupe)

1. **Null bank type (with backup + checks)** — migration:
   ```sql
   CREATE TABLE IF NOT EXISTS receipt_rules_transaction_type_backup (
     id uuid PRIMARY KEY,
     match_transaction_type text NOT NULL,
     match_description text,
     backed_up_at timestamptz NOT NULL DEFAULT now()
   );
   INSERT INTO receipt_rules_transaction_type_backup (id, match_transaction_type, match_description)
   SELECT id, match_transaction_type, match_description
   FROM receipt_rules
   WHERE match_transaction_type IS NOT NULL
     AND match_description IS NOT NULL AND btrim(match_description) <> ''
   ON CONFLICT (id) DO NOTHING;

   UPDATE receipt_rules
   SET match_transaction_type = NULL
   WHERE match_transaction_type IS NOT NULL
     AND match_description IS NOT NULL AND btrim(match_description) <> '';
   -- Sanity: the count nulled must equal the count backed up this run.
   ```
   Keeps type on the type-only rule(s). Backup table = real rollback. Before applying, grep migrations/functions/triggers for `match_transaction_type` references (nulling values, not dropping the column — low risk, but verify nothing depends on it being set).
2. **Reviewed duplicate consolidation** — duplicate key uses **all** discriminating + action fields: `normalize(match_description), match_direction, match_min_amount, match_max_amount, match_transaction_type, set_vendor_name, set_vendor_id, set_expense_category, auto_status, kind`. Two active rules are duplicates only if **all** are equal. **List candidates for confirmation first**; then deactivate the redundant copy (keep lowest `priority`, then oldest `created_at`). Shipped as a separate, explicitly-reviewed migration — not auto-applied.
3. **Defaults forward** — covered by Move 2 #6 (suggestion path emits no `match_transaction_type`); confirm `performCreateReceiptRule` also defaults to none unless explicitly set.

### UI (`ReceiptRules.tsx` + governance query)

- **Accurate count** — show a server-side `COUNT` of `pending` suggestions, not the loaded subset.
- **Pagination** — page through suggestions (server-side) rather than showing the first 5 of 20.
- **Per-suggestion review** — show evidence count, AI confidence, and the **impact preview** (`preview_match_count` + a sample) so the reviewer sees breadth before approving.
- **Bulk approve** — multi-select + a server-side bulk action over the selected ids (decision: not a blind "approve all loaded"). Super_admin gated.
- Surface an **open-suggestions count** on the workspace summary so the review queue is visible.

## Data flow (after)

```
Import → applyAutomationRules (Move 1: matches Amex too) → still-pending rows
      → AI job → guarded grouped SUGGESTIONS (confidence floor + keyword hygiene + preview; no row writes)
User reviews (with impact preview) → approve (atomic RPC) → refreshAutomationForPendingTransactions() once → rows classified by rule
                                   → decline → suggestion closed; row stays pending
```

## Error handling / edge cases

- Move 1: type-only rule never matches a typeless row (explicit test).
- Approval RPC failure → neither rule nor approval persists (atomic); re-approve is a no-op if already approved.
- Refresh-after-approve failure → surfaced as a warning; the rule exists and applies on next import/refresh.
- AI low-confidence / no distinctive keyword → no suggestion; row stays pending.
- Dedupe never duplicates an active rule or pending suggestion.

## Testing

- `rule-matching` unit: the four Move 1 cases.
- `sanitizeRuleKeywords`: drops generic/short/stopwords; rejects when nothing distinctive; caps to 3.
- AI suggestion path (mock OpenAI + Supabase): below-confidence → no suggestion; **no** writes to `receipt_transactions`; grouped/merged evidence; dedupe vs rule and vs pending suggestion; `match_transaction_type` is null; preview count stored.
- Approval RPC: rule + suggestion-approved both commit or neither; idempotent on re-approve; bulk approve over selected ids then a single refresh; pending rows get `vendor_source='rule'`.
- Move 3 migration: backup table populated; nulled count == backed-up count; type-only rule retained; bank rules still classify a sample (regression); duplicate list produced.
- Live validation: re-run over the 30 pending Amex rows → Tesco/Amazon/Wickes/Costco classify by rule; other vendors generate guarded suggestions with previews.

## Files touched

| File | Change |
|------|--------|
| `src/lib/receipts/rule-matching.ts` | Move 1 type-gate + ranking |
| `src/lib/receipts/ai-classification.ts` | Move 2: suggestions not row writes; confidence floor; preview |
| `src/services/receipts/receiptGovernance.ts` | shared suggestion helper; keyword hygiene; preview; approval via RPC; bulk approve; refresh-after-approve |
| `src/services/receipts/receiptHelpers.ts` | `buildRuleSuggestion` stops emitting `transactionType`; `sanitizeRuleKeywords` |
| `src/app/actions/receipts.ts` | bulk-approve action; approval wires refresh |
| `supabase/migrations/*_approve_receipt_rule_suggestion_rpc.sql` | atomic approval RPC (service_role) |
| `supabase/migrations/*_receipts_rules_drop_bank_transaction_type.sql` | backup table + null type (Move 3.1) |
| `supabase/migrations/*_receipts_rules_dedupe.sql` | reviewed duplicate consolidation (Move 3.2) |
| `src/app/(authenticated)/receipts/_components/ui/ReceiptRules.tsx` | count, pagination, preview, multi-select bulk approve |
| tests | matcher, keyword hygiene, AI-suggestion, approval RPC, migration |

## Rollback

- Move 1 / Move 2 / Move 2c: revert code (RPC migration is additive; dropping the function is safe).
- Move 3.1: restore from `receipt_rules_transaction_type_backup` (`UPDATE receipt_rules r SET match_transaction_type = b.match_transaction_type FROM …backup b WHERE r.id=b.id`).
- Move 3.2: reactivate deactivated duplicates (they're toggled, not deleted).

## Assumptions / defaults

- AI job is repurposed (not removed); never writes to rows; never proposes `auto_status` changes.
- Retro pass after approval runs over **all pending** rows (one `refreshAutomationForPendingTransactions()`), not just evidence.
- Super_admin remains the approval gate.
- `AI_SUGGESTION_MIN_CONFIDENCE` default 70; keyword cap 3; stoplist maintained in one place.

## Review feedback addressed (v2)

1. `buildRuleSuggestion` emitting `transaction_type` → fixed (Move 2 #6, decision F). 2. No `reapply_receipt_rules` job → use `refreshAutomationForPendingTransactions()` (decision D, Move 2b). 3. Single-evidence + bulk risk → confidence floor + keyword hygiene + preview + always-human-approved (decision C, Move 2). 4. UI 20/5 loading → server count + pagination + server-side bulk over selected ids (UI). 5. Narrow dedupe key → all discriminating+action fields (Move 3.2). 6. Migration needs backup+checks → backup table + count assertion (Move 3.1). 7. Broad OR keywords → `sanitizeRuleKeywords` + impact preview (Move 2 #2-#3). 8. Non-atomic approval → atomic RPC (decision E, Move 2c).

## Complexity

Score **4 (L)**. Shippable in order: **Move 1** (matcher — immediate Amex win, lowest risk) → **Move 2/2b/2c** (guarded AI suggestions + atomic approval + refresh) → **Move 3** (backed-up cleanup). Each independently deployable.

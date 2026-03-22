# Consolidated Defect Log — menu-management Second Pass

**Date:** 2026-03-15
**Pass:** Second independent pass (first-pass DEFECT-001 through DEFECT-015 assumed applied)
**Confirmed defects:** 9 active (2 voided)

---

## False Positives — Voided

### VOID-01: `updateDish` non-atomic (ARCH-003)
- **Agent claim:** Technical Architect claimed `updateDish` executes 6 sequential writes without a transaction wrapper.
- **Verification:** `src/services/menu.ts:1062` clearly calls `supabase.rpc('update_dish_transaction', {...})` with the comment "DEFECT-001 fix". The first-pass fix was applied correctly.
- **Verdict:** FALSE POSITIVE. Voided.

### VOID-02: `DishSchema.parse` called twice (D002)
- **Agent claim:** QA Specialist claimed `DishSchema.parse` is called in both the action layer and the service layer.
- **Verification:** `src/services/menu.ts:1064` contains the comment "DEFECT-015 fix: DishSchema.parse removed here — action layer pre-validates." `grep DishSchema.parse` finds only two occurrences — `menu-management.ts:302` (createMenuDish) and `menu-management.ts:332` (updateMenuDish), both correct action-layer validations.
- **Verdict:** FALSE POSITIVE. Voided.

---

## Active Defects

### DEFECT-001: `updateMenuDish` rejects all partial updates — missing `.partial()`
- **Severity:** CRITICAL
- **Confidence:** Tier 1 — found by 3 agents (QA D001, Business Rules B3, Technical Architect via ARCH-004 note)
- **Business Impact:** Staff cannot deactivate a single dish without resupplying the entire dish payload (name, price, and at least one menu assignment). Any UI that sends only changed fields will always fail with a Zod error. Contradicts the fix applied to `updateMenuRecipe` in the first pass (DEFECT-014).
- **Root Cause Area:** `src/app/actions/menu-management.ts:332` — `DishSchema.parse(input)` requires `name`, `selling_price`, and `assignments (min 1)`.
- **Affected Files:** `src/app/actions/menu-management.ts`
- **Acceptance Criteria:** `updateMenuDish('id', { is_active: false })` succeeds and marks the dish inactive without requiring name, price, or assignments.
- **Fix:** Change `DishSchema.parse(input)` to `DishSchema.partial().parse(input)` at line 332 (matching the pattern at line 302 counterpart in updateMenuRecipe).

---

### DEFECT-002: `validateApiKey` ignores `expires_at` — expired keys remain valid forever
- **Severity:** CRITICAL
- **Confidence:** Tier 1 — found by 2 agents (QA D010, Technical Architect ARCH-011) + project standard `api-key-auth.md` Section 4 explicitly requires expiry check
- **Business Impact:** Operators who set a key expiry date (e.g. to grant a vendor time-limited API access) have no actual security enforcement. Expired keys continue working indefinitely until manually set to `is_active = false`. Violates the project's own API key auth standard.
- **Root Cause Area:** `src/lib/api/auth.ts` — `validateApiKey` queries `.eq('is_active', true)` with no `expires_at` check. The `ApiKey` TypeScript interface does not include `expires_at`.
- **Affected Files:** `src/lib/api/auth.ts`
- **Acceptance Criteria:** A key with `expires_at < now()` is rejected by `validateApiKey` and returns `null`. A key with `expires_at > now()` is accepted. A key with `expires_at = null` is accepted (never expires).
- **Fix:** Add post-query check: `if (key.expires_at && new Date(key.expires_at) < new Date()) return null;` Add `expires_at?: string` to the `ApiKey` interface and include it in the select query.

---

### DEFECT-003: `updateMenuTargetGp` rejects exactly 95% — off-by-one in boundary check
- **Severity:** HIGH
- **Confidence:** Tier 1 — found by 2 agents (QA D003, Business Rules B1)
- **Business Impact:** Operators cannot set the GP target to its documented maximum of 95%. The UI error message says "between 1% and 95%" but the code rejects 95. A documented, operator-visible business rule is violated.
- **Root Cause Area:** `src/services/menu-settings.ts:74` — `if (numeric <= 0 || numeric >= 0.95)` uses inclusive `>=` for the upper bound, which rejects 0.95 (= 95%).
- **Affected Files:** `src/services/menu-settings.ts`
- **Acceptance Criteria:** `updateMenuTargetGp(95)` succeeds and stores `0.95`. `updateMenuTargetGp(95.1)` is rejected with an error.
- **Fix:** Change `numeric >= 0.95` to `numeric > 0.95`.

---

### DEFECT-004: Management API routes return HTTP 400 for all errors including auth failures
- **Severity:** HIGH
- **Confidence:** Tier 1 — found by 3 agents (QA D006, Business Rules B5, Technical Architect ARCH-009)
- **Business Impact:** Internal API consumers (including the frontend) cannot distinguish "you need to log in" (401) from "you don't have permission" (403) from "that dish doesn't exist" (404) from "invalid input" (400). Breaks standard HTTP error handling in any client that branches on status code. A 401 should trigger a redirect to login; it currently shows the same 400 as a bad request.
- **Root Cause Area:** All 7 management API routes use `const status = result.error ? 400 : 200`. Files:
  - `src/app/api/menu-management/dishes/route.ts`
  - `src/app/api/menu-management/dishes/[id]/route.ts`
  - `src/app/api/menu-management/ingredients/route.ts`
  - `src/app/api/menu-management/ingredients/[id]/route.ts`
  - `src/app/api/menu-management/ingredients/[id]/prices/route.ts`
  - `src/app/api/menu-management/recipes/route.ts`
  - `src/app/api/menu-management/recipes/[id]/route.ts`
- **Affected Files:** All 7 above
- **Acceptance Criteria:** Unauthenticated request → 401. Insufficient permission → 403. Resource not found → 404. Invalid input → 400. Server error → 500.
- **Fix:** Add a structured `errorCode` field to server action returns for auth/permission failures (`'UNAUTHENTICATED'`, `'PERMISSION_DENIED'`, `'NOT_FOUND'`). Map these to correct HTTP status codes in the route handlers instead of the blanket ternary.

---

### DEFECT-005: `pack_cost` string/number type mismatch causes spurious price history entries
- **Severity:** HIGH
- **Confidence:** Tier 1 — found by 2 agents (Technical Architect ARCH-006, Business Rules B2)
- **Business Impact:** Every `updateIngredient` call that includes a `pack_cost` inserts a new price history row, even when the price is unchanged. Over time this pollutes the price history ledger with no-change entries, making cost trend analysis unreliable.
- **Root Cause Area:** `src/services/menu.ts:409` — comparison `input.pack_cost !== existing.pack_cost`. `input.pack_cost` is a JS `number` (Zod-validated). `existing.pack_cost` is a PostgreSQL `numeric` column returned as a JS `string` by Supabase PostgREST. Strict `!==` between `5.99` (number) and `"5.99"` (string) is always `true`.
- **Affected Files:** `src/services/menu.ts`
- **Acceptance Criteria:** `updateIngredient` with an unchanged `pack_cost` does NOT insert a new price history row. `updateIngredient` with a changed `pack_cost` DOES insert a new row.
- **Fix:** Change line 409 to `Number(input.pack_cost) !== Number(existing.pack_cost)`.

---

### DEFECT-006: Delete operations swallow FK violation details — staff cannot diagnose failures
- **Severity:** MEDIUM
- **Confidence:** Tier 1 — found by 2 agents (QA D005, Business Rules B4)
- **Business Impact:** When staff try to delete an ingredient or recipe that is still referenced by dishes, they receive a generic "Failed to delete ingredient" error. They cannot determine why the deletion failed or what needs to be removed first. Support load increases; confusion between "doesn't exist" and "in use" errors.
- **Root Cause Area:**
  - `src/services/menu.ts:459–461` (`deleteIngredient`)
  - `src/services/menu.ts:749–751` (`deleteRecipe`)
  - `src/services/menu.ts:1131–1135` (`deleteDish`)
  - None inspect `error.code === '23503'` (PostgreSQL FK violation code)
- **Affected Files:** `src/services/menu.ts`
- **Acceptance Criteria:** Attempting to delete an ingredient used in dishes returns an actionable message such as "Cannot delete: this ingredient is used in existing dishes. Remove it from those dishes first." Generic DB errors still return a generic message.
- **Fix:** In each delete catch block, check `error.code === '23503'` and return a specific message identifying the blocking constraint.

---

### DEFECT-007: `createIngredient` compensating delete failure is silently unlogged
- **Severity:** MEDIUM
- **Confidence:** Tier 1 — found by 2 agents (QA D009, Technical Architect ARCH-005)
- **Business Impact:** If the price history insert fails AND the compensating delete also fails, an orphaned ingredient row accumulates silently. No audit event, no log, no alert. Data integrity is undermined invisibly.
- **Root Cause Area:** `src/services/menu.ts` — `createIngredient` compensating delete block (~line 340–350). The delete result is not checked; if it fails, the original error is still thrown to the caller with no trace of the orphaned row ID.
- **Affected Files:** `src/services/menu.ts`
- **Acceptance Criteria:** If the compensating delete itself fails, a `console.error` is logged with the orphaned ingredient ID and a `action_needed: 'manual cleanup required'` note, before rethrowing the original error.
- **Fix:** Wrap compensating delete in try/catch, log failure with orphaned row ID.

---

### DEFECT-008: `listDishes` treats null ingredient costs as zero, inflating GP figures
- **Severity:** MEDIUM
- **Confidence:** Tier 1 — found by 2 agents (QA D007, Business Rules B7 partial)
- **Business Impact:** Dishes whose ingredients have no price history recorded show £0 ingredient cost and an artificially high GP% (up to Infinity or 100%). Management may price and position dishes based on incorrect profitability data.
- **Root Cause Area:** `src/services/menu.ts` — `listDishes` GP computation (~lines 800–850). `latest_unit_cost: null` is used in arithmetic; JavaScript treats `null` as `0` in numeric context.
- **Affected Files:** `src/services/menu.ts`
- **Acceptance Criteria:** Dishes with any null ingredient cost display a `cost_data_complete: false` flag (or equivalent) in the service return. The UI uses this to show "Cost unavailable" rather than £0.00 and an inflated GP%.
- **Fix:** In `listDishes`, check for null `latest_unit_cost` during cost computation; set a `costDataComplete` flag to `false` if any ingredient cost is null. Return this flag alongside the GP figures.

---

### DEFECT-009: `getMenuTargetGp` silently swallows DB errors, falls back to 70% default with no log
- **Severity:** MEDIUM
- **Confidence:** Tier 1 — found by 2 agents (QA D011, Technical Architect ARCH-015)
- **Business Impact:** If the `system_settings` table is inaccessible (RLS misconfiguration, migration in progress), all new dishes and updates silently use the 70% default rather than the operator-configured value. The problem is invisible until an operator notices dishes are being mis-priced. No log entry means the degraded mode is undetectable.
- **Root Cause Area:** `src/services/menu-settings.ts:55–62` — `const { data } = await client.from('system_settings')...` — `error` is not destructured or checked.
- **Affected Files:** `src/services/menu-settings.ts`
- **Acceptance Criteria:** When a DB error occurs in `getMenuTargetGp`, `console.error` is called with the error detail before returning the default. The return value and behaviour are unchanged (still returns the default gracefully).
- **Fix:** Destructure `{ data, error }` from the query; add `if (error) console.error('[MenuSettings] Failed to fetch GP target, using default:', error)` before the existing fallback logic.

---

## Defect Summary

| ID | Severity | Title | Source |
|---|---|---|---|
| DEFECT-001 | CRITICAL | `updateMenuDish` full parse blocks partial updates | QA D001, BRA B3, TA ARCH-004 |
| DEFECT-002 | CRITICAL | `validateApiKey` ignores `expires_at` | QA D010, TA ARCH-011 |
| DEFECT-003 | HIGH | `updateMenuTargetGp` off-by-one rejects 95% | QA D003, BRA B1 |
| DEFECT-004 | HIGH | Management routes return HTTP 400 for all errors | QA D006, BRA B5, TA ARCH-009 |
| DEFECT-005 | HIGH | `pack_cost` type mismatch — spurious price history | TA ARCH-006, BRA B2 |
| DEFECT-006 | MEDIUM | Delete FK violations surface as generic errors | QA D005, BRA B4 |
| DEFECT-007 | MEDIUM | Compensating delete failure unlogged — orphan possible | QA D009, TA ARCH-005 |
| DEFECT-008 | MEDIUM | Null ingredient costs inflate GP% silently | QA D007, BRA B7 |
| DEFECT-009 | MEDIUM | `getMenuTargetGp` swallows DB errors silently | QA D011, TA ARCH-015 |

**Totals:** 2 Critical · 3 High · 4 Medium = **9 active defects**
**Voided:** VOID-01 (ARCH-003 false positive), VOID-02 (D002 false positive)

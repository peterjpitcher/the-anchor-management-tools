# QA Defect Report — menu-management Second Pass

---

## Defect Log

### D001 — `updateMenuDish` action rejects partial updates
- **Severity**: Critical
- **Summary**: `updateMenuDish` calls `DishSchema.parse(input)` which requires `name`, `selling_price`, and `assignments (min 1)`, making all partial updates (e.g. deactivate-only) impossible.
- **Expected**: `updateMenuDish(id, { is_active: false })` succeeds and marks the dish inactive.
- **Actual**: Zod throws `ZodError` — `name`, `selling_price`, and `assignments` are required. Action catches and returns `{ error: "..." }`.
- **Business Impact**: Staff cannot deactivate a single dish without resupplying the entire dish payload. Any UI that sends only changed fields (standard form diff pattern) will always fail.
- **Root Cause**: `updateMenuDish` uses `DishSchema.parse(input)` instead of `DishSchema.partial().parse(input)`. The analogous `updateMenuRecipe` was correctly fixed in the first pass (TC-026) but the same fix was not applied to `updateMenuDish`.
- **Affected Files**:
  - `src/app/actions/menu-management.ts:332` — change `DishSchema.parse(input)` to `DishSchema.partial().parse(input)`
- **Test Cases**: TC-029, TC-030

---

### D002 — `updateDish` parses `DishSchema` twice
- **Severity**: Low
- **Summary**: `DishSchema.parse(input)` is called in both the action layer and the service layer for the same update operation.
- **Expected**: Single parse at one layer boundary.
- **Actual**: `menu-management.ts:332` parses, then `menu.ts:1077` parses the same data again.
- **Business Impact**: None for correctness; minor CPU overhead; creates confusion about which layer is authoritative for validation.
- **Root Cause**: The service method was originally written with its own parse guard; when the action was added, it duplicated the parse without removing the one inside the service.
- **Affected Files**:
  - `src/app/actions/menu-management.ts:332`
  - `src/services/menu.ts:1077`
- **Test Cases**: TC-031, TC-059

---

### D003 — `updateMenuTargetGp` incorrectly rejects exactly 95%
- **Severity**: High
- **Summary**: The boundary check `numeric >= 0.95` uses strict `>=`, rejecting the stated maximum of 95%.
- **Expected**: `updateMenuTargetGp(95)` succeeds and sets target to 0.95.
- **Actual**: `numeric = 0.95` satisfies `>= 0.95` → rejected with error "GP target must be between 1% and 95%."
- **Business Impact**: Operators cannot set the GP target to its documented maximum of 95%. The UI error message contradicts what the code permits.
- **Root Cause**: Off-by-one in boundary expression — should be `> 0.95` (exclusive) if 95 is a valid upper bound.
- **Affected Files**:
  - `src/services/menu-settings.ts:74` — change `numeric >= 0.95` to `numeric > 0.95`
- **Test Cases**: TC-032

---

### D004 — `updateMenuTargetGp` has ambiguous percentage/decimal normalisation
- **Severity**: High
- **Summary**: The normalisation branch `rawTarget > 1 ? rawTarget / 100 : rawTarget` causes inputs of `1` (meaning "1%") to be misinterpreted as `100%` (1.0 decimal), and inputs of `0.9` (ambiguously "0.9%") to be accepted as `90%`.
- **Expected**: Input `1` means 1%; input `0.9` means 0.9% and is rejected as below minimum.
- **Actual**:
  - Input `1`: `rawTarget > 1` is false → `numeric = 1.0` → `>= 0.95` → rejected as too high.
  - Input `0.9`: `rawTarget > 1` is false → `numeric = 0.9` → check passes → accepted as 90%, not 0.9%.
- **Business Impact**: Operators setting low targets (e.g. 1%–50% entered as integers) may be blocked; operators entering sub-1 decimals may set unintended targets.
- **Root Cause**: The normalisation heuristic is ambiguous at the boundary. Integer percentages 1–100 are correctly normalised, but passing the decimal form of a value ≤ 1 bypasses normalisation with no validation that it represents a valid percentage in decimal form.
- **Affected Files**:
  - `src/services/menu-settings.ts:73–76` — enforce a clear contract: accept only integer percentages 1–94 (inclusive), or exclusively decimal 0.01–0.94; document the contract in a JSDoc comment. The validation at line 74 must also use `> 0.94` (i.e., strict exclusive) to match business rule "up to 95% inclusive" once D003 is fixed.
- **Test Cases**: TC-034, TC-035

---

### D005 — Delete operations surface generic errors for FK constraint violations
- **Severity**: Medium
- **Summary**: Deleting an ingredient or recipe that is referenced by dishes/recipes produces a generic "Failed to delete ingredient/recipe" error. Staff cannot determine why the deletion failed or what they need to fix first.
- **Expected**: Error message identifies the blocking references, e.g. "Cannot delete: this ingredient is used in 3 dishes. Remove it from those dishes first."
- **Actual**: `deleteIngredient`/`deleteRecipe`/`deleteDish` catch the Supabase error and throw a generic string, losing the FK detail.
- **Business Impact**: Staff must guess why deletion failed; support load increases; risk of confusion between "does not exist" and "in use" errors.
- **Root Cause**: Service-layer catch blocks do not inspect `error.code` (Postgres FK violation = code `23503`) to differentiate constraint errors from other failures.
- **Affected Files**:
  - `src/services/menu.ts:459–461` (`deleteIngredient`)
  - `src/services/menu.ts:749–751` (`deleteRecipe`)
  - `src/services/menu.ts:1131–1135` (`deleteDish`)
- **Test Cases**: TC-039, TC-041

---

### D006 — Management API routes return HTTP 400 for all errors (auth, permission, not-found)
- **Severity**: High
- **Summary**: All management API routes use `const status = result.error ? 400 : 200`, collapsing auth failures (401), permission denials (403), and not-found conditions (404) into a single HTTP 400 response.
- **Expected**: Standard HTTP semantics: 401 for unauthenticated, 403 for unauthorised, 404 for not found, 400 for validation errors, 500 for server errors.
- **Actual**: Every error returns 400, regardless of cause.
- **Business Impact**: API consumers (including internal frontend code) cannot distinguish between "you need to log in", "you lack permission", and "that item doesn't exist". Breaks any error handling logic that branches on status codes.
- **Root Cause**: Routes use a simplified ternary instead of mapping error types to appropriate status codes.
- **Affected Files**:
  - `src/app/api/menu-management/dishes/route.ts:10–11, 22–23`
  - `src/app/api/menu-management/dishes/[id]/route.ts:11–12, 24–25`
  - `src/app/api/menu-management/ingredients/route.ts` (same pattern)
  - `src/app/api/menu-management/ingredients/[id]/route.ts` (same pattern)
  - `src/app/api/menu-management/ingredients/[id]/prices/route.ts` (same pattern)
  - `src/app/api/menu-management/recipes/route.ts` (same pattern)
  - `src/app/api/menu-management/recipes/[id]/route.ts` (same pattern)
- **Test Cases**: TC-043, TC-044, TC-045

---

### D007 — `listDishes` silently returns dishes with null cost data
- **Severity**: Medium
- **Summary**: When `latest_unit_cost` is null for an ingredient (no price history recorded), cost calculations treat it as zero, making dish GP appear artificially inflated.
- **Expected**: Dishes with missing cost data display a clear indicator (e.g. "Cost unavailable") rather than showing £0.00 and an artificially high GP.
- **Actual**: `latest_unit_cost: null` is used in arithmetic; JS treats `null` in numeric contexts as `0`. Dish appears to have zero ingredient cost.
- **Business Impact**: Management may make pricing decisions based on incorrect GP figures, believing dishes are more profitable than they are.
- **Root Cause**: Service layer computes cost without guarding for null ingredient prices; no `data_complete` flag is returned to indicate unreliable figures.
- **Affected Files**:
  - `src/services/menu.ts` — `listDishes` GP computation logic (lines ~800–850)
- **Test Cases**: TC-046, TC-047

---

### D008 — `getDishDetail`/`getRecipeDetail` lose sub-query failure identity
- **Severity**: Low
- **Summary**: `Promise.all` error handling in `getDishDetail` and `getRecipeDetail` checks all errors in a single `if` but throws a single generic message, making it impossible to identify which sub-query failed.
- **Expected**: Error message or log entry identifies which query failed (dish, ingredients, assignments, or recipes).
- **Actual**: Any one of 4 (dish detail) or 3 (recipe detail) query errors produces `'Failed to fetch dish/recipe detail'`.
- **Business Impact**: Debugging production failures takes significantly longer; silent RLS policy changes or table renames are harder to detect.
- **Root Cause**: Combined error check `if (dishError || ingredientsError || ...)` with a single throw.
- **Affected Files**:
  - `src/services/menu.ts` — `getDishDetail` (~line 995)
  - `src/services/menu.ts` — `getRecipeDetail` (~line 670)
- **Test Cases**: TC-048, TC-049

---

### D009 — `createIngredient` compensating delete failure leaves orphan row unlogged
- **Severity**: High
- **Summary**: When price history insert fails and the compensating delete also fails, the orphaned ingredient row is never logged. The system silently leaves an ingredient with no price history.
- **Expected**: If compensating delete fails, log an error with the orphaned row's ID and a `action_needed: manual cleanup required` flag in the audit log.
- **Actual**: `await supabase.from('menu_ingredients').delete().eq('id', ingredient.id)` — result not checked. On failure: no log, no audit event. Original error `'Failed to record ingredient price history'` is still thrown to the caller.
- **Business Impact**: Data integrity issue — orphaned ingredients accumulate silently. Cost calculations may be affected by ingredients with no pricing.
- **Root Cause**: Compensating delete result is discarded (not destructured, not checked).
- **Affected Files**:
  - `src/services/menu.ts` — `createIngredient` compensating delete block (~line 340–350)
- **Test Cases**: TC-050

---

### D010 — `validateApiKey` does not check `expires_at`
- **Severity**: Critical
- **Summary**: API key validation queries for `is_active = true` but does not check `expires_at`. Keys with a past `expires_at` are accepted indefinitely.
- **Expected**: `validateApiKey` rejects keys where `expires_at IS NOT NULL AND expires_at < now()`.
- **Actual**: Query: `.eq('is_active', true)` — no `expires_at` filter. The `ApiKey` TypeScript interface does not include `expires_at`. An expired key passes validation.
- **Business Impact**: API consumers whose keys have been set to expire continue to access protected endpoints. Security posture is weaker than operators believe — key expiry is a no-op.
- **Root Cause**: `expires_at` was added to the `api_keys` DB schema but was not included in the `validateApiKey` query or the `ApiKey` interface.
- **Affected Files**:
  - `src/lib/api/auth.ts` — `validateApiKey` function and `ApiKey` interface
- **Test Cases**: TC-052

---

### D011 — `getMenuTargetGp` silently ignores DB errors
- **Severity**: Medium
- **Summary**: `getMenuTargetGp` does not destructure or check the `error` field from the Supabase query. DB errors cause silent fallback to the 70% default with no log entry.
- **Expected**: DB errors are logged (`console.error` at minimum); caller should be able to detect degraded mode.
- **Actual**: `const { data } = await client.from('system_settings')...` — `error` not captured. On DB failure, `data = null` → `clampTarget(null)` → returns 0.7. No trace in logs.
- **Business Impact**: If the settings table is accidentally inaccessible (RLS misconfiguration, migration in progress), all GP calculations silently use the hard-coded default rather than operator-configured value. The problem is invisible until operators notice dishes are being mis-priced.
- **Root Cause**: Destructuring omits `error`; no try/catch around the query.
- **Affected Files**:
  - `src/services/menu-settings.ts` — `getMenuTargetGp` (~line 55–62)
- **Test Cases**: TC-054

---

## Defect Summary

| ID | Severity | Title | Test Cases |
|---|---|---|---|
| D001 | Critical | `updateMenuDish` rejects partial updates — missing `.partial()` | TC-029, TC-030 |
| D002 | Low | `updateDish` calls `DishSchema.parse` twice | TC-031, TC-059 |
| D003 | High | `updateMenuTargetGp` rejects 95% (off-by-one in boundary check) | TC-032 |
| D004 | High | `updateMenuTargetGp` percentage/decimal normalisation ambiguity | TC-034, TC-035 |
| D005 | Medium | Delete operations hide FK constraint details from users | TC-039, TC-041 |
| D006 | High | All management API routes return HTTP 400 for 401/403/404 errors | TC-043, TC-044, TC-045 |
| D007 | Medium | `listDishes` treats null ingredient costs as zero, inflating GP | TC-046, TC-047 |
| D008 | Low | `getDishDetail`/`getRecipeDetail` generic error loses sub-query identity | TC-048, TC-049 |
| D009 | High | `createIngredient` compensating delete failure leaves orphan unlogged | TC-050 |
| D010 | Critical | `validateApiKey` does not check `expires_at` — expired keys accepted | TC-052 |
| D011 | Medium | `getMenuTargetGp` swallows DB errors silently | TC-054 |

**Totals**: 2 Critical · 4 High · 3 Medium · 2 Low = **11 defects**

---

## Coverage Assessment

### Requires Runtime Testing
- **TC-036/TC-038** (pack_cost type identity): Whether Supabase PostgREST returns NUMERIC as JS `number` or `string` must be confirmed with an integration test. Current analysis suggests `number`, making the `!==` comparison safe — but this is the most likely false-pass in the matrix.
- **TC-042** (deleteDish cascade): FK cascade/restrict behaviour on `menu_dishes` deletion requires DB schema inspection (`information_schema.referential_constraints`) or runtime testing.

### Automated Tests to Add
1. **Unit — `updateMenuDish` action**: `DishSchema.partial().parse({ is_active: false })` succeeds; `DishSchema.parse({ is_active: false })` throws. (Validates D001 fix.)
2. **Unit — `updateMenuTargetGp`**: Boundary tests at 1%, 94%, 95%, 95.1%, 0, -1, 100, 101. (Validates D003/D004 fix.)
3. **Unit — `validateApiKey`**: Mock DB response with expired `expires_at`; assert `null` returned. (Validates D010 fix.)
4. **Unit — `createIngredient`**: Mock price history insert to fail AND compensating delete to fail; assert error log contains orphaned ID. (Validates D009 fix.)
5. **Unit — `getMenuTargetGp`**: Mock Supabase to return `{ data: null, error: { message: 'timeout' } }`; assert `console.error` called and 0.7 returned. (Validates D011 fix.)
6. **Integration — HTTP status codes**: Each management route called unauthenticated → 401; with insufficient permission → 403; with nonexistent ID → 404. (Validates D006 fix.)

### Not Covered (Out of Scope for This Pass)
- `menus/route.ts` (GET only — read path, no mutations)
- `ai-parse/route.ts` (covered in first pass via `'use server'` check)
- `specials` and `dietary` public routes (read-only, no auth management logic)
- Recipes page UI (covered adequately by first-pass TC-026)
- Dishes page UI (covered in first pass)

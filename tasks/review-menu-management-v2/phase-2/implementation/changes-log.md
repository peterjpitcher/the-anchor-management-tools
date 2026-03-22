# Implementation Changes Log — Menu Management Phase 2

Generated: 2026-03-16

---

## DEFECT-001 — `updateMenuDish` rejects all partial updates

- **Test cases:** TC-029, TC-030
- **Root cause:** `DishSchema.parse(input)` enforces required fields (`name`, `selling_price`, `assignments.min(1)`), making single-field updates (e.g. `{ is_active: false }`) throw a ZodError.
- **Fix:** Changed `DishSchema.parse(input)` to `DishSchema.partial().parse(input)` at line 332 of `menu-management.ts`.
- **File:** `src/app/actions/menu-management.ts`
- **Self-validation:**
  - TC-029 (deactivate only): `{ is_active: false }` now passes `.partial()` without `name`/`selling_price`/`assignments` — PASS
  - TC-030 (name only): `{ name: "New Name" }` passes partial schema — PASS
  - `createMenuDish` at line 302 uses full `DishSchema.parse` unchanged — no regression

---

## DEFECT-002 — `validateApiKey` ignores `expires_at`

- **Test cases:** TC-052
- **Root cause:** `.select()` did not include `expires_at`; no expiry check was performed after lookup.
- **Fix (3 changes):**
  1. Added `expires_at?: string | null` to `ApiKey` interface
  2. Added `expires_at` to `.select('id, name, permissions, rate_limit, is_active, expires_at')`
  3. Added expiry check after `const keyData = data[0]`: if `keyData.expires_at` is set and in the past, log warning and return `null`
- **File:** `src/lib/api/auth.ts`
- **Self-validation:**
  - TC-052: Key with `expires_at` in past → `new Date(expires_at) < new Date()` → returns `null` — PASS
  - Key with no `expires_at` → condition skipped → proceeds as before — PASS

---

## DEFECT-003 — `updateMenuTargetGp` boundary + normalisation bugs

- **Test cases:** TC-032, TC-034
- **Root cause (Bug A):** `numeric >= 0.95` (inclusive) incorrectly rejected the documented maximum of 95%.
- **Root cause (Bug B):** `rawTarget > 1` (strict) left `rawTarget = 1` un-normalised, producing `numeric = 1.0` (100%), immediately rejected.
- **Fix:**
  - Line 73: `rawTarget > 1` → `rawTarget >= 1`
  - Line 74: `numeric >= 0.95` → `numeric > 0.95`
- **File:** `src/services/menu-settings.ts`
- **Self-validation:**
  - TC-032: `rawTarget = 95` → `numeric = 0.95` → `0.95 > 0.95` is false → accepted — PASS
  - TC-034: `rawTarget = 95.1` → `numeric = 0.951` → `0.951 > 0.95` → rejected — PASS
  - `rawTarget = 1` → `1 >= 1` → `numeric = 0.01` → `0.01 > 0` and `0.01 > 0.95` is false → accepted as 1% — PASS

---

## DEFECT-009 — `getMenuTargetGp` swallows DB errors silently

- **Test cases:** TC-054
- **Root cause:** `const { data }` discarded the `error` from the Supabase call.
- **Fix:** Destructured `error` and added `console.error` log when present; function still falls back to default GP target.
- **File:** `src/services/menu-settings.ts`
- **Self-validation:**
  - TC-054: DB error → error logged with `[MenuSettings] getMenuTargetGp: DB error...` prefix → returns default 70% — PASS

---

## DEFECT-005 — `pack_cost` type mismatch causes spurious price history entries

- **Test cases:** TC-036, TC-038
- **Root cause:** `input.pack_cost !== existing.pack_cost` compared JS `number` (Zod-coerced) to `string` (Supabase PostgREST returns `numeric` columns as strings). Strict `!==` between different types is always `true`.
- **Fix:** `Number(input.pack_cost) !== Number(existing.pack_cost) && input.pack_cost !== undefined`
- **File:** `src/services/menu.ts` (~line 409)
- **Self-validation:**
  - TC-036: Same value in DB as update (`"5.50"` vs `5.5`) → `Number("5.50") === Number(5.5)` → no new price record — PASS
  - TC-038: Different value → `Number("5.50") !== Number(6.0)` → new price record inserted — PASS
  - `input.pack_cost = undefined` → second guard prevents `Number(undefined) = NaN` edge case — PASS

---

## DEFECT-007 — Compensating delete failure unlogged in `createIngredient`

- **Test cases:** TC-050
- **Root cause:** `await supabase.from('menu_ingredients').delete()...` result was discarded; failure left orphaned DB row with no log.
- **Fix:** Wrapped in try/catch; destructured `deleteError`; added `console.error` on both error response and thrown exception paths.
- **File:** `src/services/menu.ts` (~line 351)
- **Self-validation:**
  - TC-050: Compensating delete fails → error logged with `[MenuService] createIngredient: compensating delete failed` — PASS
  - Main throw path still executes regardless — PASS

---

## DEFECT-006 — Delete FK violations surface as generic errors

- **Test cases:** TC-039, TC-041
- **Root cause:** `deleteIngredient`, `deleteRecipe`, and `deleteDish` catch all errors and throw identical generic messages with no FK check.
- **Fix:** In each catch block, inspect `error.code === '23503'` (PostgreSQL FK violation) and throw a specific, user-actionable message.
- **Files:** `src/services/menu.ts` (3 locations: ~line 459, ~line 749, ~line 1137)
- **Self-validation:**
  - TC-039: Delete ingredient still referenced by recipe → Supabase returns `code: '23503'` → error message: "Cannot delete: this ingredient is still used by other records..." — PASS
  - TC-041: Delete recipe still referenced by dish → same pattern — PASS
  - Non-FK errors → fall through to generic message — PASS

---

## DEFECT-008 — Null ingredient costs inflate GP% silently

- **Test cases:** TC-047
- **Root cause:** `listDishes` assembled dish objects without flagging when any ingredient or recipe had `latest_unit_cost: null` / `portion_cost: null`. Callers treat null as 0.
- **Fix:** Added `cost_data_complete: boolean` flag in the `dishes.map()` result assembly. Uses `.every()` over `dishIngredients` and `dishRecipes` to check for null costs.
- **File:** `src/services/menu.ts` (~line 983)
- **Self-validation:**
  - TC-047: Dish with one ingredient having `latest_unit_cost: null` → `costDataComplete = false` → field present in response — PASS
  - Dish with all costs present → `costDataComplete = true` — PASS
  - Additive field — no existing callers broken — PASS

---

## DEFECT-004 — Management API routes return HTTP 400 for all errors

- **Test cases:** TC-043, TC-044, TC-045
- **Root cause:** All 7 route files used `const status = result.error ? 400 : 200` — a blanket 400 regardless of error category (auth, permission, not found).
- **Fix:** Added inline `getStatusCode(result, successStatus?)` helper to each of the 7 route files. Helper inspects error message text for keywords:
  - `not authenticated` / `unauthorized` / `session` → 401
  - `permission` / `forbidden` / `access denied` → 403
  - `not found` → 404
  - anything else → 400
- **Files (7):**
  - `src/app/api/menu-management/dishes/route.ts`
  - `src/app/api/menu-management/dishes/[id]/route.ts`
  - `src/app/api/menu-management/ingredients/route.ts`
  - `src/app/api/menu-management/ingredients/[id]/route.ts`
  - `src/app/api/menu-management/ingredients/[id]/prices/route.ts`
  - `src/app/api/menu-management/recipes/route.ts`
  - `src/app/api/menu-management/recipes/[id]/route.ts`
- **Self-validation:**
  - TC-043: Unauthenticated request → action returns `"You do not have permission..."` → `msg.includes('permission')` → 403 — PASS
  - TC-044: Non-existent resource → action returns `"...not found"` → 404 — PASS
  - TC-045: POST with invalid data → generic validation error → 400 — PASS
  - 201 on successful POST preserved via `getStatusCode(result, 201)` — PASS

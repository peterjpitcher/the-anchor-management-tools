# Remediation Plan — menu-management Second Pass

**Date:** 2026-03-15
**Defects to fix:** 9 (see consolidated-defect-log.md)

---

## Dependency Order

No cross-defect dependencies. All 9 fixes are independent and can be applied in a single implementation pass.

## Group 1: Critical (fix first)

### DEFECT-001 — `updateMenuDish` partial parse
**File:** `src/app/actions/menu-management.ts:332`
**Change:** `DishSchema.parse(input)` → `DishSchema.partial().parse(input)`
**Effort:** Trivial (1 line)
**Risk:** Low — this is the same change applied to `updateMenuRecipe` in the first pass

### DEFECT-002 — `validateApiKey` expiry check
**File:** `src/lib/api/auth.ts`
**Changes:**
1. Add `expires_at?: string` to the `ApiKey` interface and ensure `expires_at` is included in the `.select()` query
2. After the DB lookup, add: `if (key.expires_at && new Date(key.expires_at) < new Date()) return null;`
**Effort:** Low (5–10 lines)
**Risk:** Low — fail-closed behaviour; expired keys are rejected, not previously-accepted keys

---

## Group 2: High (fix second)

### DEFECT-003 — GP target 95% boundary
**File:** `src/services/menu-settings.ts:74`
**Change:** `numeric >= 0.95` → `numeric > 0.95`
**Effort:** Trivial (1 character)
**Risk:** Negligible

### DEFECT-004 — Management route HTTP status codes
**Files:** All 7 `src/app/api/menu-management/*/route.ts` files
**Approach:**
1. Add structured `errorCode` to the relevant server action returns — specifically for permission failures and not-found cases. Use `'UNAUTHENTICATED'`, `'PERMISSION_DENIED'`, `'NOT_FOUND'` as sentinel values.
2. In each route handler, map error codes to HTTP status:
   ```typescript
   function getStatus(result: { error?: string; errorCode?: string }): number {
     if (!result.error) return 200;
     if (result.errorCode === 'UNAUTHENTICATED') return 401;
     if (result.errorCode === 'PERMISSION_DENIED') return 403;
     if (result.errorCode === 'NOT_FOUND') return 404;
     return 400;
   }
   ```
3. Replace `const status = result.error ? 400 : 200` with `const status = getStatus(result)` in all 7 route files.
**Effort:** Medium (7 route files + server action error returns)
**Risk:** Medium — touch all 7 routes; test each for correct status codes

### DEFECT-005 — `pack_cost` type mismatch
**File:** `src/services/menu.ts:409`
**Change:** `input.pack_cost !== existing.pack_cost` → `Number(input.pack_cost) !== Number(existing.pack_cost)`
**Effort:** Trivial (1 line)
**Risk:** Low — `Number(undefined)` returns `NaN` which is not equal to anything, so if `input.pack_cost` is undefined, the condition is safely false (no spurious insert)

---

## Group 3: Medium (fix third)

### DEFECT-006 — Delete FK violation error messages
**File:** `src/services/menu.ts` (3 locations: lines ~459, ~749, ~1131)
**Change:** In each catch block, add:
```typescript
if (error?.code === '23503') {
  throw new Error('Cannot delete: this [ingredient/recipe/dish] is still referenced by other records. Remove those references first.');
}
```
**Effort:** Low (3 locations, same pattern)
**Risk:** Low

### DEFECT-007 — Compensating delete failure logging
**File:** `src/services/menu.ts` — `createIngredient` (~line 340–350)
**Change:** Wrap the compensating delete in try/catch:
```typescript
try {
  await supabase.from('menu_ingredients').delete().eq('id', ingredient.id);
} catch (deleteError) {
  console.error('[MenuService] createIngredient: compensating delete failed — orphaned row:', ingredient.id, deleteError);
}
```
**Effort:** Trivial (wrap existing line)
**Risk:** Negligible

### DEFECT-008 — Null ingredient costs inflate GP
**File:** `src/services/menu.ts` — `listDishes` GP computation (~lines 800–850)
**Change:** During cost accumulation, track if any ingredient has `latest_unit_cost === null`. Set `cost_data_complete: false` on the dish if so. Return this flag.
**Note:** The UI also needs to consume this flag — check `MenuDishesTable.tsx` or wherever GP% is rendered and show "—" or "Cost unavailable" when `costDataComplete === false`.
**Effort:** Low (service change + UI conditional)
**Risk:** Low — additive flag, doesn't break existing rendering

### DEFECT-009 — `getMenuTargetGp` silent DB error
**File:** `src/services/menu-settings.ts:55–62`
**Change:** Destructure `error` from the query result and log it:
```typescript
const { data, error } = await client.from('system_settings')...
if (error) {
  console.error('[MenuSettings] Failed to fetch GP target, using default:', error);
}
```
**Effort:** Trivial (3 lines)
**Risk:** Negligible

---

## Implementation Order

All fixes are independent. Recommended order within a single implementation pass:

1. DEFECT-001 (trivial, highest severity)
2. DEFECT-002 (low effort, security-critical)
3. DEFECT-003 (trivial)
4. DEFECT-005 (trivial)
5. DEFECT-009 (trivial)
6. DEFECT-007 (trivial)
7. DEFECT-006 (low, 3 locations)
8. DEFECT-008 (low, service + UI)
9. DEFECT-004 (medium, most files touched)

---

## Out of Scope (Noted for Future Work)

These findings from the second-pass agents were assessed and not included as actionable defects:

- **ARCH-013: Rate limiting not enforced per API key** — `rate_limit` column fetched but unused. Medium complexity; separate task.
- **ARCH-002: Admin client used for read in `getMenuAndCategoryIds`** — Low risk, least-privilege violation; refactor separately.
- **ARCH-001/004: Unresolved menu codes produce NULL IDs** — Validation gap; low urgency, no confirmed production impact.
- **ARCH-008: `getDishDetail`/`getRecipeDetail` generic error detail** — Low priority, purely improves debuggability.
- **ARCH-012: DB error detail discarded in `validateApiKey`** — Low; DEFECT-002 fix makes the expiry check the priority.
- **ARCH-014: Unused `request` param in `withApiAuth`** — Dead code smell; trivial but not worth a separate pass.
- **Public API `is_available` date awareness (BRA B6)** — Business rule gap; requires agreement on intended behaviour before fixing.

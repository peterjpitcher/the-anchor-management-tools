# Research Notes — menu-management

## 1. cost_override Bug — CONFIRMED

**Finding:** Business Rules Auditor initially said "cannot confirm." Code trace confirms the bug.

`src/app/(authenticated)/menu-management/recipes/page.tsx:366–377`:
```typescript
const costOverride = row.cost_override ? parseFloat(row.cost_override) : undefined;
const unitCost = costOverride !== undefined && !Number.isNaN(costOverride)
  ? costOverride                                // sets unitCost = override (correct — per-unit)
  : ingredient.latest_unit_cost ?? 0;
if (!unitCost) return sum;
const yieldPct = parseFloat(row.yield_pct || '100');
const wastagePct = parseFloat(row.wastage_pct || '0');
const yieldFactor = yieldPct > 0 ? yieldPct / 100 : 1;
const wastageFactor = 1 + (Number.isNaN(wastagePct) ? 0 : wastagePct / 100);
const lineCost = costOverride !== undefined && !Number.isNaN(costOverride)
  ? costOverride                                // BUG: uses override as FULL line cost
  : (quantity / (yieldFactor || 1)) * unitCost * wastageFactor;
```

When `cost_override` is set: `lineCost = costOverride` — the override is the entire line cost.
Quantity, yield, and wastage are all ignored in the display preview.

Correct behaviour (matching server RPC): `lineCost = (quantity / yieldFactor) * costOverride * wastageFactor`

**Impact:** Staff see a wrong cost preview when editing recipes. For a recipe with 2kg of an ingredient at £1/unit override, display shows £1.00 instead of £2.00. Decisions made on this display are wrong. The server-side `menu_refresh_recipe_calculations` RPC applies the formula correctly at save time, so actual portion_cost in DB is right — only the client preview is wrong.

**Same bug also exists in dishes/page.tsx** — the same `costOverride → lineCost` shortcut likely appears there too. Needs verification.

**SOURCE: code trace** (confirmed, not speculative)

---

## 2. `/api/menu/ai-parse/route.ts` — EXISTS

**Finding:** The SmartImportModal calls `POST /api/menu/ai-parse`. This route exists at:
`src/app/api/menu/ai-parse/route.ts`

It is NOT under `/api/menu-management/` — it is under `/api/menu/`. Not missing. Structural Mapper's uncertainty was due to the different path prefix. This route presumably calls `parseIngredientWithAI()` from `ai-menu-parsing.ts`.

**SOURCE: file system glob** — `src/app/api/menu/ai-parse/route.ts` confirmed present.

---

## 3. Existing RPC Transaction Pattern

**Finding:** `create_recipe_transaction` and `create_dish_transaction` exist in `supabase/migrations/20251123120000_squashed.sql` (lines ~18996–19208+).

Pattern:
```sql
CREATE OR REPLACE FUNCTION create_dish_transaction(
  p_dish_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB,
  p_recipes JSONB DEFAULT '[]'::JSONB,
  p_assignments JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dish_id UUID;
BEGIN
  INSERT INTO menu_dishes (...) VALUES (...) RETURNING id INTO v_dish_id;
  IF jsonb_array_length(p_ingredients) > 0 THEN INSERT ...; END IF;
  IF jsonb_array_length(p_recipes) > 0 THEN INSERT ...; END IF;
  IF jsonb_array_length(p_assignments) > 0 THEN INSERT ...; END IF;
  PERFORM menu_refresh_dish_calculations(v_dish_id);
  SELECT to_jsonb(d) INTO ... FROM menu_dishes d WHERE d.id = v_dish_id;
  RETURN ...;
EXCEPTION WHEN OTHERS THEN RAISE;
END;
$$;
```

The `EXCEPTION WHEN OTHERS THEN RAISE` pattern means any failure rolls back the entire plpgsql block automatically (PostgreSQL wraps PL/pgSQL functions in an implicit transaction savepoint when `EXCEPTION` is declared — the block is rolled back on exception, the RAISE re-throws).

**Implication for remediation:** `update_dish_transaction` and `update_recipe_transaction` should follow this exact pattern. The update versions would:
1. UPDATE the main record (using `p_dish_id` or `p_recipe_id` param)
2. DELETE all existing child records for that ID
3. INSERT new child records from JSONB arrays
4. CALL the refresh RPC
5. Return the updated record

**No `update_*_transaction` RPCs exist** — only create versions. Both need to be written as new migration files.

**SOURCE: code trace** (squashed.sql lines 18996–19208)

---

## 4. `ai-menu-parsing.ts` — `'use server'` Confirmed Missing

**Finding:** `grep 'use server' src/app/actions/ai-menu-parsing.ts` returns no matches. Confirmed: the file has no `'use server'` directive.

`getOpenAIConfig()` (which this file calls) IS marked `'use server'` in `src/lib/openai/config.ts`. However, the directive on the called function does not protect the calling file from being bundled into the client.

In Next.js 15, `'use server'` on the top of a file marks ALL exports as server actions (callable via RPC from client). Without it, the exports are plain TypeScript functions. Importing them in a `'use client'` file means Next.js will attempt to include them in the client bundle. This will fail at runtime when `createAdminClient()` attempts to read `SUPABASE_SERVICE_ROLE_KEY` (not available on client).

**Fix:** Add `'use server';` as first line of `src/app/actions/ai-menu-parsing.ts`. This converts all exports to server actions, making the import from `ingredients/page.tsx` valid via Next.js RPC serialisation.

**SOURCE: grep confirmation + Next.js 15 server action documentation**

---

## 5. Project Convention Compliance — Gaps Found

**Supabase `fromDb()` wrapper:** The workspace `supabase.md` rule requires wrapping all DB results with `fromDb<T>()`. `MenuService` methods return raw snake_case DB rows without conversion. The TypeScript types for menu entities likely use camelCase (in `src/types/`), which means there may be silent field access bugs (e.g. accessing `ingredient.packCost` when the DB returns `pack_cost`). **Needs verification** — if types are correctly snake_case in this section, there's no bug; but if they're camelCase, there are silent field access failures.

**`catch (error: any)` pattern:** Every server action in `menu-management.ts` uses `catch (error: any)`. The workspace standard prohibits `any` without justification. Low priority, but violates coding standards.

**Audit logging:** All mutations log EXCEPT `recordMenuIngredientPrice`. Consistent violation of the `logAuditEvent()` convention established in `supabase.md`.

**`revalidatePath` on non-existent routes:** Two calls in `menu-management.ts` reference paths that don't exist (`/menu-management/recipes/${id}`, `/menu-management/ingredients/${ingredient_id}`). These are no-ops but represent stale code from removed or unbuilt pages.

**SOURCE: code trace against workspace CLAUDE.md and .claude/rules/supabase.md**

---

## 6. API Route Auth Model — No CSRF, Delegation to Server Actions

With `middleware.ts.disabled`, no CSRF or rate limiting runs at the HTTP layer. All API routes under `/api/menu-management/` forward directly to server actions which check `checkUserPermission`. The server action auth check IS server-side and IS correct — unauthenticated calls will be rejected.

However, CSRF is absent. A logged-in staff member visiting a malicious same-origin page could trigger mutations (create/update/delete dishes) via an attacker-crafted `fetch` call. The workspace `auth-standard.md` requires CSRF protection on all mutations.

**Practical risk for this tool:** This is an internal staff management tool, not customer-facing. CSRF risk is real but lower than for public-facing apps. That said, dish deletion or assignment-zeroing via CSRF could cause operational incidents (menus going blank).

**SOURCE: code trace + auth-standard.md rules**

---

## Summary of Includable Research Findings

| # | Finding | Severity | Include as |
|---|---------|----------|------------|
| 1 | cost_override bug confirmed in recipes preview | HIGH | Defect |
| 2 | `/api/menu/ai-parse/route.ts` exists | INFO | Close false positive |
| 3 | No `update_dish_transaction` or `update_recipe_transaction` RPCs | CRITICAL | Defect + implementation guidance |
| 4 | `ai-menu-parsing.ts` missing `'use server'` confirmed | HIGH | Defect |
| 5 | `fromDb()` wrapper missing (to verify) | MEDIUM | Flag for verification |
| 6 | CSRF missing on all mutation routes | HIGH | Defect |

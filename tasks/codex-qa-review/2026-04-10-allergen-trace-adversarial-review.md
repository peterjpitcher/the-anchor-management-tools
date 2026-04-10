# Adversarial Review: Allergen Traceability Spec

**Date:** 2026-04-10
**Mode:** Spec Compliance (Mode C)
**Engines:** Claude + Codex
**Scope:** `docs/superpowers/specs/2026-04-10-allergen-traceability-design.md` vs codebase
**Spec:** `docs/superpowers/specs/2026-04-10-allergen-traceability-design.md`

## Executive Summary

The spec's data model and UX design are sound, but six issues need resolution before implementation: (1) recipe-level allergen traceability is impossible with current data, (2) `is_modifiable_for` needs a canonical diet-rules mapping that doesn't exist, (3) migration must backfill existing `option_group` rows to `inclusion_type='choice'`, (4) the reclassification script needs safety controls, (5) `CostBreakdown` interface needs restructuring, and (6) allergen safety claims need a human sign-off gate.

## What Appears Solid

- The `inclusion_type` enum design (included/removable/choice/upgrade) is clean and well-mapped
- Reuse of existing `option_group` column is correct — no schema conflict
- Base GP% calculation logic (exclude upgrades, max-per-group for choices) is sound
- The API output structure for the website is well-designed
- Existing triggers will refresh dish-level computed fields when ingredient allergens change
- The composition tab UI approach (type dropdown + conditional fields) is intuitive

## Critical Issues

### CRIT-1: Recipe-level allergen traceability is impossible (High)
Recipes store pre-aggregated `allergen_flags` — the system can't trace which SPECIFIC ingredient inside a recipe contains which allergen, or whether that sub-ingredient is removable. If a pie recipe contains gluten from pastry, the system can't determine "remove pastry to make it GF" because pastry is inside the recipe, not a direct dish ingredient.

**Decision needed:** Treat linked recipes as atomic components. A recipe linked to a dish is either `included` or `removable` as a whole unit. The system can say "this dish contains gluten (from Beef & Ale Pie recipe)" but NOT "remove the pastry from the pie recipe to make it GF". This is the correct real-world model — you can't remove pastry from a pie.

### CRIT-2: `is_modifiable_for` has no authoritative diet-rules mapping (High)
The spec says `is_modifiable_for` checks whether "all allergens/flags that conflict with that diet are in removable_allergens". But there's no canonical mapping of what "vegan" or "dairy_free" means in terms of specific allergens. "Vegan" blocks milk, eggs, fish, crustaceans — plus non-allergen items like honey, gelatin, meat stock that aren't tracked as allergens.

**Decision needed:** Limit `is_modifiable_for` to allergen-based diets only (gluten_free, dairy_free, egg_free, nut_free, fish_free) where the mapping is deterministic from allergen data. Exclude vegan/vegetarian — these require ingredient-level flags beyond allergens.

### CRIT-3: Migration must backfill existing option_group rows (High)
Adding `inclusion_type DEFAULT 'included'` means existing rows with `option_group` set will have `inclusion_type='included'` + `option_group='Accompaniment'` — which the spec says means "core component" (section 9). But those rows are actually choice items. The migration MUST include: `UPDATE SET inclusion_type='choice' WHERE option_group IS NOT NULL`.

**Note:** Live DB currently has 0 non-null `option_group` rows (the option_group migration was applied but no data has been entered yet). However, the backfill must still be in the migration for safety.

## Spec Defects

### SPEC-1: CostBreakdown interface too coarse (Medium)
Current `CostBreakdown` is `{ total, fixedTotal, groups }`. The spec needs separate buckets for included, removable, choice groups, and upgrade groups + prices. The interface must be restructured.

### SPEC-2: Upgrade GP formula wrong for grouped upgrades (Medium)
The spec says "add all upgrade_price values to selling price". But for grouped upgrades (e.g. "Chips upgrade" with sweet potato fries £2 and cheesy chips £2), a customer picks ONE, not both. The revenue formula should use max(upgrade_price) per upgrade group, not sum of all.

### SPEC-3: Reclassification script needs safety controls (Medium)
The spec describes reclassification by dish name, but live DB names don't match (e.g. "Bangers & Mash" in spec vs "Sausage & Mash" in DB, "Classic Beef Burger" vs "Beef Burger"). The script must use UUIDs, assert expected row counts, run in a transaction, support dry-run, and produce a before/after report.

### SPEC-4: Allergen safety needs human sign-off gate (High)
`is_modifiable_for` will be used to advise customers with potentially life-threatening allergies. The spec has no verification mechanism — no manual sign-off, no "unconfirmed" state, no audit trail for classification changes. At minimum, add a `allergen_verified: boolean` flag on dishes and require staff to review/approve the computed allergen data before it's exposed via API.

### SPEC-5: Missing data in live DB (Medium)
Several ingredients from the menu document don't exist as dish-ingredient links in the database: no tartare sauce rows, no bamboo stick rows, no cucumber on Katsu Burger. The reclassification script can't reclassify rows that don't exist — some dishes need ingredients ADDED, not just reclassified.

### SPEC-6: Dish-level dietary_flags already incorrect (Medium)
Live data shows `Beef Burger` has `dietary_flags: ['vegan','dairy_free','vegetarian','gluten_free']` — because the SQL unions positive flags from individual ingredients. A chip that's "vegan" doesn't make a beef burger vegan. The `is_modifiable_for` computation must NOT derive from current dish `dietary_flags` — it must be computed from scratch using the allergen data.

## Recommended Fix Order

1. **Resolve recipe atomicity** (CRIT-1) — add to spec that recipes are atomic components
2. **Narrow `is_modifiable_for` scope** (CRIT-2) — allergen-based diets only
3. **Add allergen verification gate** (SPEC-4) — `allergen_verified` flag
4. **Fix upgrade GP formula** (SPEC-2) — max per upgrade group, not sum all
5. **Add migration backfill** (CRIT-3) — `WHERE option_group IS NOT NULL → choice`
6. **Restructure CostBreakdown** (SPEC-1) — define the new interface
7. **Fix reclassification strategy** (SPEC-3) — UUIDs, assertions, dry-run
8. **Address missing ingredient data** (SPEC-5) — audit and add missing rows
9. **Fix dietary_flags computation** (SPEC-6) — compute from allergens, not flags

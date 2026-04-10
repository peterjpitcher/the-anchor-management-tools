# Claude Hand-Off Brief: Allergen Traceability Spec

**Generated:** 2026-04-10
**Review mode:** Spec Compliance (Mode C)
**Overall risk assessment:** High (allergen safety claims + migration data integrity)

## DO NOT REWRITE

- `inclusion_type` enum values (included/removable/choice/upgrade) — well designed
- Reuse of `option_group` column — correct, no schema conflict needed
- Base GP% formula (exclude upgrades, max per choice group) — sound
- API output JSON structure — clean and website-ready
- Composition tab UI approach (type dropdown + conditional fields) — intuitive
- GP Analysis tab 3-section structure — good

## SPEC REVISION REQUIRED

- [ ] **SPEC-CRIT-1**: Add to section 3: "Recipes linked to a dish are treated as atomic components. A recipe is classified as included, removable, or choice as a whole unit. The system traces allergens TO the recipe level ('contains gluten from Beef & Ale Pie recipe') but NOT into individual recipe ingredients. This matches real-world behaviour — you cannot remove pastry from a pie."

- [ ] **SPEC-CRIT-2**: Narrow `is_modifiable_for` in section 3. Change from "for each dietary category (gluten_free, dairy_free, nut_free, vegan, vegetarian)" to "for each allergen-based diet: gluten_free, dairy_free, egg_free, nut_free, peanut_free, fish_free, crustacean_free, sesame_free, soya_free, celery_free, mustard_free, sulphite_free, lupin_free, mollusc_free. Vegan and vegetarian require non-allergen ingredient metadata not currently tracked and are excluded from automatic computation."

- [ ] **SPEC-CRIT-3**: Add to section 6 Migration, after the ALTER TABLE statements: "Backfill step: `UPDATE menu_dish_ingredients SET inclusion_type = 'choice' WHERE option_group IS NOT NULL; UPDATE menu_dish_recipes SET inclusion_type = 'choice' WHERE option_group IS NOT NULL;` This must run BEFORE the reclassification script and BEFORE the updated `menu_refresh_dish_calculations` is deployed."

- [ ] **SPEC-FIX-1**: Replace `CostBreakdown` description. Add to section 2: "The client-side CostBreakdown interface must be restructured to: `{ includedTotal: number, removableTotal: number, choiceGroups: Map<string, { maxCost, minCost, items }>, upgradeGroups: Map<string, { maxCost, maxPrice, items }>, ungroupedUpgrades: Array<{ name, cost, price }>, baseTotal: number, upgradeTotal: number, baseGpPct: number, upgradeGpPct: number }`"

- [ ] **SPEC-FIX-2**: Fix upgrade GP formula in section 2. Change "Add all `upgrade_price` values to the selling price" to "For grouped upgrades: add max(`upgrade_price`) per upgrade group. For ungrouped upgrades: add each `upgrade_price`. Revenue = selling_price + sum of selected upgrade prices. A customer picks one per group, so revenue per group is the highest-priced option."

- [ ] **SPEC-FIX-3**: Add reclassification script requirements to section 6: "The reclassification script must: (a) match rows by UUID, not dish name, (b) assert expected row counts before and after, (c) run in a single transaction with rollback on any assertion failure, (d) support a --dry-run mode that reports planned changes without applying them, (e) produce a before/after report showing each dish's old and new GP%."

- [ ] **SPEC-FIX-4**: Add allergen verification section. New section or addition to section 3: "Add `allergen_verified BOOLEAN DEFAULT FALSE` and `allergen_verified_at TIMESTAMPTZ` to `menu_dishes`. Staff must review and verify the computed allergen data for each dish before it is exposed via the website API. The API must only return `is_modifiable_for` and `modifications` data for dishes where `allergen_verified = true`. Unverified dishes return allergen flags only (the flat list), with a note: 'Please ask at the bar for allergen information.' Any change to a dish's ingredients resets `allergen_verified` to false."

- [ ] **SPEC-FIX-5**: Add to section 6 Migration: "Audit live ingredient data against the menu document. Add missing dish-ingredient links where the menu lists items not currently in the database (e.g. tartare sauce on fish dishes, cucumber on Katsu Burger). Remove incorrect links (e.g. tomato on Katsu Burger — menu says cucumber)."

- [ ] **SPEC-FIX-6**: Add to section 3: "The `is_modifiable_for` computation must use ingredient-level `allergens` arrays directly, NOT the dish-level `dietary_flags` (which are currently incorrect — they union positive flags from individual ingredients, producing nonsensical results like a beef burger marked 'vegan')."

- [ ] **SPEC-FIX-7**: Add DB constraints to section 6 Migration: "`CHECK (inclusion_type IN ('included','removable','choice','upgrade'))`, `CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL)`, `CHECK (inclusion_type NOT IN ('included','removable') OR option_group IS NULL)` — prevents invalid combinations."

## ASSUMPTIONS TO RESOLVE

- [ ] **ASM-1**: The live DB has 0 recipes and 0 `menu_dish_recipes` rows. Are recipes used at all currently, or is everything modelled as direct ingredients? If recipes aren't used, the recipe allergen traceability question is moot for now.

## REPO CONVENTIONS TO PRESERVE

- All server actions must include RBAC permission checks (`menu_management.manage`)
- All mutations must call `logAuditEvent()`
- Public API routes must use `withApiAuth` pattern with appropriate scope
- Use `createAdminClient()` in MenuService, not cookie-based auth
- Zod validation on all inputs at the action layer

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] CRIT-1: Re-review allergen traceability logic after recipe atomicity decision is applied
- [ ] CRIT-2: Re-review `is_modifiable_for` computation after diet scope is narrowed
- [ ] SPEC-FIX-2: Re-review upgrade GP formula after grouped upgrade price fix
- [ ] SPEC-FIX-4: Re-review allergen verification gate implementation

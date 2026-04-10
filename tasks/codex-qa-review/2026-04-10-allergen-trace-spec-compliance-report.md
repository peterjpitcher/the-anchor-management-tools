**Summary**
Against the repo and the Supabase project configured by `.env.local` on April 10, 2026, the codebase supports the earlier `option_group` model, not the new allergen-traceability model. Live data currently has 75 dishes, 0 recipes, 0 `menu_dish_recipes`, 0 `menu_recipe_ingredients`, 0 non-null `option_group` rows, and the live DB is missing `inclusion_type`, `upgrade_price`, `removable_allergens`, and `is_modifiable_for`.

**Requirements Matrix**
| Section | Requirement | Status | Evidence / audit result |
|---|---|---:|---|
| 1 | `inclusion_type` + `upgrade_price` on dish links | Missing | Not in live DB; schemas/RPCs/services stop at `option_group` in [menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts) and [20260519000000_add_option_groups.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260519000000_add_option_groups.sql). |
| 1 | `removable_allergens` + `is_modifiable_for` on `menu_dishes` | Missing | Not in live DB; view/service/types do not expose them in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql) and [menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts). |
| 1 | Reuse existing `option_group` | Supported, but only old semantics | Current code treats any non-null group as an included alternative choice in [DishCompositionTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx), [DishGpAnalysisTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx), [MenuDishesTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx), and SQL. |
| 2 | Base GP% by `included`/`removable`/`choice`/`upgrade` | Partial | Current `CostBreakdown` is only `{ total, fixedTotal, groups[maxCost] }` in [DishCompositionTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx). |
| 2 | Best-case GP% | Missing | No min-per-choice calculation client-side or server-side. |
| 2 | Upgrade GP% | Missing | No `upgrade_price`, no upgrade cost bucket, no separate upgrade GP in UI or SQL. |
| 2 | Stored `portion_cost`/`gp_pct` = base worst-case, no upgrades | Partial | Server already stores worst-case `option_group` GP in [20260519000000_add_option_groups.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260519000000_add_option_groups.sql), but grouped upgrades would still be counted as base cost. |
| 3 | Non-upgrade allergen aggregation | Missing | `menu_refresh_dish_calculations` unions allergens from all linked rows; it cannot exclude upgrades because it has no `inclusion_type`. |
| 3 | `removable_allergens`, `is_modifiable_for`, modification instructions | Missing | Current SQL has flat allergen/dietary unions only; no removable trace or per-allergen action plan. |
| 3 | `menu_refresh_dish_calculations` has right inputs | No | It sees row costs, `option_group`, and flat ingredient/recipe allergen arrays; it does not have `inclusion_type`, `upgrade_price`, component names for instructions, or recipe-internal traceability. |
| 3 | Upgrade allergens surfaced separately | Missing | No upgrade model anywhere. |
| 4 | Composition row type dropdown + conditional group/price inputs | Missing | Current rows only have free-text `option_group` in [CompositionRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx). |
| 4 | Type-aware styling | Missing | Current styling means “has group” only; no removable/upgrade styling. |
| 4 | New subtotal layout with core/removable/choice/upgrades | Missing | Footer only shows fixed vs worst-case grouped totals in [DishCompositionTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx). |
| 5 | GP Analysis section 1: base combinations from `choice` only | Partial | Current tab already does cartesian products, but for any group, not `choice` only, in [DishGpAnalysisTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx). |
| 5 | GP Analysis section 2: upgrade impact | Missing | No UI or data model for upgrades. |
| 5 | GP Analysis section 3: allergen summary | Missing | Current tab has no allergen section, and current summary types omit allergen data needed for it. |
| 6 | Schema migration | Missing | New migration file not present; live DB still lacks the new columns. |
| 6 | One-time reclassification script | Missing | Spec file is absent; current related script is [cleanup-dish-compositions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/scripts/database/cleanup-dish-compositions.ts), which deletes add-ons instead of reclassifying them. |
| 7 | Zod schemas + form row types for new fields | Missing | `DishIngredientSchema`, `DishRecipeSchema`, and form rows only include `option_group` in [menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts) and [CompositionRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx). |
| 7 | Service/select/payload/detail/list types | Missing | `getDishDetail`, `listDishes`, `createDish`, `updateDish`, and shared detail types do not carry the new fields in [menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts) and [DishExpandedRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx). |
| 9 | `option_group` can stay | Yes, structurally | No schema conflict. |
| 9 | Existing `option_group` data conflicts? | No live data conflict, yes code-semantics conflict | Live DB has zero non-null `option_group` rows, but current logic everywhere assumes “group = included choice”. |

**Section 6: Spec Names vs Live DB**
| Spec name/group | Live DB name(s) | Audit note |
|---|---|---|
| Fish & Chips | `Fish & Chips` | Exact. |
| Half Fish | `Half Fish & Chips` | Name mismatch. |
| Scampi | `Scampi & Chips` | Name mismatch. |
| Jumbo Sausage | `Jumbo Sausage & Chips` | Name mismatch. |
| Bangers & Mash | `Sausage & Mash` | Name mismatch. |
| Classic Beef Burger | `Beef Burger` | Name mismatch. |
| Garden Veg Burger | `Vegetable Burger` | Name mismatch. |
| Garden Stack | `Veggie Stack` | Name mismatch. |
| Mac & Cheese | `Mac 'N Cheese` | Name mismatch. |
| Cannelloni | `Spinach & Ricotta Cannelloni` | Name mismatch. |
| Wraps | `Chicken Goujon Wrap with Chips`, `Fish Finger Wrap with Chips` | Exact concept, longer stored names. |
| Smaller plates | `3 Fish Fingers with Chips`, `4 Chicken Goujons with Chips` | Name mismatch plus quantity prefix. |

**Live data mismatches inside section 6**
- No `tartar/tartare sauce` rows exist anywhere in `menu_dish_ingredients`.
- No `bamboo stick` rows exist anywhere.
- Fish dishes currently contain both garden peas and mushy peas, plus lemon on fish/scampi; tartare is absent.
- `Katsu Chicken Burger` still has tomato in the DB and does not currently have cucumber.
- `Sticky Toffee Pudding` still has both custard and ice cream rows.
- Puddings have zero `option_group` rows today, so the earlier option-group reclassification has not been applied in this DB.

**Section 8: File-by-File Reality**
| Spec file | Exists | Current reality | What changes |
|---|---:|---|---|
| `supabase/migrations/XXXXXXXX_add_inclusion_type.sql` | No | Closest existing file is [20260519000000_add_option_groups.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260519000000_add_option_groups.sql). | New migration or a follow-up migration is required. |
| `scripts/database/reclassify-dish-compositions.ts` | No | Related scripts: [cleanup-dish-compositions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/scripts/database/cleanup-dish-compositions.ts), [audit-dish-compositions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/scripts/database/audit-dish-compositions.ts). | Need a true reclassifier; current cleanup script deletes rows. |
| [src/services/menu.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/menu.ts) | Yes | Option-group only. | Add new schema fields, selects, payloads, and dish-level computed fields. |
| [CompositionRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx) | Yes | Group input only. | Add `inclusion_type`, conditional group/price inputs, type-aware styling. |
| [DishCompositionTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx) | Yes | Fixed + max(group) costing only. | Replace `CostBreakdown`/cost logic and subtotal display. |
| [DishGpAnalysisTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx) | Yes | Base combinations table only. | Add upgrade-impact section and allergen summary. |
| [DishDrawer.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx) | Yes | GP tab already exists; hydration/save only know `option_group`. | Add new row fields and header/base-vs-upgrade cost summary. |
| [DishExpandedRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx) | Yes | Shared types + flat component cards. | Add fields and probably render type/traceability badges, not just types. |
| [dishes/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/page.tsx) | Yes | Duplicated `mapApiDish`; support data drops allergen detail from summaries. | Update dish mapping and support-data mapping. |
| [MenuDishesTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx) | Yes | Any group means combinations; upgrades would be treated as base choices. | Make combinations `choice`-only and exclude upgrades from base cost. |
| [menu-management/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/page.tsx) | Yes | Same duplicated mapping; stats still dish-based. | Update mapping/types; be careful with GP stat behavior changes. |

**Additional risks**
- Recipe traceability is not achievable with current recipe modeling. Even after adding `inclusion_type` to dish-recipe links, recipes only store flat `allergen_flags`; they cannot trace removability inside the recipe.
- The current dish-level `dietary_flags` aggregation is already semantically wrong. Live example: `Beef Burger` currently stores `vegan,dairy_free,vegetarian,gluten_free`, because SQL unions positive ingredient flags. `is_modifiable_for` must not be derived from current dish `dietary_flags`.
- Current uniqueness constraints on `(dish_id, ingredient_id)` and `(dish_id, recipe_id)` prevent the same ingredient/recipe appearing twice under different roles, e.g. “included cheese” plus “extra cheese upgrade”.
- If the old cleanup script has been run in another environment, the spec’s “reclassify existing links” assumption may fail because that script deletes upgrade rows instead of preserving them.

If you want, I can turn this into a CSV-style implementation checklist next.
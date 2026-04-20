# Option Groups Spec Trace Audit

Spec audited: `docs/superpowers/specs/2026-04-10-dish-option-groups-design.md`

## High-signal findings

- `option_group` does not exist anywhere in the live schema, service layer, form types, drawer payloads, or dashboard data flow.
- The named SQL functions do exist and match the spec names: `create_dish_transaction`, `update_dish_transaction`, and `menu_refresh_dish_calculations`.
- The current cost logic is a flat sum on both client and server. There is no max-per-group logic.
- `MenuDishesTable` receives dish ingredient/recipe arrays, but they are missing `option_group` and are typed as `unknown[]`, so the current dashboard flow is not sufficient for combinations.
- Section 8 is incomplete: the shared dish detail types in `DishExpandedRow.tsx` and the dedicated dishes page mapping in `src/app/(authenticated)/menu-management/dishes/page.tsx` would also need changes.
- The spec silently drops current composition-tab behavior: duplicate-ingredient warnings and the explicit recipe subtotal are not carried forward.

## Problem Statement

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Avoid summing all optional alternatives as if they all apply | Problem Statement | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:19`, `supabase/migrations/20251123120000_squashed.sql:17329` | MISSING | Client and server both sum every linked row. |
| Model mutually exclusive choices such as "pick one from this group" | Problem Statement | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:33`, `supabase/migrations/20251123120000_squashed.sql:16433`, `supabase/migrations/20251123120000_squashed.sql:17229` | MISSING | No `option_group` field in form rows or junction tables. |
| Show GP impact of each possible combination | Problem Statement | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378`, `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:153` | MISSING | No GP analysis tab or dashboard combination view exists. |

## Solution

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Add `option_group` to dish ingredient and dish recipe links | Solution | `supabase/migrations/20251123120000_squashed.sql:16433`, `supabase/migrations/20251123120000_squashed.sql:17229`, `src/services/menu.ts:42` | MISSING | Tables and schemas do not contain the field. |
| Add GP Analysis tab in the dish drawer | Solution | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | NEW_WORK | Drawer still defines only `overview`, `composition`, and `menus` tabs. |
| Expand dashboard health table to show option variants | Solution | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:15`, `src/app/(authenticated)/menu-management/page.tsx:331` | MISSING | Table is dish-level only. |

## 1. Data Model

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| `menu_dish_ingredients` has nullable `option_group TEXT` | 1. Data Model | `supabase/migrations/20251123120000_squashed.sql:16433` | MISSING | Current columns stop at `notes`; there is no `option_group`. |
| `menu_dish_recipes` has nullable `option_group TEXT` | 1. Data Model | `supabase/migrations/20251123120000_squashed.sql:17229` | MISSING | Current columns stop at `notes`; there is no `option_group`. |
| Group names are stored as free text and `NULL` means fixed item | 1. Data Model | `src/services/menu.ts:42`, `src/services/menu.ts:54`, `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:33` | MISSING | No schema/type currently models fixed vs grouped rows. |

## 2. Cost Calculation

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| `computeIngredientCost` applies fixed-items + max-per-group logic | 2. Cost Calculation | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:19` | MISSING | Function is a straight `reduce` sum over all ingredient rows. |
| `computeRecipeCost` applies fixed-items + max-per-group logic | 2. Cost Calculation | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:44` | MISSING | Function is a straight `reduce` sum over all recipe rows. |
| Drawer subtotal shows worst-case grouped breakdown instead of one flat total | 2. Cost Calculation | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:204`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:239`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:275` | MISSING | UI still shows `Recipes: £...`, `Direct ingredients: £...`, and a single `Total portion cost`. |
| `menu_refresh_dish_calculations` applies the same max-per-group logic after save | 2. Cost Calculation | `supabase/migrations/20251123120000_squashed.sql:17329` | MISSING | SQL function unions ingredient and recipe rows, then sums them all. |
| Client and server produce identical worst-case results | 2. Cost Calculation | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:19`, `supabase/migrations/20251123120000_squashed.sql:17329` | MISSING | They are aligned today, but only because both use the old flat-sum behavior. |

## 3. Composition Tab Changes (Tab 2)

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Ingredient form row includes `option_group` | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:33` | MISSING | `DishIngredientFormRow` has `ingredient_id`, quantity, unit, yield, wastage, override, notes only. |
| Recipe form row includes `option_group` | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:43` | MISSING | `DishRecipeFormRow` has no group field. |
| Compact ingredient row has a Group input before the chevron | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:125` | MISSING | Compact ingredient row renders Ingredient, Qty, Unit, then controls. |
| Compact recipe row has a Group input before the chevron | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:253` | MISSING | Compact recipe row renders Recipe, Qty, then controls. |
| Group input auto-suggests names already used on the dish | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:101`, `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:238` | NEW_WORK | No local group registry or suggestion UI exists. |
| Rows in the same group show a left border and badge | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:125`, `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:253` | MISSING | Rows all share the same neutral card styling. |
| Subtotal display breaks out fixed items and worst-case group lines | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:204`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:239`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:275` | MISSING | Current subtotal UI has no grouped breakdown. |
| Existing duplicate-ingredient warning is preserved or intentionally replaced | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:140`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:266` | DROPPED | Current UI warns about duplicate direct ingredients; the spec does not mention this behavior. |
| Existing explicit recipe subtotal is preserved in the new subtotal design | 3. Composition Tab Changes | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:204` | DROPPED | The spec rewrites the subtotal example around ingredients/groups only and never explains how recipe costs should appear, despite adding groups to dish recipes too. |

## 4. GP Analysis Tab (New Tab 4)

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| New `DishGpAnalysisTab.tsx` component exists | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx` | NEW_WORK | File does not exist. |
| Drawer exposes a 4th "GP Analysis" tab | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | MISSING | Drawer still builds a 3-tab array. |
| GP Analysis tab computes and displays cartesian-product combinations | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | NEW_WORK | No combination-generation logic exists in the drawer. |
| Combinations are sorted worst-to-best GP and flagged below target | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:208` | MISSING | Similar below-target styling exists for dish rows, but no combination table exists. |
| Each below-target combination shows required selling price for target GP | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:214` | PARTIAL | Required-price hint logic exists for dish rows only, not for combination rows in a drawer tab. |
| Summary, empty state, and combination explosion guard exist | 4. GP Analysis Tab | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | NEW_WORK | None of these behaviors are implemented. |

## 5. Dashboard Health Table Expansion

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Default dashboard view uses worst-case grouped GP per dish | 5. Dashboard Health Table Expansion | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:208`, `supabase/migrations/20251123120000_squashed.sql:17329` | MISSING | Dashboard uses stored flat-sum `portion_cost`/`gp_pct`. |
| Dashboard can toggle between worst-case-only and all-combinations views | 5. Dashboard Health Table Expansion | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:59`, `src/app/(authenticated)/menu-management/page.tsx:125` | MISSING | Only stat-card filtering exists. No combination-view toggle state is present. |
| Expanded dashboard shows one row per combination | 5. Dashboard Health Table Expansion | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:194` | MISSING | Table renders exactly one `<tr>` per dish. |
| Below-GP stat counts combinations, not dishes | 5. Dashboard Health Table Expansion | `src/app/(authenticated)/menu-management/page.tsx:216` | MISSING | `belowTargetCount` is `dishes.filter((d) => d.is_gp_alert).length`. |
| `MenuDishesTable` receives enough data to compute combinations | 5. Dashboard Health Table Expansion | `src/app/(authenticated)/menu-management/page.tsx:50`, `src/app/(authenticated)/menu-management/page.tsx:331`, `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:15`, `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx:42` | PARTIAL | Runtime data includes quantities, yield, wastage, and costs, but it does not include `option_group`, and the table props erase detail to `unknown[]`. |
| `listDishes` return shape includes ingredient-level detail needed for combination GP calculation | 5. Dashboard Health Table Expansion | `src/services/menu.ts:837`, `src/services/menu.ts:892`, `src/services/menu.ts:923`, `src/services/menu.ts:953` | PARTIAL | Service returns enough line-cost inputs for ingredients and dish-linked recipes, but not `option_group`. |

## 6. Tabs Fix

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| `Tabs` uses Tailwind `hidden` class instead of HTML `hidden` attribute | 6. Tabs Fix | `src/components/ui-v2/navigation/Tabs.tsx:399` | SUPPORTED | Inactive panels use `className={cn(!isActive && 'hidden', ...)}` exactly as the spec says. |
| Dish drawer tab structure is 4 tabs: Overview, Composition, Menus, GP Analysis | 6. Tabs Fix | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | MISSING | Current tab array only contains Overview, Composition, and Menus. |

## 7. Schema / Service / RPC Changes

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Migration exists adding both columns and updating SQL functions | 7. Schema / Service / RPC Changes | `supabase/migrations` | NEW_WORK | No migration matching the spec exists, and no current migration adds `option_group`. |
| `DishIngredientSchema` includes `option_group: z.string().nullable().optional()` | 7. Schema / Service / RPC Changes | `src/services/menu.ts:42` | MISSING | Schema has no group field. |
| `DishRecipeSchema` includes `option_group: z.string().nullable().optional()` | 7. Schema / Service / RPC Changes | `src/services/menu.ts:54` | MISSING | Schema has no group field. |
| `getDishDetail` selects `option_group` for ingredient and recipe rows | 7. Schema / Service / RPC Changes | `src/services/menu.ts:1027`, `src/services/menu.ts:1035` | MISSING | Select lists do not include `option_group`. |
| `listDishes` returns `option_group` for ingredient and recipe rows | 7. Schema / Service / RPC Changes | `src/services/menu.ts:837`, `src/services/menu.ts:892`, `src/services/menu.ts:927`, `src/services/menu.ts:958` | MISSING | Service returns detail objects without the field. |
| `createDish` passes `option_group` through to `create_dish_transaction` | 7. Schema / Service / RPC Changes | `src/services/menu.ts:1275`, `supabase/migrations/20260518000000_fix_menu_unit_casts.sql:141` | MISSING | Service forwards raw `input.ingredients` and `input.recipes`, but schemas never accept the field and the RPC insert lists do not include it. |
| `updateDish` passes `option_group` through to `update_dish_transaction` | 7. Schema / Service / RPC Changes | `src/services/menu.ts:1103`, `src/services/menu.ts:1113`, `supabase/migrations/20260518000000_fix_menu_unit_casts.sql:258` | MISSING | Update payloads omit `option_group` entirely, and the RPC insert lists omit it too. |
| Existing server actions can stay structurally unchanged once schemas include `option_group` | 7. Schema / Service / RPC Changes | `src/app/actions/menu-management.ts:296`, `src/app/actions/menu-management.ts:326` | PARTIAL | No new action functions are needed, but the current `DishSchema.parse` / `DishSchema.partial().parse` path will not carry `option_group` until the schemas are updated. |

## 8. File Changes Summary

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| `supabase/migrations/XXXXXXXX_add_option_groups.sql` exists | 8. File Changes Summary | `supabase/migrations` | NEW_WORK | No such migration file exists. |
| `src/services/menu.ts` includes option-group schema/service changes | 8. File Changes Summary | `src/services/menu.ts:42`, `src/services/menu.ts:773`, `src/services/menu.ts:1015`, `src/services/menu.ts:1082`, `src/services/menu.ts:1275` | MISSING | File exists, but none of the required changes are present. |
| `src/app/actions/menu-management.ts` requires no new action-specific logic | 8. File Changes Summary | `src/app/actions/menu-management.ts:296`, `src/app/actions/menu-management.ts:326` | PARTIAL | Structurally true, but schema parsing still blocks passthrough until the schemas change. |
| `CompositionRow.tsx` has option-group input and auto-suggest | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:33` | MISSING | File exists but has no group field or suggestion UI. |
| `DishCompositionTab.tsx` has worst-case costing, new subtotal, and visual grouping | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:19`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:200` | MISSING | File exists but is still flat-sum and ungrouped. |
| `DishGpAnalysisTab.tsx` exists with combinations table | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx` | NEW_WORK | File is missing. |
| `DishDrawer.tsx` has a 4th tab and passes option-group data | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:165`, `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:293`, `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx:378` | MISSING | Load/save mappings and tab list do not include `option_group` or GP Analysis. |
| `MenuDishesTable.tsx` supports combination expansion and a toggle view | 8. File Changes Summary | `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:15`, `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx:194` | MISSING | File exists but only renders dish rows. |
| `src/app/(authenticated)/menu-management/page.tsx` counts below-target combinations | 8. File Changes Summary | `src/app/(authenticated)/menu-management/page.tsx:216` | MISSING | It still counts below-target dishes. |
| `src/components/ui-v2/navigation/Tabs.tsx` has the hidden-panel fix | 8. File Changes Summary | `src/components/ui-v2/navigation/Tabs.tsx:399` | SUPPORTED | Already applied. |

## Additional file gaps not listed in Section 8

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| Shared dish detail types need `option_group` to avoid dropping the new field | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx:42`, `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx:58`, `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx:86` | NEW_WORK | `DishIngredientDetail`, `DishRecipeDetail`, and `DishListItem` are shared by the drawer and both pages. |
| Dedicated dishes page also maps API payloads into `DishListItem` and would drop `option_group` | 8. File Changes Summary | `src/app/(authenticated)/menu-management/dishes/page.tsx:36`, `src/app/(authenticated)/menu-management/dishes/page.tsx:667` | NEW_WORK | The spec summary omits this page, but it also mounts `DishDrawer`. |
| Dashboard page needs mapping changes, not just stat-card changes | 8. File Changes Summary | `src/app/(authenticated)/menu-management/page.tsx:21`, `src/app/(authenticated)/menu-management/page.tsx:331` | PARTIAL | The file is listed, but the missing work also includes preserving `option_group` through `mapApiDish`. |

## Out of Scope

| Requirement | Spec Section | Code Location | Status | Notes |
|---|---|---|---|---|
| No option groups inside recipe ingredient definitions | Out of Scope | `src/services/menu.ts:52`, `supabase/migrations/20251123120000_squashed.sql:17197` | SUPPORTED | `menu_recipe_ingredients` and `RecipeIngredientSchema` have no `option_group`. |
| No customer-facing option display | Out of Scope | `src/app/(authenticated)/menu-management` | SUPPORTED | All inspected code is back-of-house menu management UI only. |
| No customer-facing option pricing/surcharges | Out of Scope | `src/app/(authenticated)/menu-management`, `src/services/menu.ts:773` | SUPPORTED | No option pricing UI or customer-facing surcharge logic exists. |
| No drag-and-drop reordering within groups | Out of Scope | `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:125`, `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx:253` | SUPPORTED | Rows are static cards with expand/remove controls only. |
| Group costing strategy stays "most expensive only" | Out of Scope | `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx:19`, `supabase/migrations/20251123120000_squashed.sql:17329` | MISSING | No group-costing strategy exists yet, so the intended worst-case-only rule is not implemented. |

## Specific checks requested

- Section 8 file existence:
  - Exists: `src/services/menu.ts`, `src/app/actions/menu-management.ts`, `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx`, `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx`, `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx`, `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx`, `src/app/(authenticated)/menu-management/page.tsx`, `src/components/ui-v2/navigation/Tabs.tsx`
  - Missing: `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx`
  - Missing / placeholder only: `supabase/migrations/XXXXXXXX_add_option_groups.sql`
- SQL function names verified:
  - `menu_refresh_dish_calculations` exists in `supabase/migrations/20251123120000_squashed.sql:17329`
  - `create_dish_transaction` exists in `supabase/migrations/20260518000000_fix_menu_unit_casts.sql:141`
  - `update_dish_transaction` exists in `supabase/migrations/20260518000000_fix_menu_unit_casts.sql:259`
- Form row types vs `CompositionRow.tsx`:
  - `DishIngredientFormRow` and `DishRecipeFormRow` do not match the spec because neither includes `option_group`.
- Cost calculation functions in `DishCompositionTab.tsx`:
  - `computeIngredientCost` and `computeRecipeCost` both exist, but both flat-sum all rows.
- Dashboard data flow:
  - `MenuDishesTable` does receive ingredient and recipe arrays, but not `option_group`, and the page/component typings erase the details to `unknown[]`.
- `listDishes` return shape:
  - It includes enough costing inputs to compute combination GP once groups exist, but it currently omits `option_group`, so the shape is not sufficient today.
- Current UI behaviors the spec silently changes or drops:
  - Duplicate direct-ingredient warning in `DishCompositionTab.tsx`
  - Explicit `Recipes: £...` subtotal in the composition tab header
  - The spec summary also omits the second `DishDrawer` entry point in `src/app/(authenticated)/menu-management/dishes/page.tsx`

Full section-by-section requirements matrix is in [2026-04-10-option-groups-spec-trace-audit.md](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tasks/codex-qa-review/2026-04-10-option-groups-spec-trace-audit.md).

The short version:
- `option_group` is missing everywhere today: schema, migrations, Zod, service selects, form row types, drawer load/save payloads, and dashboard mapping.
- The SQL function names do exist and match the spec: `menu_refresh_dish_calculations`, `create_dish_transaction`, and `update_dish_transaction`. Their current logic still flat-sums all rows.
- `CompositionRow.tsx` does not match the spec row shape, and `DishCompositionTab.tsx`’s `computeIngredientCost` / `computeRecipeCost` are the old flat-sum functions.
- The dashboard path is not ready for combinations: `listDishes` omits `option_group`, [MenuDishesTable.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx) only renders one row per dish, and [page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/page.tsx) still counts below-target dishes, not combinations.
- Section 8 is incomplete: [DishGpAnalysisTab.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx) is missing, and the spec also omits required changes in [DishExpandedRow.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx) and [dishes/page.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/(authenticated)/menu-management/dishes/page.tsx).
- The only spec item already implemented is the Tabs hidden-panel fix in [Tabs.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/navigation/Tabs.tsx#L399).

I only added the audit report file; no product code was changed.
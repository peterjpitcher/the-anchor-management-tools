# Dish Option Groups — Design Spec

**Date:** 2026-04-10
**Status:** Draft
**Scope:** Option groups for dish ingredients/recipes, GP% analysis tab, dashboard expansion, tabs fix

## Problem Statement

When a dish has optional sides (e.g. chips OR mash OR steak cut chips, AND garden peas OR mushy peas), all options are currently added as separate ingredients. The cost calculation sums them all, inflating the portion cost and producing an inaccurate GP%. There's no way to model "pick one from this group" or see the GP% impact of each combination.

## Solution

Add an `option_group` column to dish ingredient and recipe junction tables. Items sharing the same group name are alternatives — only the most expensive per group counts toward headline GP% (conservative/worst-case). A new GP Analysis tab in the dish drawer shows all possible combinations. The dashboard health table expands to show option variants across all dishes.

---

## 1. Data Model

Add a nullable `option_group` column to both junction tables:

```sql
ALTER TABLE menu_dish_ingredients ADD COLUMN option_group TEXT;
ALTER TABLE menu_dish_recipes ADD COLUMN option_group TEXT;
```

- `NULL` = fixed component, always included in cost (e.g. the pie filling)
- `'Chips'` = one option in the "Chips" group (alternatives to each other)
- `'Peas'` = one option in the "Peas" group

**Example — Steak & Ale Pie:**

| Ingredient | Option Group | Cost |
|------------|-------------|------|
| Pie filling | NULL (fixed) | £2.10 |
| Mashed potato | Chips | £0.30 |
| Chips | Chips | £0.45 |
| Steak cut chips | Chips | £0.60 |
| Garden peas | Peas | £0.20 |
| Mushy peas | Peas | £0.35 |

Headline GP% uses most expensive per group: £2.10 + £0.60 + £0.35 = £3.05

---

## 2. Cost Calculation

### Logic

1. **Fixed items** (option_group = null) — sum all costs, same as today
2. **Grouped items** — for each unique group name, find the most expensive item's cost
3. **Headline portion cost** = fixed total + sum of max-per-group

### Where it changes

**Client-side (live calculation in drawer):**
- `DishCompositionTab.tsx` — `computeIngredientCost` / `computeRecipeCost` functions
- The subtotal display changes from a single sum to: fixed items total + worst-case per group

**Server-side (after save):**
- `menu_refresh_dish_calculations` SQL function — must apply the same max-per-group logic
- This function updates `portion_cost`, `gp_pct`, and `is_gp_alert` on the `menu_dishes` row

Both must produce identical results.

---

## 3. Composition Tab Changes (Tab 2)

### Option Group Field per Row

Add a small text input to each ingredient and recipe row in the compact view:
- Label: "Group"
- Placeholder: "Fixed" (when empty/null)
- Position: at the end of the compact row, before the expand chevron
- Auto-suggest from existing group names already used on this dish (type "C" → suggests "Chips")

### Visual Grouping

- Rows with the same option group get a coloured left border and a small group label badge
- Fixed items (no group) have no border
- Groups are visually distinguishable at a glance

### Subtotal Display

Current: `Direct ingredients: £X.XX` (sums all)

New:
```
Fixed ingredients: £X.XX
Chips (worst case): £0.60
Peas (worst case): £0.35
Total portion cost (worst case): £3.05
```

Each group line shows the most expensive option's cost. The total is the conservative/headline figure.

---

## 4. GP Analysis Tab (New Tab 4)

A new read-only tab in the dish drawer showing every possible combination of options and their GP%.

### Combinations Table

For a dish with N groups, the table shows the cartesian product (one selection per group) combined with the fixed items:

| Combination | Portion Cost | GP% | Status |
|-------------|-------------|-----|--------|
| Steak cut chips + Mushy peas | £3.05 | 68.2% | Below target |
| Steak cut chips + Garden peas | £2.90 | 69.8% | Below target |
| Chips + Mushy peas | £2.90 | 69.8% | Below target |
| Chips + Garden peas | £2.75 | 71.3% | OK |
| Mashed potato + Mushy peas | £2.75 | 71.3% | OK |
| Mashed potato + Garden peas | £2.60 | 72.9% | OK |

### Features

- Sorted worst-to-best GP% (most expensive combinations first)
- Red row + warning icon for combinations below target GP%
- Shows selling price needed to hit target GP for each below-target row
- Summary at top: "6 combinations: 3 below target, 3 OK"
- If no option groups exist, shows: "No option groups configured — all ingredients are fixed"
- Read-only — editing happens on the Composition tab

### Combination Explosion Guard

If the cartesian product exceeds 100 combinations (e.g. 5 groups with 4 options each = 1,024), show a warning and only display the worst 20 and best 20 with a note: "Showing 40 of 1,024 combinations (worst 20 and best 20)".

---

## 5. Dashboard Health Table Expansion

The dashboard Menu Health Table expands to show option variants:

### Default View: Worst Case Only

One row per dish showing the worst-case combination GP% (most expensive options from each group). Same as today for dishes without groups.

### Expanded View: All Combinations

Toggle to expand dishes with option groups to show one row per combination:

| Dish | Combination | Price | Cost | GP% | Status |
|------|------------|-------|------|-----|--------|
| Steak & Ale Pie | Steak cut chips + Mushy peas | £9.95 | £3.05 | 68.2% | Below target |
| Steak & Ale Pie | Steak cut chips + Garden peas | £9.95 | £2.90 | 69.8% | Below target |
| Steak & Ale Pie | Chips + Garden peas | £9.95 | £2.75 | 71.3% | OK |
| Fish & Chips | — | £11.95 | £3.20 | 73.2% | OK |

### Stat Card Changes

- "Below GP Target" counts unique combinations below target, not just dishes
- Toggle between "worst case only" and "all combinations" view
- Default: worst case only for a cleaner scan

---

## 6. Tabs Fix

The existing Tabs component has a rendering issue where the HTML `hidden` attribute doesn't reliably hide inactive panels.

**Fix:** In `src/components/ui-v2/navigation/Tabs.tsx`, replace `hidden={!isActive}` with Tailwind's `className={cn(!isActive && 'hidden', ...)}`. (Already applied.)

### Updated Tab Structure

The dish drawer tabs go from 3 to 4:

| Tab | Name | Purpose |
|-----|------|---------|
| 1 | Overview | Name, price, description, notes |
| 2 | Composition | Ingredients + recipes with option groups |
| 3 | Menus | Menu assignments |
| 4 | GP Analysis | All combinations table (read-only) |

---

## 7. Schema / Service / RPC Changes

### Migration

Single migration adding the column and updating SQL functions:

1. `ALTER TABLE menu_dish_ingredients ADD COLUMN option_group TEXT;`
2. `ALTER TABLE menu_dish_recipes ADD COLUMN option_group TEXT;`
3. Update `create_dish_transaction` — include `option_group` in INSERT for `menu_dish_ingredients` and `menu_dish_recipes`
4. Update `update_dish_transaction` — same
5. Update `menu_refresh_dish_calculations` — apply max-per-group costing logic

### Zod Schemas

Add to `DishIngredientSchema`:
```typescript
option_group: z.string().nullable().optional()
```

Add to `DishRecipeSchema`:
```typescript
option_group: z.string().nullable().optional()
```

### Service Layer (`src/services/menu.ts`)

- `getDishDetail` — include `option_group` in select for dish ingredients and recipes
- `listDishes` — include `option_group` in the ingredient/recipe data returned (needed for dashboard combination calculations)
- `createDish` / `updateDish` — pass `option_group` through to the transaction RPCs

### Server Actions

No new server actions needed. The existing `createMenuDish` and `updateMenuDish` actions pass through the full schema, which will now include `option_group`.

---

## 8. File Changes Summary

| File | Change |
|------|--------|
| `supabase/migrations/XXXXXXXX_add_option_groups.sql` | New migration |
| `src/services/menu.ts` | Add option_group to schemas, getDishDetail, listDishes |
| `src/app/actions/menu-management.ts` | No changes (schemas flow through) |
| `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx` | Add option_group input with auto-suggest |
| `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx` | Update cost calculation, update subtotal display, add visual grouping |
| `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx` | New component — combinations table |
| `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx` | Add 4th tab, pass option_group data |
| `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` | Add combination expansion, toggle view |
| `src/app/(authenticated)/menu-management/page.tsx` | Update stat card counting for combinations |
| `src/components/ui-v2/navigation/Tabs.tsx` | Fix hidden attribute (already applied) |

---

## Out of Scope

- Option groups for recipe ingredients (recipes are building blocks, not customer-facing choices)
- Different cost strategies per group (average, cheapest) — always uses most expensive
- Customer-facing option display (this is back-of-house costing only)
- Option pricing/surcharges visible to customers
- Drag-and-drop reordering within groups

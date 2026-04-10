# Allergen Traceability & Ingredient Classification — Design Spec

**Date:** 2026-04-10
**Status:** Approved (revised after Codex QA review)
**Scope:** Add `inclusion_type` to dish ingredients/recipes for allergen traceability, correct GP% calculation, and website-ready allergen data. Replaces the standalone `option_group`-only approach with a richer model.

## Problem Statement

All dish ingredients are currently treated as "included in the base cost", but in reality ingredients have different relationships to a dish:
- Some are core (can't be removed)
- Some are standard but removable (mushy peas, tartare sauce, salad)
- Some are choices (custard OR ice cream)
- Some are paid upgrades (sweet potato fries +£2, add bacon +£2)

This causes two problems:
1. **Incorrect GP%** — paid upgrades are costed as if included, inflating portion cost (e.g. -55% GP on dishes)
2. **No allergen traceability** — the system can't tell customers which allergens can be avoided by removing or swapping components

## Solution

Add `inclusion_type` and `upgrade_price` columns to dish ingredient/recipe junction tables. Combined with the existing `option_group` column, this classifies every component's role in the dish. The cost calculation uses `inclusion_type` to produce accurate base and upgrade GP%. Allergen traceability is computed server-side and stored on the dish for fast API access.

---

## 1. Data Model

### New columns on `menu_dish_ingredients` and `menu_dish_recipes`

```sql
inclusion_type TEXT NOT NULL DEFAULT 'included'
upgrade_price NUMERIC(8,2)
```

### Inclusion types

| Value | Meaning | In base cost? | Example |
|-------|---------|--------------|---------|
| `included` | Core component, can't be removed | Yes | Pie filling, burger patty, bun |
| `removable` | Standard but can be left off on request | Yes | Mushy peas, tartare sauce, salad garnish |
| `choice` | Pick one from `option_group`, included in price | Yes (max per group) | Custard OR ice cream on puddings |
| `upgrade` | Paid extra, replaces or adds to dish | No (separate calc) | Sweet potato fries +£2, add bacon +£2 |

### `upgrade_price`

Only used when `inclusion_type = 'upgrade'`. The extra charge to the customer. Null for all other types. Can be £0 for free upgrades (e.g. swap to steak cut chips at no charge).

### `option_group`

Already exists. Used with:
- `choice` — items in the same group are alternatives (customer picks one, included in price)
- `upgrade` — items in the same group are alternative upgrades (e.g. "Chips upgrade" group: sweet potato fries, cheesy chips)

### New computed fields on `menu_dishes`

```sql
removable_allergens TEXT[]
is_modifiable_for JSONB
```

- `removable_allergens` — allergens that can be eliminated by removing `removable` items or choosing alternatives in `choice` groups
- `is_modifiable_for` — map like `{"gluten_free": true, "dairy_free": true, "vegan": false}` indicating whether the dish CAN be modified to meet each dietary need

Computed by `menu_refresh_dish_calculations` when ingredients change.

---

## 2. Cost Calculation

### Base GP% (headline figure)

Used for dashboard, table, and pricing decisions:
- Sum all `included` items
- Sum all `removable` items (part of the standard dish)
- For `choice` groups: max cost per group (worst case)
- `upgrade` items excluded
- `portion_cost = sum(included + removable) + sum(max per choice group)`
- `gp_pct = (selling_price - portion_cost) / selling_price`

### Best-case GP%

Same as base but uses min cost per `choice` group.

### Upgrade GP%

Shows worst case with all paid upgrades:
- Start with base portion cost
- Add max cost per `upgrade` group (or individual upgrade cost if not grouped)
- **Revenue per upgrade group:** max(`upgrade_price`) in that group (a customer picks ONE per group, not all). For ungrouped upgrades: add each `upgrade_price` individually.
- `total_upgrade_revenue = sum of max(upgrade_price) per upgrade group + sum of ungrouped upgrade prices`
- `upgrade_gp = (selling_price + total_upgrade_revenue - total_cost_with_upgrades) / (selling_price + total_upgrade_revenue)`

### Client-side CostBreakdown Interface

The existing `CostBreakdown` interface (`{ total, fixedTotal, groups }`) must be restructured to support the new inclusion types:

```typescript
interface CostBreakdown {
  includedTotal: number;       // sum of 'included' items
  removableTotal: number;      // sum of 'removable' items
  choiceGroups: Map<string, {  // 'choice' items grouped by option_group
    maxCost: number;
    minCost: number;
    items: Array<{ name: string; cost: number }>;
  }>;
  upgradeGroups: Map<string, { // 'upgrade' items grouped by option_group
    maxCost: number;
    maxPrice: number;          // max upgrade_price in group
    items: Array<{ name: string; cost: number; price: number }>;
  }>;
  ungroupedUpgrades: Array<{   // 'upgrade' items without option_group
    name: string;
    cost: number;
    price: number;
  }>;
  baseTotal: number;           // includedTotal + removableTotal + sum(choiceGroups maxCost)
  upgradeTotal: number;        // baseTotal + sum(upgradeGroups maxCost) + sum(ungroupedUpgrades cost)
}
```

The same logic must be mirrored in the SQL `menu_refresh_dish_calculations` function.

### Stored values on `menu_dishes`

`portion_cost` and `gp_pct` use the base GP% calculation (worst-case choices, no upgrades). This is the conservative headline figure.

---

## 3. Allergen Traceability

### Recipe Atomicity

Recipes linked to a dish are treated as **atomic components**. A recipe is classified as `included`, `removable`, or `choice` as a whole unit. The system traces allergens TO the recipe level ("contains gluten from Beef & Ale Pie recipe") but NOT into individual recipe sub-ingredients. This matches real-world behaviour — you cannot remove pastry from a pie.

Recipes store pre-aggregated `allergen_flags` and `dietary_flags`. These are used directly for allergen traceability without drilling into the recipe's ingredient list.

### What the system can answer per dish

1. **"Does this dish contain gluten?"** — Check all non-upgrade ingredients AND recipes (included + removable + choice items)
2. **"Can it be made gluten-free?"** — Check if ALL gluten-containing components (ingredients and recipes) are either `removable` or in a `choice` group with a gluten-free alternative
3. **"What needs to change?"** — List removable items to remove and choice swaps to make
4. **"What about upgrades?"** — Separately flag upgrade options that contain the allergen

### Computed allergen fields

`menu_refresh_dish_calculations` computes:

**`allergen_flags`** (existing) — all allergens across all non-upgrade components. The "contains or may contain" list.

**`removable_allergens`** — allergens where every ingredient containing that allergen is either:
- `removable` (can be left off), OR
- In a `choice` group where at least one alternative doesn't contain the allergen

**`is_modifiable_for`** — for each allergen-based diet, whether the dish can be modified to avoid that allergen. Supported diets (one per UK allergen): `gluten_free`, `dairy_free`, `egg_free`, `nut_free`, `peanut_free`, `fish_free`, `crustacean_free`, `sesame_free`, `soya_free`, `celery_free`, `mustard_free`, `sulphite_free`, `lupin_free`, `mollusc_free`. Computed by checking if the corresponding allergen is in `removable_allergens`.

**Excluded from automatic computation:** `vegan` and `vegetarian` require non-allergen ingredient metadata (meat, gelatin, honey, animal stock) that is not currently tracked. These are excluded until ingredient-level dietary flags are comprehensive enough to support them deterministically.

**Computation source:** `is_modifiable_for` must be computed from ingredient-level `allergens` arrays directly, NOT from the dish-level `dietary_flags` field. The current dish `dietary_flags` are incorrect — they union positive flags from individual ingredients, producing nonsensical results (e.g. a beef burger marked "vegan" because the chips ingredient is vegan).

### API output structure (for website integration later)

```json
{
  "name": "Fish & Chips",
  "price": 15.00,
  "allergens": ["gluten", "fish", "eggs", "dairy"],
  "modifiable_for": {
    "gluten_free": false,
    "dairy_free": true
  },
  "components": [
    { "name": "Beer-battered fish", "type": "included", "allergens": ["gluten", "fish", "eggs"] },
    { "name": "Chunky chips", "type": "included", "allergens": [] },
    { "name": "Mushy peas", "type": "removable", "allergens": [] },
    { "name": "Tartare sauce", "type": "removable", "allergens": ["dairy", "eggs"] },
    { "name": "Lemon wedge", "type": "removable", "allergens": [] }
  ],
  "modifications": {
    "dairy_free": [
      { "action": "remove", "ingredient": "Tartare sauce", "contains": ["dairy"] }
    ]
  },
  "upgrades": [
    { "name": "Sweet potato fries", "price": 2.00, "allergens": [], "group": "Chips upgrade" }
  ]
}
```

### Allergen Verification Gate

Add `allergen_verified BOOLEAN DEFAULT FALSE` and `allergen_verified_at TIMESTAMPTZ` to `menu_dishes`.

- Staff must review and verify the computed allergen data for each dish before it is exposed via the website API
- The API returns `is_modifiable_for` and `modifications` data ONLY for dishes where `allergen_verified = true`
- Unverified dishes return `allergen_flags` only (the flat list) with a note: "Please ask at the bar for allergen information"
- Any change to a dish's ingredients or recipes **resets `allergen_verified` to `false`** — requiring re-verification
- Audit logging records who verified and when

This prevents incorrect automatic computations from reaching customers with allergies.

---

## 4. Composition Tab UI Changes

### Type dropdown per row

Replace the standalone "Group" text input with a combined control set:

| Control | Values | Visible when |
|---------|--------|-------------|
| Type dropdown | Included, Removable, Choice, Upgrade | Always |
| Group name input | Free text with auto-suggest | Type is "Choice" or "Upgrade" |
| Upgrade price input | £ amount | Type is "Upgrade" |

### Visual styling per type

- `included` — no special styling (default)
- `removable` — dashed left border, "(removable)" badge
- `choice` — coloured left border + group badge (existing option_group styling)
- `upgrade` — amber left border, "Upgrade +£X" badge

### Subtotal display

```
Core ingredients: £X.XX
Removable ingredients: £X.XX
Choice — Accompaniment (worst case): £X.XX
Base portion cost: £X.XX | Base GP: XX.X%

Upgrades:
  Sweet potato fries (+£2.00): cost £X.XX
  Add bacon (+£2.00): cost £X.XX
Upgrade GP (all upgrades): XX.X%
```

---

## 5. GP Analysis Tab Changes

### Section 1: Base Combinations
Cartesian product of `choice` groups only. Shows base portion cost and GP% per combination. Same explosion guard (max 100).

### Section 2: Upgrade Impact
Table showing each upgrade option with cost impact:
- Base GP%: XX.X%
- With [upgrade name]: XX.X%
- With all upgrades: XX.X%

### Section 3: Allergen Summary
- Lists all 14 UK allergens present in the dish
- For each, shows which components contain it and whether removable
- Highlights which dietary modifications are possible
- Read-only — same data that powers the website API

---

## 6. Migration

### Schema changes

Single migration:
1. Add `inclusion_type TEXT NOT NULL DEFAULT 'included'` to `menu_dish_ingredients` and `menu_dish_recipes`
2. Add `upgrade_price NUMERIC(8,2)` to both tables
3. Add `removable_allergens TEXT[]`, `is_modifiable_for JSONB`, `allergen_verified BOOLEAN DEFAULT FALSE`, `allergen_verified_at TIMESTAMPTZ` to `menu_dishes`
4. **Backfill existing option_group rows:** `UPDATE menu_dish_ingredients SET inclusion_type = 'choice' WHERE option_group IS NOT NULL; UPDATE menu_dish_recipes SET inclusion_type = 'choice' WHERE option_group IS NOT NULL;` — must run BEFORE the updated SQL functions are deployed
5. Add DB constraints:
   - `CHECK (inclusion_type IN ('included','removable','choice','upgrade'))`
   - `CHECK (inclusion_type = 'upgrade' OR upgrade_price IS NULL)` — only upgrades have a price
   - `CHECK (inclusion_type NOT IN ('included','removable') OR option_group IS NULL)` — included/removable items can't be in groups
6. Update `create_dish_transaction` and `update_dish_transaction` to include `inclusion_type` and `upgrade_price`
7. Update `menu_refresh_dish_calculations` for new costing logic, allergen computation, and to reset `allergen_verified = false` on any ingredient change

### Data reclassification

One-time script to reclassify existing ingredient links based on the March 2026 menu.

**Script requirements:**
- Match rows by **UUID** (dish ID + ingredient ID), not by dish name — live DB names differ from menu document names (e.g. "Sausage & Mash" not "Bangers & Mash", "Beef Burger" not "Classic Beef Burger")
- Assert expected row counts before and after each dish update
- Run in a **single database transaction** with rollback on any assertion failure
- Support `--dry-run` mode that reports planned changes without applying them
- Produce a before/after report showing each dish's old and new GP%
- **Audit missing data:** some menu items don't have the correct ingredients in the DB (e.g. no tartare sauce on fish dishes, no cucumber on Katsu Burger). The script must add missing links AND reclassify existing ones.

**Reclassification rules (by dish category):**

**British Pub Classics (Fish & Chips, Half Fish, Scampi, Jumbo Sausage):**
- Mushy peas → `removable`
- Tartare sauce → `removable`
- Lemon wedge → `removable`
- Bamboo stick → `removable`
- Steak cut chips → `upgrade`, group "Chips upgrade", price £0
- Sweet potato fries → `upgrade`, group "Chips upgrade", price £2.00

**Bangers & Mash:**
- Sweet potato fries → `upgrade`, group "Side upgrade", price £2.00

**Pies (all four):**
- Mash → `included`
- Gravy → `included`
- Steak cut chips → `upgrade`, group "Side upgrade", price £0
- Sweet potato fries → `upgrade`, group "Side upgrade", price £2.00
- Garden peas → `removable`
- Mushy peas → `removable`

**Burgers (Classic Beef, Chicken, Spicy Chicken):**
- Tomato → `removable`
- Lettuce → `removable`
- Steak cut chips → `upgrade`, group "Chips upgrade", price £0
- Sweet potato fries → `upgrade`, group "Chips upgrade", price £2.00
- Hash brown → `upgrade`, price £2.00
- Cheese → `upgrade`, price £1.00
- Onion rings → `upgrade`, price £1.00
- Bacon → `upgrade`, price £2.00

**Garden Veg Burger:**
- Onion ring → `included` (menu says "with onion ring")
- Same removable/upgrade pattern as other burgers for remaining items

**Beef Stack:**
- Onion ring → `included` (menu says "with onion ring")
- Same pattern for rest

**Chicken Stack, Spicy Chicken Stack:**
- Hash brown → `included` (menu says "with hash brown")
- Onion ring → `upgrade`, price £1.00
- Same pattern for rest

**Garden Stack:**
- Onion ring → `included` (menu says "with onion ring")
- Same pattern for rest

**Katsu Chicken Burger:**
- Katsu sauce → `included`
- Cucumber → `removable`
- Tomato → remove from dish (menu says cucumber, not tomato)
- Same upgrade pattern for rest

**Comfort Favourites (Lasagne, Mac & Cheese, Cannelloni):**
- Garlic bread → `included`
- Tomato, lettuce, cucumber (salad) → `removable`

**Chicken Katsu Curry:**
- All items → `included`
- Tomato, lettuce, cucumber → `removable`
- Chillies → `removable`

**Puddings:**
- Apple Crumble: custard → `choice` group "Accompaniment", ice cream → `choice` group "Accompaniment"
- Chocolate Fudge Brownie: same
- Chocolate Fudge Cake: custard → `choice` group "Accompaniment", ice cream → `choice` group "Accompaniment"
- Sticky Toffee Pudding: custard → `included`, ice cream → remove from dish (menu says custard only)

**Wraps (Chicken Goujon, Fish Finger):**
- Salad items → `removable`
- Steak cut chips → `upgrade`, group "Chips upgrade", price £0
- Sweet potato fries → `upgrade`, group "Chips upgrade", price £2.00

**Smaller plates (Fish Fingers & Chips, Chicken Goujons & Chips):**
- Steak cut chips → `upgrade`, group "Chips upgrade", price £0
- Sweet potato fries → `upgrade`, group "Chips upgrade", price £2.00

---

## 7. Zod Schemas & Service Layer

### Zod schema changes

Add to `DishIngredientSchema` and `DishRecipeSchema`:
```typescript
inclusion_type: z.enum(['included', 'removable', 'choice', 'upgrade']).default('included'),
upgrade_price: z.number().nonnegative().nullable().optional(),
```

### Form row types

Add to `DishIngredientFormRow` and `DishRecipeFormRow`:
```typescript
inclusion_type: string;  // 'included' | 'removable' | 'choice' | 'upgrade'
upgrade_price: string;   // numeric string or empty
```

### Service layer

- `getDishDetail` and `listDishes` — add `inclusion_type` and `upgrade_price` to SELECT statements
- `createDish` / `updateDish` — pass through to transaction RPCs
- Drawer hydration and save mapping — include both new fields

### Shared detail types

Add to `DishIngredientDetail` and `DishRecipeDetail`:
```typescript
inclusion_type?: string;
upgrade_price?: number | null;
```

Add to `DishListItem` dish-level fields:
```typescript
removable_allergens?: string[];
is_modifiable_for?: Record<string, boolean>;
allergen_verified?: boolean;
allergen_verified_at?: string | null;
```

---

## 8. File Changes Summary

| File | Change |
|------|--------|
| `supabase/migrations/XXXXXXXX_add_inclusion_type.sql` | New migration: columns, backfill, constraints, RPC updates, refresh function with allergen computation |
| `scripts/database/reclassify-dish-compositions.ts` | One-time data reclassification script with UUID matching, dry-run, transaction, assertions |
| `src/services/menu.ts` | Add inclusion_type + upgrade_price to schemas, selects, payloads; add allergen_verified + removable_allergens + is_modifiable_for to dish selects |
| `src/app/(authenticated)/menu-management/dishes/_components/CompositionRow.tsx` | Replace Group input with Type dropdown + conditional Group/Price inputs, update visual styling |
| `src/app/(authenticated)/menu-management/dishes/_components/DishCompositionTab.tsx` | Restructure CostBreakdown, update cost calculation for inclusion_type, update subtotal display |
| `src/app/(authenticated)/menu-management/dishes/_components/DishGpAnalysisTab.tsx` | Add upgrade impact section and allergen summary section |
| `src/app/(authenticated)/menu-management/dishes/_components/DishDrawer.tsx` | Add inclusion_type + upgrade_price to hydration/save, update header cost display, add allergen verification button |
| `src/app/(authenticated)/menu-management/dishes/_components/DishExpandedRow.tsx` | Add inclusion_type, upgrade_price, removable_allergens, is_modifiable_for, allergen_verified to shared types |
| `src/app/(authenticated)/menu-management/dishes/page.tsx` | Update data mapping |
| `src/app/(authenticated)/menu-management/_components/MenuDishesTable.tsx` | Update types, combination logic for inclusion_type (choice groups only, exclude upgrades from base) |
| `src/app/(authenticated)/menu-management/page.tsx` | Update data mapping and types |

---

## 9. Relationship to Existing `option_group`

The `option_group` column (already in the database from the earlier migration) is **kept and reused**. Its meaning depends on `inclusion_type`:

| `inclusion_type` | `option_group` | Meaning |
|-----------------|---------------|---------|
| `included` | null | Core component |
| `removable` | null | Removable garnish/accompaniment |
| `choice` | group name | Pick one from this group, included in price |
| `upgrade` | group name (optional) | Paid extra; if grouped, alternatives within that upgrade tier |
| `upgrade` | null | Standalone paid add-on (not grouped with alternatives) |

No changes needed to the `option_group` column itself.

---

## Out of Scope

- Customer-facing website UI (interactive allergen filter) — separate project, will consume the API data
- Cross-contamination warnings — kitchen-level concern, not modelled per-ingredient
- Allergen severity levels — binary "contains" only
- Nutritional information beyond calories
- Automatic menu card/PDF generation with allergen symbols

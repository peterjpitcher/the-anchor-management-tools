# Menu Management UX Overhaul — Design Spec

**Date:** 2026-04-10
**Status:** Approved
**Scope:** `/menu-management` section — dashboard, ingredients, recipes, dishes pages

## Problem Statement

The menu management section is difficult to use. All editing happens in oversized modals (up to 1,536 lines in a single file), common single-field edits require opening a full form, there's no sorting/filtering/pagination on tables, and the dashboard doesn't surface actionable information. Two personas use the system — a chef (rapid data entry) and a manager (strategic overview) — and neither is well-served.

## Design Approach

**Drawer-first editing** — replace all modals with right-side drawers. Users stay on the list page while editing, maintaining context. Inline editing for the most frequent single-field changes (price, active status) eliminates the drawer entirely for quick updates.

**Personas:**
- **Chef / kitchen manager** — updates ingredient costs from supplier invoices, builds recipes, checks portion costs. Optimise for data entry speed.
- **General manager / owner** — reviews GP% health across menus, adjusts prices, assigns dishes to menus. Optimise for strategic overview.

---

## 1. Drawer Sizes

| Entity | Drawer Size | Width | Rationale |
|--------|------------|-------|-----------|
| Ingredients | Large | 42rem (672px) | 15 fields. 2-column grid for related field pairs. Table partially visible. |
| Recipes | Large | 42rem (672px) | Recipe overview + scrollable ingredient list. Cost summary pinned at bottom. |
| Dishes | XL | 56rem (896px) | Internal tabs: Overview, Composition, Menus. GP%/cost summary pinned in header. |

On mobile (below 768px), pages detect the viewport via a `useMediaQuery` hook and pass `size="full"` to the Drawer. This is page-level logic — the Drawer component does not have automatic mobile fullscreen behaviour.

### Inline Editing (No Drawer Needed)

These fields are editable directly in the table row:
- **Pack cost / selling price** — click the value to reveal an input. Press Enter or blur to save. Press Escape to cancel. Shows a brief loading spinner in the cell during save. Calls **dedicated field-level server actions** (not the generic update actions): `updateIngredientPackCost(id, packCost)` for ingredients, `updateDishPrice(id, sellingPrice)` for dishes. These bypass the transaction RPCs and update single columns directly, avoiding the replace-all behaviour that would wipe child records.
- **Active/inactive status** — click the status badge to toggle immediately (optimistic update with rollback on error). Calls `toggleIngredientActive(id)` or `toggleDishActive(id)`. On server rejection, reverts to the previous state and refetches authoritative data.

These are the two most frequent single-field edits and should not require opening a drawer.

**Security:** Dedicated field-level server actions validate that only the intended field is being updated. Generic PATCH routes are not used for inline edits. Each action includes RBAC check (`menu_management.manage`), field-level audit logging (previous value, new value, field name), and `revalidatePath`.

**New feature-level components required** (under each page's `_components/`):
- `EditableCurrencyCell` — click-to-edit number input with save/cancel/loading states
- `StatusToggleCell` — optimistic toggle with rollback and refetch
- `useInlineEdit` hook — shared logic for inline edit lifecycle (focus, save, cancel, loading, error)

---

## 2. Dashboard Redesign

**Route:** `/menu-management`

### Row 1 — Stat Cards (4 across)

Using `Stat` / `StatGroup` components:

| Card | Displays | Interaction |
|------|----------|-------------|
| Total Dishes | Count with active/inactive split | Informational |
| Below GP Target | Count, red highlight if > 0 | Click filters the health table to problem dishes only |
| Missing Costing | Dishes with no ingredients or recipes | Click filters to incomplete dishes only |
| Avg GP% | Average across active dishes vs target | Shows comparison to target |

### Row 2 — Menu Health Table (Enhanced)

Upgrade the existing `MenuDishesTable`:
- **Sorting** — by GP%, price, cost (currently not sortable)
- **Search** — filter by dish name
- **Pagination** — 25 per page (currently renders all rows)
- **Row actions** — click dish name opens the dish drawer directly from dashboard
- **Accessibility** — warning icon alongside red colour for below-target rows
- **Missing ingredients** — items become clickable, opening the dish drawer to fix

### Row 3 — Navigation Cards (Compact)

Same three cards (Ingredients, Recipes, Dishes) but reduced in size. Secondary to the data above.

---

## 3. Ingredients Page

**Route:** `/menu-management/ingredients`

### Table

| Feature | Current | New |
|---------|---------|-----|
| Sorting | Already exists | Keep existing sorting by name, pack cost, portion cost, status |
| Filtering | Basic text search | `FilterPanel`: status, storage type, supplier, allergen flags. **Preserve** existing broad free-text search alongside structured filters. |
| Pagination | None | 25 per page |
| Inline edit | None | Pack cost (click to edit), status badge (click to toggle) |
| Expandable rows | Dish usage | Keep as-is |

### Drawer Form (Large, 42rem)

Organised into `FormSection` groups (from `ui-v2/forms/Form.tsx`) for semantic form structure. Allergens/Dietary and Notes sections are collapsible with auto-expand on validation error:

1. **Basics** — Name, description, default unit, storage type
2. **Supplier & Pack** — Supplier name, SKU, brand, pack size, pack size unit, pack cost, portions per pack
3. **Wastage & Shelf Life** — Wastage %, shelf life days
4. **Allergens & Dietary** (collapsible) — Allergen checkboxes (14), dietary flag checkboxes (6). Preserve existing unknown allergen/dietary cleanup UI.
5. **Notes** (collapsible) — Free text

**Drawer header:** Ingredient name (or "New Ingredient"), active/inactive toggle, "Price History" button opening a popover (not a separate modal).

**Table row actions preserved:** Keep a "Prices" action in the table row actions column so users can view price history without opening the drawer. The drawer header popover is an additional access point, not a replacement.

**Smart Import:** Stays as a separate modal — distinct workflow (paste text, AI parses, pre-fills the drawer).

**AI Review:** Button in drawer header. Results appear as inline alert banner at top of drawer content with "Apply" buttons per suggestion.

### File Decomposition

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `page.tsx` | ~250 | Layout, data loading, table, sort/filter/paginate pipeline |
| `_components/IngredientDrawer.tsx` | ~400 | Drawer form with FormSection groups |
| `_components/IngredientExpandedRow.tsx` | ~100 | Table expanded row content |
| `_components/PriceHistoryPopover.tsx` | ~120 | Price history display |
| `_components/EditableCurrencyCell.tsx` | ~80 | Inline pack cost editing |
| `_components/StatusToggleCell.tsx` | ~60 | Inline active/inactive toggle |

Replaces current 1,224-line monolith.

---

## 4. Recipes Page

**Route:** `/menu-management/recipes`

### Table

| Feature | Current | New |
|---------|---------|-----|
| Sorting | None | By name, portion cost, ingredient count, usage count, status |
| Filtering | None | `FilterPanel`: status, used/unused in dishes |
| Pagination | None | 25 per page |
| Inline edit | None | Status badge (click to toggle) |
| Expandable rows | Ingredient breakdown + dish usage | Keep as-is |

### Drawer Form (Large, 42rem)

Two zones:

**Top zone — Recipe Overview (fixed, non-scrolling):**
- Name (required)
- Yield quantity + yield unit (side by side, one row)
- Active toggle
- Description (textarea, collapsible)
- Instructions (textarea, collapsible)
- Notes (textarea, collapsible)

**Bottom zone — Ingredient Builder (scrollable):**
- Compact rows: ingredient name (select), quantity, unit — all on one line
- Expand a row (chevron) to reveal: yield %, wastage %, cost override, notes
- "Add Ingredient" button at bottom
- Remove button (trash icon) per row

**Drawer footer (pinned, always visible):**
- Cost summary: `Estimated prep cost: £X.XX total / £Y.YY per portion`
- Real-time updates as ingredients change
- Save and Cancel buttons

### Design Decision: Compact Ingredient Rows

Currently each ingredient shows all 6 fields simultaneously, making the form very tall. The new design shows only 3 essential fields per row (ingredient, qty, unit) with advanced fields behind an expand chevron. Most ingredients don't need yield% or wastage% overrides, reducing visual noise for the common case.

### File Decomposition

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `page.tsx` | ~250 | Layout, data loading, table, sort/filter/paginate pipeline |
| `_components/RecipeDrawer.tsx` | ~350 | Drawer form with ingredient builder |
| `_components/RecipeIngredientRow.tsx` | ~120 | Single ingredient row with expand |
| `_components/RecipeExpandedRow.tsx` | ~100 | Table expanded row content |

Replaces current 798-line monolith.

---

## 5. Dishes Page

**Route:** `/menu-management/dishes`

### Table

| Feature | Current | New |
|---------|---------|-----|
| Sorting | None | By name, price, cost, GP%, status |
| Filtering | Menu dropdown + text search | `FilterPanel`: menu, category, status, GP alert, Sunday lunch flag. **Preserve** URL-backed menu filter (bookmarkable). **Preserve** broad free-text search alongside structured filters. |
| Pagination | None | 25 per page |
| Inline edit | None | Selling price (click to edit), status badge (click to toggle) |
| Expandable rows | Ingredient/recipe/menu breakdown | Keep as-is |
| GP% display | Red text + target price hint | Red text + warning icon (accessibility). **Preserve** existing target price hint ("sell at £X.XX for target GP") as subtext on below-target rows. |

### Drawer (XL, 56rem) with Internal Tabs

**Drawer header (visible on all tabs):**
- Dish name (or "New Dish")
- Live summary: `Cost: £3.20 | Price: £12.95 | GP: 75.3%`
- GP% highlighted red with warning icon if below target
- Active toggle + Sunday lunch toggle

**Tab 1 — Overview:**
- Name (required)
- Selling price (required) — hint below: "Target price for X% GP: £Y.YY"
- Calories (optional)
- Guest description (textarea) — labelled "visible on website/menus"
- Internal notes (textarea) — labelled "staff only"

**Tab 2 — Composition:**

Two sections with headers:

*Recipes section:*
- Compact rows: recipe name (select), quantity — one line each. **Selects must show active items plus any currently-linked inactive items labelled "(inactive)"** to preserve editability of existing dishes.
- Expand for: yield %, wastage %, cost override, notes
- "Add Recipe" button
- Running subtotal: `Recipes: £X.XX`

*Ingredients section:*
- Compact rows: ingredient name (select), quantity, unit — one line each. **Same "(inactive)" labelling rule as recipes.**
- Expand for advanced fields
- "Add Ingredient" button
- Running subtotal: `Direct ingredients: £X.XX`

*Section footer:*
- `Total portion cost: £X.XX` (recipes + ingredients)
- Warning if an ingredient appears both directly and via a recipe (duplication alert)

**Tab 3 — Menus:**
- Current assignments displayed as cards
- Each card: menu name, category name, sort order, special/default-side flags, availability dates
- "Add to Menu" button
- Remove button per card
- Dropdowns use human-readable names (not codes)
- **New dish defaults:** When creating a new dish, the first menu assignment auto-populates with the currently selected menu filter (if any)

### File Decomposition

| File | Lines (est.) | Purpose |
|------|-------------|---------|
| `page.tsx` | ~300 | Layout, data loading, table, sort/filter/paginate pipeline |
| `_components/DishDrawer.tsx` | ~250 | Drawer shell with tabs and header |
| `_components/DishOverviewTab.tsx` | ~150 | Overview form fields |
| `_components/DishCompositionTab.tsx` | ~350 | Recipes + ingredients builder |
| `_components/DishMenusTab.tsx` | ~200 | Menu assignment cards |
| `_components/CompositionRow.tsx` | ~120 | Shared compact row with expand |
| `_components/DishExpandedRow.tsx` | ~100 | Table expanded row content |

Replaces current 1,536-line monolith.

---

## 6. Cross-Cutting Concerns

### Navigation
- Existing `HeaderNav` tabs (Dishes, Recipes, Ingredients) stay as-is (active page highlight already works via pathname matching)
- Back button returns to `/menu-management` dashboard
- **Preserve** "Menu Target" link in header actions on all three sub-pages

### Loading States
- `Skeleton` components for table rows during data load
- Drawer shows spinner while loading entity detail for edit

### Empty States
- `EmptyState` component with actionable guidance per section:
  - Ingredients: "No ingredients yet — add your first ingredient or use Smart Import to bulk-add from a supplier list"
  - Recipes: "No recipes yet — create a recipe to combine ingredients into reusable prep items"
  - Dishes: "No dishes yet — add a dish to start tracking costs and GP%"

### Unsaved Changes
- Drawer tracks dirty state via form comparison
- **All drawer close vectors** must funnel through the dirty-state check:
  - Escape key
  - Backdrop click
  - Header close button
  - Mobile swipe-to-close
  - Browser back/forward navigation (popstate listener)
  - Page unload (beforeunload event)
- Triggers `ConfirmDialog`: "You have unsaved changes. Discard?"

### Error Handling
- Server action errors: `Alert` (error variant) at top of drawer
- Validation errors: inline per field via `FormGroup` error prop
- Data load failures: `PageLayout` built-in error + retry pattern

### Keyboard Shortcuts
- `Escape` — close drawer (with unsaved changes check)
- `Cmd+Enter` / `Ctrl+Enter` — save drawer form
- `Tab` — standard field navigation

### Accessibility
- Drawer focus trapping (built into component)
- `aria-label` on inline-edit fields: "Edit pack cost for [ingredient name]"
- GP% alert rows: colour + icon (not colour-only)
- Status badges: text reads "Active" or "Inactive" (not colour-only)

---

## Components Used (all from ui-v2)

All components referenced in this spec already exist in `src/components/ui-v2/`:

| Component | Source | Used For |
|-----------|--------|----------|
| `Drawer` | `overlay/Drawer.tsx` | All edit forms (Large and XL sizes) |
| `Tabs` | `navigation/Tabs.tsx` | Dish drawer internal tabs |
| `DataTable` | `display/DataTable.tsx` | All list tables (with sorting, expansion) |
| `FilterPanel` | `display/FilterPanel.tsx` | Table filtering |
| `Pagination` | `navigation/Pagination.tsx` | Table pagination |
| `FormSection` | `forms/Form.tsx` | Ingredient drawer form grouping |
| `Stat` / `StatGroup` | `display/Stat.tsx` | Dashboard KPI cards |
| `Skeleton` | `feedback/Skeleton.tsx` | Loading states |
| `EmptyState` | `display/EmptyState.tsx` | Empty states |
| `ConfirmDialog` | `overlay/ConfirmDialog.tsx` | Unsaved changes, delete confirmation |
| `Alert` | `feedback/Alert.tsx` | Error display, AI review results |
| `Badge` / `StatusBadge` | `display/Badge.tsx` | Status, menu assignments, GP alerts |
| `FormGroup` | `forms/FormGroup.tsx` | All form field wrappers |
| `Input` / `Select` / `Textarea` | `forms/` | Form fields |
| `Button` | `forms/Button.tsx` | Actions |
| `Popover` | `overlay/Popover.tsx` | Price history display |
| `HeaderNav` | `navigation/HeaderNav.tsx` | Section navigation |
| `PageLayout` | `layout/PageLayout.tsx` | Page wrapper |

No new ui-v2 primitives are needed. Feature-level components are required under page `_components/` directories:
- `EditableCurrencyCell` — click-to-edit number input with save/cancel/loading
- `StatusToggleCell` — optimistic toggle with rollback and refetch
- `useInlineEdit` hook — shared logic for inline edit lifecycle

These are shared across ingredients and dishes pages.

---

## 7. Table Architecture: Sort + Filter + Paginate

DataTable owns sort state internally. Pagination is a separate component. To avoid sorting only the visible page, each page owns the full data pipeline:

```
Raw data → Filter (FilterPanel + free-text search) → Sort (page-level useMemo) → Paginate (slice) → DataTable (receives current page slice only)
```

- **Sorting** is controlled at the page level. DataTable's internal sort is disabled by not marking columns as `sortable`. Instead, the page renders sort controls (or custom column headers with sort indicators) and manages `sortColumn`/`sortDirection` in page state.
- **Filtering** combines `FilterPanel` structured filters with the existing broad free-text search.
- **Pagination** uses the `Pagination` component rendered below the table. Page state tracks `currentPage` and `itemsPerPage`.
- **The sorted/filtered/paginated slice** is passed to DataTable as the `data` prop.

This pattern ensures sorting always applies across the full dataset, not just the visible page.

---

## 8. Preserved Features

These features exist in the current implementation and must survive the redesign:

| Feature | Current Location | Preservation Strategy |
|---------|-----------------|----------------------|
| Row-level "Prices" action | Ingredients table actions column | Keep as table row action + add popover in drawer header |
| "Menu Target" link | Header actions on all sub-pages | Keep in header actions |
| Target price hint on below-GP rows | Dishes table GP% column | Keep as subtext on below-target rows |
| Recipe delete warning | Recipe delete ConfirmDialog | Keep entity-specific destructive copy |
| URL-backed menu filter | Dishes page URL params | Keep URL-backed filter; new dish defaults to selected menu |
| Inactive items in composition selects | Dish editor selects | Show active + currently-linked inactive items labelled "(inactive)" |
| Broad free-text search | Ingredients + dishes pages | Keep alongside FilterPanel structured filters |
| Unknown allergen/dietary cleanup UI | Ingredient editor | Keep in drawer allergens/dietary section |
| Delete actions on all entities | Table row actions | Keep Edit/Delete in table row actions column |

---

## 9. Server Action Changes Required

New dedicated field-level server actions (bypass transaction RPCs, update single columns):

| Action | Entity | Field | Notes |
|--------|--------|-------|-------|
| `updateIngredientPackCost(id, packCost)` | Ingredient | `pack_cost` | Also records price history entry |
| `toggleIngredientActive(id)` | Ingredient | `is_active` | Simple toggle |
| `updateDishPrice(id, sellingPrice)` | Dish | `selling_price` | Recalculates GP% via `menu_refresh_dish_calculations` |
| `toggleDishActive(id)` | Dish | `is_active` | Simple toggle |

Additionally, `updateMenuIngredient` must be updated to use `IngredientSchema.partial().parse(input)` for drawer-based full edits.

All new actions include: RBAC check, field-level audit logging (previous value, new value, field name), and `revalidatePath`.

---

## Out of Scope

- Bulk editing (select multiple ingredients, update prices) — future enhancement
- Drag-and-drop reordering of menu assignments — future enhancement
- Image upload for dishes — existing but unchanged
- Menu/category CRUD — managed elsewhere
- AI parsing improvements — existing Smart Import unchanged
- Print/export functionality — future enhancement

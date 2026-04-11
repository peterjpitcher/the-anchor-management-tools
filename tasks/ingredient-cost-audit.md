# Ingredient Cost Audit — Problem Dishes

**Date:** 2026-04-11
**Purpose:** Investigate unrealistic portion costs on 11 dishes flagged in the GP% report.

---

## Root Causes Found

Three systemic issues explain nearly all cost inflation:

### 1. Missing `portions_per_pack` (NULL) on several ingredients

When `portions_per_pack` is NULL, the `menu_get_latest_unit_cost()` function falls back to dividing by `pack_size`. If `pack_size` is also unhelpful (e.g. 2.5 for a 2.5kg bag), the "unit cost" becomes `pack_cost / 2.5` instead of `pack_cost / expected_servings`. In the worst case (pack_size also NULL), the **entire pack cost** is treated as one portion.

**Affected ingredients:**
| Ingredient | pack_cost | portions_per_pack | pack_size | Fallback unit_cost | Correct unit_cost (est.) |
|---|---|---|---|---|---|
| Chef's Menu Crispy Steak Cut Chips 2.5kg | 3.99 | NULL | 2.5 | 1.596 (3.99/2.5) | ~0.27 (3.99/15) |
| Lion Katsu Curry Cooking Sauce 2.27L | 14.59 | NULL | 2.27 | 6.43 (14.59/2.27) | ~1.46 (14.59/10) |
| Kuhne Crispy Fried Onions 1kg | 7.82 | NULL | 1 | 7.82 (7.82/1) | ~0.16 (7.82/50) |
| Sysco Classic Spinach & Ricotta Cannelloni 2kg | 19.99 | NULL | 2 | 9.995 (19.99/2) | ~3.33 (19.99/6) |
| Tartare Sauce | 0 | NULL | NULL | 0 | needs data entry |
| Bamboo Stick | 0 | NULL | NULL | 0 | needs data entry |

### 2. Scampi quantity = 12 pieces multiplied by per-piece cost

The Scampi ingredient has `portions_per_pack = 16` for a 1.8kg bag, meaning each "portion" is 1/16th of a bag (112.5g). But the dish specifies `quantity = 12, unit = piece`, and the cost function computes `unit_cost * quantity = 1.4494 * 12 = 17.39`. This treats each "piece" as 1/16th of a bag, so 12 pieces = 12/16ths of a bag = 75% of a 23.19 bag. In reality, 12 scampi pieces should be ONE serving portion.

### 3. The costing function correctly excludes `upgrade` items but counts the most expensive `choice` item per group

The updated `menu_refresh_dish_calculations` function (from migration `20260520000000`) correctly:
- Includes `included` and `removable` items in base cost
- Takes `MAX(line_cost)` per choice group (worst-case costing)
- Excludes `upgrade` items entirely

This means choice items (peas) add the more expensive option's cost, and upgrade items (sweet potato fries, steak cut chips upgrades, bacon, cheese, etc.) are excluded. This logic is sound but means the "choice" items always add the higher-cost alternative.

---

## Per-Dish Breakdown

### 1. Scampi & Chips — Portion cost: 19.22 (sells at 12.99, GP: -48%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Chef's Larder Breaded Scampi 1.8kg | 12 | piece | 23.19 | 16 | 1.4494 | **17.39** | **BUG: qty=12 x per-portion cost. Should be qty=1 portion** |
| Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | portion | 3.99 | NULL | **3.99** | **3.99** | **BUG: NULL portions_per_pack, falls to pack_size=2.5, gets 1.596; but wait, with qty=1 the included cost is 1.596** |
| Mushy Peas | 1 | portion | 4.49 | 32 | 0.14 | 0.14 | choice/Peas |
| Garden Peas | 1 | portion | 4.39 | 31.25 | 0.14 | 0.14 | choice/Peas (cheaper, so excluded by MAX rule) |
| Lemon | 1 | piece | 1.40 | 16 | 0.09 | 0.09 | removable |
| Sweet Potato Fries | 1 | portion | 8.29 | 10 | 0.83 | 0.83 | upgrade (excluded) |
| Tartare Sauce | 1 | portion | 0 | NULL | 0 | 0 | removable, no cost data |
| Bamboo Stick | 1 | each | 0 | NULL | 0 | 0 | removable, no cost data |

**Calculated base:** 17.39 (scampi) + 1.596 (chips) + 0.09 (lemon) = 19.08
**+ Choice max:** 0.14 (mushy peas)
**Total:** ~19.22 -- matches stored value

**Root cause:** Scampi qty=12 is catastrophic. The `portions_per_pack=16` means each "portion" is 1/16th of a bag. qty=12 means 12 such portions. Should be `qty=1, unit=portion` (one serving = one portion = 1/16th bag = 1.45). Also, Steak Cut Chips has NULL portions_per_pack adding ~1.60 instead of ~0.27.

**Corrected estimate:** 1.45 (scampi) + 0.27 (chips) + 0.14 (peas) + 0.09 (lemon) = **~1.95** (85% GP)

---

### 2. Sausage & Mash — Portion cost: 12.01 (sells at 13.99, GP: 14%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Brakes Cumberland Sausage Eights | 1 | portion | 36.80 | 10 | 3.68 | 3.68 | OK |
| Buttery Mash Potato 2kg | 1 | portion | 4.09 | 14 | 0.29 | 0.29 | OK |
| Bisto Gravy 1.8kg | 1 | portion | 9.99 | 125 | 0.08 | 0.08 | OK |
| Kuhne Crispy Fried Onions 1kg | 1 | portion | 7.82 | NULL | **7.82** | **7.82** | **BUG: NULL portions_per_pack, pack_size=1, so unit_cost = 7.82/1 = 7.82** |
| Garden Peas | 1 | portion | 4.39 | 31.25 | 0.14 | 0.14 | choice/Peas |
| Mushy Peas | 1 | portion | 4.49 | 32 | 0.14 | 0.14 | choice/Peas |
| Sweet Potato Fries | 1 | portion | 8.29 | 10 | 0.83 | 0.83 | upgrade (excluded) |

**Calculated:** 3.68 + 0.29 + 0.08 + 7.82 + 0.14 (peas MAX) = 12.01

**Root cause:** Kuhne Crispy Fried Onions has NULL portions_per_pack. The 1kg bag is being treated as 1 portion at 7.82. A sprinkling of crispy onions on sausage & mash would be ~20g per serving, so `portions_per_pack` should be ~50.

**Corrected estimate:** 3.68 + 0.29 + 0.08 + 0.16 (7.82/50) + 0.14 = **~4.35** (69% GP)

---

### 3. Spinach & Ricotta Cannelloni — Portion cost: 10.90 (sells at 13.99, GP: 22%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Sysco Classic Cannelloni 2kg | 1 | each | 19.99 | NULL | **9.995** | **9.995** | **BUG: NULL portions_per_pack, falls to pack_size=2, so 19.99/2 = 9.995** |
| Garlic Bread Slices | 2 | slice | 13.18 | 85 | 0.16 | 0.31 | OK |
| Tomatoes | 1 | slice | 0.99 | 6 | 0.17 | 0.17 | OK |
| Butterhead Salad | 1 | portion | 1.00 | 3 | 0.33 | 0.33 | OK |
| Cucumber | 1 | portion | 0.99 | 10 | 0.10 | 0.10 | OK |

**Calculated:** 9.995 + 0.31 + 0.17 + 0.33 + 0.10 = 10.90

**Root cause:** Cannelloni 2kg has NULL portions_per_pack. A 2kg tray likely serves 6 portions. Unit cost should be 19.99/6 = 3.33.

**Corrected estimate:** 3.33 + 0.31 + 0.17 + 0.33 + 0.10 = **~4.24** (70% GP)

---

### 4. Chicken Katsu Curry — Portion cost: 10.64 (sells at 13.99, GP: 24%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| American Style Chicken Fillets | 2 | each | 20.49 | 24 | 0.85 | 1.71 | OK (2 fillets per curry) |
| Long Grain Rice Portions | 1 | portion | 21.42 | 36 | 0.60 | 0.60 | OK |
| Lion Katsu Curry Sauce 2.27L | 1 | portion | 14.59 | NULL | **6.43** | **6.43** | **BUG: NULL portions_per_pack, falls to pack_size=2.27L, so 14.59/2.27 = 6.43** |
| Roquito Chilli Peppers | 6 | piece | 6.49 | 32 | 0.20 | 1.22 | OK |
| Limes | 1 | piece | 1.18 | 20 | 0.06 | 0.06 | OK |
| Tomatoes | 1 | slice | 0.99 | 6 | 0.17 | 0.17 | removable |
| Butterhead Salad | 1 | portion | 1.00 | 3 | 0.33 | 0.33 | removable |
| Cucumber | 1 | portion | 0.99 | 10 | 0.10 | 0.10 | removable |

**Calculated:** 1.71 + 0.60 + 6.43 + 1.22 + 0.06 + 0.17 + 0.33 + 0.10 = 10.62 (close to 10.64, rounding)

**Root cause:** Katsu sauce 2.27L has NULL portions_per_pack. A 2.27L bottle likely serves ~10 portions (~225ml each). Unit cost should be 14.59/10 = 1.46.

**Corrected estimate:** 1.71 + 0.60 + 1.46 + 1.22 + 0.06 + 0.17 + 0.33 + 0.10 = **~5.65** (60% GP)

---

### 5. Katsu Chicken Burger — Portion cost: 8.23 (sells at 12.99, GP: 37%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| American Style Chicken Fillets | 1 | each | 20.49 | 24 | 0.85 | 0.85 | OK |
| Lion Katsu Curry Sauce 2.27L | 1 | portion | 14.59 | NULL | **6.43** | **6.43** | **BUG: same as above** |
| Floured Baps | 1 | each | 9.75 | 48 | 0.20 | 0.20 | OK |
| Straight Cut Chips | 1 | portion | 13.19 | 32 | 0.41 | 0.41 | OK |
| Butterhead Salad | 1 | portion | 1.00 | 3 | 0.33 | 0.33 | OK |
| Steak Cut Chips | 1 | portion | 3.99 | NULL | 1.60 | 1.60 | upgrade (excluded) |
| Hash Browns | 1 | each | 2.79 | 26 | 0.11 | 0.11 | upgrade (excluded) |
| Cheddar Slices | 1 | slice | 1.39 | 10 | 0.14 | 0.14 | upgrade (excluded) |
| Onion Rings | 1 | each | 2.49 | 10 | 0.25 | 0.25 | upgrade (excluded) |
| Back Bacon | 1 | slice | 1.49 | 5 | 0.30 | 0.30 | upgrade (excluded) |
| Sweet Potato Fries | 1 | portion | 8.29 | 10 | 0.83 | 0.83 | upgrade (excluded) |

**Calculated base (included only):** 0.85 + 6.43 + 0.20 + 0.41 + 0.33 = 8.22

**Root cause:** Katsu sauce with NULL portions_per_pack (same ingredient as Chicken Katsu Curry). The sauce on a burger would be even less than in a curry dish.

**Corrected estimate:** 0.85 + 1.46 + 0.20 + 0.41 + 0.33 = **~3.25** (75% GP)

---

### 6. Chicken Goujon Wrap with Chips — Portion cost: 5.46 (sells at 9.99, GP: 45%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Chicken Breast Goujons | 4 | each | 12.99 | 12 | 1.08 | 4.33 | See analysis below |
| Tortilla Wraps 8 Pack | 1 | each | 0.99 | 8 | 0.12 | 0.12 | OK |
| Tomatoes | 1 | slice | 0.99 | 6 | 0.17 | 0.17 | OK |
| Butterhead Salad | 1 | portion | 1.00 | 3 | 0.33 | 0.33 | OK |
| Cucumber | 1 | portion | 0.99 | 10 | 0.10 | 0.10 | OK |
| Straight Cut Chips | 1 | portion | 13.19 | 32 | 0.41 | 0.41 | OK |
| Sweet Potato Fries | 1 | portion | 8.29 | 10 | 0.83 | 0.83 | upgrade (excluded) |
| Steak Cut Chips | 1 | portion | 3.99 | NULL | 1.60 | 1.60 | upgrade (excluded) |

**Calculated:** 4.33 + 0.12 + 0.17 + 0.33 + 0.10 + 0.41 = 5.46

**Analysis:** Chicken goujons at 12.99/12 = 1.08 each, x4 = 4.33. The goujon ingredient has `portions_per_pack=12` for a 2kg bag. If 12 goujons per bag and 4 per wrap, that's 4.33 -- this seems legitimate but expensive. The goujons are the dominant cost here.

**Possible issue:** Check if the 2kg bag actually contains more than 12 goujons. If it's ~24 goujons (each ~83g), then portions_per_pack should be 24, making 4 goujons cost 2.17 instead of 4.33.

**Corrected estimate (if 24 per bag):** 2.17 + 0.12 + 0.17 + 0.33 + 0.10 + 0.41 = **~3.30** (67% GP)

---

### 7. 4 Chicken Goujons with Chips — Portion cost: 4.74 (sells at 8.49, GP: 44%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Straight Cut Chips | 1 | portion | 13.19 | 32 | 0.41 | 0.41 | OK |
| Chicken Breast Goujons | 4 | each | 12.99 | 12 | 1.08 | 4.33 | Same as above |
| Steak Cut Chips | 1 | portion | 3.99 | NULL | 1.60 | 1.60 | upgrade (excluded) |
| Sweet Potato Fries | 1 | portion | 8.29 | 10 | 0.83 | 0.83 | upgrade (excluded) |

**Calculated:** 0.41 + 4.33 = 4.74

**Same issue as Goujon Wrap.** If goujons are actually 24/bag: cost drops to 0.41 + 2.17 = **~2.58** (70% GP)

---

### 8. Chunky Chips — Portion cost: 1.60 (sells at 4.49, GP: 64%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | portion | 3.99 | NULL | **1.596** | **1.596** | **BUG: NULL portions_per_pack** |

**Root cause:** Steak Cut Chips 2.5kg has NULL portions_per_pack. Falls back to `pack_cost / pack_size = 3.99 / 2.5 = 1.596`. A 2.5kg bag should serve ~15 portions of chunky chips (~165g each). Unit cost should be 3.99/15 = 0.27.

**Corrected estimate:** **~0.27** (94% GP)

---

### 9. 6 Onion Rings — Portion cost: 1.49 (sells at 3.49, GP: 57%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Chef's Larder Battered Onion Rings | 6 | each | 2.49 | 10 | 0.249 | 1.494 | Borderline |

**Analysis:** 2.49 per 750g bag, 10 portions per pack. Each "portion" is 75g. Serving 6 onion rings as 6 "portions" means 6 x 75g = 450g of onion rings per side. This seems like too much. If 6 individual rings weigh ~120g total, the cost should be proportionally less.

**Possible issue:** The `portions_per_pack` of 10 might represent "servings of 6 rings" rather than individual rings. If so, qty should be 1 (one serving) not 6 (six servings). Check the pack -- if 750g bag contains roughly 60 onion rings, then each "portion" of 10 = 6 rings, and qty should be 1.

**Corrected estimate (if qty=1):** **~0.25** (93% GP)

---

### 10. Apple Crumble — Portion cost: 2.05 (sells at 5.99, GP: 66%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Chef's Menu Apple Crumble 12 x 175g | 1 | each | 21.29 | 12 | 1.77 | 1.77 | OK |
| Ready To Serve Custard | 1 | portion | 0.55 | 4 | 0.14 | 0.14 | choice/Accompaniment |
| Vanilla Ice Cream 4L | 2 | portion | 4.99 | 36 | 0.14 | 0.28 | choice/Accompaniment |

**Calculated:** 1.77 + MAX(0.14, 0.28) = 1.77 + 0.28 = 2.05

**Analysis:** This dish is actually costed correctly. The crumble is 1.77 (individual portion from a box of 12) and the choice accompaniment adds the more expensive option (ice cream x2 scoops at 0.28). The 66% GP is just below the 70% target, which is close but not alarming.

**Possible improvement:** The ice cream qty=2 might be worth reviewing (2 scoops vs 1), but this is a real cost. The crumble itself at 1.77 per portion from a 21.29 box is the main cost driver and appears correct.

**No fix needed** -- this is a genuinely low-margin item due to the individual crumble portions being relatively expensive.

---

### 11. Lamb Shank — Portion cost: 8.60 (sells at 22.99, GP: 63%)

| Ingredient | Qty | Unit | pack_cost | portions_per_pack | Unit Cost | Line Cost | Issue |
|---|---|---|---|---|---|---|---|
| Slow Cooked Lamb Shanks 6 x 475g | 1 | portion | 48.99 | 6 | 8.17 | 8.17 | OK |
| Buttery Mash Potato 2kg | 1 | portion | 4.09 | 14 | 0.29 | 0.29 | OK |
| Garden Peas | 1 | portion | 4.39 | 31.25 | 0.14 | 0.14 | choice/Peas (only one choice, so included) |

**Calculated:** 8.17 + 0.29 + 0.14 = 8.60

**Analysis:** This is correctly costed. Lamb shanks at 48.99 for 6 = 8.17 per shank is the real cost. At 22.99 selling price, the 63% GP is just below the 70% target but this is a premium protein item where 60-65% GP is typical.

**No fix needed** -- genuinely expensive protein. Consider whether the selling price should be adjusted rather than the costing.

---

## Summary of Recommended Fixes

### Priority 1: Set `portions_per_pack` on ingredients with NULL values

These NULL values are causing the fallback to `pack_cost / pack_size` which gives wildly wrong unit costs.

| Ingredient | Current portions_per_pack | Recommended portions_per_pack | Impact (dishes affected) |
|---|---|---|---|
| **Chef's Menu Crispy Steak Cut Chips 2.5kg** | NULL | ~15 | Scampi & Chips, Chunky Chips, 4 Goujons w/ Chips, Goujon Wrap, Katsu Burger (all as upgrade except Chunky Chips) |
| **Lion Katsu Curry Cooking Sauce 2.27L** | NULL | ~10 | Chicken Katsu Curry, Katsu Chicken Burger |
| **Kuhne Crispy Fried Onions 1kg** | NULL | ~50 | Sausage & Mash |
| **Sysco Classic Spinach & Ricotta Cannelloni 2kg** | NULL | ~6 | Spinach & Ricotta Cannelloni |

### Priority 2: Fix Scampi quantity

| Dish | Ingredient | Current qty/unit | Recommended qty/unit | Rationale |
|---|---|---|---|---|
| **Scampi & Chips** | Breaded Scampi 1.8kg | 12 piece | 1 portion | qty=12 treats each as a full portion (1/16th bag). One serving of 12 scampi pieces IS one portion |

### Priority 3: Verify Chicken Goujon portions_per_pack

| Ingredient | Current portions_per_pack | Question | Dishes affected |
|---|---|---|---|
| **Chicken Breast Goujons** | 12 | Is it really 12 goujons per 2kg bag? Seems low (~167g each). If 24 per bag, cost halves | 4 Goujons w/ Chips, Goujon Wrap |

### Priority 4: Verify Onion Ring quantity

| Dish | Ingredient | Current qty/unit | Question |
|---|---|---|---|
| **6 Onion Rings** | Battered Onion Rings | 6 each | Does portions_per_pack=10 mean 10 individual rings or 10 servings? If servings, qty should be 1 |

### No Fix Needed

| Dish | Portion Cost | GP% | Reason |
|---|---|---|---|
| Apple Crumble | 2.05 | 66% | Correctly costed, just below target |
| Lamb Shank | 8.60 | 63% | Correctly costed, premium protein |

---

## Estimated GP% Impact After Fixes

| Dish | Current GP% | Estimated GP% After Fix | Change |
|---|---|---|---|
| Scampi & Chips | -48% | ~85% | +133pp |
| Sausage & Mash | 14% | ~69% | +55pp |
| Spinach & Ricotta Cannelloni | 22% | ~70% | +48pp |
| Chicken Katsu Curry | 24% | ~60% | +36pp |
| Katsu Chicken Burger | 37% | ~75% | +38pp |
| Chunky Chips | 64% | ~94% | +30pp |
| Chicken Goujon Wrap | 45% | ~67% | +22pp |
| 4 Goujons with Chips | 44% | ~70% | +26pp |
| 6 Onion Rings | 57% | ~93% | +36pp (if qty fix confirmed) |
| Apple Crumble | 66% | 66% | no change |
| Lamb Shank | 63% | 63% | no change |

---

## Action Items

1. **Update `portions_per_pack`** on the 4 ingredients listed in Priority 1 (requires checking actual pack yields with kitchen staff)
2. **Change Scampi qty** from 12 to 1 (and unit to "portion")
3. **Verify with kitchen**: how many goujons are in the 2kg bag? How many onion rings are in the 750g bag?
4. **After fixes**: trigger `menu_refresh_dish_calculations` on all affected dishes to recalculate stored portion_cost and gp_pct
5. **Consider**: adding a validation rule or warning when `portions_per_pack` is NULL on an ingredient that is used in dishes -- this prevents silent cost inflation

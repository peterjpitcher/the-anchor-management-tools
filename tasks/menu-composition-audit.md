# Menu Composition Audit

**Date**: 2026-04-11
**Sources**: Menu PDF (March 2026), Ingredients DOCX, Supabase Database

---

## A. Price Check

| # | Dish | Menu PDF | DB Price | Status |
|---|------|----------|----------|--------|
| 1 | Fish & Chips | £15 | £15 | OK |
| 2 | Half Fish & Chips | £12 | £12 | OK |
| 3 | Scampi & Chips | £13 | £13 | OK |
| 4 | Jumbo Sausage & Chips | £13 | £13 | OK |
| 5 | Bangers & Mash | £14 | £14 | OK |
| 6 | Beef & Ale Pie | £16 | £16 | OK |
| 7 | Chicken & Wild Mushroom Pie | £15 | £15 | OK |
| 8 | Chicken, Ham Hock & Leek Pie | £15 | £15 | OK |
| 9 | Butternut Squash, Mixed Bean & Mature Cheddar Pie | £15 | £15 | OK |
| 10 | Classic Beef Burger | £11 | £11 | OK |
| 11 | Chicken Burger | £11 | £11 | OK |
| 12 | Spicy Chicken Burger | £11 | £11 | OK |
| 13 | Garden Veg Burger | £11 | £11 | OK |
| 14 | Beef Stack | £14 | £14 | OK |
| 15 | Chicken Stack | £14 | £14 | OK |
| 16 | Spicy Chicken Stack | £14 | £14 | OK |
| 17 | Garden Stack | £14 | £14 | OK |
| 18 | Katsu Chicken Burger | £14 | £14 | OK |
| 19 | Lasagne | £15 | £15 | OK |
| 20 | Mac & Cheese | £14 | £14 | OK |
| 21 | Spinach & Ricotta Cannelloni | £14 | £14 | OK |
| 22 | Chicken Katsu Curry | £14 | £14 | OK |
| 23 | Rustic Classic | £12 | £12 | OK |
| 24 | Simply Salami | £13 | £13 | OK |
| 25 | Fully Loaded | £14 | £14 | OK |
| 26 | Nice & Spicy | £14 | £14 | OK |
| 27 | The Garden Club | £13 | £13 | OK |
| 28 | Smoked Chilli Chicken | £14 | £14 | OK |
| 29 | Chicken & Pesto | £14 | £14 | OK |
| 30 | Barbecue Chicken | £14 | £14 | OK |
| 31 | Garlic Bread | £10 | £10 | OK |
| 32 | Garlic Bread + Mozzarella | £12 | £12 | OK |
| 33 | Chicken Goujon Wrap | £10 | £10 | OK |
| 34 | Fish Finger Wrap | £10 | £10 | OK |
| 35 | Chicken Goujons & Chips | £9 | £9 | OK |
| 36 | Salt & Chilli Squid & Chips | £9 | £9 | OK |
| 37 | Fish Fingers & Chips | £9 | £9 | OK |
| 38 | Chips | £4 | £4 | OK |
| 39 | Chunky Chips | £5 | £5 | OK |
| 40 | Cheesy Chips | £6 | £6 | OK |
| 41 | Sweet Potato Fries | £5 | £5 | OK |
| 42 | 6 Onion Rings | £4 | £4 | OK |
| 43 | Sticky Toffee Pudding | £6 | £6 | OK |
| 44 | Apple Crumble | £6 | £6 | OK |
| 45 | Chocolate Fudge Brownie | £6 | £6 | OK |
| 46 | Chocolate Fudge Cake | £6 | £6 | OK |
| 47 | Ice Cream Sundae | £5 | £5 | OK |
| 48 | Americano | £3 | £3 | OK |
| 49 | Latte / Cappuccino | £3 | £3 | OK |
| 50 | Hot Chocolate | £3 | £3 | OK |
| 51 | Individual Pot of Tea | £3 | NOT FOUND | :x: MISSING |

**Summary**: 0 price mismatches, 1 missing dishes

### Missing from DB
- Individual Pot of Tea

## D. Dietary Flags Check

| # | Dish | Menu PDF Flags | DB Flags | Status |
|---|------|---------------|----------|--------|
| 1 | Fish & Chips | - | gluten_free, vegan, vegetarian | OK  |
| 2 | Half Fish & Chips | - | gluten_free, vegan, vegetarian | OK  |
| 3 | Scampi & Chips | - | gluten_free, vegan, vegetarian | OK  |
| 4 | Jumbo Sausage & Chips | - | gluten_free, vegan, vegetarian | OK  |
| 5 | Bangers & Mash | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 6 | Beef & Ale Pie | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 7 | Chicken & Wild Mushroom Pie | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 8 | Chicken, Ham Hock & Leek Pie | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 9 | Butternut Squash, Mixed Bean & Mature Cheddar Pie | V | dairy_free, gluten_free, vegan, vegetarian | OK Extra in DB: dairy_free, gluten_free, vegan |
| 10 | Classic Beef Burger | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 11 | Chicken Burger | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 12 | Spicy Chicken Burger | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 13 | Garden Veg Burger | V | dairy_free, gluten_free, vegan, vegetarian | OK Extra in DB: dairy_free, gluten_free, vegan |
| 14 | Beef Stack | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 15 | Chicken Stack | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 16 | Spicy Chicken Stack | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 17 | Garden Stack | V | dairy_free, gluten_free, vegan, vegetarian | OK Extra in DB: dairy_free, gluten_free, vegan |
| 18 | Katsu Chicken Burger | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 19 | Lasagne | - | vegan, vegetarian | OK  |
| 20 | Mac & Cheese | V | vegan, vegetarian | OK Extra in DB: vegan |
| 21 | Spinach & Ricotta Cannelloni | V | vegan, vegetarian | OK Extra in DB: vegan |
| 22 | Chicken Katsu Curry | - | dairy_free, gluten_free, halal, vegan, vegetarian | OK  |
| 23 | Rustic Classic | V, VEO, GFO | - | :warning: MISSING Missing in DB: gluten_free_option, vegan_option, vegetarian |
| 24 | Simply Salami | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 25 | Fully Loaded | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 26 | Nice & Spicy | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 27 | The Garden Club | V, VEO, GFO | - | :warning: MISSING Missing in DB: gluten_free_option, vegan_option, vegetarian |
| 28 | Smoked Chilli Chicken | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 29 | Chicken & Pesto | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 30 | Barbecue Chicken | GFO | - | :warning: MISSING Missing in DB: gluten_free_option |
| 31 | Garlic Bread | VE, GFO | - | :warning: MISSING Missing in DB: gluten_free_option, vegan |
| 32 | Garlic Bread + Mozzarella | V, GFO | - | :warning: MISSING Missing in DB: gluten_free_option, vegetarian |
| 33 | Chicken Goujon Wrap | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 34 | Fish Finger Wrap | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 35 | Chicken Goujons & Chips | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 36 | Salt & Chilli Squid & Chips | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 37 | Fish Fingers & Chips | - | dairy_free, gluten_free, vegan, vegetarian | OK  |
| 38 | Chips | VE | dairy_free, gluten_free, vegan, vegetarian | OK Extra in DB: dairy_free, gluten_free, vegetarian |
| 39 | Chunky Chips | VE | gluten_free, vegan, vegetarian | OK Extra in DB: gluten_free, vegetarian |
| 40 | Cheesy Chips | V | dairy_free, gluten_free, vegan, vegetarian | OK Extra in DB: dairy_free, gluten_free, vegan |
| 41 | Sweet Potato Fries | VE, GF | gluten_free, vegan, vegetarian | OK Extra in DB: vegetarian |
| 42 | 6 Onion Rings | VE | dairy_free, vegan, vegetarian | OK Extra in DB: dairy_free, vegetarian |
| 43 | Sticky Toffee Pudding | V, GF | gluten_free, vegetarian | OK  |
| 44 | Apple Crumble | V | vegetarian | OK  |
| 45 | Chocolate Fudge Brownie | V, GF | gluten_free, vegetarian | OK  |
| 46 | Chocolate Fudge Cake | V | vegetarian | OK  |
| 47 | Ice Cream Sundae | V | vegan, vegetarian | OK Extra in DB: vegan |
| 48 | Americano | - | - | OK  |
| 49 | Latte / Cappuccino | - | - | OK  |
| 50 | Hot Chocolate | - | - | OK  |
| 51 | Individual Pot of Tea | - | NOT FOUND | :x: |

**Summary**: 10 dietary flag issues

- Rustic Classic: PDF has V,VEO,GFO but DB missing gluten_free_option, vegan_option, vegetarian
- Simply Salami: PDF has GFO but DB missing gluten_free_option
- Fully Loaded: PDF has GFO but DB missing gluten_free_option
- Nice & Spicy: PDF has GFO but DB missing gluten_free_option
- The Garden Club: PDF has V,VEO,GFO but DB missing gluten_free_option, vegan_option, vegetarian
- Smoked Chilli Chicken: PDF has GFO but DB missing gluten_free_option
- Chicken & Pesto: PDF has GFO but DB missing gluten_free_option
- Barbecue Chicken: PDF has GFO but DB missing gluten_free_option
- Garlic Bread: PDF has VE,GFO but DB missing gluten_free_option, vegan
- Garlic Bread + Mozzarella: PDF has V,GFO but DB missing gluten_free_option, vegetarian

## B. Composition Check

### Fish & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Jumbo fish | 1 | No | Chef's Larder 6 Jumbo Battered Cod Fillets | 1 | included | - | - | OK |
| Chunky chips | 1 | No | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | included | - | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Tartare sauce | 1 | No | Tartare Sauce | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Lemon wedge | 1 | No | Tesco Lemons 4 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Bamboo stick | 1 | No | Bamboo Stick | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Half Fish & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Half fish | 1 | No | **NOT FOUND** | - | - | - | - | :x: Missing |
| Chunky chips | 1 | No | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | included | - | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Tartare sauce | 1 | No | Tartare Sauce | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Lemon wedge | 1 | No | Tesco Lemons 4 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Bamboo stick | 1 | No | Bamboo Stick | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

**Extra DB ingredients not in DOCX**:
- Chef's Larder 6 Jumbo Battered Cod Fillets (qty=0.5, included, group=none, upgrade=none)

### Scampi & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Scampi | 1 | No | Chef's Larder Breaded Scampi 1.8kg | 1 | included | - | - | OK |
| Chunky chips | 1 | No | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | included | - | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Tartare sauce | 1 | No | Tartare Sauce | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Lemon wedge | 1 | No | Tesco Lemons 4 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Bamboo stick | 1 | No | Bamboo Stick | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Jumbo Sausage & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Jumbo sausage | 1 | No | Blakemans Cooked Pork Jumbo Sausage 2kg | 1 | included | - | - | OK |
| Chunky chips | 1 | No | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | included | - | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Bangers & Mash

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Sausage | 3 | No | Brakes Cumberland Sausage Eights | 1 | included | - | - | :warning: Qty 1 vs DOCX 3;  |
| Mash | 1 | No | Chef's Larder Buttery Mash Potato 2kg | 1 | included | - | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Gravy | 1 | No | Bisto Gluten Free Fine Gravy Granules 1.8kg | 1 | included | - | - | OK |
| Crispy onions | 1 | No | Kuhne Crispy Fried Onions 1kg | 1 | included | - | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Side upgrade | £2 | OK |

### Beef & Ale Pie

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Beef and ale pie | 1 | No | **NOT FOUND** | - | - | - | - | :x: Missing |
| Mash | 1 | Yes | Chef's Larder Buttery Mash Potato 2kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Gravy | 1 | No | Bisto Gluten Free Fine Gravy Granules 1.8kg | 1 | included | - | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

**Extra DB ingredients not in DOCX**:
- Toms Pies Steak & Ale Pie (qty=1, included, group=none, upgrade=none)

### Chicken & Wild Mushroom Pie

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken & Wild Mushroom Pie | 1 | No | Toms Pies Chicken & Wild Mushroom Pie | 1 | included | - | - | OK |
| Mash | 1 | Yes | Chef's Larder Buttery Mash Potato 2kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Gravy | 1 | No | Bisto Gluten Free Fine Gravy Granules 1.8kg | 1 | included | - | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Chicken, Ham Hock & Leek Pie

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken, Ham Hock & Leek Pie | 1 | No | Tom's Pies Chicken, Ham Hock & Leek Pie | 1 | included | - | - | OK |
| Mash | 1 | Yes | Chef's Larder Buttery Mash Potato 2kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Gravy | 1 | No | Bisto Gluten Free Fine Gravy Granules 1.8kg | 1 | included | - | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Butternut Squash, Mixed Bean & Mature Cheddar Pie

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Butternut Squash, Mixed Bean & Mature Cheddar Pie | 1 | No | **NOT FOUND** | - | - | - | - | :x: Missing |
| Mash | 1 | Yes | Chef's Larder Buttery Mash Potato 2kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Side upgrade | - | OK |
| Mushy peas | 1 | Yes | Chef's Larder Mushy Peas 2.61kg | 1 | choice | Peas | - | OK |
| Garden peas | 1 | Yes | Chef's Larder Garden Peas 2.5kg | 1 | choice | Peas | - | OK |
| Gravy | 1 | No | Bisto Gluten Free Fine Gravy Granules 1.8kg | 1 | included | - | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Side upgrade | £2 | OK |

**Extra DB ingredients not in DOCX**:
- Toms Pies Butternut Squash, Mixed Bean & Cheese Pie (qty=1, included, group=none, upgrade=none)

### Classic Beef Burger

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Beef burger | 1 | No | Chef's Essentials Quarter Pounder Burgers 4.52kg | 1 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | Burger extras | £1 | OK |
| Onion ring | 2 | Yes | Chef's Larder Battered Onion Rings | 2 | upgrade | Burger extras | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | Burger extras | £2 | OK |

### Chicken Burger

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken burger | 1 | No | Chef's Larder 24 American Style Chicken Fillets | 1 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | Burger extras | £1 | OK |
| Onion ring | 2 | Yes | Chef's Larder Battered Onion Rings | 2 | upgrade | Burger extras | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | Burger extras | £2 | OK |

### Spicy Chicken Burger

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Spicy chicken burger | 1 | No | Chef's Larder 24 Hot and Spicy Chicken Fillets 2.16kg | 1 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | Burger extras | £1 | OK |
| Onion ring | 2 | Yes | Chef's Larder Battered Onion Rings | 2 | upgrade | Burger extras | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | Burger extras | £2 | OK |

### Garden Veg Burger

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Garden veg burger | 1 | No | **NOT FOUND** | - | - | - | - | :x: Missing |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 1 | Yes | Chef's Larder Battered Onion Rings | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Bacon | 1 | No | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | - | £2 | :warning: inclusion=upgrade expected=included;  |

**Extra DB ingredients not in DOCX**:
- The Fat Chef Bangkok Bad Boy Burger (qty=1, included, group=none, upgrade=none)

### Beef Stack

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Beef burger | 2 | No | Chef's Essentials Quarter Pounder Burgers 4.52kg | 2 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 2 | No | Chef's Larder Battered Onion Rings | 2 | included | - | - | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | - | £2 | OK |

### Chicken Stack

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken burger | 2 | No | Chef's Larder 24 American Style Chicken Fillets | 2 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | No | Chef's Larder Hash Browns | 1 | included | - | - | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 1 | Yes | Chef's Larder Battered Onion Rings | 1 | upgrade | - | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | - | £2 | OK |

### Spicy Chicken Stack

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Spicy chicken burger | 2 | No | Chef's Larder 24 Hot and Spicy Chicken Fillets 2.16kg | 2 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | No | Chef's Larder Hash Browns | 1 | included | - | - | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 1 | Yes | Chef's Larder Battered Onion Rings | 1 | upgrade | - | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | - | £2 | OK |

### Garden Stack

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Veg burger | 2 | No | **NOT FOUND** | - | - | - | - | :x: Missing |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=choice;  |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 1 | Yes | Chef's Larder Battered Onion Rings | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Bacon | 11 | No | Tesco Unsmoked Back Bacon 300g | 1 | included | - | - | :warning: Qty 1 vs DOCX 11;  |

**Extra DB ingredients not in DOCX**:
- The Fat Chef Bangkok Bad Boy Burger (qty=2, included, group=none, upgrade=none)

### Katsu Chicken Burger

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken burger | 1 | No | Chef's Larder 24 American Style Chicken Fillets | 1 | included | - | - | OK |
| Katsu curry sauce | 1 | No | Lion Katsu Curry Cooking Sauce 2.27L | 1 | included | - | - | OK |
| Bun | 1 | No | Chef's Larder 48 Floured Baps | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |
| Slice of tomato | 1 | Yes | **NOT FOUND** | - | - | - | - | :x: Missing |
| Lettuce | 1 | Yes | Tesco Butterhead Salad 80g | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Hash brown | 1 | Yes | Chef's Larder Hash Browns | 1 | upgrade | - | £2 | OK |
| Slice of cheese | 1 | Yes | Creamfields Mild Cheddar Slices 200g | 1 | upgrade | - | £1 | OK |
| Onion ring | 1 | Yes | Chef's Larder Battered Onion Rings | 1 | upgrade | - | £1 | OK |
| Bacon | 1 | Yes | Tesco Unsmoked Back Bacon 300g | 1 | upgrade | - | £2 | OK |

### Lasagne

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Lasagne | 1 | No | KK Beef Lasagne | 1 | included | - | - | OK |
| Garlic bread | 2 | No | Brakes Essentials Garlic & Parsley Bread Slices | 2 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | included | - | - | OK |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | included | - | - | OK |

### Mac & Cheese

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Mac and cheese | 1 | No | Brakes Essentials Macaroni Cheese | 1 | included | - | - | OK |
| Garlic bread | 2 | No | Brakes Essentials Garlic & Parsley Bread Slices | 2 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | included | - | - | OK |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | included | - | - | OK |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | included | - | - | OK |

### Spinach & Ricotta Cannelloni

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Spinach & Ricotta Cannelloni | 1 | No | Sysco Classic Spinach & Ricotta Cannelloni 2kg | 1 | included | - | - | OK |
| Garlic bread | 2 | No | Brakes Essentials Garlic & Parsley Bread Slices | 2 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | included | - | - | OK |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | included | - | - | OK |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | included | - | - | OK |

### Chicken Katsu Curry

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chicken burger | 2 | No | Chef's Larder 24 American Style Chicken Fillets | 2 | included | - | - | OK |
| Rice | 1 | No | Brakes Long Grain Rice Portions | 1 | included | - | - | OK |
| Katsu curry sauce | 1 | No | Lion Katsu Curry Cooking Sauce 2.27L | 1 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | removable | - | - | :warning: inclusion=removable expected=included;  |
| Chillies | 6 | No | Roquito Chilli Pepper Pearls 793g | 6 | included | - | - | OK |
| Lime wedge | 1 | No | Tesco Limes Minimum 5 Pack | 1 | included | - | - | OK |

### Rustic Classic
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Simply Salami
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Fully Loaded
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Nice & Spicy
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### The Garden Club
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Smoked Chilli Chicken
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Chicken & Pesto
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Barbecue Chicken
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Garlic Bread
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Garlic Bread + Mozzarella
No composition data in DOCX or DB (expected for Stone-Baked Pizza)

### Chicken Goujon Wrap

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Goujon | 4 | No | Chicken Breast Goujons | 4 | included | - | - | OK |
| Wrap | 1 | No | H.W. Nevills Plain White Tortilla Wraps 8 Pack | 1 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | included | - | - | OK |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | included | - | - | OK |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Fish Finger Wrap

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Fish fingers | 3 | No | Chef's Essentials 60 White Fillet Fish Fingers 1.5kg | 3 | included | - | - | OK |
| Wrap | 1 | No | H.W. Nevills Plain White Tortilla Wraps 8 Pack | 1 | included | - | - | OK |
| Slice of tomato | 1 | No | Tesco Classic Round Tomatoes 6 Pack | 1 | included | - | - | OK |
| Lettuce | 1 | No | Tesco Butterhead Salad 80g | 1 | included | - | - | OK |
| Sliced cucumber | 1 | No | Tesco Whole Cucumber Each | 1 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Chicken Goujons & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Goujons | 4 | No | Chicken Breast Goujons | 4 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Salt & Chilli Squid & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Salt & Chilli Squid | 5 | No | Salt & Chilli Squid | 5 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Chunky chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Fish Fingers & Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Fish fingers | 4 | No | Chef's Essentials 60 White Fillet Fish Fingers 1.5kg | 4 | included | - | - | OK |
| Chips | 1 | Yes | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | :warning: inclusion=included expected=choice;  |
| Chunky chips | 1 | Yes | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | upgrade | Chips upgrade | - | OK |
| Sweet potato fries | 1 | Yes | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | upgrade | Chips upgrade | £2 | OK |

### Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chips | 1 | No | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | OK |

### Chunky Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chunky chips | 1 | No | Chef's Menu Crispy Steak Cut Chips 2.5kg | 1 | included | - | - | OK |

### Cheesy Chips

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chips | 1 | No | Chef's Essentials Straight Cut Chips 4 x 2.5kg | 1 | included | - | - | OK |
| Cheese | 1 | No | Creamfields Mild Cheddar Slices 200g | 1 | included | - | - | OK |

### Sweet Potato Fries

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Sweet potato fries | 1 | No | Chef's Larder Premium Super Crisp Sweet Potato Gourmet Fries 2.5kg | 1 | included | - | - | OK |

### 6 Onion Rings

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Onion rings | 6 | No | Chef's Larder Battered Onion Rings | 1 | included | - | - | :warning: Qty 1 vs DOCX 6;  |

### Sticky Toffee Pudding

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Sticky Toffee Pudding | 1 | No | Chef's Menu Sticky Toffee Pudding Squares 2.25kg | 1 | included | - | - | OK |
| Custard | 1 | No | Tesco Ready To Serve Custard | 1 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |
| Ice cream | 2 | No | Chef's Larder Soft Scoop Vanilla Flavour Ice Cream 4 Litres | 2 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |

### Apple Crumble

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Apple Crumble | 1 | No | Chef's Menu Apple Crumble 12 x 175g | 1 | included | - | - | OK |
| Custard | 1 | No | Tesco Ready To Serve Custard | 1 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |
| Ice cream | 2 | No | Chef's Larder Soft Scoop Vanilla Flavour Ice Cream 4 Litres | 2 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |

### Chocolate Fudge Brownie

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chocolate Fudge Brownie | 1 | No | Chef's Menu Chocolate Fudge Brownie 1.4kg | 1 | included | - | - | OK |
| Custard | 1 | No | Tesco Ready To Serve Custard | 1 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |
| Ice cream | 2 | No | Chef's Larder Soft Scoop Vanilla Flavour Ice Cream 4 Litres | 2 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |

### Chocolate Fudge Cake

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Chocolate Fudge Cake | 1 | No | Chef's Menu Luxury Chocolate Fudge Cake 14 Slices | 1 | included | - | - | OK |
| Custard | 1 | No | Tesco Ready To Serve Custard | 1 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |
| Ice cream | 2 | No | Chef's Larder Soft Scoop Vanilla Flavour Ice Cream 4 Litres | 2 | choice | Accompaniment | - | :warning: inclusion=choice expected=included;  |

### Ice Cream Sundae

| DOCX Ingredient | DOCX Qty | DOCX Opt? | DB Match | DB Qty | DB inclusion_type | DB option_group | DB upgrade_price | Status |
|----------------|----------|-----------|----------|--------|-------------------|----------------|------------------|--------|
| Ice cream | 5 | No | Chef's Larder Soft Scoop Vanilla Flavour Ice Cream 4 Litres | 5 | included | - | - | OK |
| Strawberry sauce | 1 | No | Askeys Treat Strawberry Sauce 325g | 1 | included | - | - | OK |
| Chocolate sauce | 1 | No | Askeys Treat Chocolate Topping 325g | 1 | included | - | - | OK |
| Toffee sauce | 1 | No | Askeys Treat Toffee Sauce 325g | 1 | included | - | - | OK |
| Wafer | 1 | No | Waverley 200 Fan Wafers | 1 | included | - | - | OK |

### Americano
No composition data in DOCX or DB (expected for Hot Drinks)

### Latte / Cappuccino
No composition data in DOCX or DB (expected for Hot Drinks)

### Hot Chocolate
No composition data in DOCX or DB (expected for Hot Drinks)

## E. Burger Add-Ons Check

Menu PDF lists these add-on prices for all burgers:
- Onion rings: £1 (VE)
- Mature cheddar: £1 (V)
- Cheesy chips: £2 (V)
- Sweet potato fries: £2 (VE)
- Crispy bacon: £2
- Hash brown: £2 (V)

| Burger | Onion Rings £1 | Cheddar £1 | Cheesy Chips £2 | STP Fries £2 | Bacon £2 | Hash Brown £2 |
|--------|---------------|------------|----------------|-------------|----------|---------------|
| Classic Beef Burger | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |
| Chicken Burger | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |
| Spicy Chicken Burger | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |
| Garden Veg Burger | Included (not upgrade) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |
| Beef Stack | Included (not upgrade) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |
| Chicken Stack | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | Included (not upgrade) |
| Spicy Chicken Stack | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | Included (not upgrade) |
| Garden Stack | Included (not upgrade) | OK (£1) | :x: Missing | OK (£2) | Included (not upgrade) | OK (£2) |
| Katsu Chicken Burger | OK (£1) | OK (£1) | :x: Missing | OK (£2) | OK (£2) | OK (£2) |

**Summary**: 9 burger add-on issues

- Classic Beef Burger: Missing cheesy chips add-on (expected upgrade @ £2)
- Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)
- Spicy Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)
- Garden Veg Burger: Missing cheesy chips add-on (expected upgrade @ £2)
- Beef Stack: Missing cheesy chips add-on (expected upgrade @ £2)
- Chicken Stack: Missing cheesy chips add-on (expected upgrade @ £2)
- Spicy Chicken Stack: Missing cheesy chips add-on (expected upgrade @ £2)
- Garden Stack: Missing cheesy chips add-on (expected upgrade @ £2)
- Katsu Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)

## C. Missing / Extra Items

### Menu PDF items NOT in DB

- **Individual Pot of Tea** (Hot Drinks) - NOT FOUND in database

### Active DB food items NOT on menu PDF

These are active dishes in the DB that do not appear on the March 2026 printed menu. Some may be Sunday lunch items, specials, or drinks.

**Food items** (6):
- Apple and Blackberry Pie (£8.75)
- Beetroot & Butternut Squash Wellington (£19) [Sunday Lunch]
- Burger Sauce (£0)
- Crispy Pork Belly (£22) [Sunday Lunch]
- Kids Roasted Chicken (£13) [Sunday Lunch]
- Roasted Chicken (£19) [Sunday Lunch]

**Drinks** (252): 252 active drink items not on this menu PDF (expected - drinks are separate)

**Other/unclassified** (68):
- 7-Up Free (£3.5)
- Ara Marl Sauvignon Rose (750ml) (£24.99)
- Ara Pinot Gris (£24.99)
- Balsamic Dressing (£0)
- BBQ Sauce (£0)
- Bisto Gravy (£0)
- Captain’s Colada (£7.75)
- Cauliflower Cheese (£4)
- Chocolate Sauce (£0)
- Classic Margarita (£7.99)
- Counterpoint Chardonnay (750ml) (£25.99)
- Counterpoint Shiraz (750ml) (£23.99)
- Cranberry Sauce (£0)
- Cuba Libre (£6.75)
- Dark & Stormy (£7)
- Double Aperol (double) (£3.6)
- Double Harvey's Bristol Cream (50ml) (£4)
- Double Southern Comfort (£5.45)
- Double Tailors Fine Ruby Port (50ml) (£4.7)
- English Garden (£7)
- English Mustard (£0)
- Fever Tree Madagascan Cola (£3)
- Garlic Mayonnaise (£0)
- Gentlemens Collection (750ml) (£24.99)
- Giotto Pinot Grigio (750ml) (£16.99)
- Gris des Signeurs (750ml) (£24.99)
- Half 1664 Biere (£3.65)
- Half 1664 Shandy (£2.55)
- Half Coca Cola (£2.5)
- I Heart Chardonnay (187ml) (£6.99)
- I Heart Chardonnay (750ml) (£19.99)
- I Heart Merlot (187ml) (£6.99)
- I Heart Merlot (750ml) (£19.99)
- I Heart Pinot Grigio (187ml) (£6.99)
- I Heart Pinot Grigio (750ml) (£19.99)
- I Heart Rose (187ml) (£6.99)
- I Heart Rose (750ml) (£19.99)
- I Heart Sauvignon Blanc (187ml) (£6.99)
- I Heart Sauvignon Blanc (750ml) (£19.99)
- I Heart Shiraz (187ml) (£6.99)
- I Heart Shiraz (750ml) (£19.99)
- Ketchup (£0)
- Mayonnaise (£0)
- Mint Sauce (£0)
- Mojito (£8.25)
- Montford Estate Sauvignon Blanc (£28.99)
- Peach Blush (£6.75)
- Pink Paloma (£6.5)
- Pint 1664 Biere (£6.2)
- Pint 1664 Shandy (£4.7)
- Pint Coca Cola (£4)
- Rocosa Malbec (750ml) (£22.99)
- Single Botanist (£4.1)
- Single Bumbu Cream (£3.5)
- Single Bushmills (£4.1)
- Single Jack Daniel's Apple (£3.3)
- Single Jägermeister (£3.3)
- Single Johnnie Walker Black Label (£4.3)
- Single Southern Comfort (£3.1)
- Slimline Elderflower (£3.2)
- Splash Coca Cola (£1)
- Strawberry Sauce (£0)
- Sweet Chilli Dipping Sauce (£0)
- Tartar Sauce (£0)
- Three Pebbles Bay (750ml) (£20.99)
- Toffee Sauce (£0)
- Tropical Punch (£6.5)
- Woo Woo (£6.75)

---

## Prioritised Action List

### P1 - Missing Dishes (1 items)

1. Add "Individual Pot of Tea" to database

### P2 - Missing Compositions (6 dishes)

2. **Half Fish & Chips**: Missing in DB: Half fish
3. **Beef & Ale Pie**: Missing in DB: Beef and ale pie
4. **Butternut Squash, Mixed Bean & Mature Cheddar Pie**: Missing in DB: Butternut Squash, Mixed Bean & Mature Cheddar Pie
5. **Garden Veg Burger**: Missing in DB: Garden veg burger
6. **Garden Stack**: Missing in DB: Veg burger
7. **Katsu Chicken Burger**: Missing in DB: Slice of tomato

### P2 - Dietary Flag Issues (10 items)

8. Rustic Classic: PDF has V,VEO,GFO but DB missing gluten_free_option, vegan_option, vegetarian
9. Simply Salami: PDF has GFO but DB missing gluten_free_option
10. Fully Loaded: PDF has GFO but DB missing gluten_free_option
11. Nice & Spicy: PDF has GFO but DB missing gluten_free_option
12. The Garden Club: PDF has V,VEO,GFO but DB missing gluten_free_option, vegan_option, vegetarian
13. Smoked Chilli Chicken: PDF has GFO but DB missing gluten_free_option
14. Chicken & Pesto: PDF has GFO but DB missing gluten_free_option
15. Barbecue Chicken: PDF has GFO but DB missing gluten_free_option
16. Garlic Bread: PDF has VE,GFO but DB missing gluten_free_option, vegan
17. Garlic Bread + Mozzarella: PDF has V,GFO but DB missing gluten_free_option, vegetarian

### P3 - Quantity / Inclusion Type Mismatches

18. **Fish & Chips**: Tartare sauce: DB inclusion_type=removable, expected included (DOCX not Opt); Lemon wedge: DB inclusion_type=removable, expected included (DOCX not Opt); Bamboo stick: DB inclusion_type=removable, expected included (DOCX not Opt)
19. **Half Fish & Chips**: Tartare sauce: DB inclusion_type=removable, expected included (DOCX not Opt); Lemon wedge: DB inclusion_type=removable, expected included (DOCX not Opt); Bamboo stick: DB inclusion_type=removable, expected included (DOCX not Opt)
20. **Scampi & Chips**: Tartare sauce: DB inclusion_type=removable, expected included (DOCX not Opt); Lemon wedge: DB inclusion_type=removable, expected included (DOCX not Opt); Bamboo stick: DB inclusion_type=removable, expected included (DOCX not Opt)
21. **Beef & Ale Pie**: Mash: DB inclusion_type=included, expected choice (DOCX Opt)
22. **Chicken & Wild Mushroom Pie**: Mash: DB inclusion_type=included, expected choice (DOCX Opt)
23. **Chicken, Ham Hock & Leek Pie**: Mash: DB inclusion_type=included, expected choice (DOCX Opt)
24. **Butternut Squash, Mixed Bean & Mature Cheddar Pie**: Mash: DB inclusion_type=included, expected choice (DOCX Opt)
25. **Classic Beef Burger**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
26. **Chicken Burger**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
27. **Spicy Chicken Burger**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
28. **Garden Veg Burger**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt); Onion ring: DB inclusion_type=included, expected choice (DOCX Opt); Bacon: DB inclusion_type=upgrade, expected included (DOCX not Opt)
29. **Beef Stack**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
30. **Chicken Stack**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
31. **Spicy Chicken Stack**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
32. **Garden Stack**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Slice of tomato: DB inclusion_type=removable, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt); Onion ring: DB inclusion_type=included, expected choice (DOCX Opt)
33. **Katsu Chicken Burger**: Chips: DB inclusion_type=included, expected choice (DOCX Opt); Lettuce: DB inclusion_type=included, expected choice (DOCX Opt)
34. **Lasagne**: Lettuce: DB inclusion_type=removable, expected included (DOCX not Opt)
35. **Chicken Katsu Curry**: Slice of tomato: DB inclusion_type=removable, expected included (DOCX not Opt); Lettuce: DB inclusion_type=removable, expected included (DOCX not Opt); Sliced cucumber: DB inclusion_type=removable, expected included (DOCX not Opt)
36. **Chicken Goujon Wrap**: Chips: DB inclusion_type=included, expected choice (DOCX Opt)
37. **Fish Finger Wrap**: Chips: DB inclusion_type=included, expected choice (DOCX Opt)
38. **Chicken Goujons & Chips**: Chips: DB inclusion_type=included, expected choice (DOCX Opt)
39. **Salt & Chilli Squid & Chips**: Chunky chips: DB inclusion_type=included, expected choice (DOCX Opt)
40. **Fish Fingers & Chips**: Chips: DB inclusion_type=included, expected choice (DOCX Opt)
41. **Sticky Toffee Pudding**: Custard: DB inclusion_type=choice, expected included (DOCX not Opt); Ice cream: DB inclusion_type=choice, expected included (DOCX not Opt)
42. **Apple Crumble**: Custard: DB inclusion_type=choice, expected included (DOCX not Opt); Ice cream: DB inclusion_type=choice, expected included (DOCX not Opt)
43. **Chocolate Fudge Brownie**: Custard: DB inclusion_type=choice, expected included (DOCX not Opt); Ice cream: DB inclusion_type=choice, expected included (DOCX not Opt)
44. **Chocolate Fudge Cake**: Custard: DB inclusion_type=choice, expected included (DOCX not Opt); Ice cream: DB inclusion_type=choice, expected included (DOCX not Opt)

### P3 - Burger Add-On Issues (9 items)

45. Classic Beef Burger: Missing cheesy chips add-on (expected upgrade @ £2)
46. Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)
47. Spicy Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)
48. Garden Veg Burger: Missing cheesy chips add-on (expected upgrade @ £2)
49. Beef Stack: Missing cheesy chips add-on (expected upgrade @ £2)
50. Chicken Stack: Missing cheesy chips add-on (expected upgrade @ £2)
51. Spicy Chicken Stack: Missing cheesy chips add-on (expected upgrade @ £2)
52. Garden Stack: Missing cheesy chips add-on (expected upgrade @ £2)
53. Katsu Chicken Burger: Missing cheesy chips add-on (expected upgrade @ £2)

### P4 - Extra DB Ingredients (review needed)

54. **Half Fish & Chips**: Extra in DB (not in DOCX): Chef's Larder 6 Jumbo Battered Cod Fillets [included]
55. **Beef & Ale Pie**: Extra in DB (not in DOCX): Toms Pies Steak & Ale Pie [included]
56. **Butternut Squash, Mixed Bean & Mature Cheddar Pie**: Extra in DB (not in DOCX): Toms Pies Butternut Squash, Mixed Bean & Cheese Pie [included]
57. **Garden Veg Burger**: Extra in DB (not in DOCX): The Fat Chef Bangkok Bad Boy Burger [included]
58. **Garden Stack**: Extra in DB (not in DOCX): The Fat Chef Bangkok Bad Boy Burger [included]

## Interpretation Notes

Many of the "inclusion_type mismatch" warnings in section B need human judgement to resolve. Here is context on the recurring patterns:

### Pattern 1: "included" vs "choice" for default chips
The DOCX marks regular chips as "Opt" (alongside chunky chips and sweet potato fries) because the customer picks one. The DB has regular chips as `included` (the default choice that ships if no preference is stated) and chunky/STP as `upgrade`. **This is a valid DB design choice** -- the system needs to know which chip type goes out if no selection is made. These are not bugs unless the business wants to force the customer to choose.

### Pattern 2: "removable" vs "included" for garnishes
Tartare sauce, lemon wedges, bamboo sticks, tomato, lettuce, and cucumber are marked as `removable` in the DB. The DOCX marks them as non-optional (no "Opt" prefix). **Both are correct** -- they come with the dish by default, but `removable` lets the customer say "no tartare sauce please". This is expected behaviour for garnishes.

### Pattern 3: Pudding accompaniments as "choice"
Custard and ice cream are `choice` in an "Accompaniment" group for puddings. The DOCX lists them without "Opt". **The DB is correct** -- the customer chooses custard OR ice cream (or both), they don't automatically get both poured on.

### Pattern 4: Pie mash as "included"
All pies have mash as `included` and chunky chips as `upgrade`. The DOCX marks mash as "Opt" (alongside chips). **Same as Pattern 1** -- mash is the default, chips is the alternative. Valid design.

### Genuine issues to fix
After filtering out the above patterns, the real issues are:
- **P1**: Individual Pot of Tea missing from DB entirely
- **P2**: Missing primary ingredients (half fish, pie ingredients, veg burger patty as ingredient links)
- **P2**: All 10 pizza dietary flags missing
- **P3**: Cheesy chips add-on missing from all 9 burgers
- **P4**: Wrong ingredient links for Garden Veg Burger and Garden Stack (Bangkok Bad Boy Burger instead of Beetroot & Butternut Squash Wellington or similar veg patty)
- **P3**: Bangers & Mash sausage qty should be 3, DB has 1
- **P3**: 6 Onion Rings qty should be 6, DB has 1

## DOCX Data Quality Notes

The following issues were observed in the ingredients DOCX itself:

1. **Garden Stack**: Bacon qty listed as 11 - almost certainly a typo for 1
2. **All pizzas**: No ingredient compositions listed (all rows empty)
3. **All hot drinks**: No ingredient compositions listed (all rows empty)
4. **Garlic Bread / Garlic Bread with Mozzarella**: No ingredient compositions listed
5. Various spelling inconsistencies: "Tartar" vs "Tartare", "Sause" vs "Sauce", "chesse" vs "cheese", "oionins" vs "onions"
6. **Apple Crumble**: Name field is blank in DOCX (only shows "(V)" and price)


# Playbook: adding and removing a menu item

Written 13 November 2026. A checklist for anyone at The Anchor who adds something to the menu or takes it off. No coding needed, except where a step says "needs a developer".

## First, know where your item will show up

The management app (Menu Management) is the master list. What happens next depends on which menu the item goes on:

| Menu in the app | Shows on the website? | Where |
|---|---|---|
| Main Menu (`website_food`) | Yes, automatically | /food-menu, /food-menu/vegan, /food-menu/vegetarian, /food-menu/gluten-free, /lunch-and-dinner, /fish-and-chips-heathrow (fish only) |
| Kids Menu (`kids`) | Yes, automatically | /food-menu |
| Sunday Lunch (`sunday_lunch`) | Yes, automatically | /sunday-roast, /book-table, /food-menu |
| Christmas Menu (`christmas`) | Prices only | /christmas-parties (the dishes themselves come from the seasonal period list, see step A6) |
| Hot Drinks (`hot_drinks`) | **No** | Nowhere on the website today |
| Drinks (`drinks`, imported from the till) | **No** | The website /drinks page is a fixed file, not this list |
| Condiments | No | Kitchen and costing only |

**Drinks never reach the website on their own.** The /drinks page is written by hand in the website code (`content/menu/drinks.json` in the website repository) and has no hot drinks section. Getting a drink onto the website needs a developer, either to edit that file or to connect the Hot Drinks menu to the website. Ask for that as a separate job.

How long the website takes to catch up after you save in the app (food menus only):

- /lunch-and-dinner: within about 5 minutes.
- /food-menu, the vegan, vegetarian and gluten-free pages, /sunday-roast, /book-table, /fish-and-chips-heathrow and /christmas-parties: up to about 1 hour 5 minutes. The first visitor after the hour may still see the old page; refresh again a minute later.
- There is no "publish now" button. If it must show sooner, a developer can redeploy the website.

## Part 1: Adding an item

### A1. Check the ingredients exist (this is where allergens come from)

Where: Menu Management, Ingredients tab (`/menu-management/ingredients`).

- Search for each ingredient the item uses (for a latte: coffee beans, milk).
- If one is missing, press **New Ingredient** and fill in: Name, Purchase Department (Kitchen or Bar), Supplier Name, Pack Size and Pack Size Unit, Pack Cost (£), Portions Per Pack.
- In **Allergens & Dietary**, tick every allergen the ingredient contains and its dietary flags (vegan, vegetarian, gluten free, dairy free, halal). These ticks flow through to every dish that uses the ingredient.

Why it matters: a dish's allergens and dietary labels are worked out from its ingredients. A dish with no ingredients shows no allergens at all and gets no "vegan" or "vegetarian" label, even if it is one.

### A2. Create the dish

Where: Menu Management, Dishes tab (`/menu-management/dishes`), **New Dish**.

Overview tab:
- **Name**: as guests should see it.
- **Selling Price (£)**: the price on the till and the menu. Must match the till exactly.
- **Guest Description**: shown on the website and menus.
- **Calories**: optional.
- **Mark this dish as a new product**: optional; shows a "New" badge between the dates you choose and then disappears by itself.
- Leave **Dish is active** switched on.

Composition tab:
- **Add Ingredient** (or **Add Recipe**) for each part of the dish, with the quantity. This sets both the cost (GP%) and the allergens.

Menus tab:
- **Menu**: pick the menu from the table above (for a hot drink, Hot Drinks).
- **Category**: pick the section it sits in (for example Hot Drinks). The category list is fixed; a brand-new category needs a developer.
- **Sort Order**: where it sits in the section (lower numbers first).
- **Available From / Available Until**: leave blank for a permanent item. Use them for a seasonal item; the website hides it outside those dates automatically.
- **Mark as special**: only for a special.

Save.

### A3. Check and verify the allergens

Where: the same dish, open from the Dishes tab.

- Look at the allergens it now shows. They come from the ingredients in A1. If one is wrong, fix the ingredient, not the dish.
- When you are happy, press **Verify Allergens** at the top of the dish. This records who checked them and when.

### A4. Check the GP

Where: the dish's **GP Analysis** tab, or the Overview tab of Menu Management.

- Compare the GP% to the target (shown on the Overview page; set under **Menu Target**). If it is below target, decide on the price before going further.

### A5. Check the website (food menus only)

- Wait the time in the table above, then open the page for that menu (for example https://www.the-anchor.pub/food-menu).
- Check the name, price, description, and the vegan, vegetarian and gluten-free pages if the dish should appear there.
- For a drink: it will not appear. See "First, know where your item will show up".

### A6. Christmas and other seasonal pre-order menus (only if relevant)

The Christmas pre-order list that guests choose from when booking is a **separate list**, not the dishes above.

Where: Settings, Table Setup (`/settings/table-bookings`), **Seasonal Periods**, open the period, **Menu**.

- Add the item with its course (starter, main, dessert or extra), name, description and allergens (typed in by hand here, so copy them from the verified dish in A3).
- An "extra" must have a price.
- Check: /christmas-parties on the website within about an hour.

### A7. Printed menus

Where: Menu Management, Overview (`/menu-management`).

- Pick the menu in the filter, then press **Export CSV**. This gives the designer every active item on that menu, in order, with price, description, allergens and dietary claims.
- For the allergen folder: Dishes tab, **Download PDF**, Allergen Report, then All Dishes, Food or Drinks. Print it and replace the old copy behind the bar.
- [Peter to confirm: who designs the printed menu (Canva, by Peter, or someone else), who prints it, and how long a reprint takes. The last menu PDF found was a Canva export, "Main Menu - March 2026".]
- [Peter to confirm: are table talkers, chalkboards or the coffee machine area signed separately?]

### A8. The till

The till is Tabology (rposcloud), according to `tasks/epos-webhooks-discovery.md`. The management app does not send items or prices to the till; it has to be added by hand.

- [Peter to confirm: the screen path in the Tabology back office for adding a product, which button group it goes on, and who is allowed to do it.]
- Use exactly the same name and price as the app.
- [Peter to confirm: does the till need a separate allergen or modifier setting (for example "oat milk" as an option)?]
- Check: ring it through on a test tab and void it, or sell the first one and check the receipt.

### A9. Google and social

- Google Business Profile: the menu link points to /food-menu, so food changes follow the website automatically. [Peter to confirm: whether items are also listed by hand in the Business Profile Menu or Products section. As of 30 October 2026 that section appeared empty.]
- Social media: optional post. Nothing updates on its own.

### A10. Tell the team

- Tell the bar and kitchen what it is, the price, the allergens and where it sits on the till.

## Part 2: Removing an item

The rule: **switch it off, do not delete it.** Deleting a dish throws away its recipe, its ingredients list and its menu placements, and past bookings that included it lose their link to it. Switching it off keeps the history and lets you bring it back later.

### R1. Switch it off in the app

Where: Menu Management, Dishes tab (`/menu-management/dishes`).

- Either click the dish's **Status** in the table to make it Inactive, or open it and switch off **Dish is active**.
- For a planned last day, open the dish, Menus tab, and set **Available Until** to the last day it is sold. It disappears from the website after that day by itself.
- Do not press **Delete**. Only delete something created by mistake that was never sold.
- Leave its ingredients alone if other dishes use them. Switch off an ingredient (Ingredients tab, **Ingredient is active**) only if nothing else uses it and you no longer buy it.

### R2. Check the website (food menus only)

- After the times in the table at the top, check the item has gone from /food-menu and the dietary pages, and any other page in the table.

### R3. Christmas or seasonal pre-order list

- If it was on a seasonal pre-order list (A6), open that period's Menu and switch the item off there too. Do this before guests can choose it; pre-orders already taken stay as they are.

### R4. Printed menus and allergen folder

- Re-export the CSV (A7) for the designer and reprint, or cover the item on the current menus until the reprint.
- Download a fresh Allergen Report PDF and replace the copy behind the bar.
- [Peter to confirm: the same designer and printer as A7.]

### R5. The till

- Remove or hide the product in Tabology so it cannot be rung through.
- [Peter to confirm: whether Tabology lets you hide or archive a product (keeps sales history) rather than delete it. Hide or archive if possible.]

### R6. Google, website copy and team

- Google Business Profile: remove it from any hand-made Menu or Products entry. [Peter to confirm, as A9.]
- Website text: if the item was named in hand-written website copy (for example the /drinks page FAQ, which mentions "coffee, tea and hot chocolate", or a blog post), ask a developer to change it.
- Tell the team it is off.

## Worked example: adding decaf coffee

Our decaf coffee is **instant decaf**, not espresso, so it is one item, "Decaf Coffee (instant)", made with instant granules: there is no decaf latte or cappuccino. It is priced the same as tea, **£3.00** (Peter, 13 November 2026). It goes on the **Hot Drinks** menu, which today has Americano, Latte, Cappuccino, Hot Chocolate and six teas (including Decaffeinated Tea), all at £3.00.

1. **Ingredients** (A1): check for a decaf coffee ingredient on the Ingredients tab. If there is none, press **New Ingredient**, name it "Instant decaf coffee granules", set Purchase Department to Bar, add the supplier, pack size, pack cost and portions per pack. Check whether milk is already an ingredient, with the Milk allergen ticked.
2. **Dish** (A2): Dishes tab, **New Dish**. Name "Decaf Coffee (instant)", so staff and customers can see it is instant. Selling Price: £3.00, the same as tea. Composition: add the instant decaf granules, plus milk if it is served with milk. Menus: Menu "Hot Drinks", Category "Hot Drinks", a Sort Order that puts it next to the Americano. Save.
3. **Allergens** (A3): if it is served with milk, the dish should now show Milk. Verify the allergens.
4. **GP** (A4): check the GP% against the target.
5. **Website** (A5): decaf coffee will **not** appear on the website. No hot drinks are shown there today. Getting it there needs a developer job.
6. **Print** (A7): the next menu reprint needs it. Export the Hot Drinks CSV and reprint the drinks allergen PDF (Download PDF, Allergen Report, Drinks).
7. **Till** (A8): add "Decaf Coffee (instant)" in Tabology at £3.00, next to the other coffees. [Peter to confirm the steps.]
8. **Google** (A9): nothing changes automatically. Optional social post.
9. **Team** (A10): tell the bar it is available and that it is instant decaf (granules, not the coffee machine).

Note: in the app, all ten existing hot drinks (Americano, Latte, Cappuccino, Hot Chocolate and the teas) currently show **no allergens, a cost of £0.00 and unverified allergens**, because no ingredients are linked to them. A latte contains milk. Adding the ingredients to those dishes (A1 to A3) would fix their allergen records and their GP.

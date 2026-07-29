# Beer Battered Cod launch (2026-07-28)

Branch: feat/table-allocation-v06. Working tree has untracked recruitment scripts
from a parallel session: do not touch, stage explicit files only.

## Context
Booker product 260739 (Chef's Larder Premium 6 Jumbo Beer Battered Cod Fillets, £15.99)
replaces 260744 (Chef's Larder 6 Jumbo Battered Cod Fillets, £12.79) across the fish dishes.

Ingredient ids:
- old: ab60e04e-3783-426c-8030-ce38d20b2cca
- new: 087659ce-37e4-4561-ae67-93c54a893ca5

Dishes affected:
- Fish & Chips, e0148665-e9a2-4d10-8231-059c2ac6a5e4, qty 1 each
- Half Fish & Chips, 79742d4f-5bbc-4fd7-8937-9453bb434e72, qty 0.5 each

## Part A: production data (APPLIED TO PROD)
- [x] A1 Swap old cod for new cod on both dishes
- [x] A2 Deactivate the old cod ingredient
- [x] A3 Rename the full dish to Beer Battered Cod & Chips.
      Half Fish & Chips keeps its original name and description: owner confirmed
      2026-07-28 it is a separate product, not a half of the renamed one. It still
      takes the new cod, because the old ingredient is being discontinued.
- [x] A4 Rewrite the full dish description so the garden peas / mushy peas choice
      is explicit. Half portion description left as it was.
- [x] A5 Verify recalculated portion cost and GP
      Full: 2.6256 to 3.1590, GP 82.50% to 78.94%
      Half: 1.5598 to 1.8265, GP 87.00% to 84.78%
      Both still above the 70% target, no GP alert raised.

## Part B: "new product" flag (AMS repo)
- [x] B1 Migration: menu_dishes.new_from date, menu_dishes.new_until date
- [x] B2 Recreate menu_dishes_with_costs view with the two new columns
- [x] B3 Zod schema, MenuService, create/update RPCs
- [x] B4 Dish drawer UI, tick box defaults to today + 8 weeks
- [x] B5 Public /api/menu returns is_new and new_until
- [x] B6 Flag Beer Battered Cod & Chips as new until 2026-09-22.
      Half Fish & Chips is NOT flagged: unchanged product, so not a launch item.

## Part C: website repo (OJ-The-Anchor.pub)
- [x] C1 Menu parser picks up is_new
- [x] C2 "New" badge rendered on menu rows
- [x] C3 Check /fish-and-chips-heathrow copy still matches the renamed dish
      FOUND A LIVE REGRESSION, see below.

## Decisions taken
- new_from / new_until stored as explicit dates rather than a hardcoded 8 week
  constant, so the window is visible and overridable. Mirrors the existing
  available_from / available_until pattern on menu assignments.
- Flag lives on menu_dishes, not on the menu assignment. Newness is a property
  of the product, not of its placement on one menu.
- House style is "&" not "and" in dish names, matching every existing dish.

## LIVE REGRESSION caused by the rename, fix written but NOT deployed

The website matched fish dishes with /fish|scampi/i against the dish NAME only
(lib/menu-page-data.ts, isFishAndChipsFamily). Renaming the dish to
"Beer Battered Cod & Chips" removed the word "fish", so the dish silently
dropped out of:
  - the /fish-and-chips-heathrow landing page item list
  - that page's Product and Menu structured data
  - the gluten-free exclusion guards (isGlutenFree, hasGlutenFreeOption)

The page uses ISR with revalidate = 3600, and it has already refreshed.
Checked live 2026-07-28: the page lists Scampi & Chips, Fish Finger Wrap and
Fish Fingers & Chips, and no cod at all.

Fix: matcher broadened to /\b(?:fish|scampi|cod|haddock)/i, verified against
all 51 live website_food dish names (catches exactly the 5 fish dishes).
Locked down by tests/unit/fish-and-chips-family.test.ts.

This needs a website deploy to clear. Sequencing lesson: the data rename went
CLEARED: deployed and verified live 2026-07-28. The page now lists all 5 fish
dishes with the cod first.

A SECOND matcher broke the same way: fishPagePriority pinned the flagship slot to
the exact string "^fish & chips$", so with nothing matching, Half Fish & Chips was
promoted and the page's Product rich result advertised the GBP 12 half portion
instead of the GBP 15 headline dish. Also fixed, also verified live: Product schema
is now Beer Battered Cod & Chips at GBP 15. Sequencing lesson: the data rename went
in before the dependent website code, so prod was briefly inconsistent.
Rename dishes only after the consuming site is deployed.

## Verify
- [x] AMS typecheck: exit 0
- [x] AMS lint (changed files, --max-warnings=0): clean
- [x] AMS tests: 3970 pass (563 files), plus 11 new for the badge window
- [x] AMS build: exit 0 on Node 20 with NODE_OPTIONS=--max-old-space-size=8192
- [x] Website typecheck: exit 0
- [x] Website tests: 503 pass (48 suites), including 2 new badge tests
      and 15 new matcher tests
- [x] Website build: exit 0
- [ ] Commit (not done, awaiting go-ahead)
- [ ] Deploy both repos
- [x] Commit: AMS f6dd3b03, website aa25f98c and 989b9c1a (cherry-picked to main,
      so neither repo's in-progress feature branch was dragged along)
- [x] Deploy: both Vercel production builds Ready, prod aliases verified live

## Review
- Ingredient 260739 imported as 087659ce, unit cost £2.665 per fillet.
- Old ingredient ab60e04e deactivated rather than deleted, so historic dish
  costings and price history stay intact.
- The garden peas / mushy peas choice was ALREADY modelled correctly on both
  dishes (inclusion_type = choice, option_group = Peas). Only the guest-facing
  description needed to say so; no composition change was required.
- Migration applied to prod by statement, NOT via db push: the branch carries
  9 unrelated table-allocation migrations that are not in prod and would have
  been swept in. History row for 20260801000900 inserted manually to match.
- new_from / new_until deliberately not wrapped in a superRefine on DishSchema:
  the action layer calls DishSchema.partial(), which ZodEffects does not support.
  Ordering is enforced by the DB CHECK constraint and by the drawer instead.

## Verified live after deploy (2026-07-28)
- /fish-and-chips-heathrow item order: Beer Battered Cod & Chips, Half Fish & Chips,
  Scampi & Chips, Fish Finger Wrap, Fish Fingers & Chips
- /fish-and-chips-heathrow Product JSON-LD: Beer Battered Cod & Chips at GBP 15
- /food-menu: exactly 1 New badge, on Beer Battered Cod & Chips, and the explicit
  garden peas / mushy peas wording is present

**Repo Reality Mapper Report**

**Scope Inspected**
- Repo 1: [20260614000000_update_catering_package_pricing_july_2026.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000000_update_catering_package_pricing_july_2026.sql:1)
- Repo 1: [20260614000001_update_welcome_drinks_and_kids_minimums.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000001_update_welcome_drinks_and_kids_minimums.sql:1)
- Repo 2: [lib/api/catering-packages.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:97)
- Repo 2: [app/private-hire/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:17)
- Repo 2: [app/private-hire/wakes/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:18)
- Supporting checks: management API config route, package table rendering, related historical catering migrations, repo-wide old-price search.

**Validation Run**
- `npx next lint --file app/private-hire/page.tsx --file app/private-hire/wakes/page.tsx --file lib/api/catering-packages.ts`: passed, no ESLint warnings or errors.
- Focused TypeScript program check over the changed files surfaced only existing imported-module diagnostics in `lib/cookies.ts` and `lib/tracking/dispatcher.ts` for missing `Window.gtag` / `Window.dataLayer` types. No diagnostics pointed at the changed files.
- Full `npx tsc --noEmit --pretty false`: failed on unrelated existing test typing errors in `tests/api/*` and `tests/unit/ManagementTableBookingForm.test.tsx`.
- SQL parser check using `pgsql-ast-parser` against both new migration files: passed.
- A local Postgres execution check was attempted in `/tmp`, but the sandbox blocks Postgres shared memory creation, so I did not execute the migrations against a real database.

**Findings**

1. **Changed files are syntactically sound**
- The three TS/TSX files pass targeted Next lint.
- The two SQL files parse successfully as PostgreSQL.
- No syntax issue found in the changed files.

2. **`getLowestFoodPrice` behavior**
- [getLowestFoodPrice](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:98) correctly filters to:
  - `category === 'food'`
  - `pricingModel === 'per_head'`
  - `costPerHead > 0`
- It then returns the minimum formatted as `£11` for whole pounds or `£10.95` style for decimals.
- It correctly excludes variable, menu-priced, free, per-tray, and zero-price packages.

**Risk:** `getCateringData()` returns all active food packages from the management API, not just generic private-hire buffet packages. Existing festive packages are also `category = 'food'`, `pricing_model = 'per_head'`, and include `Festive Sandwich & Salad` at `£10.95` in [standardise_catering_options.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260405120000_standardise_catering_options.sql:214). If those packages are active, `fromPrice` may become `£10.95`, not the new generic buffet floor of `£11`.

3. **`generateMetadata` functions**
- [private-hire/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:17) and [wakes/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:18) both export `async function generateMetadata(): Promise<Metadata>`.
- Both return proper `Metadata`-shaped objects with `title`, `description`, `openGraph`, `twitter`, and `alternates`.
- Neither page still exports static `metadata`, so there is no Next.js conflict between `metadata` and `generateMetadata`.

4. **Hardcoded private-hire prices**
- No remaining hardcoded old catering prices found in `app/private-hire/page.tsx` or `app/private-hire/wakes/page.tsx`.
- Remaining price-like hardcodes in `app/private-hire/page.tsx` are benchmark/comparison or fallback values:
  - fallback `£11` at [page.tsx:19](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:19) and [page.tsx:43](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:43)
  - room hire / competitor comparison values such as `£25/hr`, `£500–£2,000`, `£35–£55pp`, `£15–£25/car`
- Same fallback `£11` exists in [wakes/page.tsx:20](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:20) and [wakes/page.tsx:45](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:45).

5. **SQL migration safety**
- Both migrations are wrapped in `BEGIN;` / `COMMIT;`.
- Both contain only `UPDATE` statements.
- No `DROP`, `DELETE`, or `ALTER` found in either new migration.
- No duplicate `20260614000000` / `20260614000001` migration filenames found.
- `pricing_model = 'variable'` is compatible with the earlier pricing model constraint.

**Migration risk:** updates are name-based and have no row-count assertions. If a package name has drifted in production, the migration can succeed while updating zero rows.

6. **Other old-price references in `OJ-The-Anchor.pub`**
Exact search for `£9.95`, `£10.50`, `£10.95`, `£13.95`, `£17.99` and numeric equivalents found matches outside the private-hire pages.

Runtime app files:
- `app/christmas-parties/page.tsx`
- `app/christmas-parties/client-components.tsx`
- `app/corporate-christmas-parties/page.tsx`

Data/content/docs:
- `SSOT.json`
- 21 files under `content/blog` / `content/copy-decks`
- 13 files under `docs`

Some `£10.95` / `£13.95` matches appear to be Christmas/festive pricing, which may be intentional. The generic private-hire/event blog content still has many references to the old buffet prices and should be triaged if those pages are public or used as source-of-truth content.

**Not Inspected**
- I did not run migrations against live Supabase or any production/staging database.
- I did not verify actual production row counts or whether festive packages are currently active in the live DB.
- I did not inspect unrelated dirty/deleted files beyond the requested old-price search.
- I did not modify any files.
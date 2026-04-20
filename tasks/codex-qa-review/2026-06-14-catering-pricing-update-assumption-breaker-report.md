**Adversarial Review**

**High-Risk Findings**

1. **Wake pages can advertise a price that is not available in the wake package table.**  
   [getLowestFoodPrice](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:100) takes the lowest per-head package across all food packages. [wakes/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:18) uses that value for “funeral tea” metadata and hero copy, but the visible wake table is filtered to `Sandwich Buffet`, `Finger Buffet`, `Premium Buffet`, and `Afternoon Tea` at [wakes/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:303).  
   After the July migration, `Burger Buffet` is `£11` at [20260614000000...](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000000_update_catering_package_pricing_july_2026.sql:13), while `Sandwich Buffet` is `£12` at line 7. Result: the wake page can say “Funeral Tea from £11pp” while the shown wake packages start at £12pp.

2. **API failure silently publishes hardcoded fallback pricing.**  
   [getPrivateBookingConfig](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/private-bookings.ts:90) catches failures and returns `success: false`. [getCateringData](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:77) converts that into empty arrays. Both edited pages then fall back to `£11`: [private-hire/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:19), [wakes/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/wakes/page.tsx:20).  
   That means a failed regeneration can still return a successful page with stale fallback copy and missing package tables. This is worse than a visible failure because it can be cached.

3. **The “from” price ignores minimum guest constraints.**  
   [getLowestFoodPrice](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:100) filters by category, pricing model, and positive price, but not `minimumGuests`. The private-hire hero says `10–50 guests` and `Buffet packages from ${fromPrice}pp` at [private-hire/page.tsx](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/private-hire/page.tsx:55).  
   The new migration sets `Burger Buffet` to `£11` with `minimum_guests = 20`, and the main buffet packages to 30 guests at [20260614000000...](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000000_update_catering_package_pricing_july_2026.sql:7). So the advertised from-price is not available for 10-guest bookings.

**Next.js / Metadata**

4. **This repo is not on Next.js 15.**  
   The declared dependency is `next: ^14.2.13` in [package.json](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/package.json:29), and the lockfile resolves `node_modules/next` to `14.2.35` at [package-lock.json](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/package-lock.json:9407).  
   `generateMetadata()` is valid App Router usage here, but the specific “Next 15” assumption is not true for this codebase.

5. **No concrete race condition found between `generateMetadata()` and the page component.**  
   Both call [getCateringData](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/catering-packages.ts:74), which is wrapped in `React.cache()`, and the underlying fetch is the same URL/options at [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/private-bookings.ts:92). I do not see mutable shared state or a data race. Worst case is duplicate helper execution, not inconsistent writes.

6. **The metadata is not live; it is cache/revalidate driven.**  
   The server fetch uses `next: { revalidate: 3600 }` at [private-bookings.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/lib/api/private-bookings.ts:97). The public proxy route also uses `revalidate: 3600` at [route.ts](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/app/api/public/private-booking/config/route.ts:14).  
   So yes, stale data is possible for up to an hour. That may be acceptable for routine pricing, but not for urgent corrections or same-day price rollouts.

**SEO Findings**

7. **No inherent SEO problem from async metadata, but there is a consistency problem.**  
   Crawlers will receive server-rendered metadata. The SEO risk is that metadata, hero copy, package tables, and blog content can disagree. The wake page mismatch above is the clearest example.

8. **Old hardcoded catering prices remain in active content.**  
   The SSOT is internally inconsistent: summary says `catering_buffet_from_gbp: 12.0` at [SSOT.json](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/SSOT.json:767), but the package table still says `Sandwich Buffet` is `9.95` at [SSOT.json](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/SSOT.json:777).  
   Active blog/content examples still advertising old prices include:
   - [private-party-venues-near-heathrow](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/content/blog/private-party-venues-near-heathrow/index.md:91)
   - [function-room-hire-near-heathrow-staines](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/content/blog/function-room-hire-near-heathrow-staines/index.md:42)
   - [function-room-hire-heathrow-pricing](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/content/blog/function-room-hire-heathrow-pricing/index.md:32)
   - [pub-with-private-room-near-heathrow](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/content/blog/pub-with-private-room-near-heathrow/index.md:175)
   - [50th-birthday-party-ideas-venues](/Users/peterpitcher/Cursor/OJ-The-Anchor.pub/content/blog/50th-birthday-party-ideas-venues/index.md:154)

**Migration Safety**

9. **The new migrations are brittle because they update by mutable package names only.**  
   [20260614000000...](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000000_update_catering_package_pricing_july_2026.sql:7) and [20260614000001...](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260614000001_update_welcome_drinks_and_kids_minimums.sql:8) use `WHERE name = ...`. The table has a unique `name` constraint at [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:3580), so this will not update multiple rows.  
   But names are editable in the management UI at [CateringPackageModal.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/features/catering/CateringPackageModal.tsx:166), and updates persist `name` by package `id` at [mutations.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings/mutations.ts:1827). If a package was renamed before this migration runs, the update silently affects zero rows. Earlier pricing migrations used `id OR name`; these should too, or assert affected row counts.

**Bottom Line**

The dynamic-price approach is directionally fine, but the implementation is too generic for page-specific claims. The biggest concrete fixes are: make wake pricing calculate from the same filtered package set it displays, include minimum-guest rules in “from” pricing, stop caching successful fallback renders on API failure, update SSOT/blog hardcoded prices, and make the migrations ID-based or row-count-checked.
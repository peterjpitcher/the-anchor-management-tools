-- Publish the Christmas menu ahead of the service window.
-- APPLIED to production (tfcasgxopxegwrabvwat) 2026-07-21 as
-- version 20260721094116 via Supabase apply_migration.
--
-- The Christmas menu must be VISIBLE for booking from now, while the food is
-- only SERVED from 10 November to 20 December 2026. Those are two different
-- things and conflating them cost us the whole booking season.
--
-- src/app/api/menu/route.ts hides any dish whose available_from is in the
-- future. Leaving available_from = 2026-11-10 kept every Christmas price off
-- the website through August to November, which is exactly when people choose
-- a venue and book.
--
-- available_from = NULL means no lower bound, so the menu publishes now.
-- available_until stays 2026-12-20 so it retires itself after the season.
-- The 10 November service start is carried in page copy and docs/SSOT.md.

UPDATE menu_dish_menu_assignments a
SET available_from = NULL,
    updated_at = now()
FROM menu_menus m
WHERE a.menu_id = m.id
  AND m.code = 'christmas'
  AND a.available_from = DATE '2026-11-10';

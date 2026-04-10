-- Add nonnegative constraint on upgrade_price (Codex QA finding)
-- Zod validates this server-side, but the DB should enforce it too.

ALTER TABLE menu_dish_ingredients
  ADD CONSTRAINT chk_mdi_upgrade_price_nonneg
  CHECK (upgrade_price IS NULL OR upgrade_price >= 0);

ALTER TABLE menu_dish_recipes
  ADD CONSTRAINT chk_mdr_upgrade_price_nonneg
  CHECK (upgrade_price IS NULL OR upgrade_price >= 0);

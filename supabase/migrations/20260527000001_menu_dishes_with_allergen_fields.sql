-- Surface computed dish allergen traceability fields through the flattened menu view.
-- The application reads menu_dishes_with_costs for /menu-management and public menu APIs.

CREATE OR REPLACE VIEW menu_dishes_with_costs AS
  SELECT
    d.id AS dish_id,
    d.name,
    d.slug,
    d.description,
    d.selling_price,
    d.target_gp_pct,
    d.portion_cost,
    d.gp_pct,
    d.allergen_flags,
    d.dietary_flags,
    d.calories,
    d.is_active,
    d.is_sunday_lunch,
    d.is_gp_alert,
    d.image_url,
    d.notes,
    dma.menu_id,
    m.code AS menu_code,
    m.name AS menu_name,
    dma.category_id,
    c.code AS category_code,
    c.name AS category_name,
    dma.sort_order,
    dma.is_special,
    dma.is_default_side,
    dma.available_from,
    dma.available_until,
    d.removable_allergens,
    d.is_modifiable_for,
    d.allergen_verified,
    d.allergen_verified_at
  FROM menu_dishes d
  JOIN menu_dish_menu_assignments dma ON dma.dish_id = d.id
  JOIN menu_menus m ON m.id = dma.menu_id
  JOIN menu_categories c ON c.id = dma.category_id;

COMMENT ON VIEW menu_dishes_with_costs IS 'Flattened view exposing dishes with menu/category placement, costing, and allergen traceability';

DO $$
DECLARE
  dish_record RECORD;
BEGIN
  FOR dish_record IN
    SELECT id, allergen_verified, allergen_verified_at
    FROM menu_dishes
  LOOP
    PERFORM menu_refresh_dish_calculations(dish_record.id);

    IF COALESCE(dish_record.allergen_verified, FALSE) THEN
      UPDATE menu_dishes
      SET
        allergen_verified = TRUE,
        allergen_verified_at = dish_record.allergen_verified_at
      WHERE id = dish_record.id;
    END IF;
  END LOOP;
END $$;

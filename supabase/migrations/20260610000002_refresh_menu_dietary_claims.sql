-- Backfill existing rows after fixing dietary claim aggregation.

DO $$
DECLARE
  recipe_record RECORD;
  dish_record RECORD;
BEGIN
  FOR recipe_record IN
    SELECT id FROM menu_recipes WHERE is_active = TRUE
  LOOP
    PERFORM menu_refresh_recipe_calculations(recipe_record.id);
  END LOOP;

  FOR dish_record IN
    SELECT id FROM menu_dishes WHERE is_active = TRUE
  LOOP
    PERFORM menu_refresh_dish_calculations(dish_record.id);
  END LOOP;
END;
$$;

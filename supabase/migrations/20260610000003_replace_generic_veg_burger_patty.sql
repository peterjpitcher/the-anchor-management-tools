-- Replace the old generic vegetable burger patty with the current Bangkok burger.

DO $$
DECLARE
  v_generic_id UUID;
  v_bangkok_id UUID;
  dish_record RECORD;
BEGIN
  SELECT id INTO v_generic_id
  FROM menu_ingredients
  WHERE name = 'Vegetable Burger Patty';

  SELECT id INTO v_bangkok_id
  FROM menu_ingredients
  WHERE name = 'The Fat Chef Bangkok Bad Boy Burger';

  IF v_generic_id IS NULL THEN
    RAISE NOTICE 'Vegetable Burger Patty ingredient not found; nothing to replace.';
    RETURN;
  END IF;

  IF v_bangkok_id IS NULL THEN
    RAISE EXCEPTION 'The Fat Chef Bangkok Bad Boy Burger ingredient not found.';
  END IF;

  CREATE TEMP TABLE tmp_veg_burger_dishes ON COMMIT DROP AS
  SELECT DISTINCT dish_id
  FROM menu_dish_ingredients
  WHERE ingredient_id = v_generic_id;

  UPDATE menu_dish_ingredients
  SET ingredient_id = v_bangkok_id
  WHERE ingredient_id = v_generic_id;

  UPDATE menu_ingredients
  SET
    is_active = FALSE,
    notes = CONCAT_WS(
      E'\n',
      NULLIF(notes, ''),
      'Inactive: replaced by The Fat Chef Bangkok Bad Boy Burger.'
    ),
    updated_at = NOW()
  WHERE id = v_generic_id;

  FOR dish_record IN
    SELECT dish_id FROM tmp_veg_burger_dishes
  LOOP
    PERFORM menu_refresh_dish_calculations(dish_record.dish_id);
  END LOOP;
END;
$$;

BEGIN;

CREATE OR REPLACE FUNCTION public.menu_create_ingredient_with_price(
  p_name text,
  p_description text,
  p_default_unit public.menu_unit,
  p_storage_type public.menu_storage_type,
  p_purchase_department text,
  p_supplier_name text,
  p_supplier_sku text,
  p_brand text,
  p_pack_size numeric,
  p_pack_size_unit public.menu_unit,
  p_pack_cost numeric,
  p_portions_per_pack numeric,
  p_wastage_pct numeric,
  p_shelf_life_days integer,
  p_allergens text[],
  p_dietary_flags text[],
  p_notes text,
  p_is_active boolean,
  p_abv numeric
)
RETURNS public.menu_ingredients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ingredient public.menu_ingredients;
BEGIN
  INSERT INTO public.menu_ingredients (
    name,
    description,
    default_unit,
    storage_type,
    purchase_department,
    supplier_name,
    supplier_sku,
    brand,
    pack_size,
    pack_size_unit,
    pack_cost,
    portions_per_pack,
    wastage_pct,
    shelf_life_days,
    allergens,
    dietary_flags,
    notes,
    is_active,
    abv
  )
  VALUES (
    p_name,
    p_description,
    p_default_unit,
    p_storage_type,
    p_purchase_department,
    p_supplier_name,
    p_supplier_sku,
    p_brand,
    p_pack_size,
    p_pack_size_unit,
    p_pack_cost,
    p_portions_per_pack,
    p_wastage_pct,
    p_shelf_life_days,
    COALESCE(p_allergens, '{}'::text[]),
    COALESCE(p_dietary_flags, '{}'::text[]),
    p_notes,
    p_is_active,
    p_abv
  )
  RETURNING * INTO v_ingredient;

  IF p_pack_cost > 0 THEN
    INSERT INTO public.menu_ingredient_prices (
      ingredient_id,
      pack_cost,
      supplier_name,
      supplier_sku
    )
    VALUES (
      v_ingredient.id,
      p_pack_cost,
      p_supplier_name,
      p_supplier_sku
    );
  END IF;

  RETURN v_ingredient;
END;
$$;

CREATE OR REPLACE FUNCTION public.menu_update_ingredient_with_price(
  p_ingredient_id uuid,
  p_name text,
  p_description text,
  p_default_unit public.menu_unit,
  p_storage_type public.menu_storage_type,
  p_purchase_department text,
  p_supplier_name text,
  p_supplier_sku text,
  p_brand text,
  p_pack_size numeric,
  p_pack_size_unit public.menu_unit,
  p_pack_cost numeric,
  p_portions_per_pack numeric,
  p_wastage_pct numeric,
  p_shelf_life_days integer,
  p_allergens text[],
  p_dietary_flags text[],
  p_notes text,
  p_is_active boolean,
  p_abv numeric
)
RETURNS public.menu_ingredients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.menu_ingredients;
  v_ingredient public.menu_ingredients;
BEGIN
  SELECT *
  INTO v_existing
  FROM public.menu_ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  UPDATE public.menu_ingredients
  SET name = p_name,
      description = p_description,
      default_unit = p_default_unit,
      storage_type = p_storage_type,
      purchase_department = p_purchase_department,
      supplier_name = p_supplier_name,
      supplier_sku = p_supplier_sku,
      brand = p_brand,
      pack_size = p_pack_size,
      pack_size_unit = p_pack_size_unit,
      pack_cost = p_pack_cost,
      portions_per_pack = p_portions_per_pack,
      wastage_pct = p_wastage_pct,
      shelf_life_days = p_shelf_life_days,
      allergens = COALESCE(p_allergens, '{}'::text[]),
      dietary_flags = COALESCE(p_dietary_flags, '{}'::text[]),
      notes = p_notes,
      is_active = p_is_active,
      abv = p_abv,
      updated_at = now()
  WHERE id = p_ingredient_id
  RETURNING * INTO v_ingredient;

  IF p_pack_cost IS DISTINCT FROM v_existing.pack_cost THEN
    INSERT INTO public.menu_ingredient_prices (
      ingredient_id,
      pack_cost,
      supplier_name,
      supplier_sku
    )
    VALUES (
      p_ingredient_id,
      p_pack_cost,
      p_supplier_name,
      p_supplier_sku
    );
  END IF;

  RETURN v_ingredient;
END;
$$;

CREATE OR REPLACE FUNCTION public.menu_update_ingredient_pack_cost(
  p_ingredient_id uuid,
  p_pack_cost numeric
)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_previous numeric;
BEGIN
  SELECT pack_cost
  INTO v_previous
  FROM public.menu_ingredients
  WHERE id = p_ingredient_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Ingredient not found';
  END IF;

  UPDATE public.menu_ingredients
  SET pack_cost = p_pack_cost,
      updated_at = now()
  WHERE id = p_ingredient_id;

  IF p_pack_cost IS DISTINCT FROM v_previous THEN
    INSERT INTO public.menu_ingredient_prices (
      ingredient_id,
      pack_cost
    )
    VALUES (
      p_ingredient_id,
      p_pack_cost
    );
  END IF;

  RETURN v_previous;
END;
$$;

GRANT EXECUTE ON FUNCTION public.menu_create_ingredient_with_price(text, text, public.menu_unit, public.menu_storage_type, text, text, text, text, numeric, public.menu_unit, numeric, numeric, numeric, integer, text[], text[], text, boolean, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.menu_update_ingredient_with_price(uuid, text, text, public.menu_unit, public.menu_storage_type, text, text, text, text, numeric, public.menu_unit, numeric, numeric, numeric, integer, text[], text[], text, boolean, numeric) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.menu_update_ingredient_pack_cost(uuid, numeric) TO authenticated, service_role;

COMMIT;

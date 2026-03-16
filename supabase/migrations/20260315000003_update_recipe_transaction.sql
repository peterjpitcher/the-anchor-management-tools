-- Migration: 20260315000003_update_recipe_transaction.sql
-- Adds update_recipe_transaction RPC to atomically update a recipe and all its ingredients.
-- Models the pattern from create_recipe_transaction in 20260401200000_create_menu_transactions.sql.
-- The EXCEPTION block provides implicit savepoint rollback on any failure.

CREATE OR REPLACE FUNCTION update_recipe_transaction(
  p_recipe_id   UUID,
  p_recipe_data JSONB,
  p_ingredients JSONB DEFAULT '[]'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recipe_record JSONB;
BEGIN
  -- 1. Update the recipe scalar fields
  UPDATE menu_recipes SET
    name           = p_recipe_data->>'name',
    description    = NULLIF(p_recipe_data->>'description', ''),
    instructions   = NULLIF(p_recipe_data->>'instructions', ''),
    yield_quantity = (p_recipe_data->>'yield_quantity')::DECIMAL,
    yield_unit     = p_recipe_data->>'yield_unit',
    notes          = NULLIF(p_recipe_data->>'notes', ''),
    is_active      = COALESCE((p_recipe_data->>'is_active')::BOOLEAN, true),
    updated_at     = now()
  WHERE id = p_recipe_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipe not found: %', p_recipe_id;
  END IF;

  -- 2. Replace recipe ingredients (delete all, re-insert)
  DELETE FROM menu_recipe_ingredients WHERE recipe_id = p_recipe_id;

  IF jsonb_array_length(p_ingredients) > 0 THEN
    INSERT INTO menu_recipe_ingredients (
      recipe_id,
      ingredient_id,
      quantity,
      unit,
      yield_pct,
      wastage_pct,
      cost_override,
      notes
    )
    SELECT
      p_recipe_id,
      (item->>'ingredient_id')::UUID,
      (item->>'quantity')::DECIMAL,
      item->>'unit',
      NULLIF(item->>'yield_pct', '')::DECIMAL,
      NULLIF(item->>'wastage_pct', '')::DECIMAL,
      NULLIF(item->>'cost_override', '')::DECIMAL,
      NULLIF(item->>'notes', '')
    FROM jsonb_array_elements(p_ingredients) AS item;
  END IF;

  -- 3. Refresh calculated fields (portion_cost, allergen_flags, dietary_flags)
  PERFORM menu_refresh_recipe_calculations(p_recipe_id);

  -- 4. Return the updated recipe row as JSONB
  SELECT to_jsonb(r) INTO v_recipe_record
  FROM menu_recipes r
  WHERE r.id = p_recipe_id;

  RETURN v_recipe_record;

EXCEPTION WHEN OTHERS THEN
  -- Re-raise; PostgreSQL automatically rolls back the implicit savepoint
  RAISE;
END;
$$;

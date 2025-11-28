CREATE OR REPLACE FUNCTION get_menu_outstanding_count()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*)
  INTO v_count
  FROM menu_dishes d
  WHERE 
    d.is_active = true
    AND (
      -- GP Alert
      d.is_gp_alert = true
      OR
      -- Missing Ingredients AND Missing Recipes
      (
        NOT EXISTS (SELECT 1 FROM menu_dish_ingredients di WHERE di.dish_id = d.id)
        AND
        NOT EXISTS (SELECT 1 FROM menu_dish_recipes dr WHERE dr.dish_id = d.id)
      )
      OR
      -- Missing Menu Assignments
      NOT EXISTS (SELECT 1 FROM menu_dish_menu_assignments dma WHERE dma.dish_id = d.id)
    );
    
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION get_menu_outstanding_count() TO authenticated;
GRANT EXECUTE ON FUNCTION get_menu_outstanding_count() TO service_role;

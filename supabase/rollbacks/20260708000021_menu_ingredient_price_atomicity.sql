BEGIN;

DROP FUNCTION IF EXISTS public.menu_update_ingredient_pack_cost(uuid, numeric);
DROP FUNCTION IF EXISTS public.menu_update_ingredient_with_price(uuid, text, text, public.menu_unit, public.menu_storage_type, text, text, text, text, numeric, public.menu_unit, numeric, numeric, numeric, integer, text[], text[], text, boolean, numeric);
DROP FUNCTION IF EXISTS public.menu_create_ingredient_with_price(text, text, public.menu_unit, public.menu_storage_type, text, text, text, text, numeric, public.menu_unit, numeric, numeric, numeric, integer, text[], text[], text, boolean, numeric);

COMMIT;

-- v0.5 Sunday lunch pre-order runtime support

ALTER TABLE public.table_booking_items
  ADD COLUMN IF NOT EXISTS menu_dish_id uuid REFERENCES public.menu_dishes(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_table_booking_items_booking_menu_dish
  ON public.table_booking_items (booking_id, menu_dish_id);

CREATE INDEX IF NOT EXISTS idx_table_booking_items_menu_dish
  ON public.table_booking_items (menu_dish_id)
  WHERE menu_dish_id IS NOT NULL;

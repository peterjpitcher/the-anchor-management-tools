-- Add display_order column to private_booking_items and backfill values
ALTER TABLE public.private_booking_items
ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

-- Backfill existing rows so order defaults to created_at sequence per booking
WITH ordered_items AS (
  SELECT
    id,
    ROW_NUMBER() OVER (PARTITION BY booking_id ORDER BY created_at, id) - 1 AS order_index
  FROM public.private_booking_items
)
UPDATE public.private_booking_items pbi
SET display_order = oi.order_index
FROM ordered_items oi
WHERE oi.id = pbi.id;

-- Ensure future inserts default to placing items after existing ones by keeping default 0
-- (application layer will manage incremental assignment).

CREATE INDEX IF NOT EXISTS idx_private_booking_items_booking_order
  ON public.private_booking_items (booking_id, display_order);

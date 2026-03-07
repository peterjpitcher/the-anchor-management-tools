-- Remove legacy card capture DB infrastructure
-- All application code referencing card captures was removed in previous tasks.
-- Artefacts confirmed via information_schema before writing this migration:
--   - card_captures table (15 historical rows)
--   - booking_holds_hold_type_check includes 'card_capture_hold'
--   - get_table_card_capture_preview_v05 function
--   - complete_table_card_capture_v05 function
--   - card_capture_required column on table_bookings (NOT NULL, so drop constraint first)
-- Note: guest_tokens_action_type_check retains 'card_capture' because 2 live rows use it;
--       that token type is inert (stub page redirects) but the rows must remain readable.

BEGIN;

-- 1. Remove card_capture_hold from booking_holds hold_type check constraint
--    All existing card_capture_hold rows are in terminal states (consumed/expired/released).
--    Delete them so the tighter constraint can be added without violation.
DELETE FROM booking_holds WHERE hold_type = 'card_capture_hold';

ALTER TABLE booking_holds DROP CONSTRAINT IF EXISTS booking_holds_hold_type_check;
ALTER TABLE booking_holds ADD CONSTRAINT booking_holds_hold_type_check
  CHECK (hold_type IN ('payment_hold', 'waitlist_hold'));

-- 2. Drop the card_captures table (CASCADE removes any FK references)
DROP TABLE IF EXISTS public.card_captures CASCADE;

-- 3. Drop card capture RPC functions
DROP FUNCTION IF EXISTS public.complete_table_card_capture_v05(uuid, text, text);
DROP FUNCTION IF EXISTS public.get_table_card_capture_preview_v05(text);

-- 4. Drop NOT NULL constraint on card_capture_required, then drop the column
ALTER TABLE public.table_bookings ALTER COLUMN card_capture_required DROP NOT NULL;
ALTER TABLE public.table_bookings DROP COLUMN IF EXISTS card_capture_required;

COMMIT;

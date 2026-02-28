-- Merge Louise Kitchener (37219b95) into Lou Kitchener (6f715c73)
-- Lou is the primary record: created July 2025, 9 event bookings, 37 messages
-- Louise is the duplicate: created August 2025, same phone +447555366156
--
-- Event bookings: Louise has 2, both conflict with existing Lou bookings
--   (Nikki's Games Night 2025-09-24, New Years Eve 2025-12-31) → CASCADE deleted
-- Table bookings: Louise has 1 (2025-11-02) → move to Lou
-- Messages: Louise has 9 → move to Lou
-- Label assignments: move to Lou (ignore conflicts)

DO $$
DECLARE
  v_keeper UUID := '6f715c73-7885-4913-b40d-bab0d506e14a'; -- Lou Kitchener
  v_dupe   UUID := '37219b95-b34f-4a70-b5b1-18e1d48c8760'; -- Louise Kitchener
BEGIN

  -- Move table booking (no conflict check needed, different dates)
  UPDATE table_bookings
  SET customer_id = v_keeper
  WHERE customer_id = v_dupe;

  -- Move messages
  UPDATE messages
  SET customer_id = v_keeper
  WHERE customer_id = v_dupe;

  -- Move label assignments (skip if keeper already has the label)
  UPDATE customer_label_assignments
  SET customer_id = v_keeper
  WHERE customer_id = v_dupe
    AND label_id NOT IN (
      SELECT label_id FROM customer_label_assignments WHERE customer_id = v_keeper
    );
  DELETE FROM customer_label_assignments WHERE customer_id = v_dupe;

  -- Add merge note to Lou (keep existing notes, append merge info)
  UPDATE customers
  SET internal_notes = COALESCE(internal_notes || E'\n\n', '') ||
    'Merged from Louise Kitchener (37219b95, created 2025-08-18). ' ||
    'Both records shared phone +447555366156. ' ||
    'Louise had 2 event bookings (conflicts — discarded), 1 table booking (moved), 9 messages (moved).'
  WHERE id = v_keeper;

  -- Delete Louise (CASCADE removes her 2 conflicting event bookings)
  DELETE FROM customers WHERE id = v_dupe;

END $$;

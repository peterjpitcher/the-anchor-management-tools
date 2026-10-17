-- APPLIED to production on 16 October 2026 through the Supabase MCP, which recorded it at
-- version 20261016180511. This file is named after that version, as supabase/migrations/README.md
-- requires. The applied statement is this file byte for byte as it stood before this header was
-- added (SHA-256 244b113db42cc114180dfb2a1e164acc3baf141b7051d4f68a159f9f9a5b447a).
--
-- A party that is alone in its kitchen arrival window always fits.
--
-- The pacing cap allows (pace - walk-in reserve) food covers to arrive in any rolling window.
-- On a Sunday production runs a pace of 15 and a reserve of 5, so the ceiling is 10, and a party
-- of 11 or more was refused as 'slot_full' even when nobody else was booked anywhere near that
-- time (reported 16 October 2026: a party of 12 at 13:00 on Sunday 20 December, a day with no
-- bookings). A single party cannot be spread across windows, so refusing it protects nothing;
-- it only forces staff to tick the override or loses the booking online.
--
-- The rule now: refuse only when the window already holds covers AND adding this party takes
-- it over the ceiling. Once a large party is in, every later booking whose window overlaps it
-- is still held to the ceiling as before. Online parties stay bounded by
-- table_booking_max_party_online (20 by default); above that is a private booking.
--
-- Two functions carry the same check and must agree, or the website offers what the booking
-- engine refuses (or the reverse):
--   create_table_booking_core_v06 (the booking engine, every channel)
--   check_table_availability_v06  (the slot list the website and the staff form read)
--
-- Each one is patched in place: the live definition is read with pg_get_functiondef, the one
-- condition line is replaced, and the result is executed. The block refuses to run unless the
-- old line appears exactly once in exactly one overload, so a definition that has moved on
-- since this was written fails loudly instead of being half-patched. Re-running it after it has
-- applied is a no-op. CREATE OR REPLACE keeps owner, grants and settings; the REVOKE and GRANT
-- at the end restate the end state anyway, as the earlier migrations for these functions do.
--
-- Rollback: the same block with the old and new lines swapped.

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_count integer;
  v_def text;
  v_old_hits integer;
  v_new_hits integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      ('create_table_booking_core_v06',
       'IF v_existing_covers + p_party_size > v_ceiling THEN',
       'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN'),
      ('check_table_availability_v06',
       'IF v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN',
       'IF v_covers > 0 AND v_covers + p_party_size > GREATEST(0, v_pace - v_reserve) THEN')
    ) AS t(proname, old_line, new_line)
  LOOP
    SELECT count(*), min(p.oid) INTO v_count, v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target.proname;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'kitchen_pacing_lone_party: expected one %, found %', v_target.proname, v_count;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_line, ''))) / length(v_target.old_line);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_line, ''))) / length(v_target.new_line);

    IF v_old_hits = 0 AND v_new_hits = 1 THEN
      RAISE NOTICE 'kitchen_pacing_lone_party: % already patched, skipped', v_target.proname;
      CONTINUE;
    END IF;

    IF v_old_hits <> 1 OR v_new_hits <> 0 THEN
      RAISE EXCEPTION 'kitchen_pacing_lone_party: % has % old and % new pacing lines, expected 1 and 0',
        v_target.proname, v_old_hits, v_new_hits;
    END IF;

    EXECUTE replace(v_def, v_target.old_line, v_target.new_line);
    RAISE NOTICE 'kitchen_pacing_lone_party: % patched', v_target.proname;
  END LOOP;
END
$patch$;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(p_booking_date date, p_party_size integer, p_purpose text, p_outside boolean, p_requires_accessible_table boolean, p_high_chair_count integer, p_channel text) TO service_role;

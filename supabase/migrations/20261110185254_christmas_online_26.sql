-- Christmas dinner books online for 4 to 26 guests (release 1 of tasks/christmas-funnel/spec.md,
-- owner decisions of 10 November 2026). Replaces D15 of the food link spec ("more than 20 only by staff").
--
--   * Setting table_booking_max_party_christmas_online = 26, stored like table_booking_max_party_online
--     ({"value": n} in system_settings, read with get_setting_int). Ordinary table bookings stay at 20.
--   * create_table_booking_public_v06: an accepted Christmas booking (the live period for the date
--     is a Christmas one, any period id given names it, and the guest said yes or the purpose is
--     'christmas') gets the Christmas online ceiling instead of table_booking_max_party_online.
--   * create_table_booking_core_v06: the legacy 'christmas' purpose no longer refuses more than 20
--     as private hire. The caller's ceiling, checked a few lines earlier, already refuses a bigger
--     party as too_large_party, which the website answers with a coded refusal and the phone number.
--   * create_table_booking_christmas_v01: 4 up to the Christmas online ceiling (was 4 to 20); the
--     refusal still reads "Christmas bookings are for 4 to N guests.", now with the ceiling.
--   * check_table_availability_v06: accepts purpose 'christmas' (a food booking in every other
--     respect). On a Christmas date the online slot list stops at the Christmas online ceiling and
--     the staff and walk-in lists at the larger of the ordinary limit and christmas_staff_max_party
--     (60). A staff Christmas party above the online ceiling, which no joined tables hold (the
--     Dining Room joins to 26), is offered tables that are not joined (allow_unjoined), and the
--     answer says so with tables_unjoined. Any other purpose behaves exactly as before.
--   * create_table_booking_staff_v06: a staff Christmas party above the online ceiling is seated
--     with allow_unjoined, which core audits with the actor, and the result carries tables_unjoined
--     when the tables it got are not joined. Its existing conversion of a large legacy 'christmas'
--     booking to an accepted period is unchanged.
--   Kitchen pacing is untouched: online 21 to 26 is still taken only when no other food arrives in
--   the window (the lone-party rule of 20261016180511).
--
-- Live data this changes: one system_settings row added (left alone if it already exists), and the
-- description of christmas_staff_max_party, which said the website stays at 20. No booking row is
-- touched. No function signature changes, so src/types/database.generated.ts is unchanged.
--
-- The five functions are patched in place, as 20261028125055_table_availability_rules_agree did: the
-- live definition is read with pg_get_functiondef, each old passage is replaced, and the result is
-- executed, so SECURITY DEFINER or INVOKER and search_path come from production itself. The block
-- refuses to run unless each old passage appears exactly once and its replacement only where the old
-- passage itself holds it, so a definition that has moved on fails loudly instead of being half
-- patched; a second run is a no-op. Grants are restated (service_role only, as production; none of
-- these is callable by anon), and the end of the file checks the security settings and grants.
-- Bodies checked against production on 10 November 2026, md5(prosrc):
--   create_table_booking_public_v06    6f822b08a2377eb48d683bf1681fd2b8
--   create_table_booking_core_v06      052af983b05c72d155dba85386549847
--   create_table_booking_christmas_v01 86847eb2a6a5502ff35221b3d21e6901
--   check_table_availability_v06       f83416488cd49991b9e2126b7a412b1c
--   create_table_booking_staff_v06     403c5bed17721a61e861fad78d270e11
--
-- Rollback: tasks/christmas-funnel/rollback-r1.sql. Tested by
-- scripts/testing/christmas-online-26-postgres.py.

INSERT INTO public.system_settings (key, value, description)
VALUES ('table_booking_max_party_christmas_online', '{"value": 26}'::jsonb,
        'The largest sit-down Christmas dinner the website will book. Ordinary table bookings use table_booking_max_party_online; above this the guest is asked to call.')
ON CONFLICT (key) DO NOTHING;

UPDATE public.system_settings
   SET description = 'The largest Christmas party staff can book in the management app. The website takes up to table_booking_max_party_christmas_online; above that, staff seat the party across tables that are not joined.'
 WHERE key = 'christmas_staff_max_party';

DO $patch$
DECLARE
  v_target record;
  v_oid oid;
  v_count integer;
  v_def text;
  v_old_hits integer;
  v_new_hits integer;
  v_old_in_new integer;
  v_new_in_old integer;
BEGIN
  FOR v_target IN
    SELECT * FROM (VALUES
      (1, 'create_table_booking_public_v06',
$old$AS $function$
BEGIN
  RETURN public.create_table_booking_core_v06(
$old$,
$new$AS $function$
DECLARE
  v_period public.booking_periods;
  v_max_party integer := public.get_setting_int('table_booking_max_party_online', 20);
BEGIN
  -- Sit-down Christmas dinner books online for up to table_booking_max_party_christmas_online
  -- (26, owner decision of 10 November 2026); every other booking keeps the ordinary online limit.
  -- "Accepted" is the test create_table_booking_staff_v06 applies: the live period for the date is
  -- a Christmas one, any period id given names it, and the guest said yes or the booking is for the
  -- Christmas purpose.
  SELECT * INTO v_period FROM public.get_booking_period_for_date(p_booking_date);
  IF v_period.id IS NOT NULL AND v_period.period_kind = 'christmas'
     AND (p_booking_period_id IS NULL OR p_booking_period_id = v_period.id)
     AND (coalesce(p_booking_period_answer, false) OR lower(trim(coalesce(p_booking_purpose, ''))) = 'christmas') THEN
    v_max_party := public.get_setting_int('table_booking_max_party_christmas_online', 26);
  END IF;

  RETURN public.create_table_booking_core_v06(
$new$),
      (2, 'create_table_booking_public_v06',
$old$    public.get_setting_int('table_booking_max_party_online', 20),
    NULL, NULL,
$old$,
$new$    v_max_party,
    NULL, NULL,
$new$),
      (3, 'create_table_booking_core_v06',
$old$    IF p_party_size > 20 THEN
      RAISE EXCEPTION 'Christmas bookings for more than 20 guests are arranged as private hire. Please contact manager@the-anchor.pub, 01753 682707, or WhatsApp 01753 682707.' USING ERRCODE = '22023';
    END IF;
$old$,
$new$    -- No Christmas ceiling of its own: above the caller's ceiling (p_max_party_size, checked
    -- above) the booking is already refused as too_large_party, which the website answers with
    -- the phone number. The website's ceiling is table_booking_max_party_christmas_online (26) and
    -- staff's christmas_staff_max_party (60) (owner decisions of 10 November 2026).
$new$),
      (4, 'create_table_booking_christmas_v01',
$old$  IF v_party NOT BETWEEN 4 AND 20 THEN
    RAISE EXCEPTION 'Christmas bookings are for 4 to 20 guests.' USING ERRCODE = '22023';
  END IF;
$old$,
$new$  -- 4 up to the online Christmas ceiling (table_booking_max_party_christmas_online, 26): this is the
  -- website's entry point, and create_table_booking_public_v06 applies the same ceiling.
  IF v_party NOT BETWEEN 4 AND public.get_setting_int('table_booking_max_party_christmas_online', 26) THEN
    RAISE EXCEPTION 'Christmas bookings are for 4 to % guests.',
      public.get_setting_int('table_booking_max_party_christmas_online', 26) USING ERRCODE = '22023';
  END IF;
$new$),
      (5, 'check_table_availability_v06',
$old$  v_high_chairs_left integer;
BEGIN
$old$,
$new$  v_high_chairs_left integer;
  v_period public.booking_periods;
  v_overrides public.table_allocation_overrides;
BEGIN
$new$),
      (6, 'check_table_availability_v06',
$old$  -- Above the online ceiling there is nothing to compute: it is a private booking.
  v_max_online := public.get_setting_int('table_booking_max_party_online', 20);
$old$,
$new$  -- Above the online ceiling there is nothing to compute: it is a private booking.
  v_max_online := public.get_setting_int('table_booking_max_party_online', 20);
  -- Christmas dinner has its own ceilings (owner decisions of 10 November 2026). The caller asks with
  -- purpose 'christmas', a food booking in every other respect, and it counts only on a date whose
  -- live period is a Christmas one. Online: table_booking_max_party_christmas_online (26), as
  -- create_table_booking_public_v06. Staff and walk-in: the larger of the ordinary limit and
  -- christmas_staff_max_party (60), as create_table_booking_staff_v06; and a party above the online
  -- Christmas ceiling, which no joined tables hold, is offered tables that are not joined, as the
  -- staff booking function seats it.
  IF lower(trim(coalesce(p_purpose, ''))) = 'christmas' THEN
    p_purpose := 'food';
    SELECT * INTO v_period FROM public.get_booking_period_for_date(p_booking_date);
    IF v_period.id IS NOT NULL AND v_period.period_kind = 'christmas' THEN
      IF COALESCE(p_channel, 'online') = 'online' THEN
        v_max_online := public.get_setting_int('table_booking_max_party_christmas_online', 26);
      ELSE
        v_max_online := greatest(v_max_online, public.get_setting_int('christmas_staff_max_party', 60));
        IF p_party_size > public.get_setting_int('table_booking_max_party_christmas_online', 26) THEN
          v_overrides := ROW(false, false, true, false)::public.table_allocation_overrides;
        END IF;
      END IF;
    END IF;
  END IF;
$new$),
      (7, 'check_table_availability_v06',
$old$          NULL, COALESCE(p_channel, 'online'), NULL, NULL, v_now) c
$old$,
$new$          NULL, COALESCE(p_channel, 'online'), NULL, v_overrides, v_now) c
$new$),
      (8, 'check_table_availability_v06',
$old$    'max_party_size_online', v_max_online,
    'duration_minutes', v_duration,
    'slots', v_slots
$old$,
$new$    'max_party_size_online', v_max_online,
    'duration_minutes', v_duration,
    -- True when the times offered seat a Christmas party across tables that are not joined, so
    -- staff are told to move them together before the party arrives.
    'tables_unjoined', COALESCE((v_overrides).allow_unjoined, false),
    'slots', v_slots
$new$),
      (9, 'create_table_booking_staff_v06',
$old$  v_max_party integer := public.get_setting_int('table_booking_max_party_online', 20);
BEGIN
$old$,
$new$  v_max_party integer := public.get_setting_int('table_booking_max_party_online', 20);
  v_overrides public.table_allocation_overrides := p_overrides;
  v_result jsonb;
  v_table_ids uuid[];
BEGIN
$new$),
      (10, 'create_table_booking_staff_v06',
$old$    v_max_party := greatest(v_max_party, public.get_setting_int('christmas_staff_max_party', 60));
    -- Core's legacy 'christmas' purpose refuses more than 20 as private hire, which is the website's
    -- rule. Above 20 the same booking goes in as an accepted Christmas period with purpose food, which
    -- core stores identically (booking_type from the period, booking_purpose 'food').
$old$,
$new$    v_max_party := greatest(v_max_party, public.get_setting_int('christmas_staff_max_party', 60));
    -- No joined tables hold a party above the online Christmas ceiling (the Dining Room joins to 26),
    -- so staff seat it across tables that are not joined (owner decision of 10 November 2026). Core
    -- audits the override with the actor, like any other. check_table_availability_v06 offers the
    -- same tables for the same party.
    IF p_party_size > public.get_setting_int('table_booking_max_party_christmas_online', 26) THEN
      v_overrides := ROW(COALESCE((p_overrides).ignore_minimum, false), COALESCE((p_overrides).ignore_hold, false),
        true, COALESCE((p_overrides).ignore_accessibility, false))::public.table_allocation_overrides;
    END IF;
    -- Above 20 the same booking goes in as an accepted Christmas period with purpose food, which core
    -- stores identically (booking_type from the period, booking_purpose 'food'). Kept from when core's
    -- legacy 'christmas' purpose refused more than 20; it no longer has a ceiling of its own.
$new$),
      (11, 'create_table_booking_staff_v06',
$old$  RETURN public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, v_purpose,
$old$,
$new$  v_result := public.create_table_booking_core_v06(
    p_customer_id, p_booking_date, p_booking_time, p_party_size, v_purpose,
$new$),
      (12, 'create_table_booking_staff_v06',
$old$    p_overrides, p_actor_id,
    p_booking_period_id, v_answer
  );
END;
$old$,
$new$    v_overrides, p_actor_id,
    p_booking_period_id, v_answer
  );

  -- Say when the party is on tables that are not joined, so staff move them together before it
  -- arrives.
  IF COALESCE((v_overrides).allow_unjoined, false) AND v_result->>'state' IN ('confirmed', 'pending_payment') THEN
    v_table_ids := ARRAY(SELECT jsonb_array_elements_text(COALESCE(v_result->'table_ids', '[]'::jsonb))::uuid);
    v_result := v_result || jsonb_build_object('tables_unjoined',
      cardinality(v_table_ids) > 1 AND NOT public.tables_are_connected(v_table_ids));
  END IF;
  RETURN v_result;
END;
$new$)
    ) AS t(step, proname, old_text, new_text)
    ORDER BY step
  LOOP
    SELECT count(*), min(p.oid) INTO v_count, v_oid
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = v_target.proname;

    IF v_count <> 1 THEN
      RAISE EXCEPTION 'christmas_online_26: expected one %, found %', v_target.proname, v_count;
    END IF;

    v_def := pg_get_functiondef(v_oid);
    v_old_hits := (length(v_def) - length(replace(v_def, v_target.old_text, ''))) / length(v_target.old_text);
    v_new_hits := (length(v_def) - length(replace(v_def, v_target.new_text, ''))) / length(v_target.new_text);
    -- A replacement may keep its old passage inside it (or the other way round), so the counts
    -- expected before and after are worked out from the two texts themselves.
    v_old_in_new := (length(v_target.new_text) - length(replace(v_target.new_text, v_target.old_text, '')))
      / length(v_target.old_text);
    v_new_in_old := (length(v_target.old_text) - length(replace(v_target.old_text, v_target.new_text, '')))
      / length(v_target.new_text);

    IF v_new_hits = 1 AND v_old_hits = v_old_in_new THEN
      RAISE NOTICE 'christmas_online_26: % step % already applied, skipped', v_target.proname, v_target.step;
      CONTINUE;
    END IF;

    IF v_old_hits <> 1 OR v_new_hits <> v_new_in_old THEN
      RAISE EXCEPTION 'christmas_online_26: % step % found % old and % new passages, expected 1 and %',
        v_target.proname, v_target.step, v_old_hits, v_new_hits, v_new_in_old;
    END IF;

    EXECUTE replace(v_def, v_target.old_text, v_target.new_text);
    RAISE NOTICE 'christmas_online_26: % step % patched', v_target.proname, v_target.step;
  END LOOP;
END
$patch$;

REVOKE ALL ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_public_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

REVOKE ALL ON FUNCTION public.create_table_booking_christmas_v01(
  jsonb, integer[]) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_christmas_v01(
  jsonb, integer[]) TO service_role;

REVOKE ALL ON FUNCTION public.check_table_availability_v06(
  date, integer, text, boolean, boolean, integer, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_table_availability_v06(
  date, integer, text, boolean, boolean, integer, text) TO service_role;

REVOKE ALL ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_staff_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

-- Every replaced function keeps SECURITY DEFINER or INVOKER and its search_path exactly as
-- production holds them, and stays callable by service_role only.
DO $check$
DECLARE
  v_row record;
BEGIN
  FOR v_row IN
    SELECT e.name, e.definer, e.config, p.prosecdef, p.proconfig, p.oid
      FROM (VALUES
      ('create_table_booking_public_v06', true, 'search_path=public'),
      ('create_table_booking_core_v06', true, 'search_path=public'),
      ('create_table_booking_christmas_v01', false, 'search_path=public, pg_catalog'),
      ('check_table_availability_v06', true, 'search_path=public'),
      ('create_table_booking_staff_v06', true, 'search_path=public')
      ) AS e(name, definer, config)
      JOIN pg_proc p ON p.proname = e.name
      JOIN pg_namespace n ON n.oid = p.pronamespace AND n.nspname = 'public'
  LOOP
    IF v_row.prosecdef IS DISTINCT FROM v_row.definer OR v_row.proconfig IS DISTINCT FROM ARRAY[v_row.config] THEN
      RAISE EXCEPTION 'christmas_online_26: % lost its security settings (definer %, config %)', v_row.name, v_row.prosecdef, v_row.proconfig;
    END IF;
    IF has_function_privilege('anon', v_row.oid, 'EXECUTE') OR has_function_privilege('authenticated', v_row.oid, 'EXECUTE')
       OR NOT has_function_privilege('service_role', v_row.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'christmas_online_26: % is not service_role only', v_row.name;
    END IF;
  END LOOP;
END
$check$;

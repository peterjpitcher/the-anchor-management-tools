-- Seasonal pre-orders: three tables, one sync function, one switch.
--
-- WHAT THIS IS FOR
--
-- A guest books a Christmas dinner through /book-table. The pub then needs to know what each person
-- at that table is eating, so the kitchen can order and prep. Today that conversation happens by
-- email and telephone and lands in a mailbox. This gives it somewhere to live.
--
-- THE SHAPE, and why it is this small
--
-- Two earlier designs grew to twelve tables, an outbox state machine and a refund saga before being
-- rejected. See tasks/seasonal-preorder-spec-v3-small-2026-08-04.md. Everything here reuses machinery
-- that is already in production: the seasonal periods and their menu (20260803000100), the booker's
-- existing manage-booking token, the A4 kitchen sheet and the jobs queue. Three tables is the whole
-- data model.
--
--   * booking_preorder_covers     one row per seat at the table
--   * booking_preorder_selections one row per course that seat is having
--   * booking_preorder_reminders  a two-row-per-booking ledger, so a cron cannot chase twice
--
-- THE COMPLETENESS RULE, owner-confirmed 2026-08-04: every cover must have a MAIN, and that is the
-- whole requirement. A starter and a dessert are optional, and not choosing one is a complete answer
-- rather than a missing one. Covers in the same party may differ. That rule is a read-time predicate
-- (src/lib/table-bookings/preorder.ts), NOT a constraint here: a booker filling the form in halves
-- must be able to save halfway.
--
-- THE ONE INVARIANT, and where it is NOT enforced. Cover count must equal party size. The previous
-- version put that in a deferred constraint trigger, and its own reviewer found that this breaks all
-- four live party-size writers, one of which is SQL inside the communal-event reallocation function
-- and none of which can wrap two calls in one transaction through supabase-js. So the amendment path
-- calls preorder_sync_covers() instead, and a nightly check reports any drift. Reporting a drift
-- beats refusing a booking.
--
-- GRANTS. A new function in public on this project is granted EXECUTE to anon and authenticated BY
-- NAME, and REVOKE ALL FROM PUBLIC does not remove that. The function below is revoked from both
-- explicitly and the migration ends with an assertion that FAILS rather than reporting success on a
-- half-closed door. Same pattern, same reason, as 20260801001300_lock_down_new_function_grants.sql.

BEGIN;

-- ===========================================================================
-- 1. The tables
-- ===========================================================================

-- One row per seat at the table.
CREATE TABLE IF NOT EXISTS public.booking_preorder_covers (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  ordinal          integer NOT NULL CHECK (ordinal >= 1),
  guest_name       text CHECK (guest_name IS NULL OR length(guest_name) <= 100),
  -- A service requirement, never a diagnosis. Free text a guest types about their own needs, which
  -- can amount to health information. Staff and kitchen only: never emailed, never in a manager
  -- digest, never in logs or telemetry. See section 8 of the spec.
  dietary_note     text CHECK (dietary_note IS NULL OR length(dietary_note) <= 200),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_booking_id, ordinal)
);

COMMENT ON TABLE public.booking_preorder_covers IS
  'One row per seat on a seasonal pre-order booking. Count must equal table_bookings.party_size; kept in step by preorder_sync_covers(), not by a trigger.';
COMMENT ON COLUMN public.booking_preorder_covers.dietary_note IS
  'A dietary requirement the guest typed. Staff and kitchen only. Never email it, never log it, never put it in a digest.';

-- One row per course that cover is having. A cover with only a main has one row.
CREATE TABLE IF NOT EXISTS public.booking_preorder_selections (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cover_id     uuid NOT NULL REFERENCES public.booking_preorder_covers(id) ON DELETE CASCADE,
  course       text NOT NULL CHECK (course IN ('starter', 'main', 'dessert')),
  menu_item_id uuid NOT NULL REFERENCES public.booking_period_menu_items(id),
  -- Frozen at the moment of choosing, so a later menu edit cannot rewrite history
  -- or make the kitchen list disagree with what the guest picked.
  item_name    text NOT NULL,
  price_gbp    numeric(10,2),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cover_id, course)
);

COMMENT ON COLUMN public.booking_preorder_selections.item_name IS
  'Snapshot of the dish name at the moment of choosing. A menu rename must not rewrite what the guest picked.';

-- At most one of each kind per booking. The unique constraint IS the idempotency:
-- a cron that runs twice cannot send twice.
CREATE TABLE IF NOT EXISTS public.booking_preorder_reminders (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  table_booking_id uuid NOT NULL REFERENCES public.table_bookings(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('booker_reminder', 'manager_escalation')),
  sent_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (table_booking_id, kind)
);

COMMENT ON TABLE public.booking_preorder_reminders IS
  'Chase ledger. Two messages per booking, ever. The unique constraint is the idempotency: write the row in the same transaction that enqueues the send.';

-- ===========================================================================
-- 2. Indexes
--
-- (table_booking_id) and (cover_id) come free with the unique constraints above. Only the
-- withdrawn-item check needs one of its own, and without it that check is a sequential scan of every
-- choice ever made.
-- ===========================================================================

CREATE INDEX IF NOT EXISTS booking_preorder_selections_menu_item_idx
  ON public.booking_preorder_selections (menu_item_id);

-- ===========================================================================
-- 3. updated_at, using the trigger function the periods tables already use
-- ===========================================================================

DROP TRIGGER IF EXISTS booking_preorder_covers_touch_updated_at ON public.booking_preorder_covers;
CREATE TRIGGER booking_preorder_covers_touch_updated_at
  BEFORE UPDATE ON public.booking_preorder_covers
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

DROP TRIGGER IF EXISTS booking_preorder_selections_touch_updated_at ON public.booking_preorder_selections;
CREATE TRIGGER booking_preorder_selections_touch_updated_at
  BEFORE UPDATE ON public.booking_preorder_selections
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

-- ===========================================================================
-- 4. RLS and grants. Service role only, exactly as booking_periods is secured.
--
-- Every read and write goes through a server action or an API route that has already checked
-- permission. No public client ever touches these tables directly, including the booker on the
-- manage-booking page, whose token is proven server side before anything is read.
-- ===========================================================================

ALTER TABLE public.booking_preorder_covers ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_preorder_covers_service_role_all ON public.booking_preorder_covers;
CREATE POLICY booking_preorder_covers_service_role_all ON public.booking_preorder_covers
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.booking_preorder_selections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_preorder_selections_service_role_all ON public.booking_preorder_selections;
CREATE POLICY booking_preorder_selections_service_role_all ON public.booking_preorder_selections
  FOR ALL TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.booking_preorder_reminders ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_preorder_reminders_service_role_all ON public.booking_preorder_reminders;
CREATE POLICY booking_preorder_reminders_service_role_all ON public.booking_preorder_reminders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- RLS with a service_role policy is not enough on its own: a table grant to anon would still let a
-- caller probe the SQL error surface.
REVOKE ALL ON TABLE public.booking_preorder_covers FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_preorder_selections FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_preorder_reminders FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_preorder_covers TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_preorder_selections TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_preorder_reminders TO service_role;

-- ===========================================================================
-- 5. preorder_sync_covers: the one invariant, made true after the fact
--
-- Called by whichever path just changed party size. Adds or removes cover rows so the count matches,
-- dropping the HIGHEST ordinals first, and returns what it dropped so the caller can tell the booker
-- which seats and which choices went.
--
-- It never CREATES covers for a booking that does not need a pre-order, because the amendment path
-- is shared by every booking in the pub and a party-size change on an ordinary Tuesday must not
-- start manufacturing seat rows. It always REMOVES excess covers, whatever the booking now says,
-- so a guest who switches off the seasonal offer does not leave orphaned seats behind.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.preorder_sync_covers(p_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER   -- must write tables that are service-role-only under RLS
SET search_path = public
AS $$
DECLARE
  v_booking   public.table_bookings;
  v_wanted    integer;
  v_removed   jsonb := '[]'::jsonb;
  v_added     integer := 0;
  v_count     integer;
BEGIN
  SELECT * INTO v_booking FROM public.table_bookings WHERE id = p_booking_id;
  IF v_booking.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'booking_not_found');
  END IF;

  -- Covers are wanted when the booking's own snapshot says the guest accepted a seasonal offer that
  -- requires a pre-order. The snapshot is read, not the period row, because a manager may have
  -- edited or archived the period since, and that must not change a booking already taken.
  IF COALESCE(v_booking.booking_period_requires_preorder, false)
     AND COALESCE(v_booking.booking_period_answer, false) THEN
    v_wanted := v_booking.party_size;
  ELSE
    -- Not a pre-order booking. Keep whatever covers already exist in step (someone may have taken
    -- the order before the answer changed), but never create the first one.
    SELECT count(*) INTO v_count
      FROM public.booking_preorder_covers WHERE table_booking_id = p_booking_id;
    v_wanted := CASE WHEN v_count > 0 THEN v_booking.party_size ELSE 0 END;
  END IF;

  -- Capture the doomed rows and their choices BEFORE the delete, because the selections cascade away
  -- with the cover and the caller needs to be able to say "seat 6, Dave, who was having the turkey".
  SELECT COALESCE(jsonb_agg(dropped ORDER BY (dropped ->> 'ordinal')::integer), '[]'::jsonb)
    INTO v_removed
  FROM (
    SELECT jsonb_build_object(
             'id', c.id,
             'ordinal', c.ordinal,
             'guest_name', c.guest_name,
             'courses', COALESCE((
               SELECT jsonb_agg(jsonb_build_object('course', s.course, 'item_name', s.item_name)
                                ORDER BY s.course)
                 FROM public.booking_preorder_selections s
                WHERE s.cover_id = c.id
             ), '[]'::jsonb)
           ) AS dropped
      FROM public.booking_preorder_covers c
     WHERE c.table_booking_id = p_booking_id
       AND c.ordinal > v_wanted
  ) doomed;

  -- Deleting everything above the wanted count IS "highest ordinals first", and it also cleans up
  -- any ordinal left stranded above the range by an older write.
  DELETE FROM public.booking_preorder_covers
   WHERE table_booking_id = p_booking_id
     AND ordinal > v_wanted;

  -- Fill the gaps rather than appending, so a party that shrinks and grows again reuses seat numbers
  -- instead of climbing forever.
  INSERT INTO public.booking_preorder_covers (table_booking_id, ordinal)
  SELECT p_booking_id, g
    FROM generate_series(1, GREATEST(v_wanted, 0)) g
   WHERE NOT EXISTS (
     SELECT 1 FROM public.booking_preorder_covers c
      WHERE c.table_booking_id = p_booking_id AND c.ordinal = g
   );
  GET DIAGNOSTICS v_added = ROW_COUNT;

  SELECT count(*) INTO v_count
    FROM public.booking_preorder_covers WHERE table_booking_id = p_booking_id;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', p_booking_id,
    'party_size', v_booking.party_size,
    'cover_count', v_count,
    'added', v_added,
    'removed', v_removed
  );
END;
$$;

COMMENT ON FUNCTION public.preorder_sync_covers(uuid) IS
  'Makes the cover count match party size after a party-size change. Drops the highest ordinals first and returns what it dropped. Deliberately not a trigger: a deferred constraint trigger breaks all four live party-size writers.';

-- ===========================================================================
-- 6. Grants on the new function. Proven, not assumed.
-- ===========================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'preorder_sync_covers'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

DO $$
DECLARE
  v_leaky text;
BEGIN
  SELECT string_agg(DISTINCT p.proname, ', ')
    INTO v_leaky
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'preorder_sync_covers'
    AND array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'preorder_sync_covers is still executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  END IF;
END;
$$;

-- ===========================================================================
-- 7. The one switch, default OFF
--
-- Everything above is inert until this is on. The whole readiness gate is this single row: no
-- multi-switch rollout, no staged flags. The owner turns it on, then publishes the menu.
-- ===========================================================================

INSERT INTO public.system_settings (key, value, description)
VALUES (
  'preorder_enabled',
  jsonb_build_object('value', false),
  'Master switch for seasonal pre-orders. Off until the festive menu is published. Off means no pre-order form, no chase messages and no kitchen pre-order block.'
)
ON CONFLICT (key) DO NOTHING;

-- Prove the switch shipped off. A pre-order form live before the menu is published would take
-- choices from dishes that do not exist yet.
DO $$
DECLARE
  v_value jsonb;
BEGIN
  SELECT value INTO v_value FROM public.system_settings WHERE key = 'preorder_enabled';
  IF v_value IS NULL THEN
    RAISE EXCEPTION 'The preorder_enabled setting row is missing.';
  END IF;
  IF COALESCE((v_value ->> 'value')::boolean, false) THEN
    RAISE EXCEPTION 'preorder_enabled must ship off. The festive menu is not published yet.';
  END IF;
END;
$$;

COMMIT;

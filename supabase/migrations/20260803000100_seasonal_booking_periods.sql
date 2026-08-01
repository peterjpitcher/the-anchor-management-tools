-- Seasonal booking periods: the data model, the guards and the deposit resolver.
--
-- WHAT THIS IS FOR
--
-- A manager needs to be able to declare a named window (Christmas dinner, Mother's Day, Easter,
-- Father's Day) with its own dates, its own guest question, its own deposit and its own pre-order
-- requirement, without a developer. Today the only seasonal concept in the schema is the enum value
-- `table_booking_type = 'christmas'`, and it is completely unguarded: nothing stops a Christmas
-- booking being taken for a date in June. That hole is stated plainly in the module comment at
-- src/lib/table-bookings/christmas.ts and is closed here.
--
-- THE RULES THIS ENCODES, all owner-confirmed 2026-07-30
--
--   * A deposit is per booking OR per head, the manager's choice per period.
--   * The deposit comes off the bill. It is not a no-show fee.
--   * Full refund up to 7 days before the booking date. Inside 7 days, no refund. A manager may
--     waive, and the waiver is audited by the existing deposit_waived path.
--   * Saying "no, this is not a Christmas dinner" during a Christmas period is allowed, and that
--     guest gets the normal menu at normal terms. So the pre-order requirement belongs to the
--     period, not to the date, which is why `requires_preorder` exists per period.
--   * When the party-size deposit rule and a period deposit both apply, the LARGER single deposit
--     wins. They never stack.
--
-- FIVE THINGS THAT WOULD BITE LATER IF THEY WERE NOT DONE HERE
--
--   1. The display name is manager-editable, so no rule may ever match on the word "Christmas".
--      `period_kind` is a stable, constrained value that machinery matches on; `name` is free text
--      the manager owns. `code` is the stable per-instance identifier.
--   2. Two live periods covering one date would show the guest two questions. The exclusion
--      constraint makes that impossible in the database, not merely unlikely in the UI.
--   3. Editing or archiving a period must not rewrite a booking already taken, because a payment
--      dispute has to be settleable from the booking row alone. The terms are therefore SNAPSHOT
--      onto table_bookings at creation: code, name, the guest's answer, basis, rate, computed
--      amount and the refund policy in words.
--   4. `booking_period_id` arrives from a browser. Nothing here trusts it. The resolver re-reads the
--      row by id AND by booking date and returns a distinguishable error code when it is stale,
--      inactive, archived or out of range.
--   5. A new function in `public` is granted EXECUTE to `anon` and `authenticated` by default on
--      this project. `REVOKE ALL FROM PUBLIC` does NOT remove that. Every function below is revoked
--      from those two roles by name, and the migration ends with an assertion that FAILS rather
--      than reporting success on a half-closed door. See 20260801001300_lock_down_new_function_grants.sql.
--
-- NO btree_gist NEEDED. It is not installed on this project (verified 2026-08-01) and it is not
-- required: the exclusion constraint below uses only the && operator on a single daterange
-- expression, which the built-in gist range_ops class handles. Do NOT add an equality column to
-- that constraint without installing btree_gist first.
--
-- STATE ON DAY ONE. The seeded Christmas 2026 period is INACTIVE, deliberately. The festive menu is
-- not published until October, and an inactive period is completely inert: it is invisible to the
-- guest, it produces no deposit, and it does not satisfy the Christmas guard. The owner activates
-- it from Settings, Table bookings, once the menu is loaded. Until then no Christmas booking can be
-- taken by any route, which is the point.

BEGIN;

-- ===========================================================================
-- 1. The periods themselves
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.booking_periods (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Stable machine identity. Never shown to a guest, never edited after creation.
  code                text NOT NULL UNIQUE,

  -- Stable category. Machinery matches on this. The Christmas guard below looks for
  -- period_kind = 'christmas' and never at the name, which the manager may rename to
  -- "Festive feasting 2026" on a whim.
  period_kind         text NOT NULL,

  -- Manager-editable display name. Shown to staff and, via the website, to guests.
  name                text NOT NULL,

  starts_on           date NOT NULL,
  ends_on             date NOT NULL,          -- inclusive

  -- What the guest is asked, and the sentence under it.
  guest_question      text NOT NULL,
  guest_blurb         text,

  -- Owner decision: Christmas needs a pre-order, Mother's Day may not.
  requires_preorder   boolean NOT NULL DEFAULT false,
  preorder_cutoff_days integer NOT NULL DEFAULT 7,

  deposit_basis       text NOT NULL DEFAULT 'none',
  deposit_amount      numeric(10,2) NOT NULL DEFAULT 0,
  refund_cutoff_days  integer NOT NULL DEFAULT 7,

  min_party_size      integer,
  max_party_size      integer,
  min_notice_hours    integer NOT NULL DEFAULT 0,

  -- Set only where an existing table_booking_type value must keep being stamped. 'christmas' on the
  -- seed row. Everything else stays 'regular' with booking_period_id set, so no ALTER TYPE is ever
  -- needed to add a season.
  legacy_booking_type public.table_booking_type,

  is_active           boolean NOT NULL DEFAULT false,
  archived_at         timestamptz,

  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid,
  updated_by          uuid,

  CONSTRAINT booking_periods_code_ck
    CHECK (code ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(code) BETWEEN 3 AND 60),
  CONSTRAINT booking_periods_kind_ck
    CHECK (period_kind IN ('christmas','mothers_day','fathers_day','easter','new_year','valentines','other')),
  CONSTRAINT booking_periods_name_ck
    CHECK (length(btrim(name)) BETWEEN 2 AND 80),
  CONSTRAINT booking_periods_question_ck
    CHECK (length(btrim(guest_question)) BETWEEN 5 AND 160),
  CONSTRAINT booking_periods_blurb_ck
    CHECK (guest_blurb IS NULL OR length(guest_blurb) <= 400),
  CONSTRAINT booking_periods_dates_ck
    CHECK (ends_on >= starts_on),
  -- A season longer than a year is a typo, not a season.
  CONSTRAINT booking_periods_span_ck
    CHECK (ends_on - starts_on <= 366),
  CONSTRAINT booking_periods_basis_ck
    CHECK (deposit_basis IN ('none','per_head','per_booking')),
  CONSTRAINT booking_periods_amount_ck
    CHECK (deposit_amount >= 0 AND deposit_amount <= 1000),
  -- A deposit basis with a zero amount is a half-configured period that would quietly charge
  -- nothing. Refuse it at the door.
  CONSTRAINT booking_periods_amount_matches_basis_ck
    CHECK ((deposit_basis = 'none' AND deposit_amount = 0)
           OR (deposit_basis <> 'none' AND deposit_amount > 0)),
  CONSTRAINT booking_periods_refund_ck
    CHECK (refund_cutoff_days BETWEEN 0 AND 90),
  CONSTRAINT booking_periods_preorder_cutoff_ck
    CHECK (preorder_cutoff_days BETWEEN 0 AND 90),
  CONSTRAINT booking_periods_min_party_ck
    CHECK (min_party_size IS NULL OR min_party_size BETWEEN 1 AND 200),
  CONSTRAINT booking_periods_max_party_ck
    CHECK (max_party_size IS NULL OR max_party_size BETWEEN 1 AND 200),
  CONSTRAINT booking_periods_party_order_ck
    CHECK (min_party_size IS NULL OR max_party_size IS NULL OR max_party_size >= min_party_size),
  CONSTRAINT booking_periods_notice_ck
    CHECK (min_notice_hours BETWEEN 0 AND 720),
  -- An archived period can never be live. Belt and braces so the exclusion constraint's WHERE
  -- clause cannot be sidestepped by archiving something that is still flagged active.
  CONSTRAINT booking_periods_archived_not_active_ck
    CHECK (archived_at IS NULL OR is_active = false),

  -- THE LOAD-BEARING ONE. At most one LIVE period may contain any given date, so the guest is never
  -- asked to choose between two offers and the lookup can safely return a single row. Inactive and
  -- archived periods are exempt, which is what lets next year's Christmas be drafted while this
  -- year's is still running.
  CONSTRAINT booking_periods_no_overlap
    EXCLUDE USING gist ((daterange(starts_on, ends_on, '[]')) WITH &&)
    WHERE (is_active AND archived_at IS NULL)
);

COMMENT ON TABLE public.booking_periods IS
  'Manager-defined seasonal table-booking windows. period_kind is stable and machine-readable; name is free text the manager owns. At most one active period may cover any date.';
COMMENT ON COLUMN public.booking_periods.period_kind IS
  'Stable category. Match on this, NEVER on name, which is editable.';
COMMENT ON COLUMN public.booking_periods.is_active IS
  'Defaults to false. An inactive period is completely inert: no guest question, no deposit, no availability effect, and it does not satisfy the Christmas guard.';

CREATE INDEX IF NOT EXISTS booking_periods_live_dates_idx
  ON public.booking_periods (starts_on, ends_on)
  WHERE is_active AND archived_at IS NULL;

ALTER TABLE public.booking_periods ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS booking_periods_service_role_all ON public.booking_periods;
CREATE POLICY booking_periods_service_role_all ON public.booking_periods
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ===========================================================================
-- 2. The pre-order menu for a period
--
-- Owner decision 2026-08-01: build the mechanism now with an EMPTY menu. The Christmas menu is
-- published in October and the owner loads it through settings. A period that requires a pre-order
-- but has no active items is NOT bookable, and the guest is told so plainly rather than being shown
-- an empty menu. `booking_period_menu_ready` is the single place that decides that.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.booking_period_menu_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  period_id   uuid NOT NULL REFERENCES public.booking_periods(id) ON DELETE CASCADE,
  course      text NOT NULL,
  name        text NOT NULL,
  description text,
  price_gbp   numeric(10,2),
  allergens   text,
  sort_order  integer NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_by  uuid,

  CONSTRAINT bpmi_course_ck
    CHECK (course IN ('starter','main','dessert','side','drink','other')),
  CONSTRAINT bpmi_name_ck
    CHECK (length(btrim(name)) BETWEEN 1 AND 120),
  CONSTRAINT bpmi_description_ck
    CHECK (description IS NULL OR length(description) <= 500),
  CONSTRAINT bpmi_allergens_ck
    CHECK (allergens IS NULL OR length(allergens) <= 300),
  CONSTRAINT bpmi_price_ck
    CHECK (price_gbp IS NULL OR (price_gbp >= 0 AND price_gbp <= 500)),
  CONSTRAINT bpmi_sort_ck
    CHECK (sort_order BETWEEN 0 AND 999)
);

COMMENT ON TABLE public.booking_period_menu_items IS
  'Pre-order menu for a seasonal period. Empty until the owner publishes the menu. A period requiring a pre-order with no active items is not bookable.';

CREATE INDEX IF NOT EXISTS bpmi_period_idx
  ON public.booking_period_menu_items (period_id, sort_order);

ALTER TABLE public.booking_period_menu_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS bpmi_service_role_all ON public.booking_period_menu_items;
CREATE POLICY bpmi_service_role_all ON public.booking_period_menu_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ===========================================================================
-- 3. The terms snapshot on the booking
--
-- Why snapshot rather than join. A manager renames a period, shrinks its dates, changes its deposit
-- or archives it entirely. None of that may alter a booking already taken. If a guest disputes a
-- charge six months later, the booking row alone must answer: which period, called what, did they
-- say yes, on what basis, at what rate, for how much, and what was the refund promise. A join to a
-- mutable configuration row cannot answer that.
-- ===========================================================================

ALTER TABLE public.table_bookings
  ADD COLUMN IF NOT EXISTS booking_period_id            uuid
    REFERENCES public.booking_periods(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS booking_period_code          text,
  ADD COLUMN IF NOT EXISTS booking_period_name          text,
  ADD COLUMN IF NOT EXISTS booking_period_answer        boolean,
  ADD COLUMN IF NOT EXISTS booking_period_requires_preorder boolean,
  ADD COLUMN IF NOT EXISTS deposit_rule                 text,
  ADD COLUMN IF NOT EXISTS deposit_basis                text,
  ADD COLUMN IF NOT EXISTS deposit_rate                 numeric(10,2),
  ADD COLUMN IF NOT EXISTS deposit_refund_cutoff_days   integer,
  ADD COLUMN IF NOT EXISTS deposit_refund_policy        text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_bookings_deposit_rule_ck'
  ) THEN
    ALTER TABLE public.table_bookings
      ADD CONSTRAINT table_bookings_deposit_rule_ck
      CHECK (deposit_rule IS NULL OR deposit_rule IN ('none','group','period','manual','waived'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'table_bookings_deposit_basis_ck'
  ) THEN
    ALTER TABLE public.table_bookings
      ADD CONSTRAINT table_bookings_deposit_basis_ck
      CHECK (deposit_basis IS NULL OR deposit_basis IN ('per_head','per_booking'));
  END IF;
END;
$$;

COMMENT ON COLUMN public.table_bookings.booking_period_code IS
  'Snapshot of booking_periods.code at creation. Survives a rename, an archive and a date change.';
COMMENT ON COLUMN public.table_bookings.booking_period_answer IS
  'What the guest actually answered. false means they declined the seasonal offer and booked the normal menu at normal terms.';
COMMENT ON COLUMN public.table_bookings.deposit_rule IS
  'Which rule produced the deposit: group (party-size rule), period (seasonal rule), manual, waived or none. Never recomputed after creation.';

CREATE INDEX IF NOT EXISTS table_bookings_booking_period_idx
  ON public.table_bookings (booking_period_id)
  WHERE booking_period_id IS NOT NULL;

-- ===========================================================================
-- 4. Housekeeping trigger for updated_at
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.touch_booking_period_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS booking_periods_touch_updated_at ON public.booking_periods;
CREATE TRIGGER booking_periods_touch_updated_at
  BEFORE UPDATE ON public.booking_periods
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

DROP TRIGGER IF EXISTS bpmi_touch_updated_at ON public.booking_period_menu_items;
CREATE TRIGGER bpmi_touch_updated_at
  BEFORE UPDATE ON public.booking_period_menu_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_period_updated_at();

-- ===========================================================================
-- 5. Lookups
-- ===========================================================================

-- The single live period covering a date, or no row. The exclusion constraint above is what makes
-- "the single" true rather than "the first we happened to find".
CREATE OR REPLACE FUNCTION public.get_booking_period_for_date(p_date date)
RETURNS public.booking_periods
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT *
  FROM public.booking_periods
  WHERE is_active
    AND archived_at IS NULL
    AND p_date BETWEEN starts_on AND ends_on
  LIMIT 1;
$$;

-- A period that requires a pre-order is only bookable once its menu exists. This is the ONE place
-- that decides that, so the guest flow, the staff flow and the website endpoint cannot disagree.
CREATE OR REPLACE FUNCTION public.booking_period_menu_ready(p_period_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_period_id IS NULL THEN true
    WHEN NOT (SELECT requires_preorder FROM public.booking_periods WHERE id = p_period_id) THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.booking_period_menu_items
      WHERE period_id = p_period_id AND is_active
    )
  END;
$$;

-- ===========================================================================
-- 6. The deposit resolver
--
-- ONE place decides money. The TypeScript mirror lives in
-- src/lib/table-bookings/period-deposit.ts and is unit tested, including the tie case below. If you
-- change a rule here, change it there in the same commit.
--
-- Precedence, in order:
--   1. A manager waiver wins outright. No deposit, any party size, any period.
--   2. The party-size rule: 10 guests or more, at GBP 10 per head.
--   3. The period rule: per head or per booking, at the period's own rate, and only when the guest
--      actually accepted the seasonal offer.
--   4. The LARGER of 2 and 3 wins. They NEVER stack. A tie resolves to the period, so the wording
--      the guest sees names the season.
--
-- The tie is not hypothetical: Christmas is seeded at GBP 10 per head and the party-size rule is
-- GBP 10 per head, so a party of 12 inside Christmas produces 120 by both routes. Returning 240
-- would be invisible in testing unless someone looked for it. The test suite looks for it.
--
-- NOTHING here trusts the caller's copy of the period. p_period_id is re-read by id AND validated
-- against p_booking_date, and a stale, inactive, archived or out-of-range id comes back as a
-- distinguishable error code rather than a silent zero.
-- ===========================================================================

-- The party-size rule. Kept in step with LARGE_GROUP_DEPOSIT_THRESHOLD and
-- LARGE_GROUP_DEPOSIT_PER_PERSON_GBP in src/lib/table-bookings/deposit.ts. Deliberately NOT a
-- setting: two editable copies of the same number is how a guest gets charged the wrong amount.
CREATE OR REPLACE FUNCTION public.resolve_table_booking_deposit(
  p_party_size     integer,
  p_booking_date   date,
  p_period_id      uuid DEFAULT NULL,
  p_period_answer  boolean DEFAULT NULL,
  p_deposit_waived boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_group_threshold  constant integer := 10;
  c_group_per_head   constant numeric := 10.0;

  v_period           public.booking_periods;
  v_group_amount     numeric(10,2) := 0;
  v_period_amount    numeric(10,2) := 0;
  v_accepted         boolean := COALESCE(p_period_answer, false);
BEGIN
  IF p_party_size IS NULL OR p_party_size < 1 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_party_size');
  END IF;

  -- 1. Waiver wins outright.
  IF COALESCE(p_deposit_waived, false) THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', false, 'amount', 0, 'rule', 'waived',
      'basis', NULL, 'rate', NULL,
      'reason', 'A manager waived the deposit for this booking.',
      'period_id', NULL, 'period_code', NULL, 'period_name', NULL,
      'refund_cutoff_days', NULL, 'refund_policy', NULL
    );
  END IF;

  -- 2. Re-read the period server side. The client's copy is never used for money.
  IF p_period_id IS NOT NULL THEN
    SELECT * INTO v_period FROM public.booking_periods WHERE id = p_period_id;

    IF v_period.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_not_found');
    END IF;
    IF v_period.archived_at IS NOT NULL THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_archived');
    END IF;
    IF NOT v_period.is_active THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_inactive');
    END IF;
    IF p_booking_date IS NULL OR p_booking_date NOT BETWEEN v_period.starts_on AND v_period.ends_on THEN
      RETURN jsonb_build_object('ok', false, 'error_code', 'period_date_mismatch');
    END IF;

    IF v_accepted THEN
      IF v_period.min_party_size IS NOT NULL AND p_party_size < v_period.min_party_size THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_party_too_small');
      END IF;
      IF v_period.max_party_size IS NOT NULL AND p_party_size > v_period.max_party_size THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_party_too_large');
      END IF;
      IF NOT public.booking_period_menu_ready(v_period.id) THEN
        RETURN jsonb_build_object('ok', false, 'error_code', 'period_menu_not_ready');
      END IF;

      v_period_amount := ROUND(
        CASE v_period.deposit_basis
          WHEN 'per_head'    THEN p_party_size::numeric * v_period.deposit_amount
          WHEN 'per_booking' THEN v_period.deposit_amount
          ELSE 0
        END, 2);
    END IF;
  END IF;

  -- 3. The party-size rule, always evaluated.
  IF p_party_size >= c_group_threshold THEN
    v_group_amount := ROUND(p_party_size::numeric * c_group_per_head, 2);
  END IF;

  -- 4. Larger wins, never stacks. A tie goes to the period so the guest-facing wording names the
  --    season rather than "large group".
  IF v_period_amount > 0 AND v_period_amount >= v_group_amount THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', true, 'amount', v_period_amount, 'rule', 'period',
      'basis', v_period.deposit_basis, 'rate', v_period.deposit_amount,
      'reason', format('%s deposit, %s.', v_period.name,
        CASE v_period.deposit_basis
          WHEN 'per_head' THEN format('GBP %s per guest', trim(to_char(v_period.deposit_amount, 'FM999990.00')))
          ELSE format('GBP %s for the booking', trim(to_char(v_period.deposit_amount, 'FM999990.00')))
        END),
      'period_id', v_period.id, 'period_code', v_period.code, 'period_name', v_period.name,
      'refund_cutoff_days', v_period.refund_cutoff_days,
      'refund_policy', format(
        'Full refund up to %s days before the booking date. Inside %s days the deposit is not refunded, though a manager may waive that.',
        v_period.refund_cutoff_days, v_period.refund_cutoff_days)
    );
  END IF;

  IF v_group_amount > 0 THEN
    RETURN jsonb_build_object(
      'ok', true, 'required', true, 'amount', v_group_amount, 'rule', 'group',
      'basis', 'per_head', 'rate', c_group_per_head,
      'reason', format('Parties of %s or more pay GBP %s per guest.', c_group_threshold,
                       trim(to_char(c_group_per_head, 'FM999990.00'))),
      'period_id', CASE WHEN v_accepted THEN v_period.id ELSE NULL END,
      'period_code', CASE WHEN v_accepted THEN v_period.code ELSE NULL END,
      'period_name', CASE WHEN v_accepted THEN v_period.name ELSE NULL END,
      'refund_cutoff_days', NULL, 'refund_policy', NULL
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'required', false, 'amount', 0, 'rule', 'none',
    'basis', NULL, 'rate', NULL, 'reason', 'No deposit is due for this booking.',
    'period_id', CASE WHEN v_accepted THEN v_period.id ELSE NULL END,
    'period_code', CASE WHEN v_accepted THEN v_period.code ELSE NULL END,
    'period_name', CASE WHEN v_accepted THEN v_period.name ELSE NULL END,
    'refund_cutoff_days', NULL, 'refund_policy', NULL
  );
END;
$$;

-- ===========================================================================
-- 7. The Christmas guard
--
-- `table_booking_type` already contains 'christmas' and it is enforced NOWHERE. A Christmas booking
-- can be taken for a date in June today. This closes it, at the table, so every route is covered:
-- the v06 RPC, the FOH modal, a support script and a hand-written INSERT alike.
--
-- The check fires on INSERT, and on UPDATE only when booking_type or booking_date actually change.
-- That matters: once the season is over and the period is archived, staff must still be able to
-- update those bookings (status, notes, party size). Re-checking on every UPDATE would freeze them.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.assert_seasonal_booking_type_in_period()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER   -- must read booking_periods, which is service-role-only under RLS
SET search_path = public
AS $$
DECLARE
  v_period public.booking_periods;
BEGIN
  IF NEW.booking_type IS DISTINCT FROM 'christmas'::public.table_booking_type THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE'
     AND NEW.booking_type IS NOT DISTINCT FROM OLD.booking_type
     AND NEW.booking_date IS NOT DISTINCT FROM OLD.booking_date THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_period
  FROM public.booking_periods
  WHERE period_kind = 'christmas'
    AND is_active
    AND archived_at IS NULL
    AND NEW.booking_date BETWEEN starts_on AND ends_on
  LIMIT 1;

  IF v_period.id IS NULL THEN
    RAISE EXCEPTION
      'Christmas bookings are not open for %. A manager needs to activate the Christmas period in Settings, Table bookings, and it must cover that date.',
      to_char(NEW.booking_date, 'DD Mon YYYY')
      USING ERRCODE = '22023';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS table_bookings_seasonal_type_guard ON public.table_bookings;
CREATE TRIGGER table_bookings_seasonal_type_guard
  BEFORE INSERT OR UPDATE OF booking_type, booking_date ON public.table_bookings
  FOR EACH ROW EXECUTE FUNCTION public.assert_seasonal_booking_type_in_period();

-- ===========================================================================
-- 8. Manager CRUD, in the database, so validation and the audit row cannot be walked around
--
-- Mirrors set_table_booking_settings: the AMS route proves authority with its RBAC check and then
-- passes the actor in. These functions are service-role only for exactly that reason.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.get_booking_periods()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(jsonb_agg(period_row ORDER BY period_row ->> 'starts_on' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', p.id,
      'code', p.code,
      'period_kind', p.period_kind,
      'name', p.name,
      'starts_on', p.starts_on,
      'ends_on', p.ends_on,
      'guest_question', p.guest_question,
      'guest_blurb', p.guest_blurb,
      'requires_preorder', p.requires_preorder,
      'preorder_cutoff_days', p.preorder_cutoff_days,
      'deposit_basis', p.deposit_basis,
      'deposit_amount', p.deposit_amount,
      'refund_cutoff_days', p.refund_cutoff_days,
      'min_party_size', p.min_party_size,
      'max_party_size', p.max_party_size,
      'min_notice_hours', p.min_notice_hours,
      'legacy_booking_type', p.legacy_booking_type,
      'is_active', p.is_active,
      'archived_at', p.archived_at,
      'menu_ready', public.booking_period_menu_ready(p.id),
      'booking_count', (SELECT count(*) FROM public.table_bookings b WHERE b.booking_period_id = p.id),
      'menu_items', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'id', m.id, 'course', m.course, 'name', m.name, 'description', m.description,
          'price_gbp', m.price_gbp, 'allergens', m.allergens,
          'sort_order', m.sort_order, 'is_active', m.is_active
        ) ORDER BY m.sort_order, m.name)
        FROM public.booking_period_menu_items m WHERE m.period_id = p.id
      ), '[]'::jsonb)
    ) AS period_row
    FROM public.booking_periods p
  ) period_rows;
$$;

CREATE OR REPLACE FUNCTION public.set_booking_period(p_payload jsonb, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id          uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_existing    public.booking_periods;
  v_old         jsonb;
  v_code        text := lower(btrim(COALESCE(p_payload ->> 'code', '')));
  v_kind        text := btrim(COALESCE(p_payload ->> 'period_kind', ''));
  v_name        text := btrim(COALESCE(p_payload ->> 'name', ''));
  v_starts      date;
  v_ends        date;
  v_basis       text := COALESCE(p_payload ->> 'deposit_basis', 'none');
  v_amount      numeric;
  v_min_party   integer := NULLIF(p_payload ->> 'min_party_size', '')::integer;
  v_max_party   integer := NULLIF(p_payload ->> 'max_party_size', '')::integer;
  v_clash       text;
  v_result      public.booking_periods;
BEGIN
  BEGIN
    v_starts := (p_payload ->> 'starts_on')::date;
    v_ends   := (p_payload ->> 'ends_on')::date;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Both dates must be real calendar dates.');
  END;

  BEGIN
    v_amount := COALESCE((p_payload ->> 'deposit_amount')::numeric, 0);
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The deposit amount must be a number.');
  END;

  IF v_starts IS NULL OR v_ends IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A period needs a start date and an end date.');
  END IF;
  IF v_ends < v_starts THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The end date cannot be before the start date.');
  END IF;
  IF v_name = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A period needs a name.');
  END IF;
  IF btrim(COALESCE(p_payload ->> 'guest_question', '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A period needs the question the guest is asked.');
  END IF;
  IF v_basis NOT IN ('none','per_head','per_booking') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The deposit basis must be per head, per booking, or none.');
  END IF;
  IF v_basis = 'none' AND v_amount <> 0 THEN
    v_amount := 0;
  END IF;
  IF v_basis <> 'none' AND v_amount <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A deposit basis needs an amount above zero, or set the basis to none.');
  END IF;
  IF v_amount < 0 OR v_amount > 1000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The deposit must be between GBP 0 and GBP 1000.');
  END IF;
  IF v_min_party IS NOT NULL AND v_max_party IS NOT NULL AND v_max_party < v_min_party THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The largest party cannot be smaller than the smallest party.');
  END IF;

  IF v_id IS NULL THEN
    -- Create.
    IF v_code = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A period needs a short code, for example christmas-2027.');
    END IF;
    IF v_kind = '' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'A period needs a kind.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.booking_periods WHERE code = v_code) THEN
      RETURN jsonb_build_object('ok', false, 'error', format('The code "%s" is already used by another period.', v_code));
    END IF;
  ELSE
    SELECT * INTO v_existing FROM public.booking_periods WHERE id = v_id;
    IF v_existing.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That period no longer exists.');
    END IF;
    -- code and period_kind are the stable machine identity. They are never editable, because rules
    -- match on them and a booking has already snapshotted the code.
    v_code := v_existing.code;
    v_kind := v_existing.period_kind;
    v_old  := to_jsonb(v_existing);
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.booking_periods (
        code, period_kind, name, starts_on, ends_on, guest_question, guest_blurb,
        requires_preorder, preorder_cutoff_days, deposit_basis, deposit_amount,
        refund_cutoff_days, min_party_size, max_party_size, min_notice_hours,
        is_active, created_by, updated_by
      ) VALUES (
        v_code, v_kind, v_name, v_starts, v_ends,
        btrim(p_payload ->> 'guest_question'),
        NULLIF(btrim(COALESCE(p_payload ->> 'guest_blurb', '')), ''),
        COALESCE((p_payload ->> 'requires_preorder')::boolean, false),
        COALESCE((p_payload ->> 'preorder_cutoff_days')::integer, 7),
        v_basis, v_amount,
        COALESCE((p_payload ->> 'refund_cutoff_days')::integer, 7),
        v_min_party, v_max_party,
        COALESCE((p_payload ->> 'min_notice_hours')::integer, 0),
        -- A new period is never born live. The manager switches it on deliberately once it is right.
        false, p_actor_id, p_actor_id
      )
      RETURNING * INTO v_result;
    ELSE
      UPDATE public.booking_periods SET
        name                 = v_name,
        starts_on            = v_starts,
        ends_on              = v_ends,
        guest_question       = btrim(p_payload ->> 'guest_question'),
        guest_blurb          = NULLIF(btrim(COALESCE(p_payload ->> 'guest_blurb', '')), ''),
        requires_preorder    = COALESCE((p_payload ->> 'requires_preorder')::boolean, requires_preorder),
        preorder_cutoff_days = COALESCE((p_payload ->> 'preorder_cutoff_days')::integer, preorder_cutoff_days),
        deposit_basis        = v_basis,
        deposit_amount       = v_amount,
        refund_cutoff_days   = COALESCE((p_payload ->> 'refund_cutoff_days')::integer, refund_cutoff_days),
        min_party_size       = v_min_party,
        max_party_size       = v_max_party,
        min_notice_hours     = COALESCE((p_payload ->> 'min_notice_hours')::integer, min_notice_hours),
        updated_by           = p_actor_id
      WHERE id = v_id
      RETURNING * INTO v_result;
    END IF;
  EXCEPTION
    WHEN exclusion_violation THEN
      SELECT string_agg(format('%s (%s to %s)', name, starts_on, ends_on), ', ')
        INTO v_clash
        FROM public.booking_periods
       WHERE is_active AND archived_at IS NULL
         AND (v_id IS NULL OR id <> v_id)
         AND daterange(starts_on, ends_on, '[]') && daterange(v_starts, v_ends, '[]');
      RETURN jsonb_build_object('ok', false, 'error',
        format('Those dates overlap an active period: %s. Two active periods would ask the guest two questions.',
               COALESCE(v_clash, 'another period')));
    WHEN check_violation THEN
      RETURN jsonb_build_object('ok', false, 'error',
        'One of the values is outside the allowed range. Check the dates, the deposit and the party sizes.');
    WHEN unique_violation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That code is already used by another period.');
  END;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values)
  VALUES
    (p_actor_id, CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END,
     'booking_period', v_result.id::text, 'success', v_old, to_jsonb(v_result));

  RETURN jsonb_build_object('ok', true, 'id', v_result.id);
END;
$$;

-- Activate, deactivate or archive. Separated from the editor so the manager can flip a period
-- without resending every field, and so the overlap error can name the clash.
CREATE OR REPLACE FUNCTION public.set_booking_period_active(
  p_id uuid, p_is_active boolean, p_archive boolean, p_actor_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.booking_periods;
  v_result   public.booking_periods;
  v_clash    text;
BEGIN
  SELECT * INTO v_existing FROM public.booking_periods WHERE id = p_id;
  IF v_existing.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'That period no longer exists.');
  END IF;

  IF p_is_active AND v_existing.requires_preorder AND NOT public.booking_period_menu_ready(p_id) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'This period needs a pre-order, so it cannot go live until at least one menu item is added.');
  END IF;

  BEGIN
    UPDATE public.booking_periods
       SET is_active   = CASE WHEN COALESCE(p_archive, false) THEN false ELSE p_is_active END,
           archived_at = CASE WHEN COALESCE(p_archive, false) THEN now() ELSE archived_at END,
           updated_by  = p_actor_id
     WHERE id = p_id
    RETURNING * INTO v_result;
  EXCEPTION WHEN exclusion_violation THEN
    SELECT string_agg(format('%s (%s to %s)', name, starts_on, ends_on), ', ')
      INTO v_clash
      FROM public.booking_periods
     WHERE is_active AND archived_at IS NULL AND id <> p_id
       AND daterange(starts_on, ends_on, '[]') && daterange(v_existing.starts_on, v_existing.ends_on, '[]');
    RETURN jsonb_build_object('ok', false, 'error',
      format('Cannot switch this on: its dates overlap an active period, %s.', COALESCE(v_clash, 'another period')));
  END;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values)
  VALUES
    (p_actor_id, 'update', 'booking_period', p_id::text, 'success',
     to_jsonb(v_existing), to_jsonb(v_result));

  RETURN jsonb_build_object('ok', true, 'id', p_id, 'is_active', v_result.is_active);
END;
$$;

CREATE OR REPLACE FUNCTION public.upsert_booking_period_menu_item(p_payload jsonb, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id        uuid := NULLIF(p_payload ->> 'id', '')::uuid;
  v_period_id uuid := NULLIF(p_payload ->> 'period_id', '')::uuid;
  v_existing  public.booking_period_menu_items;
  v_result    public.booking_period_menu_items;
  v_price     numeric;
BEGIN
  IF btrim(COALESCE(p_payload ->> 'name', '')) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A menu item needs a name.');
  END IF;

  BEGIN
    v_price := NULLIF(p_payload ->> 'price_gbp', '')::numeric;
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The price must be a number, or left blank.');
  END;

  IF v_id IS NULL THEN
    IF v_period_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.booking_periods WHERE id = v_period_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That period no longer exists.');
    END IF;
  ELSE
    SELECT * INTO v_existing FROM public.booking_period_menu_items WHERE id = v_id;
    IF v_existing.id IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'That menu item no longer exists.');
    END IF;
    v_period_id := v_existing.period_id;
  END IF;

  BEGIN
    IF v_id IS NULL THEN
      INSERT INTO public.booking_period_menu_items
        (period_id, course, name, description, price_gbp, allergens, sort_order, is_active, created_by, updated_by)
      VALUES (
        v_period_id,
        COALESCE(NULLIF(p_payload ->> 'course', ''), 'main'),
        btrim(p_payload ->> 'name'),
        NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
        v_price,
        NULLIF(btrim(COALESCE(p_payload ->> 'allergens', '')), ''),
        COALESCE((p_payload ->> 'sort_order')::integer, 0),
        COALESCE((p_payload ->> 'is_active')::boolean, true),
        p_actor_id, p_actor_id)
      RETURNING * INTO v_result;
    ELSE
      UPDATE public.booking_period_menu_items SET
        course      = COALESCE(NULLIF(p_payload ->> 'course', ''), course),
        name        = btrim(p_payload ->> 'name'),
        description = NULLIF(btrim(COALESCE(p_payload ->> 'description', '')), ''),
        price_gbp   = v_price,
        allergens   = NULLIF(btrim(COALESCE(p_payload ->> 'allergens', '')), ''),
        sort_order  = COALESCE((p_payload ->> 'sort_order')::integer, sort_order),
        is_active   = COALESCE((p_payload ->> 'is_active')::boolean, is_active),
        updated_by  = p_actor_id
      WHERE id = v_id
      RETURNING * INTO v_result;
    END IF;
  EXCEPTION WHEN check_violation THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'One of the values is too long or outside the allowed range. Check the name, description and price.');
  END;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values)
  VALUES
    (p_actor_id, CASE WHEN v_id IS NULL THEN 'create' ELSE 'update' END,
     'booking_period_menu_item', v_result.id::text, 'success',
     CASE WHEN v_id IS NULL THEN NULL ELSE to_jsonb(v_existing) END, to_jsonb(v_result));

  RETURN jsonb_build_object('ok', true, 'id', v_result.id);
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_booking_period_menu_item(p_id uuid, p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_existing public.booking_period_menu_items;
BEGIN
  SELECT * INTO v_existing FROM public.booking_period_menu_items WHERE id = p_id;
  IF v_existing.id IS NULL THEN
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- Removing the last item from a live period that requires a pre-order would leave guests able to
  -- book a meal with nothing to order. Refuse it and let the manager deactivate the period first.
  IF EXISTS (
    SELECT 1 FROM public.booking_periods p
     WHERE p.id = v_existing.period_id AND p.is_active AND p.archived_at IS NULL AND p.requires_preorder
  ) AND NOT EXISTS (
    SELECT 1 FROM public.booking_period_menu_items m
     WHERE m.period_id = v_existing.period_id AND m.is_active AND m.id <> p_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error',
      'This is the last menu item on a live period that needs a pre-order. Switch the period off first.');
  END IF;

  DELETE FROM public.booking_period_menu_items WHERE id = p_id;

  INSERT INTO public.audit_logs
    (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values)
  VALUES
    (p_actor_id, 'delete', 'booking_period_menu_item', p_id::text, 'success', to_jsonb(v_existing), NULL);

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- ===========================================================================
-- 9. The deposit kill switch, in the existing settings machinery
--
-- Owner decision 2026-08-01: deposit collection is ON. This setting is the kill switch, not a
-- staged rollout: if something goes wrong with a seasonal deposit at 7pm on a Friday, a manager can
-- switch collection off from the settings screen without a deploy. Safety on day one comes from the
-- Christmas period being seeded INACTIVE instead.
-- ===========================================================================

INSERT INTO public.settings_revisions (section) VALUES ('deposits')
ON CONFLICT (section) DO NOTHING;

INSERT INTO public.system_settings (key, value)
VALUES ('booking_period_deposits_enabled', jsonb_build_object('value', true))
ON CONFLICT (key) DO NOTHING;

-- Additive: adds the 'deposits' section. Every existing section is byte-identical to
-- 20260801000500_table_booking_settings_rpc.sql.
CREATE OR REPLACE FUNCTION public.table_booking_settings_keys(p_section text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_section
    WHEN 'turn_times' THEN ARRAY[
      'turn_time_minutes_1_2','turn_time_minutes_3_4','turn_time_minutes_5_6',
      'turn_time_minutes_7_plus','turn_time_sunday_uplift_minutes','turnaround_gap_minutes',
      'turn_times_enabled']
    WHEN 'kitchen_pacing' THEN ARRAY[
      'kitchen_pacing_enabled','kitchen_pacing_window_minutes',
      'kitchen_pace_covers_regular','kitchen_pace_covers_sunday',
      'kitchen_walk_in_reserve_regular','kitchen_walk_in_reserve_sunday']
    WHEN 'outside' THEN ARRAY['outside_table_count','outside_table_capacity']
    WHEN 'drinks' THEN ARRAY[
      'drinks_arrivals_ceiling','drinks_bump_enabled','drinks_bump_protection_minutes']
    WHEN 'party_limits' THEN ARRAY[
      'table_booking_max_party_online','table_booking_max_party_staff']
    WHEN 'holds' THEN ARRAY['hold_release_lead_hours','table_holds_enabled']
    WHEN 'deposits' THEN ARRAY['booking_period_deposits_enabled']
    WHEN 'messages' THEN ARRAY[
      'booking_message_tables_full','booking_message_kitchen_full','booking_message_outside_full',
      'booking_message_closed','booking_message_too_late','booking_message_too_large',
      'booking_message_unknown']
    ELSE ARRAY[]::text[]
  END;
$$;

-- Additive: the read now includes the deposits section so the settings screen can show the switch.
CREATE OR REPLACE FUNCTION public.get_table_booking_settings()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT jsonb_build_object(
    'settings', COALESCE((
      SELECT jsonb_object_agg(s.key, s.value)
      FROM public.system_settings s
      WHERE s.key = ANY (
        public.table_booking_settings_keys('turn_times')
        || public.table_booking_settings_keys('kitchen_pacing')
        || public.table_booking_settings_keys('outside')
        || public.table_booking_settings_keys('drinks')
        || public.table_booking_settings_keys('party_limits')
        || public.table_booking_settings_keys('holds')
        || public.table_booking_settings_keys('deposits')
        || public.table_booking_settings_keys('messages')
        || ARRAY['table_allocation_v06_enabled','accessibility_filter_enabled','high_chair_inventory']
      )
    ), '{}'::jsonb),
    'revisions', COALESCE((
      SELECT jsonb_object_agg(r.section, r.revision) FROM public.settings_revisions r
    ), '{}'::jsonb)
  );
$$;

-- ===========================================================================
-- 10. Seed: Christmas 2026, INACTIVE
--
-- Reproduces today's hard-coded Christmas rules exactly: GBP 10 per head at any party size, 6 to 20
-- guests, 24 hours notice, and the 10 November to 20 December 2026 window that until now was
-- enforced nowhere. It requires a pre-order and has NO menu items, because the festive menu is
-- published in October and the owner loads it here.
--
-- It is INACTIVE. Nothing about it reaches a guest, and no Christmas booking can be taken, until the
-- owner switches it on from Settings, Table bookings.
-- ===========================================================================

INSERT INTO public.booking_periods (
  code, period_kind, name, starts_on, ends_on,
  guest_question, guest_blurb,
  requires_preorder, preorder_cutoff_days,
  deposit_basis, deposit_amount, refund_cutoff_days,
  min_party_size, max_party_size, min_notice_hours,
  legacy_booking_type, is_active
) VALUES (
  'christmas-2026', 'christmas', 'Christmas dinner 2026', '2026-11-10', '2026-12-20',
  'Is this a Christmas dinner booking?',
  'Our festive set menu, 10 November to 20 December. Choose your courses when you book.',
  true, 7,
  'per_head', 10.00, 7,
  6, 20, 24,
  'christmas'::public.table_booking_type, false
)
ON CONFLICT (code) DO NOTHING;

-- ===========================================================================
-- 11. Grants. Trusted backend only, and PROVEN, not assumed.
--
-- A new function in public on this project is granted EXECUTE to anon and authenticated BY NAME.
-- REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Every function created or
-- replaced above is revoked from those two roles explicitly, and the assertion at the end fails the
-- whole migration if anything is still reachable.
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
      AND p.proname IN (
        'get_booking_period_for_date',
        'booking_period_menu_ready',
        'resolve_table_booking_deposit',
        'assert_seasonal_booking_type_in_period',
        'touch_booking_period_updated_at',
        'get_booking_periods',
        'set_booking_period',
        'set_booking_period_active',
        'upsert_booking_period_menu_item',
        'delete_booking_period_menu_item',
        -- Replaced above, so re-prove them rather than trusting that CREATE OR REPLACE kept the ACL.
        'table_booking_settings_keys',
        'get_table_booking_settings'
      )
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
    AND p.proname IN (
      'get_booking_period_for_date','booking_period_menu_ready','resolve_table_booking_deposit',
      'assert_seasonal_booking_type_in_period','touch_booking_period_updated_at',
      'get_booking_periods','set_booking_period','set_booking_period_active',
      'upsert_booking_period_menu_item','delete_booking_period_menu_item',
      'table_booking_settings_keys','get_table_booking_settings')
    AND array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  IF v_leaky IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'Seasonal period functions are still executable by anon or authenticated.',
      DETAIL  = v_leaky,
      HINT    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  END IF;
END;
$$;

-- The tables themselves must be service-role only too. RLS is enabled with a service_role policy
-- above, but a table grant to anon would still let a caller see the SQL error surface.
REVOKE ALL ON TABLE public.booking_periods FROM anon, authenticated;
REVOKE ALL ON TABLE public.booking_period_menu_items FROM anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_periods TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.booking_period_menu_items TO service_role;

-- Prove the seed landed in the state it is supposed to be in. A live Christmas period on day one
-- would mean guests could be charged before the owner has seen the menu.
DO $$
DECLARE
  v_active boolean;
  v_items  integer;
BEGIN
  SELECT is_active INTO v_active FROM public.booking_periods WHERE code = 'christmas-2026';
  SELECT count(*) INTO v_items
    FROM public.booking_period_menu_items m
    JOIN public.booking_periods p ON p.id = m.period_id
   WHERE p.code = 'christmas-2026';

  IF v_active IS NULL THEN
    RAISE EXCEPTION 'The christmas-2026 seed row is missing.';
  END IF;
  IF v_active THEN
    RAISE EXCEPTION 'The christmas-2026 period must ship inactive. The menu is not published until October.';
  END IF;
  IF v_items <> 0 THEN
    RAISE EXCEPTION 'The christmas-2026 period must ship with no menu items. Do not invent dishes or prices.';
  END IF;
END;
$$;

COMMIT;

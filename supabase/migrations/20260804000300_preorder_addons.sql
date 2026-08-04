-- Seasonal pre-orders: optional per-person add-ons.
--
-- WHAT THIS IS FOR
--
-- The farmhouse cheeseboard went onto the festive menu as a DESSERT. It is not a dessert, it is an
-- extra a guest pays for on top. Because a seat may hold only one dessert, a guest who ticks the
-- cheeseboard today loses their pudding, and the pub loses the extra sale. This migration gives the
-- menu a place to put things that sit alongside the three courses rather than inside them.
--
-- THE SHAPE, and why it is this small
--
-- One new course value, 'addon', on the two CHECK constraints that gate it. No new table, no new
-- column, no price ledger. An add-on is a selection like any other, snapshotted the same way, read by
-- the same queries. The only thing that differs is how many of them a seat may hold.
--
-- MULTI-SELECT, and the constraint swap it needs. Starter, main and dessert stay one-per-seat.
-- Add-ons are tick-boxes: a guest may want the cheeseboard AND the port. UNIQUE (cover_id, course)
-- says otherwise, so it is replaced by a PARTIAL unique index covering only the three courses, plus
-- UNIQUE (cover_id, menu_item_id) so the same add-on cannot be ticked twice on one seat. That second
-- index is a tightening for the courses too: it now also stops the same dish being held as both the
-- starter and the main on one seat, which was previously possible and was never wanted.
--
-- MONEY. An add-on price is quoted at pre-order and charged on the guest's BILL AT THE PUB. Nothing
-- is taken online for it and the deposit is untouched. There is deliberately no payment state here:
-- adding one would imply the pub is collecting, and it is not.
--
-- COMPLETENESS IS UNCHANGED. A seat is complete when it has a main. An add-on is never required and
-- never makes a booking incomplete. That rule lives in src/lib/table-bookings/preorder.ts and this
-- migration does not touch it.
--
-- DEPLOY THE CODE FIRST. This migration is NOT safe to apply ahead of the deploy, and an earlier
-- draft of this comment wrongly said it was.
--
-- The two CHECK changes do only widen. Section 3 does not. The code running in production today
-- saves a seat with `.upsert(rows, { onConflict: 'cover_id,course' })`, which PostgREST turns into
-- ON CONFLICT (cover_id, course) with no index predicate. Postgres will not infer a PARTIAL unique
-- index for that: inference needs the predicate restated in the statement, and PostgREST has no way
-- to send one. So the moment the blanket UNIQUE (cover_id, course) is dropped, every pre-order save
-- from the live app fails with 42P10 until the new code is serving. Pre-orders are switched on and a
-- real booking is taking choices, so that window is not theoretical.
--
-- The new code replaces that upsert with a delete then insert, which does not depend on index
-- inference at all and works both before and after this migration. Order of operations, therefore:
--   1. Deploy the application code.
--   2. Apply this migration.
-- Applying it second costs nothing: until it lands, the new code simply cannot write an 'addon',
-- which is exactly how the feature behaves today.
--
-- Verified before writing: booking_preorder_selections holds 0 rows, so no existing pair can collide
-- with the new (cover_id, menu_item_id) uniqueness, and no database function anywhere in public
-- hardcodes a course list that would need updating alongside.

BEGIN;

-- ===========================================================================
-- 1. 'addon' becomes a course a menu item may be
--
-- booking_period_menu_items already carries side, drink and other. This adds the one value that
-- means "an extra, priced on top of the set menu, that a guest ticks".
-- ===========================================================================

ALTER TABLE public.booking_period_menu_items
  DROP CONSTRAINT IF EXISTS bpmi_course_ck;

ALTER TABLE public.booking_period_menu_items
  ADD CONSTRAINT bpmi_course_ck
  CHECK (course IN ('starter', 'main', 'dessert', 'side', 'drink', 'other', 'addon'));

COMMENT ON COLUMN public.booking_period_menu_items.course IS
  'Which part of the menu this item belongs to. ''addon'' is an optional extra a guest ticks on top of their courses and pays for on their bill at the pub; it is never one of the three courses.';

-- ===========================================================================
-- 2. 'addon' becomes a course a seat may choose
-- ===========================================================================

ALTER TABLE public.booking_preorder_selections
  DROP CONSTRAINT IF EXISTS booking_preorder_selections_course_check;

ALTER TABLE public.booking_preorder_selections
  ADD CONSTRAINT booking_preorder_selections_course_check
  CHECK (course IN ('starter', 'main', 'dessert', 'addon'));

COMMENT ON COLUMN public.booking_preorder_selections.price_gbp IS
  'Snapshot of the price at the moment of choosing. For an add-on this is what the guest was quoted and what the pub charges on the night, so an owner editing the menu later cannot restate it.';

-- ===========================================================================
-- 3. One of each course, but as many add-ons as you like
--
-- The old UNIQUE (cover_id, course) is what makes a seat single-choice. Keeping it for the courses
-- and dropping it for add-ons is exactly what a partial unique index is for.
-- ===========================================================================

ALTER TABLE public.booking_preorder_selections
  DROP CONSTRAINT IF EXISTS booking_preorder_selections_cover_id_course_key;

CREATE UNIQUE INDEX IF NOT EXISTS booking_preorder_selections_one_per_course_idx
  ON public.booking_preorder_selections (cover_id, course)
  WHERE course <> 'addon';

COMMENT ON INDEX public.booking_preorder_selections_one_per_course_idx IS
  'A seat holds at most one starter, one main and one dessert. Add-ons are excluded because they are tick-boxes: a guest may have several.';

-- Same add-on cannot be ticked twice on one seat. Also stops one dish being held as two courses on
-- the same seat, which nothing ever wanted and which the old constraint allowed.
CREATE UNIQUE INDEX IF NOT EXISTS booking_preorder_selections_one_per_item_idx
  ON public.booking_preorder_selections (cover_id, menu_item_id);

COMMENT ON INDEX public.booking_preorder_selections_one_per_item_idx IS
  'One seat, one line per dish. Stops a tick-box add-on being saved twice by a double submit.';

-- ===========================================================================
-- 4. Prove it, rather than report success on a half-applied change
--
-- If the partial index is missing, or the old blanket one survives, add-ons silently collapse to one
-- per seat. That is the exact bug this migration exists to fix, and a half-applied change would hide
-- it until a guest complained on the night. Better to refuse to commit.
-- ===========================================================================

DO $$
DECLARE
  v_missing text;
BEGIN
  -- Both CHECKs must now accept 'addon'.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.booking_period_menu_items'::regclass
       AND conname = 'bpmi_course_ck'
       AND pg_get_constraintdef(oid) LIKE '%addon%'
  ) THEN
    RAISE EXCEPTION 'booking_period_menu_items still refuses course = addon.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.booking_preorder_selections'::regclass
       AND conname = 'booking_preorder_selections_course_check'
       AND pg_get_constraintdef(oid) LIKE '%addon%'
  ) THEN
    RAISE EXCEPTION 'booking_preorder_selections still refuses course = addon.';
  END IF;

  -- The old blanket uniqueness must be gone, or add-ons are still one per seat.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.booking_preorder_selections'::regclass
       AND conname = 'booking_preorder_selections_cover_id_course_key'
  ) THEN
    RAISE EXCEPTION USING
      MESSAGE = 'The blanket UNIQUE (cover_id, course) is still in place, so a seat can still hold only one add-on.',
      HINT    = 'It must be replaced by booking_preorder_selections_one_per_course_idx, which excludes add-ons.';
  END IF;

  SELECT string_agg(wanted, ', ')
    INTO v_missing
  FROM (VALUES
    ('booking_preorder_selections_one_per_course_idx'),
    ('booking_preorder_selections_one_per_item_idx')
  ) AS t(wanted)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'public' AND c.relname = t.wanted AND i.indisunique
  );

  IF v_missing IS NOT NULL THEN
    RAISE EXCEPTION USING
      MESSAGE = 'A unique index this feature depends on was not created.',
      DETAIL  = v_missing;
  END IF;
END;
$$;

COMMIT;

-- Private Bookings SOP compliance: workflow model (pack §§7–9, 12, 18).
--   A. Catering package flags: requires_waiver / requires_allergy_capture /
--      seasonal, plus the self_catering category. Waiver detection becomes
--      flag-first (name matching is a fallback only).
--   B. Booking workflow flags (pack §8).
--   C. Enquiry intake fields (pack §9): layout, adults/under-18s split,
--      bar tab, outside food, high-power equipment, decorations, dogs,
--      special risk, communication preference, clear-down window.
--   D. RBAC: gm_override and view_sensitive permissions (pack §5).

-- ---------------------------------------------------------------------------
-- A. Package flags
-- ---------------------------------------------------------------------------

ALTER TABLE public.catering_packages
  ADD COLUMN IF NOT EXISTS requires_waiver boolean NOT NULL DEFAULT false;
ALTER TABLE public.catering_packages
  ADD COLUMN IF NOT EXISTS requires_allergy_capture boolean NOT NULL DEFAULT false;
ALTER TABLE public.catering_packages
  ADD COLUMN IF NOT EXISTS seasonal boolean NOT NULL DEFAULT false;

ALTER TABLE public.catering_packages
  DROP CONSTRAINT IF EXISTS catering_packages_category_check;
ALTER TABLE public.catering_packages
  ADD CONSTRAINT catering_packages_category_check
  CHECK (category = ANY (ARRAY['food'::text, 'drink'::text, 'addon'::text, 'self_catering'::text, 'other'::text]));

-- Backfill: the known BYO package plus anything matching the historical
-- name patterns becomes flag-carrying (SOP: stable flag primary, name fallback).
UPDATE public.catering_packages
SET requires_waiver = true,
    category = 'self_catering'
WHERE id = '9fdbf82b-6717-4bff-8af6-8865cb5bfe21'
   OR name ~* 'bring your own|self[ -]?cater|\mbyo\M';

UPDATE public.catering_packages
SET requires_allergy_capture = true
WHERE category = 'food';

-- ---------------------------------------------------------------------------
-- B. Workflow flags (pack §8)
-- ---------------------------------------------------------------------------

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS final_details_status text NOT NULL DEFAULT 'not_requested'
    CHECK (final_details_status IN ('not_requested', 'requested', 'complete', 'incomplete', 'overdue', 'manager_reviewed'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS supplier_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (supplier_status IN ('not_applicable', 'requested', 'incomplete', 'approved', 'rejected'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS waiver_status text NOT NULL DEFAULT 'not_required'
    CHECK (waiver_status IN ('not_required', 'required', 'sent', 'signed', 'overdue'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS risk_status text NOT NULL DEFAULT 'normal'
    CHECK (risk_status IN ('low', 'normal', 'high', 'gm_approval_required', 'approved', 'rejected'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS event_sheet_status text NOT NULL DEFAULT 'not_generated'
    CHECK (event_sheet_status IN ('not_generated', 'generated', 'sent_to_staff', 'locked'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS post_event_status text
    CHECK (post_event_status IS NULL OR post_event_status IN ('awaiting_inspection', 'inspection_complete', 'deduction_discussion', 'refund_processed', 'complete'));

-- Waiver status backfill for live bookings that already carry a waiver package
UPDATE public.private_bookings pb
SET waiver_status = 'required'
WHERE pb.status IN ('draft', 'confirmed')
  AND pb.waiver_status = 'not_required'
  AND EXISTS (
    SELECT 1
    FROM public.private_booking_items i
    JOIN public.catering_packages cp ON cp.id = i.package_id
    WHERE i.booking_id = pb.id
      AND cp.requires_waiver
  );

-- ---------------------------------------------------------------------------
-- C. Intake fields (pack §9)
-- ---------------------------------------------------------------------------

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS layout text
    CHECK (layout IS NULL OR layout IN ('seated', 'standing', 'mixed'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS guest_count_adults integer;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS guest_count_under_18 integer;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS bar_tab_required boolean NOT NULL DEFAULT false;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS bar_tab_limit numeric;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS bar_tab_prepaid_amount numeric;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS bar_tab_preauth_reference text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS bar_tab_approved_by uuid;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS outside_food boolean NOT NULL DEFAULT false;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS high_power_equipment boolean NOT NULL DEFAULT false;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS high_power_equipment_approved_at timestamptz;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS decorations_plan text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS dogs_expected boolean NOT NULL DEFAULT false;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS special_risk_notes text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS communication_preference text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS cleardown_time time;

COMMENT ON COLUMN public.private_bookings.bar_tab_limit IS
  'Bar tabs must be pre-arranged with a recorded limit and pre-payment and/or pre-authorisation (SOP §12).';
COMMENT ON COLUMN public.private_bookings.cleardown_time IS
  'End of the clear-down window. Standard access is one hour after the booked event time (SOP §23).';

-- ---------------------------------------------------------------------------
-- D. RBAC (pack §5)
-- ---------------------------------------------------------------------------

INSERT INTO public.permissions (module_name, action, description)
SELECT 'private_bookings', v.action, v.description
FROM (VALUES
  ('gm_override', 'General Manager override: deposit reductions, retention decisions, hold extensions past deadline, sub-30-guest approvals, conflict overrides'),
  ('view_sensitive', 'View sensitive allergy, dietary, accessibility and complaint details for private bookings')
) AS v(action, description)
WHERE NOT EXISTS (
  SELECT 1 FROM public.permissions p
  WHERE p.module_name = 'private_bookings' AND p.action = v.action
);

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name IN ('super_admin', 'manager')
  AND p.module_name = 'private_bookings'
  AND p.action IN ('gm_override', 'view_sensitive')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );

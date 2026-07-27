-- Table prioritisation, stream A task A7.
-- Seeds the new settings keys and the feature flags.
--
-- CRITICAL, review finding F-12: this migration inserts ONLY keys that do not already exist. It never
-- rewrites a live value. The kitchen pacing change (today's effective ceiling of 19 midweek and 14 on
-- Sunday, moving to a flat 15) happens at activation, task I8, inside the same transaction that turns
-- the allocator on. That is what keeps stream A behaviourally inert.
--
-- Every new behaviour is behind its own flag, all shipped false, so recovery can disable one feature
-- rather than the whole allocator (review finding F-34).

BEGIN;

INSERT INTO public.system_settings (key, value, description)
VALUES
  -- ---------------------------------------------------------------------
  -- Feature flags. All false. Activation is task I8.
  -- ---------------------------------------------------------------------
  ('table_allocation_v06_enabled', '{"value": false}'::jsonb,
   'Master switch. When false every caller uses its pre-v06 path, so the deployment is inert.'),
  ('turn_times_enabled', '{"value": false}'::jsonb,
   'Turn times by party size and the turnaround gap. When false the flat 120/90 minute durations apply.'),
  ('table_holds_enabled', '{"value": false}'::jsonb,
   'Walk-in holds and maintenance blocks are honoured by the allocator.'),
  ('accessibility_filter_enabled', '{"value": false}'::jsonb,
   'Step-free and standard-height filtering, and the high-chair table filter.'),
  ('drinks_bump_enabled', '{"value": false}'::jsonb,
   'A food booking may relocate a soft-assigned drinks booking that has a valid alternative.'),

  -- ---------------------------------------------------------------------
  -- Turn times. Six values, not eleven: Sunday is derived by adding the uplift.
  -- ---------------------------------------------------------------------
  ('turn_time_minutes_1_2', '{"value": 90}'::jsonb,  'Table time for a party of 1 to 2.'),
  ('turn_time_minutes_3_4', '{"value": 105}'::jsonb, 'Table time for a party of 3 to 4.'),
  ('turn_time_minutes_5_6', '{"value": 120}'::jsonb, 'Table time for a party of 5 to 6.'),
  ('turn_time_minutes_7_plus', '{"value": 150}'::jsonb, 'Table time for a party of 7 or more.'),
  ('turn_time_sunday_uplift_minutes', '{"value": 15}'::jsonb,
   'Added to every band on a Sunday, food or drinks.'),
  ('turnaround_gap_minutes', '{"value": 15}'::jsonb,
   'Unsellable time after a booking. Added to the ASSIGNMENT window only, never to the time quoted to the guest.'),

  -- ---------------------------------------------------------------------
  -- Holds
  -- ---------------------------------------------------------------------
  ('hold_release_lead_hours', '{"value": 24}'::jsonb,
   'Walk-in holds and table minimum party sizes stop applying this many hours before the sitting. Accessibility filters are never released.'),

  -- ---------------------------------------------------------------------
  -- Drinks
  -- ---------------------------------------------------------------------
  ('drinks_arrivals_ceiling', '{"value": 40}'::jsonb,
   'Maximum drinks covers arriving per pacing window. Counted separately from kitchen pacing.'),
  ('drinks_bump_protection_minutes', '{"value": 60}'::jsonb,
   'A drinks booking starting within this many minutes is never moved, even if it means refusing the food booking.'),

  -- ---------------------------------------------------------------------
  -- Outside seating. Capacity is 8 today and drops to 6; changing it re-costs
  -- affected future bookings rather than silently reinterpreting them.
  -- ---------------------------------------------------------------------
  ('outside_table_count', '{"value": 5}'::jsonb, 'How many outside tables exist.'),
  ('outside_table_capacity', '{"value": 8}'::jsonb,
   'Seats per outside table. Currently 8, dropping to 6. Lowering this requires the re-costing workflow.'),

  -- ---------------------------------------------------------------------
  -- Party size ceilings, by channel. Replaces the hard-coded refusal at 21.
  -- Online sends 21 and over to the private-booking enquiry; staff can always
  -- accept a large party in the moment.
  -- ---------------------------------------------------------------------
  ('table_booking_max_party_online', '{"value": 20}'::jsonb,
   'Largest party the website will take. Above this the customer is routed to a private booking.'),
  ('table_booking_max_party_staff', '{"value": 40}'::jsonb,
   'Largest party staff can accept. A typo guard, not a physical limit: the Dining Room joins to 26 and above that staff use unjoined tables.'),

  -- ---------------------------------------------------------------------
  -- Customer-facing messages, one per PUBLIC reason code.
  --
  -- Internal reasons are never sent to a customer. A private booking or a
  -- maintenance block both surface as tables_full, so a function is never
  -- disclosed. Plain text only; escaped on output.
  -- ---------------------------------------------------------------------
  ('booking_message_tables_full', '{"value": "We are fully booked at that time. Please try another time or give us a ring."}'::jsonb,
   'Public message: no table fits this party at this time.'),
  ('booking_message_kitchen_full', '{"value": "Our kitchen is at capacity for that time. There is usually room a little earlier or later."}'::jsonb,
   'Public message: kitchen pacing ceiling reached.'),
  ('booking_message_outside_full', '{"value": "All our outside tables are taken for that time. We can seat you inside if you would like."}'::jsonb,
   'Public message: outside capacity reached.'),
  ('booking_message_closed', '{"value": "We are closed then. Have a look at our opening times for another day."}'::jsonb,
   'Public message: outside opening or kitchen hours.'),
  ('booking_message_too_late', '{"value": "That is a little too close to closing for us to seat you. Please pick an earlier time."}'::jsonb,
   'Public message: past the booking cut-off.'),
  ('booking_message_too_large', '{"value": "For a group that size we look after you as a private booking. Get in touch and we will sort it out."}'::jsonb,
   'Public message: above the online party ceiling.'),
  ('booking_message_unknown', '{"value": "We cannot check availability right now. Please give us a ring and we will book you in."}'::jsonb,
   'Public message: availability could not be calculated. Never shown as available or unavailable.')

ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Prove inertness: none of the live pacing keys may have been touched.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  v_enabled boolean;
BEGIN
  SELECT (value ->> 'value')::boolean INTO v_enabled
    FROM public.system_settings WHERE key = 'table_allocation_v06_enabled';

  IF v_enabled IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'table_allocation_v06_enabled must ship false, found %', v_enabled;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.system_settings
    WHERE key IN ('kitchen_pace_covers_regular', 'kitchen_pace_covers_sunday')
  ) THEN
    RAISE NOTICE 'Kitchen pace keys already exist; activation (I8) must capture their current values before overwriting.';
  END IF;
END;
$$;

COMMIT;

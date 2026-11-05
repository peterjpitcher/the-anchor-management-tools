-- File every leave request under the holiday year the current setting gives its start date.
--
-- The holiday year now runs 1 January to 31 December (system_settings rota_holiday_year_start_month
-- and _day), matching the worker agreement. 23 requests entered on 6 March 2026, while the year still
-- began on 6 April, kept the April-based year they were stamped with. The Holidays tab and the rota
-- leave page list requests by that stored year, so those requests showed under the year before the
-- one their days are counted in (the totals read the dated leave_days rows and were always right).
--
-- Data only: holiday_year is recomputed with holiday_year_for_date, the same rule the booking
-- functions use, and only where it differs. A fresh database changes nothing. The upper bound stops
-- the update if it would touch more than the 23 requests the owner agreed to move (5 November 2026),
-- for example because the setting has changed again since. The only trigger on leave_requests sets
-- updated_at; nothing sends or syncs on this change.

DO $$
DECLARE
  v_changed integer;
BEGIN
  UPDATE public.leave_requests r
  SET holiday_year = public.holiday_year_for_date(r.start_date)
  WHERE r.holiday_year IS DISTINCT FROM public.holiday_year_for_date(r.start_date);

  GET DIAGNOSTICS v_changed = ROW_COUNT;

  IF v_changed > 23 THEN
    RAISE EXCEPTION 'Expected at most 23 leave requests to move holiday year, found %', v_changed;
  END IF;

  RAISE NOTICE 'Leave requests moved to the right holiday year: %', v_changed;
END $$;

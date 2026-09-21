\set ON_ERROR_STOP on
DO $$
BEGIN
 IF EXISTS(SELECT 1 FROM fixture_functions_before f JOIN pg_proc p ON p.proname=f.proname
 JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND pg_get_functiondef(p.oid)<>f.definition) THEN
  RAISE EXCEPTION 'Rollback did not restore exact live function definitions';
 END IF;
 IF EXISTS(SELECT 1 FROM events WHERE standing_capacity IS NOT NULL) THEN
  RAISE EXCEPTION 'Rollback did not restore original standing values';
 END IF;
 IF EXISTS((SELECT * FROM fixture_before EXCEPT SELECT 'bookings',to_jsonb(b) FROM bookings b
 EXCEPT SELECT 'allocations',to_jsonb(a) FROM event_communal_seat_allocations a
 EXCEPT SELECT 'payments',to_jsonb(p) FROM payments p)) THEN
  RAISE EXCEPTION 'Rollback changed existing booking, payment or allocation data';
 END IF;
END $$;
SELECT 'Rollback restored exact live functions and unchanged existing booking records' AS result;

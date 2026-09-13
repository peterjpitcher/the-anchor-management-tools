BEGIN;
SET LOCAL lock_timeout='2s';
SET LOCAL statement_timeout='20s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
 hire_id uuid := 'fb22752d-9212-47f5-b1ac-11d31e049ab3';
 rejected boolean;
 flow text;
BEGIN
 IF EXISTS(SELECT 1 FROM public.private_bookings WHERE id=hire_id) THEN RAISE EXCEPTION 'Fixture exists'; END IF;
 INSERT INTO public.private_bookings(id,customer_name,event_date,start_time,end_time,status)
 VALUES(hire_id,'CODEX ROLLBACK ONLY','2026-09-15','18:00','20:00','draft');
 INSERT INTO public.private_booking_items(booking_id,item_type,space_id,description,unit_price)
 VALUES(hire_id,'space','6869774b-cfa5-4aff-a663-a14b2fb5633b','CODEX ROLLBACK ONLY',0);
 FOREACH flow IN ARRAY ARRAY['public','staff'] LOOP
   rejected := false;
   BEGIN
     IF flow='public' THEN
       PERFORM public.create_table_booking_public_v06(p_customer_id=>'4a02ba52-7d54-4813-80dc-3ba5917f4492',p_booking_date=>'2026-09-15',p_booking_time=>'18:30',p_party_size=>2,p_booking_purpose=>'drinks',p_outside_seating=>true);
     ELSE
       PERFORM public.create_table_booking_staff_v06(p_customer_id=>'4a02ba52-7d54-4813-80dc-3ba5917f4492',p_booking_date=>'2026-09-15',p_booking_time=>'18:30',p_party_size=>2,p_booking_purpose=>'drinks',p_outside_seating=>true);
     END IF;
   EXCEPTION WHEN check_violation THEN
     IF SQLERRM NOT LIKE 'table_assignment_private_blocked:%' THEN RAISE; END IF;
     rejected := true;
   END;
   IF NOT rejected THEN RAISE EXCEPTION '% creation did not reject private-hire overlap',flow; END IF;
 END LOOP;
END;
$smoke$;
ROLLBACK;
SELECT 'PASS: actual public and staff create RPCs both rejected overlapping outside bookings; all synthetic data rolled back' AS result;

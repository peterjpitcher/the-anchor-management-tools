-- Approved production smoke: synthetic, contact-free rows; always rolled back.
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '20s';
SET LOCAL ROLE service_role;
DO $smoke$
DECLARE
  hire_id uuid := 'fb22752d-9212-47f5-b1ac-11d31e049ab3';
  table_id uuid := '5e05e6af-05a3-45f7-8a0b-2366e94c8268';
  slot jsonb;
  rejected boolean;
BEGIN
  IF EXISTS (SELECT 1 FROM public.private_bookings WHERE id=hire_id)
     OR EXISTS (SELECT 1 FROM public.table_bookings WHERE id=table_id) THEN
    RAISE EXCEPTION 'Fixture ID already exists';
  END IF;
  INSERT INTO public.private_bookings(id,customer_name,event_date,start_time,end_time,status)
  VALUES(hire_id,'CODEX ROLLBACK ONLY','2026-09-15','18:00','20:00','draft');
  INSERT INTO public.private_booking_items(booking_id,item_type,space_id,description,unit_price)
  VALUES(hire_id,'space','6869774b-cfa5-4aff-a663-a14b2fb5633b','CODEX ROLLBACK ONLY',0);
  IF NOT EXISTS (SELECT 1 FROM public.outside_private_hire_windows(hire_id)
    WHERE blocked_start='2026-09-15 17:30 Europe/London'::timestamptz
      AND blocked_end='2026-09-15 20:30 Europe/London'::timestamptz) THEN
    RAISE EXCEPTION 'Private hire buffer window incorrect';
  END IF;
  SELECT s INTO slot FROM jsonb_array_elements(public.check_table_availability_v06('2026-09-15',2,'drinks',true)->'slots') s
  WHERE s->>'time'='18:30';
  IF slot IS NULL OR slot->>'state'<>'unavailable' OR slot->>'public_reason'<>'outside_full' THEN
    RAISE EXCEPTION 'Outside availability did not block: %',slot;
  END IF;
  rejected:=false;
  BEGIN
    INSERT INTO public.table_bookings(id,booking_reference,booking_date,booking_time,party_size,committed_party_size,booking_type,status,booking_purpose,is_outside_seating,start_datetime,end_datetime)
    VALUES(table_id,'CXGARDEN01','2026-09-15','18:30',2,2,'regular','confirmed','drinks',true,'2026-09-15 18:30 Europe/London','2026-09-15 19:30 Europe/London');
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'table_assignment_private_blocked:%' THEN RAISE; END IF;
    rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Overlapping outside insert was accepted'; END IF;
  UPDATE public.private_bookings SET status='cancelled' WHERE id=hire_id;
  INSERT INTO public.table_bookings(id,booking_reference,booking_date,booking_time,party_size,committed_party_size,booking_type,status,booking_purpose,is_outside_seating,start_datetime,end_datetime)
  VALUES(table_id,'CXGARDEN01','2026-09-15','18:30',2,2,'regular','confirmed','drinks',true,'2026-09-15 18:30 Europe/London','2026-09-15 19:30 Europe/London');
  rejected:=false;
  BEGIN
    UPDATE public.private_bookings SET status='confirmed' WHERE id=hire_id;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'The garden already has an outside table booking%' THEN RAISE; END IF;
    rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Conflicting private hire reactivation accepted'; END IF;
  UPDATE public.table_bookings SET booking_time='21:00',start_datetime='2026-09-15 21:00 Europe/London',end_datetime='2026-09-15 22:00 Europe/London' WHERE id=table_id;
  UPDATE public.private_bookings SET status='confirmed' WHERE id=hire_id;
  rejected:=false;
  BEGIN
    UPDATE public.table_bookings SET booking_time='18:30',start_datetime='2026-09-15 18:30 Europe/London',end_datetime='2026-09-15 19:30 Europe/London' WHERE id=table_id;
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE 'table_assignment_private_blocked:%' THEN RAISE; END IF;
    rejected:=true;
  END;
  IF NOT rejected THEN RAISE EXCEPTION 'Conflicting table amendment accepted'; END IF;
END;
$smoke$;
ROLLBACK;
SELECT 'PASS: live service-role buffers, availability, insert rejection, cancellation release, reciprocal private-hire rejection and amendment rejection; transaction rolled back' AS result;

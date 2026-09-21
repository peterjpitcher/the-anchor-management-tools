-- Run after setup.sql and the draft migration, in an isolated database only.
\set ON_ERROR_STOP on
BEGIN;
CREATE FUNCTION pg_temp.assert_ok(ok boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAILED: %', message; END IF; END $$;
SELECT pg_temp.assert_ok(NOT EXISTS (
 (SELECT * FROM fixture_before EXCEPT SELECT 'bookings',to_jsonb(b) FROM bookings b
 EXCEPT SELECT 'allocations',to_jsonb(a) FROM event_communal_seat_allocations a
 EXCEPT SELECT 'payments',to_jsonb(p) FROM payments p)
), 'migration preserves every existing booking, allocation and payment byte for byte');
SELECT pg_temp.assert_ok((SELECT count(*) FROM bookings)=1 AND (SELECT count(*) FROM payments)=1 AND (SELECT count(*) FROM event_communal_seat_allocations)=1,'migration does not add historical records');
SELECT pg_temp.assert_ok((SELECT count(*) FROM events WHERE standing_capacity=11)=6,'six existing allowances frozen at 11');
SELECT pg_temp.assert_ok((SELECT seated_capacity=25 AND standing_capacity=0 FROM events WHERE id='5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65'),'tasting cap of 25 preserved');
UPDATE tables SET capacity=CASE table_number WHEN '3' THEN 2 ELSE 4 END;
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,booking_open,event_status) VALUES
('50000000-0000-0000-0000-000000000001','Table fixture','2036-02-01','19:00','2036-02-01 19:00+00',180,999,'table','free',true,'scheduled'),
('50000000-0000-0000-0000-000000000002','Communal fixture','2036-02-02','19:00','2036-02-02 19:00+00',180,999,'communal','free',true,'scheduled'),
('50000000-0000-0000-0000-000000000003','General fixture','2036-02-03','19:00','2036-02-03 19:00+00',180,3,'general','free',true,'scheduled'),
('50000000-0000-0000-0000-000000000004','Mixed fixture','2036-02-04','19:00','2036-02-04 19:00+00',180,NULL,'mixed','prepaid',true,'scheduled');
SELECT pg_temp.assert_ok((SELECT capacity=10 AND seats_remaining=10 FROM get_event_capacity_snapshot_v05(ARRAY['50000000-0000-0000-0000-000000000001'::uuid])),'table ignores arbitrary 999 cap');
SELECT pg_temp.assert_ok((SELECT capacity=10 AND standing_capacity=0 FROM get_event_capacity_snapshot_v05(ARRAY['50000000-0000-0000-0000-000000000002'::uuid])),'new communal does not infer standing from 999');
DO $$ DECLARE r jsonb; n int; b uuid; customer uuid:=gen_random_uuid(); BEGIN
 SELECT count(*) INTO n FROM bookings;
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000001',customer,5,'admin');
 PERFORM pg_temp.assert_ok(r->>'state'='blocked','unjoinable five-person party blocked despite ten spare seats');
 PERFORM pg_temp.assert_ok((SELECT count(*) FROM bookings)=n,'failed physical booking leaves no event booking');
 PERFORM pg_temp.assert_ok((SELECT count(*) FROM table_bookings)=0,'failed physical booking leaves no table booking');
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000001',customer,3,'admin');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed','table creation succeeds'); b:=(r->>'booking_id')::uuid;
 PERFORM pg_temp.assert_ok((SELECT count(*) FROM table_bookings WHERE event_booking_id=b)=1,'table created atomically inside event RPC');
 r:=create_event_table_reservation_v05('50000000-0000-0000-0000-000000000001',b,customer,3,'admin');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed' AND (SELECT count(*) FROM table_bookings WHERE event_booking_id=b)=1,'service second reservation idempotent');
 PERFORM pg_temp.assert_ok((SELECT seats_remaining=6 FROM get_event_capacity_snapshot_v05(ARRAY['50000000-0000-0000-0000-000000000001'::uuid])),'whole assigned four-top removes four available seats');
 UPDATE tables SET is_bookable=false WHERE id NOT IN(SELECT table_id FROM booking_table_assignments a JOIN table_bookings t ON a.table_booking_id=t.id WHERE t.event_booking_id=b);
 r:=update_event_booking_seats_staff_v05(b,4); PERFORM pg_temp.assert_ok(r->>'state'='updated','increase to own four seats allowed with no other tables');
 r:=update_event_booking_seats_staff_v05(b,5); PERFORM pg_temp.assert_ok(r->>'reason'='table_capacity_insufficient','increase beyond own assigned table blocked');
 UPDATE tables SET is_bookable=true;
END $$;
-- Full-event conflict begins after ordinary 90-minute initial reservation.
INSERT INTO table_holds(id,scope,table_id,hold_type,status,starts_on,ends_on,starts_at,ends_at) VALUES
(gen_random_uuid(),'table','10000000-0000-0000-0000-000000000001','maintenance','active','2036-02-04','2036-02-04','21:00','23:00');
DO $$ DECLARE r jsonb; b uuid; BEGIN
 r:=create_event_booking_v06('50000000-0000-0000-0000-000000000004',gen_random_uuid(),3,'admin','seated',15);
 PERFORM pg_temp.assert_ok(r->>'state'='pending_payment','mixed booking succeeds on alternative table for full window'); b:=(r->>'booking_id')::uuid;
 PERFORM pg_temp.assert_ok(NOT EXISTS(SELECT 1 FROM booking_table_assignments a JOIN table_bookings t ON t.id=a.table_booking_id WHERE t.event_booking_id=b AND a.table_id='10000000-0000-0000-0000-000000000001'),'late maintenance prevents assignment');
 PERFORM pg_temp.assert_ok((SELECT t.hold_expires_at=bk.hold_expires_at FROM table_bookings t JOIN bookings bk ON bk.id=t.event_booking_id WHERE bk.id=b),'short payment hold synchronised to physical reservation');
END $$;
DO $$ DECLARE r jsonb; b uuid; before_rows jsonb; BEGIN
 UPDATE events SET standing_capacity=3 WHERE id='50000000-0000-0000-0000-000000000002';
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000002',gen_random_uuid(),9,'admin','seated');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed','communal can share and split physical tables'); b:=(r->>'booking_id')::uuid;
 PERFORM pg_temp.assert_ok((SELECT sum(seats)=9 FROM event_communal_seat_allocations WHERE event_booking_id=b),'all communal seats physically allocated');
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000002',gen_random_uuid(),2,'admin','seated');
 PERFORM pg_temp.assert_ok(r->>'state'='blocked' AND r->>'reason'='seated_capacity_changed','staff seated request never silently becomes standing');
 SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) INTO before_rows FROM event_communal_seat_allocations a WHERE event_booking_id=b;
 r:=allocate_event_communal_seats_v01('50000000-0000-0000-0000-000000000002',b,11,'2036-02-02 18:45+00','2036-02-02 22:00+00');
 PERFORM pg_temp.assert_ok(r->>'state'='blocked','oversized reallocation fails');
 PERFORM pg_temp.assert_ok((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id)=before_rows FROM event_communal_seat_allocations a WHERE event_booking_id=b),'failed allocation preserves exact original allocation rows');
 UPDATE events SET capacity=NULL WHERE id='50000000-0000-0000-0000-000000000002';
 r:=update_event_booking_seats_staff_v05(b,11); PERFORM pg_temp.assert_ok(r->>'state'='blocked','communal increase limited with null legacy total');
 r:=update_event_booking_seats_staff_v05(b,8); PERFORM pg_temp.assert_ok(r->>'state'='updated' AND (SELECT sum(seats)=8 FROM event_communal_seat_allocations WHERE event_booking_id=b),'decrease reallocates seats');
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000002',gen_random_uuid(),2,'admin','standing');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed' AND r->>'event_seating_type'='standing','explicit staff standing reservation succeeds');
 BEGIN
  PERFORM update_event_transaction('50000000-0000-0000-0000-000000000002','{"name":"Should roll back","standing_capacity":1}');
  RAISE EXCEPTION 'expected guard failure';
 EXCEPTION WHEN check_violation THEN PERFORM pg_temp.assert_ok(SQLERRM='standing_capacity_below_bookings','standing guard gives expected reason'); END;
 PERFORM pg_temp.assert_ok((SELECT name='Communal fixture' AND standing_capacity=3 FROM events WHERE id='50000000-0000-0000-0000-000000000002'),'failed edit leaves entire event unchanged');
 BEGIN
  UPDATE events SET booking_mode='general' WHERE id='50000000-0000-0000-0000-000000000002';
  RAISE EXCEPTION 'expected mode guard failure';
 EXCEPTION WHEN check_violation THEN PERFORM pg_temp.assert_ok(SQLERRM='event_mode_has_active_bookings','mode transition guard'); END;
 UPDATE bookings SET status='cancelled' WHERE id=b;
 PERFORM pg_temp.assert_ok((SELECT seated_remaining=10 FROM get_event_capacity_snapshot_v05(ARRAY['50000000-0000-0000-0000-000000000002'::uuid])),'cancelled communal allocations release seats without deleting history');
END $$;
DO $$ DECLARE r jsonb; BEGIN
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000003',gen_random_uuid(),3); PERFORM pg_temp.assert_ok(r->>'state'='confirmed','general cap accepts three');
 r:=create_event_booking_v05('50000000-0000-0000-0000-000000000003',gen_random_uuid(),1); PERFORM pg_temp.assert_ok(r->>'state'='full_with_waitlist_option','general cap blocks fourth');
 PERFORM update_event_transaction('50000000-0000-0000-0000-000000000003','{"capacity":null}');
 PERFORM pg_temp.assert_ok((SELECT capacity IS NULL FROM events WHERE id='50000000-0000-0000-0000-000000000003'),'explicit null clears general cap');
END $$;
-- Expired unpaid reservations do not block; paid reservations remain occupied.
INSERT INTO table_bookings(id,party_size,status,payment_status,hold_expires_at) VALUES ('60000000-0000-0000-0000-000000000001',4,'pending_payment','pending',now()-interval '1 hour');
INSERT INTO booking_table_assignments(table_booking_id,table_id,start_datetime,end_datetime) VALUES ('60000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000001','2036-02-03 18:45+00','2036-02-03 22:00+00');
SELECT pg_temp.assert_ok((SELECT sum(free_seats)=10 FROM event_seating_inventory_v01('2036-02-03 18:45+00','2036-02-03 22:00+00',true)),'expired unpaid reservation released');
UPDATE table_bookings SET payment_status='completed' WHERE id='60000000-0000-0000-0000-000000000001';
SELECT pg_temp.assert_ok((SELECT sum(free_seats)=6 FROM event_seating_inventory_v01('2036-02-03 18:45+00','2036-02-03 22:00+00',true)),'paid reservation still occupies table');
INSERT INTO fixture_private_blocks VALUES ('10000000-0000-0000-0000-000000000002','2036-02-03 21:00+00','2036-02-03 23:00+00');
SELECT pg_temp.assert_ok((SELECT sum(free_seats)=2 FROM event_seating_inventory_v01('2036-02-03 18:45+00','2036-02-03 22:00+00',true)),'private block checked across full window');
SELECT pg_temp.assert_ok(NOT has_function_privilege('anon','public.get_event_capacity_snapshot_v05(uuid[])','EXECUTE'),'anon snapshot remains revoked');
SELECT pg_temp.assert_ok(has_function_privilege('service_role','public.get_event_capacity_snapshot_v05(uuid[])','EXECUTE'),'service-role snapshot granted');
-- Legacy unassigned bookings must not increase without a real linked assignment.
INSERT INTO bookings(id,event_id,customer_id,seats,status,event_seating_type) VALUES
('90000000-0000-0000-0000-000000000001','50000000-0000-0000-0000-000000000001',gen_random_uuid(),2,'confirmed','seated');
SELECT pg_temp.assert_ok(update_event_booking_seats_staff_v05('90000000-0000-0000-0000-000000000001',3)->>'reason'='table_capacity_insufficient','unassigned legacy table increase fails closed');
SELECT pg_temp.assert_ok((SELECT seats=2 FROM bookings WHERE id='90000000-0000-0000-0000-000000000001'),'blocked legacy amendment preserves seats');
-- Real v07/v08 wrappers preserve the newly atomic linked table result.
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,booking_mode,payment_mode,booking_open,event_status,booking_questions) VALUES
('80000000-0000-0000-0000-000000000001','Ticket wrapper','2036-04-01','19:00','2036-04-01 19:00+00',180,'table','prepaid',true,'scheduled','[]');
INSERT INTO event_ticket_types VALUES ('81000000-0000-0000-0000-000000000001','80000000-0000-0000-0000-000000000001',0,NULL,true,0,now());
DO $$ DECLARE r jsonb; BEGIN
 r:=create_event_booking_v07('80000000-0000-0000-0000-000000000001',gen_random_uuid(),'admin','seated',15,'[{"ticket_type_id":"81000000-0000-0000-0000-000000000001","quantity":2}]');
 PERFORM pg_temp.assert_ok(r->>'state'='pending_payment' AND r->>'table_booking_id' IS NOT NULL,'v07 retains atomic table identity');
 r:=create_event_booking_v08('80000000-0000-0000-0000-000000000001',gen_random_uuid(),2,'admin','seated',15,'[{"ticket_type_id":"81000000-0000-0000-0000-000000000001","quantity":2}]','[]',0);
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed' AND r->>'table_booking_id' IS NOT NULL,'v08 retains atomic table identity for free basket');
 PERFORM pg_temp.assert_ok((SELECT status='confirmed' AND hold_expires_at IS NULL FROM table_bookings WHERE id=(r->>'table_booking_id')::uuid),'free basket confirms linked physical table before service returns');
END $$;
-- Waitlist acceptance exchanges its own hold for physical booking atomically.
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,booking_open,event_status) VALUES
('a0000000-0000-0000-0000-000000000001','Waitlist general','2038-01-01','19:00','2038-01-01 19:00+00',180,2,'general','prepaid',true,'scheduled'),
('a0000000-0000-0000-0000-000000000002','Waitlist communal','2038-01-02','19:00','2038-01-02 19:00+00',180,NULL,'communal','free',true,'scheduled'),
('a0000000-0000-0000-0000-000000000003','Waitlist table','2038-01-03','19:00','2038-01-03 19:00+00',180,NULL,'table','free',true,'scheduled');
CREATE FUNCTION pg_temp.make_offer(e uuid, seats integer, token text) RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE c uuid:=gen_random_uuid(); w uuid; o uuid;
BEGIN
 INSERT INTO waitlist_entries(event_id,customer_id,requested_seats,status) VALUES(e,c,seats,'offered') RETURNING id INTO w;
 INSERT INTO waitlist_offers(waitlist_entry_id,event_id,customer_id,seats_held,status,expires_at) VALUES(w,e,c,seats,'sent',now()+interval '1 hour') RETURNING id INTO o;
 INSERT INTO booking_holds(hold_type,waitlist_offer_id,seats_or_covers_held,status,expires_at) VALUES('waitlist_hold',o,seats,'active',now()+interval '1 hour');
 INSERT INTO guest_tokens(hashed_token,customer_id,waitlist_offer_id,action_type,expires_at) VALUES(token,c,o,'waitlist_offer',now()+interval '1 hour');
 RETURN o;
END $$;
DO $$ DECLARE r jsonb; o uuid; hold_before jsonb; b uuid; BEGIN
 o:=pg_temp.make_offer('a0000000-0000-0000-0000-000000000001',2,'last-general-seats');
 PERFORM pg_temp.assert_ok((SELECT seats_remaining=0 FROM get_event_capacity_snapshot_v05(ARRAY['a0000000-0000-0000-0000-000000000001'::uuid])),'own waitlist hold uses last seats');
 r:=accept_waitlist_offer_v05('last-general-seats');
 PERFORM pg_temp.assert_ok(r->>'state'='pending_payment','last held general places can be accepted'); b:=(r->>'booking_id')::uuid;
 PERFORM pg_temp.assert_ok((SELECT status='consumed' FROM booking_holds WHERE waitlist_offer_id=o),'offer hold consumed once');
 PERFORM pg_temp.assert_ok((SELECT hold_expires_at=now()+interval '24 hours' FROM bookings WHERE id=b),'waitlist payment duration retains original 24 hours');
 PERFORM pg_temp.assert_ok(accept_waitlist_offer_v05('last-general-seats')->>'reason'='token_used','accepted token cannot create duplicate booking');
 UPDATE tables SET is_bookable=table_number='1';
 r:=create_event_booking_v05('a0000000-0000-0000-0000-000000000002',gen_random_uuid(),2,'admin');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed','first half of communal table booked');
 UPDATE events SET standing_capacity=10 WHERE id='a0000000-0000-0000-0000-000000000002';
 o:=pg_temp.make_offer('a0000000-0000-0000-0000-000000000002',2,'shared-table');
 PERFORM pg_temp.assert_ok((SELECT seated_remaining=0 AND standing_remaining=10 AND total_remaining=10 FROM get_event_capacity_snapshot_v05(ARRAY['a0000000-0000-0000-0000-000000000002'::uuid])),'seated offer reserves seated pool independently from standing');
 r:=accept_waitlist_offer_v05('shared-table');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed','waitlist accepts remaining seats on shared communal table');
 PERFORM pg_temp.assert_ok((SELECT sum(seats)=4 FROM event_communal_seat_allocations WHERE event_id='a0000000-0000-0000-0000-000000000002'),'shared table seats allocated once');
 UPDATE events SET standing_capacity=3 WHERE id='a0000000-0000-0000-0000-000000000002';
 o:=pg_temp.make_offer('a0000000-0000-0000-0000-000000000002',2,'no-standing-switch');
 SELECT to_jsonb(h) INTO hold_before FROM booking_holds h WHERE waitlist_offer_id=o;
 r:=accept_waitlist_offer_v05('no-standing-switch');
 PERFORM pg_temp.assert_ok(r->>'state'='blocked' AND r->>'reason'='seated_capacity_changed','waitlist does not silently become standing');
 PERFORM pg_temp.assert_ok((SELECT to_jsonb(h)=hold_before FROM booking_holds h WHERE waitlist_offer_id=o),'failed acceptance restores own hold byte for byte');
 PERFORM pg_temp.assert_ok((SELECT status='sent' FROM waitlist_offers WHERE id=o) AND (SELECT consumed_at IS NULL FROM guest_tokens WHERE hashed_token='no-standing-switch'),'failed acceptance keeps token and offer usable');
 o:=pg_temp.make_offer('a0000000-0000-0000-0000-000000000003',5,'no-party-fit');
 SELECT to_jsonb(h) INTO hold_before FROM booking_holds h WHERE waitlist_offer_id=o;
 r:=accept_waitlist_offer_v05('no-party-fit');
 PERFORM pg_temp.assert_ok(r->>'state'='blocked','unfitting waitlist party rejected');
 PERFORM pg_temp.assert_ok((SELECT to_jsonb(h)=hold_before FROM booking_holds h WHERE waitlist_offer_id=o),'table-fit failure restores hold');
 UPDATE booking_holds SET status='released' WHERE waitlist_offer_id=o;
 o:=pg_temp.make_offer('a0000000-0000-0000-0000-000000000003',3,'table-fit');
 r:=accept_waitlist_offer_v05('table-fit');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed' AND r->>'table_booking_id' IS NOT NULL,'waitlist table reservation created atomically');
 INSERT INTO waitlist_entries(event_id,customer_id,requested_seats,status) VALUES ('a0000000-0000-0000-0000-000000000002',gen_random_uuid(),1,'queued');
 PERFORM pg_temp.assert_ok(create_next_waitlist_offer_v05('a0000000-0000-0000-0000-000000000002')->>'reason'='no_capacity','standing-only space does not generate seated waitlist offers');
 UPDATE tables SET is_bookable=true;
 INSERT INTO waitlist_entries(event_id,customer_id,requested_seats,status,created_at) VALUES
 ('a0000000-0000-0000-0000-000000000003',gen_random_uuid(),5,'queued',now()-interval '1 hour'),
 ('a0000000-0000-0000-0000-000000000003',gen_random_uuid(),2,'queued',now());
 r:=create_next_waitlist_offer_v05('a0000000-0000-0000-0000-000000000003');
 PERFORM pg_temp.assert_ok(r->>'state'='offered' AND (r->>'requested_seats')::integer=2,'table offers skip parties that cannot fit real tables');
END $$;
-- Joined parties require a real connected combination, not a sum of scattered seats.
INSERT INTO table_join_links VALUES ('10000000-0000-0000-0000-000000000001','10000000-0000-0000-0000-000000000002'),('10000000-0000-0000-0000-000000000002','10000000-0000-0000-0000-000000000001');
INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,booking_mode,payment_mode,booking_open,event_status) VALUES
('b0000000-0000-0000-0000-000000000001','Joined table','2039-01-01','19:00','2039-01-01 19:00+00',180,'table','free',true,'scheduled');
DO $$ DECLARE r jsonb; BEGIN
 r:=create_event_booking_v05('b0000000-0000-0000-0000-000000000001',gen_random_uuid(),7,'admin');
 PERFORM pg_temp.assert_ok(r->>'state'='confirmed','party of seven uses connected two-table combination');
 PERFORM pg_temp.assert_ok((SELECT count(*)=2 FROM booking_table_assignments WHERE table_booking_id=(r->>'table_booking_id')::uuid),'both joined physical tables assigned');
END $$;
SELECT 'All event physical-capacity assertions passed' AS result;

SELECT pg_temp.assert_ok((SELECT standing_capacity=1 FROM events WHERE id='e9e84ee8-c59b-4f93-80f6-7e7961a03240'),'quiz current standing allowance preserved at one');

ROLLBACK;

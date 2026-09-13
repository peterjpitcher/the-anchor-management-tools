
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE events(id uuid primary key, name text default 'Fixture Event', capacity integer default 5,
 payment_mode text default 'cash_only', booking_mode text default 'communal', booking_open boolean default true,
 event_status text default 'scheduled', start_datetime timestamptz default now()+interval '1 day',
 date date, time time, end_time time, duration_minutes integer default 120,
 seated_capacity integer default 2, standing_capacity integer default 3);
CREATE TABLE bookings(id uuid primary key default gen_random_uuid(),customer_id uuid,event_id uuid,seats integer,
 status text,source text,event_seating_type text,hold_expires_at timestamptz,created_at timestamptz,updated_at timestamptz);
CREATE TABLE booking_holds(hold_type text,event_booking_id uuid,seats_or_covers_held integer,status text,
 expires_at timestamptz,created_at timestamptz,updated_at timestamptz);
CREATE TABLE fixture_allocations(booking_id uuid,seats integer);
CREATE FUNCTION event_communal_window_v01(uuid) RETURNS TABLE(start_datetime timestamptz,end_datetime timestamptz)
 LANGUAGE sql AS $$ SELECT e.start_datetime,e.start_datetime+interval '2 hours' FROM events e WHERE id=$1 $$;
CREATE FUNCTION get_event_capacity_snapshot_v05(uuid[]) RETURNS TABLE(capacity integer,seats_remaining integer,
 seated_remaining integer,standing_remaining integer,total_remaining integer,standing_capacity integer)
 LANGUAGE sql AS $$ SELECT e.capacity,
 e.capacity-coalesce(sum(b.seats),0)::integer,
 e.seated_capacity-coalesce(sum(b.seats) FILTER(WHERE b.event_seating_type='seated'),0)::integer,
 e.standing_capacity-coalesce(sum(b.seats) FILTER(WHERE b.event_seating_type='standing'),0)::integer,
 e.capacity-coalesce(sum(b.seats),0)::integer,e.standing_capacity
 FROM events e LEFT JOIN bookings b ON b.event_id=e.id AND b.status IN ('confirmed','pending_payment')
 WHERE e.id=ANY($1) GROUP BY e.id $$;
CREATE FUNCTION allocate_event_communal_seats_v01(uuid,uuid,integer,timestamptz,timestamptz) RETURNS jsonb
 LANGUAGE plpgsql AS $$ BEGIN INSERT INTO fixture_allocations VALUES ($2,$3); RETURN '{"state":"confirmed"}'; END $$;
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
INSERT INTO events(id) VALUES ('00000000-0000-0000-0000-000000000001');

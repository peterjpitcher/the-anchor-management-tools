#!/usr/bin/env python3
"""Exercise the booking policy in an isolated socket-only PostgreSQL database.

The real booking function runs against synthetic records. Capacity and table
allocation are fixture functions; this checks the policy and its event-row lock,
not the production allocator or external confirmations.
"""
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/bin')
MIGRATION = ROOT / 'supabase/migrations/20260906134726_event_standing_after_seated_sold_out.sql'
ROLLBACK = ROOT / 'tasks/standing-ticket-policy/rollback.sql'

SETUP = r"""
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
"""

def main():
    with tempfile.TemporaryDirectory(prefix='standing-pg-') as folder:
        work=Path(folder); socket=work/'socket'; socket.mkdir(); cluster=work/'db'
        subprocess.run([str(PG/'initdb'),'-D',str(cluster),'-A','trust','--no-locale'],check=True,capture_output=True)
        subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster),'-l',str(work/'log'),'-o',f"-k {socket} -c listen_addresses=''",'-w','start'],check=True,capture_output=True)
        cmd=[str(PG/'psql'),'-h',str(socket),'-d','postgres','-X','-q','-v','ON_ERROR_STOP=1']
        def sql(value):
            result=subprocess.run(cmd,input=value,text=True,capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line)
            return result.stdout
        def call(seats, preference='seated', source='brand_site', customer=None):
            cust="gen_random_uuid()" if customer is None else "'"+customer+"'::uuid"
            return f"create_event_booking_v05('00000000-0000-0000-0000-000000000001',{cust},{seats},'{source}','{preference}')"
        def check(expression,label): sql("SELECT fixture_assert("+expression+",'"+label+"');")
        def reset(): sql('TRUNCATE bookings,booking_holds,fixture_allocations;')
        try:
            sql(SETUP);sql(ROLLBACK.read_text())
            check("("+call(3)+"->>'event_seating_type')='standing'",'baseline reproduces silent conversion')
            reset(); sql('BEGIN;'+MIGRATION.read_text()+'ROLLBACK;')
            check("("+call(3)+"->>'event_seating_type')='standing'",'transaction rollback restores old behaviour')
            reset();sql(MIGRATION.read_text())
            check("("+call(1,'standing')+"->>'reason')='standing_not_available_until_seated_full'",'standing blocked while seats remain')
            check("("+call(3)+"->>'reason')='seated_capacity_changed'",'oversized seated group never becomes standing')
            check('(SELECT count(*) FROM bookings)=0','blocked requests create no bookings')
            sql('UPDATE events SET seated_capacity=NULL;')
            check("("+call(1,'standing')+"->>'reason')='standing_not_available_until_seated_full'",'unknown seat availability blocks standing')
            sql('UPDATE events SET seated_capacity=2;')
            check("("+call(2)+"->>'event_seating_type')='seated'",'public seats book normally')
            check("("+call(3,'standing')+"->>'event_seating_type')='standing'",'standing books after seats sell out')
            check('(SELECT count(*) FROM fixture_allocations)=1','standing has no table allocation')
            check("("+call(1,'standing')+"->>'state')='full_with_waitlist_option'",'standing sellout cannot overbook')
            check("("+call(1)+"->>'state')='full_with_waitlist_option'",'complete sellout retains seated waitlist path')
            reset()
            for source in ['admin','foh','walk-in']:
                check("("+call(1,'standing',source)+"->>'event_seating_type')='standing'",'staff '+source+' can choose standing');reset()
            for source in ['sms_reply','unknown']:
                check("("+call(1,'standing',source)+"->>'reason')='standing_not_available_until_seated_full'",source+' cannot bypass policy')
            sql("UPDATE events SET payment_mode='prepaid';")
            check("("+call(2)+"->>'state')='pending_payment'",'prepaid seats create payment hold')
            check("("+call(1,'standing')+"->>'state')='pending_payment'",'prepaid standing creates payment hold')
            check('(SELECT count(*) FROM booking_holds)=2','both payment holds recorded')
            reset();sql("UPDATE events SET payment_mode='cash_only';")
            customer='00000000-0000-0000-0000-000000000002'
            check("("+call(1,customer=customer)+"->>'state')='confirmed'",'initial customer booking accepted')
            check("("+call(1,customer=customer)+"->>'reason')='customer_conflict'",'duplicate customer remains blocked')
            check("("+call(0)+"->>'reason')='invalid_seats'",'invalid quantity rejected')
            reset();sql("UPDATE events SET payment_mode='cash_only',seated_capacity=1,capacity=2;")
            processes=[subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True) for _ in range(2)]
            for proc in processes:
                proc.stdin.write('SELECT '+call(1)+';');proc.stdin.close()
            outputs=[]
            for proc in processes:
                outputs.append(proc.stdout.read());err=proc.stderr.read()
                if proc.wait(): raise RuntimeError(err)
            check('(SELECT count(*) FROM bookings)=1','concurrent requests create only one seated booking')
            if sum('seated_capacity_changed' in output for output in outputs)!=1: raise RuntimeError('race did not return capacity change')
            print('PASS concurrent losing request requires guest review')
            check("NOT has_function_privilege('anon','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE')",'anon cannot call mutation')
            check("NOT has_function_privilege('authenticated','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE')",'authenticated grant remains restricted')
            check("has_function_privilege('service_role','create_event_booking_v05(uuid,uuid,integer,text,text)','EXECUTE')",'service role retains execute')
            sql(ROLLBACK.read_text());reset()
            check("("+call(1,'standing')+"->>'event_seating_type')='standing'",'rollback restores original standing choice')
        finally:
            subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster),'-m','immediate','-w','stop'],check=True,capture_output=True)

if __name__=='__main__': main()

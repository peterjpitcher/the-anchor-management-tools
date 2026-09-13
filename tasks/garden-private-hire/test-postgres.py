#!/usr/bin/env python3
"""Run real migration functions/triggers in a socket-only synthetic PostgreSQL cluster."""
from pathlib import Path
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parents[2]
DIR=Path(__file__).resolve().parent
PG=Path('/opt/homebrew/bin')
MIGRATION=ROOT/'supabase/migrations/20260906140724_outside_private_hire_blocking.sql'
SETUP=r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TYPE table_booking_status AS ENUM ('confirmed','seated','cancelled','no_show','pending_payment','pending_card_capture');
CREATE TYPE payment_status AS ENUM ('pending','completed','failed');
CREATE TYPE table_booking_payment_method AS ENUM ('cash','payment_link');
CREATE TABLE venue_spaces(id uuid PRIMARY KEY,blocks_all_spaces boolean DEFAULT false);
CREATE TABLE private_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text DEFAULT 'confirmed',event_date date,
 start_time time, end_time time,setup_date date,setup_time time,end_time_next_day boolean DEFAULT false);
CREATE TABLE private_booking_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),booking_id uuid REFERENCES private_bookings,
 space_id uuid REFERENCES venue_spaces,item_type text DEFAULT 'space');
CREATE TABLE table_bookings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),is_outside_seating boolean DEFAULT true,
 status table_booking_status DEFAULT 'confirmed',left_at timestamptz,hold_expires_at timestamptz,payment_status payment_status,
 start_datetime timestamptz,end_datetime timestamptz,party_size integer DEFAULT 2,committed_party_size integer,
 booking_date date,booking_time time,booking_purpose text DEFAULT 'food');
ALTER TABLE table_bookings ADD COLUMN high_chair_count integer DEFAULT 0,
 ADD COLUMN updated_at timestamptz,ADD COLUMN customer_id uuid DEFAULT gen_random_uuid(),
 ADD COLUMN booking_reference text DEFAULT 'FIXTURE',ADD COLUMN booking_type text DEFAULT 'regular',
 ADD COLUMN confirmed_at timestamptz,ADD COLUMN payment_method table_booking_payment_method;
CREATE TABLE booking_table_assignments(table_booking_id uuid,start_datetime timestamptz,end_datetime timestamptz);
CREATE TABLE payments(id uuid DEFAULT gen_random_uuid(),table_booking_id uuid,charge_type text,status text,amount numeric,
 currency text,metadata jsonb,stripe_payment_intent_id text,stripe_checkout_session_id text,created_at timestamptz);
CREATE TABLE booking_holds(table_booking_id uuid,hold_type text,status text,consumed_at timestamptz,updated_at timestamptz);
CREATE TABLE guest_tokens(table_booking_id uuid,action_type text,consumed_at timestamptz);
CREATE FUNCTION reserve_high_chairs(uuid,integer,timestamptz,timestamptz) RETURNS integer LANGUAGE plpgsql AS $$ BEGIN
 PERFORM pg_advisory_xact_lock(hashtext('high_chair_reservation')); RETURN $2; END $$;
CREATE TABLE outside_reservations(table_booking_id uuid PRIMARY KEY REFERENCES table_bookings,tables_reserved integer,
 ends_at timestamptz,starts_at timestamptz);
CREATE TABLE special_hours(date date,is_closed boolean,is_kitchen_closed boolean,opens time,closes time,kitchen_opens time,
 kitchen_closes time,kitchen_pace_covers integer,kitchen_walk_in_reserve integer);
CREATE TABLE fixture_settings(key text primary key,value boolean);
CREATE FUNCTION get_setting_int(text,integer) RETURNS integer LANGUAGE sql AS $$ SELECT $2 $$;
CREATE FUNCTION get_setting_bool(text,boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT coalesce((SELECT value FROM fixture_settings WHERE key=$1),$2) $$;
CREATE FUNCTION is_booking_live(table_booking_status,timestamptz,timestamptz,payment_status,timestamptz) RETURNS boolean LANGUAGE sql AS $$
 SELECT $1 NOT IN ('cancelled','no_show') AND $2 IS NULL AND NOT ($1 IN ('pending_payment','pending_card_capture') AND $3 IS NOT NULL AND $3 <= $5 AND $4 IS DISTINCT FROM 'completed') $$;
CREATE FUNCTION windows_overlap(timestamptz,timestamptz,timestamptz,timestamptz) RETURNS boolean LANGUAGE sql AS $$ SELECT $1<$4 AND $2>$3 $$;
CREATE FUNCTION business_hours_for_date(date) RETURNS TABLE(is_closed boolean,is_kitchen_closed boolean,opens time,closes time,kitchen_opens time,kitchen_closes time)
 LANGUAGE sql AS $$ SELECT false,false,'12:00'::time,'23:00'::time,'12:00'::time,'21:00'::time $$;
CREATE FUNCTION table_booking_within_service_window_v06(date,time,text,boolean) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public_booking_reason(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION public_booking_message(text) RETURNS text LANGUAGE sql AS $$ SELECT $1 $$;
CREATE FUNCTION count_high_chairs_in_window(timestamptz,timestamptz,uuid) RETURNS integer LANGUAGE sql AS $$ SELECT 0 $$;
CREATE FUNCTION find_table_allocation_candidates(timestamptz,timestamptz,integer,text,integer,boolean,uuid[],text,uuid,text,timestamptz)
 RETURNS TABLE(rank integer) LANGUAGE sql AS $$ SELECT 1 $$;
INSERT INTO venue_spaces VALUES ('6869774b-cfa5-4aff-a663-a14b2fb5633b',false),('00000000-0000-0000-0000-000000000002',true),('00000000-0000-0000-0000-000000000003',false);
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; END $$;
"""
GARDEN='6869774b-cfa5-4aff-a663-a14b2fb5633b'
PB='00000000-0000-0000-0000-000000000010'
TB='00000000-0000-0000-0000-000000000020'
DATE='2030-06-01'
def main():
 with tempfile.TemporaryDirectory(prefix='garden-pg-') as folder:
  work=Path(folder);sock=work/'sock';sock.mkdir();db=work/'db'
  subprocess.run([str(PG/'initdb'),'-D',str(db),'-A','trust','--no-locale'],check=True,capture_output=True)
  subprocess.run([str(PG/'pg_ctl'),'-D',str(db),'-l',str(work/'log'),'-o',f"-k {sock} -c listen_addresses=''",'-w','start'],check=True,capture_output=True)
  cmd=[str(PG/'psql'),'-h',str(sock),'-d','postgres','-X','-q','-v','ON_ERROR_STOP=1']
  def sql(value):
   r=subprocess.run(cmd,input=value,text=True,capture_output=True)
   if r.returncode: raise RuntimeError(r.stderr)
   return r.stdout
  def check(expr,label):
   sql('SELECT fixture_assert('+expr+',\''+label+'\');');print('PASS '+label)
  def fail(query,match,label):
   r=subprocess.run(cmd,input=query,text=True,capture_output=True)
   if not r.returncode or match not in r.stderr:raise RuntimeError(label+': '+r.stdout+r.stderr)
   print('PASS '+label)
  def reset():sql('TRUNCATE private_booking_items,private_bookings,table_bookings,outside_reservations; DELETE FROM fixture_settings;')
  def hire(space=GARDEN,status='confirmed'):
   return f"INSERT INTO private_bookings(id,status,event_date,start_time,end_time) VALUES ('{PB}','{status}','{DATE}','16:00','20:00'); INSERT INTO private_booking_items(booking_id,space_id) VALUES ('{PB}','{space}');"
  def table(start='17:00',end='18:00',outside=True,status='confirmed'):
   return f"INSERT INTO table_bookings(id,is_outside_seating,status,start_datetime,end_datetime) VALUES ('{TB}',{str(outside).lower()},'{status}','{DATE} {start} Europe/London','{DATE} {end} Europe/London');"
  try:
   sql(SETUP)
   for name in ['move_table_booking_time_v06','record_table_cash_deposit_v05','confirm_table_payment_v05']:
    sql((DIR/(name+'.sql')).read_text())
   # Install the prior availability definition without executing rollback drops.
   original=(DIR/'rollback.sql').read_text().split('DROP TRIGGER')[0]
   sql(original);sql('BEGIN;'+MIGRATION.read_text()+'ROLLBACK;')
   check("to_regprocedure('outside_private_hire_windows(uuid)') IS NULL",'transaction rollback removes new objects')
   sql(MIGRATION.read_text());sql(hire())
   fail(table(),'table_assignment_private_blocked','outside insert refused during garden hire')
   check('(SELECT count(*) FROM table_bookings)=0','blocked insert writes no booking')
   check("EXISTS(SELECT 1 FROM jsonb_array_elements(check_table_availability_v06('2030-06-01',2,'food',true)->'slots') s WHERE s->>'time'='17:00' AND s->>'state'='unavailable' AND s->>'public_reason'='outside_full')",'real outside availability hides private hire')
   check("EXISTS(SELECT 1 FROM jsonb_array_elements(check_table_availability_v06('2030-06-01',2,'food',false)->'slots') s WHERE s->>'time'='17:00' AND s->>'state'='available')",'indoor availability remains separate')
   sql(table(outside=False));check('(SELECT count(*) FROM table_bookings)=1','indoor insert still accepted')
   fail(f"UPDATE table_bookings SET is_outside_seating=true WHERE id='{TB}';",'table_assignment_private_blocked','switching indoor booking outside refused')
   sql('DELETE FROM table_bookings;');sql(table('14:00','15:30'));check('(SELECT count(*) FROM table_bookings)=1','exact pre-buffer endpoint allowed')
   fail(f"UPDATE table_bookings SET end_datetime='{DATE} 15:31 Europe/London' WHERE id='{TB}';",'table_assignment_private_blocked','amendment overlapping buffer refused')
   sql('DELETE FROM table_bookings;');sql(table('20:30','21:30'));check('(SELECT count(*) FROM table_bookings)=1','exact post-buffer start allowed')
   reset();sql(hire(status='draft'));fail(table(),'table_assignment_private_blocked','draft hire blocks garden')
   sql("UPDATE private_bookings SET status='cancelled';");sql(table());check('(SELECT count(*) FROM table_bookings)=1','cancelled hire releases garden')
   fail("UPDATE private_bookings SET status='confirmed';",'already has an outside','reactivating conflicting hire refused')
   reset();sql(hire('00000000-0000-0000-0000-000000000002'));fail(table(),'table_assignment_private_blocked','whole pub hire blocks garden')
   reset();sql(hire('00000000-0000-0000-0000-000000000003'));sql(table());check('(SELECT count(*) FROM table_bookings)=1','indoor-only hire leaves garden available')
   fail(f"UPDATE private_booking_items SET space_id='{GARDEN}';",'already has an outside','changing hire space into occupied garden refused')
   reset();sql(table());fail(hire(),'already has an outside','adding garden hire after outside booking refused')
   reset();sql(hire());sql(table(status='cancelled'))
   fail("UPDATE table_bookings SET status='confirmed';",'table_assignment_private_blocked','reactivating cancelled table booking refused')
   reset();sql(hire());sql("UPDATE private_bookings SET setup_time='14:00';")
   fail(table('13:45','14:30'),'table_assignment_private_blocked','setup buffer blocks earlier arrivals')
   sql("UPDATE private_bookings SET start_time='20:00',setup_time=NULL,end_time='01:00';")
   check("EXISTS(SELECT 1 FROM outside_private_hire_windows(NULL) WHERE blocked_end='2030-06-02 01:30 Europe/London'::timestamptz)",'overnight end includes next day')
   sql("UPDATE private_bookings SET setup_date='2030-05-31',setup_time='16:00';")
   check("EXISTS(SELECT 1 FROM outside_private_hire_windows(NULL) WHERE blocked_end='2030-06-02 01:30 Europe/London'::timestamptz)",'previous-day setup preserves overnight end')
   sql("UPDATE private_bookings SET setup_date=NULL,setup_time=NULL,start_time='16:00',end_time='18:00',end_time_next_day=true;")
   check("EXISTS(SELECT 1 FROM outside_private_hire_windows(NULL) WHERE blocked_end='2030-06-02 18:30 Europe/London'::timestamptz)",'explicit next-day end is honoured')
   reset();sql(table(status='pending_payment'));sql("UPDATE table_bookings SET hold_expires_at=now()-interval '1 minute';");sql(hire())
   check('(SELECT count(*) FROM private_booking_items)=1','expired unpaid table hold does not block hire')
   fail("UPDATE table_bookings SET payment_status='completed';",'table_assignment_private_blocked','paid hold cannot reactivate into private hire')
   reset();sql(hire());sql("INSERT INTO fixture_settings VALUES ('turn_times_enabled',true);")
   fail(table('14:00','15:20'),'table_assignment_private_blocked','table turnaround gap participates in conflict')
   for role in ['anon','authenticated']:
    check(f"NOT has_function_privilege('{role}','outside_private_hire_windows(uuid)','EXECUTE')",role+' cannot read private windows')
   check("has_function_privilege('service_role','outside_private_hire_windows(uuid)','EXECUTE')",'service role can read availability helper')
   # Both orderings: second writer waits, then rejects using the first committed row.
   for first_hire in [True,False]:
    reset();first=hire() if first_hire else table();second=table() if first_hire else hire()
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write('BEGIN;'+first+"SELECT pg_sleep(0.7);COMMIT;");proc.stdin.close();time.sleep(0.2)
    result=subprocess.run(cmd,input=second,text=True,capture_output=True)
    err=proc.stderr.read();proc.wait()
    if proc.returncode or result.returncode==0 or ('private_blocked' not in result.stderr and 'already has an outside' not in result.stderr):raise RuntimeError(err+result.stderr)
    print('PASS concurrent '+('hire then table' if first_hire else 'table then hire')+' rejects second writer')
   # The real production RPCs prelock the row. A concurrent ordinary edit must
   # not hold an incompatible advisory lock while waiting for that same row.
   def race_success(first,second,label):
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    proc.stdin.write("SET application_name='garden-lock-first';BEGIN;"+first+"COMMIT;");proc.stdin.close()
    deadline=time.monotonic()+3
    while time.monotonic()<deadline:
     if 't' in sql("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name='garden-lock-first' AND wait_event='PgSleep');").strip():break
     time.sleep(0.02)
    else:raise RuntimeError('first writer never reached lock barrier')
    result=subprocess.run(cmd,input=second,text=True,capture_output=True)
    err=proc.stderr.read();out=proc.stdout.read();proc.wait()
    if proc.returncode or result.returncode:raise RuntimeError(label+': '+err+result.stderr)
    print('PASS '+label)
   move=f"SELECT move_table_booking_time_v06('{TB}','17:15','{DATE} 17:15 Europe/London','{DATE} 18:15 Europe/London','{DATE} 18:15 Europe/London');"
   for name,call in [
    ('staff time move',move),
    ('cash deposit',f"SELECT record_table_cash_deposit_v05('{TB}',20,'GBP');"),
    ('payment confirmation',f"SELECT confirm_table_payment_v05('{TB}','fixture-checkout','fixture-payment',20,'GBP');")]:
    reset();sql('TRUNCATE payments,booking_holds,guest_tokens;');sql(table(status='pending_payment'))
    race_success(f"SELECT id FROM table_bookings WHERE id='{TB}' FOR UPDATE;SELECT pg_sleep(0.7);"+call,
     f"UPDATE table_bookings SET party_size=3 WHERE id='{TB}';",name+' and concurrent edit both succeed')
   reset();sql(hire())
   race_success(f"SELECT id FROM private_bookings WHERE id='{PB}' FOR UPDATE;SELECT pg_sleep(0.7);UPDATE private_bookings SET start_time='16:15' WHERE id='{PB}';",
    f"UPDATE private_bookings SET end_time='20:15' WHERE id='{PB}';",'prelocked private booking and concurrent edit both succeed')
   reset();sql(table())
   other_table=table().replace(TB,'00000000-0000-0000-0000-000000000021')
   race_success("SELECT pg_advisory_xact_lock(hashtext('table_alloc'));SELECT pg_advisory_xact_lock(hashtext('high_chair_reservation'));SELECT pg_sleep(0.7);"+other_table,
    move,'allocator highchair lock and real staff move both succeed')
   sql((DIR/'rollback.sql').read_text());reset();sql(hire());sql(table())
   check('(SELECT count(*) FROM table_bookings)=1','explicit rollback restores original behaviour')
  finally:
   subprocess.run([str(PG/'pg_ctl'),'-D',str(db),'-m','immediate','-w','stop'],check=True,capture_output=True)
if __name__=='__main__':main()

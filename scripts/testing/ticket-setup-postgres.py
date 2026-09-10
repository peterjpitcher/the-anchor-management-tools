#!/usr/bin/env python3
"""Run real booking wrappers and migration in an isolated socket-only PostgreSQL.
Capacity and allocation use synthetic fixture helpers, never production services.
"""
from pathlib import Path
import subprocess
import tempfile
import json
ROOT=Path(__file__).resolve().parents[2]
PG=Path('/opt/homebrew/bin')
MIGRATION=ROOT/'supabase/migrations/20260910065400_ticket_setup_and_attendees.sql'
SETUP=(ROOT/'scripts/testing/fixtures/ticket-setup-base.sql').read_text()+"""
ALTER TABLE booking_holds ADD consumed_at timestamptz;
ALTER TABLE events ADD price numeric default 45, ADD price_per_seat numeric default 45, ADD is_free boolean default false, ADD online_discount_type text default 'fixed', ADD online_discount_value numeric default 5;
ALTER TABLE bookings ADD is_reminder_only boolean default false, ADD attendee_names text[];
CREATE TABLE event_ticket_types(id uuid primary key default gen_random_uuid(),event_id uuid references events(id) on delete cascade,name text,base_price numeric,capacity integer,sort_order integer default 0,is_active boolean default true,created_at timestamptz default now());
CREATE TABLE booking_items(id uuid primary key default gen_random_uuid(),booking_id uuid references bookings(id) on delete cascade,ticket_type_id uuid,quantity integer,unit_price numeric,attendee_names text[],unique(booking_id,ticket_type_id));
CREATE FUNCTION event_ticket_type_unit_price(numeric,text,numeric) RETURNS numeric LANGUAGE sql AS $$ SELECT greatest(0,round($1-case when $2='fixed' then coalesce($3,0) when $2='percent' then $1*coalesce($3,0)/100 else 0 end,2)) $$;
CREATE FUNCTION get_event_ticket_type_capacity_v01(uuid) RETURNS TABLE(ticket_type_id uuid,remaining integer) LANGUAGE sql AS $$ SELECT id,100 FROM event_ticket_types WHERE event_id=$1 $$;
CREATE FUNCTION trg_sync_booking_default_item() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM sync_booking_default_item_v01(new.id);RETURN null;END $$;
CREATE TRIGGER booking_sync_default_item AFTER INSERT OR UPDATE OF seats,is_reminder_only ON bookings FOR EACH ROW EXECUTE FUNCTION trg_sync_booking_default_item();
INSERT INTO event_ticket_types(id,event_id,name,base_price) VALUES ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','Standard',45);
CREATE FUNCTION normalize_event_pricing_v01() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_price numeric; BEGIN v_price:=coalesce(nullif(NEW.price_per_seat,0),nullif(NEW.price,0),0);
IF v_price>0 THEN NEW.is_free:=false;IF NEW.payment_mode IS NULL OR NEW.payment_mode='free' THEN NEW.payment_mode:='cash_only';END IF;
ELSIF NEW.is_free=true THEN NEW.payment_mode:='free';END IF;RETURN NEW;END $$;
CREATE TRIGGER trg_normalize_event_pricing_v01 BEFORE INSERT OR UPDATE OF price,price_per_seat,is_free,payment_mode ON events FOR EACH ROW EXECUTE FUNCTION normalize_event_pricing_v01();
UPDATE events SET payment_mode='prepaid',capacity=100,seated_capacity=100;
"""
E='00000000-0000-0000-0000-000000000001';T='00000000-0000-0000-0000-000000000010';Q='00000000-0000-0000-0000-000000000020'
def literal(value):return "'"+json.dumps(value).replace("'","''")+"'::jsonb"
def main():
 with tempfile.TemporaryDirectory(prefix='ticket-pg-') as folder:
  work=Path(folder);socket=work/'socket';socket.mkdir();cluster=work/'db'
  subprocess.run([str(PG/'initdb'),'-D',str(cluster),'-A','trust','--no-locale'],check=True,capture_output=True)
  subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster),'-l',str(work/'log'),'-o',f"-k {socket} -c listen_addresses=''",'-w','start'],check=True,capture_output=True)
  cmd=[str(PG/'psql'),'-h',str(socket),'-d','postgres','-X','-q','-v','ON_ERROR_STOP=1']
  def sql(value,error=None):
   r=subprocess.run(cmd,input=value,text=True,capture_output=True)
   if error:
    if r.returncode==0 or error not in r.stderr:raise RuntimeError('Expected '+error+': '+r.stderr)
    print('PASS '+error);return
   if r.returncode:raise RuntimeError(r.stderr)
   for line in r.stderr.splitlines():
    if 'PASS ' in line:print(line)
   return r.stdout
  def check(expr,label):sql("SELECT fixture_assert("+expr+",'"+label+"');")
  def attendee(answer='none',name='Fixture Guest'):return {'id':'00000000-0000-0000-0000-000000000030','name':name,'ticket_type_id':T,'answers':{Q:answer}}
  def call(attendees=None,selections=False,customer='gen_random_uuid()',seats=1,expected=None):
   return f"create_event_booking_v08('{E}',{customer},{seats},'brand_site','seated',15,{literal([{'ticket_type_id':T,'quantity':seats}]) if selections else 'null'},{literal([attendee()] if attendees is None else attendees)},{'null' if expected is None else expected})"
  def reset():sql('TRUNCATE bookings,booking_items,booking_holds,fixture_allocations CASCADE;')
  try:
   sql(SETUP);sql((ROOT/'tasks/ticket-setup/live-booking-functions.sql').read_text());sql('BEGIN;'+MIGRATION.read_text()+'ROLLBACK;')
   check("NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='bookings' AND column_name='attendees')",'transaction rollback removes draft schema')
   sql(MIGRATION.read_text())
   sql("INSERT INTO events(id) VALUES ('00000000-0000-0000-0000-000000000050');")
   check("(SELECT count(*) FROM event_ticket_types WHERE event_id='00000000-0000-0000-0000-000000000050')=1",'new event gets exactly one Standard ticket')
   sql("DELETE FROM events WHERE id='00000000-0000-0000-0000-000000000050';")
   check("NOT EXISTS(SELECT 1 FROM event_ticket_types WHERE event_id='00000000-0000-0000-0000-000000000050')",'parent event cascade remains allowed')
   sql(f"UPDATE events SET booking_questions={literal([{'id':Q,'label':'Any requirements?','type':'text','required':True}])};")
   sql('SELECT '+call([])+';','attendee_count_mismatch')
   sql('SELECT '+call([attendee('')])+';','attendee_answer_required')
   sql('SELECT '+call([attendee(name='')])+';','attendee_name_required')
   check('(SELECT count(*) FROM bookings)=0','validation creates no booking')
   sql('SELECT '+call(expected=39)+';','price_changed')
   check('(SELECT count(*) FROM bookings)=0','price mismatch rolls back booking and hold')
   sql('UPDATE event_ticket_types SET is_active=false;','last_active_ticket_type')
   sql('DELETE FROM event_ticket_types;','last_active_ticket_type')
   unknown=attendee();unknown['answers']['00000000-0000-0000-0000-000000000099']='stale'
   sql('SELECT '+call([unknown])+';','unknown_attendee_question')
   check("("+call()+"->>'state')='pending_payment'",'single ticket creates hold')
   check("(SELECT unit_price FROM booking_items)=40",'single ticket uses discounted authoritative price')
   check("(SELECT attendees->0->'answers'->0->>'value' FROM bookings)='none'",'explicit none answer snapshot saved')
   check('(SELECT ticket_price_locked FROM bookings)','new booking is explicitly price locked')
   sql('UPDATE bookings SET seats=2;','attendee_count_mismatch')
   check('(SELECT seats FROM bookings)=1','legacy seat change preserves named guest booking')
   reset();second=attendee();second['id']='00000000-0000-0000-0000-000000000031';second['name']='Second Fixture'
   sql('SELECT '+call([attendee(),second],True,seats=2)+';')
   check('(SELECT jsonb_array_length(attendees) FROM bookings)=2','two tickets retain two stable guests')
   check('(SELECT cardinality(attendee_names) FROM booking_items)=2','two guest names mirror onto tickets')
   reset();sql('SELECT '+call([attendee(),attendee()],True,seats=2)+';','invalid_attendee_id')
   reset();check("("+call(selections=True)+"->>'state')='pending_payment'",'selected ticket creates hold')
   check('(SELECT unit_price FROM booking_items)=40','selected ticket discounts correctly')
   sql("UPDATE events SET online_discount_ends_at=now()-interval '1 second';")
   check('(SELECT unit_price FROM booking_items)=40','existing hold retains quoted price')
   reset();sql('SELECT '+call()+';');check('(SELECT unit_price FROM booking_items)=45','expired single ticket discount removed')
   reset();sql('SELECT '+call(selections=True)+';');check('(SELECT unit_price FROM booking_items)=45','expired selected ticket discount removed')
   sql(f"UPDATE bookings SET attendees={literal([{'id':attendee()['id'],'name':'Updated Fixture','ticket_type_id':T,'answers':[]}])};")
   check("(SELECT attendee_names[1] FROM booking_items)='Updated Fixture'",'staff update mirrors ticket names')
   check("(SELECT attendee_names[1] FROM bookings)='Updated Fixture'",'staff update mirrors booking names')
   reset();customer="'00000000-0000-0000-0000-000000000040'::uuid"
   sql('SELECT '+call(customer=customer)+';');check("("+call([attendee('changed')],True,customer)+"->>'reason')='customer_conflict'",'retry returns conflict')
   check("(SELECT attendees->0->'answers'->0->>'value' FROM bookings)='none'",'retry does not alter existing answers')
   sql(f"UPDATE events SET booking_questions={literal([{'id':Q,'label':'Choice','type':'choice','required':True,'options':['A','B']}])};")
   sql('SELECT '+call([attendee('C')])+';','invalid_attendee_answer');reset();sql('SELECT '+call([attendee('A')])+';')
   check("(SELECT attendees->0->'answers'->0->>'label' FROM bookings)='Choice'",'choice wording snapshot')
   check("(SELECT (attendees->0->'answers'->0->>'required')::boolean FROM bookings)",'required rule snapshot')
   check("(SELECT attendees->0->'answers'->0->'options' FROM bookings)='[\"A\",\"B\"]'::jsonb",'choice options snapshot')
   sql("UPDATE events SET price=55;");check('(SELECT base_price FROM event_ticket_types)=55','legacy price updates ticket')
   check('(SELECT price_per_seat FROM events)=55','legacy price mirrors both fields')
   sql('UPDATE event_ticket_types SET base_price=60;');check('(SELECT price FROM events)=60','ticket price mirrors event without recursion')
   reset();sql("UPDATE event_ticket_types SET base_price=0;UPDATE events SET payment_mode='free';")
   check("("+call([])+"->>'state')='confirmed'",'free event retains simple booking')
   sql(f"INSERT INTO event_ticket_types(event_id,name,base_price,sort_order) VALUES ('{E}','Adult',10,1);")
   check("(SELECT payment_mode FROM events)='cash_only' AND NOT (SELECT is_free FROM events)",'free first ticket cannot hide a paid second type')
   reset();sql("UPDATE events SET payment_mode='cash_only',booking_questions='[]';")
   check("("+call([])+"->>'state')='confirmed'",'ordinary pay on arrival keeps simple booking')
   reset();sql("UPDATE events SET payment_mode='prepaid',booking_questions='[]';")
   check("("+call([{**attendee(),'answers':{}}])+"->>'state')='confirmed'",'explicit free ticket needs no payment')
   check("NOT EXISTS (SELECT 1 FROM booking_holds WHERE status='active')",'free ticket consumes payment hold')
   # Combined guest and dining requests must commit or roll back together.
   sql("ALTER TABLE bookings ADD notes text;")
   sql((ROOT/'supabase/migrations/20260910073920_ticket_attendees_dining_requests.sql').read_text())
   reset();sql("UPDATE event_ticket_types SET base_price=45 WHERE id='"+T+"';UPDATE events SET payment_mode='prepaid',booking_questions='[]',online_discount_ends_at=null;")
   def combined(customer="gen_random_uuid()",expected=40,dining="'before_event'"):
    return f"create_event_booking_with_attendees_and_requests_v01('{E}',{customer},1,'brand_site','seated',15,null,{dining},true,{literal([{**attendee(),'answers':{}}])},{expected})"
   sql('SELECT '+combined(expected=39)+';','price_changed')
   check('(SELECT count(*) FROM bookings)=0','combined quote failure creates no booking')
   sql('SELECT '+combined(dining="'invalid'")+';','invalid_dining_request')
   check('(SELECT count(*) FROM bookings)=0','invalid dining request creates no booking')
   customer="'00000000-0000-0000-0000-000000000040'::uuid"
   check("("+combined(customer)+"->>'requests_recorded')::boolean",'combined booking acknowledges saved requests')
   check("(SELECT attendees->0->>'name' FROM bookings)='Fixture Guest'",'combined booking saves guest snapshot')
   check("(SELECT notes FROM bookings) LIKE '%food before the event.%arriving early.%'",'combined booking saves dining and early arrival')
   sql("UPDATE bookings SET notes='Original request';")
   check("("+combined(customer)+"->>'reason')='customer_conflict'",'combined retry reports existing booking')
   check("(SELECT notes FROM bookings)='Original request'",'combined retry does not alter existing notes')
   reset();sql("CREATE FUNCTION fixture_fail_request() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture_request_failure';END $$; CREATE TRIGGER fixture_fail_request BEFORE UPDATE OF notes ON bookings FOR EACH ROW EXECUTE FUNCTION fixture_fail_request();")
   sql('SELECT '+combined()+';','fixture_request_failure')
   check('(SELECT count(*) FROM bookings)=0','notes failure rolls back guest booking')
   check('(SELECT count(*) FROM booking_items)=0 AND (SELECT count(*) FROM booking_holds)=0','notes failure rolls back items and holds')
   for role in ['anon','authenticated']:
    check(f"NOT has_function_privilege('{role}','create_event_booking_with_attendees_and_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)','EXECUTE')",role+' blocked from combined mutation')
   check("has_function_privilege('service_role','create_event_booking_with_attendees_and_requests_v01(uuid,uuid,integer,text,text,integer,jsonb,text,boolean,jsonb,numeric)','EXECUTE')",'service role can use combined booking')
   for role in ['anon','authenticated']:
    check(f"NOT has_function_privilege('{role}','create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)','EXECUTE')",role+' blocked from new mutation')
   check("has_function_privilege('service_role','create_event_booking_v08(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)','EXECUTE')",'service role can book')
  finally:subprocess.run([str(PG/'pg_ctl'),'-D',str(cluster),'-m','immediate','-w','stop'],check=True,capture_output=True)
if __name__=='__main__':main()

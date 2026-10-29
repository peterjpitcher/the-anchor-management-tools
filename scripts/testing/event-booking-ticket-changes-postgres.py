#!/usr/bin/env python3
"""Run the event booking ticket changes migration in an isolated socket-only PostgreSQL database.

Builds on the event physical capacity fixture (tests/database/event-physical-capacity/setup.sql
plus 20260921074304, 20260910075719, 20261026135338, 20261027132851 and 20261027232730), so
create_event_booking_v09 is production's body as of 28 October 2026 (md5 checked). The fixture
is then given production's ticket-line machinery: the default-line sync, the deferred seat-sum
check, the guest-count guard, the guest-name sync, the real unit price and ticket-type capacity
functions (each md5 checked against production) and production-shaped payments and
event_ticket_transfers tables.

Against that it shows the defect a move to another night hit (a multi-type booking's lines
deleted and re-inserted in separate statements break the seat-sum check), runs the migration and
checks: guests are removed, added and moved between ticket types with seats, lines, guest rows and
the table kept together; money is never refunded, only written as a refund request capped at what
the booking holds; venue payments for added guests are recorded at full price; a move to another
night is one transaction that confirms the replacement with no hold, keeps ticket types and guest
details, moves the payments, cancels the original, refuses a dearer night with nothing changed,
and writes any overpayment as a refund request. Then grants, the migration's own assertion, and
the rollback (which refuses while refund decisions are waiting).
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
SUITE = ROOT / 'tests/database/event-physical-capacity'
CAPACITY = ROOT / 'supabase/migrations/20260921074304_event_physical_capacity.sql'
ATTENDEES_WRAPPER = ROOT / 'supabase/migrations/20260910075719_ticket_attendees_dining_requests.sql'
COMMUNAL_PAYMENT = ROOT / 'supabase/migrations/20261026135338_event_payment_confirm_communal_seats.sql'
COLLECT = ROOT / 'supabase/migrations/20261027132851_event_collect_guest_details.sql'
GUEST_PHONE = ROOT / 'supabase/migrations/20261027232730_event_guest_phone_and_details_to_follow.sql'
MIGRATION = ROOT / 'supabase/migrations/20261029090400_event_booking_ticket_changes.sql'
ROLLBACK = ROOT / 'tasks/event-booking-ticket-changes/rollback.sql'

V09 = 'public.create_event_booking_v09(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)'
NEW_FUNCTIONS = [
    'public.event_booking_net_paid_v01(uuid)',
    'public.event_booking_refundable_v01(uuid)',
    'public.remove_event_booking_guests_v01(uuid,uuid[],uuid,integer,uuid)',
    'public.event_booking_staff_guest_rows_v01(uuid,uuid,jsonb,uuid[])',
    'public.add_event_booking_guests_v01(uuid,uuid,integer,jsonb,text,text,numeric,uuid)',
    'public.change_event_booking_ticket_type_v01(uuid,uuid[],uuid,integer,uuid,text,text,numeric,uuid)',
    'public.transfer_event_booking_v01(uuid,uuid,jsonb,uuid)',
    'public.event_booking_line_groups_v01(jsonb,integer,numeric)',
    'public.event_booking_take_tickets_v01(uuid,jsonb)',
    'public.event_booking_put_tickets_v01(uuid,uuid,integer,numeric,numeric)',
    'public.record_manual_event_refund_v01(uuid,numeric,text,text,text,uuid,text,jsonb)',
]
# A pure SQL helper over its arguments: no table access, so it needs no SECURITY DEFINER.
PLAIN_FUNCTIONS = {'public.event_booking_line_groups_v01(jsonb,integer,numeric)'}
PRODUCTION_MD5 = {
    'public.create_event_booking_v09(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)': '79d436e4874cf6c6c261517a95b4f490',
    'public.check_booking_seat_sum(uuid)': 'ab223e5f7bbcc6c39810347440eb635a',
    'public.trg_check_booking_items_sum()': '826e59c11b7b29f742463d3c1d0e42c7',
    'public.sync_booking_default_item_v01(uuid)': 'f9bbd300f1758a817beb29bccd90ead7',
    'public.trg_sync_booking_default_item()': 'd306c768e200da535e1b3763a949445b',
    'public.guard_booking_attendee_count_v01()': 'b324bf3676016bdf35f701bcc3e94059',
    'public.sync_booking_attendee_names_v01()': 'a78a8ddd7fc7f3c5be306d20dc5afdd5',
    'public.event_ticket_type_unit_price(numeric,text,numeric)': '60d4c221f5cbf914ab8fabc6b59b09cc',
    'public.get_event_ticket_type_capacity_v01(uuid)': '3f0030fad90bb0fbdd80ef79abd2c026',
}
STAFF = '00000000-0000-4000-8000-0000000000aa'

# Production's bodies (prosrc read on 28 October 2026), installed exactly so their md5 matches.
PRODUCTION_PIECES = r"""
ALTER TABLE public.event_ticket_types ADD COLUMN name text, ADD COLUMN updated_at timestamptz DEFAULT now();
ALTER TABLE public.booking_items ADD COLUMN created_at timestamptz DEFAULT now(),
  ADD CONSTRAINT booking_items_booking_id_ticket_type_id_key UNIQUE (booking_id, ticket_type_id),
  ADD CONSTRAINT booking_items_quantity_check CHECK (quantity > 0);
ALTER TABLE public.bookings ADD COLUMN contact_email text;
UPDATE public.bookings SET attendees = '[]'::jsonb WHERE attendees IS NULL;
ALTER TABLE public.bookings ALTER COLUMN attendees SET DEFAULT '[]'::jsonb;

DROP TABLE public.payments;
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  table_booking_id uuid,
  charge_type text CHECK (charge_type = ANY (ARRAY['prepaid_event','seat_increase','refund','approved_fee','walkout','table_deposit'])),
  amount numeric CHECK (amount >= 0),
  currency text DEFAULT 'GBP',
  status text DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending','succeeded','failed','refunded','partially_refunded','void'])),
  metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(),
  refund_amount numeric,
  updated_at timestamptz DEFAULT now(),
  payment_provider text CHECK (payment_provider IS NULL OR payment_provider = ANY (ARRAY['paypal','manual','stripe'])),
  payment_method text CHECK (payment_method IS NULL OR payment_method = ANY (ARRAY['paypal','cash','card_terminal','comp','stripe'])),
  paypal_order_id text,
  paypal_capture_id text
);
CREATE TABLE public.event_ticket_transfers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  original_booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
  new_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  from_event_id uuid, to_event_id uuid,
  status text DEFAULT 'completed' CHECK (status = ANY (ARRAY['pending','completed','cancelled'])),
  requested_by text DEFAULT 'staff', approved_by uuid, metadata jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now(), completed_at timestamptz
);

CREATE OR REPLACE FUNCTION public.event_ticket_type_unit_price(p_base numeric, p_discount_type text, p_discount_value numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $f$
  select greatest(0, round(
    p_base - coalesce(
      case
        when p_discount_type = 'percent' then p_base * (coalesce(p_discount_value,0) / 100.0)
        when p_discount_type = 'fixed'   then coalesce(p_discount_value,0)
        else 0
      end, 0)
  , 2));
$f$;

CREATE FUNCTION public.check_booking_seat_sum(p_booking uuid) RETURNS void LANGUAGE plpgsql AS $f$
declare v_sum integer; v_seats integer; v_reminder boolean;
begin
  select seats, is_reminder_only into v_seats, v_reminder from public.bookings where id = p_booking;
  if v_seats is null then return; end if;
  if coalesce(v_reminder, false) then return; end if;
  select coalesce(sum(quantity), 0) into v_sum from public.booking_items where booking_id = p_booking;
  if v_sum <> v_seats then
    raise exception 'booking_items sum (%) != bookings.seats (%) for booking %', v_sum, v_seats, p_booking;
  end if;
end $f$;
CREATE FUNCTION public.trg_check_booking_items_sum() RETURNS trigger LANGUAGE plpgsql AS $f$
begin
  perform public.check_booking_seat_sum(coalesce(new.booking_id, old.booking_id));
  return null;
end $f$;
CREATE FUNCTION public.trg_check_bookings_sum() RETURNS trigger LANGUAGE plpgsql AS $f$
begin
  perform public.check_booking_seat_sum(new.id);
  return null;
end $f$;

CREATE FUNCTION public.sync_booking_default_item_v01(p_booking_id uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
declare
  v_event_id uuid; v_seats integer; v_reminder boolean;
  v_type_id uuid; v_base numeric; v_disc_type text; v_disc_val numeric; v_pmode text; v_deadline timestamptz;
  v_unit numeric(10,2); v_nondefault integer;
begin
  if coalesce(current_setting('ams.skip_default_item', true), '') = 'on' then
    return;
  end if;

  select event_id, seats, is_reminder_only
    into v_event_id, v_seats, v_reminder
  from public.bookings where id = p_booking_id;
  if not found then return; end if;

  if coalesce(v_reminder, false) or v_seats is null or v_seats < 1 then
    delete from public.booking_items where booking_id = p_booking_id;
    return;
  end if;

  select id into v_type_id
  from public.event_ticket_types
  where event_id = v_event_id and is_active
  order by sort_order, created_at
  limit 1;

  if v_type_id is null then
    select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0) into v_base
    from public.events where id = v_event_id;
    insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
    values (v_event_id, 'Standard', coalesce(v_base, 0), 0, true)
    returning id into v_type_id;
  end if;

  select count(*) into v_nondefault
  from public.booking_items
  where booking_id = p_booking_id and ticket_type_id <> v_type_id;
  if v_nondefault > 0 then return; end if;

  select t.base_price, e.online_discount_type, e.online_discount_value, e.payment_mode, e.online_discount_ends_at
    into v_base, v_disc_type, v_disc_val, v_pmode, v_deadline
  from public.events e join public.event_ticket_types t on t.id = v_type_id where e.id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' or v_deadline <= now() then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;
end $f$;
CREATE FUNCTION public.trg_sync_booking_default_item() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
begin
  perform public.sync_booking_default_item_v01(new.id);
  return null;
end $f$;

CREATE FUNCTION public.guard_booking_attendee_count_v01() RETURNS trigger LANGUAGE plpgsql AS $f$
BEGIN
 IF jsonb_array_length(OLD.attendees)>0 AND NEW.seats IS DISTINCT FROM OLD.seats
 AND jsonb_array_length(NEW.attendees) IS DISTINCT FROM NEW.seats THEN
   RAISE EXCEPTION 'attendee_count_mismatch';
 END IF;
 RETURN NEW;
END $f$;
CREATE FUNCTION public.sync_booking_attendee_names_v01() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
BEGIN
 IF NEW.attendees IS NOT DISTINCT FROM OLD.attendees THEN RETURN NEW; END IF;
 NEW.attendee_names := (SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a);
 UPDATE public.booking_items bi SET attendee_names=coalesce((SELECT array_agg(a->>'name') FROM jsonb_array_elements(NEW.attendees) a WHERE (a->>'ticket_type_id')::uuid=bi.ticket_type_id),'{}') WHERE bi.booking_id=NEW.id;
 RETURN NEW;
END $f$;

CREATE FUNCTION public.get_event_ticket_type_capacity_v01(p_event_id uuid)
RETURNS TABLE(ticket_type_id uuid, capacity_mode text, remaining integer) LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $f$
declare v_event_remaining integer;
begin
  select s.total_remaining into v_event_remaining
  from public.get_event_capacity_snapshot_v05(array[p_event_id]::uuid[]) s
  limit 1;
  v_event_remaining := greatest(0, coalesce(v_event_remaining, 0));

  return query
  select t.id,
         (case when t.capacity is null then 'shared' else 'dedicated' end)::text,
         (case
           when t.capacity is null then v_event_remaining
           else greatest(0, least(t.capacity - coalesce(used.q, 0), v_event_remaining))
         end)::integer
  from public.event_ticket_types t
  left join lateral (
    select coalesce(sum(bi.quantity), 0)::integer q
    from public.booking_items bi
    join public.bookings b on b.id = bi.booking_id
    where bi.ticket_type_id = t.id
      and public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) used on true
  where t.event_id = p_event_id and t.is_active
  order by t.sort_order;
end $f$;

CREATE CONSTRAINT TRIGGER booking_items_seat_sum AFTER INSERT OR DELETE OR UPDATE ON public.booking_items
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_booking_items_sum();
CREATE CONSTRAINT TRIGGER bookings_seat_sum AFTER INSERT OR UPDATE ON public.bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_check_bookings_sum();
CREATE TRIGGER booking_sync_default_item AFTER INSERT OR UPDATE OF seats, is_reminder_only ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION trg_sync_booking_default_item();
CREATE TRIGGER guard_booking_attendee_count BEFORE UPDATE OF seats, attendees ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION guard_booking_attendee_count_v01();
CREATE TRIGGER sync_booking_attendee_names BEFORE UPDATE OF attendees ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION sync_booking_attendee_names_v01();
"""


def main():
    with tempfile.TemporaryDirectory(prefix='ticket-changes-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        env = {**os.environ, 'PGHOST': str(socket), 'PGDATABASE': 'postgres'}
        base = [str(PG / 'psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def run_file(path, single=False):
            result = subprocess.run(base + (['-1'] if single else []) + ['-f', str(path)], text=True, capture_output=True, env=env)
            if result.returncode: raise RuntimeError(f'FAIL {path.name}\n{result.stderr[-4000:]}')

        def sql(value):
            result = subprocess.run(base, input=value, text=True, capture_output=True, env=env)
            if result.returncode: raise RuntimeError(result.stderr)
            return result.stdout.strip()

        def sql_error(value):
            result = subprocess.run(base, input=value, text=True, capture_output=True, env=env)
            return result.stderr if result.returncode else ''

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true': raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def call(statement):
            return json.loads(sql(statement))

        def expect(result, state, label, **fields):
            if result.get('state') != state or any(result.get(k) != v for k, v in fields.items()):
                raise RuntimeError(f'FAIL {label}: {result}')
            print('PASS ' + label)
            return result

        def jsonb(value): return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"

        def uuids(values): return "ARRAY[" + ','.join(f"'{v}'" for v in values) + "]::uuid[]" if values else 'NULL::uuid[]'

        def md5(signature):
            return sql(f"SELECT md5(prosrc) FROM pg_proc WHERE oid = '{signature}'::regprocedure;")

        counter = iter(range(1, 500))

        def ident(prefix):
            return f'{prefix}-0000-4000-8000-{next(counter):012d}'

        def event(payment_mode='prepaid', capacity=40, types=(('Adult', 45, None),), discount=5, questions=(), days_ahead=30):
            event_id = ident('e0000000')
            sql(f"INSERT INTO events(id,name,date,time,start_datetime,duration_minutes,capacity,booking_mode,payment_mode,price,price_per_seat,booking_open,event_status,booking_questions,online_discount_type,online_discount_value) "
                f"VALUES('{event_id}','Night {event_id[-3:]}',(now() + interval '{days_ahead} days')::date,'19:00',now() + interval '{days_ahead} days',180,{capacity},'general','{payment_mode}',45,45,true,'scheduled',{jsonb(list(questions))},"
                f"{'NULL' if not discount else repr('fixed')},{discount or 'NULL'});")
            ids = {}
            for order, (name, price, cap) in enumerate(types):
                type_id = ident('e1000000')
                sql(f"INSERT INTO event_ticket_types(id,event_id,name,base_price,capacity,is_active,sort_order,created_at) "
                    f"VALUES('{type_id}','{event_id}','{name}',{price},{'NULL' if cap is None else cap},true,{order},now() + interval '{order} seconds');")
                ids[name] = type_id
            return event_id, ids

        def guest(type_id, name, answers=None, phone=None):
            row = {'id': ident('e3000000'), 'name': name, 'ticket_type_id': type_id, 'answers': answers or {}}
            if phone: row['phone'] = phone
            return row

        def book(event_id, lines, guests=(), paid=None, customer=None):
            """lines: [(type_id, quantity)]. Books as staff, then pays (a PayPal capture) when paid is set."""
            seats = sum(q for _, q in lines)
            basket = [{'ticket_type_id': t, 'quantity': q} for t, q in lines]
            customer = customer or ident('e2000000')
            result = call(f"SELECT create_event_booking_v09('{event_id}','{customer}',{seats},'admin','seated',60,{jsonb(basket)},{jsonb(list(guests))},NULL);")
            if result.get('state') not in ('confirmed', 'pending_payment'): raise RuntimeError(f'booking failed: {result}')
            booking = result['booking_id']
            sql(f"UPDATE bookings SET status='confirmed', hold_expires_at=NULL WHERE id='{booking}';"
                f"UPDATE booking_holds SET status='consumed' WHERE event_booking_id='{booking}';")
            if paid:
                sql(f"INSERT INTO payments(event_booking_id,charge_type,payment_provider,payment_method,amount,status,paypal_capture_id) "
                    f"VALUES('{booking}','prepaid_event','paypal','paypal',{paid},'succeeded','CAP-{booking[-6:]}');")
            return booking, customer

        def seats(booking): return int(sql(f"SELECT seats FROM bookings WHERE id='{booking}';"))

        def lines(booking):
            rows = sql(f"SELECT coalesce(json_agg(json_build_object('t',ticket_type_id,'q',quantity,'p',unit_price) ORDER BY ticket_type_id),'[]') FROM booking_items WHERE booking_id='{booking}';")
            return {r['t']: (r['q'], float(r['p'])) for r in json.loads(rows)}

        def requests(booking):
            return json.loads(sql(f"SELECT coalesce(json_agg(json_build_object('kind',kind,'amount',amount,'status',status) ORDER BY created_at),'[]') FROM event_booking_refund_requests WHERE event_booking_id='{booking}';"))

        def refunds_written():
            return int(sql("SELECT count(*) FROM payments WHERE charge_type='refund';"))

        try:
            run_file(SUITE / 'setup.sql')
            for migration in (CAPACITY, ATTENDEES_WRAPPER, COMMUNAL_PAYMENT, COLLECT, GUEST_PHONE):
                run_file(migration, single=True)
            sql(PRODUCTION_PIECES)
            for signature, expected in PRODUCTION_MD5.items():
                check(f"'{md5(signature)}' = '{expected}'", f"baseline: {signature.split('(')[0].replace('public.', '')} is production's body")
            v09_before = md5(V09)

            # The defect a move to another night hit: deleting and re-inserting a multi-type
            # booking's lines in separate statements (copyTransferComposition) breaks the seat-sum
            # check at the first statement, so the booking kept its default line.
            defect_night, defect_types = event(types=(('Adult', 45, None), ('Child', 25, None)))
            defect, _ = book(defect_night, [(defect_types['Adult'], 1), (defect_types['Child'], 1)], paid=60)
            error = sql_error(f"DELETE FROM booking_items WHERE booking_id='{defect}';")
            if 'booking_items sum' not in error: raise RuntimeError(f'FAIL baseline defect not shown: {error!r}')
            print("PASS baseline defect: the old transfer's separate delete of ticket lines is refused by the seat-sum check")

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            check("to_regclass('public.event_booking_refund_requests') IS NULL AND to_regprocedure('public.transfer_event_booking_v01(uuid,uuid,jsonb,uuid)') IS NULL",
                  'a rolled-back run changes nothing')

            run_file(MIGRATION, single=True)
            for signature in NEW_FUNCTIONS:
                definer = 'NOT prosecdef' if signature in PLAIN_FUNCTIONS else 'prosecdef'
                check(f"NOT has_function_privilege('anon','{signature}','EXECUTE') AND NOT has_function_privilege('authenticated','{signature}','EXECUTE') "
                      f"AND has_function_privilege('service_role','{signature}','EXECUTE') "
                      f"AND (SELECT {definer} AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE oid = '{signature}'::regprocedure)",
                      f"{signature.split('(')[0].replace('public.', '')} is service_role only, search_path public"
                      + ('' if signature in PLAIN_FUNCTIONS else ', SECURITY DEFINER'))
            check("(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_booking_refund_requests'::regclass) "
                  "AND NOT has_table_privilege('anon','public.event_booking_refund_requests','SELECT') "
                  "AND NOT has_table_privilege('authenticated','public.event_booking_refund_requests','SELECT') "
                  "AND has_table_privilege('service_role','public.event_booking_refund_requests','UPDATE')",
                  'the refund request table has row security on and is service_role only')
            check(f"'{md5(V09)}' = '{v09_before}'", 'create_event_booking_v09 is untouched')

            # ---- Remove guests (BK-023) ----
            question = {'id': 'q-allergy', 'label': 'Allergies?', 'type': 'text', 'required': True}
            night, types = event(questions=[question])
            adult = types['Adult']
            g1, g2, g3 = guest(adult, 'Ann', {'q-allergy': 'None'}, '+447700900001'), guest(adult, 'Ben', {'q-allergy': 'Nuts'}), guest(adult, 'Cat')
            booking, _ = book(night, [(adult, 3)], [g1, g2, g3], paid=120)
            check(f"(SELECT unit_price = 40 FROM booking_items WHERE booking_id='{booking}')", 'fixture: a prepaid ticket booked by staff is priced at the online £40')
            sql(f"INSERT INTO table_bookings(id,customer_id,booking_date,party_size,committed_party_size,status,event_booking_id) "
                f"VALUES('{ident('e4000000')}',gen_random_uuid(),current_date,3,3,'confirmed','{booking}');")
            before_refunds = refunds_written()
            expect(call(f"SELECT remove_event_booking_guests_v01('{booking}',{uuids([g2['id']])},NULL,NULL,'{STAFF}');"),
                   'updated', 'remove: one named guest comes off a paid booking', old_seats=3, new_seats=2, removed=1, price_paid=40, refund_owed=40)
            check(f"(SELECT seats = 2 AND jsonb_array_length(attendees) = 2 AND attendees->0->>'id' = '{g1['id']}' AND attendees->1->>'id' = '{g3['id']}' "
                  f"AND attendee_names = ARRAY['Ann','Cat'] FROM bookings WHERE id='{booking}')", 'remove: the other guests keep their rows and order')
            check(f"(SELECT quantity = 2 AND attendee_names = ARRAY['Ann','Cat'] FROM booking_items WHERE booking_id='{booking}')", 'remove: the ticket line drops with its names')
            check(f"(SELECT party_size = 2 AND committed_party_size = 2 FROM table_bookings WHERE event_booking_id='{booking}')", 'remove: the table follows the party size')
            if requests(booking) != [{'kind': 'guest_removed', 'amount': 40.00, 'status': 'open'}]: raise RuntimeError(f'FAIL remove request: {requests(booking)}')
            print('PASS remove: a refund request for the £40 paid waits for a manager')
            if refunds_written() != before_refunds: raise RuntimeError('FAIL remove wrote a refund')
            print('PASS remove: no money moves and no refund row is written')
            check(f"(SELECT event_booking_refundable_v01('{booking}') = 80 AND event_booking_net_paid_v01('{booking}') = 120)",
                  'remove: what is still free to owe is the payment less the open request')
            expect(call(f"SELECT remove_event_booking_guests_v01('{booking}',{uuids([g1['id'], g3['id']])},NULL,NULL,'{STAFF}');"),
                   'blocked', 'remove: taking every guest off is refused (cancel instead)', reason='would_remove_every_guest')
            expect(call(f"SELECT remove_event_booking_guests_v01('{booking}',{uuids([g2['id']])},NULL,NULL,'{STAFF}');"),
                   'blocked', 'remove: a guest no longer on the booking is refused', reason='guest_not_on_booking')
            expect(call(f"SELECT remove_event_booking_guests_v01('{booking}',NULL,NULL,1,'{STAFF}');"),
                   'blocked', 'remove: a named booking must say which guest', reason='choose_guests')
            check(f"(SELECT seats = 2 FROM bookings WHERE id='{booking}')", 'remove: refusals change nothing')

            partly, _ = book(night, [(adult, 3)], [guest(adult, 'D'), guest(adult, 'E'), guest(adult, 'F')], paid=120)
            sql(f"INSERT INTO payments(event_booking_id,charge_type,payment_provider,payment_method,amount,status) VALUES('{partly}','refund','paypal','paypal',100,'refunded');")
            first = sql(f"SELECT attendees->0->>'id' FROM bookings WHERE id='{partly}';")
            expect(call(f"SELECT remove_event_booking_guests_v01('{partly}',ARRAY['{first}']::uuid[],NULL,NULL,'{STAFF}');"),
                   'updated', 'remove: after a £100 refund only the £20 left can be owed', refund_owed=20)

            free_night, free_types = event(payment_mode='free', discount=0)
            free_booking, _ = book(free_night, [(free_types['Adult'], 4)])
            expect(call(f"SELECT remove_event_booking_guests_v01('{free_booking}',NULL,NULL,1,'{STAFF}');"),
                   'updated', 'remove: a booking without guest rows drops a number of tickets', new_seats=3, refund_owed=0, refund_request_id=None)
            check(f"(SELECT quantity = 3 FROM booking_items WHERE booking_id='{free_booking}') AND NOT EXISTS (SELECT 1 FROM event_booking_refund_requests WHERE event_booking_id='{free_booking}')",
                  'remove: nothing paid, so no refund request')

            expect(call(f"SELECT remove_event_booking_guests_v01('{defect}',NULL,'{defect_types['Child']}',1,'{STAFF}');"),
                   'updated', 'remove: the only ticket of one type comes off a two-type booking', new_seats=1, price_paid=20, refund_owed=20)
            got = lines(defect)
            if got != {defect_types['Adult']: (1, 40.0)}: raise RuntimeError(f'FAIL emptied line: {got}')
            print('PASS remove: the emptied ticket line is deleted, the other kept')

            past_night, past_types = event(days_ahead=3)
            past, _ = book(past_night, [(past_types['Adult'], 2)], paid=80)
            sql(f"UPDATE events SET start_datetime = now() - interval '1 hour' WHERE id='{past_night}';")
            expect(call(f"SELECT remove_event_booking_guests_v01('{past}',NULL,NULL,1,'{STAFF}');"),
                   'blocked', 'remove: refused once the event has started', reason='event_started')

            # ---- Add guests (BK-023) ----
            small, small_types = event(capacity=5, questions=[question])
            s_adult = small_types['Adult']
            add_booking, _ = book(small, [(s_adult, 3)], [guest(s_adult, 'G'), guest(s_adult, 'H'), guest(s_adult, 'I')], paid=120)
            newcomer = guest(None, 'Jo', {'q-allergy': ''}, '+447700900099')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,{jsonb([newcomer])},'none',NULL,NULL,'{STAFF}');"),
                   'blocked', 'add: a paid event needs the new ticket paid or given free', reason='settlement_required')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,{jsonb([newcomer])},'cash',NULL,40,'{STAFF}');"),
                   'blocked', 'add: the venue charges full price, so £40 confirmed is refused', reason='amount_changed', amount=45)
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,{jsonb([newcomer])},'comp','  ',NULL,'{STAFF}');"),
                   'blocked', 'add: a free ticket needs a reason', reason='comp_reason_required')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,{jsonb([newcomer])},'cash',NULL,45,'{STAFF}');"),
                   'updated', 'add: one guest paid £45 in cash joins the booking', old_seats=3, new_seats=4, amount=45)
            check(f"(SELECT seats = 4 AND jsonb_array_length(attendees) = 4 AND attendees->3->>'name' = 'Jo' AND attendees->3->>'phone' = '+447700900099' "
                  f"AND attendees->3->>'ticket_type_id' = '{s_adult}' AND attendees->3->'answers'->0->>'question_id' = 'q-allergy' "
                  f"AND attendees->3->'answers'->0->>'value' = '' FROM bookings WHERE id='{add_booking}')",
                  'add: the guest row has the name, phone, ticket type and the question, its answer to follow')
            check(f"(SELECT quantity = 4 AND unit_price = 40 FROM booking_items WHERE booking_id='{add_booking}')", 'add: the ticket line grows, its price paid unchanged')
            check(f"(SELECT count(*) = 1 FROM payments WHERE event_booking_id='{add_booking}' AND charge_type='seat_increase' AND payment_provider='manual' "
                  f"AND payment_method='cash' AND amount=45 AND status='succeeded' AND metadata->>'recorded_by' = '{STAFF}')", 'add: the £45 is recorded as a manual seat_increase payment')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',2,{jsonb([guest(None, 'K'), guest(None, 'L')])},'comp','Birthday',NULL,'{STAFF}');"),
                   'blocked', 'add: two more than a 5-seat event holds are refused', reason='insufficient_capacity')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,{jsonb([guest(None, 'K')])},'comp','Birthday',NULL,'{STAFF}');"),
                   'updated', 'add: a free ticket with a reason is recorded at £0', amount=0, new_seats=5)
            check(f"(SELECT count(*) = 1 FROM payments WHERE event_booking_id='{add_booking}' AND payment_method='comp' AND amount=0 AND metadata->>'note' = 'Birthday')",
                  'add: the free ticket keeps its reason')
            expect(call(f"SELECT add_event_booking_guests_v01('{add_booking}','{s_adult}',1,'[]'::jsonb,'cash',NULL,45,'{STAFF}');"),
                   'blocked', 'add: a booking with guest rows needs a row for each new ticket', reason='guest_details_needed')
            expect(call(f"SELECT add_event_booking_guests_v01('{free_booking}','{free_types['Adult']}',1,{jsonb([guest(None, 'M')])},'none',NULL,NULL,'{STAFF}');"),
                   'blocked', 'add: guest rows cannot be added to a booking that has none', reason='booking_has_no_guest_rows')
            expect(call(f"SELECT add_event_booking_guests_v01('{free_booking}','{free_types['Adult']}',2,'[]'::jsonb,'none',NULL,NULL,'{STAFF}');"),
                   'updated', 'add: a free event adds tickets with no payment', new_seats=5, payment_id=None)
            expect(call(f"SELECT add_event_booking_guests_v01('{free_booking}','{free_types['Adult']}',1,'[]'::jsonb,'cash',NULL,45,'{STAFF}');"),
                   'blocked', 'add: no money is taken here for a free or pay-at-the-door event', reason='no_payment_taken_here')
            named_free, _ = book(free_night, [(free_types['Adult'], 1)], [guest(free_types['Adult'], 'N')])
            error = sql_error(f"SELECT add_event_booking_guests_v01('{named_free}','{free_types['Adult']}',1,{jsonb([guest(None, 'O', phone='07700900123')])},'none',NULL,NULL,'{STAFF}');")
            if 'invalid_attendee_phone' not in error: raise RuntimeError(f'FAIL add accepted a malformed phone: {error!r}')
            print('PASS add: a phone that is not E.164 is refused')
            limited, limited_types = event(types=(('Adult', 45, None), ('VIP', 60, 1)))
            lim_booking, _ = book(limited, [(limited_types['VIP'], 1)], paid=55)
            expect(call(f"SELECT add_event_booking_guests_v01('{lim_booking}','{limited_types['VIP']}',1,'[]'::jsonb,'cash',NULL,60,'{STAFF}');"),
                   'blocked', 'add: a ticket type with its own limit is refused when sold out', reason='ticket_type_sold_out')

            # ---- What each guest paid (review finding 1 on PR 277) ----
            paid_night, paid_types = event(questions=[question])
            p_adult = paid_types['Adult']
            line_booking, _ = book(paid_night, [(p_adult, 2)], [guest(p_adult, 'Uma'), guest(p_adult, 'Vic')], paid=80)
            cash_guest, free_guest = guest(None, 'Wyn'), guest(None, 'Xan')
            expect(call(f"SELECT add_event_booking_guests_v01('{line_booking}','{p_adult}',1,{jsonb([cash_guest])},'cash',NULL,45,'{STAFF}');"),
                   'updated', 'price paid: a £45 cash guest joins a line sold at £40', amount=45)
            expect(call(f"SELECT add_event_booking_guests_v01('{line_booking}','{p_adult}',1,{jsonb([free_guest])},'comp','Birthday',NULL,'{STAFF}');"),
                   'updated', 'price paid: a free guest joins the same line', amount=0)
            check(f"(SELECT quantity = 4 AND unit_price = 40 AND price_paid_groups = {jsonb([{'unit_price': 40, 'quantity': 2}, {'unit_price': 45, 'quantity': 1}, {'unit_price': 0, 'quantity': 1}])} "
                  f"FROM booking_items WHERE booking_id='{line_booking}')", 'price paid: the line keeps a group for each price paid')
            check(f"(SELECT (attendees->2->>'price_paid')::numeric = 45 AND (attendees->3->>'price_paid')::numeric = 0 AND NOT (attendees->0 ? 'price_paid') FROM bookings WHERE id='{line_booking}')",
                  'price paid: each added guest carries what they paid')
            expect(call(f"SELECT remove_event_booking_guests_v01('{line_booking}',{uuids([free_guest['id']])},NULL,NULL,'{STAFF}');"),
                   'updated', 'price paid: taking the free guest off owes £0', price_paid=0, refund_owed=0, refund_request_id=None)
            check(f"NOT EXISTS (SELECT 1 FROM event_booking_refund_requests WHERE event_booking_id='{line_booking}')",
                  "price paid: no refund request against the other guests' money")
            expect(call(f"SELECT remove_event_booking_guests_v01('{line_booking}',{uuids([cash_guest['id']])},NULL,NULL,'{STAFF}');"),
                   'updated', 'price paid: taking the £45 cash guest off raises £45, not the line price', price_paid=45, refund_owed=45)
            check(f"(SELECT quantity = 2 AND price_paid_groups IS NULL FROM booking_items WHERE booking_id='{line_booking}')",
                  'price paid: with only £40 tickets left the line is back to one price')
            original_guest = sql(f"SELECT attendees->0->>'id' FROM bookings WHERE id='{line_booking}';")
            expect(call(f"SELECT remove_event_booking_guests_v01('{line_booking}',{uuids([original_guest])},NULL,NULL,'{STAFF}');"),
                   'updated', 'price paid: an original guest still comes off at £40', price_paid=40)

            plain, _ = book(paid_night, [(p_adult, 2)], paid=80)
            expect(call(f"SELECT add_event_booking_guests_v01('{plain}','{p_adult}',1,'[]'::jsonb,'cash',NULL,45,'{STAFF}');"),
                   'updated', 'price paid: a £45 cash ticket added to a booking without guest rows')
            expect(call(f"SELECT remove_event_booking_guests_v01('{plain}',NULL,'{p_adult}',1,'{STAFF}');"),
                   'updated', 'price paid: without guest rows the ticket added last comes off first, at £45', price_paid=45, refund_owed=45)

            typed, typed_types = event(types=(('Adult', 45, None), ('Child', 25, None)))
            t_free = guest(None, 'Yas')
            typed_booking, _ = book(typed, [(typed_types['Adult'], 1)], [guest(typed_types['Adult'], 'Zed')], paid=40)
            expect(call(f"SELECT add_event_booking_guests_v01('{typed_booking}','{typed_types['Adult']}',1,{jsonb([t_free])},'comp','Staff family',NULL,'{STAFF}');"),
                   'updated', 'price paid: a free adult guest added')
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{typed_booking}',{uuids([t_free['id']])},NULL,NULL,'{typed_types['Child']}','comp','Still free',NULL,'{STAFF}');"),
                   'updated', 'price paid: the free guest changed to a child ticket starts from £0, so the child price is owed', price_paid=0, difference=20)
            check(f"(SELECT (attendees->1->>'price_paid')::numeric = 0 FROM bookings WHERE id='{typed_booking}') "
                  f"AND (SELECT price_paid_groups = {jsonb([{'unit_price': 0, 'quantity': 1}])} FROM booking_items WHERE booking_id='{typed_booking}' AND ticket_type_id='{typed_types['Child']}')",
                  'price paid: given free, the guest and the new line still carry £0 paid')
            expect(call(f"SELECT remove_event_booking_guests_v01('{typed_booking}',{uuids([t_free['id']])},NULL,NULL,'{STAFF}');"),
                   'updated', 'price paid: and taking them off owes nothing', refund_owed=0)
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{typed_booking}',{uuids([t_free['id']])},NULL,NULL,'{typed_types['Child']}','none',NULL,NULL,'{STAFF}');"),
                   'blocked', 'price paid: a refused change after taking tickets off is undone', reason='guest_not_on_booking')
            typed_two, _ = book(typed, [(typed_types['Adult'], 2)], [guest(typed_types['Adult'], 'A1'), guest(typed_types['Adult'], 'A2')], paid=80)
            first_adult = sql(f"SELECT attendees->0->>'id' FROM bookings WHERE id='{typed_two}';")
            before_lines = lines(typed_two)
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{typed_two}',ARRAY['{first_adult}']::uuid[],NULL,NULL,'{typed_types['Child']}','cash',NULL,NULL,'{STAFF}');"),
                   'blocked', 'price paid: cash on a cheaper type is refused', reason='no_payment_taken_here')
            if lines(typed_two) != before_lines: raise RuntimeError('FAIL a refused change left the lines changed')
            print('PASS price paid: and the refusal leaves the ticket lines exactly as they were')

            # ---- Bar refunds in one transaction (review finding 2 on PR 277) ----
            bar_night, bar_types = event()
            bar_booking, _ = book(bar_night, [(bar_types['Adult'], 1)])
            sql(f"INSERT INTO payments(event_booking_id,charge_type,payment_provider,payment_method,amount,status) VALUES('{bar_booking}','prepaid_event','manual','cash',45,'succeeded');")
            refund_call = lambda key, amount=45: f"SELECT record_manual_event_refund_v01('{bar_booking}',{amount},'cash','staff_manual_refund','{key}','{STAFF}','Handed back','{{}}'::jsonb);"
            def refund(key):
                result = call(refund_call(key))
                return {**result, 'state': result.get('status')}
            expect(refund('key-1'), 'succeeded', 'bar refund: £45 cash handed back is recorded', amount=45)
            expect(refund('key-1'), 'succeeded', 'bar refund: the same key again replays it', amount=45, reason='idempotent_replay')
            check(f"(SELECT count(*) = 1 AND sum(amount) = 45 FROM payments WHERE event_booking_id='{bar_booking}' AND charge_type='refund')",
                  'bar refund: one refund row for one key')
            check(f"(SELECT status = 'refunded' FROM payments WHERE event_booking_id='{bar_booking}' AND charge_type='prepaid_event')",
                  'bar refund: the bar payment reads refunded')
            expect(refund('key-2'), 'manual_required', 'bar refund: nothing left, so a second key records nothing', reason='no_bar_payment_to_refund')
            error = sql_error(f"INSERT INTO payments(event_booking_id,charge_type,payment_provider,payment_method,amount,status,metadata) "
                              f"SELECT '{bar_booking}','refund','manual','cash',1,'refunded',metadata FROM payments WHERE event_booking_id='{bar_booking}' AND charge_type='refund';")
            if 'payments_manual_refund_claim_unique' not in error: raise RuntimeError(f'FAIL the claim index let a second row through: {error!r}')
            print('PASS bar refund: the unique claim index refuses a second row for the same key and payment, whatever writes it')

            race_night, race_types = event()
            race_booking, _ = book(race_night, [(race_types['Adult'], 1)])
            sql(f"INSERT INTO payments(event_booking_id,charge_type,payment_provider,payment_method,amount,status) VALUES('{race_booking}','prepaid_event','manual','card_terminal',45,'succeeded');")
            slow = subprocess.Popen(base, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=env)
            slow.stdin.write(f"BEGIN; SELECT record_manual_event_refund_v01('{race_booking}',45,'card_terminal','staff_manual_refund','race-a','{STAFF}',NULL,'{{}}'::jsonb); SELECT pg_sleep(1.5); COMMIT;\n")
            slow.stdin.close()
            subprocess.run([str(PG / 'psql'), '-X', '-q', '-t', '-A', '-c', 'SELECT pg_sleep(0.4);'], env=env, check=True, capture_output=True)
            racing = call(f"SELECT record_manual_event_refund_v01('{race_booking}',45,'card_terminal','staff_manual_refund','race-b','{STAFF}',NULL,'{{}}'::jsonb);")
            slow.wait(timeout=30)
            if slow.returncode: raise RuntimeError(f'FAIL the first racing refund failed: {slow.stderr.read()}')
            if racing.get('status') != 'manual_required': raise RuntimeError(f'FAIL the second racing refund recorded money: {racing}')
            check(f"(SELECT sum(amount) = 45 FROM payments WHERE event_booking_id='{race_booking}' AND charge_type='refund')",
                  'bar refund: two refunds at the same moment never record more than the £45 paid')

            # ---- Change ticket type (BK-023) ----
            family, family_types = event(types=(('Adult', 45, None), ('Child', 25, None)))
            f_adult, f_child = family_types['Adult'], family_types['Child']
            p1, p2 = guest(f_adult, 'P'), guest(f_adult, 'Q')
            change, _ = book(family, [(f_adult, 2)], [p1, p2], paid=80)
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{change}',{uuids([p1['id']])},NULL,NULL,'{f_child}','none',NULL,NULL,'{STAFF}');"),
                   'updated', 'change: an adult becomes a child ticket', changed=1, price_paid=40, new_price=20, difference=-20, refund_owed=20)
            got = lines(change)
            if got != {f_adult: (1, 40.0), f_child: (1, 20.0)}: raise RuntimeError(f'FAIL change lines: {got}')
            print('PASS change: one adult line at £40 and one child line at the online £20')
            check(f"(SELECT attendees->0->>'ticket_type_id' = '{f_child}' AND attendees->1->>'ticket_type_id' = '{f_adult}' FROM bookings WHERE id='{change}')",
                  'change: the guest carries the new ticket type')
            if requests(change) != [{'kind': 'ticket_type_changed', 'amount': 20.00, 'status': 'open'}]: raise RuntimeError(f'FAIL change request: {requests(change)}')
            print('PASS change: the £20 difference waits for a manager as a refund request')
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{change}',{uuids([p1['id']])},NULL,NULL,'{f_adult}','none',NULL,NULL,'{STAFF}');"),
                   'blocked', 'change: a dearer ticket must be paid or given free', reason='settlement_required', amount=20)
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{change}',{uuids([p1['id']])},NULL,NULL,'{f_adult}','card_terminal',NULL,20,'{STAFF}');"),
                   'updated', 'change: back to adult with £20 taken by card', difference=20, amount=20)
            check(f"(SELECT count(*) = 1 FROM payments WHERE event_booking_id='{change}' AND charge_type='seat_increase' AND payment_method='card_terminal' AND amount=20)",
                  'change: the £20 is recorded as a manual seat_increase payment')
            expect(call(f"SELECT change_event_booking_ticket_type_v01('{change}',{uuids([p1['id']])},NULL,NULL,'{f_adult}','none',NULL,NULL,'{STAFF}');"),
                   'blocked', 'change: to the type it already is is refused', reason='same_ticket_type')
            check(f"(SELECT seats = 2 FROM bookings WHERE id='{change}')", 'change: the seat count never moves')

            # ---- Move to another night (BK-028) ----
            source, source_types = event(types=(('Adult', 45, None), ('Child', 25, None)))
            target_q = {'id': 'q-meal', 'label': 'Meal?', 'type': 'yes_no', 'required': True}
            target, target_types = event(types=(('Child', 25, None), ('Adult', 45, None)), questions=[target_q], days_ahead=40)
            m1 = guest(source_types['Adult'], 'Rae', phone='+447700900111')
            m2 = guest(source_types['Child'], 'Sid')
            moving, customer = book(source, [(source_types['Adult'], 1), (source_types['Child'], 1)], [m1, m2], paid=60)
            before = sql("SELECT count(*) FROM bookings;")
            expect(call(f"SELECT transfer_event_booking_v01('{moving}','{target}',{jsonb({m1['id']: {'q-meal': 'maybe'}})},'{STAFF}');"),
                   'blocked', 'move: an answer the new night cannot take is refused', reason='invalid_attendee_answer')
            check(f"(SELECT status = 'confirmed' FROM bookings WHERE id='{moving}') AND (SELECT count(*) FROM bookings) = {before}", 'move: a refused move changes nothing')
            moved = expect(call(f"SELECT transfer_event_booking_v01('{moving}','{target}',{jsonb({m1['id']: {'q-meal': 'yes', 'q-other': 'x'}})},'{STAFF}');"),
                           'transferred', 'move: a two-type named booking moves to another night', paid_total=60, target_amount=60, overpayment=0, answers_to_follow=1)
            new = moved['new_booking_id']
            check(f"(SELECT status = 'confirmed' AND hold_expires_at IS NULL AND customer_id = '{customer}' AND source = 'admin' FROM bookings WHERE id='{new}')",
                  'move: the replacement is confirmed at once, with no payment hold')
            check(f"NOT EXISTS (SELECT 1 FROM booking_holds WHERE event_booking_id='{new}' AND status='active')", 'move: no payment hold is left running')
            got = lines(new)
            if got != {target_types['Adult']: (1, 40.0), target_types['Child']: (1, 20.0)}: raise RuntimeError(f'FAIL move lines: {got}')
            print("PASS move: the ticket types travel by name, at the new night's prices")
            check(f"(SELECT attendees->0->>'name' = 'Rae' AND attendees->0->>'phone' = '+447700900111' AND attendees->0->>'ticket_type_id' = '{target_types['Adult']}' "
                  f"AND attendees->0->'answers'->0->>'value' = 'yes' AND attendees->1->>'name' = 'Sid' AND attendees->1->>'ticket_type_id' = '{target_types['Child']}' "
                  f"AND attendees->1->'answers'->0->>'value' = '' AND jsonb_array_length(attendees->0->'answers') = 1 FROM bookings WHERE id='{new}')",
                  "move: guests keep names and phones, answer the new night's questions, and one required answer follows")
            check(f"(SELECT count(*) = 1 FROM payments WHERE event_booking_id='{new}' AND charge_type='prepaid_event') "
                  f"AND NOT EXISTS (SELECT 1 FROM payments WHERE event_booking_id='{moving}')", 'move: the payment moves to the replacement')
            check(f"(SELECT status = 'cancelled' AND cancelled_by = 'admin_transfer' FROM bookings WHERE id='{moving}')", 'move: the original is cancelled')
            check(f"(SELECT count(*) = 1 FROM event_ticket_transfers WHERE original_booking_id='{moving}' AND new_booking_id='{new}' AND status='completed' AND approved_by='{STAFF}')",
                  'move: the move is recorded')
            check(f"NOT EXISTS (SELECT 1 FROM event_booking_refund_requests WHERE event_booking_id IN ('{moving}','{new}'))", 'move: an equal price owes nothing')
            expect(call(f"SELECT transfer_event_booking_v01('{moving}','{target}','{{}}'::jsonb,'{STAFF}');"),
                   'blocked', 'move: the cancelled original cannot move again', reason='booking_not_confirmed')

            cheap, cheap_types = event(types=(('Adult', 30, None),), discount=0, days_ahead=50)
            cheaper, _ = book(source, [(source_types['Adult'], 2)], paid=80)
            sql(f"INSERT INTO event_booking_refund_requests(event_booking_id,kind,amount) VALUES('{cheaper}','guest_removed',10);")
            moved = expect(call(f"SELECT transfer_event_booking_v01('{cheaper}','{cheap}','{{}}'::jsonb,'{STAFF}');"),
                           'transferred', 'move: to a cheaper night', target_amount=60, overpayment=10)
            got = requests(moved['new_booking_id'])
            if got != [{'kind': 'guest_removed', 'amount': 10.00, 'status': 'open'}, {'kind': 'transfer_overpayment', 'amount': 10.00, 'status': 'open'}]:
                raise RuntimeError(f'FAIL move requests: {got}')
            print('PASS move: the open request travels, and the overpayment net of it waits for a manager')
            got = lines(moved['new_booking_id'])
            if got != {cheap_types['Adult']: (2, 30.0)}: raise RuntimeError(f'FAIL cheap lines: {got}')
            print("PASS move: no matching type name falls back to the new night's first ticket type")

            dear, dear_types = event(types=(('Adult', 60, None),), discount=0, days_ahead=60)
            costly, _ = book(source, [(source_types['Adult'], 1)], paid=40)
            before = sql("SELECT count(*) FROM bookings;")
            expect(call(f"SELECT transfer_event_booking_v01('{costly}','{dear}','{{}}'::jsonb,'{STAFF}');"),
                   'blocked', 'move: a dearer night is refused', reason='target_event_costs_more')
            check(f"(SELECT status = 'confirmed' FROM bookings WHERE id='{costly}') AND (SELECT count(*) FROM bookings) = {before} "
                  f"AND (SELECT count(*) = 1 FROM payments WHERE event_booking_id='{costly}') AND NOT EXISTS (SELECT 1 FROM event_ticket_transfers WHERE original_booking_id='{costly}')",
                  'move: the refusal leaves the booking, its payment and the new night untouched')

            free_target, _ = event(payment_mode='free', discount=0, days_ahead=70)
            to_free, _ = book(source, [(source_types['Adult'], 1)], paid=40)
            moved = expect(call(f"SELECT transfer_event_booking_v01('{to_free}','{free_target}','{{}}'::jsonb,'{STAFF}');"),
                           'transferred', 'move: to a free night', overpayment=40)
            expect(call(f"SELECT transfer_event_booking_v01('{moved['new_booking_id']}','{free_target}','{{}}'::jsonb,'{STAFF}');"),
                   'blocked', 'move: to the night it is already on is refused', reason='same_event')

            # ---- Names only in attendee_names (review finding 3 on PR 277) ----
            legacy, _ = book(source, [(source_types['Adult'], 2)], paid=80)
            sql(f"UPDATE bookings SET attendee_names = ARRAY['Old One','Old Two'] WHERE id='{legacy}';"
                f"UPDATE booking_items SET attendee_names = ARRAY['Old One','Old Two'] WHERE booking_id='{legacy}';")
            legacy_target, legacy_types = event(types=(('Adult', 45, None),), days_ahead=80)
            moved = expect(call(f"SELECT transfer_event_booking_v01('{legacy}','{legacy_target}','{{}}'::jsonb,'{STAFF}');"),
                           'transferred', 'move: a booking with names only in attendee_names moves')
            check(f"(SELECT attendee_names = ARRAY['Old One','Old Two'] AND attendees = '[]'::jsonb FROM bookings WHERE id='{moved['new_booking_id']}') "
                  f"AND (SELECT attendee_names = ARRAY['Old One','Old Two'] FROM booking_items WHERE booking_id='{moved['new_booking_id']}')",
                  'move: the names travel on the booking and on its ticket line')

            # ---- The migration's own assertion ----
            assertion = MIGRATION.read_text().split('-- Prove it:', 1)[1].split('\n', 1)[1]
            error = sql_error(f"BEGIN; GRANT EXECUTE ON FUNCTION public.transfer_event_booking_v01(uuid,uuid,jsonb,uuid) TO authenticated;\n" + assertion + '\nROLLBACK;')
            if 'executable by anon or authenticated' not in error: raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted function')
            error = sql_error(f"BEGIN; GRANT SELECT ON public.event_booking_refund_requests TO anon;\n" + assertion + '\nROLLBACK;')
            if 'readable by anon or authenticated' not in error: raise RuntimeError(f'FAIL the assertion did not catch a table grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted table')

            # ---- Rollback ----
            error = sql_error(ROLLBACK.read_text())
            if 'holds refund decisions' not in error: raise RuntimeError(f'FAIL the rollback did not refuse: {error!r}')
            check("to_regclass('public.event_booking_refund_requests') IS NOT NULL", 'the rollback refuses while refund decisions are waiting, and drops nothing')
            sql('DELETE FROM public.event_booking_refund_requests;')
            error = sql_error(ROLLBACK.read_text())
            if 'price_paid_groups holds prices paid' not in error: raise RuntimeError(f'FAIL the rollback did not refuse over prices paid: {error!r}')
            print('PASS the rollback also refuses while prices paid are recorded')
            sql('UPDATE public.booking_items SET price_paid_groups = NULL;')
            run_file(ROLLBACK, single=True)
            check("to_regclass('public.event_booking_refund_requests') IS NULL AND to_regclass('public.payments_manual_refund_claim_unique') IS NULL "
                  "AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'booking_items' AND column_name = 'price_paid_groups') AND "
                  + ' AND '.join(f"to_regprocedure('{s}') IS NULL" for s in NEW_FUNCTIONS), 'the rollback drops the table, the column, the index and every new function')
            check(f"'{md5(V09)}' = '{v09_before}'", 'after the rollback create_event_booking_v09 is exactly as before')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()

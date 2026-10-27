#!/usr/bin/env python3
"""Run the event-booking-no-show migration in an isolated socket-only PostgreSQL database.

The bookings and event_check_ins tables carry production's two check constraints exactly as
production prints them (read 26 October 2026), and is_active_event_booking_for_capacity_v01 is
production's body. Against that baseline it shows the defect: an event booking cannot be marked as a
no-show, and a check-in cannot be ticked from the staff list. A rolled-back run changes nothing.
Then the migration runs: 'no_show' and 'staff_list' are accepted, every old value still is, an
unknown value is still refused, and a no-show booking holds no seats. The rollback refuses while a
row uses a new value, and once none does it restores both constraints exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133352_event_booking_no_show.sql'
ROLLBACK = ROOT / 'tasks/event-booking-no-show/rollback.sql'

PRODUCTION_STATUS_CHECK = ("CHECK ((status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text, 'cancelled'::text, "
                           "'expired'::text, 'visited_waiting_for_review'::text, 'review_clicked'::text, 'completed'::text])))")
PRODUCTION_METHOD_CHECK = ("CHECK (((check_in_method)::text = ANY (ARRAY[('qr'::character varying)::text, "
                           "('manual'::character varying)::text, ('auto'::character varying)::text])))")
OLD_STATUSES = ['pending_payment', 'confirmed', 'cancelled', 'expired', 'visited_waiting_for_review',
                'review_clicked', 'completed']

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text);
CREATE TABLE public.customers (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id),
  customer_id uuid REFERENCES public.customers(id),
  seats integer,
  status text DEFAULT 'confirmed',
  hold_expires_at timestamptz,
  CONSTRAINT bookings_status_check CHECK ((status = ANY (ARRAY['pending_payment'::text, 'confirmed'::text, 'cancelled'::text, 'expired'::text, 'visited_waiting_for_review'::text, 'review_clicked'::text, 'completed'::text])))
);
CREATE TABLE public.event_check_ins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid REFERENCES public.events(id),
  customer_id uuid REFERENCES public.customers(id),
  booking_id uuid REFERENCES public.bookings(id),
  check_in_method character varying(50) DEFAULT 'qr'::character varying,
  CONSTRAINT event_check_ins_check_in_method_check CHECK (((check_in_method)::text = ANY (ARRAY[('qr'::character varying)::text, ('manual'::character varying)::text, ('auto'::character varying)::text]))),
  CONSTRAINT event_check_ins_event_id_customer_id_key UNIQUE (event_id, customer_id)
);
-- Production's body, read 26 October 2026.
CREATE FUNCTION public.is_active_event_booking_for_capacity_v01(p_status text, p_hold_expires_at timestamp with time zone)
 RETURNS boolean LANGUAGE sql STABLE SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
  SELECT
    p_status = 'confirmed'
    OR (
      p_status = 'pending_payment'
      AND (p_hold_expires_at IS NULL OR p_hold_expires_at > now())
    );
$function$;
INSERT INTO public.events (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Quiz night');
INSERT INTO public.customers (id) VALUES ('00000000-0000-0000-0000-0000000000c1'), ('00000000-0000-0000-0000-0000000000c2');
INSERT INTO public.bookings (id, event_id, customer_id, seats, status) VALUES
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c1', 4, 'confirmed'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c2', 2, 'confirmed');
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
"""

NO_SHOW = "UPDATE public.bookings SET status = 'no_show' WHERE id = '00000000-0000-0000-0000-0000000000b1'"
STAFF_LIST = ("INSERT INTO public.event_check_ins (event_id, customer_id, booking_id, check_in_method) VALUES "
              "('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000c2', "
              "'00000000-0000-0000-0000-0000000000b2', 'staff_list')")


def main():
    with tempfile.TemporaryDirectory(prefix='bk130-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line.split('NOTICE:  ', 1)[-1])
            return result.stdout.strip()

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def definitions():
            return sql("SELECT string_agg(conname || '=' || pg_get_constraintdef(oid), E'\\n' ORDER BY conname) FROM pg_constraint "
                       "WHERE conname IN ('bookings_status_check', 'event_check_ins_check_in_method_check');")

        def refused(statement, constraint, label):
            error = sql_error(f'BEGIN; {statement}; ROLLBACK;')
            if f'violates check constraint "{constraint}"' not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        try:
            sql(SETUP)
            baseline = definitions()
            expected = (f'bookings_status_check={PRODUCTION_STATUS_CHECK}\n'
                        f'event_check_ins_check_in_method_check={PRODUCTION_METHOD_CHECK}')
            if baseline != expected:
                raise RuntimeError(f'FAIL the baseline constraints do not print as production does:\n{baseline}')
            print('PASS baseline: both constraints print exactly as production prints them')
            refused(NO_SHOW, 'bookings_status_check', 'baseline defect: an event booking cannot be marked no_show')
            refused(STAFF_LIST, 'event_check_ins_check_in_method_check',
                    'baseline defect: a check-in cannot be ticked from the staff list')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definitions() != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the constraints')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            sql(NO_SHOW + ';')
            check("(SELECT status = 'no_show' FROM public.bookings WHERE id = '00000000-0000-0000-0000-0000000000b1')",
                  'an event booking can be marked no_show')
            sql(STAFF_LIST + ';')
            check("(SELECT count(*) = 1 FROM public.event_check_ins WHERE check_in_method = 'staff_list')",
                  'a check-in can be ticked from the staff list')
            for status in OLD_STATUSES:
                sql(f"BEGIN; UPDATE public.bookings SET status = '{status}' WHERE id = '00000000-0000-0000-0000-0000000000b2'; ROLLBACK;")
            print('PASS every status allowed before is still allowed')
            for method in ('qr', 'manual', 'auto'):
                sql(f"BEGIN; UPDATE public.event_check_ins SET check_in_method = '{method}'; ROLLBACK;")
            print('PASS every check-in method allowed before is still allowed')
            refused("UPDATE public.bookings SET status = 'noshow' WHERE id = '00000000-0000-0000-0000-0000000000b2'",
                    'bookings_status_check', 'an unknown booking status is still refused')
            refused("UPDATE public.event_check_ins SET check_in_method = 'kiosk'", 'event_check_ins_check_in_method_check',
                    'an unknown check-in method is still refused')
            check("NOT public.is_active_event_booking_for_capacity_v01('no_show', NULL)", 'a no-show booking holds no seats')
            check("public.is_active_event_booking_for_capacity_v01('confirmed', NULL)", 'a confirmed booking still holds its seats')

            error = sql_error(ROLLBACK.read_text())
            if 'some event bookings are marked no_show' not in error:
                raise RuntimeError(f'FAIL the rollback ran while a booking was a no-show: {error!r}')
            print('PASS the rollback refuses while a booking is marked no_show')
            sql("UPDATE public.bookings SET status = 'confirmed' WHERE status = 'no_show';")
            error = sql_error(ROLLBACK.read_text())
            if 'ticked from the staff list' not in error:
                raise RuntimeError(f'FAIL the rollback ran while a staff-list check-in existed: {error!r}')
            print('PASS the rollback refuses while a check-in was ticked from the staff list')
            sql("UPDATE public.event_check_ins SET check_in_method = 'manual' WHERE check_in_method = 'staff_list';")
            sql(ROLLBACK.read_text())
            if definitions() != baseline:
                raise RuntimeError('FAIL the rollback did not restore the constraints exactly')
            print('PASS the rollback restores both constraints exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

#!/usr/bin/env python3
"""Run the event guest details chase ledger migration in an isolated socket-only PostgreSQL.

BK-132. Builds the smallest schema the migration needs (the anon, authenticated and service_role
roles, and events and bookings tables), runs the migration in one transaction, and shows:
one booker reminder per booking and one manager list per event, ever (a second claim raises
23505); a manager row cannot carry a booking id and a booker row must; anon and authenticated
cannot read or write the table and service_role can; deleting a booking or an event removes its
rows; the migration runs twice cleanly; a rolled-back run leaves nothing behind; and the rollback
file drops the table.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261029090720_event_guest_details_reminders.sql'
ROLLBACK = ROOT / 'tasks/event-guest-details-reminders/rollback.sql'

BASE_SCHEMA = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.events (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL);
CREATE TABLE public.bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE
);
INSERT INTO public.events (id, name) VALUES
  ('11111111-1111-4111-8111-111111111111', 'Tasting night'),
  ('22222222-2222-4222-8222-222222222222', 'Quiz');
INSERT INTO public.bookings (id, event_id) VALUES
  ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '11111111-1111-4111-8111-111111111111'),
  ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '11111111-1111-4111-8111-111111111111'),
  ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '22222222-2222-4222-8222-222222222222');
"""

EVENT_A = '11111111-1111-4111-8111-111111111111'
EVENT_B = '22222222-2222-4222-8222-222222222222'
BOOKING_A1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
BOOKING_A2 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
BOOKING_B1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'


def main():
    with tempfile.TemporaryDirectory(prefix='gdr-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'],
                       check=True, capture_output=True)
        env = {**os.environ, 'PGHOST': str(socket), 'PGDATABASE': 'postgres'}
        base = [str(PG / 'psql'), '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']
        failures = []

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

        def check(name, condition):
            print(('PASS ' if condition else 'FAIL ') + name)
            if not condition: failures.append(name)

        try:
            sql('CREATE EXTENSION IF NOT EXISTS pgcrypto;')
            sql(BASE_SCHEMA)

            # A rolled-back run leaves nothing behind.
            body = MIGRATION.read_text().replace('BEGIN;', '', 1).replace('COMMIT;', '', 1)
            sql('BEGIN;\n' + body + '\nROLLBACK;')
            check('a rolled-back run creates nothing', sql("SELECT to_regclass('public.event_guest_details_reminders') IS NULL") == 't')

            run_file(MIGRATION)
            run_file(MIGRATION)
            check('the migration runs twice cleanly', sql("SELECT to_regclass('public.event_guest_details_reminders') IS NOT NULL") == 't')

            sql(f"INSERT INTO public.event_guest_details_reminders (kind, event_id, event_booking_id) VALUES ('booker_reminder', '{EVENT_A}', '{BOOKING_A1}')")
            error = sql_error(f"INSERT INTO public.event_guest_details_reminders (kind, event_id, event_booking_id) VALUES ('booker_reminder', '{EVENT_A}', '{BOOKING_A1}')")
            check('a second booker reminder for one booking is refused', 'duplicate key' in error)
            sql(f"INSERT INTO public.event_guest_details_reminders (kind, event_id, event_booking_id) VALUES ('booker_reminder', '{EVENT_A}', '{BOOKING_A2}')")
            check('another booking on the same event can be reminded', sql("SELECT count(*) FROM public.event_guest_details_reminders WHERE kind='booker_reminder'") == '2')

            sql(f"INSERT INTO public.event_guest_details_reminders (kind, event_id) VALUES ('manager_list', '{EVENT_A}')")
            error = sql_error(f"INSERT INTO public.event_guest_details_reminders (kind, event_id) VALUES ('manager_list', '{EVENT_A}')")
            check('a second manager list for one event is refused', 'duplicate key' in error)
            sql(f"INSERT INTO public.event_guest_details_reminders (kind, event_id) VALUES ('manager_list', '{EVENT_B}')")
            check('another event gets its own manager list', sql("SELECT count(*) FROM public.event_guest_details_reminders WHERE kind='manager_list'") == '2')

            error = sql_error(f"INSERT INTO public.event_guest_details_reminders (kind, event_id, event_booking_id) VALUES ('manager_list', '{EVENT_B}', '{BOOKING_B1}')")
            check('a manager list cannot carry a booking id', 'booking_shape' in error)
            error = sql_error(f"INSERT INTO public.event_guest_details_reminders (kind, event_id) VALUES ('booker_reminder', '{EVENT_B}')")
            check('a booker reminder needs a booking id', 'booking_shape' in error)
            error = sql_error(f"INSERT INTO public.event_guest_details_reminders (kind, event_id) VALUES ('other', '{EVENT_B}')")
            check('an unknown kind is refused', 'check constraint' in error)

            for role in ('anon', 'authenticated'):
                for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    check(f'{role} has no {privilege}', sql(f"SELECT has_table_privilege('{role}', 'public.event_guest_details_reminders', '{privilege}')") == 'f')
            check('service_role can insert', sql("SELECT has_table_privilege('service_role', 'public.event_guest_details_reminders', 'INSERT')") == 't')
            check('RLS is on', sql("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_guest_details_reminders'::regclass") == 't')
            error = sql_error("SET ROLE anon; SELECT count(*) FROM public.event_guest_details_reminders;")
            check('anon reading the table is refused', 'permission denied' in error)

            sql(f"DELETE FROM public.bookings WHERE id = '{BOOKING_A1}'")
            check('deleting a booking removes its reminder', sql(f"SELECT count(*) FROM public.event_guest_details_reminders WHERE event_booking_id = '{BOOKING_A1}'") == '0')
            sql(f"DELETE FROM public.events WHERE id = '{EVENT_B}'")
            check('deleting an event removes its rows', sql(f"SELECT count(*) FROM public.event_guest_details_reminders WHERE event_id = '{EVENT_B}'") == '0')

            # The assertion catches a re-grant.
            sql('GRANT SELECT ON public.event_guest_details_reminders TO anon;')
            assertion = MIGRATION.read_text().split('DO $$', 1)[1].split('COMMIT;', 1)[0]
            assertion_only = 'DO $$' + assertion
            error = sql_error(assertion_only)
            check("the migration's assertion catches a re-grant to anon", 'reachable by anon' in error)
            sql('REVOKE SELECT ON public.event_guest_details_reminders FROM anon;')

            run_file(ROLLBACK)
            check('the rollback drops the table', sql("SELECT to_regclass('public.event_guest_details_reminders') IS NULL") == 't')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'fast', 'stop'], capture_output=True)

        if failures:
            raise SystemExit(f'{len(failures)} check(s) failed: {failures}')
        print('ALL PASS')


if __name__ == '__main__':
    main()

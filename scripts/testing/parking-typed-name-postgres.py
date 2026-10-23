#!/usr/bin/env python3
"""Run the parking typed-name migration in an isolated socket-only PostgreSQL database.

The current sync_parking_customer_name_from_customers and its trigger are loaded from the
migration that defined them (production's body matches it), and shown to replace the name typed
on a new booking with the stored customer's. Then the migration runs: a new booking keeps its
typed name, a blank typed surname stays blank, re-setting the same customer copies nothing, and
moving a booking to a different customer still copies that customer's name. It also checks that
a rolled-back run changes nothing, that the function keeps its settings and grants and the
trigger is untouched, and that the rollback restores the old definition exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261023163653_parking_booking_keeps_typed_name.sql'
OLD_SOURCE = MIGRATIONS / '20260725020000_parking_bookings_customer_relink_sync.sql'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
CREATE TABLE public.customers (id uuid PRIMARY KEY, first_name text NOT NULL, last_name text NOT NULL);
CREATE TABLE public.parking_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id uuid REFERENCES public.customers (id),
  customer_first_name text NOT NULL,
  customer_last_name text,
  notes text
);
INSERT INTO public.customers VALUES
  ('00000000-0000-0000-0000-00000000000a', 'Stored', 'Owner'),
  ('00000000-0000-0000-0000-00000000000b', 'Other', 'Person');
"""

# Production's grants on the trigger function (proacl on 23 October 2026).
GRANTS = 'GRANT EXECUTE ON FUNCTION public.sync_parking_customer_name_from_customers() TO anon, authenticated, service_role;'

OWNER = '00000000-0000-0000-0000-00000000000a'
OTHER = '00000000-0000-0000-0000-00000000000b'


def old_function():
    """The function as production holds it. Also the rollback: the migration touches nothing else."""
    text = OLD_SOURCE.read_text()
    return text[:text.index('DROP TRIGGER IF EXISTS')]


def old_trigger():
    """The trigger as production holds it, without that migration's one-off backfill."""
    text = OLD_SOURCE.read_text()
    return text[text.index('DROP TRIGGER IF EXISTS'):text.index('-- Backfill rows relinked')]


def main():
    with tempfile.TemporaryDirectory(prefix='parking-typed-name-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def sql(text):
            done = subprocess.run(command, input=text, text=True, capture_output=True)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def check(condition, label):
            if not condition:
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def book(note, first, last, customer=OWNER):
            last_sql = 'NULL' if last is None else f"'{last}'"
            customer_sql = 'NULL' if customer is None else f"'{customer}'"
            sql("INSERT INTO public.parking_bookings (customer_id, customer_first_name, customer_last_name, notes) "
                f"VALUES ({customer_sql}, '{first}', {last_sql}, '{note}');")

        def name(note):
            return sql("SELECT customer_first_name || ' ' || coalesce(customer_last_name, '<blank>') "
                       f"FROM public.parking_bookings WHERE notes = '{note}';")

        def definition():
            return sql("SELECT prosrc FROM pg_proc WHERE proname = 'sync_parking_customer_name_from_customers';")

        def settings():
            return sql("SELECT coalesce(proconfig::text, '') || ' ' || prosecdef::text || ' ' || coalesce(proacl::text, '') "
                       "FROM pg_proc WHERE proname = 'sync_parking_customer_name_from_customers';")

        def trigger():
            return sql("SELECT pg_get_triggerdef(oid) FROM pg_trigger WHERE tgname = 'sync_parking_customer_name_trigger';")

        try:
            sql(SETUP)
            sql(old_function())
            sql(old_trigger())
            sql(GRANTS)
            original_body, original_settings, original_trigger = definition(), settings(), trigger()
            check('search_path=public, pg_catalog' in original_settings, 'the old definition loads with production settings')

            # The defect, on the old trigger.
            book('old', 'Typed', 'Guest')
            check(name('old') == 'Stored Owner', 'old: the stored name replaces the name typed on a new booking')
            book('old-blank', 'Typed', None)
            check(name('old-blank') == 'Stored Owner', 'old: a blank typed surname is filled from the stored record')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(definition() == original_body and settings() == original_settings, 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(definition() != original_body, 'the migration replaces the function')
            check(settings() == original_settings, 'search_path, SECURITY INVOKER and grants are unchanged')
            check(trigger() == original_trigger, 'the trigger is untouched')
            check(sql("SELECT count(*) FROM pg_proc WHERE proname = 'sync_parking_customer_name_from_customers';") == '1',
                  'still one function')
            sql(MIGRATION.read_text())
            check(definition() != original_body and settings() == original_settings, 'running it twice is harmless')

            book('new', 'Typed', 'Guest')
            check(name('new') == 'Typed Guest', 'new: a new booking keeps the name typed for it')
            book('new-blank', 'Typed', None)
            check(name('new-blank') == 'Typed <blank>', 'new: a blank typed surname stays blank (PY-002)')
            book('new-unlinked', 'Walk', 'In', customer=None)
            check(name('new-unlinked') == 'Walk In', 'new: a booking with no customer keeps its name')
            sql(f"UPDATE public.parking_bookings SET customer_id = '{OWNER}' WHERE notes = 'new';")
            check(name('new') == 'Typed Guest', 'new: setting the customer it already has copies nothing')
            sql("UPDATE public.parking_bookings SET notes = 'new' WHERE notes = 'new';")
            check(name('new') == 'Typed Guest', 'new: an unrelated update copies nothing')
            sql(f"UPDATE public.parking_bookings SET customer_id = '{OTHER}' WHERE notes = 'new';")
            check(name('new') == 'Other Person', "new: moving a booking to another customer takes that customer's name")
            sql("UPDATE public.parking_bookings SET customer_id = NULL WHERE notes = 'new';")
            check(name('new') == 'Other Person', 'new: unlinking a booking keeps its name')
            sql(f"UPDATE public.parking_bookings SET customer_id = '{OWNER}' WHERE notes = 'new-unlinked';")
            check(name('new-unlinked') == 'Stored Owner', 'new: linking an unlinked booking to a customer takes their name')

            # Rollback restores production's definition exactly.
            sql(old_function())
            check(definition() == original_body and settings() == original_settings and trigger() == original_trigger,
                  'the rollback restores the old definition, settings and trigger')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

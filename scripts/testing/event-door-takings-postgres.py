#!/usr/bin/env python3
"""Run the event-door-takings migration in an isolated socket-only PostgreSQL database.

Supabase's default privileges are reproduced (anon, authenticated and service_role are granted
everything on a new table in public), so the run proves the migration's own revokes do the work.
Baseline: there is nowhere to record a pay-on-arrival night's door money. A rolled-back run creates
nothing. Then the migration runs: service_role can record and correct one till total per event; a
second row for the same event, a negative total, or a free entry without a reason is refused; anon
and authenticated can neither read nor write the table; the rows go when their event is deleted. The
migration's own assertion catches a re-grant, and the rollback leaves the database as it found it.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027133406_event_door_takings.sql'
ROLLBACK = ROOT / 'tasks/event-door-takings/rollback.sql'
EVENT = '00000000-0000-0000-0000-0000000000e1'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;  -- as Supabase creates it
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase grants every new table in public to all three API roles by default.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
CREATE TABLE public.events (id uuid PRIMARY KEY, name text);
INSERT INTO public.events (id, name) VALUES ('00000000-0000-0000-0000-0000000000e1', 'Bingo night'),
  ('00000000-0000-0000-0000-0000000000e2', 'Quiz night');
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk118-pg-') as folder:
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

        def refused(statement, needle, label):
            error = sql_error(f'BEGIN; {statement}; ROLLBACK;')
            if needle not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def table_exists():
            return sql("SELECT to_regclass('public.event_door_takings') IS NOT NULL;")

        try:
            sql(SETUP)
            check("to_regclass('public.event_door_takings') IS NULL",
                  "baseline defect: there is nowhere to record a night's door money")

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if table_exists() != 'f':
                raise RuntimeError('FAIL a rolled-back run left the table behind')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            sql("SET ROLE service_role; INSERT INTO public.event_door_takings (event_id, till_total, free_entries, note) "
                f"VALUES ('{EVENT}', 186.50, 2, 'Quiz host and partner'); RESET ROLE;")
            sql("SET ROLE service_role; INSERT INTO public.event_door_takings (event_id, till_total) VALUES "
                f"('{EVENT}', 190.00) ON CONFLICT (event_id) DO UPDATE SET till_total = EXCLUDED.till_total; RESET ROLE;")
            check(f"(SELECT till_total = 190.00 AND free_entries = 2 FROM public.event_door_takings WHERE event_id = '{EVENT}')",
                  'service_role records one till total per event and can correct it')
            refused(f"INSERT INTO public.event_door_takings (event_id, till_total) VALUES ('{EVENT}', 10)",
                    'event_door_takings_pkey', 'a second row for the same event is refused')
            refused("INSERT INTO public.event_door_takings (event_id, till_total) VALUES ('00000000-0000-0000-0000-0000000000e2', -1)",
                    'event_door_takings_till_total_check', 'a negative till total is refused')
            refused("INSERT INTO public.event_door_takings (event_id, till_total, free_entries, note) VALUES "
                    "('00000000-0000-0000-0000-0000000000e2', 50, 1, '  ')",
                    'event_door_takings_free_entries_need_reason', 'a free entry without a reason is refused')
            refused("INSERT INTO public.event_door_takings (event_id, till_total) VALUES ('00000000-0000-0000-0000-0000000000e9', 5)",
                    'event_door_takings_event_id_fkey', 'a row for an event that does not exist is refused')
            for role in ('anon', 'authenticated'):
                refused(f"SET ROLE {role}; SELECT * FROM public.event_door_takings",
                        'permission denied for table event_door_takings', f'{role} cannot read the table')
                refused(f"SET ROLE {role}; INSERT INTO public.event_door_takings (event_id, till_total) VALUES "
                        "('00000000-0000-0000-0000-0000000000e2', 1)",
                        'permission denied for table event_door_takings', f'{role} cannot write the table')
            check("(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.event_door_takings'::regclass)",
                  'row level security is on')
            sql("BEGIN; DELETE FROM public.events WHERE id = '00000000-0000-0000-0000-0000000000e1'; "
                "SELECT fixture_assert((SELECT count(*) = 0 FROM public.event_door_takings), "
                "'the door money goes when its event is deleted'); ROLLBACK;")

            assertion = MIGRATION.read_text().split('-- Prove it,', 1)[1].split('\n', 1)[1]
            error = sql_error('BEGIN; GRANT SELECT ON public.event_door_takings TO authenticated;\n' + assertion + '\nROLLBACK;')
            if 'reachable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted table')

            sql(ROLLBACK.read_text())
            if table_exists() != 'f':
                raise RuntimeError('FAIL the rollback left the table behind')
            print('PASS the rollback leaves the database as production had it')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

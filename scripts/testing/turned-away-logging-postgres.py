#!/usr/bin/env python3
"""Run the turned-away logging migration in an isolated socket-only PostgreSQL database.

check_table_availability_v06 is loaded as production holds it: the definition from the migration
that last created it, with the kitchen pacing lone-party patch applied on top, checked against
production's md5(prosrc). Against that baseline it shows the defect: a check that breaks answers
"unknown" and leaves nothing in the database log. Then the migration runs: the function still
answers "unknown" (it never fails open) but now raises a WARNING carrying the SQLSTATE and
message, its body differs from production by exactly the warning lines, it keeps SECURITY
DEFINER, its search_path and service_role-only access, and a second run of the patch is a
no-op. booking_funnel_events and website_booking_funnel are service_role only; the table
refuses anything shaped like personal data where a code belongs; the funnel counts only keys
that can create bookings and only the website's table booking route. It also checks that a
rolled-back run changes nothing, that a definition which has moved on makes the patch fail
without half-applying the migration, and that the rollback restores production exactly.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261026220419_turned_away_logging.sql'
ROLLBACK = ROOT / 'tasks/turned-away-logging/rollback.sql'
LONE_PARTY = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
}
PRODUCTION_CHECK_MD5 = '60eccdcfbfabdee9433d84c0bcbd3ef1'
ANCHOR = ('EXCEPTION WHEN OTHERS THEN\n'
          '  -- Never fail open. A calculation that broke is "unknown", not "available".\n')
ADDED = ('  -- BK-101: say why in the database log, so a broken check is seen and not only answered "unknown".\n'
         "  RAISE WARNING 'check_table_availability_v06 failed (date %, party %, purpose %): % %',\n"
         '    p_booking_date, p_party_size, p_purpose, SQLSTATE, SQLERRM;\n')
CHECK_SIGNATURE = ('check_table_availability_v06(date,integer,text,boolean,boolean,integer,text)')

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated;
-- As on Supabase: the service role is not held back by row level security.
CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TYPE public.table_booking_type AS ENUM ('regular', 'sunday_lunch', 'christmas');
CREATE TYPE public.table_booking_status AS ENUM ('pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed',
  'pending_card_capture', 'visited_waiting_for_review', 'review_clicked');
CREATE TYPE public.payment_status AS ENUM ('pending', 'completed', 'failed', 'refunded', 'partial_refund');
CREATE TYPE public.table_booking_payment_method AS ENUM ('payment_link', 'cash', 'paypal');
CREATE TABLE public.booking_periods (id uuid PRIMARY KEY);
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);
CREATE FUNCTION public.public_booking_message(p_public_reason text) RETURNS text
  LANGUAGE sql IMMUTABLE AS $$ SELECT 'We could not check live availability just now.' $$;
-- Only the columns the funnel reads. The availability function's own tables are absent on
-- purpose, so calling it breaks inside and exercises its catch-all.
CREATE TABLE public.api_keys (id uuid PRIMARY KEY, name text, permissions jsonb);
CREATE TABLE public.api_usage (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), api_key_id uuid NOT NULL,
  endpoint varchar NOT NULL, method varchar NOT NULL, status_code integer, created_at timestamptz DEFAULT now());
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source varchar,
  created_at timestamptz DEFAULT now());
GRANT ALL ON public.api_keys, public.api_usage, public.table_bookings TO service_role;
"""

WEBSITE_KEY = '00000000-0000-4000-8000-0000000000a1'
TEST_KEY = '00000000-0000-4000-8000-0000000000b2'

SEED_FUNNEL = f"""
INSERT INTO public.api_keys VALUES
  ('{WEBSITE_KEY}', 'website', '["create:bookings","read:table_bookings","write:ops_alerts"]'),
  ('{TEST_KEY}', 'website preview and CI', '["read:table_bookings","read:events"]');
-- One minute into this London week, so every row lands in this week whatever the time.
CREATE TEMP TABLE this_week AS
  SELECT ((date_trunc('week', now() AT TIME ZONE 'Europe/London')) AT TIME ZONE 'Europe/London') + interval '1 minute' AS at;
GRANT SELECT ON this_week TO service_role;
INSERT INTO public.api_usage (api_key_id, endpoint, method, created_at)
  SELECT k, e, m, (SELECT at FROM this_week) FROM (VALUES
    ('{WEBSITE_KEY}'::uuid, '/api/table-bookings/periods', 'GET'),
    ('{WEBSITE_KEY}'::uuid, '/api/table-bookings/periods', 'GET'),
    ('{WEBSITE_KEY}'::uuid, '/api/table-bookings/periods', 'GET'),
    ('{WEBSITE_KEY}'::uuid, '/api/table-bookings/periods', 'POST'),
    ('{WEBSITE_KEY}'::uuid, '/api/table-bookings/load', 'GET'),
    ('{TEST_KEY}'::uuid, '/api/table-bookings/periods', 'GET'),
    ('{TEST_KEY}'::uuid, '/api/table-bookings/periods', 'GET')) AS v(k, e, m);
SET ROLE service_role;
INSERT INTO public.booking_funnel_events (occurred_at, source, stage, route, purpose, calculation_state, slots_offered, api_key_id)
  SELECT (SELECT at FROM this_week), 'ams', 'availability', 'table-bookings/load', p, s, n, k FROM (VALUES
    ('drinks', 'complete', 0, '{WEBSITE_KEY}'::uuid),
    ('drinks', 'complete', 5, '{WEBSITE_KEY}'::uuid),
    ('drinks', 'unknown', 0, '{WEBSITE_KEY}'::uuid),
    ('food', 'complete', 0, '{WEBSITE_KEY}'::uuid),
    ('drinks', 'complete', 0, '{TEST_KEY}'::uuid)) AS v(p, s, n, k);
INSERT INTO public.booking_funnel_events (occurred_at, source, stage, route, reason_code, http_status, api_key_id)
  SELECT (SELECT at FROM this_week), 'website', st, r, c, h, '{WEBSITE_KEY}'::uuid FROM (VALUES
    ('refused', 'api/table-bookings', 'OUTSIDE_HOURS', 400),
    ('failed', 'api/table-bookings', 'UPSTREAM_NOT_OK', 500),
    ('refused', 'api/event-bookings', 'VALIDATION_FAILED', 400)) AS v(st, r, c, h);
RESET ROLE;
INSERT INTO public.table_bookings (source, created_at)
  SELECT s, c FROM (VALUES
    ('brand_site', (SELECT at FROM this_week)),
    ('brand_site', (SELECT at FROM this_week)),
    ('walk-in', (SELECT at FROM this_week)),
    ('brand_site', (SELECT at FROM this_week) - interval '63 days')) AS v(s, c);
"""


def definition(name):
    text = SOURCES[name].read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('\n$function$;', start) + len('\n$function$;')
    return text[start:end]


def patch_block():
    text = MIGRATION.read_text()
    start = text.index('DO $patch$')
    end = text.index('$patch$;', start + len('DO $patch$')) + len('$patch$;')
    return text[start:end]


def main():
    with tempfile.TemporaryDirectory(prefix='turned-away-') as tmp:
        work = Path(tmp)
        cluster, socket = work / 'data', work / 'socket'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-c listen_addresses='' -c unix_socket_directories='{socket}'", '-w', 'start',
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1']

        def run(text):
            return subprocess.run(command, input=text, text=True, capture_output=True)

        def sql(text):
            done = run(text)
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip()

        def check(expression, label):
            if sql(f'SELECT ({expression})::text;') != 'true':
                raise RuntimeError('FAIL ' + label)
            print('PASS ' + label)

        def quote(value):
            return "'" + value.replace("'", "''") + "'"

        def body():
            return "(SELECT prosrc FROM pg_proc WHERE proname = 'check_table_availability_v06')"

        def call_check():
            # As the website's caller, the service role. stderr carries any WARNING.
            done = run("SET ROLE service_role; SELECT public.check_table_availability_v06("
                       "DATE '2026-11-07', 4, 'food')->>'calculation_state';")
            if done.returncode:
                raise RuntimeError(done.stderr)
            return done.stdout.strip(), done.stderr

        def exists(kind, name):
            if kind == 'table':
                return sql(f"SELECT to_regclass('public.{name}') IS NOT NULL;") == 't'
            return sql(f"SELECT count(*) FROM pg_proc WHERE proname = '{name}';") != '0'

        def privileges():
            rows = []
            for role in ('anon', 'authenticated', 'service_role'):
                rows.append(f"has_function_privilege('{role}', 'public.{CHECK_SIGNATURE}'::regprocedure, 'EXECUTE')::text")
            return sql('SELECT ' + " || ',' || ".join(rows) + ';')

        try:
            sql(SETUP)
            for name in SOURCES:
                sql(definition(name) + ';')
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
            sql(LONE_PARTY.read_text())
            check(f"md5({body()}) = '{PRODUCTION_CHECK_MD5}'", 'check_table_availability_v06 loads exactly as production holds it')
            sql(f'CREATE TABLE original AS SELECT prosrc, prosecdef, proconfig FROM pg_proc WHERE proname = '
                "'check_table_availability_v06';")
            baseline_privileges = privileges()
            check(f"'{baseline_privileges}' = 'false,false,true'", 'baseline: service_role only')

            state, stderr = call_check()
            if state != 'unknown' or 'WARNING' in stderr:
                raise RuntimeError(f'FAIL baseline call: {state!r} {stderr!r}')
            print('PASS defect: a broken availability check answers unknown and logs nothing')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            check(f"{body()} = (SELECT prosrc FROM original)", 'a rolled-back run leaves the function as it was')
            if exists('table', 'booking_funnel_events') or exists('function', 'website_booking_funnel'):
                raise RuntimeError('FAIL a rolled-back run left the table or the funnel function behind')
            print('PASS a rolled-back run leaves no table and no funnel function')

            sql(MIGRATION.read_text())
            check(f"{body()} = replace((SELECT prosrc FROM original), {quote(ANCHOR)}, {quote(ANCHOR + ADDED)})",
                  'only the warning lines are added to the function')
            check("(SELECT prosecdef FROM pg_proc WHERE proname = 'check_table_availability_v06')", 'it stays SECURITY DEFINER')
            check("(SELECT proconfig FROM pg_proc WHERE proname = 'check_table_availability_v06') = (SELECT proconfig FROM original)",
                  'its search_path is unchanged')
            check(f"'{privileges()}' = 'false,false,true'", 'it stays service_role only')

            state, stderr = call_check()
            if state != 'unknown':
                raise RuntimeError(f'FAIL the patched function answered {state!r}, not unknown')
            match = re.search(r'WARNING:\s+check_table_availability_v06 failed \(date 2026-11-07, party 4, purpose food\): (\w{5}) ', stderr)
            if not match:
                raise RuntimeError(f'FAIL no warning with a SQLSTATE in: {stderr!r}')
            print(f'PASS a broken check still answers unknown and now logs a WARNING (SQLSTATE {match.group(1)})')

            patched = sql(f'SELECT md5({body()});')
            sql(patch_block())
            check(f"md5({body()}) = '{patched}'", 'a second run of the patch is a no-op')
            print(f'INFO check_table_availability_v06 md5(prosrc) after the migration: {patched}')

            # booking_funnel_events: service role only, and codes cannot carry personal data.
            for role in ('anon', 'authenticated'):
                for privilege in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    check(f"NOT has_table_privilege('{role}', 'public.booking_funnel_events', '{privilege}')",
                          f'{role} has no {privilege} on booking_funnel_events')
            check("has_table_privilege('service_role', 'public.booking_funnel_events', 'INSERT')", 'service_role can record')
            check("(SELECT relrowsecurity FROM pg_class WHERE oid = 'public.booking_funnel_events'::regclass)", 'row level security is on')
            sql("SET ROLE service_role; INSERT INTO public.booking_funnel_events (source, stage, route, reason_code, page_path) "
                "VALUES ('website', 'refused', 'api/table-bookings', 'OUTSIDE_HOURS', '/book-table'); RESET ROLE;")
            print('PASS a well-formed refusal is recorded')
            for label, values in [
                ('a phone number as a reason code', "('website', 'refused', 'api/table-bookings', '07700 900123', '/book-table')"),
                ('an email address as a reason code', "('website', 'refused', 'api/table-bookings', 'a@b.com', '/book-table')"),
                ('an unknown stage', "('website', 'booked', 'api/table-bookings', 'X', '/book-table')"),
                ('a page path that is not a path', "('website', 'refused', 'api/table-bookings', 'X', 'Alice Booker')"),
                ('free text as a route', "('website', 'refused', 'Alice Booker 07700', 'X', '/book-table')"),
            ]:
                done = run("SET ROLE service_role; INSERT INTO public.booking_funnel_events "
                           f"(source, stage, route, reason_code, page_path) VALUES {values};")
                if done.returncode == 0 or 'violates check constraint' not in done.stderr:
                    raise RuntimeError(f'FAIL {label} was accepted: {done.stderr!r}')
                print(f'PASS {label} is refused')
            sql('DELETE FROM public.booking_funnel_events;')

            # website_booking_funnel: service role only, website keys only, the table route only.
            for role in ('anon', 'authenticated'):
                check(f"NOT has_function_privilege('{role}', 'public.website_booking_funnel(integer)', 'EXECUTE')",
                      f'{role} cannot read the funnel')
            check("has_function_privilege('service_role', 'public.website_booking_funnel(integer)', 'EXECUTE')",
                  'service_role can read the funnel')
            sql(SEED_FUNNEL)
            rows = sql("SET ROLE service_role; SELECT date_checks || ',' || searches || ',' || no_tables || ',' || "
                       "could_not_check || ',' || refused || ',' || failed || ',' || bookings "
                       "FROM public.website_booking_funnel(2) ORDER BY week_start DESC;").splitlines()
            if rows != ['3,3,1,1,1,1,2', '0,0,0,0,0,0,0']:
                raise RuntimeError(f'FAIL funnel rows: {rows!r}')
            print('PASS the funnel counts this week (3 date checks, 3 searches, 1 no tables, 1 could not check, '
                  '1 refused, 1 failed, 2 bookings) and leaves out the test key, food calls and other routes')
            check("(SELECT count(*) FROM public.website_booking_funnel(NULL)) = 8", 'it defaults to eight weeks')
            check("(SELECT count(*) FROM public.website_booking_funnel(500)) = 26", 'and never reads more than 26')
            check("(SELECT extract(isodow FROM week_start) FROM public.website_booking_funnel(1)) = 1", 'weeks start on Monday')

            sql(ROLLBACK.read_text())
            check(f"md5({body()}) = '{PRODUCTION_CHECK_MD5}'", 'the rollback restores the production body byte for byte')
            check(f"'{privileges()}' = '{baseline_privileges}'", 'and its production privileges')
            check("(SELECT prosecdef FROM pg_proc WHERE proname = 'check_table_availability_v06')", 'and SECURITY DEFINER')
            if exists('table', 'booking_funnel_events') or exists('function', 'website_booking_funnel'):
                raise RuntimeError('FAIL the rollback left the table or the funnel function behind')
            print('PASS the rollback removes the table and the funnel function')

            # A definition that has moved on must stop the migration, not half-apply it.
            sql(definition('check_table_availability_v06').replace(
                '-- Never fail open. A calculation that broke is "unknown", not "available".',
                '-- Fails closed.') + ';')
            done = run('BEGIN;' + MIGRATION.read_text() + 'COMMIT;')
            if done.returncode == 0 or 'expected 1 and 0' not in done.stderr:
                raise RuntimeError(f'FAIL the patch ran against a definition it did not expect: {done.stderr!r}')
            if exists('table', 'booking_funnel_events'):
                raise RuntimeError('FAIL the failed migration left its table behind')
            print('PASS an unexpected definition makes the migration fail loudly and apply nothing')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

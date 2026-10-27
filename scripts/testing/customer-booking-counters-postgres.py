#!/usr/bin/env python3
"""Run the two customer booking counter migrations in an isolated socket-only PostgreSQL database.

BK-165 (customer bookings review of 24 October 2026). update_customer_booking_stats and
get_email_capture_audience are loaded exactly as production holds them (the part 1 rollback file,
built from pg_get_functiondef on 27 October 2026; md5(prosrc) checked), over fixture tables with the
columns they read. Against that baseline the defect is shown: a confirmed booking raises the
counter, cancelling it does not lower it, and the email capture audience dates the guest's last
activity by the cancelled booking.

Part 1 then runs: confirming no longer touches the counters, a no-show still counts, the audience
reads the latest booking that is not cancelled, get_email_capture_audience differs from
production's body by that one expression only, and both functions keep their security settings
and grants exactly. Part 2 refuses to run before part 1 and refuses an implausible number of rows;
after part 1 it copies exactly the rows that carry a value, drops both columns, and bookings still
save. Rolled-back runs of either part change nothing, part 2's rollback puts every value back, and
part 1's rollback restores production's bodies and grants exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
PART1 = ROOT / 'supabase/migrations/20261027154846_customer_booking_counters_live.sql'
PART2 = ROOT / 'supabase/migrations/20261027154847_drop_customer_booking_counters.sql'
ROLLBACK1 = ROOT / 'tasks/customer-booking-counters/rollback-live.sql'
ROLLBACK2 = ROOT / 'tasks/customer-booking-counters/rollback-drop.sql'
PRODUCTION_MD5 = {
    'update_customer_booking_stats': 'e91880fe00e9f4424a38037a3046bd20',
    'get_email_capture_audience': '42cf7716b86ab6c4979ef7c5636cc1a7',
}

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), first_name text NOT NULL, last_name text NOT NULL DEFAULT '',
  email varchar, mobile_e164 varchar, sms_status text NOT NULL DEFAULT 'active', messaging_status text DEFAULT 'active',
  marketing_sms_opted_out_at timestamptz,
  table_booking_count integer DEFAULT 0, no_show_count integer DEFAULT 0, last_table_booking_date date
);
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid REFERENCES customers,
  booking_date date, status text);
CREATE TABLE public.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.messages (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), direction text, twilio_status text, to_number text);
CREATE TABLE public.guest_tokens (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, action_type text);
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;

INSERT INTO customers (id, first_name, mobile_e164, table_booking_count, last_table_booking_date) VALUES
  ('00000000-0000-0000-0000-000000000001', 'Pat', '+447700900201', 0, NULL),
  ('00000000-0000-0000-0000-000000000002', 'Kim', '+447700900202', 4, '2026-03-01'),
  ('00000000-0000-0000-0000-000000000003', 'Lou', '+447700900203', 0, NULL);
INSERT INTO table_bookings (customer_id, booking_date, status) VALUES
  ('00000000-0000-0000-0000-000000000002', '2026-03-01', 'completed');
"""

FUNCTIONS = """SELECT string_agg(proname || ':' || md5(prosrc) || ':' || prosecdef || ':' || coalesce(proconfig::text, '')
  || ':' || coalesce(proacl::text, ''), ' ' ORDER BY proname) FROM pg_proc
  WHERE proname IN ('update_customer_booking_stats', 'get_email_capture_audience');"""
COUNTERS = """SELECT string_agg(id || '=' || coalesce(table_booking_count::text, '-') || '/' || coalesce(last_table_booking_date::text, '-'),
  ',' ORDER BY id) FROM customers;"""
CATALOG = """SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:' || proname || ':' || md5(prosrc) || ':' || coalesce(proacl::text, '') AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'rel:' || relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL SELECT 'col:' || attname FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND attnum > 0 AND NOT attisdropped) s;"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk165-pg-') as folder:
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

        def last_activity(customer):
            return sql(f"SELECT last_activity_on FROM get_email_capture_audience(100) WHERE customer_id = '{customer}';")

        try:
            sql(SETUP)
            sql(ROLLBACK1.read_text())
            sql("CREATE TRIGGER update_customer_stats_on_booking AFTER INSERT OR UPDATE ON public.table_bookings"
                " FOR EACH ROW EXECUTE FUNCTION update_customer_booking_stats();")
            for name, expected in PRODUCTION_MD5.items():
                check(f"(SELECT md5(prosrc) FROM pg_proc WHERE proname = '{name}') = '{expected}'", f'{name} starts as production holds it')
            baseline_functions = sql(FUNCTIONS)

            # The defect, inside a transaction so the baseline data stays clean.
            sql("BEGIN; INSERT INTO table_bookings (id, customer_id, booking_date, status) VALUES"
                " ('10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-11-20', 'confirmed');"
                " UPDATE table_bookings SET status = 'cancelled' WHERE id = '10000000-0000-0000-0000-000000000001';"
                " SELECT fixture_assert((SELECT table_booking_count = 1 AND last_table_booking_date = '2026-11-20' FROM customers"
                " WHERE id = '00000000-0000-0000-0000-000000000001'), 'baseline defect: a cancelled booking still counts and dates the customer');"
                " SELECT fixture_assert((SELECT last_activity_on = '2026-11-20' FROM get_email_capture_audience(100)"
                " WHERE customer_id = '00000000-0000-0000-0000-000000000001'), 'baseline defect: the audience dates last activity by the cancelled booking');"
                " ROLLBACK;")

            error = sql_error('BEGIN;\n' + PART2.read_text() + '\nROLLBACK;')
            if 'apply 20261027154846_customer_booking_counters_live first' not in error:
                raise RuntimeError(f'FAIL part 2 ran before part 1: {error!r}')
            print('PASS part 2 refuses to run before part 1')

            before = sql(CATALOG)
            sql('BEGIN;\n' + PART1.read_text() + '\nROLLBACK;')
            if sql(CATALOG) != before:
                raise RuntimeError('FAIL a rolled-back run of part 1 changed the catalog')
            print('PASS a rolled-back run of part 1 changes nothing')

            sql(PART1.read_text())
            after_functions = sql(FUNCTIONS)
            for old, new in zip(baseline_functions.split(' '), after_functions.split(' ')):
                if old.split(':')[2:] != new.split(':')[2:]:
                    raise RuntimeError(f'FAIL security settings or grants changed: {old} -> {new}')
            print('PASS both functions keep SECURITY DEFINER or INVOKER, search_path and grants exactly')
            prod_body = sql("SELECT prosrc FROM pg_proc WHERE proname = 'get_email_capture_audience';")
            check("(SELECT position('last_table_booking_date' in prosrc) = 0 AND position('table_booking_count' in prosrc) = 0"
                  " FROM pg_proc WHERE proname IN ('get_email_capture_audience') )", 'the audience no longer reads the counters')
            check("(SELECT position('table_booking_count' in prosrc) = 0 FROM pg_proc WHERE proname = 'update_customer_booking_stats')",
                  'the trigger no longer writes the counters')
            original = ROLLBACK1.read_text().split("get_email_capture_audience(p_max_recipients integer DEFAULT 500)", 1)[1]
            original = original.split('AS $function$', 1)[1].split('$function$', 1)[0]
            old_line = "      COALESCE(c.last_table_booking_date, '1900-01-01'::date),\n"
            new_lines = ("      -- The latest table booking that was not cancelled (BK-165), not the old counter.\n"
                         "      COALESCE((SELECT max(t.booking_date) FROM public.table_bookings t\n"
                         "                 WHERE t.customer_id = c.id AND t.status <> 'cancelled'), '1900-01-01'::date),\n")
            # psql trims the leading and trailing newline of the body, so compare trimmed text.
            if original.count(old_line) != 1 or original.replace(old_line, new_lines).strip() != prod_body.strip():
                raise RuntimeError('FAIL the audience body differs from production by more than the last activity expression')
            print("PASS the audience body is production's except for the last activity expression")

            sql("INSERT INTO table_bookings (id, customer_id, booking_date, status) VALUES"
                " ('10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2026-11-20', 'confirmed'),"
                " ('10000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000001', '2026-09-01', 'completed');")
            sql("UPDATE table_bookings SET status = 'cancelled' WHERE id = '10000000-0000-0000-0000-000000000002';")
            check("(SELECT table_booking_count = 0 AND last_table_booking_date IS NULL FROM customers WHERE id = '00000000-0000-0000-0000-000000000001')",
                  'confirming a booking no longer touches the counters')
            check(f"'{last_activity('00000000-0000-0000-0000-000000000001')}' = '2026-09-01'",
                  'the audience dates last activity by the latest booking that is not cancelled')
            sql("UPDATE table_bookings SET status = 'no_show' WHERE id = '10000000-0000-0000-0000-000000000003';")
            check("(SELECT no_show_count = 1 FROM customers WHERE id = '00000000-0000-0000-0000-000000000001')", 'a no-show still counts')

            counters_before = sql(COUNTERS)
            before = sql(CATALOG)
            sql('BEGIN;\n' + PART2.read_text() + '\nROLLBACK;')
            if sql(CATALOG) != before or sql(COUNTERS) != counters_before:
                raise RuntimeError('FAIL a rolled-back run of part 2 changed something')
            print('PASS a rolled-back run of part 2 changes nothing')

            error = sql_error("BEGIN; INSERT INTO customers (first_name, table_booking_count) SELECT 'Bulk', 1 FROM generate_series(1, 1400);\n"
                              + PART2.read_text() + '\nROLLBACK;')
            if 'far more than expected' not in error:
                raise RuntimeError(f'FAIL part 2 did not refuse an implausible number of rows: {error!r}')
            print('PASS part 2 refuses when far more customers carry a counter than were measured')

            sql(PART2.read_text())
            check("(SELECT count(*) FROM retired_customer_booking_counters_20261027) = 1", 'the copy holds exactly the rows that carry a value')
            check("NOT EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.customers'::regclass AND NOT attisdropped"
                  " AND attname IN ('table_booking_count', 'last_table_booking_date'))", 'both columns are dropped')
            sql("INSERT INTO table_bookings (customer_id, booking_date, status) VALUES ('00000000-0000-0000-0000-000000000003', '2026-12-01', 'confirmed');")
            check("(SELECT count(*) FROM table_bookings WHERE customer_id = '00000000-0000-0000-0000-000000000003') = 1",
                  'a booking still saves after the drop')
            check("NOT has_table_privilege('authenticated', 'retired_customer_booking_counters_20261027', 'SELECT')"
                  " AND NOT has_table_privilege('anon', 'retired_customer_booking_counters_20261027', 'SELECT')"
                  " AND has_table_privilege('service_role', 'retired_customer_booking_counters_20261027', 'SELECT')"
                  " AND (SELECT relrowsecurity FROM pg_class WHERE relname = 'retired_customer_booking_counters_20261027')",
                  'the copy is service_role only with row level security on')

            sql(ROLLBACK2.read_text())
            if sql(COUNTERS) != counters_before:
                raise RuntimeError('FAIL the part 2 rollback did not restore every value')
            print('PASS the part 2 rollback puts every value back and drops the copy')
            check("to_regclass('public.retired_customer_booking_counters_20261027') IS NULL", 'the copy is gone')

            sql(ROLLBACK1.read_text())
            if sql(FUNCTIONS) != baseline_functions:
                raise RuntimeError('FAIL the part 1 rollback did not restore the functions')
            print("PASS the part 1 rollback restores production's bodies and grants exactly")
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

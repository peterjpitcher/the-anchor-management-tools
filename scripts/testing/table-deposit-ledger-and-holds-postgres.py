#!/usr/bin/env python3
"""Run the table deposit ledger and holds migration in an isolated socket-only PostgreSQL database.

BK-223 (customer bookings review of 24 October 2026): a paid PayPal table deposit no longer leaves
a 'pending' ledger row and an active hold behind.

create_table_booking_core_v06 is loaded from the migration that last defined it and patched by
20261016180511, exactly as release 12's harness does, release 12's pacing lines are added,
and its body is checked against production's md5. Bodies are not compiled here (check_function_bodies is off), because the patch
is text: the harness proves it by showing the patched body is production's with only the payments
insert taken out, byte for byte. table_bookings and booking_holds are fixtures with the columns
the triggers read.

Against production's definitions the defect is shown: recording a PayPal capture and cancelling a
booking both leave the payment hold active. Then the migration runs: the core no longer writes a
payments row and still writes the hold; a capture consumes the hold; a cancellation releases it,
or marks it expired when the deposit-timeout cron cancelled for a lapsed hold (whose own update
then finds nothing); a consumed hold is never released, a waitlist hold is never touched, and a
staff session can still cancel although booking_holds is service_role only. The patch also
applies on top of another in-place patch (release 12's pacing lines), a second run is a no-op, a
definition that has moved on fails loudly, grants stay service_role only, a rolled-back run
changes nothing, and the rollback restores the body and removes the triggers.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
MIGRATION = MIGRATIONS / '20261027154848_table_deposit_ledger_and_holds.sql'
ROLLBACK = ROOT / 'tasks/table-deposit-ledger-and-holds/rollback.sql'
LONE_PARTY = MIGRATIONS / '20261016180511_kitchen_pacing_lone_party.sql'
SOURCES = {
    'create_table_booking_core_v06': MIGRATIONS / '20260913120622_booking_start_inside_trading_day.sql',
    'check_table_availability_v06': MIGRATIONS / '20260906155336_outside_private_hire_blocking.sql',
}
# md5(prosrc) before release 12's pacing patch (26 October 2026) and in production on 27 October 2026,
# after release 12's 20261026204729 was applied.
PRE_RELEASE_12_CORE_MD5 = 'e831d41dc33d4331c09db4570fd85003'
PRODUCTION_CORE_MD5 = '7bd5ba3e1bbf40ad350248960e7b75dd'

SETUP = """
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
ALTER DATABASE postgres SET check_function_bodies = off;
CREATE TYPE public.table_allocation_overrides AS (
  ignore_minimum boolean, ignore_hold boolean, allow_unjoined boolean, ignore_accessibility boolean);
-- The columns the triggers read and write.
CREATE TABLE public.table_bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL,
  cancellation_reason text, paypal_deposit_capture_id text);
CREATE TABLE public.booking_holds (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), hold_type text NOT NULL,
  table_booking_id uuid, status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'consumed', 'released', 'expired')),
  consumed_at timestamptz, released_at timestamptz, updated_at timestamptz DEFAULT now());
-- booking_holds is service_role only in production (20261026182434); staff still update bookings.
GRANT SELECT, UPDATE ON public.table_bookings TO authenticated;
GRANT ALL ON public.booking_holds TO service_role;
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean, text) TO PUBLIC;

-- One PayPal booking, one staff-cancelled, one lapsed, one paid then cancelled, one waitlist hold.
INSERT INTO table_bookings (id, status) VALUES
  ('b0000000-0000-0000-0000-000000000001', 'pending_payment'),
  ('b0000000-0000-0000-0000-000000000002', 'pending_payment'),
  ('b0000000-0000-0000-0000-000000000003', 'pending_payment'),
  ('b0000000-0000-0000-0000-000000000004', 'pending_payment');
INSERT INTO booking_holds (id, hold_type, table_booking_id) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'payment_hold', 'b0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000002', 'payment_hold', 'b0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003', 'payment_hold', 'b0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000004', 'payment_hold', 'b0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000005', 'waitlist_hold', 'b0000000-0000-0000-0000-000000000002');
"""

CORE = "(SELECT prosrc FROM pg_proc WHERE proname = 'create_table_booking_core_v06')"
CATALOG = """SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:' || proname || ':' || md5(prosrc) || ':' || coalesce(proacl::text, '') AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'trg:' || tgname FROM pg_trigger WHERE NOT tgisinternal) s;"""
HOLDS = "SELECT string_agg(id || '=' || status, ',' ORDER BY id) FROM booking_holds;"

# What release 12's 20261026204729 does to the same function: a few lines put before the pacing test.
RELEASE_12_ANCHOR = 'IF v_existing_covers > 0 AND v_existing_covers + p_party_size > v_ceiling THEN'
RELEASE_12_LINES = ("-- Owner decision D29: food at private hires and events that night counts too.\n"
                    "      v_existing_covers := v_existing_covers\n"
                    "        + public.kitchen_food_load_covers(p_booking_date, v_center_minutes - v_half, v_center_minutes + v_half);\n\n      ")


def definition(name):
    text = SOURCES[name].read_text()
    start = text.index(f'CREATE OR REPLACE FUNCTION public.{name}(')
    end = text.index('\n$function$;', start) + len('\n$function$;')
    return text[start:end]


def block(source, start_marker, end_marker):
    text = source.read_text()
    start = text.index(start_marker) + len(start_marker)
    return text[start:text.index(end_marker, start)]


def main():
    insert_text = block(MIGRATION, 'v_insert text := $insert$', '$insert$;')
    note_text = block(MIGRATION, 'v_note text := $note$', '$note$;')
    with tempfile.TemporaryDirectory(prefix='bk223-pg-') as folder:
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

        def literal(text):
            return "$lit$" + text + "$lit$"

        try:
            sql(SETUP)
            for name in SOURCES:
                sql(definition(name) + ';')
                sql(f"REVOKE ALL ON FUNCTION public.{name} FROM PUBLIC, anon, authenticated;"
                    f"GRANT EXECUTE ON FUNCTION public.{name} TO service_role;")
            sql(LONE_PARTY.read_text())
            check(f"md5({CORE}) = '{PRE_RELEASE_12_CORE_MD5}'", 'create_table_booking_core_v06 loads as it was before release 12')
            sql(f"DO $$ BEGIN EXECUTE replace(pg_get_functiondef('create_table_booking_core_v06'::regproc), "
                f"{literal(RELEASE_12_ANCHOR)}, {literal(RELEASE_12_LINES + RELEASE_12_ANCHOR)}); END $$;")
            check(f"md5({CORE}) = '{PRODUCTION_CORE_MD5}'", "with release 12's pacing lines it is production's body exactly")
            production_core = sql(f"SELECT md5({CORE});")
            check(f"position({literal(insert_text)} in pg_get_functiondef('create_table_booking_core_v06'::regproc)) > 0",
                  "the migration's payments insert is production's text exactly")

            # The defect.
            sql("BEGIN; UPDATE table_bookings SET status = 'confirmed', paypal_deposit_capture_id = 'CAP-1' WHERE id = 'b0000000-0000-0000-0000-000000000001';"
                " UPDATE table_bookings SET status = 'cancelled' WHERE id = 'b0000000-0000-0000-0000-000000000002';"
                " SELECT fixture_assert((SELECT bool_and(status = 'active') FROM booking_holds WHERE hold_type = 'payment_hold'"
                " AND table_booking_id IN ('b0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002')),"
                " 'baseline defect: a paid deposit and a cancelled booking both leave the payment hold active'); ROLLBACK;")

            baseline = sql(CATALOG)
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the functions or triggers')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(f"position('INSERT INTO public.payments' in {CORE}) = 0", 'the core no longer writes a payments row')
            check(f"position('INSERT INTO public.booking_holds' in {CORE}) > 0", 'the core still writes the payment hold')
            check(f"md5(replace({CORE}, {literal(note_text)}, {literal(insert_text)})) = '{PRODUCTION_CORE_MD5}'",
                  "the patched body is production's with only the payments insert taken out")
            patched = sql(f"SELECT md5({CORE});")
            sql(MIGRATION.read_text())
            check(f"md5({CORE}) = '{patched}'", 'a second run is a no-op')
            check("NOT has_function_privilege('authenticated', 'create_table_booking_core_v06'::regproc, 'EXECUTE')"
                  " AND NOT has_function_privilege('anon', 'create_table_booking_core_v06'::regproc, 'EXECUTE')"
                  " AND has_function_privilege('service_role', 'create_table_booking_core_v06'::regproc, 'EXECUTE')",
                  'the core stays service_role only')
            for fn in ('table_booking_payment_hold_on_capture', 'table_booking_payment_hold_on_cancel'):
                check(f"NOT has_function_privilege('authenticated', '{fn}()'::regprocedure, 'EXECUTE')"
                      f" AND NOT has_function_privilege('anon', '{fn}()'::regprocedure, 'EXECUTE')"
                      f" AND (SELECT prosecdef AND proconfig = ARRAY['search_path=public'] FROM pg_proc WHERE proname = '{fn}')",
                      f'{fn} is SECURITY DEFINER, fixed search_path, not executable by anon or authenticated')

            sql("UPDATE table_bookings SET status = 'confirmed', paypal_deposit_capture_id = 'CAP-1' WHERE id = 'b0000000-0000-0000-0000-000000000001';")
            check("(SELECT status = 'consumed' AND consumed_at IS NOT NULL FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000001')",
                  'recording a PayPal capture consumes the payment hold')
            sql("UPDATE table_bookings SET status = 'cancelled', cancellation_reason = 'guest' WHERE id = 'b0000000-0000-0000-0000-000000000001';")
            check("(SELECT status = 'consumed' AND released_at IS NULL FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000001')",
                  'a consumed hold is not released when the paid booking is later cancelled')

            sql("SET ROLE authenticated; UPDATE table_bookings SET status = 'cancelled', cancellation_reason = 'staff' WHERE id = 'b0000000-0000-0000-0000-000000000002'; RESET ROLE;")
            check("(SELECT status = 'released' AND released_at IS NOT NULL FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000002')",
                  'a staff session cancelling a booking releases its payment hold')
            check("(SELECT status = 'active' FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000005')",
                  'a waitlist hold on the same booking is not touched')

            sql("UPDATE table_bookings SET status = 'cancelled', cancellation_reason = 'payment_hold_expired' WHERE id = 'b0000000-0000-0000-0000-000000000003';")
            check("(SELECT status = 'expired' FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000003')",
                  'a cancellation for a lapsed hold marks the hold expired, as the deposit-timeout cron does')
            touched = sql("WITH cron AS (UPDATE booking_holds SET status = 'expired' WHERE table_booking_id = 'b0000000-0000-0000-0000-000000000003'"
                          " AND hold_type = 'payment_hold' AND status = 'active' RETURNING 1) SELECT count(*) FROM cron;")
            if touched != '0':
                raise RuntimeError(f"FAIL the cron's own hold update still found {touched} active hold(s)")
            print("PASS the cron's own hold update then finds nothing left to do")

            sql("UPDATE table_bookings SET status = 'confirmed' WHERE id = 'b0000000-0000-0000-0000-000000000004';")
            check("(SELECT status = 'active' FROM booking_holds WHERE id = 'a0000000-0000-0000-0000-000000000004')",
                  'confirming without a capture leaves the hold alone')

            # The patch on top of release 12's pacing lines, and a definition that has moved on.
            sql(ROLLBACK.read_text())
            check(f"md5({CORE}) = '{production_core}'", 'the rollback restores the core body exactly')
            check("NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname LIKE 'table_booking_payment_hold_on_%')"
                  " AND to_regprocedure('table_booking_payment_hold_on_capture()') IS NULL",
                  'the rollback removes both triggers and their functions')
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL the rollback did not restore the functions and triggers')
            print('PASS the rollback restores production exactly')

            check(f"position('kitchen_food_load_covers' in {CORE}) > 0", "the patch and its rollback keep release 12's pacing lines")
            sql(f"DO $$ BEGIN EXECUTE replace(pg_get_functiondef('create_table_booking_core_v06'::regproc), "
                f"{literal(RELEASE_12_LINES + RELEASE_12_ANCHOR)}, {literal(RELEASE_12_ANCHOR)}); END $$;")
            sql(MIGRATION.read_text())
            check(f"position('INSERT INTO public.payments' in {CORE}) = 0 AND md5(replace({CORE}, {literal(note_text)}, {literal(insert_text)})) = '{PRE_RELEASE_12_CORE_MD5}'",
                  'the patch also applies to the body without release 12 (either order)')
            sql(ROLLBACK.read_text())
            check(f"md5({CORE}) = '{PRE_RELEASE_12_CORE_MD5}'", 'and its rollback restores that body exactly')

            sql(f"DO $$ BEGIN EXECUTE replace(pg_get_functiondef('create_table_booking_core_v06'::regproc), "
                f"{literal(insert_text)}, {literal(insert_text + insert_text)}); END $$;")
            error = sql_error(MIGRATION.read_text())
            if 'has 2 payments inserts and 0 notes, expected 1 and 0' not in error:
                raise RuntimeError(f'FAIL a definition that has moved on was patched: {error!r}')
            print('PASS a definition that has moved on makes the migration fail loudly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

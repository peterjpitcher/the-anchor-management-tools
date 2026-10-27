#!/usr/bin/env python3
"""Run the promo-audience-consent-basis migration in an isolated socket-only PostgreSQL database.

get_cross_promo_audience is loaded as production holds it (the rollback file; md5 checked) over
fixture tables with the columns it reads, and production's grants (service_role only). Six past
guests of one event category are seeded, each with a different consent history. Against that
baseline it shows the defect: a guest booked by staff, with no consent row at all, is picked for
the promotional texts. Then the migration runs: that guest and a guest with only a staff service
row are left out; a ticked opt-in, a staff-recorded yes, a soft opt-in row, a June 2026 legacy
marketing row and a website booking notice still qualify; an opted-out guest stays out; grants
and the function's header are unchanged. It also checks that a rolled-back run changes nothing
and that the rollback restores production's body and grants exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026224114_promo_audience_consent_basis.sql'
ROLLBACK = ROOT / 'tasks/promo-audience-consent-basis/rollback.sql'
SIGNATURE = 'get_cross_promo_audience(uuid,uuid,integer,integer,integer,integer,integer)'
PRODUCTION_MD5 = '2e7eb2740facd6397bea90194ae0c661'
EXPECTED_MD5 = 'f70680df53506c3b4fe5db3e77e96ce2'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.event_categories (id uuid PRIMARY KEY, name text);
CREATE TABLE public.events (id uuid PRIMARY KEY, category_id uuid, name text, date date, event_status text);
CREATE TABLE public.customers (id uuid PRIMARY KEY, first_name text, last_name text, mobile_e164 text,
  sms_opt_in boolean, marketing_sms_opted_out_at timestamptz, sms_status text);
CREATE TABLE public.bookings (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, event_id uuid,
  seats integer, status text, is_reminder_only boolean DEFAULT false);
CREATE TABLE public.sms_promo_context (customer_id uuid, event_id uuid, created_at timestamptz DEFAULT now());
CREATE TABLE public.customer_consents (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), customer_id uuid, channel text,
  purpose text, status text, legal_basis text, source text, capture_method text);

INSERT INTO public.event_categories VALUES ('c0000000-0000-4000-8000-000000000001', 'Quiz Night');
INSERT INTO public.events VALUES
  ('e0000000-0000-4000-8000-000000000001', 'c0000000-0000-4000-8000-000000000001', 'Quiz Night (past)', CURRENT_DATE - 20, NULL),
  ('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001', 'Quiz Night (next)', CURRENT_DATE + 10, NULL);

-- name, consent rows, opted out?
CREATE TEMP TABLE guests (n integer, name text, opted_out boolean);
INSERT INTO guests VALUES
  (1, 'No consent row (booked at FOH)', false),
  (2, 'Staff service row only', false),
  (3, 'Ticked marketing on the website', false),
  (4, 'Said yes to staff', false),
  (5, 'Soft opt-in from a booking notice', false),
  (6, 'June legacy marketing row', false),
  (7, 'Website event notice row', false),
  (8, 'Opted out after ticking', true);
INSERT INTO public.customers
  SELECT ('a0000000-0000-4000-8000-00000000000' || n)::uuid, name, 'Guest', '+4471234567' || lpad(n::text, 2, '0'),
         true, CASE WHEN opted_out THEN now() ELSE NULL END, 'active'
  FROM guests;
INSERT INTO public.bookings (customer_id, event_id, seats, status)
  SELECT ('a0000000-0000-4000-8000-00000000000' || n)::uuid, 'e0000000-0000-4000-8000-000000000001', 2, 'confirmed' FROM guests;
INSERT INTO public.customer_consents (customer_id, channel, purpose, status, legal_basis, source, capture_method) VALUES
  ('a0000000-0000-4000-8000-000000000002', 'sms', 'service', 'opted_in', 'legitimate_interests', 'staff_table_booking', 'service_notice'),
  ('a0000000-0000-4000-8000-000000000003', 'sms', 'marketing', 'opted_in', 'consent', 'public_table_booking', 'checkbox'),
  ('a0000000-0000-4000-8000-000000000004', 'sms', 'marketing', 'opted_in', 'consent', 'staff_table_booking', 'staff_verbal'),
  ('a0000000-0000-4000-8000-000000000005', 'sms', 'marketing', 'opted_in', 'soft_opt_in', 'public_event_booking', 'service_notice'),
  ('a0000000-0000-4000-8000-000000000006', 'sms', 'marketing', 'legacy', 'unknown', 'system_migration', 'system_migration'),
  ('a0000000-0000-4000-8000-000000000007', 'sms', 'service', 'opted_in', 'legitimate_interests', 'public_event_booking', 'service_notice'),
  ('a0000000-0000-4000-8000-000000000008', 'sms', 'marketing', 'opted_in', 'consent', 'public_table_booking', 'checkbox'),
  -- An email row is not a basis for texts.
  ('a0000000-0000-4000-8000-000000000001', 'email', 'marketing', 'opted_in', 'consent', 'public_table_booking', 'checkbox');

CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
-- Who the audience picks for the next quiz, as the guest numbers in name order.
CREATE FUNCTION fixture_picked() RETURNS text LANGUAGE sql SECURITY DEFINER AS $$
  SELECT coalesce(string_agg(right(customer_id::text, 1), ',' ORDER BY customer_id), '')
  FROM public.get_cross_promo_audience('e0000000-0000-4000-8000-000000000002', 'c0000000-0000-4000-8000-000000000001',
                                       180, 180, 14, 2, 30) $$;
"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk079-pg-') as folder:
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

        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label.replace("'", "''") + "');")

        def definition():
            return sql(f"SELECT md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text, '') || ' ' "
                       f"|| pg_get_function_result(oid) || ' ' || "
                       f"has_function_privilege('anon', oid, 'EXECUTE')::text || has_function_privilege('authenticated', oid, 'EXECUTE')::text "
                       f"|| has_function_privilege('service_role', oid, 'EXECUTE')::text "
                       f"FROM pg_proc WHERE oid = 'public.{SIGNATURE}'::regprocedure;")

        try:
            # The function body is created before SETUP's helper, so the helper can call it.
            sql(SETUP.split('CREATE FUNCTION fixture_picked()')[0])
            sql(ROLLBACK.read_text())
            sql('CREATE FUNCTION fixture_picked()' + SETUP.split('CREATE FUNCTION fixture_picked()')[1])
            baseline = definition()
            check(f"split_part('{baseline}', ' ', 1) = '{PRODUCTION_MD5}'", 'baseline: the function is loaded as production holds it')
            check(f"'{baseline}' LIKE '% falsefalsetrue'", 'baseline: only service_role can run it, as in production')

            picked = sql('SELECT fixture_picked();')
            if picked != '1,2,3,4,5,6,7':
                raise RuntimeError(f'FAIL unexpected baseline audience {picked!r}')
            print('PASS baseline defect: guests with no basis (1 booked at FOH, 2 with a staff service row) are picked')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if definition() != baseline or sql('SELECT fixture_picked();') != picked:
                raise RuntimeError('FAIL a rolled-back run changed the function')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            after = sql('SELECT fixture_picked();')
            if after != '3,4,5,6,7':
                raise RuntimeError(f'FAIL unexpected audience after the migration {after!r}')
            print('PASS no basis, no promotion: the FOH guest and the staff-service-only guest are left out')
            print('PASS a tick, a yes to staff, a soft opt-in, a June legacy row and a website notice still qualify')
            print('PASS an opted-out guest stays out (8)')

            new_definition = definition()
            check(f"split_part('{new_definition}', ' ', 1) = '{EXPECTED_MD5}'", 'the body is the reviewed one (md5 f70680df)')
            check(f"split_part('{new_definition}', ' ', 2) = 'true' AND split_part('{new_definition}', ' ', 3) = '{{search_path=public}}'",
                  'SECURITY DEFINER and its search_path are unchanged')
            check(f"'{new_definition}' LIKE '% falsefalsetrue'", 'grants unchanged: service_role only')

            sql(ROLLBACK.read_text())
            if definition() != baseline:
                raise RuntimeError('FAIL the rollback did not restore production exactly')
            if sql('SELECT fixture_picked();') != picked:
                raise RuntimeError('FAIL the rollback did not restore the audience')
            print('PASS the rollback restores production body and grants exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

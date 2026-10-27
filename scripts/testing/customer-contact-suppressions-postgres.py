#!/usr/bin/env python3
"""Run the customer contact suppressions migration in an isolated socket-only PostgreSQL database.

BK-161 (customer bookings review of 24 October 2026): deleting or erasing a customer keeps their
opt-outs. The customers table is a fixture with production's opt-out columns and status checks.
Against it the defect is shown first: a customer who said STOP and unsubscribed from marketing is
erased, books again from the same number and comes back SMS-active. Then the migration runs: the
same story leaves the new record opted out of exactly what the old one was, by phone or by email;
a contact with no opt-outs gets no row; a second erasure keeps the most restrictive state; an
opt-in recorded after creation stands; a phone changed to a suppressed one picks the opt-outs up;
a signed-in session can still create a customer (the trigger reads the list as its owner) but
can neither read the list nor call the functions. It also checks that a rolled-back run changes
nothing and that the rollback removes every object.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027154844_customer_contact_suppressions.sql'
ROLLBACK = ROOT / 'tasks/customer-contact-suppressions/rollback.sql'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Production's opt-out columns, defaults and status checks (read 27 October 2026).
CREATE TABLE public.customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name text NOT NULL, last_name text NOT NULL,
  mobile_number text, mobile_e164 varchar UNIQUE, email varchar,
  sms_opt_in boolean DEFAULT true,
  sms_status text NOT NULL DEFAULT 'active' CHECK (sms_status IN ('active', 'opted_out', 'sms_deactivated')),
  messaging_status text DEFAULT 'active' CHECK (messaging_status IN ('active', 'suspended', 'invalid_number', 'opted_out')),
  whatsapp_opt_in boolean NOT NULL DEFAULT false,
  whatsapp_status text NOT NULL DEFAULT 'unknown'
    CHECK (whatsapp_status IN ('unknown', 'active', 'opted_out', 'whatsapp_deactivated', 'invalid')),
  marketing_sms_opt_in boolean NOT NULL DEFAULT false,
  marketing_email_opt_in boolean NOT NULL DEFAULT false,
  marketing_whatsapp_opt_in boolean NOT NULL DEFAULT false,
  sms_opted_out_at timestamptz, whatsapp_opted_out_at timestamptz,
  marketing_sms_opted_out_at timestamptz, marketing_email_opted_out_at timestamptz,
  marketing_whatsapp_opted_out_at timestamptz
);
CREATE UNIQUE INDEX customers_email_unique ON public.customers (lower(email::text));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.customers TO authenticated, service_role;
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean, text) TO PUBLIC;

-- What the app's erasure writes to the customer row: phone and email gone, every channel off.
CREATE FUNCTION fixture_erase(p_id uuid) RETURNS void LANGUAGE sql AS $$
  UPDATE public.customers SET first_name = 'Erased', last_name = 'Customer', mobile_number = '07700900000',
    mobile_e164 = NULL, email = NULL, sms_opt_in = false, sms_status = 'opted_out', marketing_sms_opt_in = false,
    marketing_email_opt_in = false, whatsapp_opt_in = false, whatsapp_status = 'opted_out'
  WHERE id = p_id $$;

-- Sam said STOP to texts and unsubscribed from marketing email; Alex never opted out of anything.
INSERT INTO public.customers (id, first_name, last_name, mobile_number, mobile_e164, email, sms_opt_in, sms_status,
  sms_opted_out_at, marketing_email_opted_out_at)
VALUES ('00000000-0000-0000-0000-000000000001', 'Sam', 'Stop', '+447700900001', '+447700900001', 'Sam@Example.com',
  false, 'opted_out', '2026-05-01', '2026-05-02');
INSERT INTO public.customers (id, first_name, last_name, mobile_number, mobile_e164, email)
VALUES ('00000000-0000-0000-0000-000000000002', 'Alex', 'Active', '+447700900002', '+447700900002', 'alex@example.com');
"""

CATALOG = """SELECT string_agg(x, ',' ORDER BY x) FROM (
  SELECT 'fn:' || proname || ':' || md5(prosrc) AS x FROM pg_proc WHERE pronamespace = 'public'::regnamespace
  UNION ALL SELECT 'rel:' || relname FROM pg_class WHERE relnamespace = 'public'::regnamespace AND relkind = 'r'
  UNION ALL SELECT 'trg:' || tgname FROM pg_trigger WHERE NOT tgisinternal) s;"""


def main():
    with tempfile.TemporaryDirectory(prefix='bk161-pg-') as folder:
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

        def status(phone):
            return sql(f"SELECT sms_status || '/' || sms_opt_in || '/' || (marketing_email_opted_out_at IS NOT NULL) "
                       f"|| '/' || (marketing_sms_opted_out_at IS NOT NULL) FROM customers WHERE mobile_e164 = '{phone}';")

        try:
            sql(SETUP)
            baseline = sql(CATALOG)

            # The defect: erased, then back from the same number, and SMS-active again.
            sql("BEGIN; SELECT fixture_erase('00000000-0000-0000-0000-000000000001');"
                "INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164) VALUES ('Sam', 'Again', '+447700900001', '+447700900001');"
                "SELECT fixture_assert((SELECT sms_status = 'active' AND sms_opt_in FROM customers WHERE first_name = 'Sam' AND last_name = 'Again'),"
                " 'baseline defect: an erased customer who said STOP comes back SMS-active'); ROLLBACK;")

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL a rolled-back run changed the catalog')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())

            check("customer_contact_hash('phone', '+44 7700 900001') = customer_contact_hash('phone', '+447700900001')",
                  'the phone hash ignores spaces')
            check("customer_contact_hash('email', ' Sam@Example.COM ') = customer_contact_hash('email', 'sam@example.com')",
                  'the email hash ignores case and outer spaces')
            check("customer_contact_hash('phone', '') IS NULL AND customer_contact_hash('email', NULL) IS NULL",
                  'an empty contact has no hash')
            check("customer_contact_hash('phone', '+447700900001') <> customer_contact_hash('email', '+447700900001')",
                  'a phone and an email with the same text hash apart')

            check("record_customer_contact_suppression(ARRAY['00000000-0000-0000-0000-000000000001'::uuid,"
                  " '00000000-0000-0000-0000-000000000002'::uuid], 'customer_deleted') = 2",
                  "recording two customers writes two rows: Sam's phone and email, nothing for Alex")
            check("(SELECT count(*) FROM customer_contact_suppressions) = 2 AND NOT EXISTS (SELECT 1 FROM customer_contact_suppressions"
                  " WHERE contact_hash = customer_contact_hash('phone', '+447700900002'))",
                  'a contact that never opted out of anything is not listed')
            check("(SELECT sms_opted_out AND marketing_email_opted_out AND NOT marketing_sms_opted_out FROM customer_contact_suppressions"
                  " WHERE contact_kind = 'phone')", 'the row carries exactly the opt-outs the customer had')
            check("NOT EXISTS (SELECT 1 FROM customer_contact_suppressions WHERE contact_hash LIKE '%7700%')",
                  'no readable phone number is kept')

            sql("SELECT fixture_erase('00000000-0000-0000-0000-000000000001');")
            sql("INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164) VALUES ('Sam', 'Again', '+447700900001', '+447700900001');")
            check(f"'{status('+447700900001')}' = 'opted_out/false/true/false'",
                  'back from the same number, the new record starts opted out of SMS and marketing email, and nothing else')
            sql("DELETE FROM customers WHERE last_name = 'Again';")

            sql("INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164, email) VALUES ('Sam', 'Email', '+447700900009', '+447700900009', 'SAM@example.com ');")
            check(f"'{status('+447700900009')}' = 'opted_out/false/true/false'",
                  'back with a new number but the same email, the opt-outs follow the email')

            sql("UPDATE customers SET sms_status = 'active', sms_opt_in = true, sms_opted_out_at = NULL WHERE last_name = 'Email';")
            check(f"'{status('+447700900009')}' = 'active/true/true/false'",
                  'an opt-in recorded after the record was created stands')

            sql("INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164) VALUES ('Lee', 'Later', '+447700900010', '+447700900010');")
            check(f"'{status('+447700900010')}' = 'active/true/false/false'", 'an unlisted new customer is untouched')
            sql("UPDATE customers SET mobile_e164 = '+447700900001', mobile_number = '+447700900001' WHERE last_name = 'Later';")
            check(f"'{status('+447700900001')}' = 'opted_out/false/true/false'",
                  'a phone changed to a listed one picks up its opt-outs')
            sql("UPDATE customers SET first_name = 'Leo' WHERE last_name = 'Later';")
            check("(SELECT sms_status = 'opted_out' FROM customers WHERE last_name = 'Later')",
                  'an update that does not change the phone or email leaves the row alone')

            # Alex later opts out of marketing texts and is erased: the most restrictive state is kept.
            sql("UPDATE customers SET marketing_sms_opted_out_at = now() WHERE id = '00000000-0000-0000-0000-000000000002';")
            check("record_customer_contact_suppression(ARRAY['00000000-0000-0000-0000-000000000002'::uuid], 'gdpr_erasure') = 2",
                  "a second customer's erasure lists both their contacts")
            sql("UPDATE customers SET marketing_sms_opted_out_at = NULL, sms_status = 'opted_out' WHERE id = '00000000-0000-0000-0000-000000000002';")
            sql("SELECT record_customer_contact_suppression(ARRAY['00000000-0000-0000-0000-000000000002'::uuid], 'customer_merged');")
            check("(SELECT sms_opted_out AND marketing_sms_opted_out FROM customer_contact_suppressions"
                  " WHERE contact_hash = customer_contact_hash('phone', '+447700900002'))",
                  'recording the same contact again keeps every opt-out it ever carried')

            error = sql_error("SELECT record_customer_contact_suppression(ARRAY[gen_random_uuid()], 'tidy');")
            if 'unknown source' not in error:
                raise RuntimeError(f'FAIL an unknown source was not refused: {error!r}')
            print('PASS an unknown source is refused')
            check("record_customer_contact_suppression(ARRAY[]::uuid[], 'customer_deleted') = 0",
                  'no customers, nothing recorded')

            sql("SELECT fixture_erase('00000000-0000-0000-0000-000000000002');")
            sql("SET ROLE authenticated; INSERT INTO customers (first_name, last_name, mobile_number, mobile_e164, email)"
                " VALUES ('Staff', 'Made', '+447700900011', '+447700900011', 'alex@example.com'); RESET ROLE;")
            check(f"'{status('+447700900011')}' = 'opted_out/false/false/true'",
                  'a customer created from a signed-in session is still checked against the list')
            for statement, label in (
                ("SELECT count(*) FROM customer_contact_suppressions", 'read the list'),
                ("SELECT record_customer_contact_suppression(ARRAY[gen_random_uuid()], 'customer_deleted')", 'record a suppression'),
                ("SELECT customer_contact_hash('phone', '+447700900001')", 'hash a contact'),
            ):
                for role in ('anon', 'authenticated'):
                    error = sql_error(f'SET ROLE {role}; {statement};')
                    if 'permission denied' not in error:
                        raise RuntimeError(f'FAIL {role} could {label}: {error!r}')
                print(f'PASS anon and authenticated cannot {label}')
            check("has_function_privilege('service_role', 'record_customer_contact_suppression(uuid[], text)', 'EXECUTE')"
                  " AND has_table_privilege('service_role', 'customer_contact_suppressions', 'SELECT')",
                  'service_role can record and read')
            check("(SELECT relrowsecurity FROM pg_class WHERE relname = 'customer_contact_suppressions')",
                  'the list has row level security on')
            check("(SELECT bool_and(prosecdef AND proconfig = ARRAY['search_path=public']) FROM pg_proc"
                  " WHERE proname IN ('record_customer_contact_suppression', 'apply_customer_contact_suppression'))",
                  'the writer and the trigger are SECURITY DEFINER with a fixed search_path')

            sql(ROLLBACK.read_text())
            if sql(CATALOG) != baseline:
                raise RuntimeError('FAIL the rollback did not restore the catalog')
            print('PASS the rollback removes every object the migration added')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

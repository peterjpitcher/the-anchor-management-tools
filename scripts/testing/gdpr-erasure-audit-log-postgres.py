#!/usr/bin/env python3
"""Run the GDPR erasure audit-log migration in an isolated socket-only PostgreSQL database.

audit_logs is built with production's columns and its two guard triggers, and
prevent_audit_log_update is loaded as production holds it (the rollback file). Against that
baseline it shows the defect: an erasure cannot take a guest's phone and email out of the audit
rows about them, because every UPDATE is refused. Then the migration runs: the service role's
scrub takes the personal keys out of the rows about the erased customer and their bookings and
leaves ids, statuses and every other customer's rows alone; the flag it uses does not outlive the
call; every other update and every delete is still refused, including one made with the flag set
that changes a column or adds a key; anon and authenticated cannot run the scrub. It also checks
that a rolled-back run changes nothing, that the migration's own assertion catches a re-grant,
and that the rollback restores production's trigger function exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261026193741_gdpr_erasure_audit_log.sql'
ROLLBACK = ROOT / 'tasks/gdpr-erasure-audit-log/rollback.sql'
PRODUCTION_TRIGGER_MD5 = 'f6de7f9de4f2184d4cb0f45777356bca'
SCRUB = 'public.gdpr_scrub_audit_logs_v01(uuid[],uuid[])'

ERASED = 'c1000000-0000-0000-0000-000000000001'
OTHER = 'c2000000-0000-0000-0000-000000000002'
ERASED_BOOKING = 'b1000000-0000-0000-0000-000000000001'
OTHER_BOOKING = 'b2000000-0000-0000-0000-000000000002'

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE TABLE public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid, user_email text, operation_type text NOT NULL, resource_type text NOT NULL,
  resource_id text, operation_status text NOT NULL, ip_address inet, user_agent text,
  old_values jsonb, new_values jsonb, error_message text, additional_info jsonb);
GRANT SELECT ON public.audit_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
GRANT ALL ON public.audit_logs TO service_role;
CREATE FUNCTION public.prevent_audit_log_update() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$;
CREATE FUNCTION public.prevent_audit_log_deletion() RETURNS trigger LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog' AS $$
BEGIN
  RAISE EXCEPTION 'Audit logs cannot be deleted';
END;
$$;
CREATE TRIGGER prevent_audit_log_update BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_update();
CREATE TRIGGER prevent_audit_log_delete BEFORE DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_deletion();
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
"""

SEED = f"""
INSERT INTO audit_logs(id, operation_type, resource_type, resource_id, operation_status, user_email, new_values) VALUES
 ('a0000000-0000-0000-0000-000000000001', 'create', 'customer', '{ERASED}', 'success', 'staff@example.com',
  '{{"id": "{ERASED}", "first_name": "Jo", "last_name": "Guest", "email": "jo@example.com", "mobile_e164": "+447700900123", "sms_opt_in": true}}'),
 ('a0000000-0000-0000-0000-000000000003', 'create', 'customer', '{OTHER}', 'success', 'staff@example.com',
  '{{"id": "{OTHER}", "first_name": "Sam", "email": "sam@example.com"}}');
INSERT INTO audit_logs(id, operation_type, resource_type, resource_id, operation_status, old_values) VALUES
 ('a0000000-0000-0000-0000-000000000002', 'delete', 'customer', '{ERASED}', 'success',
  '{{"id": "{ERASED}", "mobile_number": "07700900123", "internal_notes": "Rang about her allergy"}}');
INSERT INTO audit_logs(id, operation_type, resource_type, resource_id, operation_status, additional_info) VALUES
 ('a0000000-0000-0000-0000-000000000004', 'create', 'booking', '{ERASED_BOOKING}', 'success',
  '{{"customerId": "{ERASED}", "customerName": "Jo Guest", "seats": 2, "eventName": "Quiz"}}'),
 ('a0000000-0000-0000-0000-000000000005', 'create', 'booking', '{OTHER_BOOKING}', 'success',
  '{{"customerId": "{OTHER}", "customerName": "Sam Other", "seats": 1}}'),
 ('a0000000-0000-0000-0000-000000000006', 'update', 'event_booking', '{ERASED_BOOKING}', 'success',
  '{{"field": "guest_details", "guest_count": 2}}'),
 ('a0000000-0000-0000-0000-000000000007', 'update', 'invoice', 'inv-1', 'success',
  '{{"customer_name": "Jo Guest"}}');
"""


def main():
    with tempfile.TemporaryDirectory(prefix='gdpr-audit-pg-') as folder:
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

        def refused(statement, reason, label):
            error = sql_error(statement)
            if reason not in error: raise RuntimeError(f'FAIL {label}: {error!r}')
            print('PASS ' + label)

        def can(role): return f"has_function_privilege('{role}', '{SCRUB}'::regprocedure, 'EXECUTE')"

        def trigger_definition():
            return sql("SELECT md5(prosrc) || ' ' || prosecdef::text || ' ' || coalesce(proconfig::text, '') "
                       "FROM pg_proc WHERE oid = 'public.prevent_audit_log_update()'::regprocedure;")

        def scrub_exists(): return sql("SELECT to_regprocedure('public.gdpr_scrub_audit_logs_v01(uuid[],uuid[])') IS NOT NULL;")

        def row(audit_id, column): return f"(SELECT {column} FROM audit_logs WHERE id = 'a0000000-0000-0000-0000-00000000000{audit_id}')"

        try:
            sql(SETUP)
            sql(ROLLBACK.read_text())
            sql(SEED)
            baseline = trigger_definition()
            check(f"split_part('{baseline}', ' ', 1) = '{PRODUCTION_TRIGGER_MD5}'",
                  'baseline: the audit trigger is loaded as production holds it')
            check(f"'{baseline}' LIKE '% false {{\"search_path=public, pg_catalog\"}}'",
                  'baseline: SECURITY INVOKER with search_path public, pg_catalog')
            refused(f"UPDATE audit_logs SET new_values = new_values - 'mobile_e164' WHERE resource_id = '{ERASED}';",
                    'Audit logs cannot be modified',
                    'baseline defect: an erasure cannot take a phone number out of the audit rows')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if trigger_definition() != baseline or scrub_exists() != 'f':
                raise RuntimeError('FAIL a rolled-back run changed the functions')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            check(f"NOT {can('anon')} AND NOT {can('authenticated')}", 'anon and authenticated cannot run the scrub')
            check(can('service_role'), 'the service role can run the scrub')
            check("(SELECT NOT prosecdef AND proconfig = ARRAY['search_path=public, pg_catalog'] FROM pg_proc "
                  "WHERE oid = 'public.prevent_audit_log_update()'::regprocedure)",
                  'the audit trigger keeps SECURITY INVOKER and its search_path')
            check(f"(SELECT prosecdef AND proconfig = ARRAY['search_path=public, pg_catalog'] FROM pg_proc WHERE oid = '{SCRUB}'::regprocedure)",
                  'the scrub is SECURITY DEFINER with a fixed search_path')
            for role in ('anon', 'authenticated'):
                refused(f"SET ROLE {role}; SELECT gdpr_scrub_audit_logs_v01(ARRAY['{ERASED}']::uuid[], '{{}}');",
                        'permission denied for function', f'a call as {role} is refused')

            before_other = sql(f"SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM audit_logs a WHERE id IN "
                               "('a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000007');")
            # One transaction, so the flag's state after the call is the state the rest of the
            # transaction would see.
            scrubbed = sql(f"BEGIN; SET LOCAL ROLE service_role; "
                           f"SELECT gdpr_scrub_audit_logs_v01(ARRAY['{ERASED}']::uuid[], ARRAY['{ERASED_BOOKING}']::uuid[]); "
                           "SELECT '[' || coalesce(current_setting('app.gdpr_audit_scrub', true), '<unset>') || ']'; COMMIT;").splitlines()
            if scrubbed[0] != '3':
                raise RuntimeError(f'FAIL the scrub should touch three rows: {scrubbed!r}')
            print('PASS the scrub touches the three rows that hold the erased guest\'s details')
            if scrubbed[1:] != ['[]']:
                raise RuntimeError(f'FAIL the scrub left its flag on: {scrubbed!r}')
            print('PASS the flag that lets the scrub through is off again when it returns')
            check(f"NOT {row(1, 'new_values')} ?| ARRAY['first_name','last_name','email','mobile_e164']",
                  'the customer row loses the name, email and phone')
            check(f"{row(1, 'new_values')} = '{{\"id\": \"{ERASED}\", \"sms_opt_in\": true}}'::jsonb",
                  'the customer row keeps its id and consent fields')
            check(f"{row(2, 'old_values')} = '{{\"id\": \"{ERASED}\"}}'::jsonb", 'the deleted customer row loses the mobile and the note')
            check(f"{row(4, 'additional_info')} = '{{\"customerId\": \"{ERASED}\", \"seats\": 2, \"eventName\": \"Quiz\"}}'::jsonb",
                  'the booking row loses the booker\'s name and keeps the rest')
            check(f"{row(1, 'operation_type')} = 'create' AND {row(1, 'user_email')} = 'staff@example.com' AND {row(1, 'resource_id')} = '{ERASED}'",
                  'who did what, and to which record, is unchanged')
            after_other = sql(f"SELECT md5(string_agg(to_jsonb(a)::text, ',' ORDER BY id)) FROM audit_logs a WHERE id IN "
                              "('a0000000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-000000000005','a0000000-0000-0000-0000-000000000006','a0000000-0000-0000-0000-000000000007');")
            if before_other != after_other:
                raise RuntimeError('FAIL the scrub changed another guest\'s rows or a row with nothing to remove')
            print('PASS another guest\'s rows, and rows with nothing personal, are untouched')
            check(f"(SELECT gdpr_scrub_audit_logs_v01('{{}}', '{{}}')) = 0", 'a call with no ids touches nothing')

            refused(f"UPDATE audit_logs SET new_values = new_values - 'email' WHERE resource_id = '{OTHER}';",
                    'Audit logs cannot be modified', 'outside the scrub, removing a key is still refused')
            refused(f"SET ROLE service_role; UPDATE audit_logs SET operation_status = 'failed' WHERE resource_id = '{OTHER}';",
                    'Audit logs cannot be modified', 'the service role still cannot edit an audit row')
            refused(f"BEGIN; SELECT set_config('app.gdpr_audit_scrub', 'on', true); "
                    f"UPDATE audit_logs SET operation_type = 'read', new_values = new_values - 'email' WHERE resource_id = '{OTHER}'; COMMIT;",
                    'Audit logs cannot be modified', 'with the flag set, changing a column is refused')
            refused(f"BEGIN; SELECT set_config('app.gdpr_audit_scrub', 'on', true); "
                    f"UPDATE audit_logs SET new_values = new_values || '{{\"email\": \"new@example.com\"}}' WHERE resource_id = '{OTHER}'; COMMIT;",
                    'Audit logs cannot be modified', 'with the flag set, adding or changing a value is refused')
            refused(f"BEGIN; SELECT set_config('app.gdpr_audit_scrub', 'on', true); "
                    f"UPDATE audit_logs SET resource_id = 'someone-else' WHERE resource_id = '{OTHER}'; COMMIT;",
                    'Audit logs cannot be modified', 'with the flag set, moving a row to another record is refused')
            refused(f"DELETE FROM audit_logs WHERE resource_id = '{ERASED}';", 'Audit logs cannot be deleted', 'deleting an audit row is still refused')

            assertion = MIGRATION.read_text().split('-- Prove it:', 1)[1].split('\n', 1)[1]
            error = sql_error(f"BEGIN; GRANT EXECUTE ON FUNCTION {SCRUB} TO authenticated;\n" + assertion + '\nROLLBACK;')
            if 'executable by anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-grant: {error!r}')
            print('PASS the migration assertion fails on a re-granted scrub')

            sql(ROLLBACK.read_text())
            if trigger_definition() != baseline:
                raise RuntimeError('FAIL the rollback did not restore the audit trigger')
            if scrub_exists() != 'f':
                raise RuntimeError('FAIL the rollback left the scrub function')
            print('PASS the rollback restores production\'s trigger function exactly and drops the scrub')
            refused(f"UPDATE audit_logs SET new_values = new_values - 'email' WHERE resource_id = '{OTHER}';",
                    'Audit logs cannot be modified', 'after the rollback every update is refused again')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__': main()

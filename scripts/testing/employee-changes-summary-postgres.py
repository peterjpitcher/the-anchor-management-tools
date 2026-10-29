#!/usr/bin/env python3
"""Test the employee changes summary fix in a disposable local Postgres.

The live function failed with 42702 (ambiguous operation_type) on every call.
This builds a minimal audit_logs table, stubs auth.role(), auth.uid() and
user_has_permission(), and checks the migrated function's rows, wording,
filters and permission gate. Synthetic data only, Unix socket, no listener.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261029114216_fix_employee_changes_summary.sql'
EMPLOYEE = '11111111-1111-1111-1111-111111111111'
ALLOWED = '00000000-0000-0000-0000-0000000000a1'

SETUP = f"""
CREATE SCHEMA auth;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('test.role', true) $$;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) RETURNS boolean
  LANGUAGE sql STABLE AS $$ SELECT p_user_id = '{ALLOWED}'::uuid AND p_module_name = 'employees' AND p_action = 'view' $$;
CREATE TABLE public.audit_logs (
  created_at timestamptz NOT NULL, user_email text, operation_type text NOT NULL, resource_type text NOT NULL,
  resource_id text, operation_status text NOT NULL, old_values jsonb, new_values jsonb
);
INSERT INTO public.audit_logs VALUES
  (now() - interval '1 day', 'manager@example.com', 'update', 'employee', '{EMPLOYEE}', 'success',
   '{{"job_title":"Bar","phone_number":"1","updated_at":"a"}}', '{{"job_title":"Supervisor","phone_number":"1","updated_at":"b"}}'),
  (now() - interval '2 days', 'manager@example.com', 'add_note', 'employee', '{EMPLOYEE}', 'success', NULL, NULL),
  (now() - interval '3 days', NULL, 'reliability_event', 'employee', '{EMPLOYEE}', 'success', NULL, '{{}}'),
  (now() - interval '4 days', NULL, 'shift_response', 'employee', '{EMPLOYEE}', 'success', NULL, '{{}}'),
  (now() - interval '5 days', 'manager@example.com', 'update', 'employee', '{EMPLOYEE}', 'failure', NULL, '{{"x":1}}'),
  (now() - interval '6 days', 'manager@example.com', 'update', 'employee', '{EMPLOYEE}', 'success', NULL, '{{"updated_at":"c"}}'),
  (now() - interval '7 days', 'manager@example.com', 'some_new_thing', 'employee', '{EMPLOYEE}', 'success', NULL, NULL),
  (now() - interval '8 days', 'manager@example.com', 'create', 'employee', '{EMPLOYEE}', 'success', NULL, '{{"first_name":"Sam"}}'),
  (now() - interval '9 days', 'manager@example.com', 'update', 'employee', '22222222-2222-2222-2222-222222222222', 'success', NULL, '{{"a":1}}'),
  (now() - interval '60 days', 'manager@example.com', 'delete', 'employee', '{EMPLOYEE}', 'success', '{{}}', NULL);
"""

CALL = f"SELECT operation_type || ' | ' || summary || ' | ' || coalesce(changed_by, '-') FROM public.get_employee_changes_summary('{EMPLOYEE}');"


def main():
    with tempfile.TemporaryDirectory(prefix='emp-changes-') as folder:
        work = Path(folder)
        socket = work / 's'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(work / 'db'), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)

        def sql(statement, expect_error=None):
            result = subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)
            if expect_error:
                assert result.returncode and expect_error in result.stderr, result.stderr
                return result.stderr
            if result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        def as_user(role, uid, statement, expect_error=None):
            return sql(f"SET test.role = '{role}'; SET test.uid = '{uid}';\n" + statement, expect_error)

        try:
            sql(SETUP)
            sql(MIGRATION.read_text())
            rows = as_user('authenticated', ALLOWED, CALL).splitlines()
            assert rows == [
                'update | Updated 1 field(s): job title | manager@example.com',
                'add_note | Note added | manager@example.com',
                'update | Employee record updated | manager@example.com',
                'some_new_thing | Some New Thing | manager@example.com',
                'create | Employee record created | manager@example.com',
            ], rows
            print('PASS rows are newest first, worded, and skip noise, failures, other staff and old entries')
            as_user('authenticated', '00000000-0000-0000-0000-0000000000b2', CALL, expect_error='Insufficient permissions')
            as_user('authenticated', '', CALL, expect_error='Insufficient permissions')
            print('PASS a user without employees/view, or no user at all, is refused')
            assert len(as_user('service_role', '', CALL).splitlines()) == 5
            print('PASS the service role can still read it')
            wide = f"SELECT count(*) FROM public.get_employee_changes_summary('{EMPLOYEE}', now() - interval '90 days', now());"
            assert as_user('authenticated', ALLOWED, wide) == '6'
            print('PASS an explicit date range is honoured')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()

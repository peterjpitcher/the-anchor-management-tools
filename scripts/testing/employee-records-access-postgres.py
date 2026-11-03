#!/usr/bin/env python3
"""Run the employee-records-access migration in an isolated socket-only PostgreSQL database.

The four employee functions, audit_logs and the employee_version_history view start with
production's grants and policies (2 November 2026). Against that baseline it shows the defects: a
staff portal login with no permissions can call create_employee_invite and the three version
functions, and reads every employee and message audit row, directly and through the view. Then the
migration runs: that login can call none of the functions and reads no employee or message rows
(its own login rows and rows it wrote stay visible), employees view reads every employee row of
every operation type, messages view reads message rows, settings view still reads everything, and
service_role still calls the functions. It also checks that a rolled-back run changes nothing and
that the rollback restores production's grants and policies exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261103070948_employee_records_access.sql'
ROLLBACK = ROOT / 'tasks/employee-records-access/rollback.sql'
PORTAL = '10000000-0000-0000-0000-000000000001'     # an employee's portal login, no role
EMPLOYEES = '10000000-0000-0000-0000-000000000002'  # employees view
MESSAGES = '10000000-0000-0000-0000-000000000003'   # messages view
SETTINGS = '10000000-0000-0000-0000-000000000004'   # settings view
EMPLOYEE_ID = '20000000-0000-0000-0000-000000000001'

SETUP = rf"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.role', true), '') $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS
 $$ SELECT jsonb_build_object('role', current_setting('request.jwt.claim.role', true)) $$;
CREATE TABLE public.fixture_permissions(user_id uuid, module_name text, action text);
CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path = public AS
 $$ SELECT EXISTS (SELECT 1 FROM fixture_permissions WHERE user_id = p_user_id AND module_name = p_module_name AND action = p_action) $$;
INSERT INTO fixture_permissions VALUES ('{EMPLOYEES}', 'employees', 'view'), ('{MESSAGES}', 'messages', 'view'),
 ('{SETTINGS}', 'settings', 'view');

CREATE TABLE public.audit_logs(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(),
 user_id uuid, user_email text, operation_type text, resource_type text, resource_id text,
 old_values jsonb, new_values jsonb, ip_address text);
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_logs FROM PUBLIC;
GRANT ALL ON public.audit_logs TO service_role; GRANT SELECT ON public.audit_logs TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.audit_logs TO authenticated;
CREATE POLICY "Users can view limited audit logs for dashboard" ON public.audit_logs AS PERMISSIVE FOR SELECT TO public
 USING (((auth.role() = 'authenticated'::text) AND (resource_type = ANY (ARRAY['employee'::text, 'message_template'::text, 'bulk_message'::text])) AND (operation_type = ANY (ARRAY['create'::text, 'update'::text, 'delete'::text]))));
CREATE POLICY "Users can view own auth logs" ON public.audit_logs AS PERMISSIVE FOR SELECT TO public
 USING (((auth.role() = 'authenticated'::text) AND (user_id = auth.uid()) AND (operation_type = ANY (ARRAY['login'::text, 'logout'::text]))));
CREATE POLICY "Users with audit permission can view all logs" ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
 USING ((EXISTS ( SELECT 1 FROM ( SELECT user_has_permission(auth.uid(), 'audit_logs'::text, 'view'::text) AS user_has_permission) user_has_permission(user_has_permission) WHERE (user_has_permission.user_has_permission = true))));
CREATE POLICY audit_logs_insert_policy ON public.audit_logs AS PERMISSIVE FOR INSERT TO public
 WITH CHECK (((auth.jwt() ->> 'role'::text) = 'service_role'::text));
CREATE POLICY audit_logs_read_policy ON public.audit_logs AS PERMISSIVE FOR SELECT TO authenticated
 USING ((( SELECT user_has_permission(auth.uid(), 'settings'::text, 'view'::text) AS user_has_permission) OR (user_id = auth.uid())));
INSERT INTO public.audit_logs(user_id, operation_type, resource_type, resource_id, old_values, new_values) VALUES
 (NULL, 'update', 'employee', '{EMPLOYEE_ID}', '{{"address": "1 Old Road"}}', '{{"address": "2 New Road"}}'),
 (NULL, 'create', 'employee', '{EMPLOYEE_ID}', NULL, '{{"date_of_birth": "1990-01-01"}}'),
 (NULL, 'status_change', 'employee', '{EMPLOYEE_ID}', NULL, '{{"status": "Former"}}'),
 (NULL, 'create', 'bulk_message', 'b1', NULL, '{{"recipients": 40}}'),
 (NULL, 'update', 'message_template', 't1', NULL, '{{"body": "hi"}}'),
 (NULL, 'update', 'invoice', 'i1', NULL, NULL),
 ('{PORTAL}', 'login', 'auth', NULL, NULL, NULL);

CREATE VIEW public.employee_version_history WITH (security_invoker = true) AS
 SELECT al.id, al.created_at, al.resource_id AS employee_id, al.new_values,
  row_number() OVER (PARTITION BY al.resource_id ORDER BY al.created_at) AS version_number
 FROM public.audit_logs al WHERE al.resource_type = 'employee';
REVOKE ALL ON public.employee_version_history FROM PUBLIC;
GRANT ALL ON public.employee_version_history TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_version_history TO authenticated;

CREATE FUNCTION public.create_employee_invite(p_email text, p_job_title text DEFAULT NULL, p_employment_start_date date DEFAULT NULL)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT jsonb_build_object('token', 'raw-token') $$;
CREATE FUNCTION public.restore_employee_version(p_employee_id uuid, p_version_number integer, p_user_id uuid)
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT '{{}}'::jsonb $$;
CREATE FUNCTION public.compare_employee_versions(p_employee_id uuid, p_version1 integer, p_version2 integer)
 RETURNS integer LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT count(*)::int FROM public.employee_version_history $$;
CREATE FUNCTION public.get_employee_at_timestamp(p_employee_id uuid, p_timestamp timestamp with time zone DEFAULT now())
 RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $$ SELECT '{{}}'::jsonb $$;
REVOKE ALL ON FUNCTION public.create_employee_invite(text, text, date), public.restore_employee_version(uuid, integer, uuid),
 public.compare_employee_versions(uuid, integer, integer), public.get_employee_at_timestamp(uuid, timestamp with time zone) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_employee_invite(text, text, date), public.restore_employee_version(uuid, integer, uuid),
 public.compare_employee_versions(uuid, integer, integer), public.get_employee_at_timestamp(uuid, timestamp with time zone)
 TO authenticated, service_role;
"""

CALLS = {
    'create_employee_invite': "SELECT public.create_employee_invite('x@example.com')",
    'restore_employee_version': f"SELECT public.restore_employee_version('{EMPLOYEE_ID}', 1, '{SETTINGS}')",
    'compare_employee_versions': f"SELECT public.compare_employee_versions('{EMPLOYEE_ID}', 1, 2)",
    'get_employee_at_timestamp': f"SELECT public.get_employee_at_timestamp('{EMPLOYEE_ID}')",
}


def main():
    with tempfile.TemporaryDirectory(prefix='emp-access-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            return result.stdout.strip()

        def sql_error(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            return result.stderr if result.returncode else ''

        def as_user(role, user, statement):
            claims = ''
            if user: claims += f"SET LOCAL request.jwt.claim.sub = '{user}';"
            claims += f"SET LOCAL request.jwt.claim.role = '{role}';"
            return f"BEGIN; {claims} SET LOCAL ROLE {role}; {statement}; ROLLBACK;"

        def value(role, user, statement):
            return sql(as_user(role, user, statement)).splitlines()[-1]

        def audit_count(user, where):
            return value('authenticated', user, f'SELECT count(*) FROM public.audit_logs WHERE {where}')

        def expect(got, want, label):
            if got != want: raise RuntimeError(f'FAIL {label}: got {got!r}, want {want!r}')
            print(f'PASS {label}')

        def denied(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if 'permission denied' not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def allowed(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if error: raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def state():
            policies = sql("SELECT string_agg(policyname||':'||permissive||':'||cmd||':'||roles::text||':'"
                           "||coalesce(qual,'')||':'||coalesce(with_check,''), '|' ORDER BY policyname) "
                           "FROM pg_policies WHERE tablename='audit_logs';")
            rels = sql("SELECT string_agg(relname||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) "
                       "FROM unnest(relacl) a),''), '|' ORDER BY relname) FROM pg_class "
                       "WHERE relnamespace='public'::regnamespace AND relname IN ('audit_logs','employee_version_history');")
            funcs = sql("SELECT string_agg(proname||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) "
                        "FROM unnest(proacl) a),''), '|' ORDER BY proname) FROM pg_proc "
                        "WHERE pronamespace='public'::regnamespace AND proname <> 'user_has_permission';")
            return policies + '#' + rels + '#' + funcs

        try:
            sql(SETUP)
            before = state()

            for name, call in CALLS.items():
                allowed('authenticated', PORTAL, call, f'baseline defect: a portal login calls {name}')
            expect(audit_count(PORTAL, "resource_type = 'employee'"), '2',
                   "baseline defect: a portal login reads employee create and update rows (old address included)")
            expect(audit_count(PORTAL, "resource_type IN ('bulk_message','message_template')"), '2',
                   'baseline defect: a portal login reads message audit rows')
            expect(value('authenticated', PORTAL, 'SELECT count(*) FROM public.employee_version_history'), '2',
                   'baseline defect: a portal login reads employee history through the view')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            expect(state(), before, 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            for name, call in CALLS.items():
                denied('authenticated', PORTAL, call, f'portal login: cannot call {name}')
                denied('authenticated', SETTINGS, call, f'even a settings viewer cannot call {name} with a session')
                allowed('service_role', None, call, f'service_role: still calls {name}')
            denied('anon', None, CALLS['create_employee_invite'], 'anon: cannot call create_employee_invite')

            expect(audit_count(PORTAL, "resource_type = 'employee'"), '0', 'portal login: reads no employee audit rows')
            expect(audit_count(PORTAL, "resource_type IN ('bulk_message','message_template')"), '0', 'portal login: reads no message audit rows')
            expect(audit_count(PORTAL, "operation_type = 'login'"), '1', 'portal login: still reads its own login row')
            denied('authenticated', PORTAL, 'SELECT count(*) FROM public.employee_version_history', 'portal login: cannot read the history view')

            expect(audit_count(EMPLOYEES, "resource_type = 'employee'"), '3',
                   'employees view: reads every employee row, the status change included (audit trail tab)')
            expect(audit_count(EMPLOYEES, "resource_type <> 'employee'"), '0', 'employees view: reads nothing else')
            expect(audit_count(MESSAGES, "resource_type IN ('bulk_message','message_template')"), '2', 'messages view: reads message rows')
            expect(audit_count(MESSAGES, "resource_type = 'employee'"), '0', 'messages view: reads no employee rows')
            expect(audit_count(SETTINGS, 'true'), '7', 'settings view: still reads every row')
            expect(value('service_role', None, 'SELECT public.compare_employee_versions(NULL, 1, 2)'), '3',
                   'the version function still reads the view as its owner')

            sql(ROLLBACK.read_text())
            expect(state(), before, 'the rollback restores production grants and policies exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

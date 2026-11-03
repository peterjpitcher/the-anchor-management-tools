#!/usr/bin/env python3
"""Run the employee-rate-overrides RLS migration in an isolated socket-only PostgreSQL database.

employee_rate_overrides starts with production's policy and grants (2 November 2026). Against that
baseline it shows the defect: a staff portal login with no employees permission reads every
colleague's personal hourly rate and can write one. Then the migration runs: that login sees only
its own employee's rows and writes none, staff with employees view or payroll view read every row,
only employees edit writes, anon reads nothing, and service_role still reads and writes everything.
It also checks that a rolled-back run changes nothing and that the rollback restores production's
policy and grants exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261102230000_employee_rate_overrides_rls.sql'
ROLLBACK = ROOT / 'tasks/employee-rate-overrides-rls/rollback.sql'
PORTAL = '10000000-0000-0000-0000-000000000001'      # an employee's portal login, no staff role
VIEWER = '10000000-0000-0000-0000-000000000002'      # employees view
PAYROLL = '10000000-0000-0000-0000-000000000003'     # payroll view only
EDITOR = '10000000-0000-0000-0000-000000000004'      # employees view and edit
OWN_EMPLOYEE = '20000000-0000-0000-0000-000000000001'
OTHER_EMPLOYEE = '20000000-0000-0000-0000-000000000002'

SETUP = rf"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.fixture_permissions(user_id uuid, module_name text, action text);
CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path = public AS
 $$ SELECT EXISTS (SELECT 1 FROM fixture_permissions WHERE user_id = p_user_id AND module_name = p_module_name AND action = p_action) $$;
INSERT INTO fixture_permissions VALUES ('{VIEWER}', 'employees', 'view'), ('{PAYROLL}', 'payroll', 'view'),
 ('{EDITOR}', 'employees', 'view'), ('{EDITOR}', 'employees', 'edit');
CREATE TABLE public.employees(employee_id uuid PRIMARY KEY, auth_user_id uuid);
INSERT INTO public.employees VALUES ('{OWN_EMPLOYEE}', '{PORTAL}'), ('{OTHER_EMPLOYEE}', NULL);
CREATE FUNCTION public.current_user_employee_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_catalog' AS
 $$ SELECT e.employee_id FROM public.employees e WHERE e.auth_user_id = auth.uid() $$;
REVOKE ALL ON FUNCTION public.current_user_employee_ids() FROM public;
GRANT EXECUTE ON FUNCTION public.current_user_employee_ids() TO authenticated, service_role;
CREATE TABLE public.employee_rate_overrides(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL,
 hourly_rate numeric(6,2) NOT NULL, effective_from date NOT NULL);
ALTER TABLE public.employee_rate_overrides ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.employee_rate_overrides FROM PUBLIC;
GRANT ALL ON public.employee_rate_overrides TO service_role; GRANT SELECT ON public.employee_rate_overrides TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.employee_rate_overrides TO authenticated;
CREATE POLICY "Authenticated users can manage employee_rate_overrides" ON public.employee_rate_overrides
 AS PERMISSIVE FOR ALL TO authenticated USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
INSERT INTO public.employee_rate_overrides(employee_id, hourly_rate, effective_from) VALUES
 ('{OWN_EMPLOYEE}', 12.50, '2026-04-01'), ('{OTHER_EMPLOYEE}', 15.00, '2026-04-01');
"""

FORGE = f"INSERT INTO public.employee_rate_overrides(employee_id, hourly_rate, effective_from) VALUES ('{OWN_EMPLOYEE}', 99.00, '2026-12-01')"


def main():
    with tempfile.TemporaryDirectory(prefix='rate-rls-pg-') as folder:
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
            claim = f"SET LOCAL request.jwt.claim.sub = '{user}';" if user else ''
            return f"BEGIN; {claim} SET LOCAL ROLE {role}; {statement}; ROLLBACK;"

        def count(role, user, where='true'):
            return sql(as_user(role, user, f'SELECT count(*) FROM public.employee_rate_overrides WHERE {where}')).splitlines()[-1]

        def expect(got, want, label):
            if got != want: raise RuntimeError(f'FAIL {label}: got {got!r}, want {want!r}')
            print(f'PASS {label}')

        def write_blocked(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if 'row-level security' not in error and 'permission denied' not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def rows_changed(role, user, statement):
            out = sql(as_user(role, user, f'WITH c AS ({statement} RETURNING 1) SELECT count(*) FROM c'))
            return out.splitlines()[-1]

        def allowed(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if error: raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def state():
            policies = sql("SELECT string_agg(policyname||':'||permissive||':'||cmd||':'||roles::text||':'"
                           "||coalesce(qual,'')||':'||coalesce(with_check,''), '|' ORDER BY policyname) "
                           "FROM pg_policies WHERE tablename='employee_rate_overrides';")
            grants = sql("SELECT coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) FROM unnest(relacl) a),'') "
                         "FROM pg_class WHERE oid='public.employee_rate_overrides'::regclass;")
            return policies + '#' + grants

        try:
            sql(SETUP)
            before = state()

            expect(count('authenticated', PORTAL), '2', "baseline defect: a portal login reads every colleague's rate")
            allowed('authenticated', PORTAL, FORGE, 'baseline defect: a portal login writes its own pay rate')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            expect(state(), before, 'a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            expect(count('authenticated', PORTAL), '1', 'portal login: reads only its own rate (portal shifts page)')
            expect(count('authenticated', PORTAL, f"employee_id = '{OTHER_EMPLOYEE}'"), '0', "portal login: cannot read a colleague's rate")
            write_blocked('authenticated', PORTAL, FORGE, 'portal login: cannot add a rate, not even its own')
            expect(rows_changed('authenticated', PORTAL, 'UPDATE public.employee_rate_overrides SET hourly_rate = 99'), '0',
                   'portal login: an update changes no rows')
            expect(rows_changed('authenticated', PORTAL, 'DELETE FROM public.employee_rate_overrides'), '0',
                   'portal login: a delete removes no rows')
            expect(count('authenticated', VIEWER), '2', 'employees view: reads every rate (profile pay tab)')
            expect(count('authenticated', PAYROLL), '2', 'payroll view: reads every rate (payroll)')
            write_blocked('authenticated', VIEWER, FORGE, 'employees view without edit: cannot add a rate')
            write_blocked('authenticated', PAYROLL, FORGE, 'payroll view: cannot add a rate')
            allowed('authenticated', EDITOR, FORGE + '; UPDATE public.employee_rate_overrides SET hourly_rate = 13 '
                    "WHERE effective_from = '2026-12-01'; DELETE FROM public.employee_rate_overrides WHERE effective_from = '2026-12-01'",
                    'employees edit: adds, changes and removes a rate')
            expect(rows_changed('authenticated', EDITOR, "UPDATE public.employee_rate_overrides SET hourly_rate = 13"), '2',
                   'employees edit: an update reaches every row')
            write_blocked('anon', None, 'SELECT * FROM public.employee_rate_overrides', 'anon: cannot read the table at all')
            allowed('service_role', None, FORGE + '; DELETE FROM public.employee_rate_overrides', 'service_role: still reads and writes')

            sql(ROLLBACK.read_text())
            expect(state(), before, 'the rollback restores production policy and grants exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

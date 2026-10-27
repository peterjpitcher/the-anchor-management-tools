#!/usr/bin/env python3
"""Run the staff-database-access migration in an isolated socket-only PostgreSQL database.

The seven booking and payment tables and short_links start with production's grants and policies
(26 October 2026). Against that baseline it shows the defect: a signed-in account with no staff
role can read and write payments and guest links and read every guest short link. Then the
migration runs: anon and authenticated reach none of the six server-only tables, table
assignments stay readable only with table_bookings view and writable by nobody but service_role,
guest short links need short-link access while a person's own links stay readable, and
service_role still reads and writes everything. It also checks that a rolled-back run changes
nothing, that the migration's own assertion catches a reopened policy, and that the rollback
restores production's policies and grants exactly.
"""
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATION = ROOT / 'supabase/migrations/20261027001434_staff_database_access.sql'
ROLLBACK = ROOT / 'tasks/staff-database-access/rollback.sql'
SERVER_ONLY = ('payments', 'guest_tokens', 'booking_holds', 'waitlist_entries', 'waitlist_offers', 'charge_requests')
TABLES = SERVER_ONLY + ('booking_table_assignments',)
NOBODY = '10000000-0000-0000-0000-000000000001'      # a login with no staff role
FOH = '10000000-0000-0000-0000-000000000002'         # table_bookings view
LINKS = '10000000-0000-0000-0000-000000000003'       # short_links view

SETUP = r"""
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
 $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
CREATE TABLE public.fixture_permissions(user_id uuid, module_name text, action text);
CREATE FUNCTION public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) RETURNS boolean
 LANGUAGE sql SECURITY DEFINER SET search_path = public AS
 $$ SELECT EXISTS (SELECT 1 FROM fixture_permissions WHERE user_id = p_user_id AND module_name = p_module_name AND action = p_action) $$;
INSERT INTO fixture_permissions VALUES ('10000000-0000-0000-0000-000000000002', 'table_bookings', 'view'),
 ('10000000-0000-0000-0000-000000000003', 'short_links', 'view');
CREATE TABLE public.short_links(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_by uuid, destination_url text);
ALTER TABLE public.short_links ENABLE ROW LEVEL SECURITY;
GRANT ALL ON public.short_links TO service_role; GRANT SELECT ON public.short_links TO authenticated;
CREATE POLICY "Authenticated users can create short links" ON public.short_links FOR INSERT WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY "Authenticated users can view short links" ON public.short_links FOR SELECT USING ((auth.uid() IS NOT NULL));
CREATE POLICY "Users can delete own short links" ON public.short_links FOR DELETE
 USING (((created_by = auth.uid()) OR (created_by IS NULL)));
CREATE POLICY "Users can update own short links" ON public.short_links FOR UPDATE
 USING (((created_by = auth.uid()) OR (created_by IS NULL))) WITH CHECK (((created_by = auth.uid()) OR (created_by IS NULL)));
INSERT INTO public.short_links(created_by, destination_url) VALUES
 (NULL, 'https://management.orangejelly.co.uk/g/raw-guest-token/table-manage'),
 ('10000000-0000-0000-0000-000000000009', 'https://www.the-anchor.pub/whats-on');
CREATE FUNCTION fixture_assert(boolean,text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %',$2; END IF; RAISE NOTICE 'PASS %',$2; END $$;
GRANT EXECUTE ON FUNCTION fixture_assert(boolean,text) TO PUBLIC;
"""


def table_setup(name):
    return (f"CREATE TABLE public.{name}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(), note text);"
            f"ALTER TABLE public.{name} ENABLE ROW LEVEL SECURITY;"
            f"GRANT ALL ON public.{name} TO service_role; GRANT SELECT ON public.{name} TO anon;"
            f"GRANT SELECT, INSERT, UPDATE, DELETE ON public.{name} TO authenticated;"
            f"CREATE POLICY {name}_authenticated_all ON public.{name} FOR ALL TO authenticated "
            f"USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));"
            f"INSERT INTO public.{name}(note) VALUES ('seed');")


def main():
    with tempfile.TemporaryDirectory(prefix='bk008-pg-') as folder:
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

        def as_user(role, user, statement):
            claim = f"SET LOCAL request.jwt.claim.sub = '{user}';" if user else ''
            return f"BEGIN; {claim} SET LOCAL ROLE {role}; {statement}; ROLLBACK;"

        def count(role, user, table, where='true'):
            return sql(as_user(role, user, f'SELECT count(*) FROM public.{table} WHERE {where}')).splitlines()[-1]

        def denied(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if 'permission denied for table' not in error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def allowed(role, user, statement, label):
            error = sql_error(as_user(role, user, statement))
            if error:
                raise RuntimeError(f'FAIL {label}: {error!r}')
            print(f'PASS {label}')

        def state():
            policies = sql("SELECT string_agg(tablename||':'||policyname||':'||permissive||':'||cmd||':'||roles::text||':'"
                           "||coalesce(qual,'')||':'||coalesce(with_check,''), '|' ORDER BY tablename, policyname) "
                           "FROM pg_policies WHERE schemaname='public';")
            # Privileges compared as a sorted set: a revoke and re-grant can reorder the entries.
            grants = sql("SELECT string_agg(relname||':'||coalesce((SELECT string_agg(a::text, ',' ORDER BY a::text) "
                         "FROM unnest(relacl) a),''), '|' ORDER BY relname) "
                         "FROM pg_class WHERE relnamespace='public'::regnamespace AND relkind='r';")
            return policies + '#' + grants

        try:
            sql(SETUP)
            for name in TABLES:
                sql(table_setup(name))
            before = state()

            if count('authenticated', NOBODY, 'payments') != '1':
                raise RuntimeError('FAIL baseline: a login with no role cannot read payments')
            print('PASS baseline defect: a login with no staff role reads payments')
            allowed('authenticated', NOBODY, "INSERT INTO public.guest_tokens(note) VALUES ('forged')",
                    'baseline defect: a login with no staff role writes a guest link')
            if count('authenticated', NOBODY, 'short_links', 'created_by IS NULL') != '1':
                raise RuntimeError('FAIL baseline: a login with no role cannot read guest short links')
            print('PASS baseline defect: a login with no staff role reads guest short links, raw token included')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            if state() != before: raise RuntimeError('FAIL a rolled-back run changed the policies or grants')
            print('PASS a rolled-back run changes nothing')

            sql(MIGRATION.read_text())
            for name in SERVER_ONLY:
                denied('authenticated', FOH, f'SELECT * FROM public.{name}', f'{name}: even staff with table_bookings view cannot read it')
                denied('authenticated', NOBODY, f"INSERT INTO public.{name}(note) VALUES ('forged')", f'{name}: a signed-in account cannot write it')
                denied('anon', None, f'SELECT * FROM public.{name}', f'{name}: anon cannot read it')
                allowed('service_role', None, f"INSERT INTO public.{name}(note) VALUES ('x'); UPDATE public.{name} SET note = 'y'; "
                        f"DELETE FROM public.{name} WHERE note = 'y'", f'{name}: service_role still reads and writes it')
            if count('authenticated', FOH, 'booking_table_assignments') != '1':
                raise RuntimeError('FAIL staff with table_bookings view cannot read table assignments')
            print('PASS table assignments: staff with table_bookings view still read them (booking page, FOH live updates)')
            if count('authenticated', NOBODY, 'booking_table_assignments') != '0':
                raise RuntimeError('FAIL a login with no role still reads table assignments')
            print('PASS table assignments: a login with no staff role reads none')
            for verb, statement in (('insert', "INSERT INTO public.booking_table_assignments(note) VALUES ('x')"),
                                    ('update', "UPDATE public.booking_table_assignments SET note = 'x'"),
                                    ('delete', 'DELETE FROM public.booking_table_assignments')):
                denied('authenticated', FOH, statement, f'table assignments: staff cannot {verb} them directly')
            denied('anon', None, 'SELECT * FROM public.booking_table_assignments', 'table assignments: anon cannot read them')
            allowed('service_role', None, "UPDATE public.booking_table_assignments SET note = 'moved'",
                    'table assignments: service_role still writes them')

            for user, label, system, own in ((NOBODY, 'a login with no staff role', '0', '1'),
                                             (FOH, 'staff without short-link access', '0', '1'),
                                             (LINKS, 'staff with short-link access', '1', '1')):
                got = (count('authenticated', user, 'short_links', 'created_by IS NULL'),
                       count('authenticated', user, 'short_links', 'created_by IS NOT NULL'))
                if got != (system, own):
                    raise RuntimeError(f'FAIL short links for {label}: {got}')
                print(f'PASS short links: {label} sees {system} guest link(s) and {own} link(s) a person made')

            assertion = MIGRATION.read_text().split('-- Prove it,', 1)[1].split('\n', 1)[1]
            error = sql_error('BEGIN; CREATE POLICY reopened ON public.payments FOR SELECT TO authenticated '
                              'USING ((auth.uid() IS NOT NULL));\n' + assertion + '\nROLLBACK;')
            if 'still let any signed-in account through' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a reopened policy: {error!r}')
            print('PASS the migration assertion fails on a policy that lets any login through')
            error = sql_error('BEGIN; GRANT INSERT ON public.booking_table_assignments TO authenticated;\n' + assertion + '\nROLLBACK;')
            if 'still granted to anon or authenticated' not in error:
                raise RuntimeError(f'FAIL the assertion did not catch a re-granted write: {error!r}')
            print('PASS the migration assertion fails on a re-granted write')

            sql(ROLLBACK.read_text())
            if state() != before: raise RuntimeError('FAIL the rollback did not restore policies and grants exactly')
            print('PASS the rollback restores production policies and grants exactly')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', 'stop'], capture_output=True)


if __name__ == '__main__':
    main()

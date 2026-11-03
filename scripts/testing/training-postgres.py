#!/usr/bin/env python3
"""Test the staff training migrations in a disposable local Postgres.

Builds an empty cluster with the Supabase roles (service_role bypasses row security, as in
Supabase), the stock Supabase default privileges (new tables and functions granted to anon and
authenticated), a stand-in storage.buckets table, a minimal employees table, and stand-in RBAC
tables (permissions, roles, role_permissions with production's columns and unique keys, read
2 November 2026). It applies the signing migrations the training tables depend on, then the four
training migrations, each twice:

  20261103141837_training_tables.sql
  20261103141853_training_signing_kinds.sql
  20261103153829_training_permissions.sql
  20261103141905_retire_policy_drafts_replaced_by_training.sql

and checks: nothing is granted to anon, authenticated or PUBLIC on any training table or
function (despite the default privileges); the CHECKs; the unique indexes (one open cycle, one
open attempt, one draft); the triggers (a published version is frozen, an attempt can only be
answered while open, the timeline is append-only, TRUNCATE is refused); the retention function
(refusals, its bypass, its counts, and that the bypass ends with it); the two signing kinds; the
permission rows; and the retired policy drafts.

Synthetic data only, on a Unix socket with no network listener.
"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/opt/postgresql@17/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
SIGNING_FOUNDATION = MIGRATIONS / '20261013080854_document_signing_foundation.sql'
SIGNING_DRAFTS = MIGRATIONS / '20261013080952_document_signing_template_drafts.sql'
SIGNING_DEDUCTION_KIND = MIGRATIONS / '20261014084753_signing_deposit_deduction_agreement.sql'
TABLES = MIGRATIONS / '20261103141837_training_tables.sql'
KINDS = MIGRATIONS / '20261103141853_training_signing_kinds.sql'
PERMISSIONS = MIGRATIONS / '20261103153829_training_permissions.sql'
RETIRE = MIGRATIONS / '20261103141905_retire_policy_drafts_replaced_by_training.sql'

TRAINING_TABLES = [
    'training_courses', 'training_course_versions', 'training_profiles', 'training_assignments',
    'training_attempts', 'training_events', 'training_reminders',
]
TABLE_PRIVILEGES = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']

ACTIVE = '00000000-0000-0000-0000-0000000000e1'
OTHER = '00000000-0000-0000-0000-0000000000e2'
FORMER_OLD = '00000000-0000-0000-0000-0000000000e3'
FORMER_RECENT = '00000000-0000-0000-0000-0000000000e4'
FORMER_NO_END = '00000000-0000-0000-0000-0000000000e5'
FORMER_EDGE = '00000000-0000-0000-0000-0000000000e6'
SHA = 'a' * 64
SHA_B = 'b' * 64
SIGNING_DOC = '00000000-0000-0000-0000-0000000000d1'

SETUP = r"""
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
-- Supabase's stock defaults: new tables and functions in public are granted to the API roles.
-- The migrations must take these away themselves.
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;

CREATE SCHEMA storage;
CREATE TABLE storage.buckets (id text PRIMARY KEY, name text NOT NULL, public boolean NOT NULL DEFAULT false);

CREATE TABLE public.employees (
  employee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL CHECK (status IN ('Onboarding', 'Active', 'Started Separation', 'Former')),
  employment_start_date date,
  employment_end_date date,
  CONSTRAINT chk_employment_dates CHECK (employment_end_date IS NULL OR employment_end_date > employment_start_date)
);

CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_system boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module_name text NOT NULL,
  action text NOT NULL,
  description text,
  created_at timestamptz DEFAULT now(),
  UNIQUE (module_name, action)
);
CREATE TABLE public.role_permissions (
  role_id uuid NOT NULL REFERENCES public.roles(id),
  permission_id uuid NOT NULL REFERENCES public.permissions(id),
  created_at timestamptz DEFAULT now(),
  PRIMARY KEY (role_id, permission_id)
);
INSERT INTO public.roles (name) VALUES
  ('super_admin'), ('manager'), ('staff'), ('foh_staff'), ('portal_shift_manager'), ('Deputy');
-- Something already granted, which the training permissions must leave alone.
INSERT INTO public.permissions (module_name, action, description) VALUES ('employees', 'view', 'View employees');
INSERT INTO public.role_permissions (role_id, permission_id)
  SELECT r.id, p.id FROM public.roles r, public.permissions p WHERE r.name IN ('manager', 'staff') AND p.module_name = 'employees';
"""


def main():
    # Short prefix: a Unix socket path over 103 bytes fails.
    with tempfile.TemporaryDirectory(prefix='trn-', dir='/tmp') as folder:
        work = Path(folder)
        socket = work / 's'
        socket.mkdir()
        subprocess.run([str(PG / 'initdb'), '-D', str(work / 'db'), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)

        def psql(statement):
            return subprocess.run([str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1'], input=statement, text=True, capture_output=True)

        def sql(statement):
            result = psql(statement)
            if result.returncode:
                raise AssertionError(result.stderr)
            return result.stdout.strip()

        def first(statement):
            return sql(statement).splitlines()[0]

        def fails(statement, expected):
            result = psql(statement)
            assert result.returncode and expected in result.stderr, (expected, result.stderr or 'statement succeeded')

        def as_role(role, statement):
            return f'BEGIN; SET LOCAL ROLE {role}; {statement} COMMIT;'

        def course(slug, kind='online'):
            return first(f"INSERT INTO training_courses (slug, title, kind) VALUES ('{slug}', 'Course {slug}', '{kind}') RETURNING id;")

        def draft(course_id, sha=SHA, content='{"schemaVersion": 1}'):
            return first(f"""INSERT INTO training_course_versions (course_id, state, content, content_sha256, uploaded_by_name)
                             VALUES ('{course_id}', 'draft', '{content}', '{sha}', 'Test Manager') RETURNING id;""")

        def publish(version_id, major=1, minor=0, extra=''):
            return f"""UPDATE training_course_versions
                       SET state = 'published', major = {major}, minor = {minor}, published_at = now(), published_by_name = 'Test Manager'{extra}
                       WHERE id = '{version_id}';"""

        def assignment(employee_id, course_id, cycle=1, status='assigned', extra_columns='', extra_values=''):
            return first(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on{extra_columns})
                             VALUES ('{employee_id}', '{course_id}', {cycle}, 'existing_staff', '{status}', current_date{extra_values}) RETURNING id;""")

        def attempt(assignment_id, employee_id, version_id, section='fire', number=1):
            return first(f"""INSERT INTO training_attempts (assignment_id, employee_id, version_id, section_key, attempt_no, served)
                             VALUES ('{assignment_id}', '{employee_id}', '{version_id}', '{section}', {number},
                                     '[{{"questionId": "fire-01", "optionOrder": [2, 0, 1]}}]') RETURNING id;""")

        def event(employee_id, assignment_id='NULL', event_type='assigned'):
            assignment_value = assignment_id if assignment_id == 'NULL' else f"'{assignment_id}'"
            return first(f"""INSERT INTO training_events (employee_id, assignment_id, event_type, note)
                             VALUES ('{employee_id}', {assignment_value}, '{event_type}', 'test') RETURNING id;""")

        def reminder(employee_id, assignment_id, key):
            return first(f"""INSERT INTO training_reminders (kind, claim_key, assignment_id, employee_id, london_date, status)
                             VALUES ('staff_step', '{key}', '{assignment_id}', '{employee_id}', current_date, 'claimed') RETURNING id;""")

        def count(table, where='true'):
            return sql(f'SELECT count(*) FROM {table} WHERE {where}')

        try:
            sql(SETUP)
            sql(SIGNING_FOUNDATION.read_text())
            sql(SIGNING_DRAFTS.read_text())
            sql(SIGNING_DEDUCTION_KIND.read_text())

            # -------------------------------------------------------------------------------
            # Tables migration
            # -------------------------------------------------------------------------------
            tables = TABLES.read_text()
            sql(tables)
            # Running it twice must be harmless: every statement is guarded.
            sql(tables)
            assert sql("SELECT public FROM storage.buckets WHERE id = 'training'") == 'f'
            assert sql("SELECT count(*) FROM pg_constraint WHERE conname = 'training_courses_current_version_fk'") == '1'
            print('PASS tables migration applies, applies again, and creates a private bucket')

            found = sql("SELECT string_agg(relname, ',' ORDER BY relname) FROM pg_class WHERE relkind = 'r' AND relnamespace = 'public'::regnamespace AND relname LIKE 'training\\_%'")
            assert found.split(',') == sorted(TRAINING_TABLES), found
            for table in TRAINING_TABLES:
                for role in ['anon', 'authenticated']:
                    for privilege in TABLE_PRIVILEGES:
                        assert sql(f"SELECT has_table_privilege('{role}', 'public.{table}', '{privilege}')") == 'f', (table, role, privilege)
                    assert sql(f"SELECT has_any_column_privilege('{role}', 'public.{table}', 'SELECT')") == 'f', (table, role)
                for privilege in TABLE_PRIVILEGES:
                    assert sql(f"SELECT has_table_privilege('service_role', 'public.{table}', '{privilege}')") == 't', (table, privilege)
                # Nothing left for PUBLIC in the ACL either.
                assert sql(f"SELECT count(*) FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = 'public.{table}'::regclass AND a.grantee = 0") == '0', table
                assert sql(f"SELECT relrowsecurity FROM pg_class WHERE oid = 'public.{table}'::regclass") == 't', table
                assert sql(f"SELECT count(*) FROM pg_policies WHERE schemaname = 'public' AND tablename = '{table}'") == '0', table
            functions = sql("SELECT string_agg(p.oid::regprocedure::text, '|' ORDER BY p.proname) FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'training\\_%'").split('|')
            assert len(functions) == 6, functions
            for function in functions:
                for role in ['anon', 'authenticated', 'public']:
                    assert sql(f"SELECT has_function_privilege('{role}', '{function}', 'EXECUTE')") == 'f', (function, role)
                assert sql(f"SELECT has_function_privilege('service_role', '{function}', 'EXECUTE')") == 't', function
            assert sql("SELECT prosecdef FROM pg_proc WHERE oid = 'public.training_retention_purge(uuid)'::regprocedure") == 't'
            assert sql("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'training\\_%' AND prosecdef") == '1'
            assert sql("SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'training\\_%' AND NOT (coalesce(proconfig::text, '') LIKE '%search_path%')") == '0'
            fails(as_role('authenticated', 'SELECT count(*) FROM training_courses;'), 'permission denied for table training_courses')
            fails(as_role('anon', 'SELECT count(*) FROM training_events;'), 'permission denied for table training_events')
            fails(as_role('authenticated', f"SELECT training_retention_purge('{FORMER_OLD}');"), 'permission denied for function training_retention_purge')
            sql(as_role('service_role', "SELECT count(*) FROM training_courses;"))
            print('PASS nothing on any training table or function is granted to anon, authenticated or PUBLIC, despite the default privileges; row security is on with no policy; service_role has it all')

            sql(f"""INSERT INTO employees (employee_id, status, employment_start_date, employment_end_date) VALUES
                    ('{ACTIVE}', 'Active', '2020-01-01', NULL),
                    ('{OTHER}', 'Active', '2021-01-01', NULL),
                    ('{FORMER_OLD}', 'Former', '2010-01-01', '2015-06-30'),
                    ('{FORMER_RECENT}', 'Former', '2015-01-01', (now() AT TIME ZONE 'Europe/London')::date - interval '6 years'),
                    ('{FORMER_NO_END}', 'Former', '2012-01-01', NULL),
                    ('{FORMER_EDGE}', 'Former', '2001-01-01', ((now() AT TIME ZONE 'Europe/London')::date - interval '7 years')::date);""")

            # -------------------------------------------------------------------------------
            # CHECKs
            # -------------------------------------------------------------------------------
            essentials = course('essentials')
            fails("INSERT INTO training_courses (slug, title, kind) VALUES ('Bad Slug', 'Title', 'online');", 'training_courses_slug_check')
            fails("INSERT INTO training_courses (slug, title, kind) VALUES ('x', 'Title', 'online');", 'training_courses_slug_check')
            fails("INSERT INTO training_courses (slug, title, kind) VALUES ('essentials', 'Title', 'online');", 'training_courses_slug_key')
            fails("INSERT INTO training_courses (slug, title, kind) VALUES ('short-title', 'T', 'online');", 'training_courses_title_check')
            fails("INSERT INTO training_courses (slug, title, kind) VALUES ('bad-kind', 'Title', 'video');", 'training_courses_kind_check')
            fails("INSERT INTO training_courses (slug, title, kind, audience_groups) VALUES ('bad-group', 'Title', 'online', ARRAY['bar', 'cellar']);", 'training_courses_audience_groups_check')
            sql("BEGIN; INSERT INTO training_courses (slug, title, kind, audience_groups) VALUES ('good-group', 'Title', 'online', ARRAY['bar', 'management']); ROLLBACK;")
            fails("INSERT INTO training_courses (slug, title, kind, audience_age) VALUES ('bad-age', 'Title', 'online', 'over_65');", 'training_courses_audience_age_check')
            fails("INSERT INTO training_courses (slug, title, kind, audience_age) VALUES ('bad-age-18', 'Title', 'online', 'over_18');", 'training_courses_audience_age_check')
            for age in ('all', 'under_18', 'over_16', 'adult'):
                sql(f"BEGIN; INSERT INTO training_courses (slug, title, kind, audience_age) VALUES ('age-{age.replace('_', '-')}', 'Title', 'online', '{age}'); ROLLBACK;")
            fails("INSERT INTO training_courses (slug, title, kind, status) VALUES ('bad-status', 'Title', 'online', 'paused');", 'training_courses_status_check')
            fails("INSERT INTO training_courses (slug, title, kind, refresher_months) VALUES ('bad-refresher', 'Title', 'online', 0);", 'training_courses_refresher_months_check')
            fails("INSERT INTO training_courses (slug, title, kind, window_days) VALUES ('bad-window', 'Title', 'online', 181);", 'training_courses_window_days_check')
            fails("INSERT INTO training_courses (slug, title, kind, new_starter_due_days) VALUES ('bad-due', 'Title', 'online', 366);", 'training_courses_new_starter_due_days_check')
            assert sql(f"SELECT kind || '|' || status || '|' || audience_age || '|' || window_days || '|' || cardinality(audience_groups) FROM training_courses WHERE id = '{essentials}'") == 'online|draft|all|30|0'
            fails(f"""INSERT INTO training_course_versions (course_id, state, content, content_sha256) VALUES ('{essentials}', 'draft', '{{}}', 'not-a-hash');""", 'training_course_versions_content_sha256_check')
            fails(f"""INSERT INTO training_course_versions (course_id, state, content, content_sha256) VALUES ('{essentials}', 'archived', '{{}}', '{SHA}');""", 'violates check constraint "training_course_versions_')
            fails(f"""INSERT INTO training_course_versions (course_id, state, major, minor, content, content_sha256) VALUES ('{essentials}', 'draft', 1, 0, '{{}}', '{SHA}');""", 'training_course_versions_check')
            fails(f"""INSERT INTO training_course_versions (course_id, state, content, content_sha256) VALUES ('{essentials}', 'published', '{{}}', '{SHA}');""", 'training_course_versions_check')
            fails(f"INSERT INTO training_profiles (employee_id, groups) VALUES ('{ACTIVE}', ARRAY['bar', 'office']);", 'training_profiles_groups_check')
            fails(f"INSERT INTO training_profiles (employee_id, pause_reason) VALUES ('{ACTIVE}', 'illness');", 'training_profiles_pause_reason_check')
            fails(f"INSERT INTO training_profiles (employee_id, adjustment_note) VALUES ('{ACTIVE}', repeat('x', 301));", 'training_profiles_adjustment_note_check')
            sql(f"INSERT INTO training_profiles (employee_id, groups, adjustment_note) VALUES ('{ACTIVE}', ARRAY['bar', 'floor'], repeat('x', 300));")
            fails(f"INSERT INTO training_profiles (employee_id) VALUES ('{ACTIVE}');", 'training_profiles_pkey')
            fails("INSERT INTO training_profiles (employee_id) VALUES ('00000000-0000-0000-0000-000000000999');", 'training_profiles_employee_id_fkey')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 0, 'manual', 'assigned', current_date);""", 'training_assignments_cycle_check')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 1, 'because', 'assigned', current_date);""", 'training_assignments_reason_check')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 1, 'manual', 'overdue', current_date);""", 'training_assignments_status_check')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on, cancel_reason) VALUES ('{ACTIVE}', '{essentials}', 1, 'manual', 'cancelled', current_date, 'bored');""", 'training_assignments_cancel_reason_check')
            fails(f"INSERT INTO training_events (employee_id, event_type) VALUES ('{ACTIVE}', 'deleted');", 'training_events_event_type_check')
            fails(f"INSERT INTO training_events (employee_id, event_type, note) VALUES ('{ACTIVE}', 'assigned', repeat('x', 501));", 'training_events_note_check')
            fails(f"INSERT INTO training_reminders (kind, claim_key, london_date, status) VALUES ('sms', 'k1', current_date, 'claimed');", 'training_reminders_kind_check')
            fails(f"INSERT INTO training_reminders (kind, claim_key, london_date, status) VALUES ('staff_step', 'k1', current_date, 'failed');", 'training_reminders_status_check')
            print('PASS the CHECKs refuse bad slugs, titles, kinds, groups, ages, statuses, ranges, fingerprints, version states, pause reasons, notes and reminder kinds')

            # -------------------------------------------------------------------------------
            # Versions: one draft, frozen once published
            # -------------------------------------------------------------------------------
            v1 = draft(essentials)
            fails(f"""INSERT INTO training_course_versions (course_id, state, content, content_sha256) VALUES ('{essentials}', 'draft', '{{}}', '{SHA}');""", 'training_course_versions_one_draft')
            # A draft can be replaced and removed.
            sql(f"UPDATE training_course_versions SET content = '{{\"schemaVersion\": 1, \"title\": \"Essentials\"}}', content_sha256 = '{SHA_B}', uploaded_by_name = 'Second Upload' WHERE id = '{v1}';")
            spare = draft(course('spare-course'))
            sql(f"DELETE FROM training_course_versions WHERE id = '{spare}';")
            fails(f"UPDATE training_course_versions SET course_id = (SELECT id FROM training_courses WHERE slug = 'spare-course') WHERE id = '{v1}';", 'cannot move to another course')
            # Publishing cannot change the content that was checked.
            fails(publish(v1, extra=", content = '{}'::jsonb"), 'publishing cannot change the content that was checked')
            fails(publish(v1, extra=f", content_sha256 = '{SHA}'"), 'publishing cannot change the content that was checked')
            fails(publish(v1, extra=", images = '[{\"src\": \"x.jpg\"}]'::jsonb"), 'publishing cannot change the content that was checked')
            fails(publish(v1, extra=", uploaded_by_name = 'Someone Else'"), 'publishing cannot change the content that was checked')
            sql(publish(v1, extra=", change_note = 'First version', redo_required = false"))
            assert sql(f"SELECT state || '|' || major || '.' || minor || '|' || content_sha256 FROM training_course_versions WHERE id = '{v1}'") == f'published|1.0|{SHA_B}'
            fails(f"UPDATE training_course_versions SET change_note = 'Edited later' WHERE id = '{v1}';", 'a published version cannot be changed')
            fails(f"UPDATE training_course_versions SET state = 'draft', major = NULL, minor = NULL, published_at = NULL WHERE id = '{v1}';", 'a published version cannot be changed')
            fails(f"DELETE FROM training_course_versions WHERE id = '{v1}';", 'a published version cannot be deleted')
            fails('TRUNCATE training_course_versions CASCADE;', 'TRUNCATE is not allowed')
            # A second draft is allowed once the first is published; its number must be new.
            v2 = draft(essentials, sha=SHA)
            fails(publish(v2, major=1, minor=0), 'training_course_versions_number')
            sql(publish(v2, major=1, minor=1))
            sql(f"UPDATE training_courses SET current_version_id = '{v2}', status = 'live' WHERE id = '{essentials}';")
            fails(f"UPDATE training_courses SET current_version_id = '00000000-0000-0000-0000-000000000999' WHERE id = '{essentials}';", 'training_courses_current_version_fk')
            fails(f"DELETE FROM training_courses WHERE id = '{essentials}';", 'violates foreign key')
            print('PASS one draft per course; a draft can be replaced or removed; publishing freezes the checked content; a published version cannot be changed, deleted or truncated; numbers are unique')

            # -------------------------------------------------------------------------------
            # Assignments: one open cycle per person and course
            # -------------------------------------------------------------------------------
            # The touch trigger wins over whatever updated_at a caller writes.
            sql(f"UPDATE training_profiles SET groups = ARRAY['bar'], updated_at = '2000-01-01' WHERE employee_id = '{ACTIVE}';")
            assert sql(f"SELECT updated_at > '2020-01-01' FROM training_profiles WHERE employee_id = '{ACTIVE}'") == 't'
            a1 = assignment(ACTIVE, essentials, cycle=1, status='in_progress', extra_columns=', certificate_number', extra_values=", 'AT-ABCDEFGHJK'")
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 2, 'manual', 'waiting', current_date);""", 'training_assignments_one_open')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 1, 'manual', 'completed', current_date);""", 'training_assignments_employee_id_course_id_cycle_key')
            for status in ['waiting', 'assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined']:
                fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES ('{ACTIVE}', '{essentials}', 9, 'manual', '{status}', current_date);""", 'training_assignments_one_open')
            fails(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on, certificate_number) VALUES ('{OTHER}', '{essentials}', 1, 'manual', 'completed', current_date, 'AT-ABCDEFGHJK');""", 'training_assignments_certificate_number_key')
            # Closed cycles do not count: completed, waived and cancelled sit beside an open one.
            sql(f"""INSERT INTO training_assignments (employee_id, course_id, cycle, reason, status, assigned_on) VALUES
                    ('{OTHER}', '{essentials}', 1, 'existing_staff', 'completed', current_date),
                    ('{OTHER}', '{essentials}', 2, 'refresher', 'waived', current_date),
                    ('{OTHER}', '{essentials}', 3, 'redo', 'cancelled', current_date),
                    ('{OTHER}', '{essentials}', 4, 'refresher', 'assigned', current_date);""")
            assert count('training_assignments', f"employee_id = '{OTHER}'") == '4'
            sql(f"UPDATE training_assignments SET status = 'locked', updated_at = '2000-01-01' WHERE id = '{a1}';")
            assert sql(f"SELECT updated_at > '2020-01-01' FROM training_assignments WHERE id = '{a1}'") == 't'
            fails(f"UPDATE training_assignments SET signing_document_id = '{SIGNING_DOC}' WHERE id = '{a1}';", 'training_assignments_signing_document_id_fkey')
            fails(f"DELETE FROM employees WHERE employee_id = '{ACTIVE}';", 'violates foreign key')
            sql(f"UPDATE training_assignments SET status = 'in_progress' WHERE id = '{a1}';")
            print('PASS one open cycle per person and course (every open status); cycles and certificate numbers are unique; closed cycles sit beside an open one; updated_at is touched; a person with training cannot be deleted')

            # -------------------------------------------------------------------------------
            # Attempts: one open per section, answered only while open, never deleted
            # -------------------------------------------------------------------------------
            t1 = attempt(a1, ACTIVE, v2, 'fire', 1)
            fails(f"""INSERT INTO training_attempts (assignment_id, employee_id, version_id, section_key, attempt_no, served) VALUES ('{a1}', '{ACTIVE}', '{v2}', 'fire', 2, '[]');""", 'training_attempts_one_open')
            fails(f"""INSERT INTO training_attempts (assignment_id, employee_id, version_id, section_key, attempt_no, served) VALUES ('{a1}', '{ACTIVE}', '{v2}', 'other', 0, '[]');""", 'training_attempts_attempt_no_check')
            # Another section can be open at the same time.
            t_other = attempt(a1, ACTIVE, v2, 'allergens', 1)
            fails(f"UPDATE training_attempts SET served = '[]' WHERE id = '{t1}';", 'only the answers and result of an open attempt can be written')
            fails(f"UPDATE training_attempts SET section_key = 'allergens-2' WHERE id = '{t1}';", 'only the answers and result of an open attempt can be written')
            fails(f"UPDATE training_attempts SET started_at = now() - interval '1 hour' WHERE id = '{t1}';", 'only the answers and result of an open attempt can be written')
            sql(f"""UPDATE training_attempts SET submitted_at = now(), answers = '{{"fire-01": 1}}', results = '[]', wrong_count = 1, critical_missed = 1, passed = false WHERE id = '{t1}';""")
            fails(f"UPDATE training_attempts SET passed = true WHERE id = '{t1}';", 'a submitted attempt cannot be changed')
            fails(f"DELETE FROM training_attempts WHERE id = '{t_other}';", 'an attempt cannot be deleted')
            fails(f"DELETE FROM training_attempts WHERE id = '{t1}';", 'an attempt cannot be deleted')
            fails('TRUNCATE training_attempts;', 'TRUNCATE is not allowed')
            fails(f"""INSERT INTO training_attempts (assignment_id, employee_id, version_id, section_key, attempt_no, served) VALUES ('{a1}', '{ACTIVE}', '{v2}', 'fire', 1, '[]');""", 'training_attempts_assignment_id_section_key_attempt_no_key')
            # Once the first is submitted, the next attempt for that section can open.
            attempt(a1, ACTIVE, v2, 'fire', 2)
            print('PASS one open attempt per section; an open attempt takes only its answers and result; a submitted one is frozen; attempts cannot be deleted or truncated')

            # -------------------------------------------------------------------------------
            # Events: append-only. Reminders: one claim per key, releasable.
            # -------------------------------------------------------------------------------
            e1 = event(ACTIVE, a1)
            fails(f"UPDATE training_events SET note = 'changed' WHERE id = '{e1}';", 'append-only')
            fails(f"DELETE FROM training_events WHERE id = '{e1}';", 'append-only')
            fails('TRUNCATE training_events;', 'TRUNCATE is not allowed')
            # Turning the flag on outside a transaction-local purge still never allows an update.
            fails(f"BEGIN; SELECT set_config('training.retention_purge', 'on', true); UPDATE training_events SET note = 'changed' WHERE id = '{e1}'; COMMIT;", 'append-only')
            fails(f"BEGIN; SELECT set_config('training.retention_purge', 'on', true); UPDATE training_attempts SET passed = true WHERE id = '{t1}'; COMMIT;", 'a submitted attempt cannot be changed')
            r1 = reminder(ACTIVE, a1, f'step:{a1}:assigned:2026-11-20')
            fails(f"INSERT INTO training_reminders (kind, claim_key, london_date, status) VALUES ('staff_step', 'step:{a1}:assigned:2026-11-20', current_date, 'claimed');", 'training_reminders_claim')
            sql(f"UPDATE training_reminders SET status = 'sent', updated_at = '2000-01-01' WHERE id = '{r1}';")
            assert sql(f"SELECT updated_at > '2020-01-01' FROM training_reminders WHERE id = '{r1}'") == 't'
            released = reminder(ACTIVE, a1, f'nologin:{ACTIVE}')
            sql(f"DELETE FROM training_reminders WHERE id = '{released}';")
            sql(f"UPDATE training_courses SET summary = 'Touched', updated_at = '2000-01-01' WHERE id = '{essentials}';")
            assert sql(f"SELECT updated_at > '2020-01-01' FROM training_courses WHERE id = '{essentials}'") == 't'
            print('PASS the timeline refuses update, delete and truncate; the purge flag never allows an update; a reminder claim is unique and can be released')

            # -------------------------------------------------------------------------------
            # Retention
            # -------------------------------------------------------------------------------
            old_assignment = assignment(FORMER_OLD, essentials, cycle=1, status='completed')
            second_cycle = assignment(FORMER_OLD, essentials, cycle=2, status='cancelled')
            old_attempt = attempt(old_assignment, FORMER_OLD, v2, 'fire', 1)
            sql(f"UPDATE training_attempts SET submitted_at = now(), passed = true WHERE id = '{old_attempt}';")
            attempt(second_cycle, FORMER_OLD, v2, 'fire', 1)
            event(FORMER_OLD, old_assignment, 'completed')
            event(FORMER_OLD, second_cycle, 'cancelled')
            event(FORMER_OLD)
            reminder(FORMER_OLD, old_assignment, f'step:{old_assignment}:overdue:2015-01-01')
            sql(f"INSERT INTO training_profiles (employee_id, groups) VALUES ('{FORMER_OLD}', ARRAY['kitchen']);")
            # Course-level events and other people's rows are left alone.
            sql(f"INSERT INTO training_events (course_id, event_type) VALUES ('{essentials}', 'course_published');")
            before_other = {table: count(table, f"employee_id <> '{FORMER_OLD}' OR employee_id IS NULL") for table in TRAINING_TABLES if table not in ('training_courses', 'training_course_versions')}

            fails(f"SELECT training_retention_purge('{ACTIVE}');", 'is Active, not Former')
            fails(f"SELECT training_retention_purge('{FORMER_RECENT}');", 'less than 7 years ago')
            fails(f"SELECT training_retention_purge('{FORMER_NO_END}');", 'has no employment end date')
            fails("SELECT training_retention_purge('00000000-0000-0000-0000-000000000999');", 'not found')
            fails('SELECT training_retention_purge(NULL);', 'no employee given')
            # The flag ends with the purge: a delete later in the same transaction is refused, and
            # the whole transaction, purge included, rolls back.
            fails(f"BEGIN; SELECT training_retention_purge('{FORMER_OLD}'); DELETE FROM training_events WHERE id = '{e1}'; COMMIT;", 'append-only')
            assert count('training_attempts', f"employee_id = '{FORMER_OLD}'") == '2'
            assert count('training_events', f"employee_id = '{FORMER_OLD}'") == '3'

            purged = json.loads(sql(as_role('service_role', f"SELECT training_retention_purge('{FORMER_OLD}');")).splitlines()[-2])
            assert purged == {'employee_id': FORMER_OLD, 'attempts': 2, 'events': 3, 'reminders': 1, 'assignments': 2, 'profiles': 1}, purged
            for table in ['training_profiles', 'training_assignments', 'training_attempts', 'training_events', 'training_reminders']:
                assert count(table, f"employee_id = '{FORMER_OLD}'") == '0', table
            after_other = {table: count(table, f"employee_id <> '{FORMER_OLD}' OR employee_id IS NULL") for table in before_other}
            assert after_other == before_other, (before_other, after_other)
            assert count('training_events', "event_type = 'course_published'") == '1'
            # Ended exactly 7 years ago today (London): allowed, with nothing to remove.
            edge = json.loads(sql(f"SELECT training_retention_purge('{FORMER_EDGE}');"))
            assert edge['assignments'] == 0 and edge['profiles'] == 0, edge
            # The flag is off again straight after the purge, still inside its transaction.
            assert sql(f"BEGIN; SELECT training_retention_purge('{FORMER_EDGE}'); SELECT current_setting('training.retention_purge', true); COMMIT;").splitlines()[-2] == 'off'
            print('PASS retention refuses anyone not Former, ended under 7 years ago or with no end date; removes exactly one person\'s rows and returns the counts; its bypass ends with it')

            # -------------------------------------------------------------------------------
            # Signing kinds
            # -------------------------------------------------------------------------------
            def signing_document(kind, doc_id='gen_random_uuid()'):
                identifier = doc_id if doc_id.endswith('()') else f"'{doc_id}'"
                return f"""INSERT INTO signing_documents (id, kind, mode, brand, title, subject_type, subject_id, series_key, version, source_pdf_path, source_sha256, expires_at)
                           VALUES ({identifier}, '{kind}', 'acknowledge', 'staff', 'Training confirmation', 'employee', '{ACTIVE}', 'training:{kind}', 1, 'p/{kind}.pdf', '{SHA}', now() + interval '30 days');"""

            def template(kind, slug):
                return f"INSERT INTO signing_templates (kind, slug, title, body) VALUES ('{kind}', '{slug}', 'Test', 'Test wording.');"

            fails(signing_document('training_completion'), 'signing_documents_kind_check')
            fails(signing_document('training_signoff'), 'signing_documents_kind_check')
            kinds = KINDS.read_text()
            sql(kinds)
            sql(kinds)
            assert sql("SELECT count(*) FROM pg_constraint WHERE conrelid = 'public.signing_documents'::regclass AND conname = 'signing_documents_kind_check' AND convalidated") == '1'
            sql(signing_document('training_completion', SIGNING_DOC))
            sql('BEGIN; ' + signing_document('training_signoff') + ' ROLLBACK;')
            for kind in ['employment_agreement', 'terms_variation', 'policy_acknowledgement', 'deduction_consent', 'working_time_opt_out', 'guardian_consent',
                         'job_offer', 'private_booking_contract', 'private_booking_waiver', 'quote_acceptance', 'client_agreement', 'supplier_confirmation',
                         'deposit_deduction_agreement']:
                sql('BEGIN; ' + signing_document(kind) + ' ROLLBACK;')
            fails(signing_document('made_up_kind'), 'signing_documents_kind_check')
            # Generator kinds have no wording, so they are still refused as templates.
            fails(template('training_completion', 'training-completion'), 'signing_templates_kind_check')
            fails(template('training_signoff', 'training-signoff'), 'signing_templates_kind_check')
            assert sql("SELECT count(*) FROM signing_templates WHERE kind LIKE 'training%'") == '0'
            # An assignment can now point at its confirmation document.
            sql(f"UPDATE training_assignments SET status = 'awaiting_confirmation', signing_document_id = '{SIGNING_DOC}' WHERE id = '{a1}';")
            print('PASS both training kinds are accepted on documents after the migration and refused before; the thirteen earlier kinds still are; neither is a template kind; running it twice is harmless')

            # -------------------------------------------------------------------------------
            # Permissions
            # -------------------------------------------------------------------------------
            permissions = PERMISSIONS.read_text()
            sql(permissions)
            sql(permissions)
            assert sql("SELECT string_agg(action, ',' ORDER BY action) FROM permissions WHERE module_name = 'training'") == 'manage,publish,view'
            assert sql("SELECT count(*) FROM permissions WHERE module_name = 'training' AND coalesce(description, '') = ''") == '0'
            granted = sql("""SELECT r.name || ':' || string_agg(p.action, ',' ORDER BY p.action)
                             FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id
                             WHERE p.module_name = 'training' GROUP BY r.name ORDER BY r.name""").splitlines()
            # Publishing is the owner's (super_admin only, owner decision 3 November 2026); managers view and manage.
            assert granted == ['manager:manage,view', 'super_admin:manage,publish,view'], granted
            assert count('role_permissions') == '7'
            assert sql("SELECT string_agg(r.name, ',' ORDER BY r.name) FROM role_permissions rp JOIN roles r ON r.id = rp.role_id JOIN permissions p ON p.id = rp.permission_id WHERE p.module_name = 'employees'") == 'manager,staff'
            print('PASS training view, manage and publish exist once each; super_admin gets all three, manager view and manage only, nobody else any; running it twice adds nothing')

            # -------------------------------------------------------------------------------
            # Retired policy drafts
            # -------------------------------------------------------------------------------
            retired = "('health-and-safety', 'allergens', 'challenge-25', 'data-protection')"
            # One of them was switched on by hand before the migration: it must end up off.
            sql("UPDATE signing_templates SET is_active = true WHERE slug = 'allergens'")
            handbook_before = sql("SELECT md5(body) || '|' || version || '|' || is_active || '|' || updated_at FROM signing_templates WHERE slug = 'staff-handbook'")
            versions_before = sql(f"SELECT string_agg(slug || ':' || version, ',' ORDER BY slug) FROM signing_templates WHERE slug IN {retired}")
            bodies_before = {row.split('|')[0]: row.split('|')[1] for row in sql(f"SELECT slug || '|' || md5(body) FROM signing_templates WHERE slug IN {retired}").splitlines()}
            retire = RETIRE.read_text()
            sql(retire)
            assert sql(f"SELECT count(*) FROM signing_templates WHERE slug IN {retired} AND NOT is_active AND body LIKE '[[RETIRED: replaced by the staff training courses%'") == '4'
            assert sql(f"SELECT string_agg(slug || ':' || version, ',' ORDER BY slug) FROM signing_templates WHERE slug IN {retired}") == ','.join(
                f"{item.split(':')[0]}:{int(item.split(':')[1]) + 1}" for item in versions_before.split(','))
            # The old wording is kept whole after the new first line.
            for slug, digest in bodies_before.items():
                assert sql(f"SELECT md5(substr(body, strpos(body, ']]') + 4)) FROM signing_templates WHERE slug = '{slug}'") == digest, slug
            assert sql("SELECT md5(body) || '|' || version || '|' || is_active || '|' || updated_at FROM signing_templates WHERE slug = 'staff-handbook'") == handbook_before
            # Running it again changes nothing, and switches off one switched back on by hand.
            after_first = sql(f"SELECT string_agg(slug || ':' || version || ':' || md5(body), ',' ORDER BY slug) FROM signing_templates WHERE slug IN {retired}")
            sql("UPDATE signing_templates SET is_active = true WHERE slug = 'challenge-25'")
            sql(retire)
            assert sql(f"SELECT string_agg(slug || ':' || version || ':' || md5(body), ',' ORDER BY slug) FROM signing_templates WHERE slug IN {retired}") == after_first
            assert sql(f"SELECT count(*) FROM signing_templates WHERE slug IN {retired} AND is_active") == '0'
            assert sql(f"SELECT count(*) FROM signing_templates WHERE slug IN {retired} AND (length(body) - length(replace(body, '[[RETIRED:', ''))) / length('[[RETIRED:') = 1") == '4'
            print('PASS the four policy drafts are switched off and marked retired, version up by one, old wording kept; the staff handbook is untouched; running it twice changes nothing more')

            # Every training table is still closed after all four migrations.
            for table in TRAINING_TABLES:
                for role in ['anon', 'authenticated']:
                    assert sql(f"SELECT has_table_privilege('{role}', 'public.{table}', 'SELECT, INSERT, UPDATE, DELETE, TRUNCATE')") == 'f', (table, role)
            print('PASS after all four migrations, anon and authenticated still hold nothing on any training table')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(work / 'db'), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()

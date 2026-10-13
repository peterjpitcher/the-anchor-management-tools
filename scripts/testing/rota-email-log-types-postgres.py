#!/usr/bin/env python3
"""Exercise the rota email log type migration in an isolated socket-only PostgreSQL database.

The table and its check are built from the real migrations: the CREATE TABLE block from the rota
system migration and the constraint block from the shift acceptance migration, which is what
production carried until now. Only the auth.users table the log points at is a fixture. The rows
are synthetic.
"""
import os
from pathlib import Path
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
MIGRATIONS = ROOT / 'supabase/migrations'
ROTA_SYSTEM = MIGRATIONS / '20260228100000_rota_system.sql'
SHIFT_ACCEPTANCE = MIGRATIONS / '20260704000000_portal_shift_acceptance.sql'
MIGRATION = MIGRATIONS / '20261013155149_rota_email_log_unfilled_urgent.sql'
ROLLBACK = ROOT / 'tasks/rota-email-log-unfilled-urgent/rollback.sql'

SETUP = r"""
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid primary key);
CREATE FUNCTION fixture_assert(boolean, text) RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF $1 IS DISTINCT FROM true THEN RAISE EXCEPTION 'FAIL %', $2; END IF; RAISE NOTICE 'PASS %', $2; END $$;
"""

# The ten types production accepted before the migration. Each is written once as a baseline row.
EXISTING_TYPES = [
    'staff_rota', 'staff_rota_change', 'manager_alert', 'holiday_submitted', 'holiday_decision',
    'holiday_manager_notify', 'payroll_export', 'shift_rejected', 'shift_auto_accept_warning',
    'open_shift_requested',
]

def block(path, pattern, label):
    """One statement block lifted from a real migration, so the history here is the real SQL."""
    match = re.search(pattern, path.read_text(), re.S)
    if not match: raise RuntimeError(f'{label} not found in {path.name}: has the migration changed shape?')
    return match.group(0)

def insert(email_type):
    return ("INSERT INTO public.rota_email_log(email_type, entity_type, to_addresses, subject, status)"
            f" VALUES ('{email_type}', 'rota_shift', ARRAY['manager@example.com'], 'Test', 'sent')")

ROWS = "(SELECT count(*) FROM public.rota_email_log)"
URGENT_ROWS = "(SELECT count(*) FROM public.rota_email_log WHERE email_type='unfilled_urgent')"
ONE_CHECK = "(SELECT count(*)=1 FROM pg_constraint WHERE conrelid='public.rota_email_log'::regclass AND conname='rota_email_log_email_type_check')"
VALIDATED = "(SELECT convalidated FROM pg_constraint WHERE conrelid='public.rota_email_log'::regclass AND conname='rota_email_log_email_type_check')"

def main():
    with tempfile.TemporaryDirectory(prefix='rota-email-log-pg-') as folder:
        work = Path(folder); socket = work / 'socket'; socket.mkdir(); cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'), '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'], check=True, capture_output=True)
        cmd = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']
        def sql(value):
            result = subprocess.run(cmd, input=value, text=True, capture_output=True)
            if result.returncode: raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line: print(line)
            return result.stdout
        def check(expression, label): sql("SELECT fixture_assert(" + expression + ",'" + label + "');")
        def fails_with(statement, sqlstate, label):
            sql("DO $t$ BEGIN " + statement + "; RAISE EXCEPTION 'FAIL " + label + " (statement was accepted)';"
                " EXCEPTION WHEN SQLSTATE '" + sqlstate + "' THEN RAISE NOTICE 'PASS " + label + "'; END $t$;")
        try:
            sql(SETUP)
            sql(block(ROTA_SYSTEM, r'CREATE TABLE IF NOT EXISTS public\.rota_email_log \(.*?\n\);', 'the rota_email_log table'))
            sql(block(SHIFT_ACCEPTANCE, r'DO \$\$\nDECLARE\n  constraint_name text;.*?ADD CONSTRAINT rota_email_log_email_type_check.*?\)\);', 'the email type check'))
            for email_type in EXISTING_TYPES: sql(insert(email_type) + ';')
            check(ROWS + "=10", 'baseline accepts the ten existing types')
            fails_with(insert('unfilled_urgent'), '23514', 'baseline refuses unfilled_urgent, as production did')

            sql('BEGIN;' + MIGRATION.read_text() + 'ROLLBACK;')
            fails_with(insert('unfilled_urgent'), '23514', 'a rolled back transaction leaves the old check in place')

            sql(MIGRATION.read_text())
            check(ROWS + "=10", 'the migration keeps every existing row')
            check(ONE_CHECK, 'there is exactly one email type check')
            check(VALIDATED, 'the new check is validated against the existing rows')
            sql(insert('unfilled_urgent') + ';')
            check(URGENT_ROWS + "=1", 'unfilled_urgent is now accepted')
            for email_type in EXISTING_TYPES: sql(insert(email_type) + ';')
            check(ROWS + "=21", 'the ten existing types are still accepted')
            fails_with(insert('not_a_type'), '23514', 'an unknown type is still refused')
            fails_with(insert('unfilled_urgent').replace("'sent')", "'queued')"), '23514', 'the status check is untouched')

            sql(MIGRATION.read_text())
            check(ROWS + "=21 AND " + ONE_CHECK + " AND " + VALIDATED, 'a second run changes nothing')

            sql(ROLLBACK.read_text())
            check(URGENT_ROWS + "=1", 'rollback keeps the unfilled_urgent rows already written')
            fails_with(insert('unfilled_urgent'), '23514', 'rollback refuses new unfilled_urgent rows again')
            sql(insert('manager_alert') + ';')
            check(ROWS + "=22", 'rollback still accepts the ten existing types')

            sql(MIGRATION.read_text())
            sql(insert('unfilled_urgent') + ';')
            check(URGENT_ROWS + "=2 AND " + VALIDATED, 'the migration applies cleanly again after a rollback')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)

if __name__ == '__main__': main()

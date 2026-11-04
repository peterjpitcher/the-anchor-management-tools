#!/usr/bin/env python3
"""Run the shift-after-last-working-day guard against an isolated PostgreSQL cluster.

The guard sits on top of the employee separation schema, so this builds the same fixture as
employee-separation-postgres.py, applies that migration, then this one.
"""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
BASE_MIGRATION = ROOT / 'supabase/migrations/20260914075843_employee_separation_shift_policy.sql'
MIGRATION = ROOT / 'supabase/migrations/20261104143348_guard_shifts_after_last_working_day.sql'
ROLLBACK = ROOT / 'supabase/rollbacks/20261104143348_guard_shifts_after_last_working_day.sql'
TEST = ROOT / 'tests/db/shift-after-last-working-day.sql'

# The separation harness's fixture (employees, rota weeks, shifts, templates), so the two never drift.
_spec = importlib.util.spec_from_file_location(
    'employee_separation_postgres', Path(__file__).with_name('employee-separation-postgres.py'),
)
_separation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_separation)
SETUP = _separation.SETUP


def main() -> None:
    with tempfile.TemporaryDirectory(prefix='shift-last-day-pg-') as folder:
        work = Path(folder)
        socket = work / 'socket'
        socket.mkdir()
        cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1']

        def sql(value: str) -> str:
            result = subprocess.run(command, input=value, text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line:
                    print(line)
            return result.stdout

        try:
            sql(SETUP)
            sql(BASE_MIGRATION.read_text())
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            print('PASS migration executes inside a rolled-back transaction')
            sql(MIGRATION.read_text())
            sql(TEST.read_text())
            sql(ROLLBACK.read_text())
            sql("""
                DO $$ BEGIN
                  IF to_regprocedure('public.guard_shift_after_last_working_day()') IS NOT NULL THEN
                    RAISE EXCEPTION 'rollback left the guard function behind';
                  END IF;
                  IF EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_shift_after_last_working_day') THEN
                    RAISE EXCEPTION 'rollback left the trigger behind';
                  END IF;
                  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'guard_released_separation_rota_shift_assignment') THEN
                    RAISE EXCEPTION 'rollback removed the older released-shift guard';
                  END IF;
                END $$;
            """)
            print('PASS rollback removes only the new guard')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()

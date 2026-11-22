#!/usr/bin/env python3
"""Run approve_rota_open_shift_request against an isolated PostgreSQL cluster.

The function could not approve anything from 8 July to 22 November 2026: its last statement used
bare column names that are also the names of its output columns, and Postgres refused them as
ambiguous. The unit tests mock the database call, so nothing ran the SQL. This harness does: it
shows the original definition failing, applies the fix, and runs a real approval end to end.
"""

import importlib.util
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path(os.environ.get('PG_BIN', '/opt/homebrew/bin'))
ORIGINAL = ROOT / 'supabase/migrations/20260708000013_open_shift_request_manager_approval.sql'
MIGRATION = ROOT / 'supabase/migrations/20261122140000_open_shift_approval_ambiguous_columns.sql'
ROLLBACK = ROOT / 'supabase/rollbacks/20261122140000_open_shift_approval_ambiguous_columns.sql'
TEST = ROOT / 'tests/db/open-shift-approval.sql'

# The separation harness's fixture (employees, rota weeks, shifts, published shifts), so the two
# never drift.
_spec = importlib.util.spec_from_file_location(
    'employee_separation_postgres', Path(__file__).with_name('employee-separation-postgres.py'),
)
_separation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_separation)

# The three further tables the approval reads and writes, with the columns production has.
EXTRA_SETUP = r"""
CREATE TABLE public.rota_open_shift_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES public.rota_shifts(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  note text,
  status text NOT NULL DEFAULT 'pending',
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  decided_by uuid,
  manager_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.leave_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  start_date date NOT NULL,
  end_date date NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  holiday_year smallint NOT NULL
);

CREATE TABLE public.leave_days (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id uuid NOT NULL REFERENCES public.leave_requests(id) ON DELETE CASCADE,
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  leave_date date NOT NULL
);
"""

# The original definition, called on a throwaway copy of the happy path. It must fail with the
# error staff saw, and the failure must roll the whole approval back.
REPRODUCE = r"""
DO $$
DECLARE
  v_message text;
BEGIN
  INSERT INTO auth.users (id) VALUES ('90000000-0000-0000-0000-0000000000aa');
  INSERT INTO public.employees (employee_id, email_address) VALUES ('a0000000-0000-0000-0000-0000000000aa', 'repro@example.test');
  INSERT INTO public.rota_weeks (id, week_start, status) VALUES ('b0000000-0000-0000-0000-0000000000aa', '2026-07-06', 'published');
  INSERT INTO public.rota_shifts (id, week_id, shift_date, start_time, end_time, department, is_open_shift, name)
  VALUES ('c0000000-0000-0000-0000-0000000000aa', 'b0000000-0000-0000-0000-0000000000aa', '2026-07-10', '17:00', '22:00', 'bar', true, 'Repro');
  INSERT INTO public.rota_published_shifts (id, week_id, shift_date, start_time, end_time, department, is_open_shift, name)
  VALUES ('c0000000-0000-0000-0000-0000000000aa', 'b0000000-0000-0000-0000-0000000000aa', '2026-07-10', '17:00', '22:00', 'bar', true, 'Repro');
  INSERT INTO public.rota_open_shift_requests (id, shift_id, employee_id)
  VALUES ('d0000000-0000-0000-0000-0000000000aa', 'c0000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-0000000000aa');

  BEGIN
    PERFORM * FROM public.approve_rota_open_shift_request(
      'd0000000-0000-0000-0000-0000000000aa', 'c0000000-0000-0000-0000-0000000000aa', 'a0000000-0000-0000-0000-0000000000aa',
      '90000000-0000-0000-0000-0000000000aa', '2026-07-10', '17:00', '22:00', 0::smallint, 'bar', false, 'Repro');
    RAISE EXCEPTION 'the original function approved a request: this harness no longer reproduces the fault';
  EXCEPTION WHEN ambiguous_column THEN
    GET STACKED DIAGNOSTICS v_message = MESSAGE_TEXT;
    IF v_message <> 'column reference "shift_id" is ambiguous' THEN
      RAISE EXCEPTION 'unexpected ambiguity: %', v_message;
    END IF;
  END;

  IF (SELECT status FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-0000000000aa') <> 'pending'
     OR (SELECT employee_id FROM public.rota_shifts WHERE id = 'c0000000-0000-0000-0000-0000000000aa') IS NOT NULL THEN
    RAISE EXCEPTION 'the failed approval left changes behind';
  END IF;

  DELETE FROM public.rota_weeks WHERE id = 'b0000000-0000-0000-0000-0000000000aa';
  DELETE FROM public.employees WHERE employee_id = 'a0000000-0000-0000-0000-0000000000aa';
  DELETE FROM auth.users WHERE id = '90000000-0000-0000-0000-0000000000aa';
END $$;
"""

GRANTS = "SELECT coalesce(proacl::text, 'default') FROM pg_proc WHERE proname = 'approve_rota_open_shift_request';"
SOURCE = "SELECT md5(prosrc) FROM pg_proc WHERE proname = 'approve_rota_open_shift_request';"


def main() -> None:
    with tempfile.TemporaryDirectory(prefix='open-shift-approval-pg-') as folder:
        work = Path(folder)
        socket = work / 'socket'
        socket.mkdir()
        cluster = work / 'db'
        subprocess.run([str(PG / 'initdb'), '-D', str(cluster), '-A', 'trust', '--no-locale'], check=True, capture_output=True)
        subprocess.run([
            str(PG / 'pg_ctl'), '-D', str(cluster), '-l', str(work / 'log'),
            '-o', f"-k {socket} -c listen_addresses=''", '-w', 'start'
        ], check=True, capture_output=True)
        command = [str(PG / 'psql'), '-h', str(socket), '-d', 'postgres', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1']

        def sql(value: str) -> str:
            result = subprocess.run(command, input=value, text=True, capture_output=True)
            if result.returncode:
                raise RuntimeError(result.stderr)
            for line in result.stderr.splitlines():
                if 'PASS ' in line:
                    print(line)
            return result.stdout.strip()

        try:
            sql(_separation.SETUP)
            sql(EXTRA_SETUP)
            sql(ORIGINAL.read_text())
            original_source = sql(SOURCE)
            original_grants = sql(GRANTS)
            sql(REPRODUCE)
            print('PASS the original function fails with the ambiguous shift_id error and changes nothing')

            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            print('PASS migration executes inside a rolled-back transaction')
            sql(MIGRATION.read_text())
            if sql(GRANTS) != original_grants:
                raise RuntimeError('the migration changed who may execute the function')
            print('PASS migration leaves the EXECUTE grants as they were')
            sql(TEST.read_text())

            sql(ROLLBACK.read_text())
            if sql(SOURCE) != original_source:
                raise RuntimeError('rollback did not put the original function body back')
            print('PASS rollback puts the original function back')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()

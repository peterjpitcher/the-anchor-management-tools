#!/usr/bin/env python3
"""Run the employee separation migration against an isolated PostgreSQL cluster."""

from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
PG = Path('/opt/homebrew/bin')
MIGRATION = ROOT / 'supabase/migrations/20260914100000_employee_separation_shift_policy.sql'
ROLLBACK = ROOT / 'supabase/rollbacks/20260914100000_employee_separation_shift_policy.sql'
TEST = ROOT / 'tests/db/employee-separation-shifts.sql'

SETUP = r"""
CREATE ROLE anon;
CREATE ROLE authenticated;
CREATE ROLE service_role;
CREATE SCHEMA auth;
CREATE TABLE auth.users(id uuid PRIMARY KEY);

CREATE TABLE public.employees (
  employee_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_address text NOT NULL UNIQUE,
  first_name text,
  last_name text,
  employment_start_date date,
  employment_end_date date,
  status text NOT NULL DEFAULT 'Active' CHECK (status IN ('Onboarding', 'Active', 'Started Separation', 'Former')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_employment_dates CHECK (employment_end_date IS NULL OR employment_end_date > employment_start_date)
);

CREATE TABLE public.rota_weeks (
  id uuid PRIMARY KEY,
  week_start date NOT NULL UNIQUE,
  status text NOT NULL CHECK (status IN ('draft', 'published'))
);

CREATE TABLE public.rota_shift_templates (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  department text NOT NULL,
  employee_id uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.rota_shifts (
  id uuid PRIMARY KEY,
  week_id uuid NOT NULL REFERENCES public.rota_weeks(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.rota_shift_templates(id) ON DELETE SET NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  unpaid_break_minutes smallint NOT NULL DEFAULT 0,
  department text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  notes text,
  is_overnight boolean NOT NULL DEFAULT false,
  original_employee_id uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  reassigned_from_id uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  reassigned_at timestamptz,
  reassigned_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reassignment_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  is_open_shift boolean NOT NULL DEFAULT false,
  name text,
  acceptance_status text,
  acceptance_decided_at timestamptz,
  acceptance_decided_by uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  acceptance_note text,
  auto_accept_reason text,
  auto_accept_warning_sent_at timestamptz,
  CONSTRAINT rota_shifts_open_shift_check CHECK (
    (is_open_shift AND employee_id IS NULL) OR (NOT is_open_shift AND employee_id IS NOT NULL)
  )
);

CREATE TABLE public.rota_published_shifts (
  id uuid PRIMARY KEY,
  week_id uuid NOT NULL REFERENCES public.rota_weeks(id) ON DELETE CASCADE,
  employee_id uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  unpaid_break_minutes smallint NOT NULL DEFAULT 0,
  department text NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  notes text,
  is_overnight boolean NOT NULL DEFAULT false,
  is_open_shift boolean NOT NULL DEFAULT false,
  name text,
  published_at timestamptz NOT NULL DEFAULT now(),
  acceptance_status text,
  acceptance_decided_at timestamptz,
  acceptance_decided_by uuid REFERENCES public.employees(employee_id) ON DELETE SET NULL,
  acceptance_note text,
  auto_accept_reason text,
  auto_accept_warning_sent_at timestamptz
);

CREATE TABLE public.rota_shift_calendar_cancellations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL,
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  week_id uuid REFERENCES public.rota_weeks(id) ON DELETE CASCADE,
  shift_date date NOT NULL,
  start_time time NOT NULL,
  end_time time NOT NULL,
  unpaid_break_minutes smallint NOT NULL DEFAULT 0,
  department text NOT NULL,
  notes text,
  is_overnight boolean NOT NULL DEFAULT false,
  name text,
  cancelled_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  UNIQUE (shift_id, employee_id)
);
"""


def main() -> None:
    with tempfile.TemporaryDirectory(prefix='employee-separation-pg-') as folder:
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
            sql('BEGIN;\n' + MIGRATION.read_text() + '\nROLLBACK;')
            sql(MIGRATION.read_text())
            sql(TEST.read_text())
            sql(ROLLBACK.read_text())
            sql("""
                DO $$ BEGIN
                  IF to_regprocedure('public.begin_employee_separation(uuid,date,text,uuid,timestamptz)') IS NOT NULL THEN
                    RAISE EXCEPTION 'rollback left the function behind';
                  END IF;
                  IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema='public' AND table_name='employees'
                      AND column_name='separation_shift_policy'
                  ) THEN
                    RAISE EXCEPTION 'rollback left the policy column behind';
                  END IF;
                END $$;
            """)
            print('PASS migration executes inside a rolled-back transaction')
            print('PASS rollback restores the original schema shape')
        finally:
            subprocess.run([str(PG / 'pg_ctl'), '-D', str(cluster), '-m', 'immediate', '-w', 'stop'], check=True, capture_output=True)


if __name__ == '__main__':
    main()

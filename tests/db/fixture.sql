-- Minimal schema for the database contract test.
--
-- Deliberately NOT a copy of production. It creates only the bare tables that the migrations
-- under test need to attach themselves to, and then those REAL migration files are applied on
-- top by the CI step. That way the thing being asserted, the index and constraint definitions,
-- comes from supabase/migrations rather than from a duplicate here that would quietly drift.
--
-- Run against a throwaway database. See .github/workflows/ci.yml, and the header of
-- tests/db/schema-contract.sql for how to run it locally.

-- Supabase roles the migrations grant to. Absent from a bare Postgres.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
end $$;

create extension if not exists "pgcrypto";

create table if not exists public.employees (
  employee_id  uuid primary key default gen_random_uuid(),
  email_address text not null,
  first_name   text,
  last_name    text,
  status       text not null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.leave_requests (
  id           uuid primary key default gen_random_uuid(),
  employee_id  uuid not null references public.employees (employee_id) on delete cascade,
  start_date   date not null,
  end_date     date not null,
  note         text,
  status       text not null default 'pending',
  holiday_year smallint not null default 2026,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create table if not exists public.leave_days (
  id          uuid primary key default gen_random_uuid(),
  request_id  uuid not null references public.leave_requests (id) on delete cascade,
  employee_id uuid not null references public.employees (employee_id) on delete cascade,
  leave_date  date not null,
  created_at  timestamptz not null default now()
);

-- The rule that stops one person holding two leave rows for the same day.
create unique index if not exists leave_days_unique
  on public.leave_days (employee_id, leave_date);

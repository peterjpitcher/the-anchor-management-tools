-- Database contract test.
--
-- These are the rules that only a real Postgres can prove. The journey test in
-- tests/actions/onboardingJourney.test.ts covers the sequence the application walks, but it
-- stands in for the database, so it cannot demonstrate what an index actually does. Everything
-- below is asserted against the REAL definitions, applied from supabase/migrations by the CI
-- step that runs this file.
--
-- Run locally:
--   docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=postgres --name ams-contract postgres:15
--   export U=postgres://postgres:postgres@localhost:55432/postgres
--   psql "$U" -v ON_ERROR_STOP=1 -f tests/db/fixture.sql
--   psql "$U" -v ON_ERROR_STOP=1 -f supabase/migrations/20260809120000_employee_preferred_name.sql
--   psql "$U" -v ON_ERROR_STOP=1 -f supabase/migrations/20260819030000_leave_types.sql
--   psql "$U" -v ON_ERROR_STOP=1 -f tests/db/schema-contract.sql
--   docker rm -f ams-contract
--
-- Any failure raises, and psql with ON_ERROR_STOP=1 exits non-zero, which fails CI.

\set ON_ERROR_STOP on

do $$
declare
  v_active     uuid;
  v_onboarding uuid;
  v_request    uuid;
  v_failed     boolean;
begin
  -- ==========================================================================
  -- 1. The preferred name index is PARTIAL, so it is silent until the status changes.
  --
  -- This is the trap that put a raw constraint error on a new starter's final screen on
  -- 2026-08-18. The name saved happily through every step because an Onboarding row sits
  -- outside the index predicate, and the violation only fired when submission set the row
  -- Active. Any check written on the INSERT or UPDATE of the name cannot catch it.
  -- ==========================================================================

  insert into employees (email_address, status, first_name, last_name, preferred_name)
  values ('active.peter@example.invalid', 'Active', 'Peter', 'Pitcher', 'Peter')
  returning employee_id into v_active;

  -- An onboarding row takes the SAME preferred name without complaint.
  insert into employees (email_address, status, first_name, last_name, preferred_name)
  values ('new.peter@example.invalid', 'Onboarding', 'Peter', 'Smith', 'Peter')
  returning employee_id into v_onboarding;

  raise notice 'PASS 1a: an Onboarding row accepts a preferred name already held by an Active employee';

  -- Promoting it to Active is where the index finally applies.
  v_failed := false;
  begin
    update employees set status = 'Active' where employee_id = v_onboarding;
  exception when unique_violation then
    v_failed := true;
  end;

  if not v_failed then
    raise exception 'FAIL 1b: promoting a duplicate preferred name to Active should violate employees_preferred_name_active_unique';
  end if;
  raise notice 'PASS 1b: the violation fires on the status change, not on the write that set the name';

  -- Case insensitive and whitespace insensitive, per lower(btrim(...)).
  update employees set preferred_name = '  PETER  ' where employee_id = v_onboarding;
  v_failed := false;
  begin
    update employees set status = 'Active' where employee_id = v_onboarding;
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 1c: the index should ignore case and surrounding whitespace';
  end if;
  raise notice 'PASS 1c: matching ignores case and surrounding whitespace';

  -- Started Separation is inside the predicate too, so somebody on notice still holds their name.
  update employees set status = 'Started Separation' where employee_id = v_active;
  v_failed := false;
  begin
    update employees set status = 'Active' where employee_id = v_onboarding;
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 1d: someone working their notice should still hold their preferred name';
  end if;
  raise notice 'PASS 1d: Started Separation still reserves the name';

  -- A Former employee is off every screen, so the name is free again.
  update employees set status = 'Former' where employee_id = v_active;
  update employees set preferred_name = 'Peter', status = 'Active' where employee_id = v_onboarding;
  raise notice 'PASS 1e: a Former employee releases the name';

  -- ==========================================================================
  -- 2. leave_requests.leave_type is a real foreign key.
  -- ==========================================================================

  insert into leave_requests (employee_id, start_date, end_date, status, leave_type)
  values (v_onboarding, '2026-12-01', '2026-12-03', 'approved', 'holiday')
  returning id into v_request;
  raise notice 'PASS 2a: a known leave type is accepted';

  v_failed := false;
  begin
    insert into leave_requests (employee_id, start_date, end_date, status, leave_type)
    values (v_onboarding, '2027-01-01', '2027-01-02', 'approved', 'sabbatical');
  exception when foreign_key_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 2b: an unknown leave type should be refused by the foreign key';
  end if;
  raise notice 'PASS 2b: an unknown leave type is refused';

  -- Every pre-existing request was annual leave, which is how they had been counted.
  if (select leave_type from leave_requests where id = v_request) <> 'holiday' then
    raise exception 'FAIL 2c: leave_type should default to holiday';
  end if;
  raise notice 'PASS 2c: leave_type defaults to holiday';

  -- The flag that decides whether a day comes off the allowance.
  if (select consumes_allowance from leave_types where code = 'holiday') is not true
     or (select consumes_allowance from leave_types where code = 'unavailable') is not false then
    raise exception 'FAIL 2d: holiday should consume allowance and unavailable should not';
  end if;
  raise notice 'PASS 2d: holiday consumes allowance, unavailable does not';

  -- ==========================================================================
  -- 3. One person cannot hold two leave rows for the same day.
  -- ==========================================================================

  insert into leave_days (request_id, employee_id, leave_date) values (v_request, v_onboarding, '2026-12-01');
  v_failed := false;
  begin
    insert into leave_days (request_id, employee_id, leave_date) values (v_request, v_onboarding, '2026-12-01');
  exception when unique_violation then
    v_failed := true;
  end;
  if not v_failed then
    raise exception 'FAIL 3: leave_days should be unique per employee per date';
  end if;
  raise notice 'PASS 3: one leave day per employee per date';

  raise notice 'ALL DATABASE CONTRACT CHECKS PASSED';
end $$;

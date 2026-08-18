-- Capture time off a new starter has already booked, during onboarding, and put it in the rota.
--
-- Three things this migration has to get right:
--
-- 1. "I have nothing booked" must be STORED, not inferred from an absence of leave rows.
--    Onboarding decides which sections are complete by looking for saved data, so an answer
--    that saves nothing would be indistinguishable from never reaching the step.
-- 2. The write must be all or nothing. bookApprovedHoliday inserts the request first and the
--    days second and uses ON CONFLICT DO NOTHING, so a failure or a race can leave a request
--    with missing days and still report success. That is not safe for a form a new employee
--    fills in once.
-- 3. Where a row came from must be structured data, not a prefix on a free text note.

-- ---------------------------------------------------------------------------
-- 1. Provenance
-- ---------------------------------------------------------------------------

alter table public.leave_requests
  add column if not exists request_channel text not null default 'manager',
  add column if not exists leave_origin    text not null default 'normal_request';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_request_channel_check') then
    alter table public.leave_requests add constraint leave_requests_request_channel_check
      check (request_channel in ('portal', 'manager', 'onboarding'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leave_requests_leave_origin_check') then
    alter table public.leave_requests add constraint leave_requests_leave_origin_check
      check (leave_origin in ('normal_request', 'agreed_at_hire', 'migration'));
  end if;
end $$;

comment on column public.leave_requests.request_channel is
  'Which surface created the row. Used for support and reporting, not for business rules.';
comment on column public.leave_requests.leave_origin is
  'Why the row exists. agreed_at_hire rows are exempt from late notice and shift clash reliability scoring.';

create index if not exists idx_leave_requests_leave_origin
  on public.leave_requests (leave_origin) where leave_origin <> 'normal_request';

-- ---------------------------------------------------------------------------
-- 2. The durable answer
-- ---------------------------------------------------------------------------

create table if not exists public.employee_onboarding_responses (
  employee_id        uuid        not null references public.employees (employee_id) on delete cascade,
  question           text        not null,
  answer             text        not null,
  answered_at        timestamptz not null default now(),
  -- Increments each time the starter changes their answer. Re-submitting the same version is
  -- treated as a retry of a request whose response was lost, not as a new answer.
  submission_version integer     not null default 1,
  primary key (employee_id, question)
);

comment on table public.employee_onboarding_responses is
  'Answers to onboarding questions that can legitimately produce no other data, such as "I have no time off booked".';

alter table public.employee_onboarding_responses enable row level security;

-- Written only by the SECURITY DEFINER function below and by server side code using the
-- service role. Managers may read it to see what a starter answered.
drop policy if exists employee_onboarding_responses_select on public.employee_onboarding_responses;
create policy employee_onboarding_responses_select
  on public.employee_onboarding_responses for select to authenticated
  using (
    (select public.user_has_permission(auth.uid(), 'employees', 'view'))
    or employee_id in (select public.current_user_employee_ids())
  );

-- ---------------------------------------------------------------------------
-- 3. Holiday year helper, so the database and the application agree
-- ---------------------------------------------------------------------------

create or replace function public.holiday_year_for_date(p_date date)
returns smallint
language plpgsql
stable
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_month int := 4;
  v_day   int := 6;
  v_start date;
begin
  select coalesce((value->>'value')::int, 4) into v_month
  from system_settings where key = 'rota_holiday_year_start_month';
  select coalesce((value->>'value')::int, 6) into v_day
  from system_settings where key = 'rota_holiday_year_start_day';

  v_month := coalesce(v_month, 4);
  v_day := coalesce(v_day, 6);

  v_start := make_date(extract(year from p_date)::int, v_month, v_day);
  if p_date >= v_start then
    return extract(year from p_date)::smallint;
  end if;
  return (extract(year from p_date)::int - 1)::smallint;
end;
$function$;

revoke all on function public.holiday_year_for_date(date) from public;
grant execute on function public.holiday_year_for_date(date) to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- 4. The atomic write
-- ---------------------------------------------------------------------------

create or replace function public.save_onboarding_time_off(
  p_token              text,
  p_answer             text,
  p_blocks             jsonb,
  p_submission_version integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_catalog'
as $function$
declare
  v_token      employee_invite_tokens%rowtype;
  v_employee   employees%rowtype;
  v_existing   employee_onboarding_responses%rowtype;
  v_block      jsonb;
  v_start      date;
  v_end        date;
  v_type       text;
  v_note       text;
  v_request_id uuid;
  v_now        timestamptz := now();
  v_created    integer := 0;
  v_days       integer := 0;
begin
  if p_answer not in ('has_dates', 'none') then
    raise exception 'TIME_OFF_INVALID_ANSWER';
  end if;

  select * into v_token from employee_invite_tokens where token = p_token for update;
  if not found then
    raise exception 'TIME_OFF_TOKEN_INVALID';
  end if;
  if v_token.invite_type <> 'onboarding' then
    raise exception 'TIME_OFF_TOKEN_INVALID';
  end if;
  if v_token.completed_at is not null or v_token.expires_at <= v_now then
    raise exception 'TIME_OFF_TOKEN_EXPIRED';
  end if;

  -- Locking the employee row serialises two tabs or a double submit.
  select * into v_employee from employees where employee_id = v_token.employee_id for update;
  if not found then
    raise exception 'TIME_OFF_TOKEN_INVALID';
  end if;

  select * into v_existing from employee_onboarding_responses
  where employee_id = v_employee.employee_id and question = 'booked_time_off';

  -- A repeat of the submission we already stored. Report the previous success rather than an
  -- error, so a retry after a lost response is safe.
  if found and v_existing.submission_version = p_submission_version then
    return jsonb_build_object(
      'employee_id', v_employee.employee_id,
      'answer', v_existing.answer,
      'requests_created', 0,
      'repeated', true
    );
  end if;

  -- A changed answer replaces the whole previous set. Only rows this flow created are touched,
  -- so anything a manager added by hand survives.
  delete from leave_days ld
  using leave_requests lr
  where ld.request_id = lr.id
    and lr.employee_id = v_employee.employee_id
    and lr.leave_origin = 'agreed_at_hire'
    and lr.request_channel = 'onboarding';

  delete from leave_requests
  where employee_id = v_employee.employee_id
    and leave_origin = 'agreed_at_hire'
    and request_channel = 'onboarding';

  if p_answer = 'has_dates' then
    for v_block in select * from jsonb_array_elements(coalesce(p_blocks, '[]'::jsonb))
    loop
      v_start := (v_block->>'startDate')::date;
      v_end   := (v_block->>'endDate')::date;
      v_type  := coalesce(v_block->>'leaveType', 'holiday');
      v_note  := nullif(trim(coalesce(v_block->>'note', '')), '');

      if v_start is null or v_end is null or v_end < v_start then
        raise exception 'TIME_OFF_INVALID_RANGE';
      end if;
      if v_start < (v_now at time zone 'Europe/London')::date then
        raise exception 'TIME_OFF_IN_PAST';
      end if;
      if (v_end - v_start + 1) > 60 then
        raise exception 'TIME_OFF_TOO_LONG';
      end if;
      if not exists (
        select 1 from leave_types
        where code = v_type and is_active and allowed_at_onboarding
      ) then
        raise exception 'TIME_OFF_UNKNOWN_TYPE';
      end if;

      -- Overlap against everything this employee already has. The employee row is locked, so
      -- the check and the insert cannot race each other.
      if exists (
        select 1 from leave_days
        where employee_id = v_employee.employee_id
          and leave_date between v_start and v_end
      ) then
        raise exception 'TIME_OFF_OVERLAP';
      end if;

      -- Auto approved: these dates were agreed when the person was hired, so there is nothing
      -- for a manager to decide. reviewed_by stays null because no person approved it.
      insert into leave_requests (
        employee_id, start_date, end_date, note, status, leave_type,
        request_channel, leave_origin, holiday_year, reviewed_at, created_by
      ) values (
        v_employee.employee_id, v_start, v_end, v_note, 'approved', v_type,
        'onboarding', 'agreed_at_hire',
        public.holiday_year_for_date(v_start), v_now, null
      )
      returning id into v_request_id;

      insert into leave_days (request_id, employee_id, leave_date)
      select v_request_id, v_employee.employee_id, d::date
      from generate_series(v_start, v_end, interval '1 day') d;

      v_created := v_created + 1;
      v_days := v_days + (v_end - v_start + 1);

      if v_created > 10 then
        raise exception 'TIME_OFF_TOO_MANY';
      end if;
      if v_days > 200 then
        raise exception 'TIME_OFF_TOTAL_TOO_LONG';
      end if;
    end loop;
  end if;

  insert into employee_onboarding_responses (employee_id, question, answer, answered_at, submission_version)
  values (v_employee.employee_id, 'booked_time_off', p_answer, v_now, p_submission_version)
  on conflict (employee_id, question) do update
    set answer = excluded.answer,
        answered_at = excluded.answered_at,
        submission_version = excluded.submission_version;

  return jsonb_build_object(
    'employee_id', v_employee.employee_id,
    'answer', p_answer,
    'requests_created', v_created,
    'repeated', false
  );
end;
$function$;

revoke all on function public.save_onboarding_time_off(text, text, jsonb, integer) from public;
grant execute on function public.save_onboarding_time_off(text, text, jsonb, integer) to service_role;

comment on function public.save_onboarding_time_off is
  'Atomically replaces a new starter''s agreed at hire time off. All or nothing: one bad block writes nothing.';

-- ---------------------------------------------------------------------------
-- 5. Onboarding cannot complete without an answer
-- ---------------------------------------------------------------------------

create or replace function public.complete_employee_onboarding(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  v_token employee_invite_tokens%ROWTYPE;
  v_employee employees%ROWTYPE;
  v_now TIMESTAMPTZ := NOW();
BEGIN
  SELECT * INTO v_token FROM employee_invite_tokens WHERE token = p_token FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid invite link.';
  END IF;

  IF v_token.invite_type <> 'onboarding' THEN
    RAISE EXCEPTION 'This link is not for employee onboarding.';
  END IF;

  IF v_token.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invite link has already been used.';
  END IF;

  IF v_token.expires_at <= v_now THEN
    RAISE EXCEPTION 'Invite link has expired.';
  END IF;

  SELECT * INTO v_employee FROM employees WHERE employee_id = v_token.employee_id FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Employee not found.';
  END IF;

  IF lower(v_token.email) <> lower(v_employee.email_address) THEN
    RAISE EXCEPTION 'Invite link no longer matches the employee email address.';
  END IF;

  IF v_employee.status <> 'Onboarding' THEN
    RAISE EXCEPTION 'This onboarding invite is no longer valid.';
  END IF;

  IF v_employee.auth_user_id IS NULL THEN
    RAISE EXCEPTION 'Create your account before completing onboarding.';
  END IF;

  IF coalesce(trim(v_employee.first_name), '') = '' OR coalesce(trim(v_employee.last_name), '') = '' THEN
    RAISE EXCEPTION 'Personal details must be completed before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM employee_emergency_contacts c
    WHERE c.employee_id = v_employee.employee_id
      AND coalesce(trim(c.name), '') <> ''
      AND lower(coalesce(c.priority, 'primary')) = 'primary'
  ) THEN
    RAISE EXCEPTION 'Primary emergency contact must be completed before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_financial_details f
    WHERE f.employee_id = v_employee.employee_id
  ) THEN
    RAISE EXCEPTION 'Financial details must be saved before submitting.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM employee_health_records h
    WHERE h.employee_id = v_employee.employee_id
  ) THEN
    RAISE EXCEPTION 'Health information must be saved before submitting.';
  END IF;

  -- New: the time off question is mandatory, and "nothing booked" is a real answer, so this
  -- checks for the stored response rather than for leave rows.
  IF NOT EXISTS (
    SELECT 1 FROM employee_onboarding_responses r
    WHERE r.employee_id = v_employee.employee_id
      AND r.question = 'booked_time_off'
  ) THEN
    RAISE EXCEPTION 'Tell us about any time off you have already booked before submitting.';
  END IF;

  UPDATE employees
  SET status = 'Active',
      onboarding_completed_at = v_now,
      updated_at = v_now
  WHERE employee_id = v_employee.employee_id
  RETURNING * INTO v_employee;

  UPDATE employee_invite_tokens
  SET completed_at = v_now
  WHERE id = v_token.id;

  UPDATE employee_invite_tokens
  SET expires_at = v_now
  WHERE employee_id = v_employee.employee_id
    AND invite_type = 'onboarding'
    AND completed_at IS NULL
    AND id <> v_token.id
    AND expires_at > v_now;

  RETURN jsonb_build_object(
    'employee_id', v_employee.employee_id,
    'email', v_employee.email_address,
    'first_name', v_employee.first_name,
    'last_name', v_employee.last_name,
    'auth_user_id', v_employee.auth_user_id,
    'onboarding_completed_at', v_employee.onboarding_completed_at
  );
END;
$function$;

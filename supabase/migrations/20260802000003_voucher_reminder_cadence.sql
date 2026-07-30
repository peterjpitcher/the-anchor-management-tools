-- Voucher reminder cadence rework: two reminders, both counted back from expiry.
--
-- WHY
--
-- The cadence in 20260802000002 fired at issue + 30 days, issue + 90 days and
-- expiry - 14 days. Vouchers are normally valid for one month from issue, so the
-- day-30 and day-90 milestones almost never landed inside a voucher's life and the
-- pre-expiry nudge was the only one that ever ran. The rules are now simply: every
-- voucher gets two reminders, at 7 days and 3 days before its expiry date.
--
-- Email is the preferred channel and SMS is the fallback for a customer with no
-- email address. The channel is chosen in the app, so the claim function returns the
-- contact and consent fields needed to make that choice, and the outcome writer
-- records which channel was actually used.
--
-- Everything else stands: one reminder per customer per London day, milestones already
-- in the past when computed are recorded as 'skipped' and never sent late, pending rows
-- are cancelled on redeem/expire/cancel/replace/unassign and recomputed on issue,
-- expiry edit and customer change.
--
-- 20260802000002 is left exactly as applied. Every change lives here.

begin;

-- ---------------------------------------------------------------------------
-- 1. reminder_kind: 'pre_expiry_7' and 'pre_expiry_3' replace day30, day90 and
-- pre_expiry. There is no production data yet, but delete any row carrying a kind
-- that is no longer valid so the constraint swap cannot fail on a rebuilt database.
-- ---------------------------------------------------------------------------
delete from public.voucher_reminders
where reminder_kind not in ('pre_expiry_7', 'pre_expiry_3');

-- The old check was declared inline on the column, so its name is generated. Find it
-- rather than assuming it, and drop every check that mentions reminder_kind.
do $$
declare
  v_name text;
begin
  for v_name in
    select c.conname
    from pg_constraint c
    where c.conrelid = 'public.voucher_reminders'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) ilike '%reminder_kind%'
  loop
    execute format('alter table public.voucher_reminders drop constraint %I', v_name);
  end loop;
end
$$;

alter table public.voucher_reminders
  add constraint voucher_reminders_reminder_kind_check
  check (reminder_kind in ('pre_expiry_7', 'pre_expiry_3'));

-- ---------------------------------------------------------------------------
-- 2. channel: which channel the send actually used. The app writes it when a send
-- is finalised, so it stays null until then, and stays null on a skip where the
-- customer had no usable channel. A check constraint passes on null by design.
-- ---------------------------------------------------------------------------
alter table public.voucher_reminders
  add column if not exists channel text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.voucher_reminders'::regclass
      and conname = 'voucher_reminders_channel_check'
  ) then
    alter table public.voucher_reminders
      add constraint voucher_reminders_channel_check
      check (channel in ('email', 'sms'));
  end if;
end
$$;

comment on column public.voucher_reminders.channel is
  'Channel used for the send: email preferred, sms only when the customer has no email. Null until a send is finalised.';

-- ---------------------------------------------------------------------------
-- 3. voucher_reminders_recompute: new cadence, same contract.
--
-- Rules implemented:
-- - Rows only exist while the voucher is issued and has a customer; otherwise
--   pending rows are cancelled.
-- - sent/skipped/failed rows are immutable and their kinds are never recreated.
-- - Targets are expiry_date - 7 and expiry_date - 3, both London calendar dates.
-- - A target on or after today is inserted 'pending'; one already in the past is
--   inserted 'skipped' so the outbox records that it was considered, and it can
--   never be sent late.
-- - The 2-sendable cap is structural: there are only two kinds and an already
--   sent, skipped or failed kind is never re-inserted, so sent + pending <= 2.
-- - Return shape is unchanged so the existing callers keep working.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_reminders_recompute(
  p_voucher_id uuid
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
  v_today date;
  v_locked text[];
  v_pending integer := 0;
  v_skipped integer := 0;
  v_kind text;
  v_date date;
begin
  select * into v_row from vouchers where id = p_voucher_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;

  if v_row.status <> 'issued' or v_row.customer_id is null or v_row.expiry_date is null then
    update voucher_reminders set status = 'cancelled'
    where voucher_id = p_voucher_id and status = 'pending';
    return jsonb_build_object('success', true, 'pending', 0);
  end if;

  v_today := (now() at time zone 'Europe/London')::date;

  select coalesce(array_agg(reminder_kind), '{}') into v_locked
  from voucher_reminders
  where voucher_id = p_voucher_id and status in ('sent', 'skipped', 'failed');

  -- Recomputable rows are replaced wholesale; immutable rows stay put.
  delete from voucher_reminders
  where voucher_id = p_voucher_id and status in ('pending', 'cancelled');

  for v_kind, v_date in
    select m.kind, m.target_date from (values
      ('pre_expiry_7'::text, v_row.expiry_date - 7),
      ('pre_expiry_3'::text, v_row.expiry_date - 3)
    ) as m(kind, target_date)
    order by m.target_date
  loop
    continue when v_kind = any(v_locked);

    if v_date < v_today then
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'skipped', v_date)
      on conflict (voucher_id, reminder_kind) do nothing;
      v_skipped := v_skipped + 1;
    else
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'pending', v_date)
      on conflict (voucher_id, reminder_kind) do nothing;
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'pending', v_pending, 'skipped', v_skipped);
end;
$func$;

-- ---------------------------------------------------------------------------
-- 4. voucher_reminders_claim_due: atomically claims due pending reminders for the
-- cron pass. Each claimed row now carries everything the sender needs to choose a
-- channel and write the copy: name, email, mobile and both consent flags, plus the
-- prize label taken from the batch's frozen type snapshot.
--
-- Unchanged behaviour: the jsonb envelope shape, and only 'pending' rows scheduled
-- on or before p_london_today, on an issued voucher, with a customer and fewer than
-- 3 attempts; at most one row per customer per call, and none for a customer already
-- sent to today, so the other due rows simply wait for another day; attempts is
-- bumped on claim while the status stays pending until voucher_reminder_mark
-- records the outcome.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_reminders_claim_due(
  p_london_today date,
  p_limit integer default 50
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_limit integer;
  v_claimed jsonb;
begin
  if p_london_today is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'london_today is required');
  end if;
  v_limit := least(greatest(coalesce(p_limit, 50), 1), 200);

  with locked as (
    select r.id, r.voucher_id, r.customer_id, r.reminder_kind, r.scheduled_for, r.created_at
    from voucher_reminders r
    join vouchers v on v.id = r.voucher_id
    where r.status = 'pending'
      and r.scheduled_for <= p_london_today
      and r.attempts < 3
      and r.customer_id is not null
      and v.status = 'issued'
    order by r.scheduled_for, r.created_at
    for update of r skip locked
  ), ranked as (
    select l.*,
           row_number() over (partition by l.customer_id order by l.scheduled_for, l.created_at) as rn
    from locked l
  ), chosen as (
    select rk.id, rk.scheduled_for, rk.created_at
    from ranked rk
    where rk.rn = 1
      and rk.customer_id not in (
        select vr.customer_id from voucher_reminders vr
        where vr.status = 'sent'
          and vr.customer_id is not null
          and (vr.sent_at at time zone 'Europe/London')::date = p_london_today
      )
    order by rk.scheduled_for, rk.created_at
    limit v_limit
  ), claimed as (
    update voucher_reminders r
    set attempts = r.attempts + 1
    from chosen c
    where r.id = c.id
    returning r.id, r.voucher_id, r.customer_id, r.reminder_kind, r.scheduled_for
  )
  -- Keys are the sender's contract. mobile_e164 falls back to the legacy
  -- mobile_number column, as the previous version did, so a customer imported
  -- before normalisation is still reachable.
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder_id', cl.id,
    'voucher_id', cl.voucher_id,
    'voucher_number', v.voucher_number,
    'reminder_kind', cl.reminder_kind,
    'scheduled_for', cl.scheduled_for,
    'customer_id', cl.customer_id,
    'first_name', c.first_name,
    'last_name', c.last_name,
    'email', c.email,
    'mobile_e164', coalesce(c.mobile_e164, c.mobile_number),
    'sms_opt_in', c.sms_opt_in,
    'marketing_email_opt_in', c.marketing_email_opt_in,
    'expiry_date', v.expiry_date,
    'won_at_label', v.won_at_label,
    'prize_label', coalesce(
      b.type_definitions -> v.type_id -> 'copy' ->> 'prize',
      b.type_definitions -> v.type_id ->> 'display_title',
      t.copy ->> 'prize',
      t.display_title
    )
  ) order by cl.scheduled_for, cl.id), '[]'::jsonb)
  into v_claimed
  from claimed cl
  join vouchers v on v.id = cl.voucher_id
  join voucher_batches b on b.id = v.batch_id
  join voucher_types t on t.id = v.type_id
  left join customers c on c.id = cl.customer_id;

  return jsonb_build_object('success', true, 'claimed', v_claimed);
end;
$func$;

-- ---------------------------------------------------------------------------
-- 5. voucher_reminder_mark: the app records the outcome for a claimed row, now
-- including the channel it used. Dropped and recreated rather than replaced,
-- because adding a defaulted parameter to a live signature would leave two
-- overloads and make a 4-argument call ambiguous.
--
-- 'sent' stamps sent_at, message_sid and channel, and writes the 'reminder_sent'
-- event. 'skipped' is terminal and not a failure: the app uses it when the customer
-- cannot or must not be contacted, so no event is written. 'failed' stores the error
-- and leaves the row pending until 3 attempts have been made (F51).
-- ---------------------------------------------------------------------------
drop function if exists public.voucher_reminder_mark(uuid, text, text, text);

create function public.voucher_reminder_mark(
  p_id uuid,
  p_status text,
  p_message_sid text,
  p_error text,
  p_channel text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_rem voucher_reminders%rowtype;
begin
  if p_status not in ('sent', 'failed', 'skipped') then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'status must be sent, failed or skipped');
  end if;
  if p_channel is not null and p_channel not in ('email', 'sms') then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'channel must be email or sms');
  end if;

  select * into v_rem from voucher_reminders where id = p_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;
  if v_rem.status <> 'pending' then
    return jsonb_build_object('success', false, 'error_code', 'NOT_PENDING', 'current_status', v_rem.status);
  end if;

  if p_status = 'sent' then
    update voucher_reminders set
      status = 'sent',
      sent_at = now(),
      message_sid = p_message_sid,
      channel = coalesce(p_channel, channel),
      last_error = null
    where id = p_id
    returning * into v_rem;

    insert into voucher_events (voucher_id, action, actor_name, source, detail)
    values (v_rem.voucher_id, 'reminder_sent', 'System', 'cron',
            jsonb_strip_nulls(jsonb_build_object(
              'reminder_kind', v_rem.reminder_kind,
              'customer_id', v_rem.customer_id,
              'scheduled_for', v_rem.scheduled_for,
              'channel', v_rem.channel,
              'message_sid', p_message_sid)));
  elsif p_status = 'skipped' then
    update voucher_reminders set
      status = 'skipped',
      channel = coalesce(p_channel, channel),
      last_error = p_error
    where id = p_id
    returning * into v_rem;
  else
    if v_rem.attempts >= 3 then
      update voucher_reminders set
        status = 'failed',
        channel = coalesce(p_channel, channel),
        last_error = p_error
      where id = p_id
      returning * into v_rem;
    else
      update voucher_reminders set
        channel = coalesce(p_channel, channel),
        last_error = p_error
      where id = p_id
      returning * into v_rem;
    end if;
  end if;

  return jsonb_build_object('success', true, 'reminder', to_jsonb(v_rem));
end;
$func$;

-- ---------------------------------------------------------------------------
-- 6. Grants lockdown (precedent: 20260801001300). A new function in public is
-- granted EXECUTE to anon and authenticated BY NAME via Supabase's default
-- privileges, so REVOKE FROM PUBLIC alone is not enough. A replaced function keeps
-- its old ACL, so this re-asserts the lockdown for all three either way.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure::text as sig
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in (
        'voucher_reminders_recompute',
        'voucher_reminders_claim_due',
        'voucher_reminder_mark'
      )
  loop
    execute format('revoke all on function %s from public, anon, authenticated', r.sig);
    execute format('grant execute on function %s to service_role', r.sig);
  end loop;
end;
$$;

-- Prove it: fail rather than report success on a half-closed door.
do $$
declare
  v_leaky text;
begin
  select string_agg(p.proname, ', ')
    into v_leaky
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    and p.proname in (
      'voucher_reminders_recompute', 'voucher_reminders_claim_due', 'voucher_reminder_mark'
    )
    and array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  if v_leaky is not null then
    raise exception using
      message = 'These voucher reminder functions are still executable by anon or authenticated.',
      detail  = v_leaky,
      hint    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  end if;
end;
$$;

commit;

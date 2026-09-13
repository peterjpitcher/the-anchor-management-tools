-- Rollback for 20260912120000_voucher_reminder_requires_booking.sql
--
-- Restores voucher_reminders_claim_due to the definition that was live before the change:
-- the body from 20260802000003_voucher_reminder_cadence.sql, copied verbatim below. That
-- live definition was fingerprinted immediately before the apply, 12 September 2026:
-- md5(pg_get_functiondef) = 002fde04adae4016f932f686f36bb401, length 3010.
--
-- Nothing else needs undoing. No table, column, index, policy or grant was touched, and the
-- only difference is the additive requires_booking key. Dropping the key cannot break the
-- sender: loadBookingRequirements in src/lib/vouchers/reminders.ts resolves the flag with its
-- own batched query for any row that arrives without it, which is how the app ran before
-- this migration and how it still runs if this rollback is used.

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

comment on function public.voucher_reminders_claim_due(date, integer) is
  'Claims due voucher reminders for the cron pass, one row per customer per London day, and returns everything the sender needs to choose a channel and write the copy.';

-- Grants restated: the 20260811100100 revoke stands, service_role only.
revoke all on function public.voucher_reminders_claim_due(date, integer) from public, anon, authenticated;
grant execute on function public.voucher_reminders_claim_due(date, integer) to service_role;

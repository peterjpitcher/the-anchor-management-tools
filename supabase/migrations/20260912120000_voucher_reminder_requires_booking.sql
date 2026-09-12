-- Voucher reminders: tell the sender whether the voucher needs booking, 12 September 2026.
--
-- NOT YET APPLIED. Drafted and validated against a throwaway local Postgres on 12 September
-- 2026; it has not been run against production. See the note at the foot of this file.
--
-- WHY
--
-- `voucher_reminders_claim_due` returns everything the sender needs to write the copy except
-- the one fact that changes what the copy has to say. Three of the seven voucher types have
-- `requires_booking = true`: Sunday roast for two, four quiz tickets and four music bingo
-- tickets. Their printed terms say "Availability is not guaranteed without an advance
-- booking" and "Advance booking is required and remains subject to event capacity". The
-- reminder told every holder to "just show the card at the bar and we will sort you out", so
-- a guest could have arrived on a full Sunday holding a voucher we could not honour.
--
-- The application fix does not depend on this migration: `loadBookingRequirements` in
-- `src/lib/vouchers/reminders.ts` resolves the flag with its own batched query for any row
-- that arrives without it. This migration removes that extra query by putting the fact where
-- the rest of the copy data already comes from. Applying it and not applying it are both
-- correct; applying it is one query cheaper per batch.
--
-- WHERE THE FLAG COMES FROM
--
-- The batch's frozen `type_definitions` snapshot first, then the live `voucher_types` row.
-- That is exactly the precedence `voucher_redeem` uses (20260802000002, line 298), and it
-- matters: a batch may have been issued under a different rule from the one the type carries
-- today, and the guest holds what was issued, not what the type says now.
--
-- EVERYTHING ELSE IS UNCHANGED. Same signature, same envelope, same locking, same one-row-
-- per-customer-per-day behaviour. The only difference is one extra key in each claimed
-- object, and an extra key is additive: the sender reads keys by name.

-- No explicit BEGIN/COMMIT: the Supabase migration runner wraps each file in its own
-- transaction, and committing early inside that would break its error handling.

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
    ),
    -- NEW. The batch snapshot wins over the live type, matching voucher_redeem. coalesced to
    -- true so a voucher whose requirement cannot be read is treated as needing a booking:
    -- asking a walk-up holder to ring first is a small inconvenience, while telling a
    -- booking-only holder to turn up is a guest we cannot serve.
    'requires_booking', coalesce(
      (b.type_definitions -> v.type_id ->> 'requires_booking')::boolean,
      t.requires_booking,
      true
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
  'Claims due voucher reminders for the cron pass. Each claimed row carries everything the sender needs to choose a channel and write the copy, including requires_booking (added 2026-09-12) so a booking-only voucher is never told to just show the card at the bar.';

-- Grants are unchanged by CREATE OR REPLACE, and the 20260811100100 revoke stands:
-- service_role only. Restated here so a reader does not have to go and check.
revoke all on function public.voucher_reminders_claim_due(date, integer) from public, anon, authenticated;
grant execute on function public.voucher_reminders_claim_due(date, integer) to service_role;

-- ROLLBACK
--
-- Re-run the body from 20260802000003_voucher_reminder_cadence.sql, which is identical apart
-- from the requires_booking key. Nothing else changes: no table, column, index or grant is
-- touched, and dropping the key back out cannot lose data because the sender falls back to
-- its own lookup when the key is absent.
--
-- APPLY NOTE
--
-- Safe to apply at any time, including while the cron is running: CREATE OR REPLACE FUNCTION
-- takes a short lock on the function only, and an in-flight call finishes on the old body.

-- Booking reference is no longer required to redeem a booking-type voucher.
--
-- Owner decision 2026-07-30: the reference is useful to record but must never
-- block a redemption at the bar. The 'Booking required' warning stays on the
-- FOH card so the team still sees it; the field is now optional everywhere.
--
-- This replaces public.voucher_redeem with the definition from
-- 20260802000002_voucher_rpcs.sql minus the booking-reference guard. Everything
-- else (expiry guard, idempotent replay, customer assignment, event trail) is
-- unchanged.

BEGIN;

create or replace function public.voucher_redeem(
  p_voucher_number text,
  p_employee_id uuid,
  p_employee_name text,
  p_user_id uuid,
  p_transaction_ref text,
  p_booking_ref text,
  p_customer_id uuid,
  p_london_today date,
  p_source text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
  v_assign_customer boolean;
begin
  if p_london_today is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'london_today is required');
  end if;
  if p_employee_id is null or p_employee_name is null or btrim(p_employee_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'redeeming employee is required');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status <> 'issued' then
    if v_row.status = 'redeemed' and p_idempotency_key is not null and exists (
      select 1 from voucher_events
      where voucher_id = v_row.id and action = 'redeemed'
        and detail ->> 'idempotency_key' = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'idempotent_replay', true);
    end if;
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'generated' then 'NOT_ISSUED'
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'expired' then 'EXPIRED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  if v_row.expiry_date < p_london_today then
    -- Lookup-time expiry guard: treated as expired regardless of the cron (spec 2.5).
    return jsonb_build_object('success', false, 'error_code', 'EXPIRED', 'current_status', v_row.status,
                              'expiry_date', v_row.expiry_date);
  end if;

  v_assign_customer := p_customer_id is not null and v_row.customer_id is null;

  update vouchers set
    status = 'redeemed',
    redeemed_at = now(),
    redeemed_by = p_employee_id,
    redeemed_by_name = p_employee_name,
    redeemed_by_user_id = p_user_id,
    transaction_ref = nullif(btrim(coalesce(p_transaction_ref, '')), ''),
    booking_ref = nullif(btrim(coalesce(p_booking_ref, '')), ''),
    customer_id = case when v_assign_customer then p_customer_id else customer_id end
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'redeemed', p_user_id, p_employee_id, p_employee_name, coalesce(p_source, 'foh'),
          jsonb_strip_nulls(jsonb_build_object(
            'transaction_ref', v_row.transaction_ref,
            'booking_ref', v_row.booking_ref,
            'idempotency_key', p_idempotency_key)));

  if v_assign_customer then
    insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
    values (v_row.id, 'customer_assigned', p_user_id, p_employee_id, p_employee_name, coalesce(p_source, 'foh'),
            jsonb_build_object('customer_id', p_customer_id));
  end if;

  update voucher_reminders set status = 'cancelled'
  where voucher_id = v_row.id and status = 'pending';

  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- SECURITY DEFINER functions default to EXECUTE for PUBLIC, so re-assert the
-- lockdown after replacing the function (see 20260801001300).
revoke all on function public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text) to service_role;

COMMIT;

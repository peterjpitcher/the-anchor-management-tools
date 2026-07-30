-- A skipped reminder must revive when the expiry moves.
--
-- Defect found in pre-deploy review. voucher_reminders_recompute treated 'sent',
-- 'skipped' and 'failed' alike as immutable, so a kind recorded 'skipped' could
-- never come back. A reminder is recorded 'skipped' whenever its target date is
-- already in the past when the row is computed, which is the normal case for a
-- voucher handed out with a short expiry, or one assigned to a customer late.
--
-- If a manager then extends the expiry, both targets move into the future, but
-- both kinds were locked, so the voucher ended up with no reminders at all.
--
-- Corrected rule:
--   'sent'    immutable. Never re-send a milestone the customer already had.
--   'failed'  immutable. Attempts are exhausted; reviving it would retry a
--             delivery that has already failed three times.
--   'skipped' revivable. It was never sent, so if its recomputed date is now
--             today or later it becomes 'pending' again (attempt count reset);
--             if it is still in the past it stays 'skipped' with the new date.
--
-- The 2-sendable cap stays structural: only two kinds exist and a sent or failed
-- kind is never re-inserted, so sent + pending can never exceed 2.

BEGIN;

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

  -- Only a delivered or exhausted milestone is immutable. 'skipped' is not:
  -- it was never sent, so a later expiry change may legitimately revive it.
  select coalesce(array_agg(reminder_kind), '{}') into v_locked
  from voucher_reminders
  where voucher_id = p_voucher_id and status in ('sent', 'failed');

  -- Recomputable rows are replaced wholesale; skipped rows are updated in place
  -- below so their history is preserved rather than deleted and recreated.
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
      on conflict (voucher_id, reminder_kind) do update
        set scheduled_for = excluded.scheduled_for,
            customer_id = excluded.customer_id,
            status = 'skipped',
            updated_at = now()
        where voucher_reminders.status = 'skipped';
      v_skipped := v_skipped + 1;
    else
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'pending', v_date)
      on conflict (voucher_id, reminder_kind) do update
        set scheduled_for = excluded.scheduled_for,
            customer_id = excluded.customer_id,
            status = 'pending',
            attempts = 0,
            last_error = null,
            channel = null,
            updated_at = now()
        where voucher_reminders.status = 'skipped';
      v_pending := v_pending + 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'pending', v_pending, 'skipped', v_skipped);
end;
$func$;

-- CREATE OR REPLACE keeps the existing ACL, but re-assert it so the lockdown is
-- explicit and this migration is self-contained (see 20260801001300).
revoke all on function public.voucher_reminders_recompute(uuid) from public, anon, authenticated;
grant execute on function public.voucher_reminders_recompute(uuid) to service_role;

COMMIT;

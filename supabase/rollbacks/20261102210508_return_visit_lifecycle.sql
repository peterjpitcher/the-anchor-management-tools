-- Rollback for 20261102210508_return_visit_lifecycle.sql. NOT a migration: run only on the
-- owner's say-so, through the prod-migrate skill, if the return-visit feature has to come out.
--
-- It puts every replaced function back exactly as it was before (bodies copied from the
-- migrations that last defined them, which matched production's prosrc on 2 November 2026),
-- drops what the migration added, and refuses to run once any return-visit voucher, digital
-- batch, lifecycle campaign or table-booking conversion exists, because dropping those columns
-- would destroy that record. Past that point the fix is forward, not back.

begin;

do $guard$
begin
  if exists (select 1 from public.vouchers where type_id in ('return-10', 'return-25'))
     or exists (select 1 from public.voucher_batches where digital)
     or exists (select 1 from public.marketing_campaigns where kind = 'lifecycle')
     or exists (select 1 from public.marketing_conversions where conversion_type = 'table_booking') then
    raise exception 'Return-visit data exists; roll forward instead of dropping it';
  end if;
end
$guard$;

-- New functions.
drop function if exists public.get_lifecycle_campaign_stats(uuid);
drop function if exists public.issue_lifecycle_voucher(uuid, date);
drop function if exists public.get_table_return_visit_audience(jsonb, date);

-- Replaced functions, back to their previous signatures and bodies.
drop function if exists public.promote_due_marketing_campaigns(boolean);
CREATE OR REPLACE FUNCTION public.promote_due_marketing_campaigns()
RETURNS TABLE (promoted_campaign_id uuid, promoted_recipients integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_campaign public.marketing_campaigns%ROWTYPE;
  v_include text[];
  v_exclude text[];
  v_added integer;
BEGIN
  FOR v_campaign IN
    SELECT * FROM public.marketing_campaigns
    WHERE status = 'scheduled' AND scheduled_for <= now()
    ORDER BY scheduled_for
    FOR UPDATE SKIP LOCKED
  LOOP
    CONTINUE WHEN NOT public.marketing_send_window_open(v_campaign.audience_type);

    v_include := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'include_tags')), '{}'::text[]);
    v_exclude := COALESCE(
      ARRAY(SELECT jsonb_array_elements_text(v_campaign.audience -> 'exclude_tags')), '{}'::text[]);

    IF v_campaign.audience_type = 'customer' THEN
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, customer_id, email)
      SELECT v_campaign.id, c.id, lower(btrim(c.email))
      FROM public.customers c
      WHERE c.email IS NOT NULL AND btrim(c.email) <> ''
        AND c.marketing_email_opted_out_at IS NULL
        AND COALESCE(c.email_status, 'unknown') <> 'bounced'
        AND (
          c.marketing_email_opt_in IS TRUE
          OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = c.id)
          OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = c.id)
        )
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = lower(btrim(c.email)) AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = lower(btrim(c.email)))
      ON CONFLICT DO NOTHING;
    ELSE
      INSERT INTO public.marketing_campaign_recipients AS r (campaign_id, contact_id, email)
      SELECT v_campaign.id, bc.id, bc.email
      FROM public.business_contacts bc
      WHERE bc.eligibility_status = 'eligible'
        AND bc.marketing_status = 'subscribed'
        AND (cardinality(v_include) = 0 OR bc.tags && v_include)
        AND (cardinality(v_exclude) = 0 OR NOT (bc.tags && v_exclude))
        AND NOT EXISTS (
          SELECT 1 FROM public.marketing_do_not_contact d
          WHERE d.email_normalised = bc.email AND d.removed_at IS NULL)
        AND NOT EXISTS (
          SELECT 1 FROM public.email_suppressions es WHERE lower(es.email) = bc.email)
      ON CONFLICT DO NOTHING;
    END IF;

    GET DIAGNOSTICS v_added = ROW_COUNT;

    UPDATE public.marketing_campaigns
       SET status = CASE WHEN v_added = 0 THEN 'completed' ELSE 'sending' END,
           started_at = now(),
           completed_at = CASE WHEN v_added = 0 THEN now() ELSE NULL END
     WHERE id = v_campaign.id;

    promoted_campaign_id := v_campaign.id;
    promoted_recipients := v_added;
    RETURN NEXT;
  END LOOP;
END;
$$;
revoke all on function public.promote_due_marketing_campaigns() from public, anon, authenticated;
grant execute on function public.promote_due_marketing_campaigns() to service_role;

CREATE OR REPLACE FUNCTION public.complete_finished_marketing_campaigns()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_completed integer;
BEGIN
  UPDATE public.marketing_campaigns c
     SET status = 'completed', completed_at = now()
   WHERE c.status = 'sending'
     AND NOT EXISTS (
       SELECT 1 FROM public.marketing_campaign_recipients r
       WHERE r.campaign_id = c.id AND r.status IN ('pending', 'sending')
     );

  GET DIAGNOSTICS v_completed = ROW_COUNT;
  RETURN v_completed;
END;
$$;
revoke all on function public.complete_finished_marketing_campaigns() from public, anon, authenticated;
grant execute on function public.complete_finished_marketing_campaigns() to service_role;

CREATE OR REPLACE FUNCTION public.claim_marketing_recipients(p_batch integer)
RETURNS SETOF public.marketing_campaign_recipients
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_settings public.marketing_settings%ROWTYPE;
  v_candidate record;
  v_contact public.business_contacts%ROWTYPE;
  v_customer public.customers%ROWTYPE;
  v_row public.marketing_campaign_recipients%ROWTYPE;
  v_claimed integer := 0;
  v_lease interval := interval '10 minutes';
  v_skip text;
  v_email text;
  v_last timestamptz;
  v_reserved timestamptz;
BEGIN
  IF p_batch IS NULL OR p_batch < 1 OR p_batch > 200 THEN
    RAISE EXCEPTION 'claim_marketing_recipients: p_batch must be between 1 and 200, got %', p_batch;
  END IF;

  SELECT * INTO v_settings FROM public.marketing_settings WHERE id LIMIT 1;
  IF NOT FOUND OR NOT v_settings.sends_enabled THEN RETURN; END IF;

  FOR v_candidate IN
    SELECT r.id AS recipient_id, r.contact_id, r.customer_id, r.failure_class, r.last_attempt_at,
           c.ignores_frequency_cap, c.event_id
    FROM public.marketing_campaign_recipients r
    JOIN public.marketing_campaigns c ON c.id = r.campaign_id
    WHERE r.status = 'pending'
      AND c.status = 'sending'
      AND public.marketing_send_window_open(c.audience_type)
      AND (r.next_attempt_at IS NULL OR r.next_attempt_at <= now())
    ORDER BY r.created_at
    LIMIT GREATEST(p_batch * 4, 20)
  LOOP
    EXIT WHEN v_claimed >= p_batch;

    IF v_candidate.failure_class = 'unknown'
       AND v_candidate.last_attempt_at IS NOT NULL
       AND v_candidate.last_attempt_at < now() - interval '24 hours' THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'needs_review',
             error = 'Recovered from an attempt whose outcome could not be proved, and the provider idempotency window has since closed'
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    v_skip := NULL;

    IF v_candidate.customer_id IS NOT NULL THEN
      SELECT * INTO v_customer FROM public.customers
       WHERE id = v_candidate.customer_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := lower(btrim(COALESCE(v_customer.email, '')));
      v_last := v_customer.marketing_last_email_at;
      v_reserved := v_customer.marketing_reserved_until;

      IF v_email = '' THEN
        v_skip := 'not_eligible';
      ELSIF v_customer.marketing_email_opted_out_at IS NOT NULL THEN
        v_skip := 'unsubscribed';
      ELSIF COALESCE(v_customer.email_status, 'unknown') = 'bounced' THEN
        v_skip := 'suppressed';
      ELSIF NOT (
        v_customer.marketing_email_opt_in IS TRUE
        OR EXISTS (SELECT 1 FROM public.bookings b WHERE b.customer_id = v_customer.id)
        OR EXISTS (SELECT 1 FROM public.table_bookings t WHERE t.customer_id = v_customer.id)
      ) THEN
        v_skip := 'not_eligible';
      END IF;
    ELSE
      SELECT * INTO v_contact FROM public.business_contacts
       WHERE id = v_candidate.contact_id FOR UPDATE SKIP LOCKED;
      CONTINUE WHEN NOT FOUND;

      v_email := v_contact.email;
      v_last := v_contact.last_marketing_email_at;
      v_reserved := v_contact.marketing_reserved_until;

      IF v_contact.eligibility_status <> 'eligible' THEN
        v_skip := 'not_eligible';
      ELSIF v_contact.marketing_status <> 'subscribed' THEN
        v_skip := 'unsubscribed';
      END IF;
    END IF;

    IF v_skip IS NULL AND EXISTS (
      SELECT 1 FROM public.marketing_do_not_contact d
      WHERE d.email_normalised = v_email AND d.removed_at IS NULL
    ) THEN
      v_skip := 'do_not_contact';
    END IF;

    -- The only change from the previous definition: a guest who already holds seats for the
    -- event this campaign promotes is not asked to book it. Read here, at the moment of
    -- sending, so a booking made minutes earlier counts. Business contacts have no bookings
    -- of their own and are never skipped by this.
    IF v_skip IS NULL
       AND v_candidate.customer_id IS NOT NULL
       AND v_candidate.event_id IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM public.bookings b
          WHERE b.event_id = v_candidate.event_id
            AND b.customer_id = v_candidate.customer_id
            AND b.status NOT IN ('cancelled', 'expired')
       ) THEN
      v_skip := 'already_booked';
    END IF;

    IF v_skip IS NULL AND NOT COALESCE(v_candidate.ignores_frequency_cap, false)
       AND v_settings.frequency_cap_days > 0
       AND v_last IS NOT NULL
       AND v_last > now() - make_interval(days => v_settings.frequency_cap_days) THEN
      v_skip := 'frequency_cap';
    END IF;

    IF v_skip IS NOT NULL THEN
      UPDATE public.marketing_campaign_recipients
         SET status = 'skipped', skip_reason = v_skip
       WHERE id = v_candidate.recipient_id AND status = 'pending';
      CONTINUE;
    END IF;

    CONTINUE WHEN v_reserved IS NOT NULL AND v_reserved > now();

    IF v_candidate.customer_id IS NOT NULL THEN
      UPDATE public.customers SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.customer_id;
    ELSE
      UPDATE public.business_contacts SET marketing_reserved_until = now() + v_lease
       WHERE id = v_candidate.contact_id;
    END IF;

    UPDATE public.marketing_campaign_recipients
       SET status = 'sending', claimed_at = now(), lease_expires_at = now() + v_lease,
           attempt_count = attempt_count + 1, last_attempt_at = now()
     WHERE id = v_candidate.recipient_id AND status = 'pending'
    RETURNING * INTO v_row;

    CONTINUE WHEN NOT FOUND;

    v_claimed := v_claimed + 1;
    RETURN NEXT v_row;
  END LOOP;
END;
$$;
revoke all on function public.claim_marketing_recipients(integer) from public, anon, authenticated;
grant execute on function public.claim_marketing_recipients(integer) to service_role;

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
revoke all on function public.voucher_reminders_recompute(uuid) from public, anon, authenticated;
grant execute on function public.voucher_reminders_recompute(uuid) to service_role;

drop function if exists public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text, integer);
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
revoke all on function public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text) from public, anon, authenticated;
grant execute on function public.voucher_redeem(text, uuid, text, uuid, text, text, uuid, date, text, text) to service_role;

create or replace function public.voucher_undo_redeem(
  p_voucher_number text,
  p_user_id uuid,
  p_employee_id uuid,
  p_actor_name text,
  p_require_recent boolean,
  p_reason text,
  p_source text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'actor_name is required');
  end if;
  if not coalesce(p_require_recent, true) and (p_reason is null or btrim(p_reason) = '') then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'a reason is required to undo outside the 60-second window');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status <> 'redeemed' then
    if v_row.status = 'issued' and p_idempotency_key is not null and exists (
      select 1 from voucher_events
      where voucher_id = v_row.id and action = 'undo_redeem'
        and detail ->> 'idempotency_key' = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'idempotent_replay', true);
    end if;
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'generated' then 'NOT_ISSUED'
        when 'issued' then 'NOT_REDEEMED'
        when 'expired' then 'EXPIRED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  if coalesce(p_require_recent, true) and v_row.redeemed_at <= now() - interval '60 seconds' then
    return jsonb_build_object('success', false, 'error_code', 'UNDO_WINDOW_CLOSED', 'current_status', v_row.status,
                              'redeemed_at', v_row.redeemed_at);
  end if;

  update vouchers set
    status = 'issued',
    redeemed_at = null,
    redeemed_by = null,
    redeemed_by_name = null,
    redeemed_by_user_id = null,
    transaction_ref = null,
    booking_ref = null
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'undo_redeem', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'foh'),
          jsonb_strip_nulls(jsonb_build_object(
            'reason', nullif(btrim(coalesce(p_reason, '')), ''),
            'require_recent', coalesce(p_require_recent, true),
            'idempotency_key', p_idempotency_key)));

  perform voucher_reminders_recompute(v_row.id);
  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;
revoke all on function public.voucher_undo_redeem(text, uuid, uuid, text, boolean, text, text, text) from public, anon, authenticated;
grant execute on function public.voucher_undo_redeem(text, uuid, uuid, text, boolean, text, text, text) to service_role;

-- Attribution.
drop index if exists public.marketing_conversions_table_booking_key;
alter table public.marketing_conversions
  drop constraint marketing_conversions_conversion_type_check,
  add constraint marketing_conversions_conversion_type_check check (
    conversion_type = any (array['christmas_enquiry', 'private_booking_enquiry', 'contact_form', 'other'])
  );

-- Vouchers.
delete from public.voucher_types where id in ('return-10', 'return-25');
alter table public.vouchers
  drop constraint if exists vouchers_redeemed_value_pence_check,
  drop column marketing_recipient_id,
  drop column redeemed_value_pence;
drop index if exists public.voucher_batches_campaign_idx;
alter table public.voucher_batches
  drop column marketing_campaign_id,
  drop column digital;
alter table public.voucher_types
  drop constraint voucher_types_percent_off_check,
  drop constraint voucher_types_discount_kind_check,
  drop column digital_only,
  drop column percent_off,
  drop column discount_kind;

-- Recipients. No row can hold a new skip reason while no lifecycle campaign exists.
create unique index mcr_campaign_customer_key
  on public.marketing_campaign_recipients (campaign_id, customer_id) where customer_id is not null;
drop index public.mcr_campaign_customer_anchor_key;
drop index if exists public.mcr_voucher_idx;
alter table public.marketing_campaign_recipients
  drop constraint marketing_campaign_recipients_skip_reason_check,
  add constraint marketing_campaign_recipients_skip_reason_check check (
    skip_reason is null or skip_reason = any (array[
      'unsubscribed', 'suppressed', 'do_not_contact', 'frequency_cap', 'not_eligible',
      'campaign_cancelled', 'already_booked'
    ])
  ),
  drop column lifecycle_anchor_date,
  drop column voucher_id,
  drop column merge_fields;

-- Campaigns.
alter table public.marketing_campaigns
  drop constraint marketing_campaigns_lifecycle_fields,
  drop constraint marketing_campaigns_holdout_percent_check,
  drop constraint marketing_campaigns_kind_check,
  drop column holdout_percent,
  drop column last_promoted_on,
  drop column promote_at_local,
  drop column send_days,
  drop column cooldown_days,
  drop column kind;

commit;

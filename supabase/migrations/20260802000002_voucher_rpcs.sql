-- Voucher lifecycle RPCs (spec: tasks/voucher-system-spec-2026-07-30.md rev 3, sections 2.5, 5.2, 7.1).
--
-- Every lifecycle change is one function: the guarded UPDATE and the voucher_events
-- insert happen in a single transaction. Zero-row guards return the current status
-- so callers can build exact error messages. All functions are SECURITY DEFINER and
-- locked to service_role at the end of this file (precedent: 20260801001300); they
-- are called through the admin client after app-level checkUserPermission.
--
-- Conventions:
-- - Voucher numbers are canonicalised as upper(btrim(...)); full normalisation
--   (hyphenless input, scanner suffixes) is the app's job (F50).
-- - Success: {"success": true, "voucher": {...}}. Failure: {"success": false,
--   "error_code": ..., "current_status": ...}.
-- - Idempotent replay: if the guard fails but the voucher is already in the target
--   state and a voucher_events row carries the same idempotency key, the call
--   returns success with the current row instead of an error.
-- - voucher_events.detail carries ids and field diffs only, never customer names
--   or phone numbers (F37).

-- ---------------------------------------------------------------------------
-- voucher_generate_batch
-- p_items: [{"type_id": text, "quantity": int}]. Allocates AN-YYMM-NNNN numbers
-- via the monthly counter, snapshots the printed type definitions on the batch
-- (F04), inserts vouchers as 'generated' with one 'generated' event each.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_generate_batch(
  p_items jsonb,
  p_note text,
  p_created_by uuid,
  p_created_by_name text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_elem jsonb;
  v_type_id text;
  v_qty integer;
  v_total integer := 0;
  v_type record;
  v_month_key text;
  v_last_seq integer;
  v_seq integer;
  v_terms_version text;
  v_type_defs jsonb;
  v_batch_id uuid;
  v_number text;
  v_voucher_id uuid;
  v_numbers text[] := '{}';
begin
  if p_created_by_name is null or btrim(p_created_by_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'created_by_name is required');
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'items must be a non-empty array');
  end if;

  -- Validate every item before writing anything.
  for v_elem in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_elem) <> 'object' or not (v_elem ? 'type_id') or jsonb_typeof(v_elem -> 'quantity') <> 'number' then
      return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'each item needs type_id and a numeric quantity');
    end if;
    v_type_id := v_elem ->> 'type_id';
    v_qty := (v_elem ->> 'quantity')::integer;
    if v_qty < 1 or v_qty > 200 then
      return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', format('quantity for %s must be between 1 and 200', v_type_id));
    end if;
    select * into v_type from voucher_types where id = v_type_id;
    if not found then
      return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', format('unknown voucher type: %s', v_type_id));
    end if;
    if not v_type.active then
      return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', format('voucher type is inactive: %s', v_type_id));
    end if;
    v_total := v_total + v_qty;
  end loop;
  if v_total > 100 then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', format('batch cap is 100 vouchers, requested %s', v_total));
  end if;

  -- Terms version that will be printed on this batch (binding for life, F03).
  select version into v_terms_version
  from terms_versions
  order by effective_from desc, created_at desc
  limit 1;
  if v_terms_version is null then
    raise exception 'No terms version is seeded; cannot generate vouchers';
  end if;

  -- Month key from the batch timestamp, captured once (spec 2.7).
  v_month_key := to_char(now() at time zone 'Europe/London', 'YYMM');

  insert into voucher_number_counters (month_key, last_seq)
  values (v_month_key, v_total)
  on conflict (month_key) do update
    set last_seq = voucher_number_counters.last_seq + excluded.last_seq
  returning last_seq into v_last_seq;

  if v_last_seq > 9999 then
    -- The exception rolls the counter increment back with the rest of the transaction.
    raise exception 'Voucher numbers exhausted for month %: this batch of % would end at % (maximum 9999). Generation stopped.',
      v_month_key, v_total, v_last_seq;
  end if;
  v_seq := v_last_seq - v_total + 1;

  -- Printed definition snapshot of every type used in this batch (F04).
  select jsonb_object_agg(t.id, to_jsonb(t)) into v_type_defs
  from voucher_types t
  where t.id in (select distinct e ->> 'type_id' from jsonb_array_elements(p_items) e);

  insert into voucher_batches (created_by, created_by_name, note, terms_version, type_definitions, total_count)
  values (p_created_by, p_created_by_name, nullif(btrim(coalesce(p_note, '')), ''), v_terms_version, v_type_defs, v_total)
  returning id into v_batch_id;

  for v_elem in select value from jsonb_array_elements(p_items) loop
    v_type_id := v_elem ->> 'type_id';
    v_qty := (v_elem ->> 'quantity')::integer;
    for i in 1..v_qty loop
      v_number := 'AN-' || v_month_key || '-' || lpad(v_seq::text, 4, '0');
      insert into vouchers (voucher_number, type_id, batch_id, status, value_pence, terms_version)
      select v_number, v_type_id, v_batch_id, 'generated', t.value_pence, v_terms_version
      from voucher_types t where t.id = v_type_id
      returning id into v_voucher_id;

      insert into voucher_events (voucher_id, action, actor_user_id, actor_name, source, detail)
      values (v_voucher_id, 'generated', p_created_by, p_created_by_name, 'management',
              jsonb_build_object('batch_id', v_batch_id, 'voucher_number', v_number));

      v_numbers := v_numbers || v_number;
      v_seq := v_seq + 1;
    end loop;
  end loop;

  return jsonb_build_object(
    'success', true,
    'batch_id', v_batch_id,
    'month_key', v_month_key,
    'total_count', v_total,
    'first_number', v_numbers[1],
    'last_number', v_numbers[array_upper(v_numbers, 1)],
    'voucher_numbers', to_jsonb(v_numbers)
  );
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_issue: generated -> issued. Batch must be pdf_status 'ready' (F10);
-- expiry_date is required (F02).
-- ---------------------------------------------------------------------------
create or replace function public.voucher_issue(
  p_voucher_number text,
  p_employee_id uuid,
  p_employee_name text,
  p_user_id uuid,
  p_event_id uuid,
  p_won_at_label text,
  p_expiry_date date,
  p_customer_id uuid,
  p_source text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
  v_pdf_status text;
begin
  if p_expiry_date is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'expiry_date is required at hand-out');
  end if;
  if p_employee_id is null or p_employee_name is null or btrim(p_employee_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'issuing employee is required');
  end if;
  if p_won_at_label is null or btrim(p_won_at_label) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'won_at_label is required');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status <> 'generated' then
    if v_row.status = 'issued' and p_idempotency_key is not null and exists (
      select 1 from voucher_events
      where voucher_id = v_row.id and action = 'issued'
        and detail ->> 'idempotency_key' = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'idempotent_replay', true);
    end if;
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'issued' then 'ALREADY_ISSUED'
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'expired' then 'EXPIRED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  select pdf_status into v_pdf_status from voucher_batches where id = v_row.batch_id;
  if v_pdf_status is distinct from 'ready' then
    return jsonb_build_object('success', false, 'error_code', 'BATCH_NOT_READY', 'current_status', v_row.status);
  end if;

  update vouchers set
    status = 'issued',
    issued_at = now(),
    issued_by = p_employee_id,
    issued_by_name = p_employee_name,
    issued_by_user_id = p_user_id,
    event_id = p_event_id,
    won_at_label = btrim(p_won_at_label),
    expiry_date = p_expiry_date,
    customer_id = coalesce(p_customer_id, customer_id)
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'issued', p_user_id, p_employee_id, p_employee_name, coalesce(p_source, 'management'),
          jsonb_strip_nulls(jsonb_build_object(
            'event_id', p_event_id,
            'won_at_label', v_row.won_at_label,
            'expiry_date', v_row.expiry_date,
            'customer_id', p_customer_id,
            'idempotency_key', p_idempotency_key)));

  perform voucher_reminders_recompute(v_row.id);
  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_redeem: issued -> redeemed. Blocked when London today is past expiry.
-- If a customer id is supplied and none is set yet, it is attached on the way.
-- ---------------------------------------------------------------------------
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
  v_requires_booking boolean;
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

  -- Booking-required types need a booking reference (transition matrix).
  select coalesce((b.type_definitions -> v_row.type_id ->> 'requires_booking')::boolean, t.requires_booking)
    into v_requires_booking
  from voucher_batches b, voucher_types t
  where b.id = v_row.batch_id and t.id = v_row.type_id;
  if v_requires_booking and (p_booking_ref is null or btrim(p_booking_ref) = '') then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'current_status', v_row.status,
                              'message', 'booking_ref is required for this voucher type');
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

-- ---------------------------------------------------------------------------
-- voucher_undo_redeem: redeemed -> issued. FOH passes p_require_recent = true
-- (60-second window); management passes false with a reason.
-- ---------------------------------------------------------------------------
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

-- ---------------------------------------------------------------------------
-- voucher_cancel: generated or issued -> cancelled. Reason is mandatory.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_cancel(
  p_voucher_number text,
  p_reason text,
  p_user_id uuid,
  p_employee_id uuid,
  p_actor_name text,
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
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'a cancellation reason is required');
  end if;
  if p_actor_name is null or btrim(p_actor_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'actor_name is required');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status not in ('generated', 'issued') then
    if v_row.status = 'cancelled' and p_idempotency_key is not null and exists (
      select 1 from voucher_events
      where voucher_id = v_row.id and action = 'cancelled'
        and detail ->> 'idempotency_key' = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'idempotent_replay', true);
    end if;
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'expired' then 'EXPIRED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  update vouchers set
    status = 'cancelled',
    cancelled_at = now(),
    cancelled_reason = btrim(p_reason)
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'cancelled', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
          jsonb_strip_nulls(jsonb_build_object(
            'reason', btrim(p_reason),
            'idempotency_key', p_idempotency_key)));

  update voucher_reminders set status = 'cancelled'
  where voucher_id = v_row.id and status = 'pending';

  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_replace: original (issued) -> replaced; replacement (generated stock
-- card of the same type, batch ready) -> issued, copying customer, event,
-- won-at label and expiry from the original. Links written both ways (F09, F14).
-- Both rows locked FOR UPDATE in stable id order to avoid deadlocks.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_replace(
  p_original_number text,
  p_replacement_number text,
  p_reason text,
  p_user_id uuid,
  p_employee_id uuid,
  p_actor_name text,
  p_source text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_orig_number text := upper(btrim(p_original_number));
  v_repl_number text := upper(btrim(p_replacement_number));
  v_orig vouchers%rowtype;
  v_repl vouchers%rowtype;
  v_pdf_status text;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'a replacement reason is required');
  end if;
  if p_actor_name is null or btrim(p_actor_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'actor_name is required');
  end if;
  if v_orig_number = v_repl_number then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'original and replacement must be different vouchers');
  end if;

  -- Lock both rows in stable order.
  perform 1 from vouchers
  where voucher_number in (v_orig_number, v_repl_number)
  order by id
  for update;

  select * into v_orig from vouchers where voucher_number = v_orig_number;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null, 'which', 'original');
  end if;
  select * into v_repl from vouchers where voucher_number = v_repl_number;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null, 'which', 'replacement');
  end if;

  -- Idempotent replay: this exact replacement already happened.
  if v_orig.status = 'replaced' and v_orig.replaced_by_id = v_repl.id
     and p_idempotency_key is not null and exists (
       select 1 from voucher_events
       where voucher_id = v_orig.id and action = 'replaced'
         and detail ->> 'idempotency_key' = p_idempotency_key
     ) then
    return jsonb_build_object('success', true, 'voucher', to_jsonb(v_orig),
                              'replacement', to_jsonb(v_repl), 'idempotent_replay', true);
  end if;

  if v_orig.status <> 'issued' then
    return jsonb_build_object('success', false, 'which', 'original', 'current_status', v_orig.status, 'error_code',
      case v_orig.status
        when 'generated' then 'NOT_ISSUED'
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'expired' then 'EXPIRED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;
  if v_repl.status <> 'generated' then
    return jsonb_build_object('success', false, 'which', 'replacement', 'current_status', v_repl.status,
                              'error_code', 'REPLACEMENT_NOT_AVAILABLE');
  end if;
  if v_repl.type_id <> v_orig.type_id then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'which', 'replacement',
                              'message', 'replacement must be a generated stock card of the same type');
  end if;
  select pdf_status into v_pdf_status from voucher_batches where id = v_repl.batch_id;
  if v_pdf_status is distinct from 'ready' then
    return jsonb_build_object('success', false, 'error_code', 'BATCH_NOT_READY', 'which', 'replacement',
                              'current_status', v_repl.status);
  end if;

  -- Replacement takes over the hand-out.
  update vouchers set
    status = 'issued',
    issued_at = now(),
    issued_by = p_employee_id,
    issued_by_name = p_actor_name,
    issued_by_user_id = p_user_id,
    event_id = v_orig.event_id,
    won_at_label = v_orig.won_at_label,
    expiry_date = v_orig.expiry_date,
    customer_id = v_orig.customer_id,
    replaces_id = v_orig.id
  where id = v_repl.id
  returning * into v_repl;

  update vouchers set
    status = 'replaced',
    replaced_by_id = v_repl.id,
    cancelled_at = now(),
    cancelled_reason = btrim(p_reason)
  where id = v_orig.id
  returning * into v_orig;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_orig.id, 'replaced', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
          jsonb_strip_nulls(jsonb_build_object(
            'replacement_id', v_repl.id,
            'replacement_number', v_repl.voucher_number,
            'reason', btrim(p_reason),
            'idempotency_key', p_idempotency_key)));

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_repl.id, 'issued', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
          jsonb_strip_nulls(jsonb_build_object(
            'replaces_id', v_orig.id,
            'original_number', v_orig.voucher_number,
            'won_at_label', v_repl.won_at_label,
            'expiry_date', v_repl.expiry_date,
            'customer_id', v_repl.customer_id,
            'idempotency_key', p_idempotency_key)));

  update voucher_reminders set status = 'cancelled'
  where voucher_id = v_orig.id and status = 'pending';

  perform voucher_reminders_recompute(v_repl.id);

  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_orig), 'replacement', to_jsonb(v_repl));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_edit_handout: manage-only edits to hand-out details on issued or
-- expired vouchers. Allowed patch keys: issued_by, issued_by_name, event_id,
-- won_at_label, expiry_date. Recomputes status from expiry (F26) and the
-- reminder schedule atomically. Event 'edited' carries before/after diffs.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_edit_handout(
  p_voucher_number text,
  p_patch jsonb,
  p_reason text,
  p_user_id uuid,
  p_employee_id uuid,
  p_actor_name text,
  p_source text,
  p_london_today date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
  v_bad text[];
  v_new_issued_by uuid;
  v_new_issued_by_name text;
  v_new_event_id uuid;
  v_new_won_at_label text;
  v_new_expiry date;
  v_new_status text;
  v_before jsonb := '{}'::jsonb;
  v_after jsonb := '{}'::jsonb;
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'an edit reason is required');
  end if;
  if p_actor_name is null or btrim(p_actor_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'actor_name is required');
  end if;
  if p_london_today is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'london_today is required');
  end if;
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'patch must be an object');
  end if;
  select array_agg(k) into v_bad
  from jsonb_object_keys(p_patch) k
  where k not in ('issued_by', 'issued_by_name', 'event_id', 'won_at_label', 'expiry_date');
  if v_bad is not null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR',
                              'message', format('patch contains fields that cannot be edited: %s', array_to_string(v_bad, ', ')));
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status not in ('issued', 'expired') then
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'generated' then 'NOT_ISSUED'
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  v_new_issued_by := case when p_patch ? 'issued_by' then nullif(p_patch ->> 'issued_by', '')::uuid else v_row.issued_by end;
  v_new_issued_by_name := case when p_patch ? 'issued_by_name' then p_patch ->> 'issued_by_name' else v_row.issued_by_name end;
  v_new_event_id := case when p_patch ? 'event_id' then nullif(p_patch ->> 'event_id', '')::uuid else v_row.event_id end;
  v_new_won_at_label := case when p_patch ? 'won_at_label' then p_patch ->> 'won_at_label' else v_row.won_at_label end;
  v_new_expiry := case when p_patch ? 'expiry_date' then (p_patch ->> 'expiry_date')::date else v_row.expiry_date end;

  if v_new_issued_by_name is null or btrim(v_new_issued_by_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'issued_by_name cannot be blank');
  end if;
  if v_new_won_at_label is null or btrim(v_new_won_at_label) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'won_at_label cannot be blank');
  end if;
  if v_new_expiry is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'expiry_date cannot be removed');
  end if;

  -- Status follows the (possibly edited) expiry date (F26).
  v_new_status := case when v_new_expiry >= p_london_today then 'issued' else 'expired' end;

  if p_patch ? 'issued_by' then
    v_before := v_before || jsonb_build_object('issued_by', v_row.issued_by);
    v_after := v_after || jsonb_build_object('issued_by', v_new_issued_by);
  end if;
  if p_patch ? 'issued_by_name' then
    v_before := v_before || jsonb_build_object('issued_by_name', v_row.issued_by_name);
    v_after := v_after || jsonb_build_object('issued_by_name', v_new_issued_by_name);
  end if;
  if p_patch ? 'event_id' then
    v_before := v_before || jsonb_build_object('event_id', v_row.event_id);
    v_after := v_after || jsonb_build_object('event_id', v_new_event_id);
  end if;
  if p_patch ? 'won_at_label' then
    v_before := v_before || jsonb_build_object('won_at_label', v_row.won_at_label);
    v_after := v_after || jsonb_build_object('won_at_label', v_new_won_at_label);
  end if;
  if p_patch ? 'expiry_date' then
    v_before := v_before || jsonb_build_object('expiry_date', v_row.expiry_date);
    v_after := v_after || jsonb_build_object('expiry_date', v_new_expiry);
  end if;
  if v_new_status <> v_row.status then
    v_before := v_before || jsonb_build_object('status', v_row.status);
    v_after := v_after || jsonb_build_object('status', v_new_status);
  end if;

  update vouchers set
    status = v_new_status,
    issued_by = v_new_issued_by,
    issued_by_name = btrim(v_new_issued_by_name),
    event_id = v_new_event_id,
    won_at_label = btrim(v_new_won_at_label),
    expiry_date = v_new_expiry
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'edited', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
          jsonb_build_object('reason', btrim(p_reason), 'before', v_before, 'after', v_after));

  perform voucher_reminders_recompute(v_row.id);
  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_assign_customer: assign, change or remove (null) the customer on any
-- non-terminal voucher, plus redeemed. Reminders are recomputed: pending rows
-- are cancelled on removal and retargeted on change (F36).
-- ---------------------------------------------------------------------------
create or replace function public.voucher_assign_customer(
  p_voucher_number text,
  p_customer_id uuid,
  p_user_id uuid,
  p_employee_id uuid,
  p_actor_name text,
  p_source text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_row vouchers%rowtype;
  v_previous uuid;
begin
  if p_actor_name is null or btrim(p_actor_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'actor_name is required');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if v_row.status in ('cancelled', 'replaced') then
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status when 'cancelled' then 'CANCELLED' when 'replaced' then 'REPLACED' end);
  end if;

  if v_row.customer_id is not distinct from p_customer_id then
    return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'no_change', true);
  end if;

  v_previous := v_row.customer_id;

  update vouchers set customer_id = p_customer_id
  where id = v_row.id
  returning * into v_row;

  if p_customer_id is null then
    insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
    values (v_row.id, 'customer_removed', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
            jsonb_build_object('customer_id', v_previous));
  else
    insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
    values (v_row.id, 'customer_assigned', p_user_id, p_employee_id, p_actor_name, coalesce(p_source, 'management'),
            jsonb_strip_nulls(jsonb_build_object('customer_id', p_customer_id, 'previous_customer_id', v_previous)));
  end if;

  perform voucher_reminders_recompute(v_row.id);
  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_override_redeem: manager-only redemption of an expired voucher (or an
-- issued one whose expiry has passed but the nightly job has not yet run). F27.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_override_redeem(
  p_voucher_number text,
  p_reason text,
  p_manager_user_id uuid,
  p_employee_id uuid,
  p_employee_name text,
  p_transaction_ref text,
  p_booking_ref text,
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
begin
  if p_reason is null or btrim(p_reason) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'an override reason is required');
  end if;
  if p_employee_id is null or p_employee_name is null or btrim(p_employee_name) = '' then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'redeeming employee is required');
  end if;
  if p_london_today is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'london_today is required');
  end if;

  select * into v_row from vouchers where voucher_number = upper(btrim(p_voucher_number)) for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'current_status', null);
  end if;

  if not (v_row.status = 'expired' or (v_row.status = 'issued' and v_row.expiry_date < p_london_today)) then
    if v_row.status = 'redeemed' and p_idempotency_key is not null and exists (
      select 1 from voucher_events
      where voucher_id = v_row.id and action = 'override_redeemed'
        and detail ->> 'idempotency_key' = p_idempotency_key
    ) then
      return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row), 'idempotent_replay', true);
    end if;
    return jsonb_build_object('success', false, 'current_status', v_row.status, 'error_code',
      case v_row.status
        when 'generated' then 'NOT_ISSUED'
        when 'issued' then 'NOT_EXPIRED'
        when 'redeemed' then 'ALREADY_REDEEMED'
        when 'cancelled' then 'CANCELLED'
        when 'replaced' then 'REPLACED'
      end);
  end if;

  update vouchers set
    status = 'redeemed',
    redeemed_at = now(),
    redeemed_by = p_employee_id,
    redeemed_by_name = p_employee_name,
    redeemed_by_user_id = p_manager_user_id,
    transaction_ref = nullif(btrim(coalesce(p_transaction_ref, '')), ''),
    booking_ref = nullif(btrim(coalesce(p_booking_ref, '')), '')
  where id = v_row.id
  returning * into v_row;

  insert into voucher_events (voucher_id, action, actor_user_id, actor_employee_id, actor_name, source, detail)
  values (v_row.id, 'override_redeemed', p_manager_user_id, p_employee_id, p_employee_name, coalesce(p_source, 'management'),
          jsonb_strip_nulls(jsonb_build_object(
            'reason', btrim(p_reason),
            'transaction_ref', v_row.transaction_ref,
            'booking_ref', v_row.booking_ref,
            'idempotency_key', p_idempotency_key)));

  update voucher_reminders set status = 'cancelled'
  where voucher_id = v_row.id and status = 'pending';

  return jsonb_build_object('success', true, 'voucher', to_jsonb(v_row));
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_expire_due: nightly pass. Expires every issued voucher whose expiry
-- date is before the London date, writes one 'expired' event each and cancels
-- their pending reminders. Returns the count.
-- ---------------------------------------------------------------------------
create or replace function public.voucher_expire_due(
  p_london_today date
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_count integer;
begin
  if p_london_today is null then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'london_today is required');
  end if;

  with due as (
    update vouchers set status = 'expired'
    where status = 'issued' and expiry_date < p_london_today
    returning id, expiry_date
  ), ev as (
    insert into voucher_events (voucher_id, action, actor_name, source, detail)
    select id, 'expired', 'System', 'cron', jsonb_build_object('expiry_date', expiry_date)
    from due
  ), rem as (
    update voucher_reminders r set status = 'cancelled'
    from due d
    where r.voucher_id = d.id and r.status = 'pending'
  )
  select count(*) into v_count from due;

  return jsonb_build_object('success', true, 'expired_count', v_count);
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_reminders_recompute: deterministic outbox derivation (spec 5.2).
-- Called on issue, undo-redeem, hand-out edits and customer assign/remove.
--
-- Rules implemented:
-- - Rows only exist while the voucher is issued and has a customer; otherwise
--   pending rows are cancelled.
-- - sent/skipped/failed rows are immutable; their kinds are never recreated.
-- - day30/day90 are scheduled when expiry is after that milestone; pre_expiry
--   (expiry - 14 days) when it falls after issue and is not within 7 days of a
--   scheduled day30/day90.
-- - Milestones already in the past when computed are inserted as 'skipped',
--   never sent late.
-- - At most 2 sendable pending rows after accounting for already-sent
--   reminders. When capped, pre_expiry is kept first, then day30, then day90,
--   so the final warning is never the one dropped.
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
  v_issued_on date;
  v_day30_date date;
  v_day90_date date;
  v_pre_date date;
  v_day30_scheduled boolean;
  v_day90_scheduled boolean;
  v_pre_scheduled boolean;
  v_locked text[];
  v_sent_count integer;
  v_budget integer;
  v_pending integer := 0;
  v_skipped integer := 0;
  v_kind text;
  v_date date;
begin
  select * into v_row from vouchers where id = p_voucher_id for update;
  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND');
  end if;

  if v_row.status <> 'issued' or v_row.customer_id is null then
    update voucher_reminders set status = 'cancelled'
    where voucher_id = p_voucher_id and status = 'pending';
    return jsonb_build_object('success', true, 'pending', 0);
  end if;

  v_today := (now() at time zone 'Europe/London')::date;
  v_issued_on := (v_row.issued_at at time zone 'Europe/London')::date;
  v_day30_date := v_issued_on + 30;
  v_day90_date := v_issued_on + 90;
  v_pre_date := v_row.expiry_date - 14;

  v_day30_scheduled := v_row.expiry_date > v_day30_date;
  v_day90_scheduled := v_row.expiry_date > v_day90_date;
  -- Coverage uses the schedule-level day30/day90 flags, sent or not.
  v_pre_scheduled := v_pre_date > v_issued_on
    and not (v_day30_scheduled and abs(v_day30_date - v_pre_date) <= 7)
    and not (v_day90_scheduled and abs(v_day90_date - v_pre_date) <= 7);

  select coalesce(array_agg(reminder_kind), '{}') into v_locked
  from voucher_reminders
  where voucher_id = p_voucher_id and status in ('sent', 'skipped', 'failed');

  select count(*) into v_sent_count
  from voucher_reminders
  where voucher_id = p_voucher_id and status = 'sent';

  v_budget := greatest(0, 2 - v_sent_count);

  -- Recomputable rows are replaced wholesale; immutable rows stay put.
  delete from voucher_reminders
  where voucher_id = p_voucher_id and status in ('pending', 'cancelled');

  for v_kind, v_date in
    select m.kind, m.milestone from (values
      (1, 'pre_expiry', v_pre_date),
      (2, 'day30', v_day30_date),
      (3, 'day90', v_day90_date)
    ) as m(priority, kind, milestone)
    order by m.priority
  loop
    continue when v_kind = 'pre_expiry' and not v_pre_scheduled;
    continue when v_kind = 'day30' and not v_day30_scheduled;
    continue when v_kind = 'day90' and not v_day90_scheduled;
    continue when v_kind = any(v_locked);

    if v_date < v_today then
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'skipped', v_date)
      on conflict (voucher_id, reminder_kind) do nothing;
      v_skipped := v_skipped + 1;
    elsif v_budget > 0 then
      insert into voucher_reminders (voucher_id, customer_id, reminder_kind, status, scheduled_for)
      values (p_voucher_id, v_row.customer_id, v_kind, 'pending', v_date)
      on conflict (voucher_id, reminder_kind) do nothing;
      v_pending := v_pending + 1;
      v_budget := v_budget - 1;
    end if;
  end loop;

  return jsonb_build_object('success', true, 'pending', v_pending, 'skipped', v_skipped);
end;
$func$;

-- ---------------------------------------------------------------------------
-- voucher_reminders_claim_due: atomically claims due pending reminders for the
-- cron reminder pass. One voucher reminder per customer per London day (extra
-- due rows stay pending and defer); rows already attempted 3 times are left
-- for voucher_reminder_mark to fail. Claiming bumps attempts but leaves status
-- pending; the app records the outcome via voucher_reminder_mark.
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
    select id, scheduled_for, created_at
    from ranked
    where rn = 1
      and customer_id not in (
        select customer_id from voucher_reminders
        where status = 'sent'
          and customer_id is not null
          and (sent_at at time zone 'Europe/London')::date = p_london_today
      )
    order by scheduled_for, created_at
    limit v_limit
  ), claimed as (
    update voucher_reminders r
    set attempts = r.attempts + 1
    from chosen c
    where r.id = c.id
    returning r.id, r.voucher_id, r.customer_id, r.reminder_kind, r.scheduled_for, r.attempts
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'reminder_id', cl.id,
    'voucher_id', cl.voucher_id,
    'reminder_kind', cl.reminder_kind,
    'scheduled_for', cl.scheduled_for,
    'attempts', cl.attempts,
    'voucher_number', v.voucher_number,
    'type_id', v.type_id,
    'display_title', coalesce(b.type_definitions -> v.type_id ->> 'display_title', t.display_title),
    'prize', coalesce(b.type_definitions -> v.type_id -> 'copy' ->> 'prize', t.copy ->> 'prize'),
    'won_at_label', v.won_at_label,
    'expiry_date', v.expiry_date,
    'customer_id', cl.customer_id,
    'customer_first_name', c.first_name,
    'customer_mobile', coalesce(c.mobile_e164, c.mobile_number),
    'sms_opt_in', c.sms_opt_in
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
-- voucher_reminder_mark: the app records the send outcome for a claimed row.
-- 'sent' stamps sent_at + message_sid and writes the 'reminder_sent' event.
-- 'failed' stores the error; the row stays pending until 3 attempts have been
-- made, then it is marked failed for good (F51).
-- ---------------------------------------------------------------------------
create or replace function public.voucher_reminder_mark(
  p_id uuid,
  p_status text,
  p_message_sid text,
  p_error text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $func$
declare
  v_rem voucher_reminders%rowtype;
begin
  if p_status not in ('sent', 'failed') then
    return jsonb_build_object('success', false, 'error_code', 'VALIDATION_ERROR', 'message', 'status must be sent or failed');
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
      last_error = null
    where id = p_id
    returning * into v_rem;

    insert into voucher_events (voucher_id, action, actor_name, source, detail)
    values (v_rem.voucher_id, 'reminder_sent', 'System', 'cron',
            jsonb_strip_nulls(jsonb_build_object(
              'reminder_kind', v_rem.reminder_kind,
              'customer_id', v_rem.customer_id,
              'scheduled_for', v_rem.scheduled_for,
              'message_sid', p_message_sid)));
  else
    if v_rem.attempts >= 3 then
      update voucher_reminders set status = 'failed', last_error = p_error
      where id = p_id
      returning * into v_rem;
    else
      update voucher_reminders set last_error = p_error
      where id = p_id
      returning * into v_rem;
    end if;
  end if;

  return jsonb_build_object('success', true, 'reminder', to_jsonb(v_rem));
end;
$func$;

-- ---------------------------------------------------------------------------
-- Grants lockdown (precedent: 20260801001300). A new function in public is
-- granted EXECUTE to anon and authenticated BY NAME via Supabase's default
-- privileges, so REVOKE FROM PUBLIC alone is not enough: revoke from anon and
-- authenticated explicitly, grant service_role only, then prove it.
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
        'voucher_generate_batch',
        'voucher_issue',
        'voucher_redeem',
        'voucher_undo_redeem',
        'voucher_cancel',
        'voucher_replace',
        'voucher_edit_handout',
        'voucher_assign_customer',
        'voucher_override_redeem',
        'voucher_expire_due',
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
      'voucher_generate_batch', 'voucher_issue', 'voucher_redeem', 'voucher_undo_redeem',
      'voucher_cancel', 'voucher_replace', 'voucher_edit_handout', 'voucher_assign_customer',
      'voucher_override_redeem', 'voucher_expire_due', 'voucher_reminders_recompute',
      'voucher_reminders_claim_due', 'voucher_reminder_mark'
    )
    and array_to_string(p.proacl::text[], ' ') ~ '(anon|authenticated)=X';

  if v_leaky is not null then
    raise exception using
      message = 'These voucher functions are still executable by anon or authenticated.',
      detail  = v_leaky,
      hint    = 'REVOKE ALL FROM PUBLIC does not remove a grant made to a named role. Revoke from anon and authenticated explicitly.';
  end if;
end;
$$;

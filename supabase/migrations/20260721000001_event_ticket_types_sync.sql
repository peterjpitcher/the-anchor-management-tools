-- Multiple ticket options per event — sync + multi-type create (part 2 of 3).
-- Trigger-driven default line keeps existing RPCs untouched and makes the migration
-- backward-compatible on its own. See tasks/event-ticket-options-spec.md (v3.1).

-- ============================================================================
-- sync_booking_default_item_v01: for a NON-reminder, single-type booking, upsert
-- exactly one default-type line whose quantity = bookings.seats. No-op when:
--   * the ams.skip_default_item guard is set (multi-type path, v07), or
--   * the booking is reminder-only / has no seats (deletes any stray lines), or
--   * the booking already carries a non-default line (multi-type → left alone).
-- unit_price is snapshotted from the event's CURRENT price on first insert and is
-- preserved on later seat changes (immutable snapshot).
-- ============================================================================
create or replace function public.sync_booking_default_item_v01(p_booking_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare
  v_event_id uuid; v_seats integer; v_reminder boolean;
  v_type_id uuid; v_base numeric; v_disc_type text; v_disc_val numeric; v_pmode text;
  v_unit numeric(10,2); v_nondefault integer;
begin
  if coalesce(current_setting('ams.skip_default_item', true), '') = 'on' then
    return;
  end if;

  select event_id, seats, is_reminder_only
    into v_event_id, v_seats, v_reminder
  from public.bookings where id = p_booking_id;
  if not found then return; end if;

  -- reminder-only or seat-less bookings are exempt from the line-item model
  if coalesce(v_reminder, false) or v_seats is null or v_seats < 1 then
    delete from public.booking_items where booking_id = p_booking_id;
    return;
  end if;

  -- resolve (or lazily create) the event's default ticket type
  select id into v_type_id
  from public.event_ticket_types
  where event_id = v_event_id and is_active
  order by sort_order, created_at
  limit 1;

  if v_type_id is null then
    select coalesce(price_per_seat, price, 0) into v_base
    from public.events where id = v_event_id;
    insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
    values (v_event_id, 'Standard', coalesce(v_base, 0), 0, true)
    returning id into v_type_id;
  end if;

  -- multi-type booking (has a line for a non-default type) → managed elsewhere, leave alone
  select count(*) into v_nondefault
  from public.booking_items
  where booking_id = p_booking_id and ticket_type_id <> v_type_id;
  if v_nondefault > 0 then return; end if;

  -- current unit price from the event (matches today's charge computation;
  -- the online discount only applies to prepaid events).
  select coalesce(price_per_seat, price, 0), online_discount_type, online_discount_value, payment_mode
    into v_base, v_disc_type, v_disc_val, v_pmode
  from public.events where id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;  -- keep the original unit_price snapshot
end $$;

-- Auto-sync trigger on bookings (INSERT + seat/reminder changes).
create or replace function public.trg_sync_booking_default_item()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.sync_booking_default_item_v01(new.id);
  return null;
end $$;

drop trigger if exists booking_sync_default_item on public.bookings;
create trigger booking_sync_default_item
  after insert or update of seats, is_reminder_only on public.bookings
  for each row execute function public.trg_sync_booking_default_item();

-- ============================================================================
-- create_event_booking_v07: multi-type create (dormant until the feature flag is
-- ON). Sets the skip guard so the auto-sync trigger doesn't add a default line,
-- creates the booking via v06, then inserts the real per-line items + names.
-- p_ticket_selections: [{ "ticket_type_id": uuid, "quantity": int, "attendee_names": text[] }]
-- ============================================================================
create or replace function public.create_event_booking_v07(
  p_event_id uuid,
  p_customer_id uuid,
  p_source text,
  p_seating_preference text,
  p_payment_hold_minutes integer,
  p_ticket_selections jsonb
)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_total integer;
  v_result jsonb;
  v_booking_id uuid;
  v_sel jsonb;
  v_type_id uuid; v_base numeric; v_cap integer;
  v_disc_type text; v_disc_val numeric; v_pmode text;
  v_unit numeric(10,2);
  v_names text[]; v_all_names text[] := '{}';
  v_remaining integer;
begin
  if p_ticket_selections is null or jsonb_typeof(p_ticket_selections) <> 'array'
     or jsonb_array_length(p_ticket_selections) = 0 then
    return jsonb_build_object('state', 'blocked', 'reason', 'no_ticket_selections');
  end if;

  select coalesce(sum((s->>'quantity')::int), 0) into v_total
  from jsonb_array_elements(p_ticket_selections) s;
  if v_total < 1 then
    return jsonb_build_object('state', 'blocked', 'reason', 'invalid_seats');
  end if;

  select online_discount_type, online_discount_value, payment_mode
    into v_disc_type, v_disc_val, v_pmode
  from public.events where id = p_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' then v_disc_type := null; v_disc_val := null; end if;

  -- create the booking (auto-sync suppressed); v06 handles capacity + hold + status
  perform set_config('ams.skip_default_item', 'on', true);
  v_result := public.create_event_booking_v06(
    p_event_id, p_customer_id, v_total, p_source, p_seating_preference, p_payment_hold_minutes
  );
  perform set_config('ams.skip_default_item', '', true);

  v_booking_id := (v_result->>'booking_id')::uuid;
  if v_booking_id is null then
    return v_result;  -- blocked / full_with_waitlist_option / etc.
  end if;

  for v_sel in select value from jsonb_array_elements(p_ticket_selections) loop
    select id, coalesce(base_price, 0), capacity into v_type_id, v_base, v_cap
    from public.event_ticket_types
    where id = (v_sel->>'ticket_type_id')::uuid and event_id = p_event_id and is_active;
    if v_type_id is null then
      raise exception 'invalid_ticket_type % for event %', v_sel->>'ticket_type_id', p_event_id;
    end if;

    if v_cap is not null then
      select remaining into v_remaining
      from public.get_event_ticket_type_capacity_v01(p_event_id)
      where ticket_type_id = v_type_id;
      if coalesce(v_remaining, 0) < (v_sel->>'quantity')::int then
        raise exception 'ticket_type_capacity_exceeded:%', v_type_id;
      end if;
    end if;

    v_unit := public.event_ticket_type_unit_price(v_base, v_disc_type, v_disc_val);
    v_names := coalesce(
      (select array_agg(x) from jsonb_array_elements_text(coalesce(v_sel->'attendee_names', '[]'::jsonb)) x),
      '{}');

    insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price, attendee_names)
    values (v_booking_id, v_type_id, (v_sel->>'quantity')::int, v_unit, v_names);

    v_all_names := v_all_names || v_names;
  end loop;

  if cardinality(v_all_names) > 0 then
    update public.bookings set attendee_names = v_all_names where id = v_booking_id;
  end if;

  return v_result;
end $$;

revoke all on function public.sync_booking_default_item_v01(uuid) from public;
grant execute on function public.sync_booking_default_item_v01(uuid) to authenticated, service_role;
revoke all on function public.create_event_booking_v07(uuid, uuid, text, text, integer, jsonb) from public;
grant execute on function public.create_event_booking_v07(uuid, uuid, text, text, integer, jsonb) to service_role;

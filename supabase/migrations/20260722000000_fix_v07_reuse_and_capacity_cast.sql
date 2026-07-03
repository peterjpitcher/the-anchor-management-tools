-- Fix two production defects in multiple-ticket-options (found via live incident 2026-07-03):
--
-- 1. create_event_booking_v07: when create_event_booking_v05/v06 REUSES an existing
--    booking row for the same customer+event (rebook-after-cancel, expired-hold revival,
--    or pending-booking update), the reused row still carries its old booking_items.
--    v07 then inserted the new basket lines on top, violating
--    UNIQUE(booking_id, ticket_type_id) and failing the whole booking with
--    "Failed to create event booking". Fix: the new basket REPLACES the old lines —
--    delete existing lines for the booking inside the same transaction before inserting.
--    The deferred seat-sum constraint trigger still validates consistency at commit.
--    Also: always refresh the aggregate bookings.attendee_names on reuse (clear stale
--    names when the new basket carries none).
--
-- 2. get_event_ticket_type_capacity_v01: sum(quantity) returns BIGINT, so the computed
--    "remaining" column mismatched the declared INTEGER return type and EVERY call raised
--    "structure of query does not match function result type" (42804). The event GET
--    swallowed the error (per-type remaining silently null); fix with explicit casts.

-- ────────────────────────────────────────────────────────────────────────────
-- Fix 1: v07 replaces any existing lines on the (possibly reused) booking row.
-- ────────────────────────────────────────────────────────────────────────────
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

  perform set_config('ams.skip_default_item', 'on', true);
  v_result := public.create_event_booking_v06(
    p_event_id, p_customer_id, v_total, p_source, p_seating_preference, p_payment_hold_minutes
  );
  perform set_config('ams.skip_default_item', '', true);

  v_booking_id := (v_result->>'booking_id')::uuid;

  -- Only proceed when v05/v06 actually CREATED a booking. Blocked responses can
  -- still carry a booking_id (state='blocked', reason='customer_conflict' returns
  -- the customer's EXISTING active booking) — mutating that booking's lines here
  -- corrupted live bookings and made every retry-with-active-hold fail hard.
  if v_booking_id is null
     or (v_result->>'state') not in ('pending_payment', 'confirmed') then
    return v_result;
  end if;

  -- Defensive: the new basket defines this booking's lines in full. A freshly
  -- created booking has none (the sync trigger is suppressed by the guard), so
  -- this is a no-op today; it protects against any future reuse semantics in
  -- v05/v06 re-introducing the UNIQUE(booking_id, ticket_type_id) collision.
  delete from public.booking_items where booking_id = v_booking_id;

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

  -- Refresh the aggregate unconditionally: on a reused booking, stale names from
  -- the previous basket must not survive when the new basket carries none.
  update public.bookings
  set attendee_names = case when cardinality(v_all_names) > 0 then v_all_names else null end
  where id = v_booking_id;

  return v_result;
end $$;

revoke all on function public.create_event_booking_v07(uuid, uuid, text, text, integer, jsonb) from public;
grant execute on function public.create_event_booking_v07(uuid, uuid, text, text, integer, jsonb) to service_role;

-- ────────────────────────────────────────────────────────────────────────────
-- Fix 2: explicit casts so the RETURNS TABLE types match (42804 on every call).
-- ────────────────────────────────────────────────────────────────────────────
create or replace function public.get_event_ticket_type_capacity_v01(p_event_id uuid)
returns table(ticket_type_id uuid, capacity_mode text, remaining integer)
language plpgsql stable security definer set search_path = public as $$
declare v_event_remaining integer;
begin
  select s.total_remaining into v_event_remaining
  from public.get_event_capacity_snapshot_v05(array[p_event_id]::uuid[]) s
  limit 1;
  v_event_remaining := greatest(0, coalesce(v_event_remaining, 0));

  return query
  select t.id,
         (case when t.capacity is null then 'shared' else 'dedicated' end)::text,
         (case
           when t.capacity is null then v_event_remaining
           else greatest(0, least(t.capacity - coalesce(used.q, 0), v_event_remaining))
         end)::integer
  from public.event_ticket_types t
  left join lateral (
    select coalesce(sum(bi.quantity), 0)::integer q
    from public.booking_items bi
    join public.bookings b on b.id = bi.booking_id
    where bi.ticket_type_id = t.id
      and public.is_active_event_booking_for_capacity_v01(b.status, b.hold_expires_at)
  ) used on true
  where t.event_id = p_event_id and t.is_active
  order by t.sort_order;
end $$;

revoke all on function public.get_event_ticket_type_capacity_v01(uuid) from public;
grant execute on function public.get_event_ticket_type_capacity_v01(uuid) to authenticated, service_role;

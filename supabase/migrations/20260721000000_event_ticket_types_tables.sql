-- Multiple ticket options per event — foundation (tables, RLS, helpers).
-- Part 1 of 3: 20260721000000 tables → 20260721000001 rpcs → 20260721000002 backfill+triggers.
-- Additive only. See tasks/event-ticket-options-spec.md (v3.1).

-- ============================================================================
-- event_ticket_types: named ticket options per event, holding BASE (list) prices.
-- ============================================================================
create table if not exists public.event_ticket_types (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null,
  description  text,
  base_price   numeric(10,2) not null default 0 check (base_price >= 0), -- list price, pre-discount
  capacity     integer check (capacity is null or capacity >= 0),        -- null = shared event pool
  sort_order   integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists event_ticket_types_event_idx
  on public.event_ticket_types(event_id, sort_order);

-- ============================================================================
-- booking_items: one row per ticket type per booking, holding the FINAL CHARGED
-- unit_price snapshot and the per-line attendee names (so each name maps to a type).
-- ============================================================================
create table if not exists public.booking_items (
  id             uuid primary key default gen_random_uuid(),
  booking_id     uuid not null references public.bookings(id) on delete cascade,
  ticket_type_id uuid not null references public.event_ticket_types(id) on delete cascade,
  quantity       integer not null check (quantity > 0),
  unit_price     numeric(10,2) not null check (unit_price >= 0), -- final charged £/seat (post-discount)
  attendee_names text[] not null default '{}',
  created_at     timestamptz not null default now(),
  unique (booking_id, ticket_type_id)
);
create index if not exists booking_items_booking_idx on public.booking_items(booking_id);
create index if not exists booking_items_type_idx on public.booking_items(ticket_type_id);

-- ============================================================================
-- RLS — mirror existing module patterns.
--   event_ticket_types → events module.  booking_items → bookings module.
-- Primary write path is the service-role client / SECURITY DEFINER RPCs (bypass RLS);
-- these policies cover authenticated reads/edits from the admin UI.
-- ============================================================================
alter table public.event_ticket_types enable row level security;
alter table public.booking_items enable row level security;

create policy event_ticket_types_view on public.event_ticket_types
  for select to authenticated using (user_has_permission(auth.uid(), 'events', 'view'));
create policy event_ticket_types_insert on public.event_ticket_types
  for insert to authenticated with check (user_has_permission(auth.uid(), 'events', 'edit'));
create policy event_ticket_types_update on public.event_ticket_types
  for update to authenticated
  using (user_has_permission(auth.uid(), 'events', 'edit'))
  with check (user_has_permission(auth.uid(), 'events', 'edit'));
create policy event_ticket_types_delete on public.event_ticket_types
  for delete to authenticated using (user_has_permission(auth.uid(), 'events', 'delete'));

create policy booking_items_view on public.booking_items
  for select to authenticated using (user_has_permission(auth.uid(), 'bookings', 'view'));
create policy booking_items_insert on public.booking_items
  for insert to authenticated with check (user_has_permission(auth.uid(), 'bookings', 'create'));
create policy booking_items_update on public.booking_items
  for update to authenticated
  using (user_has_permission(auth.uid(), 'bookings', 'edit'))
  with check (user_has_permission(auth.uid(), 'bookings', 'edit'));
create policy booking_items_delete on public.booking_items
  for delete to authenticated using (user_has_permission(auth.uid(), 'bookings', 'delete'));

-- ============================================================================
-- Pricing helper: apply the event-level online discount to a base price (once).
-- Mirrors src/lib/events/pricing.ts resolveEventOnlineDiscountAmount().
-- ============================================================================
create or replace function public.event_ticket_type_unit_price(
  p_base numeric, p_discount_type text, p_discount_value numeric
) returns numeric
language sql immutable as $$
  select greatest(0, round(
    p_base - coalesce(
      case
        when p_discount_type = 'percent' then p_base * (coalesce(p_discount_value,0) / 100.0)
        when p_discount_type = 'fixed'   then coalesce(p_discount_value,0)
        else 0
      end, 0)
  , 2));
$$;

-- ============================================================================
-- Per-type availability. NEW function (get_event_capacity_snapshot_v05 stays
-- unchanged; ~6 callers). Event remaining is taken FROM that snapshot so per-type
-- accounting can't drift from the event ceiling (incl. its waitlist accounting).
-- ============================================================================
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
         case when t.capacity is null then 'shared' else 'dedicated' end,
         case
           when t.capacity is null then v_event_remaining
           else greatest(0, least(t.capacity - coalesce(used.q, 0), v_event_remaining))
         end
  from public.event_ticket_types t
  left join lateral (
    select coalesce(sum(bi.quantity), 0) q
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
revoke all on function public.event_ticket_type_unit_price(numeric, text, numeric) from public;
grant execute on function public.event_ticket_type_unit_price(numeric, text, numeric) to authenticated, service_role;

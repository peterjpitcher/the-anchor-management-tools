-- Keep zero-valued legacy price_per_seat fields from masking a positive event price.
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

  if coalesce(v_reminder, false) or v_seats is null or v_seats < 1 then
    delete from public.booking_items where booking_id = p_booking_id;
    return;
  end if;

  select id into v_type_id
  from public.event_ticket_types
  where event_id = v_event_id and is_active
  order by sort_order, created_at
  limit 1;

  if v_type_id is null then
    select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0) into v_base
    from public.events where id = v_event_id;
    insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
    values (v_event_id, 'Standard', coalesce(v_base, 0), 0, true)
    returning id into v_type_id;
  end if;

  select count(*) into v_nondefault
  from public.booking_items
  where booking_id = p_booking_id and ticket_type_id <> v_type_id;
  if v_nondefault > 0 then return; end if;

  select coalesce(nullif(price_per_seat, 0), nullif(price, 0), 0),
         online_discount_type, online_discount_value, payment_mode
    into v_base, v_disc_type, v_disc_val, v_pmode
  from public.events where id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;
end $$;

-- Correct the July 2026 Music Bingo event and its inherited defaults.
update public.events
set time = '19:00',
    start_datetime = '2026-07-17 18:00:00+00',
    price = 5,
    price_per_seat = 5,
    is_free = false,
    payment_mode = 'cash_only',
    long_description = replace(
      replace(long_description, 'Friday 17th July at 8pm', 'Friday 17th July at 7pm'),
      'Tickets are just £3', 'Tickets are just £5'
    ),
    brief = replace(
      replace(brief, 'Friday 17th July 2026 from 8pm', 'Friday 17th July 2026 from 7pm'),
      'Friday 17th July, 8pm.', 'Friday 17th July, 7pm.'
    )
where id = '27e85126-e3cd-40ae-81c3-e1bf804664b5';

update public.event_categories
set default_start_time = '19:00',
    default_price = 5,
    default_is_free = false
where id = '8493fffe-b218-484c-8646-4e28cfd6c2f8';

update public.event_ticket_types
set base_price = 5,
    updated_at = now()
where event_id = '27e85126-e3cd-40ae-81c3-e1bf804664b5'
  and is_active;

-- The only existing booking was created while the default ticket type was
-- incorrectly £0. It is cash-only, so restore the intended door price snapshot.
update public.booking_items bi
set unit_price = 5
from public.bookings b
where bi.booking_id = b.id
  and b.event_id = '27e85126-e3cd-40ae-81c3-e1bf804664b5'
  and bi.unit_price = 0;

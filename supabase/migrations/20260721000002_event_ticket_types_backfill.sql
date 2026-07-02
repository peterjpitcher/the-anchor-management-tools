-- Multiple ticket options per event — backfill + enforcement (part 3 of 3).
-- Order: backfill data first, THEN add the strict seat-sum triggers (data already
-- consistent). Self-checks raise and abort the migration on any mismatch.

-- ============================================================================
-- 1. A default "Standard" ticket type per event (base_price = current list price).
-- ============================================================================
insert into public.event_ticket_types (event_id, name, base_price, sort_order, is_active)
select e.id, 'Standard', coalesce(e.price_per_seat, e.price, 0), 0, true
from public.events e
where not exists (select 1 from public.event_ticket_types t where t.event_id = e.id);

-- ============================================================================
-- 2. One default-type line per NON-reminder booking that has seats and no lines.
--    Prepaid → unit_price from the authoritative captured charge (payments.amount);
--    otherwise → the event's resolved price (matches today's charge computation).
-- ============================================================================
with tgt as (
  select b.id as booking_id, b.seats,
    (select t.id from public.event_ticket_types t
       where t.event_id = b.event_id and t.is_active
       order by t.sort_order, t.created_at limit 1) as type_id,
    p.amount as paid_amount,
    e.price_per_seat, e.price, e.online_discount_type, e.online_discount_value, e.payment_mode
  from public.bookings b
  join public.events e on e.id = b.event_id
  left join lateral (
    select amount from public.payments
    where event_booking_id = b.id and charge_type = 'prepaid_event' and amount > 0
    order by created_at desc limit 1
  ) p on true
  where coalesce(b.is_reminder_only, false) = false
    and b.seats is not null and b.seats >= 1
    and not exists (select 1 from public.booking_items bi where bi.booking_id = b.id)
)
insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
select booking_id, type_id, seats,
  case
    when paid_amount is not null and seats > 0 then round(paid_amount / seats, 2)
    else public.event_ticket_type_unit_price(
      coalesce(price_per_seat, price, 0),
      case when payment_mode = 'prepaid' then online_discount_type else null end,
      case when payment_mode = 'prepaid' then online_discount_value else null end)
  end
from tgt
where type_id is not null;

-- ============================================================================
-- 3. Self-checks — abort the migration if the backfill is inconsistent.
-- ============================================================================
do $$
declare v_bad integer; v_bad_prepaid integer;
begin
  select count(*) into v_bad
  from public.bookings b
  where coalesce(b.is_reminder_only, false) = false
    and b.seats is not null and b.seats >= 1
    and coalesce((select sum(quantity) from public.booking_items bi where bi.booking_id = b.id), 0) <> b.seats;
  if v_bad > 0 then
    raise exception 'Backfill check failed: % non-reminder bookings have item sum <> seats', v_bad;
  end if;

  -- prepaid charge reconciliation, within per-line rounding tolerance
  select count(*) into v_bad_prepaid
  from public.bookings b
  join lateral (
    select amount from public.payments
    where event_booking_id = b.id and charge_type = 'prepaid_event' and amount > 0
    order by created_at desc limit 1
  ) p on true
  where abs(
    coalesce((select sum(quantity * unit_price) from public.booking_items bi where bi.booking_id = b.id), 0) - p.amount
  ) > (b.seats * 0.01 + 0.01);
  if v_bad_prepaid > 0 then
    raise exception 'Backfill check failed: % prepaid bookings mismatch payments.amount beyond tolerance', v_bad_prepaid;
  end if;
end $$;

-- ============================================================================
-- 4. Strict seat-sum enforcement (deferred; reminder-only + seat-less exempt).
-- ============================================================================
create or replace function public.check_booking_seat_sum(p_booking uuid)
returns void language plpgsql set search_path = public as $$
declare v_sum integer; v_seats integer; v_reminder boolean;
begin
  select seats, is_reminder_only into v_seats, v_reminder from public.bookings where id = p_booking;
  if v_seats is null then return; end if;                 -- booking gone / seat-less
  if coalesce(v_reminder, false) then return; end if;     -- reminder-only exempt
  select coalesce(sum(quantity), 0) into v_sum from public.booking_items where booking_id = p_booking;
  if v_sum <> v_seats then
    raise exception 'booking_items sum (%) != bookings.seats (%) for booking %', v_sum, v_seats, p_booking;
  end if;
end $$;

create or replace function public.trg_check_booking_items_sum()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.check_booking_seat_sum(coalesce(new.booking_id, old.booking_id));
  return null;
end $$;

create or replace function public.trg_check_bookings_sum()
returns trigger language plpgsql set search_path = public as $$
begin
  perform public.check_booking_seat_sum(new.id);
  return null;
end $$;

drop trigger if exists booking_items_seat_sum on public.booking_items;
create constraint trigger booking_items_seat_sum
  after insert or update or delete on public.booking_items
  deferrable initially deferred for each row
  execute function public.trg_check_booking_items_sum();

drop trigger if exists bookings_seat_sum on public.bookings;
create constraint trigger bookings_seat_sum
  after insert or update of seats on public.bookings
  deferrable initially deferred for each row
  execute function public.trg_check_bookings_sum();

-- Production's pricing triggers and default-item sync, as pg_get_functiondef returned them on
-- 28 October 2026 (project tfcasgxopxegwrabvwat). md5(prosrc):
--   normalize_event_pricing_v01   a212ac010e38cd6b23f62be224dabdae
--   sync_event_ticket_price_v01   36ae08367b178b7aa5825f0106563033
--   event_ticket_type_unit_price  60d4c221f5cbf914ab8fabc6b59b09cc
--   sync_booking_default_item_v01 f9bbd300f1758a817beb29bccd90ead7
--   trg_sync_booking_default_item d306c768e200da535e1b3763a949445b
-- Loaded by scripts/testing/event-payment-mode-lock-postgres.py on top of the event physical
-- capacity fixture, with the triggers production runs them from.

CREATE OR REPLACE FUNCTION public.normalize_event_pricing_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'extensions', 'pg_temp'
AS $function$
DECLARE
  v_price numeric;
BEGIN
  v_price := COALESCE(NULLIF(NEW.price_per_seat, 0), NULLIF(NEW.price, 0), 0);

  IF v_price > 0 THEN
    NEW.is_free := false;
    IF NEW.payment_mode IS NULL OR NEW.payment_mode = 'free' THEN
      NEW.payment_mode := 'cash_only';
    END IF;
  ELSIF NEW.is_free = true THEN
    NEW.payment_mode := 'free';
  END IF;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.sync_event_ticket_price_v01()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_event_id uuid; v_price numeric; v_has_paid boolean;
BEGIN
  v_event_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.event_id ELSE NEW.event_id END;
  SELECT base_price INTO v_price FROM public.event_ticket_types
  WHERE event_id=v_event_id AND is_active ORDER BY sort_order,created_at,id LIMIT 1;
  IF FOUND THEN
    SELECT EXISTS (SELECT 1 FROM public.event_ticket_types WHERE event_id=v_event_id AND is_active AND base_price>0) INTO v_has_paid;
    UPDATE public.events SET price=v_price,price_per_seat=v_price,is_free=NOT v_has_paid,
      payment_mode=CASE WHEN v_has_paid AND payment_mode='free' THEN 'cash_only' ELSE payment_mode END
    WHERE id=v_event_id AND (price IS DISTINCT FROM v_price OR price_per_seat IS DISTINCT FROM v_price OR is_free IS DISTINCT FROM NOT v_has_paid);
  END IF;
  RETURN NULL;
END $function$;

CREATE OR REPLACE FUNCTION public.event_ticket_type_unit_price(p_base numeric, p_discount_type text, p_discount_value numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  select greatest(0, round(
    p_base - coalesce(
      case
        when p_discount_type = 'percent' then p_base * (coalesce(p_discount_value,0) / 100.0)
        when p_discount_type = 'fixed'   then coalesce(p_discount_value,0)
        else 0
      end, 0)
  , 2));
$function$;

CREATE OR REPLACE FUNCTION public.sync_booking_default_item_v01(p_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_event_id uuid; v_seats integer; v_reminder boolean;
  v_type_id uuid; v_base numeric; v_disc_type text; v_disc_val numeric; v_pmode text; v_deadline timestamptz;
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

  select t.base_price, e.online_discount_type, e.online_discount_value, e.payment_mode, e.online_discount_ends_at
    into v_base, v_disc_type, v_disc_val, v_pmode, v_deadline
  from public.events e join public.event_ticket_types t on t.id = v_type_id where e.id = v_event_id;
  if coalesce(v_pmode, 'free') <> 'prepaid' or v_deadline <= now() then v_disc_type := null; v_disc_val := null; end if;
  v_unit := public.event_ticket_type_unit_price(coalesce(v_base, 0), v_disc_type, v_disc_val);

  insert into public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
  values (p_booking_id, v_type_id, v_seats, v_unit)
  on conflict (booking_id, ticket_type_id)
    do update set quantity = excluded.quantity;
end $function$;

CREATE OR REPLACE FUNCTION public.trg_sync_booking_default_item()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  perform public.sync_booking_default_item_v01(new.id);
  return null;
end $function$;

REVOKE ALL ON FUNCTION public.sync_booking_default_item_v01(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_booking_default_item_v01(uuid) TO service_role;

CREATE TRIGGER trg_normalize_event_pricing_v01 BEFORE INSERT OR UPDATE OF price, price_per_seat, is_free, payment_mode ON public.events FOR EACH ROW EXECUTE FUNCTION normalize_event_pricing_v01();
CREATE TRIGGER sync_event_ticket_price AFTER INSERT OR DELETE OR UPDATE OF base_price, is_active, sort_order ON public.event_ticket_types FOR EACH ROW EXECUTE FUNCTION sync_event_ticket_price_v01();
CREATE TRIGGER booking_sync_default_item AFTER INSERT OR UPDATE OF seats, is_reminder_only ON public.bookings FOR EACH ROW EXECUTE FUNCTION trg_sync_booking_default_item();

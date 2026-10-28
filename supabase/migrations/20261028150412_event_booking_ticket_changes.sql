-- Event booking changes for staff: remove a guest, add a guest, change a ticket type and move a
-- booking to another night, each in one transaction (BK-023 and BK-028, customer bookings review of
-- 24 October 2026; owner decision D7).
--
-- Before this, a paid booking could only be cancelled whole and rebooked. Removing one guest left
-- the door list, the ticket lines and capacity wrong after a manual refund; a move to another night
-- created the new booking unpaid first, which emailed the guest "Complete your payment", lost ticket
-- types (the separate delete and re-insert of ticket lines broke the deferred seat-sum check) and
-- promised any overpayment back by text with nothing to remind staff.
--
-- D7: any staff member who manages events may make these changes; when money is owed back, the
-- amount is chosen by a manager, starting from the price actually paid. So nothing here moves money
-- out. A refund that may be owed is written to the new table event_booking_refund_requests, in the
-- same transaction as the change, and waits there until a manager refunds it or decides no refund.
-- Money taken for added guests at the venue is recorded as a manual seat_increase payment at the
-- full ticket price (owner decision D10: the online discount is for paying online in advance).
--
-- Adds one table and six functions, all service_role only. No existing function, table, view or
-- row is changed. Apply before the code that calls them.
--
-- Live functions these call, read on project tfcasgxopxegwrabvwat on 28 October 2026 and not
-- changed here (md5(prosrc)):
--   create_event_booking_v09(uuid,uuid,integer,text,text,integer,jsonb,jsonb,numeric)  79d436e4874cf6c6c261517a95b4f490
--   get_event_capacity_snapshot_v05(uuid[])                                             b9a2e361f138fbcb5b2c6bdce97eb765
--   get_event_ticket_type_capacity_v01(uuid)                                            3f0030fad90bb0fbdd80ef79abd2c026
--   reallocate_event_communal_booking_v01(uuid,integer)                                 4b469988cbf242861d5e38b7624cf7c9
--   event_booking_table_capacity_ok_v01(uuid,integer)                                   532cff3ea5f002c6c348f2be7ca81962
--   is_booking_live(table_booking_status,timestamptz,timestamptz,payment_status,timestamptz) 6b883d3dd3fe17dd90acd2bbae43bc7d
--   event_ticket_type_unit_price(numeric,text,numeric)                                  60d4c221f5cbf914ab8fabc6b59b09cc
-- Triggers these changes pass through, also unchanged:
--   sync_booking_default_item_v01(uuid) f9bbd300f1758a817beb29bccd90ead7 (skipped with ams.skip_default_item,
--   as create_event_booking_v07 does, while ticket lines are written by hand),
--   guard_booking_attendee_count_v01() b324bf3676016bdf35f701bcc3e94059,
--   sync_booking_attendee_names_v01() a78a8ddd7fc7f3c5be306d20dc5afdd5,
--   check_booking_seat_sum(uuid) ab223e5f7bbcc6c39810347440eb635a (deferred to commit).
-- create_event_booking_v09 reaches create_event_booking_v05, which release 16 patches in place; the
-- transfer calls it and does not restate it, so the two migrations apply in either order.

-- ---------------------------------------------------------------------------------------------
-- Refunds a manager has to decide (D7)
-- ---------------------------------------------------------------------------------------------
CREATE TABLE public.event_booking_refund_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('guest_removed', 'ticket_type_changed', 'transfer_overpayment')),
  amount numeric(10,2) NOT NULL CHECK (amount > 0),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'refunded', 'no_refund')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  raised_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolved_amount numeric(10,2) CHECK (resolved_amount IS NULL OR resolved_amount >= 0),
  resolution_note text,
  CONSTRAINT event_booking_refund_requests_resolved_when_closed CHECK ((status = 'open') = (resolved_at IS NULL))
);

COMMENT ON TABLE public.event_booking_refund_requests IS
  'A refund that may be owed after staff changed an event booking (BK-023, BK-028). amount is the most the change can owe: the price paid for the tickets given up, or the overpayment on a move, never more than the booking holds. A manager decides it (owner decision D7). Ids and amounts only: no guest names.';

CREATE INDEX event_booking_refund_requests_open_idx
  ON public.event_booking_refund_requests (event_booking_id)
  WHERE status = 'open';

ALTER TABLE public.event_booking_refund_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.event_booking_refund_requests FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.event_booking_refund_requests TO service_role;

-- ---------------------------------------------------------------------------------------------
-- What a booking holds: charges taken less refunds. The same sum the refund dialog uses
-- (computeEventBookingRefundable): a fully refunded charge still counts as taken, because its
-- refund row is subtracted once.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_booking_net_paid_v01(p_booking_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(0, round(
    coalesce((SELECT sum(p.amount) FROM public.payments p
              WHERE p.event_booking_id = p_booking_id
                AND p.charge_type IN ('prepaid_event', 'seat_increase')
                AND p.status IN ('succeeded', 'partially_refunded', 'refunded')), 0)
    - coalesce((SELECT sum(p.amount) FROM public.payments p
                WHERE p.event_booking_id = p_booking_id
                  AND p.charge_type = 'refund'
                  AND p.status IN ('succeeded', 'refunded', 'pending')), 0)
  , 2));
$$;

-- What is still free to owe on a booking: what it holds, less the refunds already waiting for a
-- manager, so two changes never promise the same money twice.
CREATE OR REPLACE FUNCTION public.event_booking_refundable_v01(p_booking_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT greatest(0, public.event_booking_net_paid_v01(p_booking_id)
    - coalesce((SELECT sum(r.amount) FROM public.event_booking_refund_requests r
                WHERE r.event_booking_id = p_booking_id AND r.status = 'open'), 0));
$$;

-- ---------------------------------------------------------------------------------------------
-- Remove guests (BK-023 step 1). Named bookings remove the guests chosen; a booking without guest
-- rows removes a number of tickets of one type. The seats, the ticket lines, the guest rows and
-- the table or shared seats all change together. Nothing is refunded: what the removed tickets
-- were sold at is written as a refund request for a manager.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.remove_event_booking_guests_v01(
  p_booking_id uuid,
  p_attendee_ids uuid[],
  p_ticket_type_id uuid,
  p_quantity integer,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_event record;
  v_event_start timestamptz;
  v_default uuid;
  v_named integer;
  v_remove integer;
  v_new_seats integer;
  v_kept jsonb;
  v_removals jsonb;
  v_removal jsonb;
  v_line record;
  v_lines jsonb := '[]'::jsonb;
  v_price numeric := 0;
  v_owed numeric := 0;
  v_request_id uuid;
  v_allocation jsonb;
BEGIN
  -- Event before booking, as booking creation locks them.
  PERFORM 1 FROM public.events e
  WHERE e.id = (SELECT b.event_id FROM public.bookings b WHERE b.id = p_booking_id) FOR UPDATE;

  SELECT b.id, b.event_id, b.customer_id, b.seats, b.status, b.is_reminder_only, b.attendee_names,
         coalesce(b.attendees, '[]'::jsonb) AS attendees
  INTO v_booking
  FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR coalesce(v_booking.is_reminder_only, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;

  SELECT e.id, e.name, e.booking_mode, e.payment_mode, e.start_datetime, e.date, e.time
  INTO v_event FROM public.events e WHERE e.id = v_booking.event_id;
  v_event_start := coalesce(v_event.start_datetime,
    CASE WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
      THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London') END);
  IF v_event_start IS NULL OR v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  SELECT t.id INTO v_default FROM public.event_ticket_types t
  WHERE t.event_id = v_event.id AND t.is_active ORDER BY t.sort_order, t.created_at, t.id LIMIT 1;

  v_named := jsonb_array_length(v_booking.attendees);
  IF v_named > 0 THEN
    IF p_attendee_ids IS NULL OR cardinality(p_attendee_ids) = 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'choose_guests');
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(p_attendee_ids) x) <> cardinality(p_attendee_ids)
       OR EXISTS (SELECT 1 FROM unnest(p_attendee_ids) x
                  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_booking.attendees) a WHERE a->>'id' = x::text)) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'guest_not_on_booking');
    END IF;
    v_remove := cardinality(p_attendee_ids);
    SELECT coalesce(jsonb_agg(a ORDER BY ord), '[]'::jsonb) INTO v_kept
    FROM jsonb_array_elements(v_booking.attendees) WITH ORDINALITY AS t(a, ord)
    WHERE NOT ((a->>'id') = ANY (SELECT x::text FROM unnest(p_attendee_ids) x));
    SELECT coalesce(jsonb_agg(jsonb_build_object('ticket_type_id', type_id, 'quantity', qty)), '[]'::jsonb) INTO v_removals
    FROM (SELECT coalesce(nullif(a->>'ticket_type_id', '')::uuid, v_default) AS type_id, count(*)::integer AS qty
          FROM jsonb_array_elements(v_booking.attendees) a
          WHERE (a->>'id') = ANY (SELECT x::text FROM unnest(p_attendee_ids) x)
          GROUP BY 1) grouped;
  ELSE
    IF p_attendee_ids IS NOT NULL AND cardinality(p_attendee_ids) > 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'guest_not_on_booking');
    END IF;
    IF p_quantity IS NULL OR p_quantity < 1 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_quantity');
    END IF;
    v_remove := p_quantity;
    v_kept := v_booking.attendees;
    v_removals := jsonb_build_array(jsonb_build_object('ticket_type_id', coalesce(p_ticket_type_id, v_default), 'quantity', p_quantity));
  END IF;

  v_new_seats := coalesce(v_booking.seats, 0) - v_remove;
  IF v_new_seats < 1 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'would_remove_every_guest');
  END IF;

  -- Check every line before changing any.
  FOR v_removal IN SELECT value FROM jsonb_array_elements(v_removals) LOOP
    SELECT bi.id, bi.quantity, bi.unit_price INTO v_line
    FROM public.booking_items bi
    WHERE bi.booking_id = v_booking.id AND bi.ticket_type_id = (v_removal->>'ticket_type_id')::uuid
    FOR UPDATE;
    IF NOT FOUND OR v_line.quantity < (v_removal->>'quantity')::integer THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_line_mismatch');
    END IF;
    v_price := v_price + (v_removal->>'quantity')::integer * coalesce(v_line.unit_price, 0);
    v_lines := v_lines || jsonb_build_array(jsonb_build_object(
      'ticket_type_id', v_removal->>'ticket_type_id', 'quantity', (v_removal->>'quantity')::integer, 'unit_price', v_line.unit_price));
  END LOOP;

  PERFORM set_config('ams.skip_default_item', 'on', true);
  FOR v_removal IN SELECT value FROM jsonb_array_elements(v_removals) LOOP
    -- A line that empties is deleted: booking_items.quantity must stay above 0.
    DELETE FROM public.booking_items
    WHERE booking_id = v_booking.id AND ticket_type_id = (v_removal->>'ticket_type_id')::uuid
      AND quantity = (v_removal->>'quantity')::integer;
    IF NOT FOUND THEN
      UPDATE public.booking_items SET quantity = quantity - (v_removal->>'quantity')::integer
      WHERE booking_id = v_booking.id AND ticket_type_id = (v_removal->>'ticket_type_id')::uuid;
    END IF;
  END LOOP;
  UPDATE public.bookings
  SET seats = v_new_seats,
      attendees = v_kept,
      attendee_names = CASE
        WHEN v_named = 0 AND v_booking.attendee_names IS NOT NULL AND cardinality(v_booking.attendee_names) > v_new_seats
          THEN v_booking.attendee_names[1:v_new_seats]
        ELSE attendee_names END,
      updated_at = now()
  WHERE id = v_booking.id;
  PERFORM set_config('ams.skip_default_item', '', true);

  IF coalesce(v_event.booking_mode, 'table') = 'communal' THEN
    v_allocation := public.reallocate_event_communal_booking_v01(v_booking.id, v_new_seats);
    IF coalesce(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION 'communal_reallocation_failed: %', coalesce(v_allocation->>'reason', 'unknown');
    END IF;
  ELSE
    UPDATE public.table_bookings
    SET party_size = v_new_seats, committed_party_size = v_new_seats, updated_at = now()
    WHERE event_booking_id = v_booking.id AND status <> 'cancelled'::public.table_booking_status;
  END IF;

  v_owed := least(round(v_price, 2), public.event_booking_refundable_v01(v_booking.id));
  IF v_owed > 0 THEN
    INSERT INTO public.event_booking_refund_requests (event_booking_id, kind, amount, details, raised_by)
    VALUES (v_booking.id, 'guest_removed', v_owed, jsonb_build_object(
      'removed_attendee_ids', coalesce(to_jsonb(p_attendee_ids), '[]'::jsonb),
      'lines', v_lines,
      'price_paid', round(v_price, 2),
      'seats_before', v_booking.seats,
      'seats_after', v_new_seats), p_performed_by)
    RETURNING id INTO v_request_id;
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'payment_mode', coalesce(v_event.payment_mode, 'free'),
    'old_seats', v_booking.seats,
    'new_seats', v_new_seats,
    'removed', v_remove,
    'price_paid', round(v_price, 2),
    'refund_owed', v_owed,
    'refund_request_id', v_request_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Build guest rows for tickets staff add (the staff rules of create_event_booking_v09: a name or a
-- required answer may follow, a phone must be E.164, answers must match the event's questions).
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.event_booking_staff_guest_rows_v01(
  p_event_id uuid,
  p_ticket_type_id uuid,
  p_attendees jsonb,
  p_taken_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_questions jsonb;
  v_attendee jsonb;
  v_question jsonb;
  v_value text;
  v_answers jsonb;
  v_saved jsonb := '[]'::jsonb;
  v_ids uuid[] := coalesce(p_taken_ids, '{}');
  v_id uuid;
  v_name text;
  v_phone text;
BEGIN
  SELECT coalesce(e.booking_questions, '[]'::jsonb) INTO v_questions FROM public.events e WHERE e.id = p_event_id;
  IF jsonb_typeof(coalesce(p_attendees, '[]'::jsonb)) <> 'array' THEN RAISE EXCEPTION 'invalid_attendees'; END IF;
  FOR v_attendee IN SELECT value FROM jsonb_array_elements(coalesce(p_attendees, '[]'::jsonb)) LOOP
    v_id := nullif(v_attendee->>'id', '')::uuid;
    IF v_id IS NULL OR v_id = ANY (v_ids) THEN RAISE EXCEPTION 'invalid_attendee_id'; END IF;
    v_ids := array_append(v_ids, v_id);
    v_name := trim(coalesce(v_attendee->>'name', ''));
    IF length(v_name) > 120 THEN RAISE EXCEPTION 'attendee_name_required'; END IF;
    v_phone := nullif(trim(coalesce(v_attendee->>'phone', '')), '');
    IF v_phone IS NOT NULL AND v_phone !~ '^\+[1-9][0-9]{7,14}$' THEN RAISE EXCEPTION 'invalid_attendee_phone'; END IF;
    IF nullif(v_attendee->>'ticket_type_id', '') IS NOT NULL AND (v_attendee->>'ticket_type_id')::uuid <> p_ticket_type_id THEN
      RAISE EXCEPTION 'invalid_attendee_ticket_type';
    END IF;
    IF jsonb_typeof(coalesce(v_attendee->'answers', '{}'::jsonb)) <> 'object' THEN RAISE EXCEPTION 'invalid_attendee_answers'; END IF;
    IF EXISTS (SELECT 1 FROM jsonb_object_keys(coalesce(v_attendee->'answers', '{}'::jsonb)) k
               WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_questions) q WHERE q->>'id' = k)) THEN
      RAISE EXCEPTION 'unknown_attendee_question';
    END IF;
    v_answers := '[]'::jsonb;
    FOR v_question IN SELECT value FROM jsonb_array_elements(v_questions) LOOP
      v_value := trim(coalesce(v_attendee->'answers'->>(v_question->>'id'), ''));
      IF length(v_value) > 2000 THEN RAISE EXCEPTION 'attendee_answer_too_long'; END IF;
      IF v_value <> '' AND v_question->>'type' = 'yes_no' AND v_value NOT IN ('yes', 'no') THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
      IF v_value <> '' AND v_question->>'type' = 'choice' AND NOT coalesce((v_question->'options') ? v_value, false) THEN RAISE EXCEPTION 'invalid_attendee_answer'; END IF;
      v_answers := v_answers || jsonb_build_array(jsonb_build_object(
        'question_id', v_question->>'id', 'label', v_question->>'label', 'type', v_question->>'type',
        'required', coalesce((v_question->>'required')::boolean, false),
        'options', coalesce(v_question->'options', '[]'::jsonb), 'value', v_value));
    END LOOP;
    v_saved := v_saved || jsonb_build_array(
      jsonb_build_object('id', v_id, 'name', v_name, 'ticket_type_id', p_ticket_type_id, 'answers', v_answers)
      || CASE WHEN v_phone IS NOT NULL THEN jsonb_build_object('phone', v_phone) ELSE '{}'::jsonb END);
  END LOOP;
  RETURN v_saved;
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Add guests (BK-023 step 2). Checks capacity as a staff seat increase does, adds the seats, the
-- ticket line and the guest rows, and moves the table or shared seats. On a prepaid event the new
-- tickets are paid now at the venue (cash or card, at the full ticket price, D10) or given free
-- with a reason, and recorded as a manual seat_increase payment. A pay-at-the-door or free event
-- takes no payment here.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.add_event_booking_guests_v01(
  p_booking_id uuid,
  p_ticket_type_id uuid,
  p_quantity integer,
  p_attendees jsonb,
  p_settlement text,
  p_note text,
  p_expected_amount numeric,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_event record;
  v_event_start timestamptz;
  v_type record;
  v_named integer;
  v_new_seats integer;
  v_snapshot record;
  v_type_remaining integer;
  v_unit numeric(10,2);
  v_amount numeric(10,2) := 0;
  v_rows jsonb := '[]'::jsonb;
  v_taken uuid[];
  v_allocation jsonb;
  v_payment_id uuid;
  v_settlement text := coalesce(nullif(trim(p_settlement), ''), 'none');
BEGIN
  PERFORM 1 FROM public.events e
  WHERE e.id = (SELECT b.event_id FROM public.bookings b WHERE b.id = p_booking_id) FOR UPDATE;

  SELECT b.id, b.event_id, b.customer_id, b.seats, b.status, b.is_reminder_only, b.event_seating_type,
         coalesce(b.attendees, '[]'::jsonb) AS attendees
  INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR coalesce(v_booking.is_reminder_only, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;
  IF p_quantity IS NULL OR p_quantity < 1 OR p_quantity > 20 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_quantity');
  END IF;

  SELECT e.id, e.name, e.capacity, e.booking_mode, e.payment_mode, e.start_datetime, e.date, e.time
  INTO v_event FROM public.events e WHERE e.id = v_booking.event_id;
  v_event_start := coalesce(v_event.start_datetime,
    CASE WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
      THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London') END);
  IF v_event_start IS NULL OR v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  SELECT t.id, t.base_price, t.capacity INTO v_type FROM public.event_ticket_types t
  WHERE t.event_id = v_event.id AND t.is_active
    AND (t.id = p_ticket_type_id OR (p_ticket_type_id IS NULL))
  ORDER BY (t.id = p_ticket_type_id) DESC NULLS LAST, t.sort_order, t.created_at, t.id LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_ticket_type'); END IF;

  -- How the new tickets are settled.
  IF coalesce(v_event.payment_mode, 'free') = 'prepaid' THEN
    IF v_settlement NOT IN ('cash', 'card_terminal', 'comp') THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'settlement_required');
    END IF;
    IF v_settlement = 'comp' AND length(trim(coalesce(p_note, ''))) < 1 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'comp_reason_required');
    END IF;
  ELSIF v_settlement <> 'none' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_payment_taken_here');
  END IF;

  -- D10: paying at the venue is the full price; the online discount is for paying online.
  v_unit := public.event_ticket_type_unit_price(coalesce(v_type.base_price, 0), NULL, NULL);
  IF v_settlement IN ('cash', 'card_terminal') THEN
    v_amount := round(v_unit * p_quantity, 2);
    IF p_expected_amount IS NULL OR round(p_expected_amount, 2) <> v_amount THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'amount_changed', 'amount', v_amount);
    END IF;
  END IF;

  v_named := jsonb_array_length(v_booking.attendees);
  IF v_named > 0 THEN
    IF jsonb_array_length(coalesce(p_attendees, '[]'::jsonb)) <> p_quantity THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'guest_details_needed');
    END IF;
    SELECT coalesce(array_agg((a->>'id')::uuid), '{}') INTO v_taken FROM jsonb_array_elements(v_booking.attendees) a;
    v_rows := public.event_booking_staff_guest_rows_v01(v_event.id, v_type.id, p_attendees, v_taken);
  ELSIF jsonb_array_length(coalesce(p_attendees, '[]'::jsonb)) > 0 THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_has_no_guest_rows');
  END IF;

  -- Capacity, as a staff seat increase (update_event_booking_seats_staff_v05) checks it.
  SELECT * INTO v_snapshot FROM public.get_event_capacity_snapshot_v05(ARRAY[v_event.id]::uuid[]) LIMIT 1;
  IF coalesce(v_event.booking_mode, 'table') = 'communal' THEN
    IF coalesce(v_snapshot.total_remaining, 0) < p_quantity THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', coalesce(v_snapshot.total_remaining, 0));
    END IF;
    IF v_booking.event_seating_type = 'standing' AND coalesce(v_snapshot.standing_remaining, 0) < p_quantity THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_standing_capacity', 'standing_remaining', coalesce(v_snapshot.standing_remaining, 0));
    END IF;
    IF v_booking.event_seating_type IS DISTINCT FROM 'standing' AND coalesce(v_snapshot.seated_remaining, 0) < p_quantity THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_seated_capacity', 'seated_remaining', coalesce(v_snapshot.seated_remaining, 0));
    END IF;
  ELSIF coalesce(v_event.booking_mode, 'table') IN ('table', 'mixed') THEN
    v_new_seats := coalesce(v_booking.seats, 0) + p_quantity;
    IF NOT EXISTS (
      SELECT 1 FROM public.table_bookings tb
      JOIN public.booking_table_assignments a ON a.table_booking_id = tb.id
      WHERE tb.event_booking_id = v_booking.id
        AND public.is_booking_live(tb.status, tb.left_at, tb.hold_expires_at, tb.payment_status)
    ) OR NOT public.event_booking_table_capacity_ok_v01(v_booking.id, v_new_seats) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'table_capacity_insufficient');
    END IF;
  ELSIF v_event.capacity IS NOT NULL
     AND (v_snapshot.seats_remaining IS NULL OR v_snapshot.seats_remaining < p_quantity) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'insufficient_capacity', 'seats_remaining', coalesce(v_snapshot.seats_remaining, 0));
  END IF;
  IF v_type.capacity IS NOT NULL THEN
    SELECT c.remaining INTO v_type_remaining FROM public.get_event_ticket_type_capacity_v01(v_event.id) c WHERE c.ticket_type_id = v_type.id;
    IF coalesce(v_type_remaining, 0) < p_quantity THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_type_sold_out', 'remaining', coalesce(v_type_remaining, 0));
    END IF;
  END IF;

  v_new_seats := coalesce(v_booking.seats, 0) + p_quantity;
  PERFORM set_config('ams.skip_default_item', 'on', true);
  UPDATE public.booking_items SET quantity = quantity + p_quantity
  WHERE booking_id = v_booking.id AND ticket_type_id = v_type.id;
  IF NOT FOUND THEN
    INSERT INTO public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
    VALUES (v_booking.id, v_type.id, p_quantity, CASE WHEN v_settlement = 'comp' THEN 0 ELSE v_unit END);
  END IF;
  UPDATE public.bookings
  SET seats = v_new_seats,
      attendees = CASE WHEN v_named > 0 THEN v_booking.attendees || v_rows ELSE attendees END,
      updated_at = now()
  WHERE id = v_booking.id;
  PERFORM set_config('ams.skip_default_item', '', true);

  IF coalesce(v_event.booking_mode, 'table') = 'communal' THEN
    v_allocation := public.reallocate_event_communal_booking_v01(v_booking.id, v_new_seats);
    IF coalesce(v_allocation->>'state', 'blocked') <> 'confirmed' THEN
      RAISE EXCEPTION USING ERRCODE = 'P2003', MESSAGE = coalesce(v_allocation->>'reason', 'insufficient_seated_capacity');
    END IF;
  ELSE
    UPDATE public.table_bookings
    SET party_size = v_new_seats, committed_party_size = v_new_seats, updated_at = now()
    WHERE event_booking_id = v_booking.id AND status <> 'cancelled'::public.table_booking_status;
  END IF;

  IF v_settlement IN ('cash', 'card_terminal', 'comp') THEN
    INSERT INTO public.payments (event_booking_id, charge_type, payment_provider, payment_method, amount, currency, status, metadata)
    VALUES (v_booking.id, 'seat_increase', 'manual', v_settlement, v_amount, 'GBP', 'succeeded', jsonb_build_object(
      'source', 'staff_add_guests',
      'ticket_type_id', v_type.id,
      'quantity', p_quantity,
      'unit_price', CASE WHEN v_settlement = 'comp' THEN 0 ELSE v_unit END,
      'added_attendee_ids', coalesce((SELECT jsonb_agg(r->'id') FROM jsonb_array_elements(v_rows) r), '[]'::jsonb),
      'recorded_by', p_performed_by,
      'note', nullif(trim(coalesce(p_note, '')), '')))
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'event_start_datetime', v_event_start,
    'payment_mode', coalesce(v_event.payment_mode, 'free'),
    'old_seats', v_booking.seats,
    'new_seats', v_new_seats,
    'added', p_quantity,
    'amount', v_amount,
    'settlement', v_settlement,
    'payment_id', v_payment_id);
EXCEPTION WHEN SQLSTATE 'P2003' THEN
  RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Change ticket type (BK-023 step 3). Moves tickets from one type to another. The new tickets are
-- priced as the booking's own were (the online price on a prepaid event while its discount runs,
-- D10). A dearer type is paid now at the venue or given free with a reason; a cheaper one writes
-- the difference as a refund request for a manager.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_event_booking_ticket_type_v01(
  p_booking_id uuid,
  p_attendee_ids uuid[],
  p_from_ticket_type_id uuid,
  p_quantity integer,
  p_to_ticket_type_id uuid,
  p_settlement text,
  p_note text,
  p_expected_amount numeric,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_event record;
  v_event_start timestamptz;
  v_default uuid;
  v_to record;
  v_named integer;
  v_moves jsonb;
  v_move jsonb;
  v_line record;
  v_count integer := 0;
  v_paid_for_old numeric := 0;
  v_to_unit numeric(10,2);
  v_disc_type text;
  v_disc_val numeric;
  v_difference numeric;
  v_type_remaining integer;
  v_settlement text := coalesce(nullif(trim(p_settlement), ''), 'none');
  v_amount numeric(10,2) := 0;
  v_owed numeric := 0;
  v_payment_id uuid;
  v_request_id uuid;
BEGIN
  PERFORM 1 FROM public.events e
  WHERE e.id = (SELECT b.event_id FROM public.bookings b WHERE b.id = p_booking_id) FOR UPDATE;

  SELECT b.id, b.event_id, b.customer_id, b.seats, b.status, b.is_reminder_only,
         coalesce(b.attendees, '[]'::jsonb) AS attendees
  INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR coalesce(v_booking.is_reminder_only, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'status_not_changeable');
  END IF;

  SELECT e.id, e.name, e.payment_mode, e.start_datetime, e.date, e.time,
         e.online_discount_type, e.online_discount_value, e.online_discount_ends_at
  INTO v_event FROM public.events e WHERE e.id = v_booking.event_id;
  v_event_start := coalesce(v_event.start_datetime,
    CASE WHEN v_event.date IS NOT NULL AND v_event.time IS NOT NULL
      THEN ((v_event.date::text || ' ' || v_event.time::text)::timestamp AT TIME ZONE 'Europe/London') END);
  IF v_event_start IS NULL OR v_event_start <= now() THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'event_started');
  END IF;

  SELECT t.id INTO v_default FROM public.event_ticket_types t
  WHERE t.event_id = v_event.id AND t.is_active ORDER BY t.sort_order, t.created_at, t.id LIMIT 1;
  SELECT t.id, t.base_price, t.capacity INTO v_to FROM public.event_ticket_types t
  WHERE t.id = p_to_ticket_type_id AND t.event_id = v_event.id AND t.is_active;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_ticket_type'); END IF;

  v_named := jsonb_array_length(v_booking.attendees);
  IF v_named > 0 THEN
    IF p_attendee_ids IS NULL OR cardinality(p_attendee_ids) = 0 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'choose_guests');
    END IF;
    IF (SELECT count(DISTINCT x) FROM unnest(p_attendee_ids) x) <> cardinality(p_attendee_ids)
       OR EXISTS (SELECT 1 FROM unnest(p_attendee_ids) x
                  WHERE NOT EXISTS (SELECT 1 FROM jsonb_array_elements(v_booking.attendees) a WHERE a->>'id' = x::text)) THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'guest_not_on_booking');
    END IF;
    SELECT coalesce(jsonb_agg(jsonb_build_object('ticket_type_id', type_id, 'quantity', qty)), '[]'::jsonb) INTO v_moves
    FROM (SELECT coalesce(nullif(a->>'ticket_type_id', '')::uuid, v_default) AS type_id, count(*)::integer AS qty
          FROM jsonb_array_elements(v_booking.attendees) a
          WHERE (a->>'id') = ANY (SELECT x::text FROM unnest(p_attendee_ids) x)
          GROUP BY 1) grouped;
  ELSE
    IF p_quantity IS NULL OR p_quantity < 1 OR p_from_ticket_type_id IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_quantity');
    END IF;
    v_moves := jsonb_build_array(jsonb_build_object('ticket_type_id', p_from_ticket_type_id, 'quantity', p_quantity));
  END IF;

  IF EXISTS (SELECT 1 FROM jsonb_array_elements(v_moves) m WHERE (m->>'ticket_type_id')::uuid = v_to.id) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'same_ticket_type');
  END IF;

  FOR v_move IN SELECT value FROM jsonb_array_elements(v_moves) LOOP
    SELECT bi.quantity, bi.unit_price INTO v_line FROM public.booking_items bi
    WHERE bi.booking_id = v_booking.id AND bi.ticket_type_id = (v_move->>'ticket_type_id')::uuid FOR UPDATE;
    IF NOT FOUND OR v_line.quantity < (v_move->>'quantity')::integer THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_line_mismatch');
    END IF;
    v_count := v_count + (v_move->>'quantity')::integer;
    v_paid_for_old := v_paid_for_old + (v_move->>'quantity')::integer * coalesce(v_line.unit_price, 0);
  END LOOP;

  IF v_to.capacity IS NOT NULL THEN
    SELECT c.remaining INTO v_type_remaining FROM public.get_event_ticket_type_capacity_v01(v_event.id) c WHERE c.ticket_type_id = v_to.id;
    IF coalesce(v_type_remaining, 0) < v_count THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_type_sold_out', 'remaining', coalesce(v_type_remaining, 0));
    END IF;
  END IF;

  -- The new type at the price the booking's own tickets were sold on.
  v_disc_type := v_event.online_discount_type;
  v_disc_val := v_event.online_discount_value;
  IF coalesce(v_event.payment_mode, 'free') <> 'prepaid' OR v_event.online_discount_ends_at <= now() THEN
    v_disc_type := NULL; v_disc_val := NULL;
  END IF;
  v_to_unit := public.event_ticket_type_unit_price(coalesce(v_to.base_price, 0), v_disc_type, v_disc_val);
  v_difference := round(v_to_unit * v_count - v_paid_for_old, 2);

  IF v_difference > 0 AND coalesce(v_event.payment_mode, 'free') = 'prepaid' THEN
    IF v_settlement NOT IN ('cash', 'card_terminal', 'comp') THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'settlement_required', 'amount', v_difference);
    END IF;
    IF v_settlement = 'comp' AND length(trim(coalesce(p_note, ''))) < 1 THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'comp_reason_required');
    END IF;
    IF v_settlement IN ('cash', 'card_terminal') THEN
      v_amount := v_difference;
      IF p_expected_amount IS NULL OR round(p_expected_amount, 2) <> v_amount THEN
        RETURN jsonb_build_object('state', 'blocked', 'reason', 'amount_changed', 'amount', v_amount);
      END IF;
    END IF;
  ELSIF v_settlement <> 'none' THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'no_payment_taken_here', 'amount', greatest(v_difference, 0));
  END IF;

  PERFORM set_config('ams.skip_default_item', 'on', true);
  FOR v_move IN SELECT value FROM jsonb_array_elements(v_moves) LOOP
    -- A line that empties is deleted: booking_items.quantity must stay above 0.
    DELETE FROM public.booking_items
    WHERE booking_id = v_booking.id AND ticket_type_id = (v_move->>'ticket_type_id')::uuid
      AND quantity = (v_move->>'quantity')::integer;
    IF NOT FOUND THEN
      UPDATE public.booking_items SET quantity = quantity - (v_move->>'quantity')::integer
      WHERE booking_id = v_booking.id AND ticket_type_id = (v_move->>'ticket_type_id')::uuid;
    END IF;
  END LOOP;
  UPDATE public.booking_items SET quantity = quantity + v_count
  WHERE booking_id = v_booking.id AND ticket_type_id = v_to.id;
  IF NOT FOUND THEN
    INSERT INTO public.booking_items (booking_id, ticket_type_id, quantity, unit_price)
    VALUES (v_booking.id, v_to.id, v_count, v_to_unit);
  END IF;
  IF v_named > 0 THEN
    UPDATE public.bookings
    SET attendees = (SELECT jsonb_agg(CASE WHEN (a->>'id') = ANY (SELECT x::text FROM unnest(p_attendee_ids) x)
                                          THEN a || jsonb_build_object('ticket_type_id', v_to.id) ELSE a END ORDER BY ord)
                     FROM jsonb_array_elements(v_booking.attendees) WITH ORDINALITY AS t(a, ord)),
        updated_at = now()
    WHERE id = v_booking.id;
  ELSE
    UPDATE public.bookings SET updated_at = now() WHERE id = v_booking.id;
  END IF;
  PERFORM set_config('ams.skip_default_item', '', true);

  IF v_settlement IN ('cash', 'card_terminal', 'comp') THEN
    INSERT INTO public.payments (event_booking_id, charge_type, payment_provider, payment_method, amount, currency, status, metadata)
    VALUES (v_booking.id, 'seat_increase', 'manual', v_settlement, v_amount, 'GBP', 'succeeded', jsonb_build_object(
      'source', 'staff_ticket_type_change',
      'from', v_moves,
      'to_ticket_type_id', v_to.id,
      'quantity', v_count,
      'difference', v_difference,
      'recorded_by', p_performed_by,
      'note', nullif(trim(coalesce(p_note, '')), '')))
    RETURNING id INTO v_payment_id;
  END IF;

  IF v_difference < 0 THEN
    v_owed := least(-v_difference, public.event_booking_refundable_v01(v_booking.id));
    IF v_owed > 0 THEN
      INSERT INTO public.event_booking_refund_requests (event_booking_id, kind, amount, details, raised_by)
      VALUES (v_booking.id, 'ticket_type_changed', v_owed, jsonb_build_object(
        'changed_attendee_ids', coalesce(to_jsonb(p_attendee_ids), '[]'::jsonb),
        'from', v_moves, 'to_ticket_type_id', v_to.id, 'quantity', v_count,
        'price_paid', round(v_paid_for_old, 2), 'new_price', round(v_to_unit * v_count, 2)), p_performed_by)
      RETURNING id INTO v_request_id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'state', 'updated',
    'booking_id', v_booking.id,
    'customer_id', v_booking.customer_id,
    'event_id', v_event.id,
    'event_name', v_event.name,
    'changed', v_count,
    'price_paid', round(v_paid_for_old, 2),
    'new_price', round(v_to_unit * v_count, 2),
    'difference', v_difference,
    'amount', v_amount,
    'settlement', v_settlement,
    'payment_id', v_payment_id,
    'refund_owed', v_owed,
    'refund_request_id', v_request_id);
END;
$$;

-- ---------------------------------------------------------------------------------------------
-- Move a booking to another night (BK-028). One transaction: the replacement is created through
-- create_event_booking_v09 (capacity, tables, shared seats and ticket types as any staff booking)
-- and confirmed at once, with no payment hold and so no payment-link email; the ticket lines map to
-- the new night's ticket types by name (else its first ticket type) and the guests travel with
-- their names and phones, answering the new night's questions from p_answers
-- ({guest id: {question id: answer}}; a required answer may follow, as on any staff booking). The
-- payments, refunds and open refund requests move to the replacement, the original is cancelled
-- with its table and holds, and the move is recorded. A move to a dearer night is refused; any
-- overpayment, net of refunds, is written as a refund request for a manager.
-- ---------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.transfer_event_booking_v01(
  p_booking_id uuid,
  p_target_event_id uuid,
  p_answers jsonb,
  p_performed_by uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_booking record;
  v_target record;
  v_target_default uuid;
  v_source_default uuid;
  v_map jsonb := '{}'::jsonb;
  v_line record;
  v_selections jsonb;
  v_attendees jsonb := '[]'::jsonb;
  v_attendee jsonb;
  v_type_id uuid;
  v_answers jsonb;
  v_result jsonb;
  v_new_id uuid;
  v_paid numeric;
  v_open_requests numeric;
  v_target_total numeric;
  v_chargeable numeric;
  v_overpayment numeric := 0;
  v_request_id uuid;
  v_transfer_id uuid;
  v_missing integer := 0;
BEGIN
  IF p_booking_id IS NULL OR p_target_event_id IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'invalid_request');
  END IF;

  -- Both nights, in id order, then the booking.
  PERFORM 1 FROM public.events e
  WHERE e.id IN ((SELECT b.event_id FROM public.bookings b WHERE b.id = p_booking_id), p_target_event_id)
  ORDER BY e.id FOR UPDATE;

  SELECT b.id, b.event_id, b.customer_id, b.seats, b.status, b.is_reminder_only, b.event_seating_type,
         b.contact_email, coalesce(b.attendees, '[]'::jsonb) AS attendees
  INTO v_booking FROM public.bookings b WHERE b.id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_found'); END IF;
  IF v_booking.status <> 'confirmed' OR coalesce(v_booking.is_reminder_only, false) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'booking_not_confirmed');
  END IF;
  IF v_booking.event_id = p_target_event_id THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'same_event');
  END IF;
  IF EXISTS (SELECT 1 FROM public.event_ticket_transfers t
             WHERE t.original_booking_id = v_booking.id AND t.status IN ('pending', 'completed')) THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'transfer_already_used');
  END IF;

  SELECT e.id, e.name, e.payment_mode, e.event_status, coalesce(e.booking_questions, '[]'::jsonb) AS questions
  INTO v_target FROM public.events e WHERE e.id = p_target_event_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('state', 'blocked', 'reason', 'target_event_not_found'); END IF;
  IF coalesce(v_target.event_status, 'scheduled') IN ('cancelled', 'draft') THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'target_event_not_bookable');
  END IF;

  SELECT t.id INTO v_target_default FROM public.event_ticket_types t
  WHERE t.event_id = v_target.id AND t.is_active ORDER BY t.sort_order, t.created_at, t.id LIMIT 1;
  IF v_target_default IS NULL THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'target_has_no_tickets');
  END IF;
  SELECT t.id INTO v_source_default FROM public.event_ticket_types t
  WHERE t.event_id = v_booking.event_id AND t.is_active ORDER BY t.sort_order, t.created_at, t.id LIMIT 1;

  -- Each ticket line's type on the new night: the same name, else the new night's first type.
  FOR v_line IN
    SELECT bi.ticket_type_id, bi.quantity, t.name FROM public.booking_items bi
    LEFT JOIN public.event_ticket_types t ON t.id = bi.ticket_type_id
    WHERE bi.booking_id = v_booking.id
  LOOP
    SELECT coalesce((SELECT tt.id FROM public.event_ticket_types tt
                     WHERE tt.event_id = v_target.id AND tt.is_active
                       AND lower(trim(coalesce(tt.name, ''))) = lower(trim(coalesce(v_line.name, '')))
                       AND trim(coalesce(v_line.name, '')) <> ''
                     ORDER BY tt.sort_order, tt.created_at, tt.id LIMIT 1), v_target_default)
    INTO v_type_id;
    v_map := v_map || jsonb_build_object(v_line.ticket_type_id::text, v_type_id);
  END LOOP;

  SELECT jsonb_agg(jsonb_build_object('ticket_type_id', type_id, 'quantity', qty)) INTO v_selections
  FROM (SELECT (v_map->>(bi.ticket_type_id::text))::uuid AS type_id, sum(bi.quantity)::integer AS qty
        FROM public.booking_items bi WHERE bi.booking_id = v_booking.id GROUP BY 1) grouped;
  IF v_selections IS NULL OR (SELECT sum((s->>'quantity')::integer) FROM jsonb_array_elements(v_selections) s) <> v_booking.seats THEN
    RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_line_mismatch');
  END IF;

  -- The guests, with the new night's questions.
  FOR v_attendee IN SELECT value FROM jsonb_array_elements(v_booking.attendees) LOOP
    v_type_id := (v_map->>(coalesce(nullif(v_attendee->>'ticket_type_id', ''), v_source_default::text)))::uuid;
    IF v_type_id IS NULL THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'ticket_line_mismatch');
    END IF;
    SELECT coalesce(jsonb_object_agg(k, v), '{}'::jsonb) INTO v_answers
    FROM jsonb_each_text(coalesce(p_answers->(v_attendee->>'id'), '{}'::jsonb)) AS a(k, v)
    WHERE EXISTS (SELECT 1 FROM jsonb_array_elements(v_target.questions) q WHERE q->>'id' = a.k);
    SELECT v_missing + count(*) INTO v_missing FROM jsonb_array_elements(v_target.questions) q
    WHERE coalesce((q->>'required')::boolean, false) AND trim(coalesce(v_answers->>(q->>'id'), '')) = '';
    v_attendees := v_attendees || jsonb_build_array(
      jsonb_build_object('id', v_attendee->>'id', 'name', coalesce(v_attendee->>'name', ''), 'ticket_type_id', v_type_id, 'answers', v_answers)
      || CASE WHEN nullif(v_attendee->>'phone', '') IS NOT NULL THEN jsonb_build_object('phone', v_attendee->>'phone') ELSE '{}'::jsonb END
      || CASE WHEN v_attendee ? 'details_confirmed_at' THEN jsonb_build_object('details_confirmed', true) ELSE '{}'::jsonb END);
  END LOOP;

  v_paid := public.event_booking_net_paid_v01(v_booking.id);
  SELECT coalesce(sum(r.amount), 0) INTO v_open_requests FROM public.event_booking_refund_requests r
  WHERE r.event_booking_id = v_booking.id AND r.status = 'open';

  BEGIN
    v_result := public.create_event_booking_v09(
      v_target.id, v_booking.customer_id, v_booking.seats, 'admin',
      CASE WHEN v_booking.event_seating_type = 'standing' THEN 'standing' ELSE 'seated' END,
      NULL, v_selections, v_attendees, NULL);
    IF coalesce(v_result->>'state', '') NOT IN ('confirmed', 'pending_payment') THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', coalesce(v_result->>'reason', 'target_event_unavailable'));
    END IF;
    v_new_id := (v_result->>'booking_id')::uuid;

    -- Already paid for: confirmed now, with no payment hold.
    UPDATE public.bookings
    SET status = 'confirmed', hold_expires_at = NULL, contact_email = v_booking.contact_email, updated_at = now()
    WHERE id = v_new_id;
    UPDATE public.booking_holds SET status = 'consumed', consumed_at = now(), updated_at = now()
    WHERE event_booking_id = v_new_id AND hold_type = 'payment_hold' AND status = 'active';
    UPDATE public.table_bookings
    SET status = 'confirmed', hold_expires_at = NULL, confirmed_at = coalesce(confirmed_at, now()), updated_at = now()
    WHERE event_booking_id = v_new_id AND status = 'pending_payment';

    SELECT coalesce(sum(bi.quantity * bi.unit_price), 0) INTO v_target_total FROM public.booking_items bi WHERE bi.booking_id = v_new_id;
    v_chargeable := CASE WHEN coalesce(v_target.payment_mode, 'free') = 'prepaid' THEN v_target_total ELSE 0 END;
    IF v_chargeable > v_paid + 0.004 THEN
      RAISE EXCEPTION USING ERRCODE = 'P2004', MESSAGE = 'target_event_costs_more';
    END IF;
    v_overpayment := greatest(0, round(v_paid - v_open_requests - v_chargeable, 2));

    UPDATE public.payments SET event_booking_id = v_new_id, updated_at = now()
    WHERE event_booking_id = v_booking.id AND charge_type IN ('prepaid_event', 'seat_increase', 'refund');
    UPDATE public.event_booking_refund_requests SET event_booking_id = v_new_id
    WHERE event_booking_id = v_booking.id AND status = 'open';

    UPDATE public.bookings
    SET status = 'cancelled', cancelled_at = now(), cancelled_by = 'admin_transfer', updated_at = now()
    WHERE id = v_booking.id;
    UPDATE public.booking_holds SET status = 'released', released_at = now(), updated_at = now()
    WHERE event_booking_id = v_booking.id AND status = 'active';
    UPDATE public.table_bookings
    SET status = 'cancelled'::public.table_booking_status, cancellation_reason = 'event_booking_transferred',
        cancelled_at = now(), hold_expires_at = NULL, updated_at = now()
    WHERE event_booking_id = v_booking.id AND status <> 'cancelled'::public.table_booking_status;

    INSERT INTO public.event_ticket_transfers (original_booking_id, new_booking_id, from_event_id, to_event_id, status, requested_by, approved_by, metadata, completed_at)
    VALUES (v_booking.id, v_new_id, v_booking.event_id, v_target.id, 'completed', 'staff', p_performed_by, jsonb_build_object(
      'seats', v_booking.seats, 'paid_total', v_paid, 'target_amount', v_target_total, 'overpayment', v_overpayment,
      'ticket_lines', v_selections, 'guests_carried', jsonb_array_length(v_attendees), 'answers_to_follow', v_missing), now())
    RETURNING id INTO v_transfer_id;

    IF v_overpayment > 0 THEN
      INSERT INTO public.event_booking_refund_requests (event_booking_id, kind, amount, details, raised_by)
      VALUES (v_new_id, 'transfer_overpayment', v_overpayment, jsonb_build_object(
        'original_booking_id', v_booking.id, 'from_event_id', v_booking.event_id, 'to_event_id', v_target.id,
        'transfer_id', v_transfer_id, 'paid_total', v_paid, 'target_amount', v_target_total), p_performed_by)
      RETURNING id INTO v_request_id;
    END IF;
  EXCEPTION
    WHEN SQLSTATE 'P2004' THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', 'target_event_costs_more', 'paid_total', v_paid);
    WHEN raise_exception THEN
      RETURN jsonb_build_object('state', 'blocked', 'reason', SQLERRM);
  END;

  RETURN jsonb_build_object(
    'state', 'transferred',
    'original_booking_id', v_booking.id,
    'new_booking_id', v_new_id,
    'transfer_id', v_transfer_id,
    'from_event_id', v_booking.event_id,
    'to_event_id', v_target.id,
    'seats', v_booking.seats,
    'paid_total', v_paid,
    'target_amount', v_target_total,
    'overpayment', v_overpayment,
    'refund_request_id', v_request_id,
    'answers_to_follow', v_missing,
    'table_booking_id', v_result->>'table_booking_id');
END;
$$;

-- Server-only, like every booking function since 20261026212313.
REVOKE ALL ON FUNCTION public.event_booking_net_paid_v01(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_booking_refundable_v01(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.remove_event_booking_guests_v01(uuid, uuid[], uuid, integer, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.event_booking_staff_guest_rows_v01(uuid, uuid, jsonb, uuid[]) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.add_event_booking_guests_v01(uuid, uuid, integer, jsonb, text, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.change_event_booking_ticket_type_v01(uuid, uuid[], uuid, integer, uuid, text, text, numeric, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.transfer_event_booking_v01(uuid, uuid, jsonb, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.event_booking_net_paid_v01(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_booking_refundable_v01(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.remove_event_booking_guests_v01(uuid, uuid[], uuid, integer, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.event_booking_staff_guest_rows_v01(uuid, uuid, jsonb, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.add_event_booking_guests_v01(uuid, uuid, integer, jsonb, text, text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.change_event_booking_ticket_type_v01(uuid, uuid[], uuid, integer, uuid, text, text, numeric, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.transfer_event_booking_v01(uuid, uuid, jsonb, uuid) TO service_role;

-- Prove it: none of the new functions or the new table is reachable with the browser keys.
DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.event_booking_net_paid_v01(uuid)',
    'public.event_booking_refundable_v01(uuid)',
    'public.remove_event_booking_guests_v01(uuid,uuid[],uuid,integer,uuid)',
    'public.event_booking_staff_guest_rows_v01(uuid,uuid,jsonb,uuid[])',
    'public.add_event_booking_guests_v01(uuid,uuid,integer,jsonb,text,text,numeric,uuid)',
    'public.change_event_booking_ticket_type_v01(uuid,uuid[],uuid,integer,uuid,text,text,numeric,uuid)',
    'public.transfer_event_booking_v01(uuid,uuid,jsonb,uuid)'
  ] LOOP
    IF has_function_privilege('anon', v_signature, 'EXECUTE') OR has_function_privilege('authenticated', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% is executable by anon or authenticated', v_signature;
    END IF;
    IF NOT has_function_privilege('service_role', v_signature, 'EXECUTE') THEN
      RAISE EXCEPTION '% is not executable by service_role', v_signature;
    END IF;
  END LOOP;
  IF has_table_privilege('anon', 'public.event_booking_refund_requests', 'SELECT')
     OR has_table_privilege('authenticated', 'public.event_booking_refund_requests', 'SELECT') THEN
    RAISE EXCEPTION 'event_booking_refund_requests is readable by anon or authenticated';
  END IF;
END;
$$;

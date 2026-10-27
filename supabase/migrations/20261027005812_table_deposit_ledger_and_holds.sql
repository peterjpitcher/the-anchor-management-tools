-- BK-223 (customer bookings review of 24 October 2026): a paid PayPal table deposit no longer
-- leaves a 'pending' ledger row and an active hold behind.
--
-- Every table booking that needs a deposit got a 'pending' table_deposit row in payments and an
-- 'active' payment hold in booking_holds when it was created. A PayPal payment only updates the
-- booking (owner decision: PayPal deposits live on the booking, paypal_deposit_capture_id and
-- deposit_amount_locked), so the ledger row stayed 'pending' and the hold stayed 'active' for good.
-- The ledger then showed paid deposits as owed. On 27 October 2026 there were 6 active holds, all
-- on finished bookings, and 9 'pending' table_deposit rows.
--
-- This migration changes how new bookings behave; the old rows are tidied separately in
-- 20261027010145_retire_old_booking_rows (owner decision D36).
--
--   create_table_booking_core_v06   stops writing the 'pending' payments row. The deposit is
--                                   already on the booking (deposit_amount); the cash path,
--                                   record_table_cash_deposit_v05, writes its own 'succeeded' row
--                                   when it finds none, and the deposit-timeout cron only marks
--                                   pending rows failed when there are any. The hold is still
--                                   written. Not marked 'succeeded' instead, as the review warned:
--                                   refunds update the booking, not that row, so it would drift
--                                   again.
--
--                                   Patched in place, as 20261016180511 and release 12's
--                                   20261026204729 do: the live definition is read with
--                                   pg_get_functiondef, the payments insert is replaced by a
--                                   comment, and the result is executed. The block refuses to run
--                                   unless the insert appears exactly once, so a definition that
--                                   has moved on fails loudly instead of being half-patched, and a
--                                   second run is a no-op. It touches only that block, so it
--                                   composes with release 12's pacing patch in either order.
--                                   CREATE OR REPLACE keeps owner, SECURITY DEFINER, search_path
--                                   and grants; the grants (service_role only) are restated.
--                                   Checked against production on 27 October 2026: md5(prosrc)
--                                   e831d41dc33d4331c09db4570fd85003.
--
--   table_booking_payment_hold_on_capture   AFTER UPDATE OF paypal_deposit_capture_id: when a
--                                   capture is first recorded, the booking's active payment hold
--                                   becomes 'consumed'. One step shared by all four PayPal capture
--                                   writers (webhook, capture-order route, guest payment page and
--                                   the reconciliation cron), and by any added later.
--   table_booking_payment_hold_on_cancel    AFTER UPDATE OF status: when a booking is cancelled
--                                   its active payment hold is let go: 'expired' when the
--                                   deposit-timeout cron cancelled it for a lapsed hold (its own
--                                   update then finds nothing left to do), 'released' otherwise.
--
-- Both trigger functions are SECURITY DEFINER with search_path public, because booking_holds is
-- service_role only (20261026182434) while staff sessions still cancel bookings, and are
-- executable by service_role only.
--
-- Rollback: tasks/table-deposit-ledger-and-holds/rollback.sql. Tested by
-- scripts/testing/table-deposit-ledger-and-holds-postgres.py.

DO $patch$
DECLARE
  v_oid oid;
  v_count integer;
  v_def text;
  v_hits integer;
  v_done integer;
  v_insert text := $insert$
    INSERT INTO public.payments (
      table_booking_id, charge_type, amount, currency, status, metadata, created_at
    ) VALUES (
      v_table_booking_id, 'table_deposit', v_deposit_amount, 'GBP', 'pending',
      jsonb_build_object(
        'source', 'foh_booking_create',
        -- Which rule produced this charge, and at what rate. "deposit_per_person: 10" was hardcoded
        -- and became a lie the moment a period charged anything else.
        'deposit_rule', v_deposit_rule,
        'deposit_basis', v_deposit_basis,
        'deposit_rate', v_deposit_rate,
        'deposit_per_person', CASE WHEN v_deposit_basis = 'per_head' THEN v_deposit_rate ELSE NULL END,
        'booking_period_code', CASE WHEN v_period_accepted THEN v_period.code ELSE NULL END,
        'refund_cutoff_days', v_deposit_refund_days,
        'party_size', v_party_size_eff,
        'created_at', v_now
      ),
      v_now
    );
$insert$;
  v_note text := $note$
    -- No 'pending' payments row (BK-223): a PayPal deposit is recorded on the booking itself
    -- (paypal_deposit_capture_id, deposit_amount_locked) and the cash path writes its own row.
$note$;
BEGIN
  SELECT count(*), min(p.oid) INTO v_count, v_oid
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_table_booking_core_v06';

  IF v_count <> 1 THEN
    RAISE EXCEPTION 'table_deposit_ledger_and_holds: expected one create_table_booking_core_v06, found %', v_count;
  END IF;

  v_def := pg_get_functiondef(v_oid);
  v_hits := (length(v_def) - length(replace(v_def, v_insert, ''))) / length(v_insert);
  v_done := (length(v_def) - length(replace(v_def, v_note, ''))) / length(v_note);

  IF v_hits = 0 AND v_done = 1 THEN
    RAISE NOTICE 'table_deposit_ledger_and_holds: create_table_booking_core_v06 already patched, skipped';
  ELSIF v_hits <> 1 OR v_done <> 0 THEN
    RAISE EXCEPTION 'table_deposit_ledger_and_holds: create_table_booking_core_v06 has % payments inserts and % notes, expected 1 and 0',
      v_hits, v_done;
  ELSE
    EXECUTE replace(v_def, v_insert, v_note);
    RAISE NOTICE 'table_deposit_ledger_and_holds: create_table_booking_core_v06 patched';
  END IF;

  IF position('INSERT INTO public.payments' IN pg_get_functiondef(v_oid)) > 0 THEN
    RAISE EXCEPTION 'table_deposit_ledger_and_holds: create_table_booking_core_v06 still writes a payments row';
  END IF;
END
$patch$;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.table_booking_payment_hold_on_capture()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.booking_holds
     SET status = 'consumed',
         consumed_at = now(),
         updated_at = now()
   WHERE table_booking_id = NEW.id
     AND hold_type = 'payment_hold'
     AND status = 'active';
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.table_booking_payment_hold_on_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.booking_holds
     SET status = CASE WHEN NEW.cancellation_reason = 'payment_hold_expired' THEN 'expired' ELSE 'released' END,
         released_at = now(),
         updated_at = now()
   WHERE table_booking_id = NEW.id
     AND hold_type = 'payment_hold'
     AND status = 'active';
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE TRIGGER table_booking_payment_hold_on_capture
  AFTER UPDATE OF paypal_deposit_capture_id ON public.table_bookings
  FOR EACH ROW
  WHEN (OLD.paypal_deposit_capture_id IS NULL AND NEW.paypal_deposit_capture_id IS NOT NULL)
  EXECUTE FUNCTION public.table_booking_payment_hold_on_capture();

CREATE OR REPLACE TRIGGER table_booking_payment_hold_on_cancel
  AFTER UPDATE OF status ON public.table_bookings
  FOR EACH ROW
  WHEN (NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.table_booking_payment_hold_on_cancel();

REVOKE ALL ON FUNCTION public.table_booking_payment_hold_on_capture() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.table_booking_payment_hold_on_cancel() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.table_booking_payment_hold_on_capture() TO service_role;
GRANT EXECUTE ON FUNCTION public.table_booking_payment_hold_on_cancel() TO service_role;

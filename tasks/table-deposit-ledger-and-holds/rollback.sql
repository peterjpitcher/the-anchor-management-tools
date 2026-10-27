-- Rollback for supabase/migrations/20261027154848_table_deposit_ledger_and_holds.sql.
-- Removes the two hold triggers and their functions (production had neither on 27 October 2026)
-- and puts the 'pending' payments insert back into create_table_booking_core_v06, patched in
-- place the same way, so any other in-place patch (release 12's pacing lines) is kept. The body
-- then matches what it was before the migration byte for byte. Holds consumed or released by the
-- triggers in the meantime stay as they are.
DROP TRIGGER IF EXISTS table_booking_payment_hold_on_capture ON public.table_bookings;
DROP TRIGGER IF EXISTS table_booking_payment_hold_on_cancel ON public.table_bookings;
DROP FUNCTION IF EXISTS public.table_booking_payment_hold_on_capture();
DROP FUNCTION IF EXISTS public.table_booking_payment_hold_on_cancel();

DO $unpatch$
DECLARE
  v_oid oid;
  v_def text;
  v_hits integer;
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
  SELECT p.oid INTO v_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_table_booking_core_v06';
  v_def := pg_get_functiondef(v_oid);
  v_hits := (length(v_def) - length(replace(v_def, v_note, ''))) / length(v_note);
  IF v_hits <> 1 THEN
    RAISE EXCEPTION 'rollback table_deposit_ledger_and_holds: expected the note once in create_table_booking_core_v06, found %', v_hits;
  END IF;
  EXECUTE replace(v_def, v_note, v_insert);
END
$unpatch$;

REVOKE ALL ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_table_booking_core_v06(
  uuid, date, time without time zone, integer, text, text, boolean, text, boolean, boolean,
  boolean, integer, boolean, boolean, text, boolean, integer,
  public.table_allocation_overrides, uuid, uuid, boolean) TO service_role;

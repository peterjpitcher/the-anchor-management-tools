-- Private Bookings SOP compliance: record locking and complaints log.
--   A. Records can be locked while a dispute, complaint, chargeback,
--      insurance issue, police matter or legal claim is active (pack §27) —
--      locked records cannot be hard-deleted.
--   B. Minimal complaints log (pack §26): acknowledge within 3 working days,
--      full response within 10 working days.

-- ---------------------------------------------------------------------------
-- A. Record locking
-- ---------------------------------------------------------------------------

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS locked_at timestamptz;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS locked_reason text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS locked_by uuid;

COMMENT ON COLUMN public.private_bookings.locked_at IS
  'Record lock (SOP §27): set while a dispute, complaint, chargeback, insurance issue, police matter or legal claim is active. Locked records must not be deleted or anonymised.';

-- Function audit: extend the delete gate to respect locks (full redefinition —
-- includes the SOP §8 checks introduced in 20260705100001).
CREATE OR REPLACE FUNCTION public.prevent_hard_delete_when_sms_sent()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  -- SOP §8/§27: once a customer has been messaged, paid, or received a
  -- contract — or the record is locked — the booking must be cancelled,
  -- not deleted. Applies to cancelled bookings too.

  IF OLD.locked_at IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: the record is locked (%). Resolve and unlock first.', OLD.id, COALESCE(OLD.locked_reason, 'no reason recorded')
      USING ERRCODE = 'check_violation';
  END IF;

  IF OLD.deposit_paid_date IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a deposit has been paid. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private_booking_payments WHERE booking_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: payments have been recorded. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF COALESCE(OLD.contract_version, 0) > 0 OR EXISTS (
    SELECT 1 FROM private_booking_documents WHERE booking_id = OLD.id
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a contract or document has been generated. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM email_messages
    WHERE private_booking_id = OLD.id
      AND COALESCE(direction, 'outbound') <> 'inbound'
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: a customer email has been sent. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF EXISTS (
    SELECT 1 FROM private_booking_sms_queue
    WHERE booking_id = OLD.id
      AND (status = 'sent'
           OR (status = 'approved' AND scheduled_for IS NOT NULL AND scheduled_for > now()))
  ) THEN
    RAISE EXCEPTION 'Cannot hard-delete booking %: SMS already sent or scheduled. Cancel instead.', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN OLD;
END;
$function$;

-- ---------------------------------------------------------------------------
-- B. Complaints log
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.private_booking_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid REFERENCES public.private_bookings(id) ON DELETE SET NULL,
  customer_id uuid,
  received_at timestamptz NOT NULL DEFAULT now(),
  channel text,
  summary text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'responded', 'resolved', 'closed')),
  acknowledged_at timestamptz,
  responded_at timestamptz,
  resolved_at timestamptz,
  resolution text,
  handled_by uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.private_booking_complaints IS
  'Complaints log (SOP §26): acknowledge within 3 working days; aim to respond fully within 10 working days. Handled internally by the General Manager.';

CREATE INDEX IF NOT EXISTS idx_pb_complaints_booking ON public.private_booking_complaints (booking_id);
CREATE INDEX IF NOT EXISTS idx_pb_complaints_status ON public.private_booking_complaints (status);

ALTER TABLE public.private_booking_complaints ENABLE ROW LEVEL SECURITY;

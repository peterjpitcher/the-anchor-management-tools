-- Private Bookings SOP compliance: deduction workflow and cancellation capture.
--   A. Deposit deductions (pack §12/§25): evidenced, discussed with the
--      customer, General Manager approved, itemised.
--   B. Cancellation capture (pack §14): written channel, received date/time,
--      evidence, processor.

-- ---------------------------------------------------------------------------
-- A. Deductions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.private_booking_deductions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
  amount numeric NOT NULL CHECK (amount > 0),
  reason text NOT NULL,
  evidence_document_id uuid REFERENCES public.private_booking_documents(id),
  customer_discussion_note text,
  status text NOT NULL DEFAULT 'proposed'
    CHECK (status IN ('proposed', 'discussed', 'approved', 'rejected', 'applied')),
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.private_booking_deductions IS
  'Proposed deposit deductions (SOP §25): documented with evidence, discussed with the customer, approved by the General Manager, then applied via the refund flow.';

CREATE INDEX IF NOT EXISTS idx_pb_deductions_booking ON public.private_booking_deductions (booking_id);

-- Service-role access only: RLS on with no policies; all access goes through
-- permission-checked server actions using the admin client.
ALTER TABLE public.private_booking_deductions ENABLE ROW LEVEL SECURITY;

-- ---------------------------------------------------------------------------
-- B. Cancellation capture
-- ---------------------------------------------------------------------------

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS cancellation_channel text
    CHECK (cancellation_channel IS NULL OR cancellation_channel IN ('email', 'whatsapp', 'text', 'phone', 'in_person', 'other'));
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS cancellation_received_at timestamptz;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS cancellation_evidence_document_id uuid REFERENCES public.private_booking_documents(id);
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS cancelled_by uuid;

COMMENT ON COLUMN public.private_bookings.cancellation_received_at IS
  'Date and time the written cancellation was received — the cancellation date under the contract (SOP §14). A phone call alone is not written cancellation.';

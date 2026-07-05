-- Private Bookings SOP compliance: contract lifecycle (pack §11/§28).
-- The app must record when the contract was sent, to whom, and how it was
-- accepted — and store the generated document snapshot rather than only
-- regenerating from live data.

ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS contract_sent_at timestamptz;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS contract_sent_to text;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS contract_accepted_at timestamptz;
ALTER TABLE public.private_bookings
  ADD COLUMN IF NOT EXISTS contract_acceptance_method text;

COMMENT ON COLUMN public.private_bookings.contract_sent_at IS
  'When the contract + terms were last sent to the customer (SOP: terms must be provided before the deposit is paid).';
COMMENT ON COLUMN public.private_bookings.contract_acceptance_method IS
  'How the contract was accepted, e.g. deposit_payment, signed_upload, written_confirmation.';

-- Private bucket for contract/waiver snapshots. No storage policies are
-- created: access is service-role only via server actions (RLS denies by
-- default for anon/authenticated).
INSERT INTO storage.buckets (id, name, public)
VALUES ('private-booking-documents', 'private-booking-documents', false)
ON CONFLICT (id) DO NOTHING;

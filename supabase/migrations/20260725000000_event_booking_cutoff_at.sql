-- Optional absolute instant after which ONLINE ticket sales close for an event.
ALTER TABLE public.events
  ADD COLUMN booking_cutoff_at timestamptz NULL;

COMMENT ON COLUMN public.events.booking_cutoff_at IS
  'Optional absolute instant after which ONLINE ticket sales close. NULL = no explicit cutoff (sales open until event start).';

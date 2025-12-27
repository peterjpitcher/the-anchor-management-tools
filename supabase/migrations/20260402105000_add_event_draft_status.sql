-- Allow draft as a valid default event status for categories

ALTER TABLE public.event_categories
  DROP CONSTRAINT IF EXISTS check_default_event_status;

ALTER TABLE public.event_categories
  ADD CONSTRAINT check_default_event_status CHECK (
    (default_event_status)::text = ANY (
      (ARRAY[
        'scheduled'::character varying,
        'cancelled'::character varying,
        'postponed'::character varying,
        'rescheduled'::character varying,
        'draft'::character varying
      ])::text[]
    )
  );

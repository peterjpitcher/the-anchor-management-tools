-- Track manual event-interest reminder cadence sends.

ALTER TABLE public.event_interest_manual_recipients
  ADD COLUMN IF NOT EXISTS reminder_14d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_7d_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS reminder_1d_sent_at timestamptz;

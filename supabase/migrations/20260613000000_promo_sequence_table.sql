-- Multi-touch promo sequence tracking table
-- Tracks which customers received 14d intro and which follow-ups (7d, 3d) have been sent

CREATE TABLE IF NOT EXISTS promo_sequence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  customer_id UUID NOT NULL REFERENCES customers(id),
  event_id UUID NOT NULL REFERENCES events(id),
  audience_type TEXT NOT NULL,
  touch_14d_sent_at TIMESTAMPTZ NOT NULL,
  touch_7d_sent_at TIMESTAMPTZ,
  touch_3d_sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- One sequence per customer per event
ALTER TABLE promo_sequence
  ADD CONSTRAINT uq_promo_sequence_customer_event UNIQUE (customer_id, event_id);

-- Partial indexes for finding pending follow-ups
CREATE INDEX idx_promo_sequence_7d_pending
  ON promo_sequence (event_id)
  WHERE touch_7d_sent_at IS NULL;

CREATE INDEX idx_promo_sequence_3d_pending
  ON promo_sequence (event_id)
  WHERE touch_3d_sent_at IS NULL;

-- RLS + privilege hardening
ALTER TABLE promo_sequence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE promo_sequence FROM PUBLIC;
GRANT ALL ON TABLE promo_sequence TO service_role;

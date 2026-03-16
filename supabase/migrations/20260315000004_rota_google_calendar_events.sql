-- Stores Google Calendar event IDs for published rota shifts.
-- Used by the direct-push sync so we can update/delete events on re-publish
-- without relying on ICS polling.
CREATE TABLE IF NOT EXISTS rota_google_calendar_events (
  shift_id  UUID        PRIMARY KEY,
  week_id   UUID        NOT NULL,
  google_event_id TEXT  NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rota_gcal_events_week_id ON rota_google_calendar_events(week_id);

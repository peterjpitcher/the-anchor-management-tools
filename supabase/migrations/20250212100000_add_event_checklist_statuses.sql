-- Create table to track per-event checklist task completion
CREATE TABLE IF NOT EXISTS event_checklist_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  task_key TEXT NOT NULL,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
  UNIQUE (event_id, task_key)
);

ALTER TABLE event_checklist_statuses ENABLE ROW LEVEL SECURITY;

-- Trigger to keep updated_at current
CREATE OR REPLACE FUNCTION event_checklist_statuses_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = timezone('utc', now());
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS event_checklist_statuses_set_updated_at_trigger ON event_checklist_statuses;
CREATE TRIGGER event_checklist_statuses_set_updated_at_trigger
  BEFORE UPDATE ON event_checklist_statuses
  FOR EACH ROW
  EXECUTE FUNCTION event_checklist_statuses_set_updated_at();

-- Policies: view for events:view, modify for events:manage
CREATE POLICY "event_checklist_view"
ON event_checklist_statuses
FOR SELECT
USING (
  public.user_has_permission(auth.uid(), 'events', 'view')
);

CREATE POLICY "event_checklist_insert"
ON event_checklist_statuses
FOR INSERT
WITH CHECK (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE POLICY "event_checklist_update"
ON event_checklist_statuses
FOR UPDATE
USING (
  public.user_has_permission(auth.uid(), 'events', 'manage')
)
WITH CHECK (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE POLICY "event_checklist_delete"
ON event_checklist_statuses
FOR DELETE
USING (
  public.user_has_permission(auth.uid(), 'events', 'manage')
);

CREATE INDEX IF NOT EXISTS event_checklist_statuses_event_id_idx
  ON event_checklist_statuses (event_id);

CREATE INDEX IF NOT EXISTS event_checklist_statuses_task_key_idx
  ON event_checklist_statuses (task_key);

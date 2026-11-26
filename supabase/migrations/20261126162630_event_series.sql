-- Repeating events ("repeats weekly"), spec docs/superpowers/specs/2026-11-26-repeating-events.md,
-- approved by the owner on 26 November 2026.
--
-- A repeating event is ONE record holding the rule (weekday, London wall-clock times, first and
-- last date). Its dates are worked out in code (src/lib/events/series.ts), never stored as one
-- events row per week, so none of the per-event machinery (short links, checklist tasks, booking
-- rules, promo senders) ever sees it.
--
-- Additive only: two new tables, their policies and an updated_at trigger. No column is added to
-- events and nothing existing changes. No grant to anon: since 20260828120356 new tables do not
-- inherit one, and the website reads through GET /api/event-series with its API key.
-- A skip made by "Make this date a full event" is deleted with that event (ON DELETE CASCADE, not
-- the SET NULL the spec table shows), so deleting the event restores the date as spec section 7 says.
-- Rollback: DROP TABLE public.event_series_skips; DROP TABLE public.event_series;

CREATE TABLE public.event_series (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  category_id uuid REFERENCES public.event_categories(id) ON DELETE SET NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  start_time time NOT NULL,
  end_time time NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  short_description text NOT NULL CHECK (length(btrim(short_description)) > 0),
  page_path text CHECK (page_path IS NULL OR page_path ~ '^/'),
  is_free boolean NOT NULL DEFAULT true,
  audience_note text,
  skip_when_closed boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'ended')),
  google_calendar_event_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT event_series_ends_after_start CHECK (ends_on IS NULL OR ends_on >= starts_on)
);

COMMENT ON TABLE public.event_series IS
  'Repeating events: one row per weekly night. Dates are resolved in src/lib/events/series.ts.';
COMMENT ON COLUMN public.event_series.weekday IS 'ISO weekday: Monday 1 to Sunday 7.';
COMMENT ON COLUMN public.event_series.start_time IS 'London wall-clock time, never an instant.';
COMMENT ON COLUMN public.event_series.end_time IS 'London wall-clock time; earlier than start_time means past midnight.';

CREATE TABLE public.event_series_skips (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  series_id uuid NOT NULL REFERENCES public.event_series(id) ON DELETE CASCADE,
  skip_date date NOT NULL,
  reason text,
  replaced_by_event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT event_series_skips_series_date_key UNIQUE (series_id, skip_date)
);

COMMENT ON TABLE public.event_series_skips IS
  'Dates a repeating event does not run. replaced_by_event_id is set when the date became a full event.';

CREATE INDEX event_series_skips_replaced_by_event_id_idx
  ON public.event_series_skips (replaced_by_event_id)
  WHERE replaced_by_event_id IS NOT NULL;
CREATE INDEX event_series_category_id_idx ON public.event_series (category_id);

CREATE OR REPLACE FUNCTION public.event_series_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER event_series_set_updated_at
  BEFORE UPDATE ON public.event_series
  FOR EACH ROW EXECUTE FUNCTION public.event_series_set_updated_at();

ALTER TABLE public.event_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_series_skips ENABLE ROW LEVEL SECURITY;

-- The same four policies as public.events.
CREATE POLICY "Users with events view permission can view event series"
  ON public.event_series FOR SELECT TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'view')));
CREATE POLICY "Users with events create permission can create event series"
  ON public.event_series FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.user_has_permission(auth.uid(), 'events', 'create')));
CREATE POLICY "Users with events edit permission can update event series"
  ON public.event_series FOR UPDATE TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'edit')))
  WITH CHECK ((SELECT public.user_has_permission(auth.uid(), 'events', 'edit')));
CREATE POLICY "Users with events delete permission can delete event series"
  ON public.event_series FOR DELETE TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'delete')));

CREATE POLICY "Users with events view permission can view event series skips"
  ON public.event_series_skips FOR SELECT TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'view')));
CREATE POLICY "Users with events create permission can create event series skips"
  ON public.event_series_skips FOR INSERT TO authenticated
  WITH CHECK ((SELECT public.user_has_permission(auth.uid(), 'events', 'create')));
CREATE POLICY "Users with events edit permission can update event series skips"
  ON public.event_series_skips FOR UPDATE TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'edit')))
  WITH CHECK ((SELECT public.user_has_permission(auth.uid(), 'events', 'edit')));
CREATE POLICY "Users with events delete permission can delete event series skips"
  ON public.event_series_skips FOR DELETE TO authenticated
  USING ((SELECT public.user_has_permission(auth.uid(), 'events', 'delete')));

REVOKE ALL ON public.event_series, public.event_series_skips FROM PUBLIC, anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_series, public.event_series_skips TO authenticated;
GRANT ALL ON public.event_series, public.event_series_skips TO service_role;
REVOKE ALL ON FUNCTION public.event_series_set_updated_at() FROM PUBLIC, anon;

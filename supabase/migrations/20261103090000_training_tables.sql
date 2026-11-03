-- Staff training: tables, rules and the private bucket (tasks/plan-2026-11-02-staff-training-build.md,
-- section 2.1; design in tasks/spec-2026-11-02-staff-training.md, section 10).
--
-- Additive. Seven new tables, their trigger functions, one retention function and one private
-- storage bucket. Nothing existing is altered, dropped or deleted, so the code deployed before
-- this migration keeps working unchanged.
--
--   training_courses          One row per course: slug, type, audience, deadlines, refresher.
--   training_course_versions  Drafts and published versions. A published version is frozen.
--   training_profiles         One row per person: training groups, pauses, adjustments.
--   training_assignments      One row per person, course and cycle: status, dates, version.
--   training_attempts         One row per section check. Only an open attempt can be answered.
--   training_events           The timeline. Append-only.
--   training_reminders        The chase ledger: one claim per reminder, so nothing goes twice.
--
-- Every table has row security on and no policy, and is granted to service_role only, so only
-- server code reaches it, after its own permission or staff portal identity check. Nothing here
-- is granted to anon or authenticated (CLAUDE.md, Security rules; tests/guards/training-tables.test.ts).
--
-- People are keyed on employees.employee_id, never the login, with ON DELETE RESTRICT, so a
-- person with training records cannot be deleted by accident. Who did something (published,
-- unlocked, waived) is a user id with no foreign key plus a name taken at the time, as signing
-- does, so removing a manager's login never touches a training row.
--
-- Retention: 7 years after employment ends, removed by a deliberate act only.
-- public.training_retention_purge(employee_id) is the one path past the append-only rules; it
-- refuses anyone who is not Former with an employment end date 7 or more years ago. Nothing calls
-- it automatically. Signing packs and stored files are removed by their own paths, not by it.
--
-- Safe to run twice: every object is created only if missing or replaced with the same definition.

BEGIN;

-- ---------------------------------------------------------------------------
-- Trigger functions
-- ---------------------------------------------------------------------------

-- Keeps updated_at honest on the tables that change in normal use.
CREATE OR REPLACE FUNCTION public.training_touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- A published course version is what people were trained on, so it is never changed or removed.
-- A draft can be replaced or removed. Publishing a draft may set its number, its publish details,
-- its change note and the redo flag, but never the content that was checked before publishing.
CREATE OR REPLACE FUNCTION public.training_course_versions_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.state = 'published' THEN
      RAISE EXCEPTION 'training_course_versions: a published version cannot be deleted'
        USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.state = 'published' THEN
    RAISE EXCEPTION 'training_course_versions: a published version cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id OR NEW.course_id IS DISTINCT FROM OLD.course_id THEN
    RAISE EXCEPTION 'training_course_versions: a draft cannot move to another course'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.state = 'published' AND (
       NEW.content IS DISTINCT FROM OLD.content
    OR NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256
    OR NEW.images IS DISTINCT FROM OLD.images
    OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
    OR NEW.uploaded_by_name IS DISTINCT FROM OLD.uploaded_by_name
    OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
  ) THEN
    RAISE EXCEPTION 'training_course_versions: publishing cannot change the content that was checked'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- A check attempt is evidence of what was asked and answered. It is never removed, and once
-- submitted it is never changed. While open, only its answer and result columns can be written,
-- so the questions served cannot be swapped after the event. Only the retention function, which
-- sets training.retention_purge for its own transaction, may remove attempts.
CREATE OR REPLACE FUNCTION public.training_attempts_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('training.retention_purge', true) = 'on' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'training_attempts: an attempt cannot be deleted'
      USING ERRCODE = 'restrict_violation';
  END IF;

  IF OLD.submitted_at IS NOT NULL THEN
    RAISE EXCEPTION 'training_attempts: a submitted attempt cannot be changed'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
    OR NEW.assignment_id IS DISTINCT FROM OLD.assignment_id
    OR NEW.employee_id IS DISTINCT FROM OLD.employee_id
    OR NEW.version_id IS DISTINCT FROM OLD.version_id
    OR NEW.section_key IS DISTINCT FROM OLD.section_key
    OR NEW.attempt_no IS DISTINCT FROM OLD.attempt_no
    OR NEW.served IS DISTINCT FROM OLD.served
    OR NEW.started_at IS DISTINCT FROM OLD.started_at
  THEN
    RAISE EXCEPTION 'training_attempts: only the answers and result of an open attempt can be written'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- The timeline is evidence. Once written, a row is never changed, and it is removed only by the
-- retention function, which sets training.retention_purge for its own transaction.
CREATE OR REPLACE FUNCTION public.training_events_guard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND current_setting('training.retention_purge', true) = 'on' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'training_events is append-only: % is not allowed', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- TRUNCATE skips row triggers, so the append-only tables refuse it outright. The retention
-- function never truncates.
CREATE OR REPLACE FUNCTION public.training_refuse_truncate()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $$
BEGIN
  RAISE EXCEPTION '%: TRUNCATE is not allowed', TG_TABLE_NAME
    USING ERRCODE = 'restrict_violation';
END;
$$;

-- ---------------------------------------------------------------------------
-- Courses and versions
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_courses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Stable forever: course files, links and series keys use it.
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9-]{2,60}$'),
  title text NOT NULL CHECK (length(title) BETWEEN 2 AND 120),
  kind text NOT NULL CHECK (kind IN ('online', 'practical', 'external')),
  -- Empty means everyone.
  audience_groups text[] NOT NULL DEFAULT '{}' CHECK (audience_groups <@ ARRAY['bar', 'kitchen', 'floor', 'management']::text[]),
  audience_age text NOT NULL DEFAULT 'all' CHECK (audience_age IN ('all', 'under_18', 'adult')),
  is_essentials boolean NOT NULL DEFAULT false,
  prerequisite_course_id uuid REFERENCES public.training_courses(id) ON DELETE RESTRICT,
  -- Null means no due date for that group of people.
  new_starter_due_days int CHECK (new_starter_due_days BETWEEN 0 AND 365),
  existing_staff_due_days int CHECK (existing_staff_due_days BETWEEN 0 AND 365),
  -- Null means the course never expires.
  refresher_months int CHECK (refresher_months BETWEEN 1 AND 120),
  -- How many days before expiry the refresher opens.
  window_days int NOT NULL DEFAULT 30 CHECK (window_days BETWEEN 0 AND 180),
  supervised_only_under_18 boolean NOT NULL DEFAULT false,
  display_order int NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'live', 'retired')),
  -- The published version new cycles take. Foreign key added below, once versions exist.
  current_version_id uuid,
  summary text,
  created_by uuid,
  created_by_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_course_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE RESTRICT,
  state text NOT NULL CHECK (state IN ('draft', 'published')),
  major int,
  minor int,
  -- The validated course.json, exactly as published.
  content jsonb NOT NULL,
  content_sha256 text NOT NULL CHECK (content_sha256 ~ '^[0-9a-f]{64}$'),
  -- [{ "src", "path", "sha256", "contentType", "bytes" }] for each image in the bucket.
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  change_note text,
  -- Set when a published change asks everyone who has done the course to do it again.
  redo_required boolean NOT NULL DEFAULT false,
  uploaded_by uuid,
  uploaded_by_name text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  published_by uuid,
  published_by_name text,
  published_at timestamptz,
  CHECK (
    (state = 'draft' AND major IS NULL AND minor IS NULL AND published_at IS NULL)
    OR (state = 'published' AND major IS NOT NULL AND minor IS NOT NULL AND published_at IS NOT NULL)
  )
);

-- One draft per course at a time; each published number once per course.
CREATE UNIQUE INDEX IF NOT EXISTS training_course_versions_one_draft
  ON public.training_course_versions (course_id) WHERE state = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS training_course_versions_number
  ON public.training_course_versions (course_id, major, minor) WHERE state = 'published';

ALTER TABLE public.training_courses
  DROP CONSTRAINT IF EXISTS training_courses_current_version_fk,
  ADD CONSTRAINT training_courses_current_version_fk
    FOREIGN KEY (current_version_id) REFERENCES public.training_course_versions(id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------------
-- People
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.training_profiles (
  employee_id uuid PRIMARY KEY REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  groups text[] NOT NULL DEFAULT '{}' CHECK (groups <@ ARRAY['bar', 'kitchen', 'floor', 'management']::text[]),
  groups_confirmed_at timestamptz,
  groups_confirmed_by uuid,
  groups_confirmed_by_name text,
  paused_from date,
  paused_until date,
  -- A fixed list: never a health detail.
  pause_reason text CHECK (pause_reason IN ('leave_of_absence', 'parental_leave', 'other')),
  -- The adjustment made (for example "read aloud"), never the reason for it.
  adjustment_note text CHECK (length(adjustment_note) <= 300),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.training_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  course_id uuid NOT NULL REFERENCES public.training_courses(id) ON DELETE RESTRICT,
  -- 1 for the first time, then one more for each refresher or redo.
  cycle int NOT NULL CHECK (cycle >= 1),
  reason text NOT NULL CHECK (reason IN ('new_starter', 'existing_staff', 'course_added', 'refresher', 'redo', 'manual', 'renewal')),
  status text NOT NULL CHECK (status IN ('waiting', 'assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined', 'completed', 'waived', 'cancelled')),
  assigned_on date NOT NULL,
  due_on date,
  window_opens_on date,
  -- The published version this cycle was taken on, set at the first start.
  version_id uuid REFERENCES public.training_course_versions(id) ON DELETE RESTRICT,
  -- Where the learner is: card per section, fails, passes (contract section 3).
  progress jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz,
  last_section_passed_at timestamptz,
  completed_on date,
  expires_on date,
  certificate_number text UNIQUE,
  -- The confirmation goes through the signing feature; this is its document.
  signing_document_id uuid REFERENCES public.signing_documents(id) ON DELETE RESTRICT,
  confirmed_at timestamptz,
  locked_at timestamptz,
  locked_section text,
  declined_at timestamptz,
  waived_at timestamptz,
  waived_by uuid,
  waived_by_name text,
  waive_reason text,
  cancelled_at timestamptz,
  cancel_reason text CHECK (cancel_reason IN ('left', 'group_removed', 'course_retired', 'replaced', 'manual')),
  -- External qualifications (food hygiene, first aid): the certificate's own details and file.
  external_issuer text,
  external_reference text,
  external_issued_on date,
  external_file_path text,
  -- Practical courses: the tasks a manager watched, who and when.
  signoff_tasks jsonb,
  signed_off_by uuid,
  signed_off_by_name text,
  signed_off_on date,
  supervised_only boolean NOT NULL DEFAULT false,
  due_change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (employee_id, course_id, cycle)
);

-- At most one open cycle per person and course.
CREATE UNIQUE INDEX IF NOT EXISTS training_assignments_one_open
  ON public.training_assignments (employee_id, course_id)
  WHERE status IN ('waiting', 'assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined');
CREATE INDEX IF NOT EXISTS training_assignments_course
  ON public.training_assignments (course_id, status);
CREATE INDEX IF NOT EXISTS training_assignments_due
  ON public.training_assignments (due_on)
  WHERE status IN ('assigned', 'in_progress', 'locked', 'awaiting_confirmation', 'declined');

CREATE TABLE IF NOT EXISTS public.training_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.training_assignments(id) ON DELETE RESTRICT,
  employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  version_id uuid NOT NULL REFERENCES public.training_course_versions(id) ON DELETE RESTRICT,
  section_key text NOT NULL,
  attempt_no int NOT NULL CHECK (attempt_no >= 1),
  -- [{ "questionId", "optionOrder": [2, 0, 1] }]: the questions asked, options in the order shown.
  served jsonb NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  -- { questionId: originalOptionIndex }
  answers jsonb,
  -- [{ questionId, chosen, correct, critical }]
  results jsonb,
  wrong_count int,
  critical_missed int,
  passed boolean,
  UNIQUE (assignment_id, section_key, attempt_no)
);

-- One open attempt per section, so reloading the page returns the same questions.
CREATE UNIQUE INDEX IF NOT EXISTS training_attempts_one_open
  ON public.training_attempts (assignment_id, section_key) WHERE submitted_at IS NULL;

CREATE TABLE IF NOT EXISTS public.training_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  assignment_id uuid REFERENCES public.training_assignments(id) ON DELETE RESTRICT,
  course_id uuid REFERENCES public.training_courses(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'course_draft_uploaded', 'course_published', 'course_retired', 'assigned', 'started', 'section_passed',
    'section_failed', 'locked', 'unlocked', 'extended', 'waived', 'paused', 'resumed', 'cancelled', 'declined',
    'confirmation_prepared', 'confirmation_failed', 'completed', 'reminder_sent', 'escalated',
    'external_recorded', 'signoff_recorded', 'groups_changed', 'redo_requested')),
  actor_id uuid,
  actor_name text,
  -- Ids and counts only: no contact details, no health details.
  note_code text,
  note text CHECK (length(note) <= 500),
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS training_events_employee
  ON public.training_events (employee_id, created_at DESC);
CREATE INDEX IF NOT EXISTS training_events_created
  ON public.training_events (created_at DESC);

-- One row per reminder claimed. Releasing a claim deletes its row: the only training rows that
-- are deleted in normal use.
CREATE TABLE IF NOT EXISTS public.training_reminders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL CHECK (kind IN ('staff_step', 'daily_cap', 'manager_daily', 'escalation', 'no_login', 'undeliverable')),
  -- step:<assignment>:<step>:<due_on>, weekly:<assignment>:<monday>, cap:<employee>:<date>,
  -- manager:<date>, esc:<assignment>:<type>, nologin:<employee>
  claim_key text NOT NULL,
  assignment_id uuid REFERENCES public.training_assignments(id) ON DELETE RESTRICT,
  employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  london_date date NOT NULL,
  status text NOT NULL CHECK (status IN ('claimed', 'sent', 'uncertain')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS training_reminders_claim
  ON public.training_reminders (claim_key);

-- ---------------------------------------------------------------------------
-- Triggers
-- ---------------------------------------------------------------------------

DROP TRIGGER IF EXISTS training_courses_touch ON public.training_courses;
CREATE TRIGGER training_courses_touch
  BEFORE UPDATE ON public.training_courses
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

DROP TRIGGER IF EXISTS training_profiles_touch ON public.training_profiles;
CREATE TRIGGER training_profiles_touch
  BEFORE UPDATE ON public.training_profiles
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

DROP TRIGGER IF EXISTS training_assignments_touch ON public.training_assignments;
CREATE TRIGGER training_assignments_touch
  BEFORE UPDATE ON public.training_assignments
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

DROP TRIGGER IF EXISTS training_reminders_touch ON public.training_reminders;
CREATE TRIGGER training_reminders_touch
  BEFORE UPDATE ON public.training_reminders
  FOR EACH ROW EXECUTE FUNCTION public.training_touch_updated_at();

DROP TRIGGER IF EXISTS training_course_versions_guard ON public.training_course_versions;
CREATE TRIGGER training_course_versions_guard
  BEFORE UPDATE OR DELETE ON public.training_course_versions
  FOR EACH ROW EXECUTE FUNCTION public.training_course_versions_guard();

DROP TRIGGER IF EXISTS training_attempts_guard ON public.training_attempts;
CREATE TRIGGER training_attempts_guard
  BEFORE UPDATE OR DELETE ON public.training_attempts
  FOR EACH ROW EXECUTE FUNCTION public.training_attempts_guard();

DROP TRIGGER IF EXISTS training_events_append_only ON public.training_events;
CREATE TRIGGER training_events_append_only
  BEFORE UPDATE OR DELETE ON public.training_events
  FOR EACH ROW EXECUTE FUNCTION public.training_events_guard();

DROP TRIGGER IF EXISTS training_course_versions_no_truncate ON public.training_course_versions;
CREATE TRIGGER training_course_versions_no_truncate
  BEFORE TRUNCATE ON public.training_course_versions
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_refuse_truncate();

DROP TRIGGER IF EXISTS training_attempts_no_truncate ON public.training_attempts;
CREATE TRIGGER training_attempts_no_truncate
  BEFORE TRUNCATE ON public.training_attempts
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_refuse_truncate();

DROP TRIGGER IF EXISTS training_events_no_truncate ON public.training_events;
CREATE TRIGGER training_events_no_truncate
  BEFORE TRUNCATE ON public.training_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.training_refuse_truncate();

-- ---------------------------------------------------------------------------
-- Retention
-- ---------------------------------------------------------------------------

-- Removes one person's training rows once their records are past the 7-year retention period.
-- A deliberate act by the owner, never a job: it refuses unless the person is Former and their
-- employment ended 7 or more years ago (London date). It switches the append-only rules off for
-- its own transaction only, deletes attempts, events, reminders, assignments and the profile, and
-- returns how many of each it removed.
--
-- SECURITY DEFINER so the removal does not depend on the caller's table rights; granted to
-- service_role only. The append-only rules guard against mistakes, not against a service-role
-- holder, who could set the same flag: the same trust boundary as the signing trail.
--
-- Not removed here: the person's signing documents (the signing retention path does that) and any
-- external certificate files in the training bucket under external/<employee_id>/.
CREATE OR REPLACE FUNCTION public.training_retention_purge(p_employee_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_catalog'
AS $$
DECLARE
  v_status text;
  v_end date;
  v_cutoff date := ((now() AT TIME ZONE 'Europe/London')::date - interval '7 years')::date;
  v_attempts integer;
  v_events integer;
  v_reminders integer;
  v_assignments integer;
  v_profiles integer;
BEGIN
  IF p_employee_id IS NULL THEN
    RAISE EXCEPTION 'training_retention_purge refused: no employee given'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Hold the person's row so their status cannot change while their records are removed.
  SELECT status, employment_end_date INTO v_status, v_end
  FROM public.employees
  WHERE employee_id = p_employee_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'training_retention_purge refused: employee % not found', p_employee_id
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_status IS DISTINCT FROM 'Former' THEN
    RAISE EXCEPTION 'training_retention_purge refused: employee % is %, not Former', p_employee_id, v_status
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_end IS NULL THEN
    RAISE EXCEPTION 'training_retention_purge refused: employee % has no employment end date', p_employee_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF v_end > v_cutoff THEN
    RAISE EXCEPTION 'training_retention_purge refused: employment ended on %, less than 7 years ago', v_end
      USING ERRCODE = 'restrict_violation';
  END IF;

  PERFORM set_config('training.retention_purge', 'on', true);

  DELETE FROM public.training_attempts
  WHERE employee_id = p_employee_id
     OR assignment_id IN (SELECT id FROM public.training_assignments WHERE employee_id = p_employee_id);
  GET DIAGNOSTICS v_attempts = ROW_COUNT;

  DELETE FROM public.training_events
  WHERE employee_id = p_employee_id
     OR assignment_id IN (SELECT id FROM public.training_assignments WHERE employee_id = p_employee_id);
  GET DIAGNOSTICS v_events = ROW_COUNT;

  DELETE FROM public.training_reminders
  WHERE employee_id = p_employee_id
     OR assignment_id IN (SELECT id FROM public.training_assignments WHERE employee_id = p_employee_id);
  GET DIAGNOSTICS v_reminders = ROW_COUNT;

  DELETE FROM public.training_assignments WHERE employee_id = p_employee_id;
  GET DIAGNOSTICS v_assignments = ROW_COUNT;

  DELETE FROM public.training_profiles WHERE employee_id = p_employee_id;
  GET DIAGNOSTICS v_profiles = ROW_COUNT;

  -- Back on before anything else in the caller's transaction runs.
  PERFORM set_config('training.retention_purge', 'off', true);

  RETURN jsonb_build_object(
    'employee_id', p_employee_id,
    'attempts', v_attempts,
    'events', v_events,
    'reminders', v_reminders,
    'assignments', v_assignments,
    'profiles', v_profiles
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- Access: service_role only
-- ---------------------------------------------------------------------------

ALTER TABLE public.training_courses ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_courses FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_courses TO service_role;

ALTER TABLE public.training_course_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_course_versions FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_course_versions TO service_role;

ALTER TABLE public.training_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_profiles FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_profiles TO service_role;

ALTER TABLE public.training_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_assignments FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_assignments TO service_role;

ALTER TABLE public.training_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_attempts FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_attempts TO service_role;

ALTER TABLE public.training_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_events FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_events TO service_role;

ALTER TABLE public.training_reminders ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.training_reminders FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.training_reminders TO service_role;

REVOKE ALL ON FUNCTION public.training_touch_updated_at() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_touch_updated_at() TO service_role;

REVOKE ALL ON FUNCTION public.training_course_versions_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_course_versions_guard() TO service_role;

REVOKE ALL ON FUNCTION public.training_attempts_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_attempts_guard() TO service_role;

REVOKE ALL ON FUNCTION public.training_events_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_events_guard() TO service_role;

REVOKE ALL ON FUNCTION public.training_refuse_truncate() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_refuse_truncate() TO service_role;

REVOKE ALL ON FUNCTION public.training_retention_purge(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.training_retention_purge(uuid) TO service_role;

-- ---------------------------------------------------------------------------
-- Storage
-- ---------------------------------------------------------------------------

-- Private bucket for course images (courses/<courseId>/<sha256>.<ext>) and external certificate
-- files (external/<employeeId>/<uuid>.<ext>). No storage policies: service role only, served
-- through app routes that check who is asking. Same arrangement as signed-documents.
INSERT INTO storage.buckets (id, name, public)
VALUES ('training', 'training', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

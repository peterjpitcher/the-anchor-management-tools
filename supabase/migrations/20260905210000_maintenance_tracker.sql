-- Maintenance and improvements tracker: schema, RLS, storage and guaranteed history.
-- Source of truth: tasks/maintenance-tracker/spec-v2-2026-09-05.md, sections 2, 3 and 5.
--
-- Access is super-admin only, enforced with public.is_super_admin(auth.uid()).
-- There is deliberately NO permissions or role_permissions row and no `maintenance`
-- RBAC module: public.user_has_permission returns true for super-admins on any module,
-- so it can only express a floor, never a restriction.
--
-- This file is idempotent: every object is created with IF NOT EXISTS, seeds use
-- ON CONFLICT DO NOTHING, and policies and triggers are dropped before being created.

-- =====================================================================
-- 1. Areas
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_areas_name_length_check
    CHECK (length(btrim(name)) BETWEEN 1 AND 100)
);

COMMENT ON TABLE public.maintenance_areas IS
  'Areas of the pub a maintenance item can belong to. Soft delete only: set active = false. Items show the area current name, renames are not snapshotted.';

-- Unique on a normalised form: trimmed, whitespace collapsed, case insensitive.
CREATE UNIQUE INDEX IF NOT EXISTS maintenance_areas_name_normalised_key
  ON public.maintenance_areas (lower(regexp_replace(btrim(name), '\s+', ' ', 'g')));

CREATE INDEX IF NOT EXISTS maintenance_areas_active_sort_idx
  ON public.maintenance_areas (active, sort_order, name);

DROP TRIGGER IF EXISTS maintenance_areas_set_updated_at ON public.maintenance_areas;
CREATE TRIGGER maintenance_areas_set_updated_at
  BEFORE UPDATE ON public.maintenance_areas
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- The fifteen approved seed areas (spec 3.1).
INSERT INTO public.maintenance_areas (name, sort_order) VALUES
  ('Main Bar', 10),
  ('Dining Room', 20),
  ('Kitchen', 30),
  ('Cellar', 40),
  ('Toilets (Ladies)', 50),
  ('Toilets (Gents)', 60),
  ('Toilets (Accessible)', 70),
  ('Beer Garden and Terrace', 80),
  ('Car Park', 90),
  ('Exterior and Building', 100),
  ('Function Room', 110),
  ('Staff Areas', 120),
  ('Plant and Utilities', 130),
  ('Signage', 140),
  ('Other', 150)
ON CONFLICT DO NOTHING;

-- =====================================================================
-- 2. Reference sequence
-- =====================================================================

-- References are M-0001 upward. Beyond 9,999 the format widens naturally to
-- M-10000, it is never truncated. Gaps are expected and acceptable.
CREATE SEQUENCE IF NOT EXISTS public.maintenance_item_ref_seq
  AS bigint
  START WITH 1
  INCREMENT BY 1
  NO CYCLE;

-- Without this GRANT, an insert by a signed-in user fails with a permission error
-- that does not name the sequence, which is very hard to diagnose.
GRANT USAGE ON SEQUENCE public.maintenance_item_ref_seq TO authenticated;
GRANT USAGE ON SEQUENCE public.maintenance_item_ref_seq TO service_role;

-- lpad TRUNCATES when the input is longer than the target width, so a bare
-- lpad(n, 4, '0') turns 10000 into '1000', which item 1000 already holds. The
-- insert then fails on the unique index and never recovers, because reference is
-- immutable. This pads to four digits and widens beyond them instead. nextval is
-- called once, by the caller, so the value cannot be consumed twice.
CREATE OR REPLACE FUNCTION public.maintenance_format_reference(n bigint)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'M-' || CASE WHEN n < 10000 THEN lpad(n::text, 4, '0') ELSE n::text END
$$;

GRANT EXECUTE ON FUNCTION public.maintenance_format_reference(bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.maintenance_format_reference(bigint) TO service_role;

-- =====================================================================
-- 3. Items
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reference text NOT NULL DEFAULT public.maintenance_format_reference(nextval('public.maintenance_item_ref_seq')),
  kind text NOT NULL,
  title text NOT NULL,
  description text,
  area_id uuid NOT NULL REFERENCES public.maintenance_areas(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'reported',
  priority text NOT NULL DEFAULT 'medium',
  responsibility text NOT NULL DEFAULT 'to_confirm',
  -- The database runs in UTC. A plain current_date returns yesterday between
  -- midnight and 01:00 British Summer Time, so the London date is computed explicitly.
  reported_on date NOT NULL DEFAULT (timezone('Europe/London', now()))::date,
  target_date date,
  completed_on date,
  estimated_cost numeric(10,2),
  actual_cost numeric(10,2),
  contractor_name text,
  contractor_contact text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_items_reference_key UNIQUE (reference),
  CONSTRAINT maintenance_items_kind_check
    CHECK (kind IN ('issue', 'improvement')),
  CONSTRAINT maintenance_items_title_check
    CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  CONSTRAINT maintenance_items_description_check
    CHECK (description IS NULL OR length(description) <= 5000),
  CONSTRAINT maintenance_items_status_check
    CHECK (status IN ('reported', 'quoting', 'awaiting_landlord', 'scheduled', 'in_progress', 'on_hold', 'done', 'cancelled')),
  CONSTRAINT maintenance_items_priority_check
    CHECK (priority IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT maintenance_items_responsibility_check
    CHECK (responsibility IN ('us', 'greene_king', 'to_confirm')),
  CONSTRAINT maintenance_items_estimated_cost_check
    CHECK (estimated_cost IS NULL OR estimated_cost >= 0),
  CONSTRAINT maintenance_items_actual_cost_check
    CHECK (actual_cost IS NULL OR actual_cost >= 0),
  CONSTRAINT maintenance_items_contractor_name_check
    CHECK (contractor_name IS NULL OR length(contractor_name) <= 200),
  CONSTRAINT maintenance_items_contractor_contact_check
    CHECK (contractor_contact IS NULL OR length(contractor_contact) <= 200),
  -- status done requires a completion date, every other status forbids one.
  CONSTRAINT maintenance_items_completed_on_check
    CHECK ((status = 'done') = (completed_on IS NOT NULL)),
  CONSTRAINT maintenance_items_target_date_check
    CHECK (target_date IS NULL OR target_date >= reported_on)
);

COMMENT ON TABLE public.maintenance_items IS
  'Pub maintenance issues and improvements. Items are cancelled, never deleted: there is deliberately no DELETE policy and every child FK is RESTRICT.';
COMMENT ON COLUMN public.maintenance_items.status IS
  'Open means any status other than done and cancelled. awaiting_landlord displays as "With Greene King"; the stored value is tenancy neutral on purpose.';
COMMENT ON COLUMN public.maintenance_items.responsibility IS
  'Who pays. Separate from status, which answers what is happening now.';
COMMENT ON COLUMN public.maintenance_items.created_by_email IS
  'Server-derived snapshot of the reporter email. Never client supplied.';

CREATE INDEX IF NOT EXISTS maintenance_items_status_target_idx
  ON public.maintenance_items (status, target_date);

CREATE INDEX IF NOT EXISTS maintenance_items_area_idx
  ON public.maintenance_items (area_id);

CREATE INDEX IF NOT EXISTS maintenance_items_kind_status_idx
  ON public.maintenance_items (kind, status);

CREATE INDEX IF NOT EXISTS maintenance_items_created_at_idx
  ON public.maintenance_items (created_at DESC);

-- ---------------------------------------------------------------------
-- 3a. Normalisation, immutability and London date validation
-- ---------------------------------------------------------------------
-- Future dates cannot be rejected with a CHECK constraint, because a CHECK
-- expression may only call IMMUTABLE functions and "today in London" is not one.
-- The same trigger normalises blank strings to NULL on write.
CREATE OR REPLACE FUNCTION public.maintenance_items_normalise()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_today date := (timezone('Europe/London', now()))::date;
  v_check_area boolean := false;
BEGIN
  NEW.title := btrim(NEW.title);
  NEW.description := nullif(btrim(NEW.description), '');
  NEW.contractor_name := nullif(btrim(NEW.contractor_name), '');
  NEW.contractor_contact := nullif(btrim(NEW.contractor_contact), '');
  NEW.created_by_email := nullif(btrim(NEW.created_by_email), '');

  IF NEW.reported_on > v_today THEN
    RAISE EXCEPTION 'maintenance_items.reported_on cannot be in the future (today in London is %)', v_today
      USING ERRCODE = '22007';
  END IF;

  IF NEW.completed_on IS NOT NULL AND NEW.completed_on > v_today THEN
    RAISE EXCEPTION 'maintenance_items.completed_on cannot be in the future (today in London is %)', v_today
      USING ERRCODE = '22007';
  END IF;

  -- An inactive area stays visible on existing items but cannot be chosen for new
  -- ones, or moved onto an existing one. If an area is deactivated while a form is
  -- open, the save fails here rather than silently going through.
  -- OLD is only readable on UPDATE, hence the ELSIF rather than a combined test.
  IF TG_OP = 'INSERT' THEN
    v_check_area := true;
  ELSIF NEW.area_id IS DISTINCT FROM OLD.area_id THEN
    v_check_area := true;
  END IF;

  IF v_check_area AND NOT EXISTS (
    SELECT 1 FROM public.maintenance_areas a
    WHERE a.id = NEW.area_id AND a.active
  ) THEN
    RAISE EXCEPTION 'That area is no longer available. Pick another one.'
      USING ERRCODE = '23514';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.id <> OLD.id THEN
      RAISE EXCEPTION 'maintenance_items.id is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.reference IS DISTINCT FROM OLD.reference THEN
      RAISE EXCEPTION 'maintenance_items.reference is immutable' USING ERRCODE = '23514';
    END IF;
    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'maintenance_items.created_at is immutable' USING ERRCODE = '23514';
    END IF;
    -- created_by is immutable, but the FK is ON DELETE SET NULL, so a transition
    -- to NULL when the auth user is removed must still be allowed.
    IF OLD.created_by IS NOT NULL
       AND NEW.created_by IS NOT NULL
       AND NEW.created_by <> OLD.created_by THEN
      RAISE EXCEPTION 'maintenance_items.created_by is immutable' USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS maintenance_items_normalise_trg ON public.maintenance_items;
CREATE TRIGGER maintenance_items_normalise_trg
  BEFORE INSERT OR UPDATE ON public.maintenance_items
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_items_normalise();

-- updated_at is maintained by the database, never by the app.
DROP TRIGGER IF EXISTS maintenance_items_set_updated_at ON public.maintenance_items;
CREATE TRIGGER maintenance_items_set_updated_at
  BEFORE UPDATE ON public.maintenance_items
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- =====================================================================
-- 4. Notes, append only
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.maintenance_items(id) ON DELETE RESTRICT,
  content text NOT NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT maintenance_notes_content_check
    CHECK (length(btrim(content)) BETWEEN 1 AND 5000)
);

COMMENT ON TABLE public.maintenance_notes IS
  'Append-only audit trail per item. The FK is RESTRICT, not CASCADE: deleting an item must never silently erase its own trail.';

CREATE INDEX IF NOT EXISTS maintenance_notes_item_created_idx
  ON public.maintenance_notes (item_id, created_at DESC);

-- =====================================================================
-- 5. Photos
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.maintenance_items(id) ON DELETE RESTRICT,
  storage_path text NOT NULL,
  file_name text,
  mime_type text,
  file_size_bytes bigint,
  width integer,
  height integer,
  caption text,
  taken_on date,
  state text NOT NULL DEFAULT 'pending',
  uploaded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  uploaded_by_email text,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  redacted_at timestamptz,
  redacted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  redacted_by_email text,
  redaction_reason text,
  -- Confirm is idempotent on storage_path: a repeated confirm promotes the same
  -- row rather than creating a second one.
  CONSTRAINT maintenance_photos_storage_path_key UNIQUE (storage_path),
  CONSTRAINT maintenance_photos_state_check
    CHECK (state IN ('pending', 'ready', 'failed')),
  CONSTRAINT maintenance_photos_file_size_check
    CHECK (file_size_bytes IS NULL OR file_size_bytes > 0),
  CONSTRAINT maintenance_photos_width_check
    CHECK (width IS NULL OR width > 0),
  CONSTRAINT maintenance_photos_height_check
    CHECK (height IS NULL OR height > 0),
  CONSTRAINT maintenance_photos_caption_check
    CHECK (caption IS NULL OR length(caption) <= 500),
  CONSTRAINT maintenance_photos_mime_type_check
    CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  CONSTRAINT maintenance_photos_redaction_check
    CHECK ((redacted_at IS NULL) = (redacted_by_email IS NULL))
);

COMMENT ON TABLE public.maintenance_photos IS
  'Photo metadata. A row is created pending when the signed upload URL is issued and promoted to ready only after the server verifies the stored object. Only ready rows are read or displayed.';
COMMENT ON COLUMN public.maintenance_photos.storage_path IS
  'Path in the private maintenance-photos bucket, shaped {item_id}/{uuid}.{ext}. Never the original filename.';
COMMENT ON COLUMN public.maintenance_photos.redacted_at IS
  'Exceptional removal: the stored bytes are deleted, the metadata row is kept and marked redacted with who did it and when. Redaction is never presented as deletion.';

CREATE INDEX IF NOT EXISTS maintenance_photos_item_uploaded_idx
  ON public.maintenance_photos (item_id, uploaded_at DESC);

-- Drives the 24 hour cleanup pass over stale pending rows.
CREATE INDEX IF NOT EXISTS maintenance_photos_pending_idx
  ON public.maintenance_photos (uploaded_at)
  WHERE state = 'pending';

-- =====================================================================
-- 6. Item history, written by trigger in the same transaction
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.maintenance_item_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.maintenance_items(id) ON DELETE RESTRICT,
  changed_at timestamptz NOT NULL DEFAULT now(),
  changed_by uuid,
  changed_by_email text,
  field text NOT NULL,
  old_value text,
  new_value text
);

COMMENT ON TABLE public.maintenance_item_history IS
  'One row per changed field, written by a trigger in the same transaction as the change. If the history write fails, the change fails. logAuditEvent is not a substitute: it writes after commit and swallows its own errors.';
COMMENT ON COLUMN public.maintenance_item_history.changed_by IS
  'Deliberately not a foreign key to auth.users, so removing a user can never rewrite or block the audit trail.';

CREATE INDEX IF NOT EXISTS maintenance_item_history_item_changed_idx
  ON public.maintenance_item_history (item_id, changed_at DESC);

CREATE OR REPLACE FUNCTION public.maintenance_items_write_history()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_actor_email text;
  v_old jsonb;
  v_new jsonb;
  v_key text;
  v_old_value text;
  v_new_value text;
  -- Machine-maintained columns are not user-visible changes.
  v_ignored text[] := ARRAY['id', 'reference', 'created_at', 'updated_at'];
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT u.email::text INTO v_actor_email FROM auth.users u WHERE u.id = v_actor;
  END IF;

  -- Writes made by the service role record a system actor rather than a null.
  IF v_actor_email IS NULL THEN
    v_actor_email := 'system';
  END IF;

  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.maintenance_item_history
      (item_id, changed_by, changed_by_email, field, old_value, new_value)
    VALUES
      (NEW.id, v_actor, v_actor_email, 'created', NULL, NEW.reference);
    RETURN NULL;
  END IF;

  v_old := to_jsonb(OLD);
  v_new := to_jsonb(NEW);

  FOR v_key IN SELECT jsonb_object_keys(v_new)
  LOOP
    CONTINUE WHEN v_key = ANY (v_ignored);

    v_old_value := v_old ->> v_key;
    v_new_value := v_new ->> v_key;

    CONTINUE WHEN v_old_value IS NOT DISTINCT FROM v_new_value;

    INSERT INTO public.maintenance_item_history
      (item_id, changed_by, changed_by_email, field, old_value, new_value)
    VALUES
      (NEW.id, v_actor, v_actor_email, v_key, v_old_value, v_new_value);
  END LOOP;

  RETURN NULL;
END;
$$;

COMMENT ON FUNCTION public.maintenance_items_write_history() IS
  'Trigger function. SECURITY DEFINER so it can resolve the actor email from auth.users and insert history regardless of the caller RLS policies.';

DROP TRIGGER IF EXISTS maintenance_items_history_trg ON public.maintenance_items;
CREATE TRIGGER maintenance_items_history_trg
  AFTER INSERT OR UPDATE ON public.maintenance_items
  FOR EACH ROW EXECUTE FUNCTION public.maintenance_items_write_history();

-- =====================================================================
-- 7. Row level security, super-admin only on every table
-- =====================================================================

ALTER TABLE public.maintenance_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_photos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.maintenance_item_history ENABLE ROW LEVEL SECURITY;

-- Areas: soft delete only, so there is deliberately no DELETE policy.
DROP POLICY IF EXISTS "maintenance_areas_super_admin_select" ON public.maintenance_areas;
CREATE POLICY "maintenance_areas_super_admin_select"
ON public.maintenance_areas FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_areas_super_admin_insert" ON public.maintenance_areas;
CREATE POLICY "maintenance_areas_super_admin_insert"
ON public.maintenance_areas FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_areas_super_admin_update" ON public.maintenance_areas;
CREATE POLICY "maintenance_areas_super_admin_update"
ON public.maintenance_areas FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_areas_service_role_all" ON public.maintenance_areas;
CREATE POLICY "maintenance_areas_service_role_all"
ON public.maintenance_areas FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Items: cancelled, never deleted, so there is deliberately no DELETE policy.
DROP POLICY IF EXISTS "maintenance_items_super_admin_select" ON public.maintenance_items;
CREATE POLICY "maintenance_items_super_admin_select"
ON public.maintenance_items FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_items_super_admin_insert" ON public.maintenance_items;
CREATE POLICY "maintenance_items_super_admin_insert"
ON public.maintenance_items FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_items_super_admin_update" ON public.maintenance_items;
CREATE POLICY "maintenance_items_super_admin_update"
ON public.maintenance_items FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_items_service_role_all" ON public.maintenance_items;
CREATE POLICY "maintenance_items_service_role_all"
ON public.maintenance_items FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Notes: SELECT and INSERT only. There is deliberately NO UPDATE policy and NO
-- DELETE policy, so notes are append-only at the database layer.
DROP POLICY IF EXISTS "maintenance_notes_super_admin_select" ON public.maintenance_notes;
CREATE POLICY "maintenance_notes_super_admin_select"
ON public.maintenance_notes FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_notes_super_admin_insert" ON public.maintenance_notes;
CREATE POLICY "maintenance_notes_super_admin_insert"
ON public.maintenance_notes FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_notes_service_role_all" ON public.maintenance_notes;
CREATE POLICY "maintenance_notes_service_role_all"
ON public.maintenance_notes FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- Photos: UPDATE is needed to promote pending to ready and to record a redaction.
-- There is deliberately no DELETE policy: redaction keeps the metadata row.
DROP POLICY IF EXISTS "maintenance_photos_super_admin_select" ON public.maintenance_photos;
CREATE POLICY "maintenance_photos_super_admin_select"
ON public.maintenance_photos FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_photos_super_admin_insert" ON public.maintenance_photos;
CREATE POLICY "maintenance_photos_super_admin_insert"
ON public.maintenance_photos FOR INSERT TO authenticated
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_photos_super_admin_update" ON public.maintenance_photos;
CREATE POLICY "maintenance_photos_super_admin_update"
ON public.maintenance_photos FOR UPDATE TO authenticated
USING (public.is_super_admin(auth.uid()))
WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_photos_service_role_all" ON public.maintenance_photos;
CREATE POLICY "maintenance_photos_service_role_all"
ON public.maintenance_photos FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- History: read only for super-admins. Rows are written solely by the SECURITY
-- DEFINER trigger above, so there is deliberately no INSERT, UPDATE or DELETE
-- policy for authenticated.
DROP POLICY IF EXISTS "maintenance_item_history_super_admin_select" ON public.maintenance_item_history;
CREATE POLICY "maintenance_item_history_super_admin_select"
ON public.maintenance_item_history FOR SELECT TO authenticated
USING (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "maintenance_item_history_service_role_all" ON public.maintenance_item_history;
CREATE POLICY "maintenance_item_history_service_role_all"
ON public.maintenance_item_history FOR ALL TO service_role
USING (true) WITH CHECK (true);

-- =====================================================================
-- 8. Storage: private maintenance-photos bucket
-- =====================================================================

-- HEIC and HEIF are deliberately excluded: server-side HEIC decoding does not work
-- on the production runtime, and the browser normalises to JPEG before upload.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'maintenance-photos',
  'maintenance-photos',
  FALSE,
  10485760, -- 10MB
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "maintenance_photos_super_admin_storage_select" ON storage.objects;
CREATE POLICY "maintenance_photos_super_admin_storage_select"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'maintenance-photos'
  AND public.is_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "maintenance_photos_super_admin_storage_insert" ON storage.objects;
CREATE POLICY "maintenance_photos_super_admin_storage_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'maintenance-photos'
  AND public.is_super_admin(auth.uid())
);

DROP POLICY IF EXISTS "maintenance_photos_super_admin_storage_delete" ON storage.objects;
CREATE POLICY "maintenance_photos_super_admin_storage_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'maintenance-photos'
  AND public.is_super_admin(auth.uid())
);

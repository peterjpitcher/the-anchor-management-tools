-- Create performer submissions table for Open Mic performer interest sign-ups
-- Stores structured performer details (with consent) so the venue can shortlist and book acts.

-- 1) Enum types
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type WHERE typname = 'performer_submission_status'
  ) THEN
    CREATE TYPE public.performer_submission_status AS ENUM (
      'new',
      'shortlisted',
      'contacted',
      'booked',
      'not_a_fit',
      'do_not_contact'
    );
  END IF;
END $$;

-- 2) Table
CREATE TABLE IF NOT EXISTS public.performer_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  -- Core details
  full_name text NOT NULL,
  use_real_name boolean NOT NULL DEFAULT false,
  act_name text,
  email text NOT NULL,
  phone text NOT NULL,
  base_location text NOT NULL,

  performer_types text[] NOT NULL DEFAULT '{}'::text[],
  performer_type_other text,

  bio text NOT NULL,

  -- Links + socials
  links jsonb NOT NULL DEFAULT '{}'::jsonb,
  has_links boolean NOT NULL DEFAULT false,
  social_handles jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Extra profile fields
  experience_level text,
  pronouns text,
  accessibility_notes text,

  -- Availability (both query-friendly fields + a structured JSON blob for detail)
  availability_general text NOT NULL,
  can_start_around_8pm text NOT NULL,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,

  -- Set/content details
  set_length_minutes integer,
  content_rating text,
  music_originals_covers text,
  genres text[] NOT NULL DEFAULT '{}'::text[],

  -- Tech/logistics
  tech_needs jsonb NOT NULL DEFAULT '{}'::jsonb,
  tech_needs_other text,
  bring_own_gear text,
  setup_time_minutes integer,
  performer_count integer,
  special_requirements text,

  -- Consents
  consent_data_storage boolean NOT NULL,
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_media boolean NOT NULL DEFAULT false,

  -- Admin workflow
  status public.performer_submission_status NOT NULL DEFAULT 'new',
  internal_notes text,

  -- Metadata
  source text NOT NULL DEFAULT 'website_open_mic',
  submitted_ip text,
  user_agent text,

  CONSTRAINT performer_submissions_performer_types_nonempty CHECK (array_length(performer_types, 1) >= 1),
  CONSTRAINT performer_submissions_bio_length CHECK (char_length(bio) <= 800),
  CONSTRAINT performer_submissions_availability_general CHECK (availability_general IN ('weeknights', 'weekends', 'either')),
  CONSTRAINT performer_submissions_can_start_around_8pm CHECK (can_start_around_8pm IN ('yes', 'no', 'depends')),
  CONSTRAINT performer_submissions_content_rating CHECK (content_rating IS NULL OR content_rating IN ('family_friendly', 'mild_language', 'adults_only')),
  CONSTRAINT performer_submissions_music_originals_covers CHECK (music_originals_covers IS NULL OR music_originals_covers IN ('original', 'covers', 'mix')),
  CONSTRAINT performer_submissions_set_length_minutes CHECK (set_length_minutes IS NULL OR set_length_minutes IN (5, 10, 15, 20)),
  CONSTRAINT performer_submissions_setup_time_minutes CHECK (setup_time_minutes IS NULL OR setup_time_minutes >= 0),
  CONSTRAINT performer_submissions_performer_count CHECK (performer_count IS NULL OR performer_count >= 1),
  CONSTRAINT performer_submissions_consent_required CHECK (consent_data_storage = true)
);

-- 3) updated_at trigger
CREATE OR REPLACE FUNCTION public.performer_submissions_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS performer_submissions_set_updated_at_trigger ON public.performer_submissions;
CREATE TRIGGER performer_submissions_set_updated_at_trigger
BEFORE UPDATE ON public.performer_submissions
FOR EACH ROW
EXECUTE FUNCTION public.performer_submissions_set_updated_at();

-- 4) Indexes (filter/search)
CREATE INDEX IF NOT EXISTS idx_performer_submissions_created_at_desc
  ON public.performer_submissions (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_performer_submissions_status
  ON public.performer_submissions (status);

CREATE INDEX IF NOT EXISTS idx_performer_submissions_has_links
  ON public.performer_submissions (has_links)
  WHERE has_links = true;

CREATE INDEX IF NOT EXISTS idx_performer_submissions_performer_types_gin
  ON public.performer_submissions
  USING gin (performer_types);

-- 5) RLS
ALTER TABLE public.performer_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with performers view permission can view performer submissions" ON public.performer_submissions;
CREATE POLICY "Users with performers view permission can view performer submissions"
  ON public.performer_submissions
  FOR SELECT
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'performers', 'view'));

DROP POLICY IF EXISTS "Users with performers create permission can create performer submissions" ON public.performer_submissions;
CREATE POLICY "Users with performers create permission can create performer submissions"
  ON public.performer_submissions
  FOR INSERT
  TO authenticated
  WITH CHECK (public.user_has_permission(auth.uid(), 'performers', 'create'));

DROP POLICY IF EXISTS "Users with performers edit permission can update performer submissions" ON public.performer_submissions;
CREATE POLICY "Users with performers edit permission can update performer submissions"
  ON public.performer_submissions
  FOR UPDATE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'performers', 'edit'))
  WITH CHECK (public.user_has_permission(auth.uid(), 'performers', 'edit'));

DROP POLICY IF EXISTS "Users with performers delete permission can delete performer submissions" ON public.performer_submissions;
CREATE POLICY "Users with performers delete permission can delete performer submissions"
  ON public.performer_submissions
  FOR DELETE
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'performers', 'delete'));

-- 6) RBAC (permissions table)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'view'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'view', 'View performer submissions');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'create'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'create', 'Create performer submissions');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'edit'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'edit', 'Edit performer submissions (status, notes, etc.)');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'delete'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'delete', 'Delete performer submissions');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'export'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'export', 'Export performer submissions');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM permissions WHERE module_name = 'performers' AND action = 'manage'
  ) THEN
    INSERT INTO permissions (module_name, action, description)
    VALUES ('performers', 'manage', 'Full performer submissions management');
  END IF;
END $$;

DO $$
DECLARE
  super_admin_role_id uuid;
  manager_role_id uuid;
  staff_role_id uuid;
BEGIN
  SELECT id INTO super_admin_role_id FROM roles WHERE name = 'super_admin' LIMIT 1;
  SELECT id INTO manager_role_id FROM roles WHERE name = 'manager' LIMIT 1;
  SELECT id INTO staff_role_id FROM roles WHERE name = 'staff' LIMIT 1;

  -- super_admin: full access
  IF super_admin_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT super_admin_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'performers'
      AND p.action IN ('view', 'create', 'edit', 'delete', 'export', 'manage')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = super_admin_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- manager: all except delete
  IF manager_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT manager_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'performers'
      AND p.action IN ('view', 'create', 'edit', 'export', 'manage')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = manager_role_id AND rp.permission_id = p.id
      );
  END IF;

  -- staff: view only
  IF staff_role_id IS NOT NULL THEN
    INSERT INTO role_permissions (role_id, permission_id)
    SELECT staff_role_id, p.id
    FROM permissions p
    WHERE p.module_name = 'performers'
      AND p.action IN ('view')
      AND NOT EXISTS (
        SELECT 1 FROM role_permissions rp
        WHERE rp.role_id = staff_role_id AND rp.permission_id = p.id
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_permissions_performers_module
  ON permissions(module_name)
  WHERE module_name = 'performers';


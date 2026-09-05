-- Isolated PostgreSQL only.
\set ON_ERROR_STOP on
BEGIN;
CREATE TABLE public.system_settings(key text PRIMARY KEY, value jsonb NOT NULL, description text, updated_at timestamptz);
\ir ../../tasks/anchor-booking-growth/christmas-course-activate.sql
DO $$ BEGIN ASSERT (SELECT value='{"value":true}'::jsonb FROM system_settings WHERE key='christmas_course_policy_enabled'); END $$;
\ir ../../tasks/anchor-booking-growth/christmas-course-disable.sql
DO $$ BEGIN ASSERT (SELECT value='{"value":false}'::jsonb FROM system_settings WHERE key='christmas_course_policy_enabled'); END $$;
ROLLBACK;

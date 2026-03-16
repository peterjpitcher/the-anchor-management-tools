-- Drop the hardcoded department check on rota_shift_templates.
-- The departments table is now the source of truth for valid department names,
-- so a static IN list is too restrictive (same fix already applied to rota_shifts
-- in 20260301120000_rota_shifts_drop_department_check.sql).
-- Migration 20260306000001 widened this to include 'runner'; this completes the
-- job by removing the constraint entirely.

ALTER TABLE public.rota_shift_templates
  DROP CONSTRAINT IF EXISTS rota_shift_templates_department_check;

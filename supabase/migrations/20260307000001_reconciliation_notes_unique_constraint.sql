-- Migration: add unique constraint to reconciliation_notes(entity_type, entity_id)
--
-- The existing non-unique index is replaced by a unique constraint (which
-- creates an equivalent index implicitly). This allows upsertShiftNote to use
-- an atomic INSERT ... ON CONFLICT DO UPDATE instead of the backup-restore
-- delete-then-insert pattern.
--
-- One note per entity is the intended design: a shift, session, employee-day,
-- week, or month has at most one reconciliation note at a time.

-- Drop the non-unique index first to avoid duplicate index overhead
DROP INDEX IF EXISTS idx_reconciliation_notes_entity;

-- Add the unique constraint (implicitly creates a unique index with the same coverage)
ALTER TABLE public.reconciliation_notes
  ADD CONSTRAINT reconciliation_notes_entity_unique UNIQUE (entity_type, entity_id);

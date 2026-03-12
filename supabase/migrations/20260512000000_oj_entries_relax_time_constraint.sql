-- Relax oj_entries CHECK constraint to allow NULL start_at/end_at for time entries.
-- Previously time entries required start_at and end_at. Going forward, only
-- duration_minutes_rounded is required; timestamps are optional (preserved for
-- historical entries only).
--
-- Only the 'time' branch changes. Mileage and one_off branches are identical to
-- the constraint set in 20260226120000_oj_entries_one_off.sql.

ALTER TABLE public.oj_entries
  DROP CONSTRAINT IF EXISTS chk_oj_entries_time_fields;

ALTER TABLE public.oj_entries
  ADD CONSTRAINT chk_oj_entries_time_fields
  CHECK (
    (
      entry_type = 'time'
      AND duration_minutes_rounded IS NOT NULL
      AND miles IS NULL
      AND (start_at IS NULL) = (end_at IS NULL)  -- both set or both NULL, never partial
    )
    OR (
      entry_type = 'mileage'
      AND miles IS NOT NULL
      AND start_at IS NULL
      AND end_at IS NULL
      AND duration_minutes_rounded IS NULL
    )
    OR (
      entry_type = 'one_off'
      AND amount_ex_vat_snapshot IS NOT NULL
      AND miles IS NULL
      AND start_at IS NULL
      AND end_at IS NULL
      AND duration_minutes_rounded IS NULL
    )
  );

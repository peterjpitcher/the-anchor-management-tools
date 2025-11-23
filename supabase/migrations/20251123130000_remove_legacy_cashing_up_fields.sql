-- Drop the unused cashup_config table
DROP TABLE IF EXISTS cashup_config;

-- Drop the view first because we cannot remove columns via CREATE OR REPLACE
DROP VIEW IF EXISTS cashup_weekly_view;

-- Recreate the cashup_weekly_view to remove shift_code
CREATE VIEW cashup_weekly_view AS
SELECT
    cs.site_id,
    date_trunc('week', cs.session_date)::date AS week_start_date,
    cs.session_date,
    cs.status,
    cs.total_expected_amount,
    cs.total_counted_amount,
    cs.total_variance_amount
FROM cashup_sessions cs;

-- Drop the old unique index that includes shift_code
DROP INDEX IF EXISTS cashup_sessions_site_date_shift_idx;

-- Alter the cashup_sessions table to remove legacy fields
ALTER TABLE cashup_sessions
DROP COLUMN IF EXISTS workbook_payload,
DROP COLUMN IF EXISTS shift_code;

-- Create a new, simpler unique index
CREATE UNIQUE INDEX cashup_sessions_site_id_session_date_idx ON cashup_sessions (site_id, session_date);
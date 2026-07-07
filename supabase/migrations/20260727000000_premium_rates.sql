-- Premium hourly rates (time-and-a-half / double-time / bespoke) — Foundation
--
-- Adds dormant premium-rate columns to the three tables the pay pipeline touches.
-- The feature ships DORMANT: while every premium column is NULL, effective rate is
-- ×1.0 and pay is unchanged from today's behaviour.
--
-- Semantics (see tasks/premium-rate-spec.md §4):
--   * NULL rate_multiplier AND NULL rate_override  => no premium (×1.0)
--   * rate_override wins over rate_multiplier when both are set
--   * NULL window (start/end) with a premium set    => premium applies to the whole shift/session
--   * rota_shifts / rota_published_shifts store the window as time-of-day, interpreted on
--     shift_date honouring is_overnight; timeclock_sessions store it as timestamptz to keep
--     the paid path unambiguous across midnight.
--
-- ADD COLUMN IF NOT EXISTS throughout so the migration is safe to re-run.
-- No RLS change (existing authenticated policies already allow manager writes; gating is
-- enforced server-side). No data backfill.

-- rota_shifts: premium set at rota-scheduling time (Requirement 1, captured).
ALTER TABLE public.rota_shifts
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2)
    CHECK (rate_multiplier IS NULL OR rate_multiplier BETWEEN 1.0 AND 3.0),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2)
    CHECK (rate_override IS NULL OR (rate_override > 0 AND rate_override <= 100)),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_time time,   -- NULL = whole shift
  ADD COLUMN IF NOT EXISTS premium_end_time   time;

-- rota_published_shifts: mirror all five so the published snapshot (and staff portal) can
-- display the premium the employee was scheduled for (Requirement 1, shown).
ALTER TABLE public.rota_published_shifts
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_time time,
  ADD COLUMN IF NOT EXISTS premium_end_time   time;

-- timeclock_sessions: manager changes rate/window at review; authoritative for pay
-- (Requirement 2). Window stored as timestamptz to avoid any overnight ambiguity on the
-- paid path.
ALTER TABLE public.timeclock_sessions
  ADD COLUMN IF NOT EXISTS rate_multiplier numeric(4,2)
    CHECK (rate_multiplier IS NULL OR rate_multiplier BETWEEN 1.0 AND 3.0),
  ADD COLUMN IF NOT EXISTS rate_override numeric(6,2)
    CHECK (rate_override IS NULL OR (rate_override > 0 AND rate_override <= 100)),
  ADD COLUMN IF NOT EXISTS premium_reason text,
  ADD COLUMN IF NOT EXISTS premium_start_at timestamptz,   -- NULL = whole session
  ADD COLUMN IF NOT EXISTS premium_end_at   timestamptz;

-- Two indexes for cron_job_runs (page load performance spec, D3, 18 November 2026).
--
-- The table had only its primary key and (job_name, run_key), so two frequent reads scanned all
-- of it (68,749 rows, 22 MB, checked 18 November 2026):
--   * the lock check in the parking-notifications and event-guest-engagement crons,
--     `where job_name = $1 and status = 'running' order by started_at desc limit 1`
--     (17,906 calls, mean 665 ms, worst 7.3 s);
--   * the dashboard health count, `where status = 'failed' and created_at >= $1` (mean 880 ms).
--
-- Additive only: no data, grants or functions change. Plain CREATE INDEX (not CONCURRENTLY,
-- which cannot run inside the migration transaction); on a table this size the build takes
-- well under a second.

create index if not exists idx_cron_job_runs_job_status_started
  on public.cron_job_runs (job_name, status, started_at desc);

create index if not exists idx_cron_job_runs_status_created
  on public.cron_job_runs (status, created_at desc);

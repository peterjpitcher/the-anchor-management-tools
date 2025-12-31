# Hiring CV Upload: Job Processing Stuck in "processing"

## Summary
CV uploads enqueue background jobs (parse + screen). Jobs frequently remain in the "processing" state indefinitely. This blocks downstream workflows and keeps the UI in a persistent "processing" state.

## Impact
- Hiring uploads appear to never finish.
- Candidates do not get parsed/screened, leaving incomplete records.
- Admins cannot tell if a job is actually running or stuck.

## Symptoms Observed
- After uploading a CV, UI stays in a "processing" state and does not settle.
- Background jobs page shows stuck jobs in `processing`.
- Dev logs show periodic "No pending jobs found" while stuck `processing` rows remain.
- Occasional warnings such as:
  - `Failed to generate cache key for https://.../storage/v1/object/hiring-docs/...`
  - `Upload CV failed: Error: Already applied for this role` (separate issue, now addressed)

## Steps to Reproduce (Dev)
1. `npm run dev`
2. Go to `/hiring` and open "Add Candidate".
3. Upload a CV (PDF/DOCX).
4. Observe the upload appears to stall; the job remains in `processing`.

## Expected vs Actual
- Expected: CV upload enqueues a parse job, job completes (or fails) within minutes, status updates.
- Actual: Job status stays `processing` indefinitely.

## Environment
- Next.js App Router (Next 15).
- Supabase Postgres job queue table `public.jobs`.
- Parsing uses Puppeteer + PDF.js + OpenAI.
- Job processor triggered via `/api/jobs/process` (cron) or manual triggers.

## Relevant Code Paths
- Upload flow:
  - `src/actions/hiring.ts` -> `processResumeUpload()` -> `submitApplication()` -> `jobQueue.enqueue('parse_cv', ...)`
- Job processing:
  - `src/lib/unified-job-queue.ts`
  - `processJobs()` -> `processJob()` -> `executeJob('parse_cv')`
- CV parsing:
  - `src/lib/hiring/parsing.ts`
  - Uses Puppeteer + PDF.js, downloads resume from Supabase Storage or URL.

## Suspected Root Causes
1. **Worker termination after claim**
   - Jobs were previously set to `processing` inside a request handler.
   - If the request was terminated (timeout, crash), the row stayed `processing` indefinitely.

2. **Non-atomic claim + overlapping invocations**
   - Without `FOR UPDATE SKIP LOCKED`, two workers can claim the same job.
   - Manual triggers and cron can overlap, leading to race conditions.

3. **No lease/heartbeat or processing token (historically)**
   - The job queue had no lease expiry or heartbeat for stale recovery.
   - Completion updates were not guarded against “zombie” workers.

4. **Parsing pipeline can hang**
   - Puppeteer + PDF rendering can block indefinitely on malformed/large documents.
   - Network calls (storage/OpenAI) can also stall without cancellation.

5. **Inline processing in the upload action (historically)**
   - The upload action previously called `jobQueue.processJobs(1)` inline.
   - If the request timed out, jobs were left in `processing`.

## Current Mitigations Applied in Code
1. CV upload no longer forces immediate processing.
   - Upload now enqueues jobs only and returns.
   - Location: `src/actions/hiring.ts`
2. Atomic job claiming + lease/heartbeat + processing token (requires migration).
   - Jobs are claimed via RPC using `FOR UPDATE SKIP LOCKED`.
   - Each job gets a `processing_token` and lease expiry; heartbeats extend the lease.
   - Completion/failure updates are guarded by the token.
   - Location: `src/lib/unified-job-queue.ts`
   - Migration: `supabase/migrations/20260414000000_job_queue_claiming.sql`
3. Added queue safety in unified job queue.
   - Reset stale `processing` jobs to `pending` (or `failed` if max attempts).
   - Added execution timeout per job.
   - Location: `src/lib/unified-job-queue.ts`
   - Env overrides:
     - `JOB_QUEUE_STALE_MINUTES` (default 30)
     - `JOB_QUEUE_TIMEOUT_MS` (default 120000)
     - `JOB_QUEUE_LEASE_SECONDS` (default derived from timeout)
     - `JOB_QUEUE_HEARTBEAT_MS` (default 30000)

## Open Questions / What We Need Advice On
1. Best-practice queue strategy for long-running parsing jobs (Puppeteer + OpenAI).
2. Recommended lock/lease mechanism in Supabase (SQL or RLS policy) to avoid double-processing.
3. How to design "at-least-once" semantics with idempotency for parse/screen steps.
4. Whether to split parsing into a dedicated worker (outside Next) and avoid inline processing entirely.

## Questions to Answer First (to stop guessing)
1. Where does the job processor actually run in production?
   - Vercel Function (Route Handler), long-running Node process (Docker/VM), Supabase Edge Function, something else?
2. How is `/api/jobs/process` triggered and how often?
   - Vercel Cron, Supabase Cron, external scheduler, manual only?
   - Any chance you have multiple schedulers calling it?
3. Do you ever run more than one worker concurrently?
   - e.g. multiple Vercel invocations overlapping, or running `/api/jobs/process-now` while cron is running.
4. When a job is "stuck", what do `started_at` and `updated_at` look like?
   - Specifically: does `updated_at` keep moving (because of a trigger), or does it freeze at the moment you set processing?
5. What is your exact "claim" logic today?
   - Is it "select pending then update", or a single atomic update/CTE with row locking (`FOR UPDATE SKIP LOCKED`)?
6. How are you enforcing `JOB_QUEUE_TIMEOUT_MS`?
   - Is it a `Promise.race()` timeout wrapper, or are you actually aborting work (closing Puppeteer, aborting fetch/OpenAI, terminating PDF render)?
7. Do you see function timeouts/termination in logs around stuck jobs?
   - For example: 504s, `FUNCTION_INVOCATION_TIMEOUT`, or abrupt termination of the route invocation.
8. What's the distribution of runtimes for `parse_cv`?
   - p50 / p95 / max (the tail matters for lease/timeout design).
9. What's the schema of `public.jobs` (columns + indexes + triggers)?
   - Especially: do you have `locked_by`/`worker_id`, `lease_expires_at`, `last_heartbeat_at`, `run_at`, and an `updated_at` trigger?
10. About the warning `Failed to generate cache key for https://.../storage/v1/object/...`:
    - Where is that produced (which file/function)?
    - Are you using `unstable_cache()` / React `cache()` / Next fetch caching around the storage download?

## Data to Collect for Diagnosis
Run against Supabase (service role):
```sql
-- Stuck processing jobs
select id, type, status, attempts, max_attempts, started_at, updated_at
from jobs
where status = 'processing'
order by started_at asc;

-- Average runtime if completed
select type, count(*), avg(extract(epoch from (completed_at - started_at))) as avg_seconds
from jobs
where status = 'completed' and started_at is not null
group by type
order by avg_seconds desc;
```

## Additional Notes
- There were prior edge build issues (`fs/path/http` module not found) when `instrumentation.ts` imported the job queue; this was removed to keep edge bundles clean.
- If needed, a dedicated worker can be run via `GET /api/jobs/process-now` or a script such as `scripts/process-jobs.ts`.

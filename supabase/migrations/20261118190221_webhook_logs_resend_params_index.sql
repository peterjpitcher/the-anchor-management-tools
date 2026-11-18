-- Resend webhook claim lookups (page load performance spec, D4, 18 November 2026).
--
-- src/app/api/webhooks/resend/route.ts reads and updates its claim row with
-- `webhook_type = 'resend' and params @> '{"svix_id": ...}'`. No index served `@>`, so each
-- call read every Resend row through the webhook_type index and filtered 30,597 rows:
-- 25,342 updates, mean 256 ms, worst 7.8 s (pg_stat_statements), 1,828 ms cold in a live
-- EXPLAIN ANALYZE. The unique index on (params->>'svix_id') cannot serve `@>`.
--
-- A GIN jsonb_path_ops index on params, limited to Resend rows, serves the existing filter
-- unchanged, so no application code changes. Additive only.

create index if not exists idx_webhook_logs_resend_params
  on public.webhook_logs using gin (params jsonb_path_ops)
  where webhook_type = 'resend';

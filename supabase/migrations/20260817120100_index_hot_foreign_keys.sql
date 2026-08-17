-- Index the foreign keys that production is demonstrably scanning sequentially.
--
-- The advisor lists 224 unindexed foreign keys. Most are harmless: an index nobody
-- reads still costs write time on every insert and update, so this migration only
-- covers the ones with measured seq-scan pressure in pg_stat_user_tables:
--
--   cashup_payment_breakdowns  8,340 rows   115,753 seq scans   934,397,399 rows read   idx_scan 2
--   cashup_cash_counts        11,395 rows    29,101 seq scans   316,407,368 rows read   idx_scan 2
--
-- Both tables carry nothing but a primary key, and both are read by cashup session,
-- so every single lookup reads the whole table. Between them that is 1.25 billion
-- rows read to answer queries that should touch a handful.
--
-- Built without CONCURRENTLY on purpose. The migration runner wraps each file in a
-- transaction and CREATE INDEX CONCURRENTLY cannot run inside one. These tables hold
-- 8,340 and 11,395 rows, so the build is a few milliseconds and the brief write lock
-- is not worth the added complexity of running these outside the migration flow.

create index if not exists idx_cashup_payment_breakdowns_session
  on public.cashup_payment_breakdowns (cashup_session_id);

create index if not exists idx_cashup_cash_counts_session
  on public.cashup_cash_counts (cashup_session_id);

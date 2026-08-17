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
-- concurrently is deliberate so the build takes no write lock on a live table, and
-- is why each statement stands alone rather than inside a transaction. Supabase's
-- migration runner does not wrap these in a transaction block.

create index concurrently if not exists idx_cashup_payment_breakdowns_session
  on public.cashup_payment_breakdowns (cashup_session_id);

create index concurrently if not exists idx_cashup_cash_counts_session
  on public.cashup_cash_counts (cashup_session_id);

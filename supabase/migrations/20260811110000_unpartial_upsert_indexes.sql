-- Make the two upsert conflict targets inferrable, so importMissedMessages can
-- actually import.
--
-- Both indexes were partial:
--   idx_customers_mobile_e164      ... WHERE mobile_e164 IS NOT NULL
--   messages_twilio_sid_unique_idx ... WHERE twilio_message_sid IS NOT NULL
--
-- Postgres will not infer a partial index from an ON CONFLICT column list unless
-- the statement repeats the index predicate, and PostgREST never emits one. So
-- every upsert naming these columns raised 42P10 and aborted, which is why
-- importMissedMessages had never imported anything.
--
-- Dropping the conflict target is NOT a fix, and was tried: PostgREST falls back
-- to the primary key columns, so the statement becomes ON CONFLICT (id) DO
-- NOTHING. The imported rows carry no id, so nothing would ever conflict and
-- duplicate customers and messages would be inserted silently.
--
-- A plain unique index is the right shape here. Postgres treats NULLs as
-- distinct in a unique index by default, so rows with a NULL mobile_e164 or a
-- NULL twilio_message_sid are still unconstrained, exactly as the partial
-- predicate intended. The only behaviour that changes is that the index can now
-- be inferred.

-- Verified before writing: no duplicate non-null values exist in either column,
-- so both indexes rebuild without a uniqueness violation.

drop index if exists public.idx_customers_mobile_e164;
create unique index idx_customers_mobile_e164
  on public.customers (mobile_e164);

drop index if exists public.messages_twilio_sid_unique_idx;
create unique index messages_twilio_sid_unique_idx
  on public.messages (twilio_message_sid);

-- Event link click counts (EventService.getEvents) read short_links by
-- metadata->>'event_id' IN (...). Without an index every read was a sequential
-- scan of the whole table.
--
-- The predicate is "is not null" rather than "metadata ? 'event_id'": the
-- planner cannot prove the ? operator from an IN on the extracted text, so a
-- "?" partial index is never used by this query. Both predicates cover the same
-- rows today (1,306 of 3,492 on 18 November 2026, every event_id a JSON string).
create index if not exists idx_short_links_event_id
  on public.short_links ((metadata->>'event_id'))
  where (metadata->>'event_id') is not null;

-- Dedupe existing short_links that share the same destination_url.
-- Creates aliases for removed short_codes, moves all click records onto a single canonical short link per destination,
-- then recomputes counters.
--
-- Canonical selection (per destination_url):
--   1) Most clicks (based on short_link_clicks)
--   2) Oldest created_at
--   3) Lowest id (stable tiebreak)

-- Trim whitespace to avoid "phantom duplicates" created by accidental spaces.
update public.short_links
set destination_url = btrim(destination_url)
where destination_url <> btrim(destination_url);

-- Re-point click rows from duplicates onto their canonical short link.
with click_stats as (
  select
    sl.id,
    sl.short_code,
    sl.destination_url,
    sl.created_at,
    sl.expires_at,
    count(slc.id) as clicks
  from public.short_links sl
  left join public.short_link_clicks slc on slc.short_link_id = sl.id
  group by sl.id, sl.short_code, sl.destination_url, sl.created_at, sl.expires_at
),
ranked as (
  select
    id,
    short_code,
    destination_url,
    first_value(id) over (
      partition by destination_url
      order by
        case when expires_at is not null and expires_at < now() then 1 else 0 end asc,
        clicks desc,
        created_at asc,
        id asc
    ) as canonical_id
  from click_stats
),
dupes as (
  select id as duplicate_id, short_code as duplicate_code, canonical_id
  from ranked
  where id <> canonical_id
)
insert into public.short_link_aliases (alias_code, short_link_id)
select d.duplicate_code, d.canonical_id
from dupes d
on conflict (alias_code) do nothing;

with click_stats as (
  select
    sl.id,
    sl.destination_url,
    sl.created_at,
    sl.expires_at,
    count(slc.id) as clicks
  from public.short_links sl
  left join public.short_link_clicks slc on slc.short_link_id = sl.id
  group by sl.id, sl.destination_url, sl.created_at, sl.expires_at
),
ranked as (
  select
    id,
    destination_url,
    first_value(id) over (
      partition by destination_url
      order by
        case when expires_at is not null and expires_at < now() then 1 else 0 end asc,
        clicks desc,
        created_at asc,
        id asc
    ) as canonical_id
  from click_stats
),
dupes as (
  select id as duplicate_id, canonical_id
  from ranked
  where id <> canonical_id
)
update public.short_link_clicks slc
set short_link_id = d.canonical_id
from dupes d
where slc.short_link_id = d.duplicate_id;

-- Delete the duplicate short_links rows (clicks have been moved).
with click_stats as (
  select
    sl.id,
    sl.destination_url,
    sl.created_at,
    sl.expires_at,
    count(slc.id) as clicks
  from public.short_links sl
  left join public.short_link_clicks slc on slc.short_link_id = sl.id
  group by sl.id, sl.destination_url, sl.created_at, sl.expires_at
),
ranked as (
  select
    id,
    destination_url,
    first_value(id) over (
      partition by destination_url
      order by
        case when expires_at is not null and expires_at < now() then 1 else 0 end asc,
        clicks desc,
        created_at asc,
        id asc
    ) as canonical_id
  from click_stats
),
dupes as (
  select id as duplicate_id
  from ranked
  where id <> canonical_id
)
delete from public.short_links sl
using dupes d
where sl.id = d.duplicate_id;

-- Recompute click_count and last_clicked_at from short_link_clicks (post-dedupe).
update public.short_links sl
set
  click_count = coalesce(c.click_count, 0),
  last_clicked_at = c.last_clicked_at,
  updated_at = timezone('utc', now())
from (
  select
    sl_inner.id as short_link_id,
    count(slc.id) as click_count,
    max(slc.clicked_at) as last_clicked_at
  from public.short_links sl_inner
  left join public.short_link_clicks slc on sl_inner.id = slc.short_link_id
  group by sl_inner.id
) c
where sl.id = c.short_link_id;

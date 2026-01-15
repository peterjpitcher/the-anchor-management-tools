-- Backfill click_count and last_clicked_at from short_link_clicks
-- This recovers counts that were missed while increment_short_link_clicks was failing.
update public.short_links sl
set
  click_count = coalesce(c.click_count, 0),
  last_clicked_at = c.last_clicked_at,
  updated_at = timezone('utc', now())
from (
  select
    sl_inner.id as short_link_id,
    count(slc.short_link_id) as click_count,
    max(slc.clicked_at) as last_clicked_at
  from public.short_links sl_inner
  left join public.short_link_clicks slc on sl_inner.id = slc.short_link_id
  group by sl_inner.id
) c
where sl.id = c.short_link_id;


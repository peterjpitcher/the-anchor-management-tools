-- Backfill click_count and last_clicked_at from short_link_clicks
update public.short_links sl
set click_count = coalesce(c.cnt, 0),
    last_clicked_at = c.last_clicked_at
from (
  select short_link_id,
         count(*) as cnt,
         max(clicked_at) as last_clicked_at
  from public.short_link_clicks
  group by short_link_id
) c
where sl.id = c.short_link_id;

-- Ensure links with no clicks have 0
update public.short_links
set click_count = 0
where click_count is null;


-- Ensure click counters are updated atomically when tracking short link hits
create or replace function public.increment_short_link_clicks(
  p_short_link_id uuid
)
returns table(click_count integer, last_clicked_at timestamptz) as $$
begin
  return query
    update public.short_links
    set
      click_count = coalesce(click_count, 0) + 1,
      last_clicked_at = timezone('utc', now()),
      updated_at = timezone('utc', now())
    where id = p_short_link_id
    returning click_count, last_clicked_at;
end;
$$ language plpgsql
security definer;

grant execute on function public.increment_short_link_clicks(uuid) to service_role;

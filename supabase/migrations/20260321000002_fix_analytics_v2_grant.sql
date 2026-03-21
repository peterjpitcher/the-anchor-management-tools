-- Re-grant execute on the extended analytics v2 function.
-- The DROP + CREATE in the previous migration removed the original GRANT.
grant execute on function public.get_all_links_analytics_v2(timestamptz, timestamptz, text, boolean, text)
  to authenticated, service_role;

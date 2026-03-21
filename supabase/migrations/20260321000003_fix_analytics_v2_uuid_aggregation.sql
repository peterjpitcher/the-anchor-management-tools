-- Fix: max(uuid) does not exist in PostgreSQL.
-- Move UUID columns (short_link_id, link_parent_id) into GROUP BY instead of using max().
drop function if exists public.get_all_links_analytics_v2(timestamptz, timestamptz, text, boolean, text);

create or replace function public.get_all_links_analytics_v2(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_granularity text,
  p_include_bots boolean default false,
  p_timezone text default 'Europe/London'
)
returns table (
  id uuid,
  short_code varchar,
  link_type varchar,
  destination_url text,
  name varchar,
  parent_link_id uuid,
  metadata jsonb,
  created_at timestamptz,
  click_dates timestamptz[],
  click_counts bigint[],
  total_clicks bigint,
  unique_visitors bigint
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_granularity text := lower(coalesce(p_granularity, 'hour'));
  v_timezone text := coalesce(nullif(p_timezone, ''), 'Europe/London');
  v_step interval;
begin
  if p_start_at is null or p_end_at is null then
    raise exception 'p_start_at and p_end_at are required';
  end if;

  if p_end_at <= p_start_at then
    raise exception 'p_end_at must be greater than p_start_at';
  end if;

  if v_granularity not in ('hour', 'day', 'week', 'month') then
    raise exception 'Invalid p_granularity: %', p_granularity;
  end if;

  v_step := case v_granularity
    when 'hour' then interval '1 hour'
    when 'day' then interval '1 day'
    when 'week' then interval '1 week'
    else interval '1 month'
  end;

  return query
  with bounds as (
    select
      date_trunc(v_granularity, p_start_at at time zone v_timezone) as start_local,
      date_trunc(v_granularity, (p_end_at - interval '1 millisecond') at time zone v_timezone) as end_local
  ),
  bucket_series as (
    select gs as bucket_local
    from bounds b,
    generate_series(b.start_local, b.end_local, v_step) gs
  ),
  link_totals as (
    select
      sl.id as short_link_id,
      sl.short_code,
      sl.link_type,
      sl.destination_url,
      sl.name as link_name,
      sl.parent_link_id as link_parent_id,
      sl.metadata as link_metadata,
      sl.created_at as link_created_at,
      count(slc.id)::bigint as total_clicks,
      count(distinct slc.ip_address)::bigint as unique_visitors
    from public.short_links sl
    inner join public.short_link_clicks slc
      on sl.id = slc.short_link_id
    where slc.clicked_at >= p_start_at
      and slc.clicked_at < p_end_at
      and (p_include_bots or slc.device_type is distinct from 'bot')
    group by sl.id, sl.short_code, sl.link_type, sl.destination_url,
             sl.name, sl.parent_link_id, sl.metadata, sl.created_at
  ),
  link_bucket_counts as (
    select
      slc.short_link_id,
      date_trunc(v_granularity, slc.clicked_at at time zone v_timezone) as bucket_local,
      count(*)::bigint as bucket_clicks
    from public.short_link_clicks slc
    where slc.clicked_at >= p_start_at
      and slc.clicked_at < p_end_at
      and (p_include_bots or slc.device_type is distinct from 'bot')
    group by slc.short_link_id, date_trunc(v_granularity, slc.clicked_at at time zone v_timezone)
  ),
  per_link_bucket as (
    select
      lt.short_link_id,
      lt.short_code,
      lt.link_type,
      lt.destination_url,
      lt.link_name,
      lt.link_parent_id,
      lt.link_metadata,
      lt.link_created_at,
      lt.total_clicks,
      lt.unique_visitors,
      bs.bucket_local,
      coalesce(lbc.bucket_clicks, 0)::bigint as bucket_clicks
    from link_totals lt
    cross join bucket_series bs
    left join link_bucket_counts lbc
      on lbc.short_link_id = lt.short_link_id
     and lbc.bucket_local = bs.bucket_local
  )
  select
    plb.short_link_id as id,
    plb.short_code,
    plb.link_type,
    plb.destination_url,
    plb.link_name as name,
    plb.link_parent_id as parent_link_id,
    plb.link_metadata as metadata,
    plb.link_created_at as created_at,
    array_agg((plb.bucket_local at time zone v_timezone) order by plb.bucket_local),
    array_agg(plb.bucket_clicks order by plb.bucket_local),
    max(plb.total_clicks),
    max(plb.unique_visitors)
  from per_link_bucket plb
  group by plb.short_link_id, plb.short_code, plb.link_type, plb.destination_url,
           plb.link_name, plb.link_parent_id, plb.link_metadata, plb.link_created_at
  order by max(plb.total_clicks) desc, plb.short_code asc;
end;
$$;

grant execute on function public.get_all_links_analytics_v2(timestamptz, timestamptz, text, boolean, text)
  to authenticated, service_role;

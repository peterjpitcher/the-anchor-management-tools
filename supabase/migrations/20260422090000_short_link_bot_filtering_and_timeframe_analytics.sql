-- Human-first short link analytics with conservative bot filtering and advanced timeframe bucketing.

create or replace function public.short_link_is_known_bot(
  p_user_agent text,
  p_device_type text default null
)
returns boolean
language sql
immutable
as $$
  select
    coalesce(lower(p_device_type), '') = 'bot'
    or (
      p_user_agent is not null
      and btrim(p_user_agent) <> ''
      and lower(p_user_agent) ~ '(facebookexternalhit|facebot|twitterbot|linkedinbot|slackbot(?:-linkexpanding)?|discordbot|whatsapp(?:/| )|telegrambot|skypeuripreview|googlebot|adsbot-google|bingbot|bingpreview|applebot|duckduckbot|baiduspider|yandexbot|petalbot|semrushbot|ahrefsbot|mj12bot|dotbot|bytespider|headlesschrome)'
    );
$$;

-- Backfill historical clicks to mark known bot traffic explicitly.
update public.short_link_clicks slc
set device_type = 'bot'
where slc.device_type is distinct from 'bot'
  and public.short_link_is_known_bot(slc.user_agent, slc.device_type);

-- Recompute reporting counters from human traffic only.
update public.short_links sl
set
  click_count = coalesce(c.click_count, 0),
  last_clicked_at = c.last_clicked_at,
  updated_at = timezone('utc', now())
from (
  select
    sl_inner.id as short_link_id,
    count(slc.id)::integer as click_count,
    max(slc.clicked_at) as last_clicked_at
  from public.short_links sl_inner
  left join public.short_link_clicks slc
    on sl_inner.id = slc.short_link_id
   and slc.device_type is distinct from 'bot'
  group by sl_inner.id
) c
where sl.id = c.short_link_id;

create index if not exists idx_short_link_clicks_link_clicked_device
  on public.short_link_clicks (short_link_id, clicked_at, device_type);

create or replace function public.get_all_links_analytics_v2(
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_granularity text,
  p_include_bots boolean default false,
  p_timezone text default 'Europe/London'
)
returns table (
  short_code varchar,
  link_type varchar,
  destination_url text,
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
      count(slc.id)::bigint as total_clicks,
      count(distinct slc.ip_address)::bigint as unique_visitors
    from public.short_links sl
    inner join public.short_link_clicks slc
      on sl.id = slc.short_link_id
    where slc.clicked_at >= p_start_at
      and slc.clicked_at < p_end_at
      and (p_include_bots or slc.device_type is distinct from 'bot')
    group by sl.id, sl.short_code, sl.link_type, sl.destination_url
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
    plb.short_code,
    plb.link_type,
    plb.destination_url,
    array_agg((plb.bucket_local at time zone v_timezone) order by plb.bucket_local),
    array_agg(plb.bucket_clicks order by plb.bucket_local),
    max(plb.total_clicks),
    max(plb.unique_visitors)
  from per_link_bucket plb
  group by plb.short_code, plb.link_type, plb.destination_url
  order by max(plb.total_clicks) desc, plb.short_code asc;
end;
$$;

-- Keep legacy daily analytics RPC but make it human-first by default.
create or replace function public.get_all_links_analytics(
  p_days integer default 30
)
returns table (
  short_code varchar,
  link_type varchar,
  destination_url text,
  click_dates date[],
  click_counts bigint[],
  total_clicks bigint,
  unique_visitors bigint
)
language sql
security definer
set search_path = public
as $$
  with v as (
    select *
    from public.get_all_links_analytics_v2(
      p_start_at => (
        ((timezone('Europe/London', now()))::date - (greatest(coalesce(p_days, 30), 1) - 1))::timestamp
        at time zone 'Europe/London'
      ),
      p_end_at => (
        (((timezone('Europe/London', now()))::date + 1)::timestamp)
        at time zone 'Europe/London'
      ),
      p_granularity => 'day',
      p_include_bots => false,
      p_timezone => 'Europe/London'
    )
  )
  select
    v.short_code,
    v.link_type,
    v.destination_url,
    (
      select array_agg((timezone('Europe/London', b.bucket_at))::date order by b.ord)::date[]
      from unnest(v.click_dates) with ordinality as b(bucket_at, ord)
    ) as click_dates,
    v.click_counts,
    v.total_clicks,
    v.unique_visitors
  from v;
$$;

-- Keep legacy per-link analytics RPC and make it human-first by default.
create or replace function public.get_short_link_analytics(
  p_short_code varchar,
  p_days integer default 30
)
returns table (
  click_date date,
  total_clicks bigint,
  unique_visitors bigint,
  mobile_clicks bigint,
  desktop_clicks bigint,
  tablet_clicks bigint,
  top_countries jsonb,
  top_browsers jsonb,
  top_referrers jsonb
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days integer := greatest(coalesce(p_days, 30), 1);
  v_start_at timestamptz;
  v_end_at timestamptz;
begin
  v_start_at := (
    ((timezone('Europe/London', now()))::date - (v_days - 1))::timestamp
    at time zone 'Europe/London'
  );
  v_end_at := (
    (((timezone('Europe/London', now()))::date + 1)::timestamp)
    at time zone 'Europe/London'
  );

  return query
  with date_series as (
    select generate_series(
      (timezone('Europe/London', v_start_at))::date,
      (timezone('Europe/London', v_end_at - interval '1 second'))::date,
      interval '1 day'
    )::date as click_date
  ),
  daily_stats as (
    select
      (timezone('Europe/London', slc.clicked_at))::date as click_date,
      count(*)::bigint as total_clicks,
      count(distinct slc.ip_address)::bigint as unique_visitors,
      count(*) filter (where slc.device_type = 'mobile')::bigint as mobile_clicks,
      count(*) filter (where slc.device_type = 'desktop')::bigint as desktop_clicks,
      count(*) filter (where slc.device_type = 'tablet')::bigint as tablet_clicks
    from public.short_links sl
    inner join public.short_link_clicks slc on sl.id = slc.short_link_id
    where sl.short_code = p_short_code
      and slc.clicked_at >= v_start_at
      and slc.clicked_at < v_end_at
      and slc.device_type is distinct from 'bot'
    group by (timezone('Europe/London', slc.clicked_at))::date
  )
  select
    ds.click_date,
    coalesce(dst.total_clicks, 0)::bigint,
    coalesce(dst.unique_visitors, 0)::bigint,
    coalesce(dst.mobile_clicks, 0)::bigint,
    coalesce(dst.desktop_clicks, 0)::bigint,
    coalesce(dst.tablet_clicks, 0)::bigint,
    null::jsonb as top_countries,
    null::jsonb as top_browsers,
    null::jsonb as top_referrers
  from date_series ds
  left join daily_stats dst on ds.click_date = dst.click_date
  order by ds.click_date;
end;
$$;

grant execute on function public.get_all_links_analytics(integer) to authenticated, service_role;
grant execute on function public.get_all_links_analytics_v2(timestamptz, timestamptz, text, boolean, text) to authenticated, service_role;
grant execute on function public.get_short_link_analytics(varchar, integer) to authenticated, service_role;

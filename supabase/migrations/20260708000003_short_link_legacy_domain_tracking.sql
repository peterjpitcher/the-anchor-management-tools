-- Track which short-link host served each click so vip-club.uk can be retired safely.

alter table public.short_link_clicks
  add column if not exists request_host text;

create index if not exists idx_short_link_clicks_request_host_clicked_at
  on public.short_link_clicks (request_host, clicked_at desc);

create table if not exists public.short_link_aliases (
  alias_code varchar(20) primary key,
  short_link_id uuid not null references public.short_links(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id)
);

create index if not exists idx_short_link_aliases_short_link_id
  on public.short_link_aliases(short_link_id);

alter table public.short_link_aliases enable row level security;

create or replace function public.prevent_short_link_alias_code_reuse()
returns trigger as $$
begin
  if exists (
    select 1
    from public.short_link_aliases a
    where a.alias_code = new.short_code
  ) then
    raise exception 'Short code already in use' using errcode = '23505';
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists trg_prevent_short_link_alias_code_reuse on public.short_links;
create trigger trg_prevent_short_link_alias_code_reuse
before insert or update of short_code on public.short_links
for each row execute function public.prevent_short_link_alias_code_reuse();

-- Keep the latest TABLE-returning RPC, but stop returning the legacy domain to
-- direct RPC callers. The TypeScript service also rebuilds URLs defensively.
create or replace function public.create_short_link(
  p_destination_url text,
  p_link_type varchar,
  p_metadata jsonb default '{}'::jsonb,
  p_expires_at timestamptz default null,
  p_custom_code varchar default null
)
returns table(short_code varchar, full_url text) as $$
declare
  v_destination_url text := btrim(p_destination_url);
  v_short_code varchar;
  v_existing_code varchar;
  v_attempts integer := 0;
  v_max_attempts integer := 10;
begin
  perform pg_advisory_xact_lock(
    ('x' || substr(md5(v_destination_url), 1, 16))::bit(64)::bigint
  );

  select sl.short_code
    into v_existing_code
  from public.short_links sl
  where sl.destination_url = v_destination_url
  order by sl.created_at asc
  limit 1;

  if v_existing_code is not null then
    return query
      select
        v_existing_code as short_code,
        'https://l.the-anchor.pub/' || v_existing_code as full_url;
    return;
  end if;

  if p_custom_code is not null then
    v_short_code := p_custom_code;
    if exists (select 1 from public.short_link_aliases a where a.alias_code = v_short_code) then
      raise exception 'Custom code already in use' using errcode = '23505';
    end if;
  else
    loop
      v_short_code := public.generate_short_code(6);

      if not exists (select 1 from public.short_links sl where sl.short_code = v_short_code)
        and not exists (select 1 from public.short_link_aliases a where a.alias_code = v_short_code) then
        exit;
      end if;

      v_attempts := v_attempts + 1;
      if v_attempts >= v_max_attempts then
        raise exception 'Could not generate unique short code after % attempts', v_max_attempts;
      end if;
    end loop;
  end if;

  insert into public.short_links (
    short_code,
    destination_url,
    link_type,
    metadata,
    expires_at,
    created_by
  ) values (
    v_short_code,
    v_destination_url,
    p_link_type,
    p_metadata,
    p_expires_at,
    auth.uid()
  );

  return query
    select
      v_short_code as short_code,
      'https://l.the-anchor.pub/' || v_short_code as full_url;
end;
$$ language plpgsql security definer set search_path = public;

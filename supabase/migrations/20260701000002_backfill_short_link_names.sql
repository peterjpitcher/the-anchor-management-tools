-- Ensure every short link has a readable display name.

create or replace function public.derive_short_link_name(p_destination_url text)
returns text
language plpgsql
immutable
set search_path = public
as $$
declare
  v_url text := btrim(coalesce(p_destination_url, ''));
  v_no_query text;
  v_path text;
  v_segment text;
  v_label text;
begin
  if v_url = '' then
    return 'Short Link';
  end if;

  v_no_query := regexp_replace(v_url, '[?#].*$', '');
  v_path := trim(both '/' from regexp_replace(v_no_query, '^https?://[^/]+', '', 'i'));

  if v_path <> '' then
    if split_part(v_path, '/', 1) = 'r' then
      return 'Review Link';
    end if;

    select segment
      into v_segment
    from unnest(string_to_array(v_path, '/')) with ordinality as s(segment, ord)
    where segment <> ''
      and segment not in ('g', 'm', 'r')
      and not (length(segment) >= 24 and (segment ~ '^[A-Za-z0-9_]+$' or position('_' in segment) > 0))
      and not (segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
    order by ord desc
    limit 1;
  end if;

  if coalesce(v_segment, '') = '' then
    v_segment := regexp_replace(v_url, '^https?://(www\.)?([^/?#]+).*$', '\2', 'i');
  end if;

  v_label := initcap(trim(regexp_replace(regexp_replace(regexp_replace(v_segment, '%[0-9A-Fa-f]{2}', ' ', 'g'), '[-_.]+', ' ', 'g'), '\s+', ' ', 'g')));

  if v_label = '' then
    v_label := 'Short Link';
  end if;

  return left(v_label, 120);
end;
$$;

create or replace function public.set_short_link_name()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.name is null or btrim(new.name) = '' then
    new.name := public.derive_short_link_name(new.destination_url);
  else
    new.name := left(btrim(new.name), 120);
  end if;

  return new;
end;
$$;

drop trigger if exists trg_set_short_link_name on public.short_links;
create trigger trg_set_short_link_name
before insert or update of destination_url, name on public.short_links
for each row
execute function public.set_short_link_name();

update public.short_links
set name = public.derive_short_link_name(destination_url)
where name is null
   or btrim(name) = '';

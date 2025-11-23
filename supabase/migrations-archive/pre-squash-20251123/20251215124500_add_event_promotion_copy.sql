alter table public.events
add column if not exists facebook_event_name text,
add column if not exists facebook_event_description text,
add column if not exists gbp_event_title text,
add column if not exists gbp_event_description text;

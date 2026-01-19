alter table public.events
  add column if not exists opentable_experience_title text,
  add column if not exists opentable_experience_description text;


-- Leave types.
--
-- Until now every row in leave_requests was treated as annual leave, so a long block of
-- "cannot work" (term time away from the pub, for example) consumed a person's holiday
-- allowance. One live request is 63 days long for exactly that reason, which is why several
-- employees read as far over their allowance.
--
-- A lookup table rather than an enum, so a new type can be added without a migration and
-- without touching a check constraint.

create table if not exists public.leave_types (
  code                   text primary key,
  label                  text        not null,
  -- Does a day of this type come off the holiday allowance.
  consumes_allowance     boolean     not null default true,
  paid                   boolean     not null default true,
  -- Does it show as leave on the rota grid. Unavailability must still show, otherwise a
  -- manager rosters someone who has already said they cannot work.
  shown_on_rota          boolean     not null default true,
  -- Does it feed reliability scoring (late notice, clashes with published shifts).
  counts_in_reliability  boolean     not null default true,
  -- Can a new starter pick it during onboarding.
  allowed_at_onboarding  boolean     not null default true,
  sort_order             smallint    not null default 0,
  is_active              boolean     not null default true,
  created_at             timestamptz not null default now()
);

comment on table public.leave_types is
  'Kinds of leave. consumes_allowance is the flag that decides whether a day counts against the holiday allowance.';

insert into public.leave_types
  (code, label, consumes_allowance, paid, shown_on_rota, counts_in_reliability, allowed_at_onboarding, sort_order)
values
  ('holiday',     'Holiday',              true,  true,  true, true,  true, 1),
  ('unavailable', 'Not available to work', false, false, true, false, true, 2)
on conflict (code) do nothing;

alter table public.leave_types enable row level security;

-- Reference data. Any signed in user may read it; nobody writes it through PostgREST.
drop policy if exists leave_types_select_authenticated on public.leave_types;
create policy leave_types_select_authenticated
  on public.leave_types for select
  to authenticated
  using (true);

-- Every existing request is annual leave, which is how it has been counted to date.
-- Reclassifying the 63 day block is a separate, signed off data change, not part of this
-- migration, because reclassifying pay-affecting leave by guesswork is not safe.
alter table public.leave_requests
  add column if not exists leave_type text not null default 'holiday';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'leave_requests_leave_type_fkey'
  ) then
    alter table public.leave_requests
      add constraint leave_requests_leave_type_fkey
      foreign key (leave_type) references public.leave_types (code)
      on update cascade on delete restrict;
  end if;
end $$;

create index if not exists idx_leave_requests_leave_type
  on public.leave_requests (leave_type);

comment on column public.leave_requests.leave_type is
  'References leave_types.code. Decides whether these days consume the holiday allowance.';

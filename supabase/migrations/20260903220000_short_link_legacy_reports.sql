-- Capture where people found a legacy vip-club.uk link, so the physical or digital
-- artefact still carrying it can be located and replaced before the domain is retired.
--
-- Click analytics can prove that a legacy link is still being used, but not where it
-- is published: every legacy click arrives with no referrer and a plain mobile browser
-- user agent. This table records the one thing the data cannot infer, asked directly
-- on an interstitial served only to legacy-domain traffic.
--
-- No IP address and no user agent are stored. device_type is a coarse bucket already
-- derived elsewhere, so nothing here identifies an individual.

create table if not exists public.short_link_legacy_reports (
  id uuid primary key default gen_random_uuid(),
  short_link_id uuid references public.short_links(id) on delete set null,
  -- The code as requested. Kept separately because it may be an alias, and because the
  -- report must survive the short link being deleted.
  requested_code text not null,
  request_host text,
  location_key text not null,
  location_detail text,
  -- Set when a staff member records a find during a physical sweep, so their answers can
  -- be read separately from customer answers.
  is_staff boolean not null default false,
  device_type text,
  created_at timestamptz not null default now()
);

create index if not exists idx_short_link_legacy_reports_created_at
  on public.short_link_legacy_reports (created_at desc);

create index if not exists idx_short_link_legacy_reports_short_link_id
  on public.short_link_legacy_reports (short_link_id, created_at desc);

create index if not exists idx_short_link_legacy_reports_location_key
  on public.short_link_legacy_reports (location_key);

alter table public.short_link_legacy_reports enable row level security;

-- Deliberately no policies and no grants. Submissions are written by the public API
-- route with the service-role client, and reads happen in a permission-checked server
-- action with the same client. Service role bypasses RLS, so both work while anon and
-- authenticated keep no direct access to the table.

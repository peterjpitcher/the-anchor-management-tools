-- Align local with remote migration name for version 20250913
-- Adding name column to short_links (idempotent)
alter table public.short_links
  add column if not exists name text;


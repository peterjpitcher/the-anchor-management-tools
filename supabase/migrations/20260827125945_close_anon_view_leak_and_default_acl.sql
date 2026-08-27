-- Close the anon data leak, and stop it growing back.
--
-- Verified live on 27 August 2026 by querying PostgREST with the public
-- NEXT_PUBLIC_SUPABASE_ANON_KEY that ships in every browser bundle:
--   cashup_weekly_view                   returned weekly takings (2,792 rows)
--   menu_dishes_with_costs               returned 33 columns including pricing (420 rows)
--   table_bookings_awaiting_confirmation returned customer bookings
--
-- None of these is a grant problem alone. Each is a view WITHOUT
-- security_invoker, so it executes with the view owner's rights (postgres,
-- which has rolbypassrls) and defeats RLS on the underlying tables entirely.
-- The same anon role reading the base tables directly gets zero rows.
--
-- Every caller was traced to the Supabase client it actually uses before
-- anything below was written, because assuming that is what broke the public
-- private-hire enquiry flow for sixteen days this month.

-- ---------------------------------------------------------------------------
-- 1. Views: run as the caller, and put them out of anon's reach.
--
-- ALTER VIEW is used rather than DROP + CREATE deliberately: it cannot get a
-- 33-column definition subtly wrong, and it preserves the ACL.
--
-- WARNING for whoever edits these views next. Exactly this fix was applied once
-- before, on 27 May 2026, and was silently undone on 25 July 2026 by
-- 20260725030000_cashup_session_void.sql, which did DROP VIEW + CREATE VIEW.
-- That resets reloptions AND re-grants anon through the default ACL in part 4.
-- Use CREATE OR REPLACE VIEW for column-compatible edits. If you must drop and
-- recreate, write WITH (security_invoker = on) into the CREATE and re-apply the
-- revokes in the same migration.
-- ---------------------------------------------------------------------------

alter view public.cashup_weekly_view set (security_invoker = on);
revoke all on public.cashup_weekly_view from anon, public;
-- The view is auto-updatable and `authenticated` held INSERT/UPDATE/DELETE on
-- it, which let any signed-in user write straight through to cashup_sessions
-- with RLS bypassed. Nothing in the app writes through the view.
revoke insert, update, delete on public.cashup_weekly_view from authenticated;
grant select on public.cashup_weekly_view to authenticated;

alter view public.menu_dishes_with_costs set (security_invoker = on);
revoke all on public.menu_dishes_with_costs from anon, public;
grant select on public.menu_dishes_with_costs to authenticated;

alter view public.table_bookings_awaiting_confirmation set (security_invoker = on);
revoke all on public.table_bookings_awaiting_confirmation from anon, public;
-- Its only caller is the confirm-reminder cron, which uses the service-role
-- client, so no grant to authenticated is needed.

-- menu_ingredients_with_prices and oj_project_stats already carry
-- security_invoker = true and return nothing to anon. Left alone.

-- ---------------------------------------------------------------------------
-- 2. Tables anon could write to.
--
-- TRUNCATE is NOT filtered by row-level security, so anon holding it was a real
-- destructive privilege that RLS did not cover.
-- ---------------------------------------------------------------------------

revoke insert, update, delete, truncate, references, trigger
  on public.business_hours_versions from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.employee_onboarding_responses from anon;
revoke insert, update, delete, truncate, references, trigger
  on public.leave_types from anon;

-- anon KEEPS SELECT on business_hours_versions. That grant is deliberate:
-- 20260815190200_business_hours_versions_expand.sql created it so opening hours
-- are publicly readable, and public.business_hours_for_date(date) is SECURITY
-- INVOKER with anon EXECUTE and reads this table. Revoking the read would turn
-- a working anonymous call into a hard permission error while closing nothing.

-- ---------------------------------------------------------------------------
-- 3. Tables with no row protection at all.
--
-- Every caller of these four uses the service-role client, which bypasses RLS,
-- so enabling it without policies changes no application behaviour. It closes
-- the gap where a future grant would expose them with nothing to stop it.
-- ---------------------------------------------------------------------------

alter table public.event_payment_exceptions enable row level security;
alter table public.event_payment_reminders enable row level security;
alter table public.event_ticket_transfers enable row level security;
alter table public.receipt_rules_transaction_type_backup enable row level security;

-- ---------------------------------------------------------------------------
-- 4. THE ROOT CAUSE, and the only part of this that stops it recurring.
--
-- pg_default_acl carries, FOR ROLE postgres IN SCHEMA public, a default table
-- ACL of arwdDxt for anon. Every new table created by postgres in public is
-- born with FULL privileges granted to anonymous callers.
--
-- The proof this decays rather than holds: 20260814100300 already revoked
-- INSERT/UPDATE/DELETE on ALL TABLES IN SCHEMA public from anon on 14 August.
-- The three tables in part 2 were created on 15 and 19 August, after it. Their
-- anon write grants did not survive that sweep, they were minted fresh by this
-- default. Exactly three tables are anon-writable today, and they are exactly
-- the three created since that migration.
--
-- Default SELECT is deliberately left alone. Public reference tables such as
-- business_hours and menu_items are meant to be readable, and removing the
-- default read here would be a change of policy rather than a fix. New tables
-- should be created RLS-enabled with an explicit policy instead.
-- ---------------------------------------------------------------------------

alter default privileges for role postgres in schema public
  revoke insert, update, delete, truncate, references, trigger on tables from anon;

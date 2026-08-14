-- Estate-wide pass over the Supabase default `GRANT ALL ON ALL TABLES IN
-- SCHEMA public TO anon, authenticated`.
--
-- 226 public tables still carried that default. RLS shields most of them, but
-- a grant is the only thing standing between a future policy mistake and a
-- destructive write from a key that ships in the browser bundle. This removes
-- the privileges that no application path uses, and leaves every privilege the
-- app was proven to depend on.
--
-- Everything below was checked against the live database and the code first.
--
-- 1. TRUNCATE, REFERENCES and TRIGGER, both roles, every table.
--    PostgREST cannot issue any of them, so nothing can regress. TRUNCATE
--    matters most: it is NOT filtered by row-level security, so a table that
--    looks protected by RLS can still be emptied wholesale by anyone holding
--    the privilege.
--
-- 2. INSERT, UPDATE and DELETE for `anon`, every table.
--    Only one table in the estate has a permissive write policy that an
--    anonymous caller could actually satisfy: timeclock_sessions, via
--    "Anon can clock in/out" (WITH CHECK true). Every timeclock write in the
--    app goes through src/app/actions/timeclock.ts and the other rota, payroll
--    and voucher actions using the service-role admin client, and no client
--    component writes the table directly, so anon INSERT is unused. Every
--    other anon-applicable write policy requires a service_role JWT, which the
--    anon role does not have. No re-grant is needed.
--
-- 3. Four tables that have RLS DISABLED while holding full anon grants:
--    event_payment_exceptions, event_payment_reminders, event_ticket_transfers
--    and receipt_rules_transaction_type_backup. With no RLS there is nothing
--    behind the grant, so anon could read and write them directly. The first
--    three are written only by crons and server actions using the admin client
--    (src/app/api/cron/event-paypal-reconciliation, event-payment-reminders,
--    and src/app/actions/events.ts, all createAdminClient). The fourth has no
--    references in the codebase at all: it is a leftover backup table with 123
--    rows that was readable by anyone with the anon key. Both roles lose all
--    privileges on all four.
--
-- Deliberately NOT changed here, because they need a decision rather than a
-- sweep (see the notes handed back with this migration):
--   * anon SELECT on `customers`, `pending_bookings` and `events`, granted by
--     the anon_read_* policies. These look load-bearing for the public booking
--     flow on the brand website, which is a separate codebase, so they are not
--     safe to revoke from here.
--   * SELECT for anon generally. The public reference tables (business_hours,
--     menu_items, booking_policies and similar) are meant to be readable.
--   * `authenticated` write privileges, which staff features genuinely use
--     through the cookie client.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Privileges no PostgREST client can ever use.
-- ---------------------------------------------------------------------------
REVOKE TRUNCATE, REFERENCES, TRIGGER ON ALL TABLES IN SCHEMA public
  FROM anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. All anonymous write access.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public FROM anon;

-- ---------------------------------------------------------------------------
-- 3. Tables with no RLS behind the grant.
-- ---------------------------------------------------------------------------
REVOKE ALL ON TABLE public.event_payment_exceptions FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_payment_reminders FROM anon, authenticated;
REVOKE ALL ON TABLE public.event_ticket_transfers FROM anon, authenticated;
REVOKE ALL ON TABLE public.receipt_rules_transaction_type_backup
  FROM anon, authenticated;

COMMIT;

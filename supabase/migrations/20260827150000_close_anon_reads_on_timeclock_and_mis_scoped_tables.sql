-- Close anon table reads on timeclock_sessions, plus two mis-scoped TO public
-- SELECT policies found in the same 27 August 2026 pass.
--
-- Companion to 20260827110750 (anon EXECUTE on SECURITY DEFINER RPCs) and
-- 20260827115556 (permission-function policies scoped to authenticated). Those
-- closed function and policy holes; this one closes table reads.
--
-- ---------------------------------------------------------------------------
-- 1. public.timeclock_sessions
--
-- Policy "Anon can read open sessions for display" (SELECT, TO anon,
-- USING clock_out_at IS NULL) plus an anon SELECT grant exposed the ENTIRE row
-- of every currently clocked-in employee to anyone holding the anon key, which
-- ships in every browser bundle. That is employee_id, clock_in_at, notes,
-- manager_note, rate_multiplier, rate_override, premium_reason,
-- premium_start_at, premium_end_at, is_reviewed and reviewed_by: staff PII plus
-- pay data.
--
-- Proven on prod in a rolled-back transaction: inserting an open session with
-- manager_note, rate_override and premium_reason set, then reading it under
-- `set local role anon`, returned all three values in full.
--
-- The kiosk does NOT need this. /timeclock is a public route, but every read it
-- makes runs through the service-role client:
--   src/app/(timeclock)/timeclock/page.tsx  -> createAdminClient()
--   getOpenSessions() in src/app/actions/timeclock.ts:317 -> createClient(),
--   which is `const createClient = () => createAdminClient()` at line 21.
-- service_role bypasses RLS, so the anon policy and grant are dead surface.
-- No browser Supabase client reads this table anywhere in src/.
--
-- "Anon can clock in/out" (INSERT, TO anon, WITH CHECK true) is an
-- unconditional anon insert, held closed today only by the absence of an anon
-- INSERT grant. Clock in/out goes through the same service-role server actions,
-- so it is dropped rather than left as a landmine for a future grant change.
-- ---------------------------------------------------------------------------

drop policy if exists "Anon can read open sessions for display" on public.timeclock_sessions;
drop policy if exists "Anon can clock in/out" on public.timeclock_sessions;

revoke select on public.timeclock_sessions from anon;

-- ---------------------------------------------------------------------------
-- 2. public.event_message_templates
--
-- "Users can view event templates" was SELECT TO public with USING (true): a
-- full-table read for anon. The table is empty today so nothing is exposed yet,
-- but it leaks everything the moment templates are added.
--
-- Sole reader is src/app/api/events/[id]/route.ts:118, which uses
-- createAdminClient() behind withApiAuth (ANCHOR_API_KEY), so it is unaffected.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view event templates" on public.event_message_templates;

create policy "Authenticated can view event templates"
  on public.event_message_templates
  for select
  to authenticated
  using (true);

revoke select on public.event_message_templates from anon;

-- ---------------------------------------------------------------------------
-- 3. public.booking_reminders
--
-- "Users can view reminders for accessible bookings" was SELECT TO public with
-- USING (EXISTS (SELECT 1 FROM bookings b WHERE b.id = booking_reminders.booking_id)),
-- which scopes by nothing at all: the subquery is true for every reminder that
-- has a parent booking. It fails closed today only because anon holds no SELECT
-- grant on public.bookings. If anon is ever granted SELECT on bookings, this
-- exposes every reminder.
--
-- Sole reader is src/services/gdpr.ts, which uses the admin client throughout.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view reminders for accessible bookings" on public.booking_reminders;

create policy "Authenticated can view booking reminders"
  on public.booking_reminders
  for select
  to authenticated
  using (
    exists (
      select 1 from public.bookings b
      where b.id = booking_reminders.booking_id
    )
  );

revoke select on public.booking_reminders from anon;

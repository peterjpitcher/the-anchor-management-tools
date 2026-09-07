-- Calendar notes: align the RLS write policies with the application gate.
--
-- NOT YET APPLIED TO PRODUCTION. This needs the owner's explicit approval and
-- must go through the prod-migrate skill. The application does not depend on it.
--
-- Why it exists: the note actions write with the service-role client, which
-- bypasses RLS, so these policies enforce nothing for the app today. They still
-- matter, because they are what the next person reads to learn who may write a
-- note, and right now they say something different from the code. That exact
-- disagreement (policy said events:view for reads, the action said
-- settings:manage) is why managers saw no notes on /events for months.
--
-- Ordering: apply this WITH or AFTER the deploy of the matching application
-- code, never before. The project's recorded lesson from 2026-07-30 is that
-- additive permission DATA changes live behaviour the moment it lands, even when
-- the schema change itself is harmless.
--
-- Effect: widens direct authenticated write access on public.calendar_notes from
-- settings:manage to events:manage OR settings:manage. Nobody loses access.
-- Reads are unchanged: the SELECT policy already allows events:view.
--
-- Rollback: re-create the three policies with the settings:manage predicate
-- alone, which is the state before this migration.

DROP POLICY IF EXISTS "Users with settings manage permission can create calendar notes" ON public.calendar_notes;
CREATE POLICY "Users who manage events or settings can create calendar notes"
  ON public.calendar_notes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'events', 'manage') OR
    public.user_has_permission(auth.uid(), 'settings', 'manage')
  );

DROP POLICY IF EXISTS "Users with settings manage permission can update calendar notes" ON public.calendar_notes;
CREATE POLICY "Users who manage events or settings can update calendar notes"
  ON public.calendar_notes
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'events', 'manage') OR
    public.user_has_permission(auth.uid(), 'settings', 'manage')
  )
  WITH CHECK (
    public.user_has_permission(auth.uid(), 'events', 'manage') OR
    public.user_has_permission(auth.uid(), 'settings', 'manage')
  );

DROP POLICY IF EXISTS "Users with settings manage permission can delete calendar notes" ON public.calendar_notes;
CREATE POLICY "Users who manage events or settings can delete calendar notes"
  ON public.calendar_notes
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'events', 'manage') OR
    public.user_has_permission(auth.uid(), 'settings', 'manage')
  );

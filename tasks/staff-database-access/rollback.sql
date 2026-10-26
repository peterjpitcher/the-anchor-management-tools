-- Rollback for 20261026182434_staff_database_access.sql: restores the policies and grants production held on 26 October 2026.

DROP POLICY booking_table_assignments_staff_select ON public.booking_table_assignments;
DROP POLICY "Signed-in users can view short links; guest links need short-link access" ON public.short_links;
CREATE POLICY "Authenticated users can view short links" ON public.short_links AS PERMISSIVE FOR SELECT TO public
  USING ((auth.uid() IS NOT NULL));
CREATE POLICY "Authenticated users can create short links" ON public.short_links AS PERMISSIVE FOR INSERT TO public
  WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY "Users can update own short links" ON public.short_links AS PERMISSIVE FOR UPDATE TO public
  USING (((created_by = auth.uid()) OR (created_by IS NULL))) WITH CHECK (((created_by = auth.uid()) OR (created_by IS NULL)));
CREATE POLICY "Users can delete own short links" ON public.short_links AS PERMISSIVE FOR DELETE TO public
  USING (((created_by = auth.uid()) OR (created_by IS NULL)));

CREATE POLICY payments_authenticated_all ON public.payments AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY guest_tokens_authenticated_all ON public.guest_tokens AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY booking_holds_authenticated_all ON public.booking_holds AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY booking_table_assignments_authenticated_all ON public.booking_table_assignments AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY waitlist_entries_authenticated_all ON public.waitlist_entries AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY waitlist_offers_authenticated_all ON public.waitlist_offers AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));
CREATE POLICY charge_requests_authenticated_all ON public.charge_requests AS PERMISSIVE FOR ALL TO authenticated
  USING ((auth.uid() IS NOT NULL)) WITH CHECK ((auth.uid() IS NOT NULL));

GRANT SELECT ON public.payments, public.guest_tokens, public.booking_holds, public.booking_table_assignments, public.waitlist_entries, public.waitlist_offers, public.charge_requests TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payments, public.guest_tokens, public.booking_holds, public.booking_table_assignments, public.waitlist_entries, public.waitlist_offers, public.charge_requests TO authenticated;

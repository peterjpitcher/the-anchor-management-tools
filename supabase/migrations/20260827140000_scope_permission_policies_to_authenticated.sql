-- Re-scope the RBAC RLS policies from TO public to TO authenticated, then close
-- the last two anon EXECUTE holes that 20260827130000 had to leave open.
--
-- 20260827130000 revoked anon EXECUTE on 47 SECURITY DEFINER functions but could
-- not touch user_has_permission or is_super_admin. 68 policies across 39 tables
-- are declared TO public rather than TO authenticated, and anon holds table
-- SELECT on all 39. A policy expression is evaluated with the querying role's
-- privileges, so anon currently calls user_has_permission(), gets false and sees
-- zero rows. Revoking the EXECUTE without fixing the policies turns that empty
-- result into "ERROR: 42501: permission denied for function", including on
-- business_hours and special_hours which the public website reads.
--
-- Proven before writing this, in a rolled-back transaction on the live database:
--   begin;
--   revoke all on function public.is_super_admin(uuid) from public, anon;
--   set local role anon;
--   select count(*) from public.mileage_trips;
--   -- ERROR: 42501: permission denied for function is_super_admin
--   rollback;
--
-- ALTER POLICY ... TO authenticated changes only the role list. The USING and
-- WITH CHECK expressions are untouched, so no authorisation rule changes.
--
-- Behaviour for anon is identical before and after. Every one of these policies
-- calls user_has_permission() or is_super_admin() with auth.uid(), which is NULL
-- for anon, so all 68 already evaluate to false for anon. Removing anon from the
-- role list changes "policy evaluated, returned false, zero rows" into "no
-- policy applies, zero rows". Same result, no function call required.
--
-- service_role is unaffected: it has rolbypassrls = true and skips RLS entirely.
--
-- Deliberately NOT re-scoped: the genuinely public read policies, above all
-- "Public can read business hours" on business_hours and "Public can read
-- special hours" on special_hours. Those do not call either function and are how
-- the website reads opening times. Touching them is what would break the site.

alter policy "Staff can manage achievement progress" on public.achievement_progress to authenticated;
alter policy "Staff can view achievement progress" on public.achievement_progress to authenticated;
alter policy "Users with audit permission can view all logs" on public.audit_logs to authenticated;
alter policy audit_logs_read_policy on public.audit_logs to authenticated;
alter policy "Admins can manage booking policies" on public.booking_policies to authenticated;
alter policy "Managers can manage booking time slots" on public.booking_time_slots to authenticated;
alter policy "Authorized users can manage business hours" on public.business_hours to authenticated;
alter policy "Staff can manage customer achievements" on public.customer_achievements to authenticated;
alter policy "Staff can view customer achievements" on public.customer_achievements to authenticated;
alter policy "Staff can manage customer challenges" on public.customer_challenges to authenticated;
alter policy "Staff can view customer challenges" on public.customer_challenges to authenticated;
alter policy employee_financial_details_select_with_permission on public.employee_financial_details to authenticated;
alter policy employee_health_records_select_with_permission on public.employee_health_records to authenticated;
alter policy "Users can manage onboarding checklist based on employee permiss" on public.employee_onboarding_checklist to authenticated;
alter policy "Users can view onboarding checklist based on employee permissio" on public.employee_onboarding_checklist to authenticated;
alter policy "Users can manage right to work based on employee permissions" on public.employee_right_to_work to authenticated;
alter policy "Users can view right to work based on employee permissions" on public.employee_right_to_work to authenticated;
alter policy "Staff can manage check-ins" on public.event_check_ins to authenticated;
alter policy "Staff can view check-ins" on public.event_check_ins to authenticated;
alter policy event_checklist_delete on public.event_checklist_statuses to authenticated;
alter policy event_checklist_insert on public.event_checklist_statuses to authenticated;
alter policy event_checklist_update on public.event_checklist_statuses to authenticated;
alter policy event_checklist_view on public.event_checklist_statuses to authenticated;
alter policy super_admin_all on public.expense_files to authenticated;
alter policy super_admin_all on public.expenses to authenticated;
alter policy "Staff can manage achievements" on public.loyalty_achievements to authenticated;
alter policy "Staff can view achievements" on public.loyalty_achievements to authenticated;
alter policy "Staff can manage campaigns" on public.loyalty_campaigns to authenticated;
alter policy "Staff can view campaigns" on public.loyalty_campaigns to authenticated;
alter policy "Staff can manage challenges" on public.loyalty_challenges to authenticated;
alter policy "Staff can view challenges" on public.loyalty_challenges to authenticated;
alter policy "Staff can manage loyalty members" on public.loyalty_members to authenticated;
alter policy "Staff can view loyalty members" on public.loyalty_members to authenticated;
alter policy "Staff can create point transactions" on public.loyalty_point_transactions to authenticated;
alter policy "Staff can manage point transactions" on public.loyalty_point_transactions to authenticated;
alter policy "Staff can view point transactions" on public.loyalty_point_transactions to authenticated;
alter policy "Staff can manage loyalty programs" on public.loyalty_programs to authenticated;
alter policy "Staff can view loyalty programs" on public.loyalty_programs to authenticated;
alter policy "Staff can manage rewards" on public.loyalty_rewards to authenticated;
alter policy "Staff can view rewards" on public.loyalty_rewards to authenticated;
alter policy "Staff can manage loyalty tiers" on public.loyalty_tiers to authenticated;
alter policy "Staff can view loyalty tiers" on public.loyalty_tiers to authenticated;
alter policy super_admin_all on public.mgd_collections to authenticated;
alter policy super_admin_all on public.mgd_returns to authenticated;
alter policy super_admin_all on public.mileage_destination_distances to authenticated;
alter policy super_admin_all on public.mileage_destinations to authenticated;
alter policy super_admin_all on public.mileage_trip_legs to authenticated;
alter policy super_admin_all on public.mileage_trips to authenticated;
alter policy "Staff can manage redemptions" on public.reward_redemptions to authenticated;
alter policy "Staff can view redemptions" on public.reward_redemptions to authenticated;
alter policy "Authorized users can manage special hours" on public.special_hours to authenticated;
alter policy "Staff can manage booking items" on public.table_booking_items to authenticated;
alter policy "Staff can create modifications" on public.table_booking_modifications to authenticated;
alter policy "Staff can view all modifications" on public.table_booking_modifications to authenticated;
alter policy "Staff can view payment info" on public.table_booking_payments to authenticated;
alter policy "System can manage payments" on public.table_booking_payments to authenticated;
alter policy "Admins manage SMS templates" on public.table_booking_sms_templates to authenticated;
alter policy "Staff can view SMS templates" on public.table_booking_sms_templates to authenticated;
alter policy "Managers can delete bookings" on public.table_bookings to authenticated;
alter policy "Staff can create bookings" on public.table_bookings to authenticated;
alter policy "Staff can update bookings" on public.table_bookings to authenticated;
alter policy "Staff can view all bookings" on public.table_bookings to authenticated;
alter policy "Users can manage table combination tables with permission" on public.table_combination_tables to authenticated;
alter policy "Users can view table combination tables with permission" on public.table_combination_tables to authenticated;
alter policy "Users can manage table combinations with permission" on public.table_combinations to authenticated;
alter policy "Users can view table combinations with permission" on public.table_combinations to authenticated;
alter policy "Users can manage table configuration with permission" on public.table_configuration to authenticated;
alter policy "Users can view table configuration with permission" on public.table_configuration to authenticated;

-- With no policy reachable by anon calling either function, the last two anon
-- EXECUTE grants can finally go. This completes the sweep started in
-- 20260811100100 and continued in 20260827110750 and 20260827130000: after this,
-- zero SECURITY DEFINER functions in public are executable by anon.
revoke all on function public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) from public, anon;
revoke all on function public.is_super_admin(check_user_id uuid) from public, anon;

-- Both are called from inside RLS policies evaluated as the signed-in user, so
-- authenticated must keep EXECUTE. Stated explicitly so a later ACL change
-- cannot silently remove it and take every authenticated read down.
grant execute on function public.user_has_permission(p_user_id uuid, p_module_name text, p_action text) to authenticated, service_role;
grant execute on function public.is_super_admin(check_user_id uuid) to authenticated, service_role;

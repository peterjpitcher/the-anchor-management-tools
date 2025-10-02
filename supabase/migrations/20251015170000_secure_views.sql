-- Harden sensitive views flagged by Supabase security lint
BEGIN;

-- Restrict access to auth-derived admin view
REVOKE ALL ON public.admin_users_view FROM PUBLIC;
REVOKE ALL ON public.admin_users_view FROM anon;
REVOKE ALL ON public.admin_users_view FROM authenticated;
GRANT SELECT ON public.admin_users_view TO service_role;
ALTER VIEW public.admin_users_view SET (security_invoker = true);

-- Ensure other sensitive views respect invoker privileges and are not exposed to anon role
ALTER VIEW public.message_templates_with_timing SET (security_invoker = true);
REVOKE ALL ON public.message_templates_with_timing FROM anon;
GRANT SELECT ON public.message_templates_with_timing TO authenticated;
GRANT SELECT ON public.message_templates_with_timing TO service_role;

ALTER VIEW public.recent_reminder_activity SET (security_invoker = true);
REVOKE ALL ON public.recent_reminder_activity FROM anon;
GRANT SELECT ON public.recent_reminder_activity TO authenticated;
GRANT SELECT ON public.recent_reminder_activity TO service_role;

ALTER VIEW public.reminder_timing_debug SET (security_invoker = true);
REVOKE ALL ON public.reminder_timing_debug FROM anon;
GRANT SELECT ON public.reminder_timing_debug TO authenticated;
GRANT SELECT ON public.reminder_timing_debug TO service_role;

ALTER VIEW public.employee_version_history SET (security_invoker = true);
REVOKE ALL ON public.employee_version_history FROM anon;
GRANT SELECT ON public.employee_version_history TO authenticated;
GRANT SELECT ON public.employee_version_history TO service_role;

ALTER VIEW public.private_booking_sms_reminders SET (security_invoker = true);
REVOKE ALL ON public.private_booking_sms_reminders FROM anon;
GRANT SELECT ON public.private_booking_sms_reminders TO authenticated;
GRANT SELECT ON public.private_booking_sms_reminders TO service_role;

ALTER VIEW public.private_booking_summary SET (security_invoker = true);
REVOKE ALL ON public.private_booking_summary FROM anon;
GRANT SELECT ON public.private_booking_summary TO authenticated;
GRANT SELECT ON public.private_booking_summary TO service_role;

ALTER VIEW public.customer_messaging_health SET (security_invoker = true);
REVOKE ALL ON public.customer_messaging_health FROM anon;
GRANT SELECT ON public.customer_messaging_health TO authenticated;
GRANT SELECT ON public.customer_messaging_health TO service_role;

ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);
REVOKE ALL ON public.private_bookings_with_details FROM anon;
GRANT SELECT ON public.private_bookings_with_details TO authenticated;
GRANT SELECT ON public.private_bookings_with_details TO service_role;

ALTER VIEW public.short_link_daily_stats SET (security_invoker = true);
REVOKE ALL ON public.short_link_daily_stats FROM anon;
GRANT SELECT ON public.short_link_daily_stats TO authenticated;
GRANT SELECT ON public.short_link_daily_stats TO service_role;

COMMIT;

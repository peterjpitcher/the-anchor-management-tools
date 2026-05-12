-- Add UPDATE and DELETE RLS policies on private_booking_payments
-- Previously only SELECT and INSERT existed. All payment modifications currently
-- go through the service-role client, so these policies are defence-in-depth.

-- Grant the permission check function to authenticated role
GRANT EXECUTE ON FUNCTION public.user_has_permission(uuid, text, text) TO authenticated;

-- UPDATE: only users with private_bookings:manage
CREATE POLICY "private_booking_payments_update"
  ON public.private_booking_payments
  FOR UPDATE
  TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- DELETE: only users with private_bookings:manage
CREATE POLICY "private_booking_payments_delete"
  ON public.private_booking_payments
  FOR DELETE
  TO authenticated
  USING (
    public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- Grant UPDATE and DELETE to authenticated (required alongside RLS policies)
-- service_role already has ALL
GRANT UPDATE, DELETE ON public.private_booking_payments TO authenticated;

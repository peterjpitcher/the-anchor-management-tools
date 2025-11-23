-- Fix RLS policies for private bookings
BEGIN;

-- 1. Private Bookings Table
ALTER TABLE public.private_bookings ENABLE ROW LEVEL SECURITY;

-- View Policy
DROP POLICY IF EXISTS "Users can view private bookings" ON public.private_bookings;
CREATE POLICY "Users can view private bookings"
  ON public.private_bookings
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'view')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- Manage Policy (Insert, Update, Delete)
DROP POLICY IF EXISTS "Users can manage private bookings" ON public.private_bookings;
CREATE POLICY "Users can manage private bookings"
  ON public.private_bookings
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  );

-- 2. Private Booking Items Table
ALTER TABLE public.private_booking_items ENABLE ROW LEVEL SECURITY;

-- View Policy
DROP POLICY IF EXISTS "Users can view private booking items" ON public.private_booking_items;
CREATE POLICY "Users can view private booking items"
  ON public.private_booking_items
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'view')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
  );

-- Manage Policy
DROP POLICY IF EXISTS "Users can manage private booking items" ON public.private_booking_items;
CREATE POLICY "Users can manage private booking items"
  ON public.private_booking_items
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'manage')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
    OR public.user_has_permission(auth.uid(), 'private_bookings', 'create')
  );

COMMIT;

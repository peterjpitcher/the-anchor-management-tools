-- Gate message and parking reads on their module permissions.
--
-- messages.SELECT was "auth.uid() IS NOT NULL" and both parking read policies
-- were "USING (true)", all granted to authenticated. Any signed-in account,
-- including the FOH and staff-portal logins that hold no roles at all, could
-- read every SMS body in the system (7,996 of them, including the two-way
-- inbox with customers) and every parking booking with its customer name,
-- mobile number, vehicle registration and payment detail, straight from
-- PostgREST with the public anon key.
--
-- Writes are left as they are. Parking writes already require parking:manage.
-- The open INSERT policies on messages and the parking tables are a separate
-- concern from this read exposure and are noted for follow-up rather than
-- changed here, because every insert path in the app runs service-role and
-- tightening them blind risks breaking sends.
--
-- Checked before writing this:
--   - All parking writes and the great majority of reads use the service-role
--     client, which bypasses RLS.
--   - The three cookie-client message reads (the dashboard, the unread-count
--     endpoint, and the customer detail page's parking section) are staff
--     surfaces whose users hold the relevant view permission.
--   - exportProfileData is a subject-access export scoped to the signed-in
--     user's own email addresses, so it was moved to the service-role client in
--     the same change. It was in fact already broken for role-less accounts,
--     because customers.SELECT has required customers:view for some time.
--   - Role coverage: super_admin, manager and staff all hold messages:view and
--     parking:view. Deputy holds neither but has no users. foh_staff and
--     portal_shift_manager hold neither and should not see either dataset.

-- ---------------------------------------------------------------------------
-- messages
-- ---------------------------------------------------------------------------

drop policy if exists "Allow authenticated users to read messages" on public.messages;

create policy "messages_select_with_permission"
  on public.messages for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'messages', 'view')
    or public.user_has_permission(auth.uid(), 'messages', 'manage_templates')
  );

-- ---------------------------------------------------------------------------
-- parking_bookings
-- ---------------------------------------------------------------------------

drop policy if exists "parking_bookings_read" on public.parking_bookings;

create policy "parking_bookings_read"
  on public.parking_bookings for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'parking', 'view')
    or public.user_has_permission(auth.uid(), 'parking', 'manage')
  );

-- ---------------------------------------------------------------------------
-- parking_booking_payments
--
-- Same exposure, and it additionally carries the PayPal order and capture ids.
-- ---------------------------------------------------------------------------

drop policy if exists "parking_booking_payments_read" on public.parking_booking_payments;

create policy "parking_booking_payments_read"
  on public.parking_booking_payments for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'parking', 'view')
    or public.user_has_permission(auth.uid(), 'parking', 'manage')
  );

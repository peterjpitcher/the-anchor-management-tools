-- The last of the wide-open policies found by the review.
--
-- Each one was checked against how the application actually reads and writes the
-- table before being tightened, so nothing in the app loses access it uses.

-- ---------------------------------------------------------------------------
-- message_templates
--
-- SELECT was USING (true) with no role restriction, so anyone holding the public
-- anon key could read every template, and the manage policy allowed any signed-in
-- account to rewrite them. Templates are staff-authored copy, and there is a
-- messages permission for exactly this.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view all templates" on public.message_templates;
drop policy if exists "Users can manage templates" on public.message_templates;

create policy "message_templates_select_with_permission"
  on public.message_templates for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'messages', 'view_templates')
    or public.user_has_permission(auth.uid(), 'messages', 'manage_templates')
  );

create policy "message_templates_write_with_permission"
  on public.message_templates for all to authenticated
  using (public.user_has_permission(auth.uid(), 'messages', 'manage_templates'))
  with check (public.user_has_permission(auth.uid(), 'messages', 'manage_templates'));

revoke select on public.message_templates from anon;

-- ---------------------------------------------------------------------------
-- private_booking_sms_queue
--
-- Reads and approvals were already permission-gated, but INSERT was open to any
-- signed-in account, so anyone could queue an SMS against any booking. The app
-- only ever inserts here through the service-role client, which bypasses RLS, so
-- requiring the create permission costs the app nothing.
--
-- The stale "Authenticated users can view their own" policy is also dropped: it
-- OR'd in a created_by match and a hardcoded role-name lookup, which quietly
-- widened the permission-gated SELECT policy sitting beside it.
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can insert" on public.private_booking_sms_queue;
drop policy if exists "Authenticated users can view their own" on public.private_booking_sms_queue;

create policy "private_booking_sms_queue_insert_with_permission"
  on public.private_booking_sms_queue for insert to authenticated
  with check (
    public.user_has_permission(auth.uid(), 'private_bookings', 'create')
    or public.user_has_permission(auth.uid(), 'private_bookings', 'edit')
  );

-- ---------------------------------------------------------------------------
-- customer_scores
--
-- A single ALL policy gated on nothing but being signed in, so any account could
-- rewrite the scores the customer insights are built from. Reads follow the
-- customers permission; writes are service-role only, which the remaining
-- service-role bypass already covers.
-- ---------------------------------------------------------------------------

drop policy if exists "customer_scores_authenticated_all" on public.customer_scores;

create policy "customer_scores_select_with_permission"
  on public.customer_scores for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'customers', 'view')
    or public.user_has_permission(auth.uid(), 'customers', 'manage')
  );

-- ---------------------------------------------------------------------------
-- pending_bookings
--
-- anon_read_pending_bookings was USING (true), so any anonymous caller could read
-- all 48 rows including every booking token and mobile number. The linked
-- anon_read_customers_for_bookings policy on customers then exposed those
-- customers' rows too.
--
-- Deliberately scoped rather than dropped. Nothing in this repository reads the
-- table, so it is the the-anchor.pub website using the anon key, and dropping the
-- policy outright could break a live booking flow that cannot be seen from here.
-- Narrowing it to rows that are still in flight keeps that flow working while
-- cutting off the history: every row in production today is expired, so this
-- exposes nothing at all right now, and in future only a booking a customer is
-- part way through.
-- ---------------------------------------------------------------------------

drop policy if exists "anon_read_pending_bookings" on public.pending_bookings;

create policy "anon_read_pending_bookings"
  on public.pending_bookings for select to anon
  using (
    confirmed_at is null
    and expires_at is not null
    and expires_at > now()
  );

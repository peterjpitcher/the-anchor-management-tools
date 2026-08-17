-- Make deleting a private booking actually require the delete permission.
--
-- private_bookings carried an ALL policy granting
--   auth.role() = 'service_role' OR manage OR edit OR create
-- alongside command-specific policies requiring create to INSERT, edit to UPDATE and
-- delete to DELETE. Postgres ORs permissive policies, so the effective DELETE rule was
--
--   (service_role OR manage OR edit OR create) OR delete
--
-- which means anyone holding create or edit could delete a private booking, and the
-- separate delete permission was doing nothing at the database layer.
--
-- This is not merely defence in depth. deletePrivateBooking in
-- src/services/private-bookings/mutations.ts uses the cookie client, so RLS is the
-- operative gate. The app-layer check in deletePrivateBooking was the only thing
-- stopping it, and anything reaching PostgREST directly with a staff session token
-- would not pass through that check.
--
-- Sizing, at the time of writing:
--   create  manager, super_admin
--   edit    manager, super_admin
--   delete  super_admin only
--   manage  NO SUCH PERMISSION ROW EXISTS, so that term was already dead
-- The manager role is deliberately denied delete, and currently has no members, so
-- this was latent rather than live. It would open the moment anyone is made a manager.
--
-- The fix is to drop the over-broad ALL policies and let the command-specific policies
-- govern. Nothing is lost by removing the service_role term: service_role has
-- rolbypassrls = true and never consults these policies at all, and in any case these
-- policies are granted TO authenticated, which a service_role connection is not.
--
-- After this, private_bookings reads need view, inserts need create, updates need edit
-- and deletes need delete, which is what the permission model already says.
--
-- private_booking_items gets the same treatment. Its remaining ALL policy requires
-- edit AND that the parent booking is visible, which is the stricter and intended
-- rule: changing a line item is editing the booking it belongs to. That policy was
-- previously dead, because the broad one granted everything it granted and more.

begin;

drop policy if exists "Users can manage private bookings" on public.private_bookings;

drop policy if exists "Users can manage private booking items" on public.private_booking_items;

commit;

-- Prove the permission model now holds, rather than trusting that the drops were
-- spelled correctly. Each command must be governed, and DELETE must not be reachable
-- through any policy that accepts create or edit.
do $$
declare
  delete_policies text[];
  offending text[];
begin
  select array_agg(polname)
  into delete_policies
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public' and c.relname = 'private_bookings'
    and p.polcmd in ('d', '*');

  if delete_policies is null or array_length(delete_policies, 1) <> 1 then
    raise exception 'private_bookings should have exactly one policy governing DELETE, found: %', delete_policies;
  end if;

  -- No remaining policy that can authorise a DELETE may mention create or edit.
  select array_agg(p.polname)
  into offending
  from pg_policy p
  join pg_class c on c.oid = p.polrelid
  join pg_namespace n on n.oid = c.relnamespace
  where n.nspname = 'public'
    and c.relname in ('private_bookings', 'private_booking_items')
    and p.polcmd in ('d', '*')
    and (pg_get_expr(p.polqual, p.polrelid) like '%''create''%'
      or (c.relname = 'private_bookings' and pg_get_expr(p.polqual, p.polrelid) like '%''edit''%'));

  if offending is not null then
    raise exception 'Policies still let create or edit authorise a delete: %', offending;
  end if;
end $$;

-- Close the last open policy: any signed-in account could insert a message row.
--
-- The read exposure was closed in 20260811100200, but INSERT was left alone
-- there because tightening it blind risked breaking sends. It has since been
-- checked properly: every path that writes to this table uses the service-role
-- client, which bypasses RLS entirely.
--
--   src/app/api/webhooks/twilio/route.ts   createAdminClient
--   src/lib/sms/logging.ts                 createAdminClient
--   src/services/communications.ts         createAdminClient
--
-- The only cookie-client touches on this table are reads. So requiring the send
-- permission takes nothing away from the app, and stops a staff login forging an
-- inbound message or a delivery record straight through PostgREST.

drop policy if exists "Allow authenticated users to insert messages" on public.messages;

create policy "messages_insert_with_permission"
  on public.messages for insert to authenticated
  with check (
    public.user_has_permission(auth.uid(), 'messages', 'send')
    or public.user_has_permission(auth.uid(), 'messages', 'send_transactional')
    or public.user_has_permission(auth.uid(), 'messages', 'send_marketing')
  );

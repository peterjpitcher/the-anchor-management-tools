-- Lock employee PII behind the employees permission, in the database.
--
-- Every one of these tables carried policies whose only condition was that the
-- caller is signed in ("auth.uid() IS NOT NULL"), granted to role `authenticated`.
-- The employees:view / employees:edit model was therefore enforced only in
-- application code and was bypassable: any staff-portal or FOH login could take
-- the public anon key out of the JS bundle, pair it with their own session, and
-- read (and via the ALL policies, write and delete) bank account numbers, sort
-- codes, NI numbers, medical records, dates of birth and home addresses for
-- every employee straight from PostgREST.
--
-- employee_right_to_work was already gated with user_has_permission and is read
-- through the same cookie client, in the same Promise.all, as its siblings in
-- EmployeeService. This migration simply applies that working pattern to the
-- other six tables and to the attachments bucket.
--
-- Not affected: everything using the service-role client, which bypasses RLS.
-- That covers all writes and the great majority of reads in the app.
--
-- Deliberately preserved: an employee reading their OWN row. The staff portal
-- (/portal/shifts, /portal/leave) and the FOH clock-in band resolve the signed-in
-- user to an employee record through the cookie and browser clients, and those
-- users hold no employees permission by design. The portal matches on
-- auth_user_id; the FOH band matches on email_address, and 3 auth users are
-- matchable by email only, so both linkages are honoured.

-- ---------------------------------------------------------------------------
-- employees
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view all employees" on public.employees;
drop policy if exists "Users can create employees" on public.employees;
drop policy if exists "Users can update employees" on public.employees;
drop policy if exists "Users can delete employees" on public.employees;

create policy "employees_select_with_permission_or_self"
  on public.employees for select to authenticated
  using (
    public.user_has_permission(auth.uid(), 'employees', 'view')
    or auth_user_id = auth.uid()
    or (
      email_address is not null
      and lower(email_address) = lower(nullif(auth.jwt() ->> 'email', ''))
    )
  );

create policy "employees_insert_with_permission"
  on public.employees for insert to authenticated
  with check (public.user_has_permission(auth.uid(), 'employees', 'create'));

create policy "employees_update_with_permission"
  on public.employees for update to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'edit'))
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

create policy "employees_delete_with_permission"
  on public.employees for delete to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'delete'));

-- ---------------------------------------------------------------------------
-- employee_financial_details
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view financial details" on public.employee_financial_details;
drop policy if exists "Users can manage financial details" on public.employee_financial_details;

create policy "employee_financial_details_select_with_permission"
  on public.employee_financial_details for select to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'view'));

create policy "employee_financial_details_write_with_permission"
  on public.employee_financial_details for all to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'edit'))
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

-- ---------------------------------------------------------------------------
-- employee_health_records
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view health records" on public.employee_health_records;
drop policy if exists "Users can manage health records" on public.employee_health_records;

create policy "employee_health_records_select_with_permission"
  on public.employee_health_records for select to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'view'));

create policy "employee_health_records_write_with_permission"
  on public.employee_health_records for all to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'edit'))
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

-- ---------------------------------------------------------------------------
-- employee_emergency_contacts
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view emergency contacts" on public.employee_emergency_contacts;
drop policy if exists "Users can manage emergency contacts" on public.employee_emergency_contacts;

create policy "employee_emergency_contacts_select_with_permission"
  on public.employee_emergency_contacts for select to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'view'));

create policy "employee_emergency_contacts_write_with_permission"
  on public.employee_emergency_contacts for all to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'edit'))
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

-- ---------------------------------------------------------------------------
-- employee_attachments (the metadata rows; the files themselves are below)
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view attachments" on public.employee_attachments;
drop policy if exists "Users can manage attachments" on public.employee_attachments;

create policy "employee_attachments_select_with_permission"
  on public.employee_attachments for select to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'view'));

create policy "employee_attachments_insert_with_permission"
  on public.employee_attachments for insert to authenticated
  with check (public.user_has_permission(auth.uid(), 'employees', 'upload_documents'));

create policy "employee_attachments_update_with_permission"
  on public.employee_attachments for update to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'edit'))
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

create policy "employee_attachments_delete_with_permission"
  on public.employee_attachments for delete to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'delete_documents'));

-- ---------------------------------------------------------------------------
-- employee_notes
--
-- The existing own-note update and delete policies are kept in spirit, but a
-- caller with no employees permission has no business touching HR notes at all,
-- so both now also require employees:edit.
-- ---------------------------------------------------------------------------

drop policy if exists "Users can view notes" on public.employee_notes;
drop policy if exists "Users can create notes" on public.employee_notes;
drop policy if exists "Users can update own notes" on public.employee_notes;
drop policy if exists "Users can delete own notes" on public.employee_notes;

create policy "employee_notes_select_with_permission"
  on public.employee_notes for select to authenticated
  using (public.user_has_permission(auth.uid(), 'employees', 'view'));

create policy "employee_notes_insert_with_permission"
  on public.employee_notes for insert to authenticated
  with check (public.user_has_permission(auth.uid(), 'employees', 'edit'));

create policy "employee_notes_update_own_with_permission"
  on public.employee_notes for update to authenticated
  using (
    auth.uid() = created_by_user_id
    and public.user_has_permission(auth.uid(), 'employees', 'edit')
  )
  with check (
    auth.uid() = created_by_user_id
    and public.user_has_permission(auth.uid(), 'employees', 'edit')
  );

create policy "employee_notes_delete_own_with_permission"
  on public.employee_notes for delete to authenticated
  using (
    auth.uid() = created_by_user_id
    and public.user_has_permission(auth.uid(), 'employees', 'edit')
  );

-- ---------------------------------------------------------------------------
-- storage: the employee-attachments bucket
--
-- Twelve overlapping policies had accumulated here, every one of them gated on
-- nothing but the bucket name. Policies are OR'd, so the loosest wins and all of
-- them have to go: any signed-in account could list the bucket, download every
-- passport and right-to-work scan, and DELETE the right-to-work evidence the
-- business is legally required to retain.
--
-- Browser uploads are unaffected. Both client-side upload paths
-- (NewEmployeeOnboardingClient, RightToWorkTab) use uploadToSignedUrl, which is
-- authorised by a server-minted token rather than by the caller's session.
-- ---------------------------------------------------------------------------

drop policy if exists "Allow authenticated uploads to employee-attachments" on storage.objects;
drop policy if exists "Allow authenticated user to upload attachments" on storage.objects;
drop policy if exists "Allow authenticated user to view attachments" on storage.objects;
drop policy if exists "Allow authenticated users to delete their own attachments" on storage.objects;
drop policy if exists "Allow individual delete access to employee-attachments" on storage.objects;
drop policy if exists "Allow individual read access to employee-attachments" on storage.objects;
drop policy if exists "Authenticated users can delete employee attachments" on storage.objects;
drop policy if exists "Authenticated users can upload employee attachments" on storage.objects;
drop policy if exists "Authenticated users can view employee attachments" on storage.objects;
drop policy if exists "Users can delete employee attachments with valid record" on storage.objects;
drop policy if exists "Users can upload employee attachments with proper path" on storage.objects;
drop policy if exists "Users can view employee attachments with valid record" on storage.objects;

create policy "employee_attachments_storage_select"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.user_has_permission(auth.uid(), 'employees', 'view_documents')
  );

create policy "employee_attachments_storage_insert"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'employee-attachments'
    and public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  );

create policy "employee_attachments_storage_delete"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'employee-attachments'
    and public.user_has_permission(auth.uid(), 'employees', 'delete_documents')
  );

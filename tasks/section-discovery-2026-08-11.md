# Discovery: problems found in employees, customers, messages, parking and private bookings

Read-only discovery run on 2026-08-11 against `main`. No files were changed and no fixes were applied.

## Status

Branch `fix/section-discovery-sweep`, 16 commits. Pipeline green: 4,774 tests,
clean type-check, clean lint at zero warnings, successful production build.

**All 7 criticals, all 33 highs and the whole medium tier are done.** The low
tier was deliberately cut to the five items with real consequences, as agreed.

| Tier | Total | Done | Deliberately closed | Remaining |
|---|---|---|---|---|
| Critical | 7 | 7 | 0 | 0 |
| High | 33 | 33 | 0 | 0 |
| Medium | 74 | 73 | 1 | 0 |
| Low | 86 | 5 | 81 | 0 |

### Database migrations: APPLIED to production

All six are live. Verified afterwards: zero wide-open policies remain across the
39 checked, no SECURITY DEFINER function is anonymously executable, and anon can
read none of the 48 pending_bookings rows.

- `20260811100000` employee PII RLS and the attachments bucket
- `20260811100100` anonymous EXECUTE and public reads
- `20260811100200` message and parking read RLS
- `20260811110000` unpartial the two upsert indexes
- `20260811110100` message templates, SMS queue, customer scores, pending bookings
- `20260811110200` messages INSERT

Migration history drift was repaired first: production held
`20260809145018_email_unsubscribe_tokens` while the local file was
`20260809130000`. `db push` runs cleanly again.

### Decisions taken

**pending_bookings** was scoped rather than dropped. Nothing in this repo reads
the table, so it is the website using the anon key, and dropping the policy could
break a live booking flow not visible from here. It now exposes only bookings
still in flight: zero of the 48 today.

**Message templates** kept, with the notice. The screen is now permission-gated
in the database too. Wiring the send helpers to read it remains an open product
choice, not a defect.

**FOH customer search** closed as not-a-defect. It needs a two-character query,
caps at 20 results and returns only a name and phone, and gating it would stop
FOH seating people.

**81 low-tier items closed** as cosmetic or dead-code tidying. The five kept were
the timeclock PIN in audit logs and exports, phone numbers in server logs,
back-to-back parking bookings being blocked, and an unthrottled PayPal order
endpoint.

### Corrections the reviewers caught

The review agents raised 54 problems against the build agents' work and caught
one overclaimed fix. The material ones: an ON CONFLICT change that would have
silently inserted duplicate customers and messages, GDPR erasure leaving health
data and 1,147 rows of booking notes behind, an erasure write that would have
collided with a unique index and aborted, and a masked-field check loose enough
to silently discard a half-edited bank detail while reporting success.

## How this was produced

- 15 finder agents: each of the 5 sections swept independently through 3 lenses (correctness and data integrity; security, permissions and privacy; UX, dead code and performance).
- Every candidate finding was then handed to a separate adversarial verifier told to refute it, with access to the live production database for read-only schema and data checks.
- A final completeness critic looked for what the section-by-section sweep could not see.
- 59 agents, 204 candidates, 12 refuted, 200 problems listed below.

**Read this caveat before planning work.** The verify pass rejected only 12 of 204 candidates. That is a low rejection rate and it means the verifiers were lenient, not that every item is beyond doubt. Treat critical and high as reliable (they were checked hardest, most against the live database). Treat medium and low as a strong candidate list to triage, not as proven defects. Verdict is recorded on every item: CONFIRMED means the verifier reproduced the reasoning in code, PLAUSIBLE means something material was left unproven.

## Verified directly against production

I re-checked the database-layer findings myself rather than take the agents' word for them. Every one held:

| Claim | Live state on 2026-08-11 |
|---|---|
| `employees`, `employee_financial_details`, `employee_health_records`, `employee_attachments` readable by any logged-in account | Confirmed. Both the view and the manage policies use `auth.uid() IS NOT NULL` for role `authenticated`. The manage policies also permit UPDATE and DELETE, so this is not read-only exposure. |
| `messages` readable by any logged-in account | Confirmed, `auth.uid() IS NOT NULL`. |
| `parking_bookings` readable by any logged-in account | Confirmed, `auth.uid() IS NOT NULL`. |
| `api_keys` readable by anon | Confirmed. anon holds SELECT and the policy "Public can read active API keys" permits any row where `is_active = true`. |
| anon can EXECUTE `record_customer_consent`, `create_short_link`, `import_customers_atomic`, `create_private_booking_transaction` | Confirmed. All four are SECURITY DEFINER. |
| anon can EXECUTE `get_bulk_sms_recipients` | Partly. There are two overloads. One is revoked, the other still grants anon EXECUTE, so the existing revoke migration missed a signature. |
| `customer_consent_legacy_gaps` exposes PII to anon | Confirmed. It is a view with no `security_invoker`, so it runs as owner and bypasses RLS, and anon holds SELECT on it. |
| `pending_bookings` exposes customer rows to anon | Confirmed. Policy `anon_read_pending_bookings` is granted to role `anon`. |

I also confirmed the worst application-code finding by hand. The parking cron's query at `src/app/api/cron/parking-notifications/route.ts:495` does not select `customer_first_name`, `start_at`, `end_at`, `override_price` or `calculated_price`, and `buildPaymentReminderSmsForStage` at `src/lib/parking/notifications.ts:30` reads all five. The `as ParkingBooking[]` cast at line 514 is what stops TypeScript catching it.

### Checked and dismissed

Outbound SMS templates in `src/lib/parking/notifications.ts` and `src/lib/private-bookings/messages.ts` contain em dashes, which would normally force UCS-2 encoding and cut the SMS segment limit from 160 characters to 70. This is **not** a live problem: `src/lib/twilio.ts:435` runs `normaliseToGsm7` on every outbound body and the substitution table maps U+2014 to a plain hyphen. Not listed below.

## Known duplication in this list

200 findings sit across 177 distinct file and line locations, so around 20 locations carry more than one finding. Some are genuinely different problems at the same line; some are the same problem described twice by two lenses. P005 and P006 are the clearest example, both describing the same broken parking reminder query. Expect to collapse roughly 10 to 20 items during triage.

## Totals

| Section | Critical | High | Medium | Low | Total |
|---|---|---|---|---|---|
| Employees | 2 | 4 | 14 | 19 | 39 |
| Customers | 0 | 3 | 25 | 16 | 44 |
| Messages | 2 | 8 | 11 | 13 | 34 |
| Parking | 2 | 5 | 12 | 21 | 40 |
| Private Bookings | 0 | 10 | 10 | 15 | 35 |
| Cross-cutting | 1 | 3 | 2 | 2 | 8 |
| **All** | **7** | **33** | **74** | **86** | **200** |

## Most common problem types

| Type | Count |
|---|---|
| `timezone-bug` | 15 |
| `dead-code` | 14 |
| `misleading-copy` | 11 |
| `missing-permission-check` | 7 |
| `gdpr-erasure-gap` | 5 |
| `missing-audit-log` | 5 |
| `unauthenticated-mutation` | 4 |
| `error-swallowing` | 4 |
| `missing-column-in-select` | 3 |
| `missing-state` | 3 |
| `state-machine-violation` | 3 |
| `dead-control` | 3 |
| `pii-in-logs` | 3 |
| `broken-navigation` | 3 |
| `correctness` | 3 |

## Dead code (13 items)

These are real defects in files nothing reachable in production imports. Fixing the code is wasted effort; deleting it is the fix.

- P122 `src/app/actions/employee-history.ts:58` Dead employee-history functions that no route or component can reach
- P144 `src/app/actions/customers.ts:669` Unreachable destructive deleteTestCustomers action left in the server-action file
- P145 `src/app/actions/customers.ts:669` Dead server actions and service methods in the Customers section
- P157 `src/app/actions/diagnose-messages.ts:8` Dead exported server actions and a dead action file in the Messages surface
- P158 `src/app/actions/diagnose-messages.ts:36` Message diagnosis window is a UTC day, not a London day
- P162 `src/services/messages.ts:301` Unreferenced messages statistics helpers silently truncate at PostgREST's 1000-row cap
- P179 `src/lib/parking/notifications.ts:16` Five unused SMS and email templates plus an unreachable reminder stage in the parking notifications module
- P181 `src/lib/parking/payments.ts:434` Dead refundParkingPayment in payments.ts has no amount ceiling and would mis-record partial refunds
- P182 `src/lib/parking/payments.ts:434` Dead refundParkingPayment helper performs an unpermissioned PayPal refund
- P183 `src/lib/parking/payments.ts:434` Dead 61-line refundParkingPayment duplicates a refund flow that no longer runs
- P188 `src/app/actions/privateBookingActions.ts:154` Dead server action `getPrivateBookings` has no callers
- P196 `src/services/private-bookings/payments.ts:560` Dead recordFinalPayment service function marks a booking fully paid without recording any payment
- P197 `src/services/private-bookings/payments.ts:560` Dead `PrivateBookingService.recordFinalPayment` shadows the live payment path

---

# Full list

Ordered by severity, then section. Each item carries the verifier verdict and the file and line it was proved at.

# CRITICAL (7)

## Employees

### P001. RLS on every employee PII table grants read access to any logged-in user

`supabase/migrations/20251123120000_squashed.sql:5025` | `missing-permission-check` | CONFIRMED

**Problem.** employees, employee_financial_details, employee_health_records, employee_notes, employee_emergency_contacts and employee_attachments all have RLS policies whose only condition is that the caller is authenticated, so the employees.view / employees.edit permission model is enforced only in application code and is trivially bypassed by calling PostgREST directly with the public anon key and any staff session.

**What goes wrong.** A staff-portal user (created by sendPortalInvite -> createEmployeeAccount, which makes a real Supabase auth user) opens devtools on /portal/shifts, takes NEXT_PUBLIC_SUPABASE_ANON_KEY out of the bundle plus their own session token, and issues GET /rest/v1/employee_financial_details?select=*. They receive every colleague's bank account number, sort code, NI number and payee name, then the same for employee_health_records (medical conditions, disability, doctor) and employees (DOB, home address, phone). Live DB: 24 auth users, 18 of which hold no role at all and therefore no employees permission; 11 employees have portal logins; 14 financial rows hold bank account numbers.

**Evidence.**

```
Migration: `CREATE POLICY "Users can view financial details" ON "public"."employee_financial_details" FOR SELECT TO "authenticated" USING (true);` (line 5025) and `CREATE POLICY "Users can manage financial details" ON "public"."employee_financial_details" TO "authenticated" USING (true) WITH CHECK (true);` (line 4951).
Live DB (pg_policy) confirms the same shape today for all six tables, e.g. employee_financial_details / "Users can view financial details" / cmd=r / roles={authenticated} / using = `(auth.uid() IS NOT NULL)`; employees / "Users can view all employees" / using = `(auth.uid() IS NOT NULL)`.
Contrast employee_right_to_work, which does it correctly: using = `user_has_permission(auth.uid(), 'employees'::text, 'view'::text)`.
Browser client that ships the anon key: src/lib/supabase/client.ts:11 `createBrowserClient<Database>(supabaseUrl, supabaseAnonKey)`.
```

**Verifier.** Verified in source and against the live DB; I found no mitigating guard. SOURCE (line numbers exact): line 5025 `CREATE POLICY "Users can view financial details" ON "public"."employee_financial_details" FOR SELECT TO "authenticated" USING (true);`, line 4951 `CREATE POLICY "Users can manage financial details" ... TO "authenticated" USING (true) WITH CHECK (true);`, line 4987 `CREATE POLICY "Users can view all employees" ON "public"."employees" FOR SELECT TO "authenticated" USING (true);`. I looked for the thing that would refute this. supabase/migrations/20260708000009_fix_supabase_lints.sql:117-118 does revisit these tables, but it only rewrites `USING (true)` to `USING (auth.uid() IS NOT NULL)` , it does not add a permission check. Live pg_policy confirms today's state for all six tables: employees, employee_financial_details, employee_health_records, employee_notes, employee_emergency_contacts, employee_attachments all have SELECT policies with `using = (auth.uid() IS NOT NULL)` and roles={authenticated}. Contrast employee_right_to_work on the same live DB: `user_has_permission(auth.uid(), 'employees', 'view')` , proving the correct pattern exists and was simply not applied here. Grants are not a backstop either: information_schema.role_table_grants shows `authenticated` holds SELECT,INSERT,UPDATE,DELETE on employees, employee_financial_details, employee_health_records and employee_attachments. Next.js middleware cannot help because PostgREST is a separate Supabase origin. Exploitability is real, not theoretical. Live counts: 24 auth.users, 18 with no user_roles row at all, 17 role-less users have actually signed in (last_sign_in_at not null), 8 employees have a portal login and zero roles. createEmployeeAccount (src/app/actions/employeeInvite.ts:527 `adminClient.auth.admin.createUser`) makes a genuine auth user, so those principals are real. 14 employee_financial_details rows hold bank_account_number. src/lib/supabase/client.ts:11 ships the anon key to the browser. I am RAISING the scope beyond what was reported: the ALL/"manage" policies carry `WITH CHECK (auth.uid() IS NOT NULL)`, so any authenticated user can also UPDATE and DELETE employees and financial details, not merely read them. Critical stands.

**Suggested fix.** Replace the `auth.uid() IS NOT NULL` / `USING (true)` policies on these six tables with `user_has_permission(auth.uid(), 'employees', '<view|edit>')`, matching the pattern already used on employee_right_to_work and employee_onboarding_checklist, and add a separate self-read policy for the staff portal if portal users genuinely need their own row.

### P002. Any authenticated user can download and delete every file in the employee-attachments bucket

`supabase/migrations/20260425100000_fix_employee_attachments_storage_bucket.sql:69` | `missing-permission-check` | CONFIRMED

**Problem.** The storage.objects policies for the employee-attachments bucket are gated only on bucket_id, so the employees.view_documents and employees.delete_documents permissions the app enforces in getAttachmentSignedUrl and deleteEmployeeAttachment are bypassable by calling the Storage API directly with any staff session.

**What goes wrong.** A staff-portal user with no employees permission calls POST /storage/v1/object/list/employee-attachments with their own session and the public anon key, enumerates every folder (one per employee_id), then downloads passports and right-to-work scans, contracts and any document a manager uploaded. The same session can call DELETE on those object paths and destroy the right-to-work evidence the business is legally required to retain. There are 271 objects in the bucket today.

**Evidence.**

```
Migration lines 69-72: `CREATE POLICY "Authenticated users can view employee attachments" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'employee-attachments');` and lines 81-84: `CREATE POLICY "Authenticated users can delete employee attachments" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'employee-attachments');`
Live pg_policy on storage.objects confirms six such bucket-only policies for this bucket (view x3, delete x3), versus recruitment-cvs which is correctly gated: `((bucket_id = 'recruitment-cvs') AND user_has_permission(auth.uid(), 'recruitment', 'view'))`.
App-level check that is being bypassed: src/app/actions/employeeActions.ts:861 `const hasPermission = await checkUserPermission('employees', 'view_documents')`.
```

**Verifier.** Verified. Source lines are exact: line 69 `CREATE POLICY "Authenticated users can view employee attachments" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'employee-attachments');` and line 81 the matching FOR DELETE policy with the same bucket-only USING clause. I searched for a mitigating policy and found none. Live pg_policy on storage.objects returns three SELECT and three DELETE policies for this bucket whose entire USING clause is `(bucket_id = 'employee-attachments'::text)`. Two further policies ('Users can view/delete employee attachments with valid record') add `EXISTS (SELECT 1 FROM employee_attachments ea WHERE ea.storage_path = objects.name)` , that is NOT a guard for two reasons: RLS policies are permissive and OR'd, so the bucket-only ones already grant access; and per finding employees-16 any authenticated user can read employee_attachments anyway. The same live query shows recruitment-cvs done correctly: `((bucket_id = 'recruitment-cvs') AND user_has_permission(auth.uid(), 'recruitment', 'view'))`, so the correct pattern was known and not applied. The app-level checks being bypassed are live: src/app/actions/employeeActions.ts:860 `const hasPermission = await checkUserPermission('employees', 'view_documents')` inside getAttachmentSignedUrl, imported by src/components/features/employees/EmployeeAttachmentsList.tsx:7. Live data confirms the exposure is not empty: 271 objects in the employee-attachments bucket, and 17 role-less auth users have signed in. Critical stands. Note the DELETE half is arguably the worse limb: right-to-work evidence the business must retain by law is destroyable by any staff session.

**Suggested fix.** Rewrite the employee-attachments storage policies to `bucket_id = 'employee-attachments' AND user_has_permission(auth.uid(), 'employees', 'view_documents'|'delete_documents'|'upload_documents')`, copying the recruitment-cvs pattern, and drop the duplicate legacy policies.

## Messages

### P003. Revoke anon EXECUTE on record_customer_consent , anyone can reverse a customer's STOP

`supabase/migrations/20260708000012_customer_consent_audit.sql:295` | `unauthenticated-mutation` | CONFIRMED

**Problem.** record_customer_consent is SECURITY DEFINER, writes to customer_consents and directly UPDATEs the customers opt-in columns, and still holds an explicit EXECUTE grant to anon. An unauthenticated caller with the public anon key and a customer id can set sms_opt_in=TRUE, sms_status='active' and marketing_sms_opt_in=TRUE, silently undoing an opt-out the customer made by texting STOP.

**What goes wrong.** An attacker harvests customer ids from the anon-callable get_bulk_sms_recipients RPC (which returns `id`), then POSTs to /rest/v1/rpc/record_customer_consent with {p_customer_id: <id>, p_channel:'sms', p_purpose:'service', p_status:'opted_in', p_legal_basis:'consent', p_source:'x', p_capture_method:'x'}. The function's summary branch runs UPDATE customers SET sms_opt_in=TRUE, sms_status='active', sms_delivery_failures=0 for that customer. The pub then legitimately texts someone who had opted out, and the consent audit row that is supposed to prove lawful basis is itself forged. The mirror attack (p_status:'opted_out') silently suppresses every booking confirmation and reminder for chosen customers.

**Evidence.**

```
Migration intent (lines 294-300):

  REVOKE ALL ON FUNCTION public.record_customer_consent(
    UUID, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, UUID, TEXT, TEXT, TEXT, TEXT, TEXT, JSONB, BOOLEAN
  ) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.record_customer_consent(...) TO service_role;

REVOKE ... FROM PUBLIC does not drop the explicit anon grant Supabase adds on CREATE FUNCTION. Live production:
  proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  has_function_privilege('anon', oid, 'EXECUTE') = true

Function body (SECURITY DEFINER, no auth check) contains:
  IF p_channel = 'sms' AND p_purpose = 'service' THEN
    IF p_status = 'opted_in' THEN
      UPDATE public.customers SET sms_opt_in = TRUE, sms_status = 'active', sms_opt_in_at = v_now, sms_delivery_failures = 0, sms_deactivated_at = NULL ...

This is the same function the inbound STOP handler relies on for its audit trail (src/app/api/webhooks/twilio/route.ts:758 ConsentService.recordOptOut).
```

**Verifier.** Verified end to end and found no mitigating guard. (1) Live ACL: SELECT proacl FROM pg_proc for public.record_customer_consent returns {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres} and has_function_privilege('anon',oid,'EXECUTE')=true. The migration's REVOKE ALL ... FROM PUBLIC at line 295 does not strip the explicit anon grant, exactly as the finder claimed. (2) Live pg_get_functiondef confirms SECURITY DEFINER, SET search_path TO 'public','extensions', and a body whose only precondition is PERFORM 1 FROM public.customers WHERE id = p_customer_id FOR UPDATE; there is no auth.uid() check, no user_has_permission() call, and no reference to the caller's role anywhere. SECURITY DEFINER runs as the owner so the table-level REVOKE ALL ON public.customer_consents FROM anon, authenticated (line 129) does not stop it. (3) The summary branch is live in production: IF p_channel='sms' AND p_purpose='service' THEN IF p_status='opted_in' THEN UPDATE public.customers SET sms_opt_in=TRUE, sms_status='active', sms_opt_in_at=v_now, sms_opt_in_source=p_source, sms_delivery_failures=0, sms_deactivated_at=NULL... and the mirror opted_out branch sets sms_opt_in=FALSE, sms_status='opted_out', marketing_sms_opt_in=FALSE. p_update_summary defaults TRUE. (4) The function is in the public schema so PostgREST exposes it at /rest/v1/rpc/record_customer_consent, and the anon key is shipped to every browser as NEXT_PUBLIC_SUPABASE_ANON_KEY. (5) The harvest vector the finder described is also real, which is what makes this practically exploitable rather than theoretical: the 9-arg overload get_bulk_sms_recipients(uuid,text,boolean,uuid,date,date,text,integer,integer) has proacl {postgres=X,anon=X,authenticated=X,service_role=X}, anon_exec=true, is SECURITY DEFINER with no auth check in its body, and RETURNS TABLE(id uuid, first_name text, last_name text, mobile_number text, last_booking_date date, total_count bigint). So customer ids do not need guessing. (6) Live code: src/services/consent.ts:82 calls this same RPC via createAdminClient(), and src/app/api/webhooks/twilio/route.ts:758 calls ConsentService.recordOptOut for inbound STOP, so this is the production consent writer, not a legacy artefact. I looked specifically for a later migration or a trigger revoking the grant and there is none: the live catalogue is the authority and it still shows anon=X. Severity critical stands: unauthenticated write to opt-out state on a live production database, with both a suppression attack (silence a customer's booking confirmations) and a re-subscribe attack (forge lawful basis and text someone who sent STOP).

**Suggested fix.** Migration: REVOKE EXECUTE ON FUNCTION public.record_customer_consent(...) FROM anon, authenticated. All app callers already go through the service-role client via ConsentService.

### P004. Revoke anon EXECUTE on get_bulk_sms_recipients , 353 customers' names and mobiles are public

`supabase/migrations/20260708000042_bulk_sms_recipients_revoke.sql:1` | `missing-permission-check` | CONFIRMED

**Problem.** The paginated get_bulk_sms_recipients RPC is SECURITY DEFINER with no internal auth check and still holds an explicit EXECUTE grant to the anon role, so anyone holding the public NEXT_PUBLIC_SUPABASE_ANON_KEY can page through the full marketing recipient list (id, first_name, last_name, E.164 mobile, last booking date) via PostgREST, bypassing RLS and the messages:send_marketing check in the app.

**What goes wrong.** An attacker reads NEXT_PUBLIC_SUPABASE_ANON_KEY from the AMS JavaScript bundle (it ships to every browser) and POSTs to https://tfcasgxopxegwrabvwat.supabase.co/rest/v1/rpc/get_bulk_sms_recipients with {"p_page":1,"p_page_size":100}. They receive 100 customer rows including full names and mobile numbers, and page through all 353 opted-in customers. No login, no staff account, no rate limit.

**Evidence.**

```
Migration intended to lock the function down but only revoked from PUBLIC, which does not remove Supabase's default explicit anon grant:

  REVOKE ALL ON FUNCTION public.get_bulk_sms_recipients(UUID, TEXT, BOOLEAN, UUID, DATE, DATE, TEXT, INTEGER, INTEGER) FROM PUBLIC;

and 20260708000043_bulk_sms_recipients_grant.sql:1 only adds `TO authenticated`. Live production check:

  proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}
  has_function_privilege('anon', oid, 'EXECUTE') = true

Executed live as the anon role:
  SET LOCAL ROLE anon; SELECT count(*), min(mobile_number) IS NOT NULL FROM public.get_bulk_sms_recipients(null,null,true,null,null,null,null,1,100);
  -> rows_returned = 100, mobiles_present = true

Function body is SECURITY DEFINER with no auth.uid()/permission guard and RETURNS TABLE(id uuid, first_name text, last_name text, mobile_number text, last_booking_date date, total_count bigint). Total exposed population: SELECT count(*) FROM customers WHERE mobile_e164 IS NOT NULL AND sms_opt_in AND marketing_sms_opt_in AND (sms_status IS NULL OR sms_status='active') = 353.

The only intended caller is src/app/actions/bulk-messages.ts:33, which already gates on checkUserPermission('messages','send_marketing', user.id) at line 23.
```

**Verifier.** FULLY CONFIRMED against the live production database, and the repo contains a migration that documents this exact trap and forgot this function. Live ACL check on project tfcasgxopxegwrabvwat: get_bulk_sms_recipients(uuid,text,boolean,uuid,date,date,text,integer,integer) -> prosecdef = true, proacl = {postgres=X/postgres,anon=X/postgres,authenticated=X/postgres,service_role=X/postgres}, has_function_privilege('anon',oid,'EXECUTE') = true, provolatile = 'v' (so it is a POST /rpc endpoint). I executed it as the anon role read-only (BEGIN; SET LOCAL ROLE anon; ...; ROLLBACK) and got rows_returned = 100, mobiles_present = true, total_count = 353. So the finder's reproduction is accurate, including the 353 figure. I actively looked for the thing that would make this safe and found none: - No auth guard in the function body. I checked prosrc on BOTH overloads for auth.uid / auth.role / current_setting / user_has_permission: false on both. The migration body (supabase/migrations/20260708000033_paginate_bulk_sms_recipients.sql:3-113) confirms this - SECURITY DEFINER, SET search_path = public, straight into RETURN QUERY. - SECURITY DEFINER means RLS on customers does not apply. - No db-pre-request hook: the authenticator role's setconfig is only [session_preload_libraries=safeupdate, statement_timeout=8s, lock_timeout=8s], no pgrst.db_pre_request. - The anon key is genuinely public: src/lib/supabase/client.ts:7 reads NEXT_PUBLIC_SUPABASE_ANON_KEY in the browser client, so it is inlined into the shipped bundle. - PostgREST exposure of this exact function is proven by the app itself calling supabase.rpc('get_bulk_sms_recipients', ...) at src/app/actions/bulk-messages.ts:33; the only difference for an attacker is the role, and anon holds EXECUTE. ROOT CAUSE confirmed and better than the finder stated. supabase/migrations/20260801001300_lock_down_new_function_grants.sql:8-11 spells it out: "Supabase configures ALTER DEFAULT PRIVILEGES so that a newly created function in public is granted EXECUTE to anon and authenticated BY NAME. REVOKE ... FROM PUBLIC removes the PUBLIC pseudo-role only; it does not touch a grant made to a named role." That migration swept 20 table-booking functions and does NOT include get_bulk_sms_recipients, so this one stayed open. Note the older 7-arg overload has already lost its anon grant (proacl {postgres,authenticated,service_role}) - only the current 9-arg paginated one is exposed, which is the one the app uses. The app-side gate at src/app/actions/bulk-messages.ts:19-24 (auth.getUser + checkUserPermission('messages','send_marketing', user.id)) is intact but irrelevant: the attacker bypasses the app entirely. Severity critical stands - unauthenticated retrieval of 353 customers' full names and E.164 mobile numbers, pageable 100 at a time, is a GDPR-reportable personal-data exposure. Fix is a new migration doing REVOKE ALL ON FUNCTION public.get_bulk_sms_recipients(UUID,TEXT,BOOLEAN,UUID,DATE,DATE,TEXT,INTEGER,INTEGER) FROM anon; plus the same proacl assertion block that migration 20260801001300 uses.

**Suggested fix.** Add a migration that runs REVOKE EXECUTE ... FROM anon (and consider authenticated too, since the action already re-checks permission and could call it via the service-role client). Sweep every SECURITY DEFINER function for an explicit anon grant rather than relying on REVOKE ... FROM PUBLIC.

## Parking

### P005. Parking reminder SMS reads columns the cron never selects, texting customers "undefined" and "Invalid Date"

`src/app/api/cron/parking-notifications/route.ts:495` | `missing-column-in-select` | CONFIRMED

**Problem.** Both cron reminder queries select a narrow column list, but the SMS builders read customer_first_name, start_at, end_at, override_price/calculated_price and vehicle_registration from the same row object, so those fields are undefined and the customer receives a message containing "undefined", "Invalid Date" and "£0.00".

**What goes wrong.** A booking is pending payment with under 24h left. The cron selects only 'id, customer_id, customer_mobile, customer_email, payment_due_at, expires_at, unpaid_*_sms_sent' and passes the row to buildPaymentReminderSmsForStage, which reads booking.customer_first_name (undefined), booking.start_at (undefined -> new Date(undefined) -> Invalid Date) and booking.override_price ?? booking.calculated_price ?? 0 (0). The customer is texted: "The Anchor: undefined! Your parking offer expires tomorrow - £0.00 for Invalid Date to Invalid Date." The paid-session query at line 676 has the same defect, producing "The Anchor: undefined! Your parking kicks off on 4 Jun 2026, 14:00 - just checking you've got undefined ready to go!"

**Evidence.**

```
route.ts:495 `.select('id, customer_id, customer_mobile, customer_email, payment_due_at, expires_at, unpaid_day_before_sms_sent, unpaid_week_before_sms_sent')` then :514 `for (const booking of bookings as ParkingBooking[])` and :588 `buildPaymentReminderSmsForStage(booking, 'day_before_expiry', ...)`.
route.ts:676 `.select('id, customer_id, customer_mobile, customer_email, start_at, end_at, paid_start_three_day_sms_sent, paid_end_three_day_sms_sent')` then :743 `buildSessionThreeDayReminderSms(booking, 'start')`.
src/lib/parking/notifications.ts:35 `return \`The Anchor: ${booking.customer_first_name}! Just a nudge - your parking from ${formatDateTime(booking.start_at)} ... (£${amount.toFixed(2)})\`` and :89 `...you've got ${booking.vehicle_registration} ready to go!`.
PRODUCTION EVIDENCE (parking_booking_notifications, payload->>'sms'): 2026-06-02 "The Anchor: undefined! Your parking offer expires tomorrow - £0.00 for Invalid Date to Invalid Date. Last chance: Sort it here: https://www.paypal.com/checkoutnow?token=2V260025HC003262W" (status 'sent'); 2026-06-05 "The Anchor: undefined! Heads up - your parking wraps up on 8 Jun 2026, 14:00..."; 2026-06-02 "...kicks off on 4 Jun 2026, 14:00 - just checking you've got undefined ready to go!". Ten such rows exist, the oldest from 2026-03-26.
```

**Verifier.** Reproduced in full. src/app/api/cron/parking-notifications/route.ts:495 selects only 'id, customer_id, customer_mobile, customer_email, payment_due_at, expires_at, unpaid_day_before_sms_sent, unpaid_week_before_sms_sent', then :514 casts with `for (const booking of bookings as ParkingBooking[])` (the cast is what hides the missing fields from TypeScript) and :588/:642 pass that row to buildPaymentReminderSmsForStage. That builder (src/lib/parking/notifications.ts:30-43) reads booking.customer_first_name, booking.start_at, booking.end_at and `booking.override_price ?? booking.calculated_price ?? 0` , none of which are in the select, so they are undefined. src/lib/dateUtils.ts:226 formatDateTime calls toDate() (line 5-7: `new Date(value)`), and new Date(undefined) is an Invalid Date whose toLocaleString renders 'Invalid Date'. The second query at :676 has the same defect: it omits customer_first_name and vehicle_registration, both read by buildSessionThreeDayReminderSms (notifications.ts:87-92). I looked for mitigations and found none: PostgREST returns only the selected columns, there is no view or trigger involved, and no upstream hydration of the row. Settled against production: `select payload->>'sms' from parking_booking_notifications` returns 10 rows containing 'undefined'/'Invalid Date' with status 'sent', e.g. booking 4a4fa42b (2026-06-02) "The Anchor: undefined! Your parking offer expires tomorrow , £0.00 for Invalid Date to Invalid Date. Last chance: Sort it here: https://www.paypal.com/checkoutnow?token=2V260025HC003262W" and (2026-06-02) "...kicks off on 4 Jun 2026, 14:00 , just checking you've got undefined ready to go!". Oldest 2026-03-26. Severity stays critical: it is firing now, is customer-facing, and misstates the amount due as £0.00.

**Suggested fix.** Add customer_first_name, start_at, end_at, reference, override_price, calculated_price and vehicle_registration to both selects (or select '*'), and give the SMS builders a narrow input type so a missing field is a compile error rather than the string "undefined".

### P006. Parking payment-reminder SMS sends "undefined", "Invalid Date" and £0.00 to customers

`src/app/api/cron/parking-notifications/route.ts:495` | `missing-column-in-select` | CONFIRMED

**Problem.** processPendingPaymentLifecycle selects only 8 columns from parking_bookings, then passes that partial row to buildPaymentReminderSmsForStage, which reads customer_first_name, start_at, end_at, override_price and calculated_price. None of those are selected, so the outgoing customer SMS renders undefined values.

**What goes wrong.** An unpaid parking booking reaches the day-before-expiry window. The cron sends: "The Anchor: undefined! Your parking offer expires tomorrow - £0.00 for Invalid Date to Invalid Date. Last chance: Sort it here: https://www.paypal.com/checkoutnow?token=...". This is confirmed in production: parking_booking_notifications holds exactly that text for template_key parking_payment_reminder_day_before_expiry with status 'sent' on 2026-06-02 and 2026-04-26. Customers are being asked to pay £0.00 for a booking with no dates.

**Evidence.**

```
route.ts:495 `.select('id, customer_id, customer_mobile, customer_email, payment_due_at, expires_at, unpaid_day_before_sms_sent, unpaid_week_before_sms_sent')`; route.ts:510 `for (const booking of bookings as ParkingBooking[])`; route.ts:588 `smsBody: buildPaymentReminderSmsForStage(booking, 'day_before_expiry', paymentLink || undefined)`. src/lib/parking/notifications.ts:30 `const amount = booking.override_price ?? booking.calculated_price ?? 0`; notifications.ts:39 uses `${booking.customer_first_name}` and `formatDateTime(booking.start_at)`. Live parking_booking_notifications row: "The Anchor: undefined! Your parking offer expires tomorrow - £0.00 for Invalid Date to Invalid Date. Last chance: Sort it here: https://www.paypal.com/checkoutnow?token=2V260025HC003262W" (status sent).
```

**Verifier.** Verified end to end. route.ts:495 selects only `id, customer_id, customer_mobile, customer_email, payment_due_at, expires_at, unpaid_day_before_sms_sent, unpaid_week_before_sms_sent`, then line 514 casts the partial rows with `for (const booking of bookings as ParkingBooking[])` , the cast is what defeats TypeScript here. That same partial object is passed unmodified to buildPaymentReminderSmsForStage at line 588 (day-before) and 642 (week-before). src/lib/parking/notifications.ts:30 reads `booking.override_price ?? booking.calculated_price ?? 0` (neither selected, so 0) and lines 35/39 read `booking.customer_first_name` and `formatDateTime(booking.start_at)` / `formatDateTime(booking.end_at)` (none selected). I looked for a re-fetch and found none: sendParkingReminderSms (route.ts:825-957) takes the caller's smsBody string verbatim and only touches customer_mobile/customer_id/customer_email, all of which ARE selected , so the SMS sends successfully with the garbage body. formatDateTime (dateUtils.ts:226) does `toDate(date).toLocaleString(...)`, which yields the literal 'Invalid Date' for undefined. LIVE CODE: the cron is registered in vercel.json:129-130 at `*/15 * * * *`. Confirmed in production data , parking_booking_notifications holds template_key parking_payment_reminder_day_before_expiry with status 'sent' and body "The Anchor: undefined! Your parking offer expires tomorrow , £0.00 for Invalid Date to Invalid Date. Last chance: Sort it here: https://www.paypal.com/checkoutnow?token=2V260025HC003262W" (sent_at 2026-06-02 16:45:51+00) and an identical one on 2026-04-26 with token 7J679767U7239384K. Still broken at HEAD. Critical stands: this is a customer-facing payment demand quoting £0.00 against a real PayPal order.

**Suggested fix.** Add customer_first_name, start_at, end_at, override_price and calculated_price to the select, or select '*'. A regression test asserting the built SMS contains no 'undefined'/'Invalid Date'/'£0.00' would stop this recurring.

## Cross-cutting

### P007. Revoke anon SELECT on customer_consent_legacy_gaps , 127 customers' PII is public

`supabase/migrations/20260708000012_customer_consent_audit.sql:408` | `unauthenticated-pii-exposure` | PLAUSIBLE

**Problem.** The customer_consent_legacy_gaps view was created without `security_invoker`, so it runs as its postgres owner and bypasses RLS on customers; the public-schema default privileges then handed `anon` SELECT on it, so anyone holding the browser-visible anon key can read 127 customers' first name, last name, mobile number and email.

**What goes wrong.** Anyone reads NEXT_PUBLIC_SUPABASE_ANON_KEY out of the AMS JavaScript bundle (it is public by design) and issues `GET /rest/v1/customer_consent_legacy_gaps?select=*`. PostgREST returns 143 rows covering 127 distinct customers with full name, mobile and email. No login, no RLS. I confirmed this against production by running the query under `SET LOCAL ROLE anon`: anon_visible_rows=143, customers=127, sample mobile '+13344447424'. The whole Customers-section RLS work the sweep audited is bypassed by this one view.

**Evidence.**

```
supabase/migrations/20260708000012_customer_consent_audit.sql:408
``​`sql
CREATE OR REPLACE VIEW public.customer_consent_legacy_gaps AS
SELECT
  c.id AS customer_id,
  c.first_name,
  c.last_name,
  c.mobile_number,
  c.email,
...
GRANT SELECT ON public.customer_consent_legacy_gaps TO authenticated, service_role;   -- line 437
``​`
The grant at line 437 names only authenticated and service_role, but production disagrees. Live `pg_class.relacl` for the view: `postgres=arwdDxt/postgres | anon=arwdDxt/postgres | authenticated=arwdDxt/postgres | service_role=arwdDxt/postgres`. Live reloptions carry no `security_invoker`, and the owner is `postgres` (BYPASSRLS). Probe as anon returned 143 rows / 127 customers.
```

**Verifier.** Raised by the completeness critic; not independently re-verified.

**Suggested fix.** Recreate the view WITH (security_invoker = true) and add an explicit `REVOKE ALL ON public.customer_consent_legacy_gaps FROM anon, PUBLIC;` in the same migration. Audit every other view for the same pattern , cashup_weekly_view and menu_dishes_with_costs have the identical defect (2,778 and 420 rows anon-visible).

# HIGH (33)

## Employees

### P008. Onboarding health checkboxes store the React event, not a boolean

`src/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep.tsx:117` | `state-corruption` | CONFIRMED

**Problem.** The Health step's local `checkField` helper renders a raw `<input type="checkbox">` but names the onChange parameter `checked` and writes it straight into state, so every health/allergy/disability flag is set to a React SyntheticEvent object instead of `true`/`false`.

**What goes wrong.** A new starter opens their onboarding link and reaches the Health Information step. They tick "Diabetes". `setData({...data, has_diabetes: <SyntheticBaseEvent>})` runs; the object is truthy so `checked={data[id] as boolean}` keeps the box ticked. Clicking again fires onChange with another event object, still truthy, so the box can never be unticked. On submit the object is passed as an argument to the `saveOnboardingSection` server action, where either React's Flight serializer rejects the non-plain object or `HealthSectionSchema`'s `z.boolean()` rejects it ("Expected boolean, received object"). Either way `setError(...)` fires and the step cannot be saved. The allergy declaration in particular is food-safety relevant, and the only way out is a full page reload that discards the answers.

**Evidence.**

```
src/app/(employee-onboarding)/onboarding/[token]/steps/HealthStep.tsx:112-119
``​`tsx
const checkField = (id: keyof HealthData, label: string) => (
  <label className="flex items-start gap-3 cursor-pointer">
    <input
      type="checkbox"
      checked={data[id] as boolean}
      onChange={(checked) => setData({ ...data, [id]: checked })}
``​`
Contrast the design-system component, which is what every manager-facing form uses and which really does hand back a boolean ,  src/ds/primitives/Checkbox.tsx:66-73:
``​`tsx
onChange={(event) => {
  const nextChecked = event.target.checked
  ...
  onChange?.(nextChecked)
}}
``​`
And the schema the value has to satisfy ,  src/app/actions/employeeInvite.ts:612 `has_diabetes: z.boolean().default(false),`. tests/components/OnboardingStepErrors.test.tsx covers CreateAccountStep, PersonalStep and ReviewStep but never HealthStep, which is why this was not caught.
```

**Verifier.** Verified line 117 exactly as quoted: `onChange={(checked) => setData({ ...data, [id]: checked })}` on a raw `<input type="checkbox">`. React passes a SyntheticEvent, not a boolean, so the parameter name `checked` is a lie and the event object lands in state. I looked for every mitigating guard and found none: (a) no coercion anywhere between state and the wire , handleSubmit lines 65-85 pass `data.has_diabetes` etc. straight through; (b) HealthSectionSchema at src/app/actions/employeeInvite.ts:601-619 is `z.boolean().default(false)` with no coerce/preprocess, and saveOnboardingSection uses `.parse()` (line 768), which throws ZodError, caught at line 782 and returned as `{success:false,error}`; (c) no DB default or trigger rescues it because the write never reaches Postgres. The unticking latch is real too: `checked={data[id] as boolean}` coerces the truthy event object to true, and each further click produces a new (still truthy) event, so React re-renders the box back to checked. Confirmed LIVE: HealthStep is imported by src/app/(employee-onboarding)/onboarding/[token]/_components/OnboardingClient.tsx:10 and rendered at :179, which is imported by the route page at .../[token]/page.tsx:4 and rendered at :83. Contrast is accurate , src/ds/primitives/Checkbox.tsx:68-73 really does extract `event.target.checked` before calling onChange. Test coverage claim also verified: tests/components/OnboardingStepErrors.test.tsx exists but never touches HealthStep; the only `has_diabetes` reference in tests is tests/actions/employeeInvite.test.ts:407, a server-side test that passes a real boolean, so it cannot catch this. Severity lowered critical -> high: it is a hard block on the onboarding health step for any starter who ticks a box, but it fails loudly with a visible error rather than writing corrupt data, and managers retain a working path via HealthRecordsForm on /employees/[id]/edit?tab=health.

**Suggested fix.** Use the `@/ds` `Checkbox` (which already yields a boolean) or change the handler to `onChange={(e) => setData({ ...data, [id]: e.target.checked })}`.

### P009. employee-history.ts ships two unreachable functions wrapping live database RPCs

`src/app/actions/employee-history.ts:58` | `dead-code` | CONFIRMED

**Problem.** restoreEmployeeVersion and compareEmployeeVersions are declared without the export keyword in a 'use server' file, so nothing can call them, yet both wrap RPCs that exist in the production database , a version-restore feature that looks implemented but is not reachable.

**What goes wrong.** A maintainer asked to "restore an employee to a previous version" finds restoreEmployeeVersion, assumes the feature exists and wires a button to it, without realising it has never run against production and has never been exercised. Meanwhile restore_employee_version and compare_employee_versions remain live SECURITY-sensitive functions in the database with no application caller.

**Evidence.**

```
employee-history.ts:58: `async function restoreEmployeeVersion(employeeId: string, versionNumber: number) {` ,  no export.
employee-history.ts:87: `async function compareEmployeeVersions(employeeId: string, version1: number, version2: number) {` ,  no export.
Only getEmployeeChangesSummary (line 12) is exported and it is the only one imported anywhere (EmployeeRecentChanges.tsx:4).

Live DB confirms both RPCs exist: select routine_name from information_schema.routines where routine_name in ('restore_employee_version','compare_employee_versions') → both rows returned.
```

**Verifier.** The dead-code half is confirmed and the finder UNDER-RATED the security half badly. Dead code: employee-history.ts:58 `async function restoreEmployeeVersion(...)` and :87 `async function compareEmployeeVersions(...)` have no export keyword; a repo-wide grep of src/, tests/ and scripts/ returns only those two declaration lines, and the only import of the module anywhere is `import { getEmployeeChangesSummary } from '@/app/actions/employee-history'` at src/components/features/employees/EmployeeRecentChanges.tsx:4. So the TypeScript permission checks in those two functions never execute. What the finder missed is what that means for the DB side they themselves named. I pulled both definitions and their ACLs from production. (a) compare_employee_versions(uuid,int,int) is SECURITY DEFINER with proacl '=X/postgres | postgres=X | authenticated=X | service_role=X' , the leading '=X' is a grant to PUBLIC, so anon has EXECUTE , and its body contains NO permission check whatsoever: it selects new_values straight out of employee_version_history and returns field_name/version1_value/version2_value rows. The ONLY auth gate on that RPC was the `user_has_permission` call in the unexported TypeScript wrapper. employee_version_history holds 2308 rows, has RLS DISABLED (pg_class.relrowsecurity = false), and its new_values keys include date_of_birth, address, post_code, phone_number, mobile_number, email_address, sick_reason and timeclock_pin_hash. (b) restore_employee_version(uuid,int,uuid) is also SECURITY DEFINER with EXECUTE to PUBLIC, and its gate is `IF NOT user_has_permission(p_user_id, 'employees', 'manage')` where p_user_id is a CALLER-SUPPLIED parameter, not auth.uid() , trivially spoofable by passing any privileged user's uuid , after which it UPDATEs employees setting first_name, last_name, email_address, status, employment_end_date, keyholder_status and more. Both are reachable over the internet through PostgREST with only the public anon key. isLiveCode: the TS functions are dead, but the defect they leave behind is live and production-reachable via /rest/v1/rpc/. Raised medium -> high rather than critical only because exploitation needs a valid employee_id UUID (and, for restore, a privileged auth user UUID), which are not enumerable from the table grants I checked.

**Suggested fix.** Delete both functions (and consider dropping the orphaned RPCs), or export and wire them behind an explicit permission if version restore is still wanted.

### P010. Employee edit form silently drops every field outside the current step on mobile

`src/components/features/employees/EmployeeForm.tsx:247` | `form-data-loss` | CONFIRMED

**Problem.** Below 768px the form renders only `currentStepData.fields`; the other three steps' inputs are unmounted, so the submitted FormData contains only the last step's two fields plus the hidden employee_id, and `employeeSchema` rejects the save every time.

**What goes wrong.** A manager opens /employees/<id>/edit on a phone (window.innerWidth < 768), works through the four steps and taps Save on the final "Additional" step. Only `uniform_preference`, `keyholder_status` and `employee_id` are in the DOM, so `updateEmployee` validates `{uniform_preference, keyholder_status}` against a schema that requires `first_name`, `last_name`, `email_address`, `job_title`, `employment_start_date` and `status`. It returns "Invalid data provided. Please check your input and try again." The per-field error messages render against inputs on steps the user is no longer looking at, so the manager sees an unexplained failure and cannot edit an employee from a phone at all.

**Evidence.**

```
src/components/features/employees/EmployeeForm.tsx:66-75 sets `isMobile` from `window.innerWidth < 768`. Line 185 renders the complete form only on desktop: `{!isMobile && formSteps.map((step) => (`. Line 247 renders only the active step on mobile: `{isMobile && currentStepData.fields.map((field) => (`. The only input outside both branches is line 155: `<input type="hidden" name="employee_id" value={employee?.employee_id || ''} />`. Required fields live on steps 0 and 1 (lines 106-124) while the submit button only appears on the last step (lines 325-337). This is the live component: src/app/(authenticated)/employees/[employee_id]/edit/EmployeeEditClient.tsx:54 renders it and is itself rendered by edit/page.tsx:36.
```

**Verifier.** Reproduced the whole chain myself. Line 66-75 sets `isMobile` from `window.innerWidth < 768`. Line 185 gates the complete render on `!isMobile`; line 247 renders only `currentStepData.fields` when `isMobile`. The only input outside both branches is the hidden `employee_id` at line 155, and the submit button is reachable only on the last step (lines 325-337), whose fields are `uniform_preference` and `keyholder_status` (lines 140-145). I hunted for the guard that would save it and there is none: `cleanFormDataForEmployee` (src/app/actions/employeeActions.ts:227-229) is a pure `Object.fromEntries(formData.entries())` reduce that injects no defaults for absent keys, and `employeeSchema` (src/services/employees.ts:121-138) hard-requires first_name, last_name, email_address, job_title, employment_start_date and status. `updateEmployee` (employeeActions.ts:496-501) safeParses that object and returns 'Invalid data provided. Please check your input and try again.'. HTML5 `required` cannot intercept because those inputs are not in the DOM. Confirmed LIVE and confirmed it is not the dead-duplicate trap: EmployeeForm has exactly one importer, src/app/(authenticated)/employees/[employee_id]/edit/EmployeeEditClient.tsx:5, rendered at :54, and that client is imported at .../edit/page.tsx:3 and rendered at :36. Severity high stands: employee editing is impossible from any viewport under 768px, and this project's FOH/manager use is explicitly on tablets and phones.

**Suggested fix.** Keep every step mounted and hide inactive steps with CSS (or mirror the non-visible values into hidden inputs) so the whole record is always submitted.

### P011. Deleting an employee leaves their Supabase auth account and role grants intact

`src/services/employees.ts:496` | `stale-access` | CONFIRMED

**Problem.** EmployeeService.deleteEmployee removes the employees row and lets FK cascades clear the child tables, but never deletes the linked auth.users account or the user_roles rows for that auth_user_id, so a deleted employee keeps a working login and every permission they held.

**What goes wrong.** A manager deletes a leaver from /employees using the Delete button instead of Mark as Former. The employees row disappears, but auth.users still holds their account and user_roles still holds their grants, so they can log back into management.orangejelly.co.uk with their existing password and keep whatever access they had. Even with no role they remain an `authenticated` principal and, per the RLS finding above, can still read every colleague's bank, NI and health record via PostgREST.

**Evidence.**

```
src/services/employees.ts:496-533 ,  the whole method is a fetch, `await adminClient.from('employees').delete().eq('employee_id', employeeId)`, a birthday-calendar cleanup, and a return. There is no `auth.admin.deleteUser` and no `user_roles` delete.
The correct path exists elsewhere: src/lib/employees/separation.ts:133 `await adminClient.from('user_roles').delete().eq('user_id', employee.auth_user_id)` and line 177 `await adminClient.auth.admin.deleteUser(employee.auth_user_id)`.
Live DB confirms no compensating trigger: the only triggers on public.employees are `on_employees_updated` and `update_employees_updated_at`, both BEFORE UPDATE timestamp helpers.
```

**Verifier.** Verified. src/services/employees.ts:496 `static async deleteEmployee(employeeId: string)` is exactly as described: fetch, `adminClient.from('employees').delete().eq('employee_id', employeeId)`, birthday-calendar cleanup, return. I read the whole method , there is no `auth.admin.deleteUser` and no `user_roles` delete. I hunted for the compensating guard in four places and found none. (1) No DB trigger: live pg_trigger on public.employees returns only on_employees_updated and update_employees_updated_at, both BEFORE UPDATE timestamp helpers, so nothing fires on DELETE. (2) No cascade: user_roles.user_id references auth.users, not employees, so deleting the employees row cannot touch it. (3) No cleanup cron: `grep -rln 'auth.admin.deleteUser' src/` returns only src/lib/employees/separation.ts and src/app/actions/employeeInvite.ts. (4) The caller does not compensate: src/app/actions/employeeActions.ts:625-669 checks employees:delete and calls logAuditEvent, but does nothing about auth or roles. The correct path genuinely exists elsewhere, confirming intent: src/lib/employees/separation.ts:133 deletes user_roles and line 176 calls `adminClient.auth.admin.deleteUser`, then nulls auth_user_id. Live: src/app/(authenticated)/employees/[employee_id]/page.tsx:326 renders DeleteEmployeeButton (gated on permissions.canDelete), which wires to the deleteEmployee action. One partial mitigation I found that the finder missed, which limits blast radius but does not refute: several FKs to employees are ON DELETE RESTRICT/NO ACTION (checklist_spot_checks, checklist_task_instances x2, checklist_todos x2, recruitment_appointment_slots, recruitment_candidate_appointments, recruitment_candidates), so the delete will fail for any employee with checklist or recruitment history. It succeeds for everyone else. High is correct, and it is materially worse in combination with employees-16: the orphaned login remains an `authenticated` principal that can still read every colleague's bank, NI and health record.

**Suggested fix.** Have deleteEmployee reuse the same revoke sequence as finalizeEmployeeSeparation (delete user_roles, then auth.admin.deleteUser) before removing the employees row, or refuse to delete an employee whose auth_user_id is not null.

## Customers

### P012. Clearing a customer's email is silently discarded and still reports success

`src/app/(authenticated)/customers/[id]/page.tsx:664` | `update-drops-cleared-field` | CONFIRMED

**Problem.** The edit form only appends the email field to FormData when it is truthy, and updateCustomer strips undefined keys before the DB write, so blanking a customer's email leaves the old address in place while the UI shows 'Customer updated successfully'.

**What goes wrong.** A guest asks for their email address to be removed from their profile. Staff open the customer, clear the Email box and save. CustomerForm emits `email: null`; `if (data.email) formData.append('email', data.email)` skips it; in updateCustomer `(formData.get('email') as string | null)?.trim() || undefined` yields undefined; optionalEmailSchema has no transform so `validationResult.data.email` stays undefined; CustomerService.updateCustomer's `if (input.email !== undefined)` guard skips it and the trailing loop deletes the key. The UPDATE never touches email. A success toast fires, the old address remains on file and keeps receiving mail. (last_name is unaffected because optionalNameField transforms undefined to '', which does write through , the inconsistency makes the email case easy to miss.)

**Evidence.**

```
src/app/(authenticated)/customers/[id]/page.tsx:661-666
``​`
formData.append('first_name', data.first_name)
if (data.last_name) formData.append('last_name', data.last_name)
if (data.email) formData.append('email', data.email)
if (data.mobile_number) formData.append('mobile_number', data.mobile_number)
``​`
src/app/actions/customers.ts:311-317
``​`
email: (formData.get('email') as string | null)?.trim() || undefined,
``​`
src/lib/validation.ts:58-63 ,  `optionalEmailSchema = z.string().trim().email(...).max(255).optional()` (no transform, stays undefined)
src/services/customers.ts:272-283
``​`
if (input.email !== undefined) { payload.email = sanitizeEmail(input.email) }
...
Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key]);
``​`
The same omission exists in the list view ,  src/app/(authenticated)/customers/_components/CustomersClient.tsx:240.
```

**Verifier.** Reproduced the whole chain and found no mitigating guard. src/components/features/customers/CustomerForm.tsx:51 emits `email: trimmedEmail === '' ? null : ...`, so clearing the box yields null. Both live handlers then drop it: [id]/page.tsx:664 `if (data.email) formData.append('email', data.email)` and _components/CustomersClient.tsx:240 (identical line). In src/app/actions/customers.ts:315 (the finder cited the 311-317 block; the email line is 315) `email: (formData.get('email') as string | null)?.trim() || undefined` yields undefined. src/lib/validation.ts:58-63 confirms optionalEmailSchema is `.optional()` with NO `.transform`, unlike optionalNameField at :72-77 which transforms undefined to '' , so the finder's last_name contrast is accurate. src/services/customers.ts:272-274 guards `if (input.email !== undefined) { payload.email = sanitizeEmail(input.email) }` and :283 `Object.keys(payload).forEach(key => payload[key] === undefined && delete payload[key])` strips the key, so the UPDATE at :285-290 never touches email. Note sanitizeEmail(undefined) returns null (src/services/customers.ts:19), i.e. the guard is precisely what causes the drop , remove the guard and it would work. The action still returns {success:true} and the UI toasts 'Customer updated successfully' ([id]/page.tsx:675). I looked for and did not find any alternative in-app path to blank an email, any DB trigger on customers that would null it (only propagate_customer_name_trigger exists), or any test asserting current behaviour. LIVE: both files are the actual route page and the client that src/app/(authenticated)/customers/page.tsx:4 imports; there is no dead duplicate here (_components/ contains only CustomersClient.tsx). Severity high stands: silent no-op plus false success on a PII field with no in-app workaround.

**Suggested fix.** Always append the email key (empty string when cleared) and distinguish 'absent' from 'explicitly blank' in the action, mapping an empty submitted email to null so sanitizeEmail writes NULL.

### P013. GDPR erasure writes a phone value the CHECK constraint rejects, aborting mid-erasure

`src/services/gdpr.ts:486` | `gdpr-erasure-broken` | CONFIRMED

**Problem.** GdprService.deleteUserData sets customers.mobile_number to `erased-<uuid>`, which violates the live chk_customer_phone_format CHECK constraint, so the customer anonymisation throws after messages, emails and consent rows have already been destructively rewritten.

**What goes wrong.** A super admin uses /settings/gdpr to erase a customer who has a matching profile. updateRows() first overwrites every messages.body with '[erased under GDPR request]', nulls email_messages bodies and strips customer_consents evidence. Then the customers UPDATE hits `chk_customer_phone_format` (`CHECK ((mobile_number IS NULL) OR (mobile_number ~ '^\+[1-9]\d{7,14}$') OR (mobile_number ~ '^0[1-9]\d{9,10}$'))`), which rejects 'erased-3f2b1c4d' (verified in prod: both regexes return false). The service throws 'Failed to anonymize customer <id>', the action returns an error, and the operator is left with the message history destroyed but the customer's name, email and phone number still in the database. There is no transaction, so nothing rolls back and a retry cannot recover the deleted message bodies.

**Evidence.**

```
src/services/gdpr.ts:480-504
``​`
for (const customerId of customerIds) {
  const { error } = await (adminClient.from('customers') as any)
    .update({
      first_name: 'Erased',
      last_name: 'Customer',
      email: null,
      mobile_number: `erased-${customerId}`,
      mobile_e164: null,
      ...
  if (error) {
    throw new Error(`Failed to anonymize customer ${customerId}: ${error.message}`)
  }
``​`
Live constraint (queried): `chk_customer_phone_format CHECK (((mobile_number IS NULL) OR (mobile_number ~ '^\+[1-9]\d{7,14}$') OR (mobile_number ~ '^0[1-9]\d{9,10}$')))`. Verified in prod: `select ('erased-3f2b1c4d' ~ '^\+[1-9]\d{7,14}$')` = false, `~ '^0[1-9]\d{9,10}$'` = false.
Contrast src/services/customers.ts:64-71 which deliberately builds a constraint-safe `+447000########` placeholder for the same purpose.
```

**Verifier.** Code re-read and constraint re-verified live. src/services/gdpr.ts:486 writes `mobile_number: `erased-${customerId}`` and prod has `chk_customer_phone_format CHECK ((mobile_number IS NULL) OR (mobile_number ~ '^\+[1-9]\d{7,14}$') OR (mobile_number ~ '^0[1-9]\d{9,10}$'))`. I re-ran both regexes against an 'erased-<uuid>' literal in prod: both false, so the UPDATE is rejected. I looked specifically for a mitigating guard and found none: the only non-internal trigger on public.customers is `propagate_customer_name_trigger`, an AFTER UPDATE OF first_name,last_name trigger, so nothing normalises mobile_number before the CHECK runs. The ordering claim also holds: updateRows() rewrites messages.body (gdpr.ts:456), nulls email_messages bodies (463) and strips customer_consents evidence (471) before the customers loop at 480-504, and there is no transaction, so the throw at line 501 leaves the destructive part committed. Live: /settings/gdpr is linked from src/app/(authenticated)/settings/_components/SettingsClient.tsx:55 (which src/app/(authenticated)/settings/page.tsx does import, so not the dead-duplicate trap) and calls deleteUserData -> GdprService.deleteUserData. The finder's contrast is also correct: src/services/customers.ts:64 buildDeletedCustomerPhone() deliberately builds a constraint-safe '+447000########'. DOWNGRADED critical -> high on reachability: the loop only runs when customerIds is non-empty, and prod has ZERO profiles<->customers email matches (join on lower(email) = 0 across all 20 profiles), so today the path cannot fire. It is a latent data-destroying bug that arms itself the moment one staff profile email also exists as a customer email, which is entirely plausible.

**Suggested fix.** Use the existing buildDeletedCustomerPhone()-style constraint-safe placeholder (or NULL, which the constraint permits) instead of `erased-<uuid>`, and perform the customer update before the destructive message rewrites so a constraint failure cannot leave a half-erased record.

### P014. Anonymous role can read full customer rows via pending_bookings policy

`supabase/migrations/20251123120000_squashed.sql:10733` | `unauthenticated-pii-exposure` | CONFIRMED

**Problem.** An RLS policy plus an explicit GRANT lets the unauthenticated `anon` role SELECT complete `customers` rows (name, email, both phone columns, internal_notes, all consent flags) for any customer linked to a `pending_bookings` row, and separately lets `anon` read every `pending_bookings` row including its confirmation token and raw mobile number.

**What goes wrong.** Anyone who reads NEXT_PUBLIC_SUPABASE_ANON_KEY out of the published JS bundle (it is public by design) calls `POST /rest/v1/customers?select=*` with the anon key. Live check confirms `anon` holds SELECT on `customers` and 30 distinct customers currently satisfy the policy, so their full profiles, including 20 rows that carry staff-written `internal_notes`, are returned to an unauthenticated stranger. The same key returns every `pending_bookings` row, so the attacker also gets each booking's UUID token and mobile number and can confirm someone else's booking.

**Evidence.**

```
supabase/migrations/20251123120000_squashed.sql:10733
``​`sql
CREATE POLICY "anon_read_customers_for_bookings" ON customers
  FOR SELECT
  TO anon
  USING (
    EXISTS (
      SELECT 1 FROM pending_bookings
      WHERE pending_bookings.customer_id = customers.id
        AND pending_bookings.customer_id IS NOT NULL
    )
  );
``​`
Same file, line 10716:
``​`sql
CREATE POLICY "anon_read_pending_bookings" ON pending_bookings
  FOR SELECT
  TO anon
  USING (true); -- Allow all reads - security is through unique UUID token
``​`
and line 10747: `GRANT SELECT ON customers TO anon;`

Live production confirmation (read-only queries): pg_policies shows `anon_read_customers_for_bookings` active on `customers` for role `{anon}`; information_schema.role_table_grants shows `anon | SELECT` on `public.customers`; `select count(distinct customer_id) from pending_bookings where customer_id is not null` = 30; `select count(*) from customers where internal_notes is not null` = 20. `pending_bookings` columns include `token uuid` and `mobile_number`.
```

**Verifier.** Reproduced independently in migration and in production. supabase/migrations/20251123120000_squashed.sql:10733 creates anon_read_customers_for_bookings, :10716 creates anon_read_pending_bookings USING (true), :10747 grants SELECT on customers to anon. No later migration revokes either (grep for REVOKE on customers/pending_bookings across supabase/migrations returns nothing). Live pg_policies shows both policies present on the production project with roles {anon}; role_table_grants shows anon|SELECT on public.customers; pg_class shows relrowsecurity=true on both tables so the policies (not a disabled-RLS free-for-all) govern access. I then executed the exploit path directly as the anon role read-only: `set local role anon; select count(*), count(internal_notes), count(email) from customers` returns 30 rows, 4 with internal_notes, 1 with email, and all 30 carry first_name, mobile_number and sms_opt_in. Total customers is 1049, so the leak is 30 rows, not the whole base. The anon key is public by design (NEXT_PUBLIC_SUPABASE_ANON_KEY in the browser bundle), so this is unauthenticated read of real customer PII plus staff-written internal notes. Two corrections to the finder: (a) the '20 rows with internal_notes' figure is the whole-table count, only 4 of the exposed 30 have notes; (b) the 'confirm someone else's booking' scenario is not reachable - grep shows pending_bookings appears nowhere in src/ except the stale src/types/database.generated.ts, and the newest pending_bookings row is 2025-12-31, so the flow these policies were written for is dead and the exposed set is static, not growing. That bounded, static blast radius is why I grade this high rather than critical; the fix is to drop both anon policies and revoke the grant, which nothing in this repo depends on.

**Suggested fix.** Drop both anon policies and serve the booking-confirmation page through a server route that looks the token up with the service-role client and returns only the fields the page needs, then revoke `SELECT ON customers FROM anon`.

## Messages

### P015. Failed SMS are invisible in the conversation thread unless they are the last message of the day

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:650` | `missing-state` | CONFIRMED

**Problem.** The thread only renders a delivery status for an outbound message when it is the last in its date group or is immediately followed by an inbound message. Any failure followed by another outbound message the same day shows nothing at all.

**What goes wrong.** Staff send a booking confirmation that fails (Twilio 21612 / undelivered) and then send a follow-up to the same customer an hour later, which succeeds. In the thread the failed message renders with a timestamp and no status text, so it is indistinguishable from a delivered one and nobody chases the customer. Running the same window logic against production data: of 501 outbound customer_communications rows with status 'failed' or 'undelivered', 227 are followed by another outbound message on the same London date and so render with no status label whatsoever. Even when a status does show, "Not delivered" is plain text-text-muted, the same styling as the timestamp beside it, with no colour, icon or badge.

**Evidence.**

```
src/app/(authenticated)/messages/_components/MessagesClient.tsx:648-653
``​`
                        {dateMessages.map((message, index) => {
                          const isOutbound = message.direction !== 'inbound'
                          const showStatus =
                            isOutbound &&
                            (index === dateMessages.length - 1 ||
                              (index < dateMessages.length - 1 && dateMessages[index + 1].direction === 'inbound'))
``​`
and the rendering, lines 679-683:
``​`
                                  {showStatus && message.status && (
                                    <span className="text-[11px] text-text-muted">
                                      {getStatusText(message.status) || message.status}
                                    </span>
                                  )}
``​`
```

**Verifier.** Code confirmed verbatim at src/app/(authenticated)/messages/_components/MessagesClient.tsx:650-653 (showStatus is true only when the message is the last of its date group or the next message is inbound) and lines 679-683 (the status span is gated on showStatus). getStatusText at lines 78-91 maps failed/undelivered to the plain string 'Not delivered', rendered in `text-[11px] text-text-muted` , identical styling to the timestamp beside it at line 676, with no tone, icon or Badge, so even a shown failure is easy to miss. File is live: src/app/(authenticated)/messages/page.tsx imports MessagesClient from ./_components/MessagesClient and it is the only MessagesClient.tsx in the repo (no dead duplicate). I checked the ordering assumption rather than trusting it: messages come from getConversationMessages -> CommunicationsService.getCustomerTimeline (src/services/communications.ts:220-255), which selects customer_communications ordered by created_at ASCENDING, and grouping uses toLocalIsoDate (London), so the finder's index-based window logic matches the real render order. I then reproduced the production figures myself with a read-only LEAD() query over customer_communications bucketed by (created_at AT TIME ZONE 'Europe/London')::date: 501 outbound rows with status failed/undelivered, of which 227 are followed by another outbound message on the same London date and therefore render with no status label at all. No mitigating indicator exists elsewhere in the thread UI.

**Suggested fix.** Always render a status for failed/undelivered outbound messages regardless of position, and give the failure state a distinct tone (Badge tone="danger" plus an icon) rather than muted grey text.

### P016. Bulk recipient selection is wiped on every page change, capping any send at 50 of 353 eligible customers

`src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx:132` | `broken-core-flow` | CONFIRMED

**Problem.** loadRecipients unconditionally clears selectedKeys, and the DataTable select-all only covers the rows currently on screen. Paginating silently destroys the selection, so a bulk send can never target more than one 50-row page.

**What goes wrong.** 353 customers currently qualify for marketing SMS in production (get_bulk_sms_recipients with default filters returns total_count = 353). With RECIPIENT_PAGE_SIZE = 50 that is 8 pages. A manager ticks select-all on page 1 (50 rows), clicks page 2 to add more, and TablePagination calls loadRecipients(nextPage), which runs setSelectedKeys(new Set()) , the 50 selections vanish with no warning and the header badge silently drops to 0. There is no way to reach the >100 queue path (DIRECT_SEND_THRESHOLD) or the 500-recipient server limit (DEFAULT_BULK_SMS_MAX_RECIPIENTS in src/lib/sms/bulk-dispatch-key.ts:11) from this screen; a whole-list campaign requires 8 separate sends. The same wipe also destroys the deep-linked selection arriving via ?customerIds=.

**Evidence.**

```
src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx:128-137
``​`
  const loadRecipients = useCallback(async (requestedPage = 1) => {
    const currentRequest = ++requestCounterRef.current
    setLoading(true)
    setError(null)
    setSelectedKeys(new Set())
``​`
src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx:507-509
``​`
              onPageChange={(nextPage) => {
                void loadRecipients(nextPage)
              }}
``​`
Select-all is page-scoped, src/ds/composites/DataTable.tsx:148-151:
``​`
  const handleSelectAll = (checked: boolean) => {
    const newSelection = checked
      ? new Set(data.map((row) => getRowKey(row)))
``​`
```

**Verifier.** Reproduced the whole chain. BulkMessagesClient.tsx:128-132 , `loadRecipients` calls `setSelectedKeys(new Set())` unconditionally on every invocation; TablePagination at lines 501-511 calls `void loadRecipients(nextPage)` on page change. Select-all is page-scoped: src/ds/composites/DataTable.tsx:148-151 builds the new set from `data.map(getRowKey)`, which is only the 50 rows currently passed in, and the controlled-selection effect at DataTable.tsx:106-108 (`if (selectedKeys !== undefined) setInternalSelectedKeys(selectedKeys)`) pushes the parent's cleared set straight back into the table, so the wipe is total. RECIPIENT_PAGE_SIZE = 50 (line 34). Confirmed against production: 353 customers currently satisfy the RPC's eligibility predicate (mobile_e164 NOT NULL AND sms_opt_in AND marketing_sms_opt_in AND sms_status IS NULL OR 'active'), i.e. 8 pages. I searched for a mitigating 'select all matching filter' control and there is none. The >100 branch in sendBulkMessages (DIRECT_SEND_THRESHOLD, bulk-messages.ts:9/90) and the 500-recipient server cap are therefore unreachable from this screen. The ?customerIds= deep link is also capped: the effect at lines 171-192 intersects initialCustomerIdSet with `recipients`, which only ever holds the current 50-row page, and initialSelectionAppliedRef prevents re-application after a page change.

**Suggested fix.** Keep selectedKeys across page loads (only reset it when the filters change, not when the page changes), and add a "select all N matching" control that resolves ids server-side from the current filter.

### P017. Bulk send always reports every recipient as sent, hiding real failures

`src/app/actions/bulk-messages.ts:100` | `silent-failure` | CONFIRMED

**Problem.** sendBulkMessages throws away the sent/failed/errors counts returned by sendBulkSMSDirect and hard-codes sent: customerIds.length, so the UI reports full success even when messages failed. It also swallows the deliberate "do not retry, contact engineering" fail-safe message.

**What goes wrong.** A manager selects 50 recipients and sends. Inside sendBulkSms, 12 sends fail (Twilio 21612/21211, which account for 230 rows in production `messages` today) and are pushed to `errors`. sendBulkSMSDirect returns { success: true, sent: 38, failed: 12, errors: [...] }. sendBulkMessages sees no `error` key and returns { success: true, sent: 50 }. BulkMessagesClient toasts "50 messages sent successfully". Worse: when sendBulkSMSImmediate hits the logging_failed branch it returns { success: true, message: 'Bulk SMS aborted because outbound message logging failed after sends may have occurred. Do not retry; please refresh and contact engineering.' } with no `error` key, so that whole warning is discarded and the operator is told 50 messages sent successfully after a partial, unlogged send.

**Evidence.**

```
src/app/actions/bulk-messages.ts:90-102
``​`
  if (customerIds.length <= DIRECT_SEND_THRESHOLD) {
    const result = await sendBulkSMSDirect(customerIds, message, eventId, categoryId)
    if ('error' in result) {
      return { success: false, error: result.error }
    }
    return {
      success: true,
      sent: customerIds.length,
      queued: false,
    }
``​`
What is being discarded, src/app/actions/sms-bulk-direct.ts:155-163:
``​`
    if (result.errors && result.errors.length > 0) {
      return { success: true, sent: result.sent, failed: result.failed, results: result.results, errors: result.errors }
    }
``​`
and src/app/actions/sms-bulk-direct.ts:143-150:
``​`
        return {
          success: true,
          message:
            'Bulk SMS aborted because outbound message logging failed after sends may have occurred. Do not retry; please refresh and contact engineering.',
          code: abortCode,
          logFailure: true,
        }
``​`
Consumer, src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx:238-242:
``​`
    if (result.queued) {
      toast.info(`${result.sent} messages queued for delivery`)
    } else {
      toast.success(`${result.sent} messages sent successfully`)
    }
``​`
```

**Verifier.** Verified in full. src/app/actions/bulk-messages.ts:98-102 returns `sent: customerIds.length` and never reads result.sent/result.failed/result.errors. The two discarded shapes are real: src/app/actions/sms-bulk-direct.ts:155-163 returns `{ success: true, sent, failed, results, errors }` on partial failure, and lines 144-150 return `{ success: true, message: 'Bulk SMS aborted because outbound message logging failed... Do not retry...', code, logFailure }` with NO `error` key, so the `'error' in result` narrowing at line 94 lets both through as full success. Additionally src/lib/sms/bulk.ts:250-284 filters out customers lacking mobile/sms_opt_in/marketing_sms_opt_in/active sms_status BEFORE sending; those are counted in neither `sent` nor `errors`, so the over-report is worse than the finder stated. I looked for a mitigating guard and found none: the sole caller is BulkMessagesClient.tsx:224 which toasts `${result.sent} messages sent successfully` at line 241, and the existing suite src/app/actions/__tests__/bulk-messages.test.ts:214-280 only ever mocks a bare `{ success: true }` , no test covers the partial-failure or logging_failed shapes, so nothing pins current behaviour as intended. Severity high stands: the fail-safe branch deliberately written to warn an operator not to retry after a possibly-unlogged send is thrown away and replaced with a success toast.

**Suggested fix.** Widen SendBulkResult to carry sent/failed/errors/message/logFailure through from sendBulkSMSDirect, return the real counts, and have the client render a failure summary (and the logFailure warning as a persistent error, not a success toast).

### P018. Fix GDPR erasure , it reads profiles.system_role, a column that does not exist in production

`src/app/actions/gdpr.ts:90` | `broken-privacy-control` | CONFIRMED

**Problem.** deleteUserData (and cross-user exportUserData) authorise on profiles.system_role, but that column does not exist in the production database. The Supabase query returns an error with data null, so profile?.system_role is always undefined and both actions always return 'Insufficient permissions'. The right-to-erasure path that is supposed to scrub message bodies, attachments, unmatched communications and webhook logs can never run for anyone, including the super admin.

**What goes wrong.** A customer emails asking to be forgotten. A super_admin opens /settings/gdpr, types the email and confirms. The action selects system_role from profiles, PostgREST replies 400 'column profiles.system_role does not exist', supabase-js returns {data:null}, and the guard at line 94 fires. The staff member sees 'Insufficient permissions', assumes an RBAC problem rather than a broken query, and the erasure is silently never performed while the customer has been told it would be.

**Evidence.**

```
src/app/actions/gdpr.ts:88-96:

    const { data: profile } = await adminClient
      .from('profiles')
      .select('system_role')
      .eq('id', user.id)
      .single()

    if (profile?.system_role !== 'super_admin') {
      return { error: 'Insufficient permissions' }
    }

The error from the query is discarded (only `data` is destructured). Live schema check:
  SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles';
  -> id, full_name, updated_at, email, created_at, sms_notifications, email_notifications, avatar_url, first_name, last_name
And a direct query errors: ERROR: 42703: column "system_role" does not exist.

The same dead check guards cross-user export at src/app/actions/gdpr.ts:27-33. Roles actually live in user_roles/roles (public.user_has_permission works and returns super_admin for peter@orangejelly.co.uk).
```

**Verifier.** Cited line is exact: src/app/actions/gdpr.ts:90 is `.select('system_role')` and the guard is at :94 `if (profile?.system_role !== 'super_admin') { return { error: 'Insufficient permissions' } }`. Live schema settles it: SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='profiles' returns exactly id, full_name, updated_at, email, created_at, sms_notifications, email_notifications, avatar_url, first_name, last_name. No system_role. (I did not rely on database.generated.ts, which is stale.) PostgREST answers a select on a non-existent column with a 400, and supabase-js returns {data:null,error}; the code destructures only `data`, so profile is null, profile?.system_role is undefined, and the guard always fires. The erasure can never execute. I hunted for the thing that would refute this: there is no other definition of system_role anywhere in src (grep -rn 'system_role' src returns only these two call sites plus an unrelated types/database.ts:797 `is_system_role` on the roles table), no view named profiles shadowing the table, and no wrapper that pre-fills it. Live code confirmed: src/app/(authenticated)/settings/gdpr/page.tsx:8 imports { exportUserData, deleteUserData } and :62 calls deleteUserData(deleteEmail) from a rendered client page. One correction to the finder: the second call site at lines 23-34 (cross-user export) is effectively dead - it only runs `if (userId && userId !== user?.id)`, and the only caller, page.tsx:26, invokes exportUserData() with no argument, so that branch is never reached. The deleteUserData breakage is the live half. Severity: keeping high. It fails closed so there is no data exposure, but a legally mandated right-to-erasure control is permanently non-functional and reports a misleading 'Insufficient permissions' that will send whoever hits it chasing an RBAC problem that does not exist.

**Suggested fix.** Replace the profiles.system_role lookup in both functions with the existing RBAC check (checkUserPermission on a suitable module/action, or a user_roles lookup for the super_admin role), and stop discarding the Supabase error so a failed authorisation query is distinguishable from a denial.

### P019. The whole message-templates settings screen edits rows nothing ever reads

`src/app/actions/messageTemplates.ts:41` | `dead-feature` | CONFIRMED

**Problem.** /settings/message-templates is a full create/edit/delete/activate CRUD over the message_templates table, linked from the Messages page as "Templates", but no sending code path anywhere reads that table or the get_message_template RPC. Every SMS body is hard-coded in TypeScript.

**What goes wrong.** A manager opens Messages, clicks "Templates", edits the body of "Private Booking - Confirmed" (a real active row, id 076daaba-ac40-49b2-b05f-f43a75d20e6b), saves, and sees a success toast. The next private booking confirmation still sends the old wording, because src/services/private-bookings/mutations.ts builds the body from the hard-coded privateBookingCreatedMessage() helper and only records 'private_booking_created' as metadata. Toggling a template inactive likewise stops nothing. Production has 15 rows in message_templates including 8 marked is_active = true.

**Evidence.**

```
Every read of the table lives inside the settings CRUD itself ,  an exhaustive grep for `from('message_templates'` and `rpc('get_message_template'` returns only src/app/actions/messageTemplates.ts lines 50, 90, 144, 154, 200, 210, 250. The send path instead hard-codes bodies, src/services/private-bookings/mutations.ts:95-107:
``​`
  const smsMessage = privateBookingCreatedMessage({
    customerFirstName: booking.customer_first_name,
    ...
  });
  try {
    const result = await SmsQueueService.queueAndSend({
      booking_id: booking.id,
      trigger_type: 'booking_created',
      template_key: 'private_booking_created',
      message_body: smsMessage,
``​`
`event_message_templates` (read by src/app/api/events/[id]/route.ts:117) is a separate table with its own `content` column; the only FK onto message_templates is from message_template_history.
```

**Verifier.** I tried hard to refute this and could not. Repo-wide grep (whole repo, node_modules excluded) for `message_templates` returns only: src/app/actions/messageTemplates.ts (lines 50, 90, 144, 154, 200, 210, 250 , the settings CRUD itself), src/types/database.ts + the stale database.generated.ts, three diagnostic scripts under scripts/ (check-production-templates.ts, test-template-loading.ts, test-production-templates.ts), and two test files. No sending path reads it. I then checked the database rather than guessing: exactly two live Postgres functions reference the table , get_message_template(uuid,text) and get_bookings_needing_reminders() , and BOTH are dead. Neither name appears anywhere in src/ or scripts/; a search of pg_proc.prosrc for callers of either returns zero rows; and cron.job contains only one entry, `auto-close-past-event-tasks`, so nothing schedules them either. The send path really does hard-code bodies: src/services/private-bookings/mutations.ts:95-107 builds `smsMessage` from privateBookingCreatedMessage() and passes template_key only as metadata. The screen is live and linked: src/app/(authenticated)/settings/message-templates/page.tsx imports listMessageTemplates, and MessagesClient.tsx:483 routes to it behind canManageTemplates. Two factual corrections to the finder: production has 15 rows with 11 active (not 8), and event_message_templates is indeed a separate table read by src/app/api/events/[id]/route.ts. Severity stays high , the screen is permission-gated and audit-logged, so an edit looks completely successful while changing nothing, and this project's own domain rules make stale customer-facing SMS wording a first-class bug.

**Suggested fix.** Either wire the sending helpers to read message_templates by template_type (falling back to the hard-coded body), or remove the screen and the nav link so staff cannot believe they are editing live copy.

### P020. Repeat manual SMS reply is silently suppressed but the inbox says "Message sent"

`src/services/messages.ts:130` | `silent-duplicate-suppression` | CONFIRMED

**Problem.** The thread reply dedupe key is derived from a hash of the message body, so sending the same text to the same customer twice inside the 14-day idempotency TTL returns success with `suppressed: true` and no SMS is sent, yet the UI reports success and nothing appears in the thread.

**What goes wrong.** Staff reply "Thanks!" to a customer in /messages on Monday. Two days later they reply "Thanks!" to the same customer again. buildSmsDedupContext produces the identical key (template_key `message_thread_reply` + customerId + stage hash of the body) and identical requestHash, claimSmsIdempotency returns 'duplicate', sendSMS returns `{ success: true, sid: null, status: 'suppressed_duplicate' }`. MessageService.sendReply sees `result.success === true` and returns `{ success: true }`; MessagesClient toasts "Message sent". The customer never receives the second message and no row is written to `messages`, so the thread shows nothing was sent either.

**Evidence.**

```
src/services/messages.ts:130 `const messageStage = createHash('sha256').update(messageWithSupport).digest('hex').slice(0, 16);` then 133-142 passes `metadata: { template_key: 'message_thread_reply', trigger_type: 'message_thread_reply', stage: messageStage, ... }`. src/lib/sms/safety.ts:136-149 builds the key from `{template_key, identity, context}` where context contains trigger_type + stage; TTL default `24 * 14` hours (safety.ts:82). src/lib/twilio.ts:396-412 `if (claimResult === 'duplicate') { ... return { success: true, sid: null, status: 'suppressed_duplicate', suppressed: true, suppressionReason: 'duplicate' } }`. src/services/messages.ts:147 `if (!result.success) {` is therefore false, so 156-162 returns `{ success: true, messageSid: result.sid }` (sid is null). src/app/(authenticated)/messages/_components/MessagesClient.tsx:370-373 `if ('error' in result && result.error) { toast.error(...) } else { toast.success('Message sent') }`.
```

**Verifier.** Reproduced the whole chain myself. src/services/messages.ts:129-130 sets `const messageWithSupport = ensureReplyInstruction(message, supportPhone)` then `const messageStage = createHash('sha256').update(messageWithSupport).digest('hex').slice(0, 16)`, and 133-142 passes it as metadata.stage with template_key/trigger_type 'message_thread_reply'. ensureReplyInstruction (src/lib/sms/support.ts:1-3) is now a bare `return message.trim()`, so the body is fully deterministic from the typed text - no phone suffix, no timestamp, no randomness. src/lib/sms/safety.ts:43-55 includes 'trigger_type' and 'stage' in DEDUPE_CONTEXT_KEYS, and buildSmsDedupContext (safety.ts:120-158) hashes {template_key, identity(customerId), context} into the key and {...scope, body} into request_hash, so an identical reply to the same customer yields an identical key AND request_hash. claimSmsIdempotency (safety.ts:192-293) hits 23505, finds the unexpired row, and `if (existing.request_hash === context.requestHash) return 'duplicate'` (safety.ts:288-290). TTL default is `24 * 14` hours (safety.ts:81). src/lib/twilio.ts:394-411 then returns `{ success: true, sid: null, status: 'suppressed_duplicate', suppressed: true }` BEFORE any Twilio call or messages-row insert. messages.ts:147 `if (!result.success)` is false so 156-162 returns `{ success: true }`; sendReply never inspects result.suppressed. I looked hard for a guard and found none: sendSmsReply (src/app/actions/messageActions.ts:70-91) passes the object straight through, and MessagesClient.tsx:369-372 does `if ('error' in result && result.error) {...} else { toast.success('Message sent') }`. Liveness: src/app/(authenticated)/messages/page.tsx imports ./_components/MessagesClient - this is the rendered client, not a dead duplicate. Only mitigation worth noting: because no messages row is written, the thread reload afterwards shows nothing new, so staff get a weak visual cue that contradicts the toast.

**Suggested fix.** Surface `suppressed`/`suppressionReason` from MessageService.sendReply and have the composer show a distinct "duplicate suppressed, not sent" state; or exclude interactive thread replies from body-hash dedupe and scope the key to a short window (for example a per-send nonce) so genuine repeat replies are allowed.

### P021. Tighten messages RLS , every logged-in staff account can read all 7,996 messages

`supabase/migrations/20251123120000_squashed.sql:4708` | `privilege-escalation` | CONFIRMED

**Problem.** The RLS SELECT policy on public.messages grants read to any role 'authenticated' session with no reference to the RBAC tables, so any staff login can pull every customer's SMS body and phone number straight from PostgREST, bypassing the messages:view permission the app enforces at src/app/(authenticated)/messages/page.tsx:6.

**What goes wrong.** A foh_staff or portal_shift_manager user (neither has messages:view) opens devtools, copies their sb-…-auth-token access token, and calls GET /rest/v1/messages?select=* with apikey=<anon key> and Authorization: Bearer <their JWT>. They receive all 7,996 rows: every inbound and outbound SMS body plus from_number/to_number for every customer. The same holds for webhook_logs, which stores the raw inbound webhook body and message_body written at src/app/api/webhooks/twilio/route.ts:140.

**Evidence.**

```
Policy as shipped:

  CREATE POLICY "Allow authenticated users to read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true);

Live production policy (equally permissive):
  messages | Allow authenticated users to read messages | {authenticated} | SELECT | qual: (auth.uid() IS NOT NULL)
  webhook_logs | Allow authenticated users to read webhook_logs | {authenticated} | SELECT | qual: (auth.uid() IS NOT NULL)

Proved live with a synthetic non-existent user id:
  SET LOCAL ROLE authenticated;
  SET LOCAL request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000123","role":"authenticated"}';
  SELECT count(*) FROM public.messages;  -> 7996

RBAC reality for the same data: of 20 rows in profiles, only 4 return true for user_has_permission(id,'messages','view'); the other 16 (foh_staff, portal_shift_manager, and roleless accounts) are denied in the UI but see everything at the database. The matching INSERT policy at line 4696 (WITH CHECK true) also lets any authenticated user forge message rows.
```

**Verifier.** Cited line is exact. supabase/migrations/20251123120000_squashed.sql:4708 reads CREATE POLICY "Allow authenticated users to read messages" ON "public"."messages" FOR SELECT TO "authenticated" USING (true); and line 4696 reads CREATE POLICY "Allow authenticated users to insert messages" ON "public"."messages" FOR INSERT TO "authenticated" WITH CHECK (true);. Live production matches: pg_policy shows messages SELECT qual (auth.uid() IS NOT NULL), INSERT withcheck (auth.uid() IS NOT NULL), and the same pair on webhook_logs. I checked specifically for the things that would refute this and none exist: (a) both policies are polpermissive=true, so there is no RESTRICTIVE policy narrowing them, and messages has exactly two policies total; (b) relrowsecurity=true but there is no RBAC predicate anywhere in either qual; (c) table grants do not save it either, information_schema.role_table_grants shows authenticated holds SELECT,INSERT,UPDATE,DELETE on both public.messages and public.webhook_logs, so PostgREST will serve the request. The app-layer guard the finder points at is real but is only app-layer: src/app/(authenticated)/messages/page.tsx enforces messages:view, and middleware does not gate /rest/v1 on Supabase's own domain at all. Live RBAC gap quantified against production: 20 rows in profiles, 24 rows in auth.users, 6 rows in user_roles, and only 4 profiles return true for public.user_has_permission(id,'messages','view') - so at least 16 authenticated accounts are denied in the UI but can read all 7,996 message rows (bodies plus from_number/to_number) with their own JWT and the public anon key. Severity: keeping the finder's 'high' rather than raising to critical, because it requires a valid staff login and every account belongs to a trusted employee, but it is a genuine RLS-versus-RBAC divergence on customer PII plus a forgeable INSERT path.

**Suggested fix.** Replace the USING (true) / auth.uid() IS NOT NULL predicates on messages, webhook_logs and message_delivery_status with public.user_has_permission(auth.uid(),'messages','view'), and restrict INSERT/UPDATE to service_role since all writes already go through the admin client.

### P022. Revoke public EXECUTE on create_short_link , open redirect on l.the-anchor.pub

`supabase/migrations/20260708000003_short_link_legacy_domain_tracking.sql:141` | `unauthenticated-mutation` | CONFIRMED

**Problem.** create_short_link is SECURITY DEFINER with EXECUTE left on PUBLIC (so anon can call it) and applies no destination allowlist, and the redirect handler forwards the browser to whatever destination_url the row holds. Anyone with the public anon key can mint links on the venue's own SMS domains that point anywhere.

**What goes wrong.** An attacker POSTs to /rest/v1/rpc/create_short_link with {p_destination_url:'https://the-anchor-payments.example/phish', p_link_type:'custom', p_custom_code:'pay'} using the public anon key. The RPC returns https://l.the-anchor.pub/pay. Because the pub's real payment and booking SMS use that same domain, the attacker sends a phishing text that is indistinguishable from a genuine one; /api/redirect/[code] resolves the row and calls NextResponse.redirect straight to the attacker's URL.

**Evidence.**

```
Function is created without any REVOKE (`$$ language plpgsql security definer set search_path = public;` at line 119 of the same file). Live production ACL:
  create_short_link | proacl = {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres} | anon_exec = true
(the leading `=X/postgres` is the PUBLIC grant).

Body has no URL validation and inserts created_by = auth.uid(), which is simply NULL for anon; the RLS policy "Users can delete own short links" then uses `((created_by = auth.uid()) OR (created_by IS NULL))`, so such rows are also freely mutable.

Redirect follows the stored value with no allowlist:
  src/app/api/redirect/[code]/route.ts:392  let redirectDestinationUrl = resolvedLink.destination_url
  src/app/api/redirect/[code]/route.ts:447  const response = NextResponse.redirect(finalRedirectDestinationUrl)

The host check src/lib/short-links/routing.ts:isShortLinkHost accepts the-anchor.pub, *.the-anchor.pub, vip-club.uk and *.vip-club.uk.
```

**Verifier.** Confirmed, with one location correction: the CREATE OR REPLACE FUNCTION public.create_short_link block in that migration begins at line 141 and ends at line 119-equivalent of its own body; the finder's line 43 points at short_link_aliases, not the function. Everything substantive checks out. (1) Live ACL: proacl = {=X/postgres,postgres=X/postgres,authenticated=X/postgres,service_role=X/postgres}; the leading =X/postgres is the PUBLIC grant, and has_function_privilege('anon',oid,'EXECUTE')=true. The migration ends the function with `$$ language plpgsql security definer set search_path = public;` and issues no REVOKE, so nothing ever removed it. (2) Live pg_get_functiondef confirms SECURITY DEFINER and shows the only input handling is v_destination_url text := btrim(p_destination_url) - no scheme check, no host allowlist, no length limit. It inserts created_by = auth.uid(), which is NULL for anon; short_links_created_by_fkey is FOREIGN KEY (created_by) REFERENCES auth.users(id), and a NULL FK value always passes, so the insert succeeds. (3) The custom-code path is usable: short_links_link_type_check permits 'custom', and the collision guard only raises when the code already exists, so an attacker simply picks a free one. (4) The redirect is unguarded: src/app/api/redirect/[code]/route.ts:392 `let redirectDestinationUrl = resolvedLink.destination_url` and :447 `const response = NextResponse.redirect(finalRedirectDestinationUrl)`. The only interception between them is the table-payment branch, which fires solely when parseTablePaymentLinkFromUrl matches; any other URL passes through untouched. There is no allowlist anywhere on that path. (5) Reachability: src/middleware.ts:12 lists '/api' in PUBLIC_PATH_PREFIXES, so /api/redirect/[code] is served without auth, and src/lib/short-links/routing.ts:59-65 isShortLinkHost accepts the-anchor.pub, *.the-anchor.pub, vip-club.uk and *.vip-club.uk - so l.the-anchor.pub routes here. The function itself returns 'https://l.the-anchor.pub/' || code. Severity high is right: it is a phishing-grade open redirect on the exact domain the venue's payment and booking SMS use, mintable by anyone holding the public anon key, but it does not by itself read or write customer data.

**Suggested fix.** REVOKE EXECUTE ON FUNCTION public.create_short_link(...) FROM PUBLIC, anon, authenticated (the app already calls it through ShortLinkService with the service-role client), and add a destination host allowlist inside ShortLinkService.createShortLinkInternal.

## Parking

### P023. "Send payment link now" switch cannot be turned off: the schema defaults a missing field to true

`src/app/actions/parking.ts:59` | `form-boolean-default` | CONFIRMED

**Problem.** The send_payment_link transform returns true when the field is absent, but the client only appends the field when the switch is ON. Turning the switch off therefore omits the field and the server treats it as ON, so the payment-request SMS is sent regardless.

**What goes wrong.** Staff create a parking booking for a customer who has already paid at the bar, or who asked not to be texted, and switch off "Send payment link now". The field is never appended to the FormData, the transform sees undefined and returns true, so createParkingBooking creates a PayPal order and sends the payment-request SMS anyway. The customer receives an unwanted payment demand and the venue pays for the message.

**Evidence.**

```
parking.ts:55-61 `send_payment_link: z.union([z.string(), z.boolean()]).optional().transform((value) => { if (value == null) return true; return value === true || value === 'true' || value === 'on' })`; parking.ts:173 `if (data.send_payment_link) { ... sendParkingPaymentRequest(...) }`. ParkingClient.tsx:341 `if (createForm.send_payment_link) formData.append('send_payment_link', 'true')` and ParkingClient.tsx:913 `<Switch label="Send payment link now" checked={createForm.send_payment_link} ... />`.
```

**Verifier.** Reproduced. parking.ts:55-61 `send_payment_link: z.union([z.string(), z.boolean()]).optional().transform((value) => { if (value == null) return true; ... })`. createParkingBooking parses `Object.fromEntries(formData.entries())` (parking.ts:122-123), so an absent key gives undefined, the transform returns true, and parking.ts:173 `if (data.send_payment_link)` fires. The client is the asymmetric half: ParkingClient.tsx:341 `if (createForm.send_payment_link) formData.append('send_payment_link', 'true')` , the field is only ever appended when ON, never as 'false'. The switch at ParkingClient.tsx:913 is therefore inert in the off direction. I confirmed this is the live client: src/app/(authenticated)/parking/page.tsx imports `./_components/ParkingClient` and `find src -name ParkingClient*` returns exactly one file, so no dead-duplicate escape hatch. Consequence chain verified: parking.ts:176-182 creates a real PayPal order then calls sendParkingPaymentRequest, whose only guard (src/lib/parking/payments.ts:143-162) is customer SMS opt-out, unrelated to this toggle. Note the same file avoids the trap correctly two fields up (capacity_override, parking.ts:50-53, has no `return true` default), which shows the send_payment_link default is the anomaly rather than deliberate. High is right: silently sending an unwanted payment demand plus an unnecessary PayPal order.

**Suggested fix.** Always append the field from the client (append 'true'/'false'), and parse it with the existing src/lib/forms/formBoolean.ts helper so an absent or 'false' value means off.

### P024. Editing a pending booking wipes the payment metadata, permanently breaking the guest pay link

`src/app/actions/parking.ts:515` | `data-clobber` | CONFIRMED

**Problem.** updateParkingBookingDetails replaces parking_booking_payments.metadata wholesale instead of merging, destroying approve_url. createParkingPaymentOrder short-circuits on any existing pending payment row and returns metadata.approve_url || '', so after one edit neither the guest retry button nor the staff "Payment Link" button can ever produce a link for that booking again.

**What goes wrong.** Staff edit a pending-payment booking (e.g. correct the registration). The pending payment row's metadata becomes {parking_booking_edited, edited_at, edited_by} and approve_url is gone. The guest presses "Pay now": the retry route calls createParkingPaymentOrder, which finds the pending row, returns approveUrl='' and redirects to ?payment=retry_failed. Staff press "Payment Link": generateParkingPaymentLink gets the same empty string and returns "PayPal did not return an approval link". The cron's lookupPendingPaymentLink also returns null, so every subsequent reminder says "We'll text your payment link shortly" and never does. The booking can never be paid and eventually expires.

**Evidence.**

```
src/app/actions/parking.ts:511-521 `.from('parking_booking_payments').update({ amount: nextAmount, metadata: { parking_booking_edited: true, edited_at: ..., edited_by: user.id } })` ,  note every other metadata write in this codebase merges, e.g. :820 `metadata: { ...(paymentRecord.metadata || {}), manual_settlement: true }`.
src/lib/parking/payments.ts:81-91 `const existingPending = await getPendingParkingPayment(booking.id, supabase); if (existingPending) { return { payment: existingPending, orderId: existingPending.paypal_order_id || '', approveUrl: (existingPending.metadata as any)?.approve_url || '' } }`.
src/app/actions/parking.ts:751 `if (!approveUrl) { return { error: 'PayPal did not return an approval link' } }`.
```

**Verifier.** Reproduced. src/app/actions/parking.ts:511-522 does `.from('parking_booking_payments').update({ amount: nextAmount, metadata: { parking_booking_edited: true, edited_at, edited_by } }).eq('booking_id', bookingId).eq('status','pending')` , a whole-column jsonb replace, not a merge, so approve_url is destroyed. The contrast the finder drew is accurate: markParkingBookingPaid at :820 and the cancellation path at :634 both spread `...(record.metadata || {})` first. The consequences check out: src/lib/parking/payments.ts:81-91 short-circuits on any existing pending row and returns `approveUrl: (existingPending.metadata as any)?.approve_url || ''`; getPendingParkingPayment (src/lib/parking/repository.ts:114-135) filters only on status='pending' with no expiry test, so the dead row is reused forever. generateParkingPaymentLink then hits :751 `if (!approveUrl) return { error: 'PayPal did not return an approval link' }` , and note :716-740 extends payment_due_at but still cannot force a new order. The guest retry route (src/app/api/parking/payment/retry/route.ts:56-64) calls the same function and redirects to 'retry_failed'. The cron's lookupPendingPaymentLink (route.ts:959-971) reads the same metadata and returns null, so reminders fall back to "We'll text your payment link shortly" (notifications.ts:32). No recovery path exists in the UI. There is an additional consequence the finder missed that reinforces this: the update changes parking_booking_payments.amount but not the PayPal order, so even a surviving link would fail captureParkingPayment's amount check (payments.ts:376-382). Latent, not yet triggered: in production no parking_booking_payments row has the 'parking_booking_edited' key. Severity high stands , editing a pending booking is an ordinary staff action and the break is silent and unrecoverable in-app.

**Suggested fix.** Spread the existing metadata when updating, and when the amount changes, void/supersede the pending payment row so createParkingPaymentOrder creates a fresh PayPal order at the new amount rather than reusing a stale one.

### P025. Cancelling a paid parking booking marks it refunded without refunding any money, and locks staff out of the real refund

`src/app/actions/parking.ts:605` | `fake-state-transition` | CONFIRMED

**Problem.** updateParkingBookingStatus rewrites a paid booking's payment_status to 'refunded' and flips the parking_booking_payments row to status 'refunded' with refunded_at set, but never calls PayPal or creates a payment_refunds row. Because every refund entry point filters on status='paid', the genuine refund path then becomes unreachable.

**What goes wrong.** Staff open a confirmed, paid booking and press Cancel (the only cancel control the UI offers). The action sets parking_bookings.payment_status='refunded' and parking_booking_payments.status='refunded', refunded_at=now. No money leaves the PayPal account. The customer is now out of pocket while both the staff UI and the guest page show "refunded". Staff then cannot fix it: the Refund button is gated on `payment_status === 'paid'`, and getParkingPaymentForRefund queries `.eq('status','paid')`, so it returns "No paid payment record found for this booking." The refund history table stays empty because no payment_refunds row was ever created.

**Evidence.**

```
src/app/actions/parking.ts:605-609 `if (currentPaymentStatus === 'paid') { nextPaymentStatus = 'refunded' } else if (currentPaymentStatus === 'pending') { nextPaymentStatus = 'failed' }` and :645-647 `if (nextPaymentStatus === 'refunded' && latestPayment.status === 'paid') { Object.assign(paymentUpdates, { status: 'refunded', refunded_at: nowIso }) }` ,  no refundPayPalPayment / processPayPalRefund call anywhere in this function.
src/app/actions/refundActions.ts:725 `.eq('status', 'paid')` in getParkingPaymentForRefund.
src/app/(authenticated)/parking/_components/ParkingClient.tsx:714 `{permissions.canRefund && selectedBooking.payment_status === 'paid' && (` ,  the Refund button, and :704 the Cancel button which has no such guard.
```

**Verifier.** Reproduced. src/app/actions/parking.ts:605-609 sets nextPaymentStatus='refunded' when a cancelled booking was 'paid', and :645-647 writes `{ status: 'refunded', refunded_at: nowIso }` onto the payment row. I read the whole of updateParkingBookingStatus (572-693) and there is no refundPayPalPayment / processRefund call, no payment_refunds insert, and no queued job. I checked for compensating mechanisms and found none: information_schema.triggers on parking_bookings and parking_booking_payments shows only sync_parking_customer_name, enforce_parking_capacity, generate_parking_reference and set_*_timestamps , nothing that refunds. The lockout is real and worse than described: the genuine refund path writes parking_booking_payments.refund_status (refundActions.ts:256), NOT status, so status='refunded' is a state the real path never produces, and getParkingPaymentForRefund (refundActions.ts:711-737) filters `.eq('status','paid')`, returning 'No paid payment record found for this booking.'. The UI Refund button (ParkingClient.tsx:714) and the Refund History card (:724) are both gated on payment_status==='paid', which the cancel has just overwritten. I confirmed the file is live: src/app/(authenticated)/parking/page.tsx imports ./_components/ParkingClient and there is no duplicate client; Cancel (:704-708) is shown for any non-cancelled/non-completed booking with canManage and calls handleStatusUpdate(id,'cancelled') (:396-401, :466-478). Downgraded critical to high: production has 9 parking bookings, 5 paid, 0 with payment_status='refunded' and 0 rows in payment_refunds where source_type='parking', so this has never fired, and a manager can still refund inside PayPal itself.

**Suggested fix.** Do not derive 'refunded' from a cancellation. Either leave payment_status as 'paid' and require an explicit refund through processPayPalRefund, or block cancellation of a paid booking until a refund has been recorded in payment_refunds.

### P026. Parking 3-day session reminder SMS greets customers as "undefined" and quotes registration "undefined"

`src/app/api/cron/parking-notifications/route.ts:676` | `missing-column-in-select` | CONFIRMED

**Problem.** processPaidSessionReminders selects a partial parking_bookings row that omits customer_first_name and vehicle_registration, then builds the session start/end reminder SMS from it, so both fields render as the literal string undefined.

**What goes wrong.** Three days before a paid parking session starts, the customer receives: "The Anchor: undefined! Your parking kicks off on 4 Jun 2026, 14:00 - just checking you've got undefined ready to go!". Confirmed in production: parking_booking_notifications contains this exact text with status 'sent' on 2026-06-02, 2026-05-23 and 2026-05-07, plus the equivalent session_end text on 2026-06-05 and 2026-06-01.

**Evidence.**

```
route.ts:676 `.select('id, customer_id, customer_mobile, customer_email, start_at, end_at, paid_start_three_day_sms_sent, paid_end_three_day_sms_sent')`; route.ts:743 `smsBody: buildSessionThreeDayReminderSms(booking, 'start')`. src/lib/parking/notifications.ts:89 `return \`The Anchor: ${booking.customer_first_name}! Your parking kicks off on ${formatDateTime(booking.start_at)} - just checking you've got ${booking.vehicle_registration} ready to go!\``. Live row: "The Anchor: undefined! Your parking kicks off on 4 Jun 2026, 14:00 - just checking you've got undefined ready to go!"
```

**Verifier.** Verified. route.ts:676 selects `id, customer_id, customer_mobile, customer_email, start_at, end_at, paid_start_three_day_sms_sent, paid_end_three_day_sms_sent` and line 694 casts with `as ParkingBooking[]`, then line 743 builds `buildSessionThreeDayReminderSms(booking, 'start')`. notifications.ts:89 reads `${booking.customer_first_name}` and `${booking.vehicle_registration}`; neither column is selected. The 'end' variant (notifications.ts:92, used at route.ts:797) reads customer_first_name only. No re-fetch anywhere on the path. Live cron per vercel.json:129. Production data confirms: "The Anchor: undefined! Your parking kicks off on 4 Jun 2026, 14:00 , just checking you've got undefined ready to go!" status 'sent' 2026-06-02, plus identical sends 2026-05-23 and 2026-05-07, and the session_end variant "The Anchor: undefined! Heads up , your parking wraps up on ..." on 2026-06-05, 2026-06-01 and 2026-05-23. I downgraded critical to high: unlike parking-16 the dates render correctly and no wrong monetary figure is quoted, so the damage is brand/credibility rather than a mis-stated payment.

**Suggested fix.** Add customer_first_name and vehicle_registration to the select at line 676 (and keep the two selects in sync with whatever the notification builders read).

### P027. RLS lets any authenticated account read every parking booking, payment and SMS body regardless of parking:view

`supabase/migrations/20251123120000_squashed.sql:12948` | `broad-rls-policy` | CONFIRMED

**Problem.** The parking read policies are USING (true) for the authenticated role, so the RBAC parking:view check in the server action is the only real gate. Any staff account with a Supabase session can query parking_bookings, parking_booking_payments and parking_booking_notifications directly through PostgREST with the public anon key and read all customer PII.

**What goes wrong.** A staff member whose role grants no parking permission at all (so /parking redirects them to /unauthorized) opens devtools, takes the NEXT_PUBLIC_SUPABASE_ANON_KEY and their own session JWT from the page, and issues GET /rest/v1/parking_bookings?select=*. They receive every booking's customer_mobile, customer_email, full name, vehicle registration and the staff-only notes field, plus every SMS body stored in parking_booking_notifications.payload. The application-layer permission check is bypassed entirely.

**Evidence.**

```
Live pg_policy: parking_bookings_read, cmd r, roles {authenticated}, using_expr `true`; parking_booking_payments_read, cmd r, roles {authenticated}, using_expr `true`; parking_notifications_read, cmd r, roles {authenticated}, using_expr `true`. The app relies solely on parking.ts:226 `checkUserPermission('parking', 'view')` before `supabase.from('parking_bookings').select('*')` on the cookie/anon client (parking.ts:238-242). The write policies on the same tables correctly use `user_has_permission(auth.uid(), 'parking', 'manage')`, showing the read policies are the outlier.
```

**Verifier.** Confirmed against the live database, not just the migration. pg_policy shows parking_bookings_read / parking_booking_payments_read / parking_notifications_read all polcmd 'r', roles {authenticated}, using_expr `true`, matching supabase/migrations/20251123120000_squashed.sql:12948-12981 (`FOR SELECT TO authenticated USING (true)`). pg_class confirms relrowsecurity=true (so the policy is the operative gate, not a disabled-RLS artefact) and information_schema.role_table_grants confirms `authenticated` holds SELECT on all three. Anon is not exposed , anon holds the SELECT grant but no policy names the anon role, so anon reads return zero rows; the finder scoped this to authenticated correctly. I checked whether this is just the house style and it is not: across the public schema only 18 of 178 authenticated read policies use USING(true), and the other 14 are reference data (roles, permissions, menus, sites, published rota shifts). Parking is the only USING(true) cluster holding customer PII. The app-layer gate the finder names is real and is the sole gate , parking.ts:226 checkUserPermission('parking','view') before the cookie-client `.select('*')` at parking.ts:238-242, plus the page-level redirect in src/app/(authenticated)/parking/page.tsx:32. Neither constrains a direct PostgREST call. Write policies on the same three tables use user_has_permission(auth.uid(),'parking','manage'), so the read policies are demonstrably the outlier. Holding at high rather than critical: exploitation needs an already-authenticated trusted staff account to lift its own JWT, and the exposure is read-only.

**Suggested fix.** Change the three read policies to `USING (user_has_permission(auth.uid(), 'parking', 'view'))`, matching the write policies already in place on the same tables.

## Private Bookings

### P028. Simply viewing or downloading the contract mints a new contract version on the customer's document

`src/app/(authenticated)/private-bookings/[id]/contract/page.tsx:9` | `side-effecting-navigation` | CONFIRMED

**Problem.** The "Contract" entry in the booking's tab bar is an ordinary navigation link that redirects to a GET API route, and that route increments the contract version, writes an audit row and stores a snapshot on every request.

**What goes wrong.** A manager clicks the Contract tab to check the wording, or clicks "Download Contract" twice because the first PDF opened in the wrong window. Each click bumps `private_bookings.contract_version` and inserts a `contract_generated` audit entry. The version number is rendered onto the document the customer receives, so a booking that was only ever amended twice can send out a contract stamped "v22", and the audit trail suggests 22 re-issues that never happened. The user is also dumped out of the app shell onto a raw generated document with no back-link.

**Evidence.**

```
contract/page.tsx:7-10 , 
``​`ts
export default async function ContractPage({ params }: Props) {
  const { id } = await params
  redirect(`/api/private-bookings/contract?bookingId=${id}`)
}
``​`
The route calls `generateContractDocument` (src/lib/private-bookings/contract-lifecycle.ts:68-91), which runs `increment_private_booking_contract_version` and inserts a `contract_generated` audit row on every GET. `PrivateBookingDetailClient.tsx:2030` ("Download Contract") fetches the same route with `&format=pdf`.
Production confirms the drift: booking 11fd3680-95a4-4292-be2c-c90da3b1564e is on `contract_version` 22 with 22 `contract_generated` audit rows spanning 2026-07-03 to 2026-07-11, but only 11 stored `private_booking_documents` rows. The tab bar entry is defined at PrivateBookingDetailClient.tsx:1786 alongside Overview/Items/Messages.
```

**Verifier.** Reproduced end to end and the production data settles it. contract/page.tsx:7-10 is a bare `redirect('/api/private-bookings/contract?bookingId=' + id)`; the route (src/app/api/private-bookings/contract/route.ts:37) calls generateContractDocument on every GET, which runs the `increment_private_booking_contract_version` RPC (contract-lifecycle.ts:68-75), inserts a `contract_generated` audit row (:77-85) and stores a snapshot (:100-107). The route's only guards are auth (:23) and checkUserPermission('private_bookings','generate_contracts') (:29) - there is no idempotency key, no read-only mode, nothing that makes a repeat view a no-op. It IS reachable as a plain tab: navItems includes { label: 'Contract', href: `/private-bookings/${bookingId}/contract` } in PrivateBookingDetailClient.tsx:1786, items/page.tsx:832, messages client :277 and communications/page.tsx, and PageLayout renders those via SectionNav.tsx:119-131 as a next/link. 'Download Contract' hits the same route with &format=pdf (PrivateBookingDetailClient.tsx:2030). The version reaches the customer: contract-template.ts:243-244 builds `· Contract version N · generated <date>` into regFull/regShort/regWaiver, the document footers. Live DB proof, stronger than the finder's: the GET route is the only caller that passes ipAddress, and 38 of the 39 `contract_generated` audit rows in production carry an `ip_address` key - i.e. essentially every version ever minted came from a view or a download, not from an actual send (sendBookingContract at privateBookingActions.ts:2784 passes performedBy only). Booking 11fd3680-95a4-4292-be2c-c90da3b1564e is at contract_version 22 with 22 audit rows and 11 stored private_booking_documents rows. Two small corrections to the finder: the audit rows span 2026-07-03 to 2026-07-08 (not 07-11), and the contract page.tsx has no dynamic export, so I could not settle whether next/link prefetch also fires it - the click-driven path alone is proven. Keeping high: this corrupts both the SOP §28 audit trail and a number printed on the customer's contract.

**Suggested fix.** Split read from issue: serve the latest stored snapshot (or render without minting) for viewing/downloading, and reserve version incrementing for the explicit "Send Contract to Customer" action.

### P029. "Balance Reminder" SMS prefill quotes the entire booking total as the outstanding balance

`src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx:188` | `misleading-copy` | CONFIRMED

**Problem.** The `{balance_due}` placeholder is filled with the booking's gross total, with no payments subtracted, so the prefilled reminder overstates what the customer owes by everything they have already paid.

**What goes wrong.** A customer with a £1,200 booking has already paid £600 towards the balance. Staff open Messages, click "Balance Reminder", and the box prefills "£1200.00 balance still to settle by …". If sent as-is the customer is told to pay the full amount again. There is no way to get the right figure on this screen: `getBookingByIdForMessages` (src/services/private-bookings/queries.ts:469-538) does not fetch `private_booking_payments` at all.

**Evidence.**

```
PrivateBookingMessagesClient.tsx:186-189 , 
``​`ts
deposit_amount: booking.deposit_amount?.toFixed(2) || '0.00',
balance_due: (booking.gross_total ?? booking.calculated_total ?? booking.total_amount ?? 0).toFixed(2),
``​`
used by the template at line 57-59: `'Hi {customer_first_name} ,  £{balance_due} balance still to settle by {balance_due_date} …'`.
The live SQL confirms `gross_total` is not payment-aware: `get_booking_gross_total` returns `ROUND(get_booking_discounted_total(...),2) + get_booking_vat_amount(...)`. The list page computes the real figure correctly (queries.ts:259-261 subtracts the `private_booking_payments` sum) ,  that logic is simply absent here.
```

**Verifier.** Confirmed in code and against live rows. Line 188 is exactly `balance_due: (booking.gross_total ?? booking.calculated_total ?? booking.total_amount ?? 0).toFixed(2)`, consumed by the balance_reminder template at line 59. gross_total is not payment-aware - I pulled the live definition: get_booking_gross_total returns ROUND(get_booking_discounted_total(...),2) + get_booking_vat_amount(...), nothing about private_booking_payments. The data source cannot rescue it either: getBookingByIdForMessages (services/private-bookings/queries.ts:469-538) selects an explicit column list from private_bookings_with_details and never queries private_booking_payments. Crucially, the view DOES expose a correct `balance_remaining` column (verified in information_schema) - the messages query simply omits it, while both the list page (queries.ts:258-260) and the balance-reminder cron (api/cron/private-booking-monitor/route.ts:830-834) use it. Live bookings where the prefill is materially wrong today: Sylwia gross_total 642.00 but balance_remaining 242.00 (400.00 already paid); Millie Prynn 90.00 vs 15.00; Milly Ganatra 270.00 vs 145.00; Sophie 545.88 vs 455.88. Mitigation I looked for and did not find: the prefill lands in an editable Textarea (line 336) so staff could overwrite it, but the Booking Summary sidebar (lines 424-457) shows only customer, event, guest count - no financials - so there is no correct figure anywhere on the screen to copy. Sending is a single click on 'Send Message' (line 365) straight through sendPrivateBookingSms with no server-side recalculation. Keeping high.

**Suggested fix.** Fetch the payment sum in `getBookingByIdForMessages` and fill `{balance_due}` with `gross_total - payments`, mirroring `balance_remaining` in queries.ts:259-261.

### P030. Payment, discount, add-item and delete-item failures show nothing at all in the Overview modals

`src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:302` | `swallowed-error` | CONFIRMED

**Problem.** Four mutation handlers in the booking detail screen check only `result.success` and ignore the `{ error }` branch, so a failed payment, discount, item add or item delete produces no toast, no inline message and no state change.

**What goes wrong.** Staff record a £500 balance payment. `recordFinalPayment` returns `{ success: false, error: 'Booking not found' }` (or a permission/DB error). The spinner stops, the modal stays open showing the same amount, and the button reads "Record Payment" again. The natural reaction is to click again , a repeat attempt against a money-recording action. The same silence hides failed discounts and failed item deletes (the confirm dialog closes and the item is still listed, so it reads as a UI glitch rather than a rejection).

**Evidence.**

```
PaymentModal, line 297-306:
``​`ts
const result = type === "deposit" ? await recordDepositPayment(...) : await recordFinalPayment(...);
if (result.success) { onSuccess(); onClose(); }
setIsSubmitting(false);
``​`
DiscountModal, line 1383-1393: `const result = await applyBookingDiscount(...); if (result.success) { ... }`.
AddItemModal, line 1087-1099: `const result = await addBookingItem(data); if (result.success) { ... }`.
handleDeleteItem, line 2124-2128: `const result = await deleteBookingItem(itemId); if (result.success) { refreshBooking(); } setDeleteConfirm(null);`.
All four actions do return errors ,  e.g. privateBookingActions.ts:1147 `return { error: 'You do not have permission to record deposits' }` and :1200 `return { success: false, error: getErrorMessage(error) }`. The sibling `EditItemModal` in the same file (line 1574) does it correctly with `toast.error`.
```

**Verifier.** All four handlers verified in the live PrivateBookingDetailClient.tsx (live via page.tsx:7 -> PrivateBookingDetailServer.tsx:20). PaymentModal handleSubmit 297-307: `const result = type === 'deposit' ? await recordDepositPayment(...) : await recordFinalPayment(...); if (result.success) { onSuccess(); onClose(); } setIsSubmitting(false)` , no else, no toast. DiscountModal 1383-1394, AddItemModal 1087-1101 and handleDeleteItem 2120-2129 follow the same shape. The actions do return errors on both branches: privateBookingActions.ts:1146-1147 `if (!canManageDeposits) return { error: 'You do not have permission to record deposits' }` (no success key at all, so `result.success` is undefined) and :1265-1266 `catch { ... return { success: false, error: getErrorMessage(error) } }`; addBookingItem/deleteBookingItem return `{ error: getErrorMessage(error) }` in their catches (1885-1888, 1941-1944). I looked for the mitigation and found only a partial one: the PaymentModal is rendered only under `canManageDeposits` (3302, 3313), so the permission-denied branch specifically is hard to reach from the UI , the finder's headline example is therefore weaker than stated. The reachable silent paths are exceptions thrown by the service layer, which are numerous and realistic: src/services/private-bookings/payments.ts:569 `if (fetchError || !booking) throw new Error('Booking not found')`, the optimistic-lock update at 577-586 that can affect no rows, and any RLS/DB failure , all funnel into the catch and return `{ success: false, error }` to a UI that shows nothing. That the same file gets it right in EditItemModal at 1574-1579 (`if (result.error) toast.error(...)`) and imports toast already (used at 1059) proves this is an omission, not a house style. Keeping high: a money-recording surface that gives zero feedback on failure leaves staff unable to tell whether a payment landed, and recordBalancePayment is additive so a blind retry is not free.

**Suggested fix.** Add the `else { toast.error(result.error ?? '…') }` branch to all four handlers, matching EditItemModal at line 1574.

### P031. Overview "Add Item" throws away the vendor price the user was required to type and saves £0

`src/app/(authenticated)/private-bookings/[id]/PrivateBookingDetailClient.tsx:1053` | `data-loss` | CONFIRMED

**Problem.** In the Overview tab's AddItemModal the Unit Price field is `required` for vendor items and is editable, but `handleSubmit` unconditionally overwrites the entered value with 0 whenever a vendor is selected.

**What goes wrong.** Staff open a booking, click Add Item, pick Vendor, choose (say) a DJ, and type 350 in the required "Unit Price (£)" field. The item is saved with `unit_price: 0` and `line_total: 0`. The £350 never reaches the booking total, the contract, or the balance due, and nothing warns the user. The Items tab's own modal (items/page.tsx:249-257) handles the same case correctly, so the outcome depends entirely on which tab the item was added from.

**Evidence.**

```
PrivateBookingDetailClient.tsx:1030-1054 , 
``​`ts
let unitPrice = parseFloat(customPrice) || 0;
...
} else if (itemType !== "other" && selectedItem) {
  ...
  } else if (itemType === "vendor" && "service_type" in selectedItem) {
    description = `${selectedItem.name} (${selectedItem.service_type})`;
    unitPrice = 0; // Vendors don't have a fixed price in the schema
  }
}
``​`
The same component renders the field as required and editable for vendors ,  line 1287: `required={itemType === "other" || itemType === "vendor" || itemType === "electricity"}` and line 1292: `readOnly={(itemType !== "other" && itemType !== "vendor" && !!selectedItem) || itemType === "electricity"}`.
```

**Verifier.** Verified line by line and confirmed the file is live, which was my main refutation hypothesis given this repo's dead-duplicate-client trap. It is not dead: src/app/(authenticated)/private-bookings/[id]/page.tsx:7 imports PrivateBookingDetailServer, which at src/app/(authenticated)/private-bookings/PrivateBookingDetailServer.tsx:1 imports and at :20 renders PrivateBookingDetailClient. Inside it, AddItemModal is declared at line 954, rendered at 3342-3348 under `canEdit`, and opened by the 'Add Item' button at 2639. handleSubmit at 1025-1102 does `let unitPrice = parseFloat(customPrice) || 0` (1030) and then, at 1051-1053, `else if (itemType === 'vendor' && 'service_type' in selectedItem) { description = ...; unitPrice = 0; }` , unconditional, with the comment 'Vendors dont have a fixed price in the schema'. That comment is factually wrong: the live vendors table has a typical_rate column, and the service even exposes getVendorRate (src/services/private-bookings.ts:62). The branch is unavoidable for vendors: the vendor Select is `required` (line 1195) so selectedItem is always set, and `'service_type' in selectedItem` is key-presence so it holds even when the value is null. Meanwhile the same component renders Unit Price as required for vendors (1287-1291) and explicitly NOT readOnly for vendors (1292-1297), so staff are compelled to type a figure that is then discarded. I checked for server-side rescue and there is none: src/app/actions/privateBookingActions.ts:1847-1889 forwards unit_price untouched, and src/services/private-bookings/mutations.ts:2405-2517 inserts `unit_price: data.unit_price` verbatim into private_booking_items (it only derives vat_rate and display_order). The sibling modal at src/app/(authenticated)/private-bookings/[id]/items/page.tsx:234-257 handles it correctly via hasCustomPrice with a typical_rate fallback, so the outcome really does depend on which tab was used. High is right: silent financial data loss into the booking total, contract and balance.

**Suggested fix.** Drop the `unitPrice = 0` override and use the entered `customPrice`, falling back to the vendor's `typical_rate_normalized` exactly as items/page.tsx:249-257 already does.

### P032. Turnstile bot check on the public enquiry endpoints is skipped whenever any x-api-key or authorization header is present

`src/app/api/private-booking-enquiry/route.ts:127` | `captcha-bypass` | CONFIRMED

**Problem.** Both public private-booking endpoints decide whether to run CAPTCHA verification purely on the presence of an x-api-key or authorization header. Neither route validates that header against anything, so any anonymous caller can defeat the bot check by sending an arbitrary value.

**What goes wrong.** A scripted bot sends POST /api/private-booking-enquiry with headers `x-api-key: x` and `Idempotency-Key: <random>` and a minimal valid JSON body. verifyTurnstileToken is never called. Each accepted request creates a private_bookings draft row, creates or touches a customers row, records a communications entry, and fires sendManagerPrivateBookingCreatedEmail to manager@the-anchor.pub. The only remaining brake is createRateLimiter, which is an in-process Map (src/lib/rate-limit.ts:4) keyed on the raw x-forwarded-for header, so it resets on every cold start and is not shared across serverless instances.

**Evidence.**

```
src/app/api/private-booking-enquiry/route.ts:127-128 `const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))` then `if (!hasApiKey) {` guards the Turnstile block. Identical code at src/app/api/public/private-booking/route.ts:105-106. Neither file imports or calls any API-key validation helper (no withApiAuth, no validateApiKey) ,  the header is read once and never checked. For contrast, src/app/api/recruitment/applications/route.ts:324 actually branches on `if (hasApiKey)` to do further work, but these two routes only use it to skip the CAPTCHA.
```

**Verifier.** Both routes verified. private-booking-enquiry/route.ts:127-138 and public/private-booking/route.ts:105-116 are identical: `const hasApiKey = Boolean(request.headers.get('x-api-key') || request.headers.get('authorization'))` then `if (!hasApiKey) { ...verifyTurnstileToken... }`. I grepped both files for hasApiKey/apiKey/api_key , those two lines per file are the only hits, and neither file imports @/lib/api/auth (withApiAuth/validateApiKey exist at src/lib/api/auth.ts:315 and :31 but are not used here), so the header is never checked against the api_keys table. Middleware offers no cover: src/middleware.ts:13 lists '/api' as a public prefix. The remaining brake is as described , src/lib/rate-limit.ts:4 is a process-local Map keyed on x-forwarded-for, 20 per 5 minutes, not shared across serverless instances. Side effects confirmed live in the enquiry route: PrivateBookingService.createBooking at :220 with status 'draft' at :228, plus sendManagerPrivateBookingCreatedEmail at :270. One thing I could not settle: src/lib/turnstile.ts:21-24 returns success when TURNSTILE_SECRET_KEY is unset, and I cannot read Vercel production env from here (the key is present in the local .env.local, which is only a hint). If it is unset in production the bypass is moot because no CAPTCHA runs at all , which is a worse problem, not a refutation. Severity high stands: a security control that any client can switch off with one arbitrary header, on two unauthenticated write endpoints.

**Suggested fix.** Only skip Turnstile after the API key has actually been validated (e.g. resolve it through the existing API-key auth helper and require a successful lookup), and treat an unrecognised key as an anonymous request that must pass the CAPTCHA.

### P033. Communications tab history is always empty: query selects a column that does not exist

`src/components/private-bookings/CommunicationsTabServer.tsx:30` | `broken-screen` | CONFIRMED

**Problem.** The SMS history query selects `twilio_sid`, but the column on `private_booking_sms_queue` is `twilio_message_sid`. PostgREST rejects the whole request with 42703, the error is destructured away, and `history` is silently `[]` for every booking.

**What goes wrong.** Open any booking, click the Communications tab. The History card renders the empty state "No messages sent yet" even for bookings with dozens of sent messages. Verified against production: `private_booking_sms_queue` has 116 sent, 14 failed and 11 pending rows, and `select twilio_sid from private_booking_sms_queue` returns `ERROR: 42703: column "twilio_sid" does not exist`. Staff checking whether the customer was actually messaged get a confident, wrong "nothing sent".

**Evidence.**

```
CommunicationsTabServer.tsx:27-33 , 
``​`ts
const { data: historyData } = await supabase
  .from('private_booking_sms_queue')
  .select(
    'id, created_at, trigger_type, template_key, status, message_body, twilio_sid, scheduled_for',
  )
``​`
Note `const { data: historyData }` ,  the `error` field is never read, so the 400 is invisible. Live schema (information_schema.columns for private_booking_sms_queue) contains `twilio_message_sid`, not `twilio_sid`. The bad name originates in src/types/private-bookings.ts:239 (`twilio_sid?: string`) and is propagated to CommunicationsTab.tsx:19/111/113.
```

**Verifier.** Proven empirically against production, not just by reading. src/components/private-bookings/CommunicationsTabServer.tsx:27-34 selects 'id, created_at, trigger_type, template_key, status, message_body, twilio_sid, scheduled_for' from private_booking_sms_queue, and destructures `const { data: historyData }` only , the error is never read. Live information_schema.columns for public.private_booking_sms_queue returns twilio_message_sid; there is no twilio_sid, and only one relation of that name exists (public schema). I then hit the live PostgREST endpoint directly: `select=id,twilio_sid` returns HTTP 400 {"code":"42703","message":"column private_booking_sms_queue.twilio_sid does not exist"}, while `select=id,twilio_message_sid` returns HTTP 200. So historyData is null on every call and `history` is unconditionally [], rendering the EmptyState 'No messages sent yet' at CommunicationsTab.tsx:80-85. Production has 141 rows (116 sent, 14 failed, 11 pending), so this is not a hypothetical empty table. I looked hard for a mitigation and found none: there is no second history source in the component, and RLS is not the cause , pg_policies shows a SELECT policy granting super_admin/manager plus one keyed on user_has_permission(...,'view_sms_queue'), so managers would see rows once the column name is fixed. LIVE: imported and rendered at src/app/(authenticated)/private-bookings/[id]/communications/page.tsx:5 and :89, behind a real permission redirect (lines 25-39) , this is the only consumer, so it is not a dead-duplicate case. Root cause is the wrong field name in src/types/private-bookings.ts:239 (`twilio_sid?: string`), propagated to CommunicationsTab.tsx:19, 111 and 113. High is correct: a staff-facing screen confidently asserts nothing was sent when 116 messages were.

**Suggested fix.** Select `twilio_message_sid` (aliasing to `twilio_sid` if the client type is to stay), fix the field name in src/types/private-bookings.ts, and surface the `error` from the query instead of discarding it.

### P034. Hold expiry is stored at midnight, so the cron kills the hold on the morning of the day the customer was told

`src/services/private-bookings/mutations.ts:680` | `timezone-bug` | CONFIRMED

**Problem.** A staff-entered deposit due date (`deposit_due_date`, a YYYY-MM-DD string) is turned into `new Date(value)` = 00:00 UTC and stored in `hold_expiry`. The expire-holds cron runs at 06:00 UTC and cancels any draft whose `hold_expiry < now`, so a hold advertised to the customer as "by 18 August" is destroyed at 07:00 London on 18 August. The auto-computed path has the same defect because `computeHoldExpiry` caps at `balanceDueMoment(new Date(event_date))`, which is also a UTC midnight.

**What goes wrong.** Staff create a booking on 4 Aug with deposit due date 18 Aug. The creation SMS reads "£250 deposit secures it by 18 August"; the 1-day reminder on 17 Aug reads "expires tomorrow (18 August)". At 06:00 UTC on 18 August the expire-holds cron matches `hold_expiry (2026-08-18T00:00:00Z) < now`, flips the booking to cancelled and texts the customer "your hold on 15 October has lapsed" , a full working day before the deadline the customer was given. Production booking 6932f051-4e3b-406c-8fbf-e177f1461b66 currently holds exactly this value (`hold_expiry = 2026-08-18 00:00:00+00`, i.e. 01:00 London), and 22 of the 37 private bookings have a hold_expiry pinned to UTC midnight.

**Evidence.**

```
mutations.ts:678-690 ,  `} else if (input.hold_expiry) {\n    // User manually specified a date\n    holdExpiryMoment = new Date(input.hold_expiry);` (input.hold_expiry is validated as `/^\d{4}-\d{2}-\d{2}$/` in types.ts:186 and sourced from `hold_expiry: getString(formData, 'deposit_due_date')` at privateBookingActions.ts:238).\nmutations.ts:696 ,  `const holdExpiryIso = holdExpiryMoment ? holdExpiryMoment.toISOString() : null;`\ntypes.ts:81-85 ,  `export function balanceDueMoment(eventDate: Date): Date { const due = new Date(eventDate); due.setDate(due.getDate() - BALANCE_DUE_DAYS_BEFORE_EVENT); return due; }`\nsrc/app/api/cron/private-bookings-expire-holds/route.ts:31-33 ,  `.eq('status', 'draft')\n    .not('hold_expiry', 'is', null)\n    .lt('hold_expiry', now);` with vercel.json schedule `"0 6 * * *"`.\nLive data: `SELECT hold_expiry, hold_expiry AT TIME ZONE 'Europe/London' ...` returns `2026-08-18 00:00:00+00` / `2026-08-18 01:00:00` for booking 6932f051.
```

**Verifier.** Reproduced end to end and found no mitigating guard. Chain is live: src/app/(authenticated)/private-bookings/new/page.tsx:389-391 renders <Input type="date" name="deposit_due_date"> -> privateBookingActions.ts:238 `hold_expiry: getString(formData, 'deposit_due_date')` -> validated by types.ts:186 as /^\d{4}-\d{2}-\d{2}$/ -> PrivateBookingService.createBooking -> mutations.ts:680 `holdExpiryMoment = new Date(input.hold_expiry)` -> mutations.ts:696 `.toISOString()` -> stored in hold_expiry. Verified in Node: `new Date('2026-08-18')` parses to 2026-08-18T00:00:00.000Z (date-only strings are UTC per spec), and Intl en-GB/Europe/London renders it as '18 August 2026'. Both the creation SMS (mutations.ts:88-101 via formatPrivateBookingDate -> formatDateInLondon, dateUtils.ts:43-50) and the cron reminders (private-booking-monitor/route.ts:514 formatLondonDate) therefore quote 18 August to the customer. The expire-holds cron (src/app/api/cron/private-bookings-expire-holds/route.ts:31-33 `.eq('status','draft').not('hold_expiry','is',null).lt('hold_expiry', now)`) runs at 06:00 UTC (vercel.json:253-254 "0 6 * * *") with no grace window: 2026-08-18T00:00:00Z < 2026-08-18T06:00:00Z is true, so the hold dies at 07:00 London on the advertised day. DB confirms hold_expiry is timestamptz (not date, which would have blunted this), booking 6932f051-4e3b-406c-8fbf-e177f1461b66 is status=draft with hold_expiry=2026-08-18 00:00:00+00 against a 2026-10-15 event, and 22 of 29 non-null hold_expiry values sit on UTC midnight. No DB trigger on private_bookings touches hold_expiry (checked pg_trigger: only audit_balance_due_date_change, prevent_hard_delete_when_sms_sent, calculate_balance_due_date, sync_customer_name_from_customers, update_updated_at_column). The cron is proven live: booking ccc882a6 was cancelled by it at 2026-07-29 06:00:09Z. One correction to the finder's framing: the auto-computed path only inherits UTC midnight when computeHoldExpiry caps at balanceDueMoment (types.ts:127); the uncapped branch carries the creation time-of-day and is safe. Severity high held: customer-facing wrongful cancellation plus an SMS saying the hold lapsed.

**Suggested fix.** Anchor a date-only hold deadline at end of day in Europe/London (23:59:59 local) rather than `new Date('YYYY-MM-DD')`, and apply the same to the `balanceDueMoment` cap, so the hold survives the whole day the customer was quoted.

### P035. Deleting a paid deposit reverts the booking to draft with a stale hold_expiry, so the cron cancels a live booking the next morning

`src/services/private-bookings/payments.ts:1065` | `state-machine-violation` | CONFIRMED

**Problem.** `deleteDeposit` flips a confirmed booking back to `draft` but never clears `hold_expiry`. Recording a deposit (`finalizeDepositPaymentWithClient`) does not clear it either, so 15 of 37 production bookings are confirmed-and-paid with a `hold_expiry` already in the past. The moment one of those is reverted to draft the expire-holds cron cancels it and texts the customer that their hold has lapsed. The same trap applies to the `cancelled -> draft` reinstatement that `ALLOWED_TRANSITIONS` permits (7 cancelled bookings currently carry a past hold_expiry).

**What goes wrong.** Staff record a deposit against the wrong booking, then use Payment history > delete on the deposit to correct it. `deleteDeposit` clears `deposit_paid_date` and, because there are no balance payments, sets `status = 'draft'`. The booking's `hold_expiry` is still whatever was set at creation , e.g. booking cb2b0398-e31f-4cbb-abdf-e85ede4698da has `hold_expiry = 2026-06-03` against an event on 2026-11-21. At 06:00 UTC the next day the expire-holds cron matches it, sets `status = 'cancelled'`, deletes the Google Calendar entry, cancels queued SMS and sends the customer "your hold on 21 November has lapsed" , for a booking the venue still intends to run.

**Evidence.**

```
payments.ts:1056-1068 ,  `let statusReverted = false\n  if (booking.status === 'confirmed') {\n    const { count, error: countError } = await db\n      .from('private_booking_payments')\n      .select('id', { count: 'exact', head: true })\n      .eq('booking_id', bookingId)\n    if (!countError && count === 0) {\n      const { error: statusError } = await db\n        .from('private_bookings')\n        .update({ status: 'draft' })   // <- hold_expiry untouched`\npayments.ts:447-452 ,  the deposit-recording payload sets only `deposit_paid_date`, `deposit_payment_method`, `...statusUpdate`, `updated_at`; `hold_expiry` is never cleared.\ntypes.ts:13-18 ,  `cancelled: ['draft']` allows the same stale-hold reinstatement.\nLive data: `count(*) FILTER (WHERE status='confirmed' AND deposit_paid_date IS NOT NULL AND hold_expiry < now()) = 15`.
```

**Verifier.** Confirmed; cited line 1063 is the surrounding statement, the actual write is payments.ts:1063-1066 `const { error: statusError } = await db.from('private_bookings').update({ status: 'draft' }).eq('id', bookingId)` with no hold_expiry in the payload. I grepped every hold_expiry write in the module: the ONLY places it is cleared are payments.ts:996 and :1013 (the deposit-waived-to-zero path) and mutations.ts:1077/:1094 (date_tbd paths). finalizeDepositPaymentWithClient's payload (payments.ts:447-452) contains deposit_paid_date, deposit_payment_method, statusUpdate and updated_at only, so a confirmed booking keeps its stale hold. I looked for the guard that would kill this and it does not exist: no DB trigger touches hold_expiry (full pg_trigger dump on private_bookings checked), and the count check at payments.ts:1058-1062 counts private_booking_payments rows only, which never contain the deposit itself (financial.ts:84-102 sources deposit_paid from private_bookings.deposit_amount/deposit_paid_date), so a deposit-only booking ALWAYS reverts to draft. Live path: PaymentHistoryTable.tsx:111 -> privateBookingActions.ts:2664 deleteDeposit, and PaymentHistoryTable is rendered by PrivateBookingDetailClient.tsx:3143, which page.tsx reaches via PrivateBookingDetailServer.tsx:1 (checked for the dead-duplicate trap: this is the live client). cancelled->draft is also genuinely reachable via updateBookingStatus (mutations.ts:1689-1696) against ALLOWED_TRANSITIONS types.ts:17. Production exposure is worse than a theoretical race: 11 bookings are RIGHT NOW status=confirmed, deposit paid, hold_expiry < now(), and have zero private_booking_payments rows, i.e. one deposit deletion away from being cancelled by the 06:00 UTC cron; plus 7 cancelled bookings with past hold_expiry that would self-destruct on reinstatement. Severity high held.

**Suggested fix.** Clear `hold_expiry` when a deposit is recorded, and recompute (or null) it whenever a booking is moved back to `draft` in `deleteDeposit` and in the `cancelled -> draft` transition.

### P036. private_bookings_with_details view lost security_invoker, exposing all booking PII to any signed-in user

`supabase/migrations/20260705100000_pb_sop_due_dates_and_vat.sql:291` | `rls-bypass-security-definer-view` | CONFIRMED

**Problem.** This migration recreates public.private_bookings_with_details with CREATE OR REPLACE VIEW and never re-applies ALTER VIEW ... SET (security_invoker = true), which every earlier migration touching the view did. The live view is therefore owned by postgres (which has BYPASSRLS) and runs with definer semantics, so RLS on private_bookings is not applied, while SELECT on the view is granted to authenticated.

**What goes wrong.** A bar-staff Supabase account with zero private_bookings permissions opens devtools, takes its own session JWT and the NEXT_PUBLIC anon key from the app bundle, and calls GET /rest/v1/private_bookings_with_details?select=*. PostgREST returns every private booking ever taken: customer_name, contact_phone, contact_email, customer_mobile (joined from customers), internal_notes (staff-only notes), deposit_amount, deposit_paid_date, total_amount, balance_remaining and discount_reason. The RLS policy "Users can view private bookings" (user_has_permission(auth.uid(),'private_bookings','view')) is never evaluated.

**Evidence.**

```
Migration line 291: `CREATE OR REPLACE VIEW public.private_bookings_with_details AS` ,  the file has 583 lines and contains no `security_invoker` and no GRANT/REVOKE at all (grep for security_invoker|GRANT|REVOKE returns nothing). Contrast supabase/migrations/20260629000001_clamp_line_total_nonnegative.sql:142 `ALTER VIEW public.private_bookings_with_details SET (security_invoker = true);`. Live DB confirms the option was lost: `select c.relname, pg_get_userbyid(c.relowner), c.reloptions from pg_class c ...` returns `private_bookings_with_details | postgres | null`, while the sibling views `private_booking_summary` and `private_booking_sms_reminders` both return `{security_invoker=true}`. `select rolname, rolbypassrls from pg_roles` returns `postgres | true`. Grants on the view include `authenticated:SELECT`. Supabase's own security advisor reports ERROR `security_definer_view`: "View public.private_bookings_with_details is defined with the SECURITY DEFINER property". The view definition selects pb.contact_phone, pb.contact_email, pb.internal_notes, c.mobile_number AS customer_mobile. src/services/private-bookings/queries.ts:41 reads this view through the cookie client on the assumption RLS applies.
```

**Verifier.** Every claim checks out. Migration line 291 is `CREATE OR REPLACE VIEW public.private_bookings_with_details AS`; grep across all 583 lines finds no security_invoker, GRANT or REVOKE, and it is the last migration to touch the view (the previous one, 20260629000001_clamp_line_total_nonnegative.sql, sets security_invoker=true). CREATE OR REPLACE VIEW replaces reloptions wholesale, which matches the live state: pg_class shows private_bookings_with_details owner=postgres reloptions=NULL, while sibling views private_booking_summary and private_booking_sms_reminders both carry {security_invoker=true}. postgres has rolbypassrls=true and owns private_bookings and customers (relforcerowsecurity=false), so the view runs definer and RLS is skipped. The base-table SELECT policies do gate on user_has_permission(auth.uid(),'private_bookings','view'), and customers is likewise gated on customers/view, so the bypass is not cosmetic. Blast radius measured on live data: 24 auth.users, only 4 satisfy user_has_permission(id,'private_bookings','view') , 20 accounts can read data they are not entitled to. Supabase advisor independently reports ERROR security_definer_view for this exact view. Confirmed live: the view is read by queries.ts:41/139/279/473, dashboard-data.ts:1043, customers/[id]/page.tsx:506 and two crons. Downgraded critical to high on one fact the finder overstated: anon has NO grant on the view (grants are postgres, authenticated, service_role only), so this is not internet-reachable , it needs a signed-in staff account. Also worth noting a fix is safe: booking-portal/[token]/page.tsx:166 reads the view through the admin client, so restoring security_invoker will not break the public portal.

**Suggested fix.** Run ALTER VIEW public.private_bookings_with_details SET (security_invoker = true); in a new migration, and add the same ALTER immediately after every CREATE OR REPLACE VIEW of it so a later redefinition cannot silently drop the option again.

### P037. create_private_booking_transaction is SECURITY DEFINER with EXECUTE granted to PUBLIC, so anonymous callers can create bookings and customers

`supabase/migrations/20260705100000_pb_sop_due_dates_and_vat.sql:355` | `unauthenticated-mutation` | CONFIRMED

**Problem.** The booking-creation RPC is SECURITY DEFINER and no migration ever revokes EXECUTE from PUBLIC, so the anon role can call it directly via /rest/v1/rpc/create_private_booking_transaction with only the publishable anon key. It inserts into private_bookings and customers using caller-supplied JSONB whose keys include status, deposit_amount, hold_expiry, internal_notes, deposit_waived and created_by.

**What goes wrong.** An attacker reads NEXT_PUBLIC_SUPABASE_ANON_KEY out of the client bundle and POSTs to /rest/v1/rpc/create_private_booking_transaction with p_booking_data {"event_date":"2026-12-24","status":"confirmed","deposit_amount":0,"deposit_waived":true,"internal_notes":"..."} and p_customer_data {"mobile_number":"07700900000"}. A confirmed private booking appears in the staff diary with no deposit, and a new customers row is created with sms_opt_in defaulting to true. Every application control on this path is bypassed: the Turnstile check, the 20-per-5-minutes rate limiter, the Idempotency-Key requirement, and the explicit field whitelist in src/app/api/public/private-booking/route.ts:197-220 that deliberately excludes customer_id, deposit_amount, hold_expiry, status, created_by and internal_notes.

**Evidence.**

```
Live: `select proname, prosecdef, (select string_agg(distinct grantee,', ') from information_schema.role_routine_grants ...) from pg_proc ...` returns `create_private_booking_transaction | true | PUBLIC, authenticated, postgres, service_role`. Supabase advisor: WARN anon_security_definer_function_executable ,  "Function public.create_private_booking_transaction(...) can be executed by the anon role as a SECURITY DEFINER function via /rest/v1/rpc/create_private_booking_transaction". Function body inserts `INSERT INTO private_bookings (... status, deposit_amount, ... internal_notes, ... created_by, hold_expiry, date_tbd, deposit_waived, deposit_waived_reason) VALUES (... (p_booking_data->>'...'))`. `grep -rn "REVOKE.*create_private_booking_transaction" supabase/migrations/*.sql` returns nothing. The anon grant is currently load-bearing because src/services/private-bookings/mutations.ts:609 uses `const supabase = await createClient()` (cookie/anon client) and calls the RPC at line 744, and that path runs unauthenticated from the two public API routes.
```

**Verifier.** Migration line 355 defines create_private_booking_transaction with SECURITY DEFINER (line 358). Live: prosecdef=true, owner=postgres (rolbypassrls=true), proacl `=X/postgres | postgres=X/postgres | authenticated=X/postgres | service_role=X/postgres` , the bare `=X` is the PUBLIC grant, and has_function_privilege('anon', oid, 'EXECUTE') returns true. No REVOKE exists in any migration. I read the whole 6,640-char function body looking for an internal guard: there is none , no auth.uid()/auth.role() check anywhere. It inserts caller-supplied status, deposit_amount, hold_expiry, internal_notes, created_by, date_tbd, deposit_waived into private_bookings and can INSERT a customers row with sms_opt_in defaulting true. Supabase advisor independently flags anon_security_definer_function_executable for this function. The finder's note that the anon grant is load-bearing is also correct: mutations.ts:1 imports createClient from '@/lib/supabase/server' (anon key + cookies), createBooking calls it at line 609 and rpc's at 744, and that path runs sessionless from both public routes , so a blanket REVOKE would break the site. Downgraded critical to high: this is write-only (the function returns only the row it just created, so no existing data is readable), and the two public routes already permit anonymous draft creation. The genuine delta is field injection (status='confirmed', deposit_waived, internal_notes, created_by) plus total bypass of Turnstile, the rate limiter, the idempotency key and the whitelist at api/public/private-booking/route.ts:197-220 , enough to poison the staff diary and, via the monitor cron's draft-reminder pass, drive outbound SMS to attacker-chosen numbers.

**Suggested fix.** Switch createBooking to call the RPC through createAdminClient() (or pass an explicit client), then REVOKE EXECUTE ON FUNCTION public.create_private_booking_transaction(jsonb,jsonb,jsonb) FROM PUBLIC, anon; leaving the grant to service_role and authenticated only.

## Cross-cutting

### P038. Private Bookings SMS Queue "Send Now" is permanently disabled for every user

`src/app/(authenticated)/private-bookings/sms-queue/page.tsx:91` | `dead-control` | PLAUSIBLE

**Problem.** The Send control is gated on `private_bookings.send` or `private_bookings.manage`, and neither permission row exists in the production permissions table, so canSendSms is false for every account including super_admin , approved private-booking SMS can never be sent from the queue.

**What goes wrong.** A manager opens /private-bookings/sms-queue, approves a queued message, and the row moves to 'approved' with no way to dispatch it , the Send Now button is greyed out for them and for the super_admin they escalate to. Production bears this out: private_booking_sms_queue holds 11 rows stuck at status='pending' with created_at between 2026-07-06 and 2026-07-27, and zero rows have ever reached status='approved'.

**Evidence.**

```
src/app/(authenticated)/private-bookings/sms-queue/page.tsx:91
``​`tsx
const canSendSms = actions.has('send') || actions.has('manage')
``​`
and line 296-299:
``​`tsx
                  disabled={!canSendSms}
                >
                  Send Now
``​`
Live `permissions` rows for module_name='private_bookings': approve_sms, create, delete, edit, generate_contracts, gm_override, manage_catering, manage_deposits, manage_spaces, manage_vendors, refund, view, view_pricing, view_sensitive, view_sms_queue, view_vendor_costs. There is no `send` and no `manage`.

`actions` comes from getCurrentUserModuleActions (src/app/actions/rbac.ts:92-96), which maps the rows returned by the get_user_permissions RPC and applies **no** super_admin short-circuit ,  unlike PermissionService.checkUserPermission (src/services/permission.ts:185). A permission with no row can never appear.

Approving does not send: SmsQueueService.approveSms (src/services/sms-queue.ts:709-751) only sets `status: 'approved'` and returns.
```

**Verifier.** Raised by the completeness critic; not independently re-verified.

**Suggested fix.** Either seed a `private_bookings.send` permission (granted to super_admin and manager) or re-gate the button and sendApprovedSms on the existing `approve_sms` action. The same non-existent pair is checked in src/app/actions/privateBookingActions.ts:1512 and :2696.

### P039. Drop the "Public can read active API keys" RLS policy , every integration key hash and scope set is anon-readable

`supabase/migrations/20251123120000_squashed.sql:4832` | `secret-disclosure` | PLAUSIBLE

**Problem.** public.api_keys carries an RLS policy granting SELECT to role `public` for every active row, so an anonymous caller can read all 8 live API keys' key_hash, name, permissions array and rate_limit , the credentials that gate the Parking and Customers external APIs.

**What goes wrong.** An attacker with the public anon key calls `GET /rest/v1/api_keys?select=*&is_active=eq.true` and receives every integration key's unsalted SHA-256 hash plus its exact permission scopes (`parking:create`, `parking:view`, `read:events`, …) and rate limits. That is a full map of the external API surface and its privilege boundaries, plus an offline-attackable digest of each secret, handed to an unauthenticated caller.

**Evidence.**

```
supabase/migrations/20251123120000_squashed.sql:4832
``​`sql
CREATE POLICY "Public can read active API keys" ON "public"."api_keys" FOR SELECT USING (("is_active" = true));
``​`
Live `pg_policies` confirms `roles = {public}`, `qual = (is_active = true)`. Probing production under `SET LOCAL ROLE anon` returned 8 rows. Columns exposed: id, key_hash, name, description, permissions (jsonb), rate_limit, is_active, last_used_at, expires_at.

The application code assumes the opposite ,  src/lib/api/auth.ts:31 comments "Use admin client for API key validation since api_keys table requires elevated permissions", and the hash is an unsalted SHA-256 (src/lib/api/auth.ts:16-18: `return createHash('sha256').update(key).digest('hex');`).
```

**Verifier.** Raised by the completeness critic; not independently re-verified.

**Suggested fix.** Drop the policy in a migration and replace it with nothing , validateApiKey already uses the service-role client (src/lib/api/auth.ts:32), so no anon or authenticated read path is needed.

### P040. Revoke PUBLIC EXECUTE on import_customers_atomic , anonymous callers can bulk-insert customers

`supabase/migrations/20260712000000_customer_import_contact_defaults.sql:98` | `unauthenticated-mutation` | PLAUSIBLE

**Problem.** import_customers_atomic is SECURITY DEFINER with no internal auth check, and production has EXECUTE granted to PUBLIC and anon, so anyone with the browser-visible anon key can bulk-insert arbitrary customer rows , defaulting to sms_opt_in=true and sms_status='active'.

**What goes wrong.** An unauthenticated caller posts to `/rest/v1/rpc/import_customers_atomic` with an array of fabricated customers. Each row lands in the production customers table as SMS-eligible (sms_opt_in true, sms_status active), so the next bulk marketing send targets attacker-supplied mobile numbers at the pub's cost, and the customer list, label automation and win-back audience counts are all polluted. This is the same footgun the sweep already caught on get_bulk_sms_recipients and record_customer_consent, but this one writes.

**Evidence.**

```
supabase/migrations/20260712000000_customer_import_contact_defaults.sql:98
``​`sql
GRANT EXECUTE ON FUNCTION public.import_customers_atomic(jsonb) TO authenticated, service_role;
``​`
No REVOKE accompanies it. Live `pg_proc.proacl` for the function: `=X/postgres | postgres=X/postgres | anon=X/postgres | authenticated=X/postgres | service_role=X/postgres` ,  the leading `=X/postgres` is PUBLIC. `prosecdef` is true. The body begins:
``​`sql
CREATE OR REPLACE FUNCTION public.import_customers_atomic(p_customers jsonb)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$ ... COALESCE((item->>'sms_opt_in')::boolean, true) AS sms_opt_in,
      COALESCE(NULLIF(item->>'sms_status', ''), 'active') AS sms_status,
``​`
There is no auth.uid() or user_has_permission check anywhere in it. Its only legitimate caller is src/services/customers.ts:421.
```

**Verifier.** Raised by the completeness critic; not independently re-verified.

**Suggested fix.** Add `REVOKE ALL ON FUNCTION public.import_customers_atomic(jsonb) FROM PUBLIC, anon;` in a new migration, mirroring the existing 20260708000042_bulk_sms_recipients_revoke.sql pattern.

# MEDIUM (74)

## Employees

**P041. Employee "Recent changes" panel is permanently broken: RPC called with a parameter name that does not exist**

`src/app/actions/employee-history.ts:25` | `wrong-rpc-parameter` | CONFIRMED

`getEmployeeChangesSummary` calls the `user_has_permission` RPC with `p_resource`, but the live function signature is `user_has_permission(p_user_id uuid, p_module_name text, p_action text)` with no defaults, so PostgREST cannot resolve it; the returned error is discarded and the null result is read as "no permission". Any user, including a super_admin, opens /employees/<id>. The `EmployeeRecentChanges` card calls `getEmployeeChangesSummary`. PostgREST returns PGRST202 (no function matching p_action/p_resource/p_user_id). The code destructures only `data`, so `hasPermission` is null, the action returns `{ error: 'Insufficient permissions to view employee history' }`, and the card renders "Recent changes are temporarily unavailable." 100% of the time. The `get_employee_changes_summary` function itself exists and works, so the feature is dead for a reason nobody can see from the UI.

Fix: Rename the argument to `p_module_name`, and capture and log the RPC `error` instead of collapsing it into a permission denial.

**P042. Employee change-history permission check calls the RPC with the wrong argument name and swallows the error**

`src/app/actions/employee-history.ts:25` | `broken-permission-check` | CONFIRMED

getEmployeeChangesSummary calls user_has_permission with p_resource, but the live function signature is (p_user_id uuid, p_module_name text, p_action text). PostgREST cannot resolve the overload, the returned error is destructured away, and the null data makes the check fail for everyone including super_admin, so the Recent Changes panel is permanently dead. Any user, super_admin included, opens /employees/<id>. The EmployeeRecentChanges card calls getEmployeeChangesSummary, the RPC 404s on argument mismatch, `hasPermission` is undefined, and the panel always renders 'Insufficient permissions to view employee history'. Because the error object is discarded, nothing is logged and the failure looks like a permissions problem rather than a bug.

Fix: Rename the RPC argument to p_module_name (or switch to checkUserPermission('employees','view') like every other action in the section) and stop discarding the RPC error so a future signature drift surfaces instead of silently denying.

**P043. Onboarding stores bank/NI details with no validation, which then blocks the manager edit form**

`src/app/actions/employeeInvite.ts:593` | `validation-asymmetry` | CONFIRMED

`FinancialSectionSchema` accepts any string for NI number, sort code and account number, while `FinancialDetailsSchema` (the manager form) enforces strict regexes. Records ingested through onboarding therefore fail validation when a manager next tries to save the financial tab. An employee types "JW 27 47 83 D" as their NI number during onboarding; it is stored verbatim. Later a manager opens /employees/<id>/edit → Financial Details to correct the bank name. The form pre-fills `ni_number` with the stored value; on submit `FinancialDetailsSchema` rejects it with "NI number must be in format: AA123456A" and nothing is saved. The manager cannot fix the bank name without also retyping the NI number. Live data: 22 rows in employee_financial_details, of which 8 hold NI values the manager form rejects (e.g. "JW 27 47 83 D", "Ne139301B", "Pb531808a") and 6 hold sort codes outside the stored format (e.g. "111468" alongside "09-01-28"), so the same field is stored two different ways.

Fix: Apply the same NI/sort-code/account-number schema (including an uppercase + strip-whitespace transform for NI) to the onboarding financial section, and add that transform to `FinancialDetailsSchema` so existing rows can be re-saved.

**P044. Employee-entered phone numbers are stored raw, bypassing E.164 normalisation**

`src/app/actions/employeeInvite.ts:700` | `missing-normalisation` | CONFIRMED

`saveOnboardingSection`'s `personal` branch writes `phone_number` and `mobile_number` straight from the form, while every manager-facing path runs them through `formatPhoneForStorage()` via `phoneNumberSchema`, so the employees table holds a mix of `+447...` and `07...` values. A new starter types "07476 469269" into the onboarding Personal Details step. It is stored verbatim. A manager later searches the roster for that person by the number they have in their own phone ("+447476469269"); `getEmployeesRoster` builds `mobile_number.ilike.%+447476469269%` and returns nothing, so the employee appears not to exist. Any later code that matches an employee to an inbound SMS or to a customer record by phone equality also misses them. Live data confirms this is already happening: 8 employee rows hold non-E.164 numbers, and three of them (e.g. 9dc2b643…, phone 07476469269) have `onboarding_completed_at` in March 2026 with `invited_at` null, i.e. they came through the self-service onboarding flow after it shipped.

Fix: Reuse the exported `phoneNumberSchema` (or call `formatPhoneForStorage` directly) inside `PersonalSectionSchema` so both entry points store E.164.

**P045. Employee-completed onboarding stores phone numbers raw, breaking roster phone search**

`src/app/actions/employeeInvite.ts:700` | `phone-normalisation` | CONFIRMED

saveOnboardingSection writes phone_number and mobile_number straight from the form with no formatPhoneForStorage call, unlike every manager-side path, so the employees table holds a mix of E.164 and raw 07… numbers and the roster's ilike phone search matches only one format. A new starter types 07700900123 on the onboarding Personal Details step; it is stored verbatim. A manager later searches the employee roster for "+447700900123" (the format shown on records created through the admin form) and gets no results , or searches "07700" and misses every E.164-stored colleague. Production currently has 5 mobile_number and 8 phone_number values not starting with '+' alongside 11 and 10 that do.

Fix: Reuse the phoneNumberSchema preprocessor from src/services/employees.ts in PersonalSectionSchema so onboarding normalises to E.164, and backfill the 13 existing raw values.

**P046. Onboarding token replays the employee's unmasked NI number and bank account with no re-authentication**

`src/app/actions/employeeInvite.ts:879` | `pii-exposure` | CONFIRMED

getOnboardingSnapshot returns bank_account_number, bank_sort_code and ni_number in full to any holder of the URL token, and the onboarding token is not consumed when the employee creates their account, so the link keeps working for its full 7-day life even after a password exists. An employee completes the Financial step on day 1 and creates their password. link_employee_invite_account only sets completed_at for the portal_access branch, so the onboarding token stays valid. For the next 7 days anyone who obtains that URL (forwarded email, the manager CC, browser history on a shared pub terminal, a synced-history device) can load /onboarding/<token> and read back the employee's full bank account number, sort code, NI number and every health answer, with no login prompt.

Fix: Once an account exists for the invite (hasAuthUser), require a logged-in session for getOnboardingSnapshot/saveOnboardingSection, or return masked values for ni_number and bank_account_number and only accept new values on write.

**P047. Starter-pack PDF hands the NI number to view-only users the UI deliberately redacts it from**

`src/app/api/employees/[employee_id]/starter-pack/route.ts:103` | `missing-permission-check` | CONFIRMED

The starter-pack PDF endpoint is gated only on employees.view, yet it reads employee_financial_details and renders the NI number, date of birth and home address, while getEmployeeDetailData deliberately withholds financial and health data from anyone who only holds employees.view. A user in the seeded `staff` role (employees:view + employees:view_documents, no edit) opens any employee record. The Financial tab is empty because employeeDetails.ts redacts it, but the 'New Starter PDF' button is rendered unconditionally for non-onboarding employees, and hitting /api/employees/<id>/starter-pack returns a PDF containing that employee's NI number, DOB and address, plus their right-to-work document appended.

Fix: Gate the NI/financial section of the starter pack on the same condition employeeDetails.ts uses (employees.edit today, a dedicated view_financial permission ideally), and hide the button when the viewer lacks it.

**P048. Every modal in the Employees section renders a fully opaque grey backdrop on Tailwind v4**

`src/components/features/employees/EmployeeStatusActions.tsx:120` | `design-system` | CONFIRMED

Six modals in this section use the Tailwind v3 utility bg-opacity-75, which was removed in Tailwind v4 (the project runs tailwindcss 4.3.0), so the backdrop resolves to a solid bg-gray-500 wall instead of a 75% overlay. A manager clicks "Begin Separation", "Mark as Former", "Delete Employee", "Invite", or a contact/attachment delete. The page behind the dialog is completely blanked out by an opaque grey sheet rather than dimmed, so all context (which employee, which contact, which file) disappears and the dialog looks like a broken full-screen state.

Fix: Replace `bg-gray-500 bg-opacity-75` with the v4 slash syntax `bg-gray-500/75`, or replace these bespoke dialogs with the @/ds Modal primitive already used by QuickAddNoteSheet.

**P049. An expired Right to Work document is shown as "Expiring Soon" with future-tense copy**

`src/components/features/employees/RightToWorkTab.tsx:90` | `misleading-copy` | CONFIRMED

isExpiringSoon is true for any expiry date at or before today+30, including dates already in the past, so an expired document renders a yellow "Document Expiring Soon" banner saying it "expires on <a date in the past>" and to act "before expiry". There is no expired state anywhere in the app. An employee's passport expired on 2025-11-12. A manager opens the Right to Work tab and sees a yellow warning: "Document Expiring Soon , This document expires on 12 November 2025. Please obtain updated documentation before expiry." Nothing tells them the document is already invalid and the employee should not be working. Two rows in production already have document_expiry_date < current_date (272 and 9 days past). Compounding this, a repo-wide grep shows no cron, dashboard tile or list view reads employee_right_to_work at all, so the only signal for an expired or follow-up-due document is this one mis-worded banner on a tab someone has to open manually.

Fix: Add a distinct isExpired branch (expiry < today) rendering a red "Right to Work Expired" banner in past tense, and add a document-expiry sweep (cron or employees-list column) so expiring/expired documents surface without opening each record.

**P050. Onboarding and portal password-setup links are CC'd to a shared manager mailbox**

`src/lib/email/employee-invite-emails.ts:121` | `credential-disclosure` | CONFIRMED

Every email that carries a live invite token, including the portal_access link whose sole function is to set a password on the employee's login, is CC'd to MANAGER_EMAIL, so an authentication credential for a named individual is delivered to a shared inbox. sendPortalInvite emails an employee a /onboarding/<token> link and CCs manager@the-anchor.pub. Anyone with access to that shared mailbox can open the link within the 7-day window and call createEmployeeAccount to set a password of their choosing on an auth account bound to the employee's email address, then sign in as that employee. For an onboarding invite the same token also replays the employee's saved NI number and bank account through getOnboardingSnapshot.

Fix: Drop MANAGER_EMAIL from the cc list on buildWelcomeEmail, buildChaseEmail and buildPortalInviteEmail; send the manager a separate notification that an invite was sent, containing no token.

**P051. Birthday calendar events use an all-day end date equal to the start date**

`src/lib/google-calendar-birthdays.ts:107` | `external-api-misuse` | CONFIRMED

`syncBirthdayCalendarEvent` builds an all-day Google Calendar event with `end.date` identical to `start.date`. Google treats all-day end dates as exclusive, so this is a zero-length range; the resulting 400 is caught and logged, leaving the team calendar silently without birthdays. A manager creates or edits an Active employee with a date of birth. `EmployeeService.createEmployee`/`updateEmployee` calls `syncBirthdayCalendarEvent`. The insert/update posts `start.date = '2026-05-14'` and `end.date = '2026-05-14'`; Google rejects the empty time range with 400. The outer catch hits the dedicated `errorCode === 400` branch, prints to the server log and returns null, and the calling service comments say "Don't fail employee creation if calendar sync fails". The employee record saves fine, so nobody notices that the shared operations calendar never gains the birthday entry the feature exists to create.

Fix: Set `end.date` to the day after `startDate`, matching `addOneDay()` in google-calendar-notes.ts.

**P052. Edit form lets a manager set "Started Separation" directly, skipping the whole separation flow**

`src/services/employees.ts:439` | `state-machine-violation` | CONFIRMED

`EmployeeService.updateEmployee` guards only transitions to and from `Former`, so the plain edit form can move an Active employee to `Started Separation` without going through `beginSeparation`, which is the only place that sends the separation email, records the last working day and writes the status-change audit entry. A manager opens /employees/<id>/edit, picks "Started Separation" from the Status dropdown and saves. The status changes but `employment_end_date` stays null, the employee is never emailed their separation confirmation and remaining shifts, no separation note is written and no `status_change` audit entry exists. The `employee-separations` cron only picks up rows where `employment_end_date` is not null and in the past, so the employee never gets finalised: they keep their portal login and stay in every staff picker (both `SELECTABLE_EMPLOYEE_STATUSES` and `OPERATIONALLY_ACTIVE_EMPLOYEE_STATUSES` include 'Started Separation') indefinitely.

Fix: Extend the guard so any change into or out of `Started Separation` is refused from the edit form, pointing the manager at the Begin Separation / Mark as Former actions.

**P053. Deleting an employee leaves their documents in storage forever**

`src/services/employees.ts:510` | `orphaned-data` | CONFIRMED

`EmployeeService.deleteEmployee` deletes the `employees` row (cascading the metadata tables) but never removes the employee's objects from the `employee-attachments` bucket, so passport/right-to-work scans and HR documents survive the deletion with no database reference. A manager deletes an employee record , for example to honour an erasure request. The `ON DELETE CASCADE` on `employee_attachments` and `employee_right_to_work` removes the rows that pointed at the files, but the files themselves stay in Supabase Storage under `<employee_id>/…` with no way to find or remove them from the UI. Verified against production: the `employee-attachments` bucket holds 271 objects, 2 of which sit under an employee_id that no longer exists in the `employees` table.

Fix: Before the row delete, list `employee-attachments` under the `<employeeId>/` prefix and `remove()` those paths, logging any failure loudly.

**P054. Deleting an employee never removes their documents from storage**

`src/services/employees.ts:510` | `gdpr-erasure-gap` | CONFIRMED

employee_attachments rows cascade-delete with the employee, but the corresponding objects in the employee-attachments bucket are left behind, so passports, right-to-work scans and signed documents survive an erasure request with no DB row pointing at them. An employee exercises their right to erasure and a manager deletes the record. The employees row and every child row vanish, but their scanned passport or share-code screenshot stays in the employee-attachments bucket indefinitely under a folder named with the now-deleted employee_id. Live production already has 2 objects in that bucket whose folder UUID matches no row in employees, and 12 objects with no employee_attachments row at all.

Fix: Before deleting the employees row, list the storage_paths from employee_attachments and employee_right_to_work.photo_storage_path for that employee and remove them from the bucket, failing the delete if the storage removal errors.

## Customers

**P055. "SMS Active" tab on the customers list does nothing , it is identical to "All"**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:432` | `dead-control` | CONFIRMED

The three tabs are All / SMS Active / Deactivated, but the handler only branches on `deactivated`. Selecting "SMS Active" calls `handleFilterChange(false)`, which is exactly what "All" calls, so the two tabs render the same rows. The tab state is also never initialised from `initialShowDeactivated`. Staff click "SMS Active" expecting to narrow the list to contactable customers. The list does not change at all (same 987 rows, including 266 rows carrying a red "SMS off" badge). Separately, opening /customers?deactivated=1 highlights the "All" tab while showing only deactivated customers.

Fix: Give `getCustomerList` a three-way SMS filter (all / active / deactivated) and seed `tab` from `initialShowDeactivated`.

**P056. 'All' and 'SMS Active' tabs run the identical query, so All hides opted-out customers**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:434` | `misleading-filter` | CONFIRMED

The tab handler only branches on 'deactivated', so selecting 'All' sets showDeactivated=false , the same filter as 'SMS Active' , and the tab labelled All silently excludes every opted-out customer. A manager selects the 'All' tab expecting the complete customer base. The handler calls handleFilterChange(false), the server query applies .neq('sms_status','opted_out'), and the 62 opted-out customers in prod are omitted with no indication. Switching between 'All' and 'SMS Active' produces byte-identical results, so the two tabs are indistinguishable while the header still says '1049 customers' from a separate unfiltered count.

Fix: Replace the boolean showDeactivated with a tri-state filter ('all' | 'active' | 'deactivated') threaded through getCustomerList, and apply no sms_status predicate for 'all'.

**P057. Delete confirmation copy is wrong about what gets destroyed and what actually happens**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:651` | `misleading-copy` | CONFIRMED

The confirm dialog says deleting a customer 'will also delete all their bookings', but the live FKs cascade-delete far more than bookings, and for customers with table/private/parking bookings the delete is blocked and silently converted into an anonymisation that still reports 'Customer deleted successfully'. Staff delete a customer expecting to lose their bookings. If that customer has no table/private/parking booking, the CASCADE FKs also destroy their entire SMS history (messages), their whole consent audit trail (customer_consents), event check-ins, loyalty membership and guest tokens , none of which the warning mentions, and the consent evidence is exactly what the venue needs to defend a marketing complaint. If the customer does have a table/private/parking booking, the DELETE hits a RESTRICT FK, CustomerService silently falls back to anonymizeCustomerForDelete, and the UI still shows 'Customer deleted successfully' even though the row and its bookings still exist under the name 'Deleted Customer'.

Fix: Spell out in the dialog that message history and consent records are destroyed too, and have deleteCustomer return which branch ran so the toast can say 'anonymised (bookings retained)' rather than 'deleted' when the RESTRICT fallback fires.

**P058. Delete-customer confirm text is wrong: it either silently anonymises or wipes message and consent history**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:651` | `misleading-destructive-copy` | CONFIRMED

The confirm dialog says only "This will also delete all their bookings". In reality `messages`, `customer_consents`, `event_check_ins`, `loyalty_members`, `waitlist_entries` and `customer_label_assignments` all cascade-delete, while `table_bookings`, `private_bookings` and `parking_bookings` are ON DELETE RESTRICT , so for any customer with one of those the delete fails and silently falls back to anonymisation, yet the UI still reports "Customer deleted successfully". Staff delete a duplicate customer who has one table booking. The FK RESTRICT fires, `anonymizeCustomerForDelete` rewrites the row to "Deleted Customer" with a synthetic `+447000…` phone and `sms_status='opted_out'`, and the toast says "Customer deleted successfully". The row is still there , it now appears under the Deactivated tab as "Deleted Customer" (there is exactly one such row in production today). Conversely, deleting a customer who only ever had event bookings does succeed and permanently destroys their entire SMS thread and their GDPR consent audit rows, neither of which the dialog mentions.

Fix: Have `deleteCustomer` return which path ran (hard delete vs anonymise) and surface it in the toast, and rewrite the confirm copy to name what is actually destroyed (bookings, full message history, consent audit trail) versus anonymised.

**P059. /customers/insights is an orphan route, so the Win-Back Campaign feature is unreachable**

`src/app/(authenticated)/customers/insights/page.tsx:100` | `dead-navigation` | CONFIRMED

Nothing links to /customers/insights. It is not in the sidebar (`NAV_GROUPS` has a single `/customers` entry) and the /customers list page renders no nav tabs. The insights page itself declares an Overview/Insights nav pair, but the other half of that pair never renders one back, so the page and the Win-Back Campaign card it hosts can only be reached by typing the URL. A manager wants to send a win-back SMS to lapsed customers. The feature exists and works, but there is no link to it anywhere in the app , not from the sidebar, not from the Customers list. The whole insights dashboard and the campaign tool are invisible in normal use.

Fix: Render the same Overview/Insights navItems on the /customers list page (or add an Insights sub-item to NAV_GROUPS) so the route is reachable.

**P060. applyLabelsRetroactively types a void RPC as an array, so the audit always records zero**

`src/app/actions/customer-labels.ts:384` | `wrong-return-type` | CONFIRMED

The apply_customer_labels_retroactively Postgres function is declared RETURNS void, but the action types the result as an array of applied labels and audits data?.length, so the audit trail records applied_badge: 0 on every run regardless of how many labels were applied. A manager runs 'apply labels retroactively'. The RPC applies labels correctly but returns NULL. `data` is null, so the audit_logs entry records `applied_badge: 0` and the action returns `{ data: null }` while its declared type promises `{ customer_id, applied_labels }[]`. Anyone later checking the audit trail to confirm the run had an effect sees zero and concludes it failed, and any UI that iterates the returned array would throw on null.

Fix: Either change the RPC to return the affected rows (or a count) and keep the typed shape, or narrow the TypeScript return type to void/count and audit a value the function actually produces.

**P061. Customers list counts "SMS Active" off sms_status, hiding 266 opted-out customers**

`src/app/actions/customers.ts:90` | `misleading-stat` | CONFIRMED

The list page derives its "SMS Active"/"SMS Deactivated" counts and its Deactivated tab filter from `sms_status <> 'opted_out'`, while every other surface (the row badge, the customer detail page, the bulk-SMS eligibility filter) uses `sms_opt_in`. In production 266 customers have `sms_status = 'sms_deactivated'` with `sms_opt_in = false`, so they are counted and filtered as SMS-active. A manager opens /customers to see who can receive SMS. The header reads "987 customers", the "Total customers" tile reads 987 and the "SMS Active" tile also reads 987 (identical, because both queries apply the same `neq('sms_status','opted_out')` filter). The "Deactivated" tab shows 62. The real number of customers who cannot receive SMS is 328. 266 of them sit in the default/"SMS Active" view showing a red "SMS off" badge on the same row, and opening any of them shows "SMS Inactive" on the profile. Staff planning a send over-estimate reach by 27%.

Fix: Filter and count on the same field the rest of the app sends on (`sms_opt_in`, or `sms_status IN ('active')`), and compute the unfiltered total separately from the tab-filtered count so "Total customers" is not the same number as "SMS Active".

**P062. 266 SMS-deactivated customers are counted as 'SMS Active' and hidden from the Deactivated tab**

`src/app/actions/customers.ts:93` | `wrong-filter-column` | CONFIRMED

The customers list counts and filters on sms_status = 'opted_out' only, but the sms_status enum also allows 'sms_deactivated'; 266 production customers sit in that third state, so they are counted as SMS Active and never appear when staff open the Deactivated tab. A manager opens /customers to see who can still be texted. The 'SMS Active' stat reads 987 and 'SMS Deactivated' reads 62. In reality only 720 customers are sendable: prod has sms_opt_in=true/sms_status='active' 720, sms_opt_in=false/sms_status='sms_deactivated' 266, sms_opt_in=false/sms_status='opted_out' 62, sms_opt_in=false/sms_status='active' 1. The 266 auto-deactivated customers are rendered inside the 'SMS Active' list (with a contradictory red 'SMS off' badge, because the badge reads sms_opt_in while the filter reads sms_status) and cannot be found at all from the Deactivated tab, so nobody can review or reinstate them.

Fix: Treat both 'opted_out' and 'sms_deactivated' as deactivated in the counts and the tab filter (e.g. .in('sms_status', ['opted_out','sms_deactivated']) / .eq('sms_status','active')), and reconcile the row badge to read the same field.

**P063. Customer list pagination orders only by first_name, so rows can repeat or vanish across pages**

`src/app/actions/customers.ts:104` | `nondeterministic-pagination` | CONFIRMED

The paginated query sorts by first_name alone with no unique tiebreaker; Postgres may return tied rows in a different order on each request, so a customer sitting on a page boundary can appear twice or be skipped entirely. Prod has 147 first names shared by more than one customer. With pageSize 50, a run of duplicate first names straddling offset 50 has no stable order between the page 1 request and the page 2 request (each is a separate query, and the client refetches on every filter change). A staff member paging through to find a customer can therefore see the same person on both pages, or never see them at all. The same instability affects the selection checkboxes, which key on ids captured from a previous page render.

Fix: Add a deterministic tiebreaker to the sort, e.g. .order('first_name').order('last_name').order('id'), so range() offsets are stable between requests.

**P064. Customer search never normalises phone numbers, so local-format lookups return nothing**

`src/app/actions/customers.ts:118` | `phone-not-normalised` | CONFIRMED

getCustomerList matches the raw search term against mobile_number with ilike, but every one of the 1049 production customers stores mobile_number in E.164, so searching the number the way a guest reads it out ('07700 900123') finds no one. A guest phones the pub and gives their number as 07700 900123. Staff type it into the Customers search box. The filter becomes `mobile_number.ilike.%07700 900123%`; prod stores '+447700900123' (verified: 1049 rows start with '+', 0 start with '0'), and the space also breaks a substring match, so zero results come back and staff create a duplicate customer record. The repo already has generatePhoneVariants() for exactly this, and the sibling search endpoint uses formatPhoneForStorage before querying.

Fix: When the term looks like a phone number, run it through formatPhoneForStorage/generatePhoneVariants and add equality clauses on mobile_e164 and mobile_number for each variant alongside the existing name/email ilike clauses.

**P065. Unsanitised search term is interpolated into a PostgREST .or() filter string**

`src/app/actions/customers.ts:118` | `query-injection` | CONFIRMED

The raw search term is concatenated into a PostgREST .or() filter without stripping the comma, parenthesis and quote characters that delimit that syntax, so a term containing a comma either breaks the query or injects an extra OR condition. Staff paste 'Smith, John' (or any name with a comma or bracket) into the Customers search box. The filter string becomes `first_name.ilike.%Smith, John%,last_name.ilike.%Smith, John%,...`; PostgREST treats the embedded comma as a filter separator, so the request either 400s and the page shows 'Failed to load customers', or it evaluates a filter the user never asked for. A crafted term such as `x%,sms_opt_in.eq.false` appends an arbitrary predicate to the OR group, silently changing which customers are returned.

Fix: Reuse the same normalizeSearchTerm() sanitiser (strip , % _ ( ) " ' \\ and cap length) before building the filter string, or switch to a textSearch/RPC that takes the term as a bound parameter.

**P066. Customer search cannot find a UK number typed as 07…, and a comma in the search term breaks the query**

`src/app/actions/customers.ts:118` | `broken-search` | CONFIRMED

The list search interpolates the raw term into a PostgREST `.or()` filter and matches `mobile_number` with a plain ilike. Phone numbers are stored E.164 (`+44…`) so searching the number as printed on a booking (07700900123) never matches, and an unescaped comma or parenthesis in the term produces a malformed filter string that makes the whole query fail. A guest phones the pub and reads out "07700 900123". Staff paste it into the customer search and get "No customers found", even though the customer exists as +447700900123 , 1001 of 1049 customers are stored with a +44 prefix and none with a 07 prefix. Separately, searching "Smith, John" splits the or-list on the comma, PostgREST rejects the filter, and the action returns `{ error: 'Failed to load customers' }` with an empty list plus a generic error toast.

Fix: Route digit-looking terms through `generatePhoneVariants()` (as vouchers.ts does) and strip `% _ , ( )` from the term before building the `.or()` string.

**P067. Win-Back preview count overstates the real audience because the send applies extra filters**

`src/app/actions/customers.ts:603` | `misleading-count` | CONFIRMED

`sendWinBackCampaign`'s dry run counts customers on `sms_opt_in === true` plus a usable phone. The live send goes through `sendBulkSms`, which additionally requires `marketing_sms_opt_in === true` and `sms_status === 'active'`. The preview number shown to the manager, and repeated in the confirm dialog, is therefore higher than the number who actually get a message. A manager previews a 6-month win-back campaign. The blue box says "This campaign will send to 355 customers" and the confirm dialog repeats 355. On the live production data only 307 of those pass the bulk-SMS eligibility filter, so the result toast reads "Campaign sent to 307 customers" , a 14% shortfall with no explanation. If the marketing opt-in population were smaller the send would return "No customers eligible for marketing SMS" and the campaign would fail outright after the manager confirmed an irreversible action.

Fix: Apply the same `marketing_sms_opt_in` and `sms_status = 'active'` predicates in the dry-run filter so preview and send agree.

**P068. Win-back preview overstates the recipient count because it ignores marketing consent and sms_status**

`src/app/actions/customers.ts:608` | `preview-vs-send-mismatch` | CONFIRMED

sendWinBackCampaign's dry run counts customers on sms_opt_in plus a phone number, but the actual dispatcher additionally requires marketing_sms_opt_in = true and sms_status = 'active', so the confirmation dialog quotes a number the send can never reach. A manager picks '6 months', clicks Preview and sees 'This campaign will send to 355 customers'. The ConfirmDialog repeats 355. On send, sendBulkSms filters again on marketing_sms_opt_in and sms_status and only 307 pass (verified against prod for a 6-month cutoff: 355 vs 307). The toast then reports 'Campaign sent to 307 customers' with no explanation of the 48 that vanished, and the audit log records eligible_count: 355 against sent: 307. If marketing consent were ever lower, the send would fail outright with 'No customers eligible for marketing SMS' after the manager confirmed a large number.

Fix: Apply the identical predicate in both places , extend the dry-run filter with marketing_sms_opt_in === true and (sms_status === null || sms_status === 'active'), ideally by extracting one shared eligibility function used by the preview and by sendBulkSms.

**P069. Full customer message history gated on customers.view, not messages.view**

`src/app/actions/customerSmsActions.ts:140` | `wrong-permission-module` | CONFIRMED

`getCustomerMessages` and `getCustomerSmsStats` check `customers.view` and then read via `MessageService`, which uses the service-role client. Any role with `customers.view` but without `messages.view` gets the complete SMS and email conversation for any customer id. A user with the live `Deputy` role (customers.view = true, messages.view = false) opens `/customers/<any-id>`. The page calls `loadMessages()` unconditionally, `getCustomerMessages` passes the `customers.view` check, `MessageService.getCustomerMessages` reads with `createAdminClient()`, and the Messages card renders the whole thread. The role's deliberate exclusion from the messages module is silently ignored.

Fix: Require `messages.view` (in addition to `customers.view`) in `getCustomerMessages`/`getCustomerSmsStats`, and skip the message load in the detail page when `canViewMessages` is false.

**P070. GDPR erasure can never reach an actual customer**

`src/app/actions/gdpr.ts:99` | `gdpr-erasure-gap` | CONFIRMED

`deleteUserData` resolves the erasure target by looking the confirmation email up in `profiles`, which only holds staff auth accounts. No pub customer has a `profiles` row, so a customer's right-to-erasure request always returns 'No user found with that email' and nothing is erased. `exportUserData` has the same profile-rooted identity, so subject access requests fail the same way. A guest emails asking to be forgotten. A super_admin opens /settings/gdpr, types the guest's email and confirms. `adminClient.from('profiles').select('id, email').eq('email', confirmEmail).single()` returns nothing, the action returns `{ error: 'No user found with that email' }`, and the guest's name, phone, email, notes and message history all remain. The operator sees a generic error and has no working path to comply.

Fix: Add a customer-rooted erasure path that resolves the subject from `customers` by normalised email and by E.164 phone variants, and treat the `profiles` lookup as optional rather than the entry condition.

**P071. Customer PII lookup API accepts read:events instead of read:customers**

`src/app/api/customers/lookup/route.ts:77` | `wrong-permission-scope` | CONFIRMED

`GET /api/customers/lookup` returns a customer's name, email and both phone formats to any API key holding `create:bookings` OR `read:events`, even though a dedicated `read:customers` scope exists and is offered in the API-key UI. No route in the codebase enforces `read:customers`. The live `cheersai` API key is scoped to `['read:menu','read:events','payments:capture']` and was last used today. Its holder calls `/api/customers/lookup?phone=07700900123` and receives `{first_name, last_name, full_name, email, mobile_e164, mobile_number}` for that customer, plus, on the legacy fallback path, a private booking's `contact_email`. Two other active keys (`1c80c23c`, `3cf3f43f`) have the same `read:events`-only exposure. Iterating UK mobile ranges at the key's 1000/hr rate limit enumerates the customer base.

Fix: Change the check to require `read:customers` (or `*`), and remove `read:events` from the accepted set; re-issue the website key if it needs the scope added.

**P072. CSV upload rejects valid .csv files on MIME type and splits rows on bare commas**

`src/components/features/customers/CustomerImport.tsx:127` | `import-parsing` | CONFIRMED

The upload handler hard-rejects anything whose `File.type` is not exactly `text/csv` , Chrome on Windows reports `application/vnd.ms-excel` for .csv when Excel is installed, and some browsers report an empty string. Rows are then parsed with a naive `line.split(',')`, so any quoted field containing a comma shifts every subsequent column. A manager exports customers from Excel and picks the file (the `accept=".csv"` dialog allows it). They get "Please upload a CSV file" and no way forward. If they get past that, a row like `"Smith, Jr",John,07700900123` is split into four wrong fields , the mobile column receives an empty string and the row is silently rejected as "Mobile number is required", or worse a name fragment lands in the phone column.

Fix: Validate on the filename extension rather than `File.type`, and parse with the existing `papaparse` dependency instead of `split(',')`.

**P073. CSV import shows "Customers imported successfully!" even when the import failed**

`src/components/features/customers/CustomerImport.tsx:195` | `misleading-feedback` | CONFIRMED

`CustomerImport.handleImport` fires a success toast unconditionally after `onImportComplete` resolves, but the parent's `handleImportCustomers` swallows every failure , it shows an error toast and returns normally rather than throwing. On the success path both components toast, so the user gets two contradictory or duplicated messages. A manager imports 40 customers. The server action returns `{ error: 'Insufficient permissions' }`. The parent shows a red "Insufficient permissions" toast, then CustomerImport shows a green "Customers imported successfully!" toast, the import screen stays open, and nothing was created. On a successful import the user instead sees "Imported 12 customers (28 skipped)" and "Customers imported successfully!" stacked.

Fix: Have `onImportComplete` return a result (or rethrow on failure) and let only one of the two components own the toast.

**P074. SMS at-risk detection excludes the 49 customers whose every message failed**

`src/lib/analytics/customer-insights.ts:317` | `inverted-boundary` | CONFIRMED

isSmsAtRisk guards the delivery-rate test with `deliveryRate > 0`, so a customer with a 0% delivery rate , every message they were ever sent failed , falls straight through as healthy, while a customer at 84% is flagged. The Customer Insights page reports 'SMS deliverability risk'. In prod 49 opted-in customers have sent messages and a delivery_rate of exactly 0 and are not caught by any other clause (messaging_status, consecutive_failures >= 2, total_failures_30d >= 3) , verified: 49 rows satisfy `sms_opt_in AND total_messages_sent > 0 AND delivery_rate = 0 AND NOT at_risk`. Meanwhile only 30 customers are flagged. The dashboard therefore reports the healthiest possible reading for the worst cohort and the 'sms_health_risk' strategic signal is calibrated on the wrong denominator.

Fix: Distinguish 'no messages' from 'nothing delivered' by testing total_messages_sent (or messages_delivered) rather than using deliveryRate > 0 as the has-data proxy: flag when total_messages_sent > 0 && deliveryRate < 85.

**P075. GDPR erasure only reaches customers whose email matches a staff profile , zero today**

`src/services/gdpr.ts:416` | `gdpr-erasure-unreachable` | CONFIRMED

deleteUserData resolves the target from the profiles table and then finds customers only by an exact profiles.email match, so a customer erasure request for anyone who is not also a staff account, or who has no email on file, silently anonymises nothing and still reports success. A guest emails asking to be erased. A super admin enters their address on /settings/gdpr. `adminClient.from('profiles').select('id, email').eq('email', confirmEmail).single()` finds no row (customers do not have profiles rows), so the action returns 'No user found with that email' and the erasure never happens. Even for an address that does exist in profiles, `customers ... .eq('email', email)` currently matches nothing: verified in prod, `select count(*) from profiles p join customers c on lower(c.email)=lower(p.email)` returns 0, and 778 of 1049 customers have no email at all so could never be matched by this path. The success message 'User communication data anonymized. Customers: 0, ...' reads as a completed erasure.

Fix: Add a customer-first erasure entry point that resolves the target by customer id or normalised E.164 phone (via generatePhoneVariants) as well as email, and make the result message state explicitly when zero customer records were matched rather than implying completion.

**P076. GDPR erasure leaves customer PII in parking, private and pending booking tables**

`src/services/gdpr.ts:480` | `gdpr-erasure-gap` | CONFIRMED

`GdprService.deleteUserData` anonymises `customers`, `messages`, `email_messages`, `customer_consents`, `unmatched_communications` and `webhook_logs`, but never touches the denormalised name, email and phone columns on `parking_bookings`, `private_bookings` or `pending_bookings` , tables the same service's export explicitly identifies as holding the subject's data. An erasure completes and reports success. The customer's row now reads 'Erased Customer', but `private_bookings.customer_name`, `contact_email`, `contact_phone` and `internal_notes` still hold their real identity, as do `parking_bookings.customer_first_name`, `customer_last_name`, `customer_email`, `customer_mobile` and `vehicle_registration`, and `pending_bookings.mobile_number`. Any staff member browsing private bookings or parking still sees the erased person by name and can call them.

Fix: Extend `deleteUserData` to null or pseudonymise the denormalised identity columns on parking_bookings, private_bookings, table_bookings and pending_bookings for the matched customer ids, in the same transaction batch as the customers update.

**P077. Any authenticated user can read and insert every customer SMS message**

`supabase/migrations/20251123120000_squashed.sql:4708` | `missing-permission-check` | CONFIRMED

The `messages` table RLS grants SELECT and INSERT to every authenticated user with no permission predicate, so accounts deliberately denied `messages.view` (foh_staff kiosk, Deputy) can read every customer's SMS conversation straight from the browser Supabase client and can forge inbound message rows. The shared FOH iPad account (role `foh_staff`, which holds no `messages` permission and no `customers.view`) opens the browser console on any authenticated page and runs `supabase.from('messages').select('*')`. RLS evaluates `auth.uid() IS NOT NULL`, which is true, so it returns the full body of every SMS ever exchanged with every customer. The same account can INSERT arbitrary rows into `messages`, fabricating a customer conversation.

Fix: Replace the `messages` policies with `user_has_permission(auth.uid(), 'messages', 'view')` for SELECT and restrict INSERT to service_role, then audit the rest of the `linted_tables` array in 20260708000009 for the same pattern.

**P078. Any authenticated user can read every parking booking including vehicle registrations**

`supabase/migrations/20251123120000_squashed.sql:12949` | `missing-permission-check` | CONFIRMED

`parking_bookings` SELECT is open to all authenticated users with `USING (true)`, while INSERT and UPDATE on the same table correctly require `parking.manage`. Vehicle registrations and denormalised customer contact details are readable by accounts with no parking permission at all. The FOH kiosk account, or any staff member without a parking grant, opens `/customers/<id>`; the client component queries `parking_bookings` directly with the browser client and the read succeeds. More broadly, that account can run `supabase.from('parking_bookings').select('*')` and pull every registration plate, `customer_email` and `customer_mobile` the venue holds.

Fix: Change the read policy to `user_has_permission(auth.uid(), 'parking', 'view') OR user_has_permission(auth.uid(), 'parking', 'manage')`, matching the write policies.

**P079. 'New Customer' auto-label is never removed , 514 of 631 assignments are stale**

`supabase/migrations/20260216212500_fix_booking_logic.sql:72` | `stale-auto-label` | CONFIRMED

apply_customer_labels_retroactively only ever INSERTs labels; the time-bounded 'New Customer' rule (created within 30 days) has no matching delete, so once applied the badge sticks forever and now sits on the majority of the customer base. The apply-customer-labels cron runs; every customer created in the last 30 days gets 'New Customer'. Nothing ever removes it once they age past 30 days. Prod today: 631 'New Customer' assignments, 514 of which belong to customers whose created_at is older than 30 days. Staff filtering or segmenting on 'New Customer' in the customers list therefore target a group that is 81% wrong, and the same non-expiry applies to 'At Risk' (15 assignments) which stays attached after a customer starts booking again.

Fix: Add a reconciliation step to the same function that deletes auto_assigned rows whose rule no longer holds (New Customer past 30 days, At Risk once a recent booking exists), scoped to auto_assigned = true so manual labels survive.

## Messages

**P080. Three hand-rolled SMS segment counters in the UI contradict the canonical counter used at send time**

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:108` | `misleading-copy` | CONFIRMED

MessagesClient, BulkMessagesClient and MessageGuestsModal each define their own countSmsSegments that divides by 160/70 and ignores multipart limits and GSM-7 extended characters, while src/lib/twilio.ts normalises the body and measures it with the correct src/lib/sms/gsm7.ts. The composer therefore both under-reports and over-warns. Under-report: staff compose a 320-character plain-ASCII bulk message. The composer says "2 SMS segments". At send time countSmsSegments in gsm7.ts uses the 153-septet multipart limit and bills 3 , 50% more than quoted, across every recipient. Same class of error for any message containing GSM-7 extended characters ([ ] { } ~ | ^ \ €), which cost two septets each and the UI counts as one. Over-warn: staff paste a 90-character line containing one curly apostrophe. The UI flags a "Unicode" badge and 2 segments, so they rewrite the message , but src/lib/twilio.ts:435 runs normaliseToGsm7 first, which substitutes U+2019 for a straight quote, and the real cost was 1 GSM segment all along.

Fix: Delete the three local copies and import countSmsSegments/normaliseToGsm7/isGsm7 from '@/lib/sms/gsm7', running the text through normaliseToGsm7 before counting so the composer quotes what will actually be billed.

**P081. Opening a conversation auto-marks it read, and Mark unread can only restore one message**

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:257` | `broken-core-flow` | CONFIRMED

Selecting a conversation (including the automatic selection of the first unread on page load) immediately marks the whole conversation read, and markConversationUnread only un-reads the single most recent inbound row, so the original unread count can never be restored. The "Mark read" button is consequently a no-op with no feedback. A customer sends three messages overnight. Staff open Messages; the effect at line 251-255 auto-selects that first-unread conversation and the effect at 257-261 fires markConversationAsRead before anyone has read anything , all three are marked read and the badge drops to zero. Realising they cannot deal with it now, staff click "Mark unread"; CommunicationsService.markConversationUnread selects a single row with .limit(1).maybeSingle() and clears read_at on just that one, so the conversation comes back as "1 unread" instead of 3. Separately, the "Mark read" button next to it re-runs the same already-completed operation and shows no toast, so it appears permanently broken.

Fix: Only auto-mark-read on an explicit user click (not the auto-selection on mount), have markConversationUnread clear read_at for every inbound row after the last outbound one, and drop the redundant "Mark read" button or give it a success toast.

**P082. Add logAuditEvent to the SMS send paths , no record of who texted whom**

`src/app/actions/bulk-messages.ts:73` | `missing-audit-log` | CONFIRMED

None of the outbound SMS server actions write an audit event: sendBulkMessages, sendBulkSMSDirect, sendBulkSMSAsync, enqueueBulkSMSJob, sendSms and sendSmsReply all mutate state and spend money with no logAuditEvent() call, so there is no record of which staff member authorised a campaign or an individual reply. A staff member with messages:send_marketing selects 100 customers and fires a bulk campaign. Every recipient gets a text and the Twilio bill lands, but audit_logs contains nothing. If the campaign contained a mistake, breached consent, or was sent maliciously, there is no server-side record of who triggered it , messages rows record the recipient and body but not the acting user.

Fix: Add a logAuditEvent call at the end of sendBulkMessages, sendSms and sendSmsReply recording user_id, recipient count or customer_id, template_key, and the sent/failed tallies, following the shape already used in table-booking-messages.ts.

**P083. Bulk send reports every selected recipient as sent and discards the do-not-retry warning**

`src/app/actions/bulk-messages.ts:100` | `wrong-result-reporting` | CONFIRMED

sendBulkMessages throws away the real per-recipient outcome from sendBulkSMSDirect and returns `sent: customerIds.length`, so staff are told every selected customer was texted even when most were skipped as ineligible, failed, or the batch aborted on a logging failure. A manager selects 80 customers and sends. lib/sms/bulk.ts filters out everyone without `marketing_sms_opt_in === true` (say 55 of them) and actually sends 25. sendBulkSMSDirect returns `{ success: true, sent: 25, failed: 0 }`. sendBulkMessages ignores that and returns `sent: 80`, and the UI toasts "80 messages sent successfully". Worse: when the batch aborts because outbound logging broke, sendBulkSMSImmediate returns `{ success: true, message: 'Bulk SMS aborted because outbound message logging failed after sends may have occurred. Do not retry...', code: 'logging_failed' }` , there is no `error` key, so the `'error' in result` check passes and the operator sees "80 messages sent successfully" instead of the explicit do-not-retry warning, inviting a retry that double-texts customers.

Fix: Propagate `sent`, `failed`, `skipped`, `code` and `message` from sendBulkSMSDirect through SendBulkResult, and treat a `logFailure`/`code === 'logging_failed'` response as a blocking warning in the client rather than a success.

**P084. importMissedMessages can never import anything: ON CONFLICT targets a partial unique index**

`src/app/actions/import-messages.ts:450` | `broken-upsert` | CONFIRMED

Both upserts specify a conflict target whose only matching unique index is partial (`WHERE ... IS NOT NULL`), which Postgres refuses to infer, so every run that has new messages or new placeholder customers fails with SQLSTATE 42P10. An admin opens /settings/import-messages to recover messages Twilio delivered while the webhook was down, picks a date range, and clicks import. As soon as at least one placeholder customer is needed the customers upsert raises 42P10 and the action returns "Failed to create placeholder customers"; if no new customers are needed, the messages upsert raises 42P10 and it returns "Failed to import messages: there is no unique or exclusion constraint matching the ON CONFLICT specification". The recovery tool is unusable and no messages are ever backfilled.

Fix: Either add a non-partial unique constraint, or stop using upsert here: filter out existing SIDs (already done at line 218) and plain-insert, catching 23505 per row; same for the placeholder customers.

**P085. SMS reconciliation cron is head-of-line blocked by permanently stuck messages**

`src/app/api/cron/reconcile-sms/route.ts:163` | `stalled-backlog` | CONFIRMED

The cron always selects the 50 oldest outbound rows still in queued/sent and skips any whose Twilio status is unchanged, so rows that will never change status occupy the window forever and newer stuck messages are never reconciled. Production currently holds 109 outbound rows with status queued/sent, every one of which has `twilio_status` equal to its app status (97 sent/sent, 12 queued/queued), the oldest from 2025-07-06. Each run fetches the 50 oldest, Twilio returns the same status, `if (message.twilio_status === newStatus) continue` fires, nothing is written, and the next run selects the identical 50. The 59+ newer stuck messages, including one from 2026-08-09, are never looked at, so genuinely unresolved deliveries are never marked delivered or failed and customer sms_delivery_failures counters are never updated.

Fix: Record a `last_reconciled_at` (or a bounded attempt count) on each row and order by that ascending, and/or cap reconciliation to messages younger than Twilio's retention window so ancient unresolvable rows are retired to a terminal state instead of being re-polled forever.

**P086. Inbound STOP from an unmatched number is never applied, even after a staff member links it**

`src/app/api/webhooks/twilio/route.ts:627` | `opt-out-not-honoured` | CONFIRMED

When the inbound phone number does not resolve to exactly one customer, the webhook records an unmatched_communications row and returns before the STOP/opt-out keyword block ever runs; linking the message from the holding queue later inserts the message but never re-applies the opt-out. Someone texts STOP from a number that is not yet in `customers` (or that matches two customer rows, in which case findCustomerByPhone deliberately returns null). The webhook stores the text in the holding queue and returns success at line 653, so the opt-out block at 703-796 never executes. A staff member later links that message to the right customer from /messages/holding; linkUnmatchedCommunication inserts a `messages` row and marks the queue entry 'linked' but performs no keyword handling. The customer stays `sms_opt_in = true` / `marketing_sms_opted_out_at = null` and keeps receiving promotional and transactional texts after explicitly texting STOP. For a brand-new number the same applies once the number is created as a customer, because ensureCustomerForPhone inserts `sms_opt_in: true, sms_status: 'active'`.

Fix: Run the STOP/NOEVENTS keyword evaluation before the unmatched early-return (recording the intent on the unmatched row), and re-apply it inside CommunicationsService.linkUnmatchedCommunication when the linked body matches an opt-out keyword.

**P087. Holding-queue depth alert filters on a status value the table cannot hold**

`src/lib/communications/monitoring.ts:113` | `dead-monitoring-check` | CONFIRMED

runCommunicationsHealthCheck counts unmatched_communications rows with `status = 'pending'`, but the table's CHECK constraint only permits unmatched/linked/ignored/deleted, so holdingQueueDepth is always 0 and the alert can never fire. Inbound customer texts stop matching customers (for example after a phone-format regression) and the holding queue fills with 200 unread messages. The communications-monitor cron computes holdingQueueDepth = 0 because no row ever has status 'pending', so the depth never reaches the default threshold of 20, no alert email is sent, and the backlog of unanswered customers goes unnoticed.

Fix: Change the filter to `.eq('status', 'unmatched')` so the depth metric reflects the real queue.

**P088. The inbox polls roughly 800 kB of full view rows every 15 seconds per open tab**

`src/services/communications.ts:139` | `performance` | CONFIRMED

getInbox issues two select('*') scans over the customer_communications UNION view (250 recent + 500 unread) and getCustomerTimeline issues a third unbounded one, all re-run on a 15-second interval with no visibility guard, to populate a UI that only uses body_text, subject, channel, direction, created_at and status. A manager leaves Messages open on the FOH iPad for a shift. Every 15 s the app runs three queries. EXPLAIN ANALYZE of the recent query on production shows a full seq scan of `messages` (7,996 rows) plus a full GroupAggregate over message_delivery_status (7,431 rows) before the top-N sort , 109 ms and 7,075 shared buffers to return 250 rows. The 250-row payload alone serialises to 377 kB of JSON including body_html and delivery_history, and the busiest customer's thread is another 435 kB. That is roughly 3 MB/minute per open tab, 5,760 query triples per 8-hour shift, for a screen showing 90-character previews.

Fix: Replace select('*') with an explicit column list (drop body_html and delivery_history), paginate the customer timeline, and pause the interval when document.visibilityState !== 'visible'.

**P089. Scrub phone numbers on erasure , messages.from_number/to_number and sms_promo_context survive**

`src/services/gdpr.ts:456` | `gdpr-erasure-gap` | CONFIRMED

Both the erasure path and the 24-month retention sweep anonymise messages.body and null the attachments, but never touch from_number or to_number, so the customer's E.164 mobile stays in the messages table indefinitely. sms_promo_context.phone_number, which holds the mobile of everyone sent a cross-promotion, is not referenced by GdprService at all. A customer exercises their right to erasure. The service anonymises their customers row (mobile_number becomes 'erased-<uuid>') and rewrites every message body to '[erased under GDPR request]'. Their actual mobile number remains in messages.to_number on every row and in sms_promo_context.phone_number, so the pub still holds and can still re-identify the individual it has certified as erased.

Fix: Add from_number/to_number (and message_sid where it embeds nothing else) to the messages update payload in both deleteUserData and runCommunicationRetentionCleanup, and add an sms_promo_context sweep keyed on the same identity.phones set already built by buildCommunicationIdentity.

**P090. Lock down message_templates RLS , anon can read it and any staff login can rewrite it**

`supabase/migrations/20251123120000_squashed.sql:4991` | `privilege-escalation` | CONFIRMED

message_templates carries a SELECT policy with USING (true) plus a SELECT grant to anon, so all 15 templates are readable unauthenticated, and a FOR ALL policy gated only on auth.role()='authenticated' lets any logged-in staff insert, update or delete templates directly through PostgREST, bypassing the messages:manage_templates check the app enforces. A staff account with no messages permissions at all (16 of 20 profiles return false for user_has_permission(id,'messages','manage_templates')) uses their session JWT to PATCH /rest/v1/message_templates?id=eq.<id> and rewrite the content of a customer-facing template, or DELETE it outright. Separately, anyone with the public anon key can GET /rest/v1/message_templates and read the pub's entire SMS copy library without logging in.

Fix: Drop both policies and replace with SELECT/ALL predicates keyed on public.user_has_permission(auth.uid(),'messages','manage_templates'), and REVOKE SELECT on message_templates from anon.

## Parking

**P091. Booking filters are passed as CardHeader children, so they render inline and get clipped**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:549` | `ds-cardheader-trap` | CONFIRMED

The search box and two filter selects are passed as CardHeader children rather than being placed in CardBody. CardHeader's root is a non-wrapping flex row that renders children as a third flex item after the title and the action, so the mt-3 is inert and the filters sit inline beside the Refresh button. Card has overflow-hidden, so on a narrow column the controls are cut off rather than wrapping or scrolling. On an iPad in portrait the bookings card sits in the 1fr track of a md:grid-cols-[1fr_320px] grid. The header row must fit the title, the Refresh button, a fixed w-64 (256px) SearchInput and two selects on one line that cannot wrap. Card's overflow-hidden clips whatever does not fit, so the payment-state filter (and potentially the status filter) is unreachable and there is no horizontal scroll to recover it.

Fix: Move the filter row out of CardHeader into the top of CardBody (or a dedicated toolbar div above the table) so it occupies its own wrapping row.

**P092. The Edit modal's "Bypass capacity check" toggle is wired to nothing**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:959` | `dead-control` | CONFIRMED

The edit form renders the same 'Bypass capacity check' switch and required 'Capacity override reason' textarea as the create form, but updateParkingBookingDetails never calls checkParkingCapacity at all. The toggle only writes a flag to the row; it changes no behaviour on the edit path, and the required reason field is collected for nothing. A manager moves a booking to a fully booked week. Because the edit path never checks capacity, the move always succeeds. If the manager leaves the toggle off, expecting the system to stop an oversell, nothing stops it. If they turn it on and are forced to type a justification, that justification records a decision the system never actually made.

Fix: Either call checkParkingCapacity in updateParkingBookingDetails (passing ignoreBookingId: bookingId) so the toggle means something, or remove the switch and reason field from the Edit modal.

**P093. A processed refund leaves the parking screen showing stale data**

`src/app/(authenticated)/parking/_components/RefundDialog.tsx:94` | `missing-revalidation` | CONFIRMED

After a successful refund the dialog calls router.refresh(), but ParkingClient loads its bookings client-side through a server action in useEffect, so router.refresh() only re-runs page.tsx (which returns permission flags). The bookings list, the detail panel and the refund history table all keep their pre-refund values with no way to tell the refund landed. A super_admin refunds GBP 15 on a paid booking. The toast says 'Refund of £15.00 processed successfully', the dialog closes, and the detail panel still shows Payment: paid with no refund row in the Refund History card. Clicking Refresh reloads the bookings list but RefundHistoryTable's useEffect depends only on [sourceType, sourceId], neither of which changed, so the refund still does not appear. The staff member cannot confirm the refund happened and may run it a second time.

Fix: Give RefundDialog an onSuccess callback and have ParkingClient re-run fetchBookings plus remount RefundHistoryTable (e.g. bump a key) when it fires, instead of relying on router.refresh().

**P094. Payment-link failure is swallowed and the staff member is told the booking succeeded**

`src/app/actions/parking.ts:183` | `error-swallowing` | CONFIRMED

createParkingBooking wraps the PayPal order creation and the payment-request SMS in a try/catch that only console.errors, then returns success: true with paymentLink undefined. The UI shows a plain success toast and only mentions the payment link when one exists, so a failed send is indistinguishable from a successful one. A staff member creates a booking with 'Send payment link now' left on (it defaults to true). PayPal is down or createSimplePayPalOrder throws, so the catch logs and swallows it. The action still returns { success: true, booking, paymentLink: undefined }. The screen shows 'Parking booking created successfully' and nothing else. The staff member believes the customer received a pay-now SMS; the customer received nothing, and the booking silently expires at the 7-day payment_due_at.

Fix: Return a paymentLinkError (or a smsSent flag) from createParkingBooking and surface it as a warning toast so staff know to generate the link manually.

**P095. Paid bookings can never be edited: timestamp guard compares PostgREST "+00:00" against client ".000Z"**

`src/app/actions/parking.ts:476` | `timezone-bug` | CONFIRMED

priceAffectingChanged compares existing.start_at/end_at (PostgREST renders timestamptz as "2025-11-03T20:00:00+00:00") with the client-supplied value (Date.toISOString() gives "2025-11-03T20:00:00.000Z"). The strings never match, so the flag is always true and every edit to a paid or refunded booking is rejected. A booking is paid. Staff open Edit and change only the vehicle colour, leaving the dates untouched. The client sends start_at as '2025-11-03T20:00:00.000Z'; the row read back from Supabase holds '2025-11-03T20:00:00+00:00'. The !== comparison is true, so the action returns "Paid parking bookings cannot have price-affecting fields edited" even though nothing price-affecting changed. There is no way to correct a typo on a paid booking.

Fix: Compare the parsed instants (new Date(a).getTime() === new Date(b).getTime()) rather than the raw strings, for both start_at and end_at.

**P096. A fully refunded parking booking keeps status='confirmed' and goes on consuming a parking space**

`src/app/actions/refundActions.ts:267` | `capacity-oversell` | CONFIRMED

updateRefundStatus sets parking_bookings.payment_status='refunded' but leaves status='confirmed'. Both the capacity RPC and the availability builder count bookings with status in ('pending_payment','confirmed'), so a refunded booking permanently blocks a space that should be back on sale. A customer cancels a week-long booking and staff issue a full PayPal refund through the Refund dialog. The booking row becomes payment_status='refunded', status='confirmed'. check_parking_capacity still counts it, so with capacity 10 and 10 such bookings the next genuine customer is told "No parking spaces remaining for the selected period" and the API returns CAPACITY_UNAVAILABLE (409) for a car park that is actually empty.

Fix: On a full refund of a parking payment, also set parking_bookings.status='cancelled' and cancelled_at, or exclude payment_status='refunded' rows from the capacity and availability queries.

**P097. Website bookings with a 30-minute payment window are told the offer "expires tomorrow"**

`src/app/api/cron/parking-notifications/route.ts:543` | `misleading-copy` | CONFIRMED

The day_before_expiry stage fires for any pending booking whose payment_due_at is within 24 hours, but website bookings are given a 30-minute window. Guests receive a "expires tomorrow ... Last chance" SMS minutes before the booking actually dies. A guest books through the website at 16:43; the API route sets payment_due_at to 17:13 (30 minutes). The cron runs at 16:45, computes msUntilDue = 28 minutes which is <= DAY_MS, and sends the day_before_expiry copy: "Your parking offer expires tomorrow ... Last chance". The guest reasonably defers payment, and the booking is expired 28 minutes later.

Fix: Pick the reminder stage from the time remaining relative to the window length (or skip reminders entirely when the window is under a few hours) rather than assuming every window is seven days.

**P098. Parking booking API returns customer PII marked publicly cacheable for 60 seconds with no Vary on the API key**

`src/app/api/parking/bookings/[id]/route.ts:22` | `cache-control-pii` | CONFIRMED

GET /api/parking/bookings/{id} returns the full parking_bookings row (mobile, email, staff notes) through createApiResponse, which stamps every GET with `Cache-Control: public, max-age=60, stale-while-revalidate=120` and a Vary header covering Origin only, not Authorization or X-API-Key. A shared cache on the path (the Vercel Edge Network honours public max-age, as does any corporate proxy) stores the response to GET /api/parking/bookings/<uuid>. For the next 60 seconds a request to the same URL carrying no API key at all can be served that cached body, which contains customer_first_name, customer_last_name, customer_mobile, customer_email, vehicle_registration and the internal notes field. The API key check in withApiAuth is never reached for the cached hit.

Fix: Pass no-store for authenticated PII responses (or add `private` plus `Vary: Authorization, X-API-Key`), and narrow the projection so the endpoint does not return staff-only notes at all.

**P099. PayPal return handler captures payment for bookings the cron has already expired**

`src/app/api/parking/payment/return/route.ts:30` | `state-machine-violation` | CONFIRMED

The public return handler only short-circuits when the booking is already paid+confirmed; it has no cancelled/expired guard (unlike the API capture route), and the expiry cron never touches the payment row, so an expired booking still has a 'pending' payment that captureParkingPayment will happily capture and then flip back to confirmed. A website booking has a 30-minute payment window. The guest clicks Pay at minute 28 and is on PayPal at minute 31 when the cron (which runs */15) sets status='expired', payment_status='expired' , but leaves parking_booking_payments.status='pending'. The guest approves; PayPal redirects to /api/parking/payment/return, which loads the booking, sees it is not paid+confirmed, and calls captureParkingPayment. The payment lookup accepts status 'pending', money is taken, and the booking is rewritten to confirmed , potentially on top of a space that was released and re-sold in the meantime.

Fix: Add the same cancelled/expired guard to the return route, and have the expiry cron mark the associated pending parking_booking_payments row as 'expired' in the same operation.

**P100. PayPal checkout description renders booking times in UTC, not London**

`src/lib/parking/payments.ts:496` | `timezone-bug` | CONFIRMED

payments.ts defines its own local formatDateTime with no timeZone option, shadowing the correct London-aware helper in src/lib/dateUtils. On Vercel (UTC) the PayPal purchase-unit description shows BST bookings an hour early to the paying customer. A guest books 2 June 14:00 to 8 June 14:00 (London, BST). The PayPal checkout page shows "Parking booking PAR-20260602-0001 from 2 Jun 2026, 13:00 to 8 Jun 2026, 13:00", contradicting the SMS and the guest page, which use the London-aware formatter. The guest either abandons the payment or turns up an hour early.

Fix: Delete the local helper and import formatDateTime from '@/lib/dateUtils'.

**P101. PayPal checkout description renders parking times in UTC, not London**

`src/lib/parking/payments.ts:496` | `timezone-bug` | CONFIRMED

payments.ts defines a local formatDateTime that is a copy of the dateUtils helper with the timeZone option removed. It is used to build the PayPal order description the customer reads at checkout, so on Vercel (UTC) the times shown are wrong during British Summer Time. A customer books parking from 14:00 to 18:00 London time in July and clicks the pay link. The PayPal checkout page shows 'Parking booking PAR-... from 12 Jul 2026, 13:00 to 12 Jul 2026, 17:00' because the server formats without a timezone and Vercel runs in UTC. The times are an hour early for seven months of the year, and they contradict the times in the SMS (which uses the correct dateUtils helper) and on the guest page. A developer testing on a London laptop sees the correct times and cannot reproduce it.

Fix: Delete the local helper and import formatDateTime from @/lib/dateUtils.

**P102. GDPR erasure leaves the customer's mobile, email and vehicle registration in parking_bookings**

`src/services/gdpr.ts:402` | `gdpr-erasure-gap` | CONFIRMED

deleteUserData anonymises customers, messages, email_messages, customer_consents, unmatched_communications, webhook_logs and storage, but never touches parking_bookings or parking_booking_notifications. parking_bookings denormalises customer_mobile (NOT NULL), customer_email and vehicle_registration, all of which survive an erasure request. A customer who has used the car park exercises their right to erasure. Their customers row is anonymised to 'Erased Customer' and the name trigger propagates that to parking_bookings, but parking_bookings.customer_mobile still holds their real number, customer_email their real address, and vehicle_registration their VRM, all readable by any staff account. parking_booking_notifications.payload still holds the full SMS text sent to them. 6 of the 9 live parking_bookings rows carry a non-null customer_email today.

Fix: Extend deleteUserData to null or mask customer_mobile, customer_email and vehicle_registration on parking_bookings for the customer's ids, and clear the payload text on parking_booking_notifications for those bookings.

## Private Bookings

**P103. Cancelling from the bookings list skips the preview and understates the consequence**

`src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx:282` | `misleading-confirm` | CONFIRMED

The list row's Cancel button calls `cancelPrivateBooking` with no retention decision and no cancellation capture, behind a confirm dialog that says only that an SMS will be sent , while the detail screen's modal shows the refund/retained amounts, the exact message the customer will get, and requires the SOP §14 channel and received-at. A manager cancels a confirmed booking from the list. They are shown "An SMS will be sent to inform the customer. This action cannot be undone." and nothing about money. They never see that (say) £250 is refundable or that a sub-30-day cancellation needs a retention decision, and the recorded reason is the placeholder "Cancelled from list view". Cancelling the identical booking from the detail page would have surfaced all of it. The Cancel button also only exists in the desktop table branch, so on a phone the row action disappears entirely.

Fix: Either route the list action to the same preview modal used on the detail page, or drop the list-row Cancel button and link through to the booking.

**P104. Edit form's status dropdown cancels the booking and fires the customer cancellation SMS with no confirmation**

`src/app/(authenticated)/private-bookings/[id]/edit/page.tsx:324` | `undisclosed-destructive-action` | CONFIRMED

"Booking Status" is a plain select that accepts `cancelled`, and saving the form routes through `updatePrivateBooking` rather than `cancelPrivateBooking`, bypassing the cancellation preview, the SOP §14 channel/received-at capture and the GM retention decision. The field's help text only mentions the Confirmed transition. A staff member edits a confirmed booking to fix a phone number, brushes the Status select to "Cancelled" without noticing, and clicks Save Changes. The booking is cancelled, `cancellation_reason` is stamped "Cancelled via edit form", pending SMS are cancelled, the calendar event is removed and a cancellation SMS is queued to the customer , all with no confirm step and no indication in the UI that a message was about to go out. Doing the same thing from the detail screen's Update Status modal would have shown the refund/retention outcome, required a manager retention decision and captured how the cancellation was received.

Fix: Remove `cancelled` (and `completed`) from the edit form's status options and route those transitions through the detail page's Update Status modal, or at minimum gate the save behind the same preview/confirm and correct the help text.

**P105. Two divergent implementations of the Add Item and Edit Item modals**

`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:135` | `duplicate-implementation` | CONFIRMED

The booking Overview tab and the Items tab each ship their own AddItemModal and EditItemModal. Both are live and reachable from the same tab bar, and they behave differently on pricing, validation and error reporting. Staff get different results for the same task depending on which tab they used. The Overview copy has an "Electricity" preset (stored as item_type `other`, fixed £25) that the Items copy lacks entirely; the Items copy hydrates a vendor's `typical_rate` while the Overview copy hard-codes vendor price to 0; the Items copy toasts every failure while the Overview copy is silent. Any future fix to item entry has to be made twice, and the last two bugs in this section are exactly the sort that get fixed in one copy only.

Fix: Extract one shared AddItem/EditItem modal pair into src/components/private-bookings/ and have both routes render it, so the Electricity preset, vendor rate hydration and error toasts exist once.

**P106. Items tab prints a stray "0" next to every item that has a zero discount**

`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:877` | `render-artifact` | CONFIRMED

The discount chip is guarded with `{item.discount_value && (…)}`. When `discount_value` is 0 the expression evaluates to the number 0, which React renders as visible text. Open the Items tab of almost any booking. Each line reads "Qty: 1 £250.00 each 0" , a bare zero sitting where a discount badge would be. Verified against production: 41 of the 62 rows in `private_booking_items` have `discount_value = 0.00`, so this shows on the majority of item rows.

Fix: Change the guard to `{!!item.discount_value && item.discount_value > 0 && (`, matching PrivateBookingDetailClient.tsx:449.

**P107. Booking item create, update, delete and reorder produce no audit record anywhere**

`src/app/actions/privateBookingActions.ts:1847` | `missing-audit-log` | CONFIRMED

addBookingItem, updateBookingItem, deleteBookingItem and reorderBookingItems never call logAuditEvent, the corresponding service functions never insert into private_booking_audit, and there is no database trigger on private_booking_items. Booking items are the priced money lines and their notes field is customer-facing contract wording, so there is no record of who changed a price, quantity, discount or contract term. A staff member with 'edit' permission changes a venue-hire line from 500 to 50, or edits an item note that becomes a term in the generated contract, then denies it. The private_booking_audit tab on the booking shows nothing, audit_logs shows nothing, and the only trace is the changed row itself , the booking total simply differs from the signed contract with no attributable history.

Fix: Add logAuditEvent calls (or private_booking_audit rows) to the four item actions recording booking_id, item id, and the old/new quantity, unit_price, discount and notes.

**P108. Contract and event-sheet GET routes mutate state, so a link click from a hostile page changes booking records**

`src/app/api/private-bookings/contract/route.ts:37` | `csrf-state-changing-get` | CONFIRMED

GET /api/private-bookings/contract?bookingId=... increments the booking's contract version, writes an audit row, stores a PDF/HTML snapshot in storage, and can flip waiver_status from 'required' to 'sent'. GET /api/private-bookings/event-sheet does the same class of mutation. Route handlers have none of the CSRF protection that Next.js applies to Server Actions, and Supabase auth cookies are SameSite=Lax, which are sent on top-level GET navigations. A staff member with generate_contracts permission is logged in and clicks a link (from an email, chat message, or any page under an attacker's control) pointing at https://management.orangejelly.co.uk/api/private-bookings/contract?bookingId=<uuid>. Their session cookie rides along on the top-level navigation, contract_version increments, a new snapshot is written to the private-booking-documents bucket, and waiver_status silently moves 'required' to 'sent'. Because getBookingDeleteEligibility refuses deletion when contract_version > 0, an enquiry that was still deletable becomes permanently undeletable, and the waiver appears to have been sent to a customer who never received it. The same happens accidentally on any browser link prefetch of the /private-bookings/[id]/contract page, which simply redirects to this GET.

Fix: Split these into a pure read (render the current snapshot, no version bump, no status change) and an explicit POST/Server Action for generating a new version, so no cross-site navigation can mutate booking state.

**P109. Booking portal tokens never expire, cannot be revoked, and are signed with CRON_SECRET**

`src/lib/private-bookings/booking-token.ts:16` | `weak-token-design` | CONFIRMED

generateBookingToken is a deterministic HMAC of the booking id keyed on CRON_SECRET, with no expiry, nonce or revocation record. The same token is valid forever for a given booking, and the key is the same secret used to authorise every cron endpoint. A customer forwards the deposit-payment email to a colleague, or the link ends up in a shared mailbox or a forwarded thread. That URL grants permanent read access to the booking's customer name, event details, deposit, total, balance and due dates, plus the ability to mint fresh PayPal orders against the booking. There is no way to invalidate one leaked link without rotating CRON_SECRET, which would break every cron job and simultaneously invalidate every other customer's portal link. Conversely, anyone who obtains CRON_SECRET can mint a valid portal token for any booking id they can guess or observe.

Fix: Move booking portal links onto the existing guest_tokens mechanism (random token, hashed at rest, expires_at, consumed_at) or at minimum embed an expiry in the signed payload and sign with a dedicated secret rather than CRON_SECRET.

**P110. Fixed-discount cap is validated against total_amount, which is 0.00 on every production booking**

`src/services/private-bookings/mutations.ts:1737` | `dead-validation` | CONFIRMED

`applyBookingDiscount` guards a fixed discount against `private_bookings.total_amount`, a legacy column that is 0.00 for all 37 production bookings. The `totalAmount > 0` short-circuit means the guard never fires, so an arbitrarily large fixed discount is accepted. The real booking value lives in `calculated_total` / `gross_total` (from `get_booking_discounted_total` / `get_booking_gross_total`). A booking has £1,722 of items. Staff mistype a fixed discount of £17,220 in the Discount modal (the client has no maximum either , `DiscountModal` only requires a non-empty value). `toNumber(booking.total_amount, 0)` returns 0, `totalAmount > 0` is false, the guard is skipped and the discount is written. Every downstream figure collapses to zero: `get_booking_discounted_total` clamps with `GREATEST(0, ...)`, so the contract, the confirmation email and the balance reminder all quote a £0.00 event price, and `apply_balance_payment_status` marks the booking fully paid because `v_total` is 0.

Fix: Validate the fixed discount against `get_booking_gross_total(id)` (or the view's `calculated_total`) and drop the `totalAmount > 0` short-circuit so a zero total rejects rather than waves through.

**P111. recordBalancePayment discards the RPC's real error message**

`src/services/private-bookings/payments.ts:705` | `error-swallowing` | CONFIRMED

`record_balance_payment` raises specific, actionable exceptions ('Permission denied: manage_deposits required', 'Cannot record payment on a cancelled booking', 'Amount (X) exceeds remaining balance (Y)'). The caller replaces all of them with the generic 'Failed to record payment', which the server action then returns verbatim to staff. A staff member types £900 into the Record Payment modal for a booking with £455.88 outstanding (the client-side `maxAmount` only guards the value it was rendered with, so a stale page or a second concurrent payment defeats it). The RPC raises 'Amount (900) exceeds remaining balance (455.88)'. The UI shows only 'Failed to record payment' , the staff member has no idea whether the amount was wrong, the booking was cancelled, or their permissions were insufficient, and the underlying message is never logged either.

Fix: Log `rpcError` and surface its message (or a mapped, user-safe version keyed off the RPC's error text) instead of collapsing every failure mode into one string.

**P112. Any signed-in user can insert rows into private_booking_sms_queue regardless of private-bookings permissions**

`supabase/migrations/20251123120000_squashed.sql:4737` | `overly-permissive-rls` | CONFIRMED

The INSERT policy on private_booking_sms_queue grants insert to the authenticated role with no permission predicate, so a staff account with no private_bookings permission at all can write arbitrary rows (recipient phone, message body, status, trigger_type) into the private-booking SMS approval queue via PostgREST. A staff member whose role has no private_bookings grants uses their own session JWT to POST /rest/v1/private_booking_sms_queue with {booking_id, recipient_phone:'+447700900000', message_body:'<arbitrary text>', status:'approved'}. The row appears in the Approved section of /private-bookings/sms-queue looking like a system-generated message, and one click by a manager with 'send' permission sends it from the pub's Twilio number. The same hole also allows suppression: inserting a row with an existing booking_id and trigger_type 'deposit_reminder_7day' satisfies the duplicate check at src/app/api/cron/private-booking-monitor/route.ts:536-545 (`.in('status', ['pending','approved','sent'])`), so the cron silently skips the real deposit reminder.

Fix: Replace the WITH CHECK with user_has_permission(auth.uid(),'private_bookings','send') OR ...'manage' (server paths already use the service-role client, so tightening this does not break the app).

## Cross-cutting

**P113. FOH and Events customer-search APIs expose the whole customer database with no customers permission**

`src/app/api/foh/customers/search/route.ts:58` | `wrong-permission-scope` | PLAUSIBLE

/api/foh/customers/search runs an unrestricted name-and-phone search across every customer row and is gated on `table_bookings:edit`; the foh_staff role holds that action and holds no customers permission at all, so the shared bar iPad can read any customer's name and mobile. A bar iPad signed in as foh_staff , an account deliberately given no customers permission , calls /api/foh/customers/search?q=smith and receives up to 12 matching customers' full names and mobile numbers straight from the whole 1,049-row customer table. The same holds for any events:manage holder via the events copy. This is a third and fourth instance of the wrong-permission-module defect the sweep only found on /api/customers/lookup.

Fix: Add an explicit `customers:view` check to both handlers alongside the module check, and collapse the two byte-for-byte duplicate implementations into one shared helper.

**P114. Customer profile message thread hides SMS delivery failures**

`src/components/features/messages/MessageThread.tsx:148` | `missing-state` | PLAUSIBLE

MessageThread renders a delivery status only on the last outbound message of a same-day run, and when it does render, 'Not delivered' uses the identical grey styling as 'Delivered' , so a failed SMS on a customer's profile is either invisible or indistinguishable from a successful one. Staff send a customer two SMS on the same day; the first fails at Twilio. The thread on that customer's profile shows both bubbles with a status line only under the second one, so the failure is silently swallowed and staff believe the customer was told. In production 419 outbound messages are 'failed' and 82 'undelivered' out of 7,660 , a 6.5% failure rate that this screen is structurally unable to surface.

Fix: Show the status on every outbound message, and give failed/undelivered a distinct tone (red text plus an icon) rather than the same grey as Delivered.

# LOW (86)

## Employees

**P115. AddNoteModal is mounted on every authenticated page but can never be opened**

`src/app/(authenticated)/AuthenticatedLayout.tsx:172` | `dead-code` | CONFIRMED

openAddNoteModal is defined but never referenced by any element or handler, so isAddNoteModalOpen is permanently false and the global "Add Employee Note" modal is unreachable dead UI shipped in the client bundle of every authenticated route. There is no trigger anywhere in the app for the cross-employee quick-note feature: a manager who wants to add a note about any employee from any screen has no way in, and must navigate to the specific employee record. Meanwhile the component (which imports getEmployeeList, addEmployeeNote, Modal, Select, Textarea, Alert) is bundled into every page. A future maintainer reading AuthenticatedLayout will reasonably assume the feature works.

Fix: Either wire openAddNoteModal to a real trigger (e.g. a Topbar action in AppShell) or delete AddNoteModal, the state and the two handlers.

**P116. Export ignores the active search term and reports the wrong record count**

`src/app/(authenticated)/employees/_components/EmployeesClient.tsx:137` | `misleading-ui` | CONFIRMED

handleExport passes only the status filter to exportEmployees, so a search-narrowed list exports every employee in the status; the success toast then reports roster.employees.length, which is the current page size rather than the number of rows actually written to the file. A manager on the "All" tab (57 employees in production, page size 50) clicks Export as CSV. The file contains all 57 rows but the toast says "Exported 50 employees". If the manager first searches for "bar" to narrow the list to 4 people and then exports, the file still contains all 57 employees , including full addresses, dates of birth and phone numbers of people they did not intend to extract.

Fix: Thread searchTerm through exportEmployees into exportEmployeesData using the same applyFilters logic as the roster query, and report the exported row count returned by the action rather than the page length.

**P117. Export success toast reports the page size, not the number of records exported**

`src/app/(authenticated)/employees/_components/EmployeesClient.tsx:144` | `misleading-copy` | CONFIRMED

After a CSV/JSON export the toast counts `roster.employees.length`, which is the current page (max 50 rows), while `exportEmployees` returns every employee matching the status filter. A manager on page 1 of the "All" tab exports to CSV. The file contains all 57 employees, but the toast says "Exported 50 employees". Anyone reconciling the export against the roster believes rows are missing. The mismatch grows with the record count.

Fix: Return the record count from `exportEmployees` alongside `data`/`filename` and show that in the toast.

**P118. Employee detail page runs five extra sequential queries to recompute data it already loaded**

`src/app/(authenticated)/employees/[employee_id]/page.tsx:114` | `n-plus-one` | CONFIRMED

getHourlyRate is awaited after the page's Promise.all block and internally performs up to five sequential Supabase round trips, three of which re-read employee_pay_settings, employee_rate_overrides and employees.date_of_birth that the same page already has in memory. Every load of any employee record (the route is force-dynamic, and there is no loading.tsx under [employee_id]) blocks on a serial chain after all parallel fetching has finished, just to populate the current-rate figure on the Pay tab , a tab most viewers never open. On a cold serverless invocation this adds several avoidable round trips to time-to-first-byte with a blank screen throughout.

Fix: Move getHourlyRate into the existing Promise.all, or derive the rate from the paySettings/rateOverrides/employee data already fetched and only query pay_age_bands/pay_band_rates when no override applies.

**P119. Birthdays page tells staff reminders go out at 8 AM; the cron runs at 09:00 UTC**

`src/app/(authenticated)/employees/birthdays/page.tsx:120` | `misleading-copy` | CONFIRMED

The information banner states reminders are sent "every morning at 8 AM", but `vercel.json` schedules /api/cron/birthday-reminders at `0 9 * * *`, which is 09:00 UTC , 10:00 London during BST. A manager who has not received the birthday email by 08:30 believes the job has failed and raises it, or manually triggers a send. In summer the real delivery time is two hours later than the page claims.

Fix: Either change the copy to match the schedule (stating the London time, which shifts with BST) or move the cron to 07:00 UTC.

**P120. Birthdays page states the reminder time as 8 AM; the cron runs at 09:00 UTC**

`src/app/(authenticated)/employees/birthdays/page.tsx:120` | `stale-copy` | CONFIRMED

The informational banner promises a reminder every morning at 8 AM, but the scheduled job is 0 9 * * * (UTC), which is 09:00 in winter and 10:00 during BST , never 8 AM London. A manager who has not seen the 8am email assumes the job has failed and re-sends reminders manually, or raises it as a bug. The stated recipient is also hardcoded in the copy while the code reads process.env.MANAGER_EMAIL, so changing the env var silently makes the page copy wrong too.

Fix: State the real London time implied by the cron expression (or change the cron to 0 7 * * * for a true 8am BST send) and render the recipient from configuration rather than hardcoding it.

**P121. New-employee wizard hides which sections failed to save**

`src/app/(authenticated)/employees/new/NewEmployeeOnboardingClient.tsx:501` | `error-handling` | CONFIRMED

After the employee row is created, per-section failures are collected into followUpErrors, console-logged, and then replaced with a single generic toast, so the manager is never told which of emergency contacts, right to work or the onboarding checklist did not save or why. A manager fills the full new-starter form. The right-to-work document upload fails (bad MIME type) while everything else saves. They see "Employee created, but some sections could not be saved. Please review the employee profile." with no indication that it was Right to Work, so they must open the new record and compare it field by field against what they typed to work out what is missing.

Fix: Render followUpErrors as a persistent list (Alert or per-item toasts) naming each failed section and its message, rather than collapsing them into one generic string.

**P122. Dead employee-history functions that no route or component can reach**

`src/app/actions/employee-history.ts:58` | `dead-code` | CONFIRMED | DEAD CODE

`restoreEmployeeVersion` and `compareEmployeeVersions` are declared without `export` in a `'use server'` file, so nothing can call them, yet both have full permission checks and RPC wiring that imply a working feature. A maintainer reading this file assumes employee version restore/compare is a live capability and either builds UI on top of it or leaves the broken `p_resource` argument in `compareEmployeeVersions` unfixed because it looks exercised. The backing RPCs `restore_employee_version` and `compare_employee_versions` do exist in production, which reinforces the illusion. The same pattern applies to `getUpcomingBirthdays` in src/app/actions/employee-birthdays.ts:173.

Fix: Delete the unreachable functions, or export and wire them up if version history is intended to ship.

**P123. Timeclock PIN hash is written into audit_logs and shipped to the browser for view-only users**

`src/app/actions/employeeActions.ts:38` | `pii-in-logs` | CONFIRMED

SENSITIVE_EMPLOYEE_FIELDS does not include timeclock_pin_hash or auth_user_id, and deleteEmployee logs the raw row with no sanitisation at all, so the salted scrypt hash of each employee's 4-digit kiosk PIN ends up in audit_logs and is then serialised into the RSC payload of the client-side audit trail for anyone holding employees.view. A manager sets a timeclock PIN, so updateEmployee writes old_values/new_values containing timeclock_pin_hash. A user with only employees:view opens /employees/<id>; getEmployeeDetailData returns the last 200 audit_logs rows unfiltered and passes them to the 'use client' EmployeeAuditTrail, so the hash is present in the page payload even though it is never rendered. A 4-digit PIN has only 10,000 candidates, so an offline scrypt sweep against the leaked salt+hash recovers the PIN for the public timeclock kiosk.

Fix: Add timeclock_pin_hash and auth_user_id to SENSITIVE_EMPLOYEE_FIELDS, run deleteEmployee's old_values through sanitiseEmployeeForAudit, and select explicit columns rather than '*' where the row is handed to a client component.

**P124. employees:export permission is checked in code but was never created in the permissions table**

`src/app/actions/employeeExport.ts:18` | `missing-permission-row` | CONFIRMED

Both the export server action and the employees list page gate on checkUserPermission('employees','export'), but no such row exists in the permissions table, so the check can only ever pass via the super_admin short-circuit and the Export control is invisible to the manager role. A user in the seeded `manager` role (which holds create, delete, delete_documents, edit, manage, upload_documents, view, view_documents) opens /employees. permissions.canExport is false, so the Export dropdown is never rendered and there is no error message explaining why. If they somehow invoke the action they get 'You do not have permission to export employees.' despite holding every other employees permission.

Fix: Either insert the employees:export permission row and grant it to the manager role, or change both call sites to an action that actually exists (employees:manage is the closest fit for a bulk PII export).

**P125. Onboarding writes employee names without the shared capitalisation normaliser**

`src/app/actions/employeeInvite.ts:695` | `missing-normalisation` | CONFIRMED

The onboarding `personal` section stores `first_name`/`last_name` exactly as typed, while both `EmployeeService.createEmployee` and `updateEmployee` pass them through `normalizePersonName()`. A new starter types "jane" / "SMITH" into the onboarding form. Those values are stored verbatim, so the rota, pickers and the employee list show "jane SMITH" while every manager-created record is title-cased. Nothing corrects it until someone re-saves the record from the manager edit form. No mis-cased rows exist in production today, so this is a latent inconsistency rather than an observed one.

Fix: Apply `normalizePersonName()` in the onboarding personal-section write, the same way the service layer does.

**P126. Employment-contract GET route writes to the employees table with the service-role client under a view-only permission**

`src/app/api/employees/[employee_id]/employment-contract/route.ts:70` | `write-on-read-path` | CONFIRMED

A GET request to the contract endpoint normalises and persists the employee's first and last name using the service-role admin client, but the only authorisation is checkUserPermission('employees','view') , a mutation guarded by a read permission, reachable by simple navigation. A user holding only employees:view opens /api/employees/<id>/employment-contract (the 'Casual Worker Agreement' button, or any link to that URL). Before any PDF is produced the route rewrites employees.first_name and employees.last_name via the admin client. Because it is a GET with SameSite=lax cookies, a link or redirect from any other site that a logged-in manager clicks triggers the same write with no CSRF token involved, silently changing the stored casing of a name that payroll and contracts depend on.

Fix: Move the name normalisation out of the GET handler into the employee create/update server action (which already calls normalizePersonName), or at minimum require employees.edit and write an audit event for it.

**P127. "Mark as Former" dialog promises to set the end date to today, but the action keeps the existing date and hard-fails on future dates**

`src/components/features/employees/EmployeeStatusActions.tsx:176` | `misleading-copy` | CONFIRMED

The revoke-access confirmation states the employment end date will be set to today; finalizeEmployeeSeparation actually preserves any existing employment_end_date, and refuses the whole operation when that date is in the future. A manager runs "Begin Separation" and enters a last working day two weeks out (the dialog's own date field). The employee moves to "Started Separation" and the only button now offered is "Mark as Former", whose dialog says it will "set their employment end date to today". Clicking Confirm instead produces an error toast: "This employee's recorded last working day is 2026-08-25. Update the end date before marking them as Former." The dialog described an outcome the code will never produce, and the recovery path (editing the end date on the edit form) is not mentioned.

Fix: Reword the dialog to state the actual end date that will be recorded, and when an end date is in the future either disable the button with an explanatory hint or offer an inline "change last working day" control.

**P128. Unticking "registered disabled" leaves the disability fields populated in the database**

`src/components/features/employees/HealthRecordsForm.tsx:193` | `stale-data` | CONFIRMED

The disability sub-fields are conditionally rendered, so when the checkbox is unticked they are absent from FormData, absent from the parsed schema output, and therefore absent from the PostgREST upsert payload , which leaves the previously stored values untouched. An employee's record has `is_registered_disabled = true`, `disability_reg_number = 'ABC123'` and `disability_details` filled in. The record is corrected: a manager unticks "Is Registered Disabled?" and saves. `is_registered_disabled` flips to false, but `disability_reg_number`, `disability_reg_expiry_date` and `disability_details` were never rendered, so they are not in the payload and `ON CONFLICT DO UPDATE` does not touch them. The database keeps special-category health data about a person who is no longer flagged as registered disabled, and it stays visible on the Health tab if the flag is ever re-ticked. Note the same form deliberately handles this correctly for `allergies` and `absence_or_treatment_details`.

Fix: In `upsertHealthRecord`, null `disability_reg_number`, `disability_reg_expiry_date` and `disability_details` whenever `is_registered_disabled` is false, matching the existing treatment of allergies.

**P129. Manual "Mark as Former" computes today from UTC instead of Europe/London**

`src/lib/employees/separation.ts:26` | `timezone-bug` | CONFIRMED

todayUtcIso derives the date from toISOString(), so between 00:00 and 01:00 London time during BST the function treats yesterday as today; the cron caller passes a correct London date but the manager-triggered path does not. At 00:30 on a BST morning a manager marks an employee whose last working day is today as Former. today resolves to yesterday's date, so employment_end_date ('today') is now greater than today and the guard at line 65 rejects the action with "This employee's recorded last working day is <today>. Update the end date before marking them as Former." When no end date is recorded, the same window writes yesterday's date as the employment end date.

Fix: Replace todayUtcIso with getTodayIsoDate() from src/lib/dateUtils.ts.

**P130. Manual "Mark as Former" records the UTC date instead of the London date**

`src/lib/employees/separation.ts:27` | `timezone-bug` | CONFIRMED

`finalizeEmployeeSeparation` defaults `today` to `new Date().toISOString().split('T')[0]`, the UTC date, and the manual `revokeEmployeeAccess` path passes no `todayIso`. During BST the UTC date is a day behind London between midnight and 01:00. During British Summer Time a manager clicks "Mark as Former" at 00:20 London (23:20 UTC). `todayUtcIso()` returns yesterday's date. Two things go wrong: (a) the employee's `employment_end_date` is written as yesterday rather than today, putting a wrong last-working-day on an employment record; and (b) if an end date of today (London) was already set, the guard `employee.employment_end_date > today` fires and the action is refused with "This employee's recorded last working day is <today>. Update the end date before marking them as Former.", which reads as nonsense. The cron path is unaffected because it explicitly passes a London date.

Fix: Replace `todayUtcIso()` with `getTodayIsoDate()` from `@/lib/dateUtils`.

**P131. Reliability leaderboard query has no row limit and will silently truncate at PostgREST's 1000-row cap**

`src/services/employee-reliability.ts:646` | `silent-truncation` | PLAUSIBLE

`getTeamReliabilityLeaderboard` fetches every reliability event in the 90-day window for every employee through `fetchReliabilityEvents` without a `limit`, so PostgREST's default 1000-row ceiling applies and scores are computed from a partial event set once the window exceeds that. Events are ordered `event_at` descending, so once the 90-day window holds more than 1000 rows the oldest third of the window is dropped for whoever sorts last. Employees lose accept/reject signals from the start of the window, `eligibleShiftSignals` falls, some drop below the 5-signal threshold and are re-labelled "Low sample" with rank null, and the scores shown to managers on /employees/reliability are wrong with no error anywhere. Production is at 468 events in the last 90 days against a 1933-row all-time total, so the table is already within a factor of about two of the cap.

Fix: Page the query (or pass an explicit high limit and assert the returned count is below it) so truncation is loud rather than silent.

**P132. Employee audit trail silently truncates at 200 entries and renders them all unpaginated**

`src/services/employees.ts:1025` | `missing-pagination` | CONFIRMED

getEmployeeByIdWithDetails caps audit_logs at 200 rows with no total count, and EmployeeAuditTrail renders every returned row plus every note in one unbounded list, so older history is unreachable and the page becomes very long for active staff. Employee b64e6ae5 has 439 audit_logs rows and 11 notes in production. Opening their record renders a 211-item timeline in the right-hand column with no pagination, no "show more", and no indication that 239 earlier entries exist , a manager investigating something from three months ago sees a list that simply stops, with no way to tell whether that is the whole history. copyText (line 251) also rebuilds the full 211-entry string on every render because it is a plain const in the component body rather than memoised.

Fix: Return an exact count alongside the capped rows, show "most recent 200 of N" with a load-more or dedicated history page, and wrap copyText in useMemo.

**P133. Default JSON employee export dumps every column including the timeclock PIN hash**

`src/services/employees.ts:1304` | `pii-exposure` | CONFIRMED

generateJSON with no includeFields returns whole employees rows minus created_at, so the downloaded file carries timeclock_pin_hash and auth_user_id alongside DOB and home address, which the CSV path deliberately omits via its explicit field list. A super_admin picks 'Export as JSON' on /employees. The browser downloads employees_export_<date>.json containing, for all 57 employees, home address, DOB, phone numbers, auth_user_id and the scrypt PIN hash. That file then lives in a Downloads folder or an email attachment with no access control, and the PIN hash it contains protects a public kiosk route.

Fix: Give generateJSON the same explicit defaultFields allowlist the CSV path uses, and never let employee export emit timeclock_pin_hash or auth_user_id.

## Customers

**P134. Bulk-SMS selection is never cleared when the page, search or tab changes**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:118` | `stale-selection` | CONFIRMED

`selected` is only ever mutated by the row checkbox and select-all handlers. Changing page, editing the search or switching tabs refetches the rows but leaves the selection intact, so the "N selected" bar and the SMS button carry customers the user can no longer see. Staff tick 12 customers on page 1, then type a search to find one more and tick it. The bar reads "13 selected" but only one is visible. Clicking SMS opens /messages/bulk pre-loaded with all 13 customer ids, 12 of which the user has forgotten about. Worse, clicking "select all" on the new page replaces the whole set rather than adding to it, because the header checkbox handler compares `prev.size === customers.length`.

Fix: Clear `selected` inside `fetchPage` (or on page/search/tab change), or show the selected customers as removable chips so the off-screen selection is visible before dispatch.

**P135. Import duplicate preview only compares against the 50 customers on the current page**

`src/app/(authenticated)/customers/_components/CustomersClient.tsx:390` | `misleading-preview` | CONFIRMED

`CustomerImport` receives `existingCustomers={customers}` , the currently loaded page of the paginated list (50 rows of 1049) , and uses it for the "Mobile number already exists in the database" check. The preview therefore marks almost every already-existing customer as "Valid". A manager uploads a 200-row CSV where 60 rows are existing customers. The preview flags at most the handful that happen to be on the currently loaded page and the button reads "Import 195 Customers". After the import the toast reads "Imported 140 customers (60 skipped)" , the preview was materially wrong about what would happen.

Fix: Drop the client-side DB duplicate check and run a dry-run through the server action (or a dedicated lookup by the file's normalised phone list) so the preview reflects the whole table.

**P136. internal_notes sent to every viewer despite the UI gating them on customers.manage**

`src/app/(authenticated)/customers/[id]/page.tsx:61` | `over-fetch-pii` | CONFIRMED

The customer detail query always selects `internal_notes`, but the card that displays them is rendered only when the user has `customers.manage`. Users with `customers.view` alone receive the staff-only notes in the network payload and in React state. A user with the `staff` or `Deputy` role (customers.view = true, customers.manage = false, confirmed live) opens a customer page. The notes card is hidden, but the Supabase response in the network tab contains `internal_notes` in full, and `setNotesValue(typedCustomer.internal_notes ?? '')` puts it into component state. Notes such as behaviour warnings are visible to anyone who opens devtools.

Fix: Fetch the customer through a server action that omits `internal_notes` unless the caller passes a server-side `customers.manage` check, and load the notes in a separate gated call.

**P137. Booking values on the customer profile are rounded to whole pounds**

`src/app/(authenticated)/customers/[id]/page.tsx:225` | `money-rounding` | CONFIRMED

formatCurrency sets maximumFractionDigits: 0, so every private-booking amount shown on the customer profile , the per-row Value column and the aggregated 'Private booking value' stat , is displayed rounded to the nearest pound. A customer has a private booking with gross_total 1250.50. The All Bookings table shows '£1,251' and the Private booking value tile shows the summed total rounded the same way. Staff reading the profile to answer a payment query quote a figure that does not reconcile with the invoice or the deposit, and there is no indication the value has been rounded.

Fix: Drop maximumFractionDigits: 0 so GBP renders with its default two decimal places, or keep the compact form only for the headline tile and show exact pence in the per-booking row.

**P138. Customer Insights renders dates and times with no Europe/London timezone**

`src/app/(authenticated)/customers/insights/page.tsx:59` | `timezone-bug` | CONFIRMED

formatDate and formatGeneratedAt build Intl.DateTimeFormat('en-GB', ...) without a timeZone option in a server component, so on Vercel (UTC) the 'generated at' timestamp and last-booking dates render in UTC rather than London time. During BST the insights page is server-rendered on Vercel with TZ=UTC. A snapshot generated at 00:30 London on 12 August renders as '11 Aug 2025, 23:30' , a day and an hour out. The same applies to win-back candidates' last_booking_date, which is a date-only string parsed as UTC midnight and then formatted in UTC, so a booking made late on a BST evening can display as the previous day. The defect is invisible on a London developer machine because the local timezone happens to match.

Fix: Use the project's dateUtils helpers (formatDateInLondon / formatTime12Hour) or pass `timeZone: 'Europe/London'` plus `hourCycle: 'h12'` to both formatters.

**P139. Insights "Generated" timestamp renders in UTC, so it reads an hour early all summer**

`src/app/(authenticated)/customers/insights/page.tsx:59` | `timezone-bug` | CONFIRMED

`formatGeneratedAt` formats an ISO timestamp with `Intl.DateTimeFormat('en-GB', { dateStyle, timeStyle })` and no `timeZone`. This is a Server Component rendered on Vercel, where the process timezone is UTC, so during BST the snapshot time is shown one hour behind London time. A manager refreshes /customers/insights at 14:05 London time in August. The page reads "Generated: 5 Aug 2026, 13:05", making a freshly computed snapshot look an hour stale. Every other date helper in the section passes `timeZone: 'Europe/London'` explicitly (e.g. the customer detail page at line 197-205).

Fix: Add `timeZone: 'Europe/London'` (or use `formatDateInLondon` from src/lib/dateUtils.ts) in `formatGeneratedAt`.

**P140. Whole customer management surface is gated on `customers.manage`, which only super_admin holds**

`src/app/(authenticated)/customers/page.tsx:25` | `permission-wired-to-nothing` | CONFIRMED

Every mutating control and action in the Customers section checks `customers.manage`. In the live permission data only `super_admin` has that action; the `manager` role has `customers.create`, `edit`, `delete` and `export`, none of which is checked anywhere in the codebase. Any manager therefore sees a read-only Customers section with no Add, Import, Edit, Delete, Internal Notes or Labels controls. A user is given the `manager` role, which explicitly grants customers create/edit/delete/export. They open /customers: no "Add customer" or "Import" button, no pencil/bin icons on any row, and on a customer profile no "Edit Details" button, no Internal Notes card and no Customer Labels card. The Win-Back Campaign card on /customers/insights is hidden too. Every granted permission is inert and the role appears broken.

Fix: Check the granular actions the roles actually hold (`create` for the add/import path, `edit` for update/notes/labels, `delete` for the delete path) and treat `manage` as a superset, or grant `customers.manage` to the manager role , but pick one and make the UI gate and the server-side gate agree.

**P141. messages.manage is used as an alternative grant but does not exist**

`src/app/actions/customerEmailActions.ts:38` | `dead-permission-check` | CONFIRMED

Three code paths treat `messages.manage` as a permission that can substitute for `messages.send_transactional`, but no `messages.manage` row exists in the permissions table, so the branch is permanently false and the intended blanket-messaging grant can never be given. An administrator creates a role and grants it 'manage messages' expecting it to cover emailing and replying to customers. `checkUserPermission('messages','manage', user.id)` resolves against a permission that does not exist, returns false, and the Email customer button never appears; every send returns 'Insufficient permissions' with no explanation of why the granted permission had no effect.

Fix: Drop the `messages.manage` clauses, or add the permission row and grant it, so the two halves of the check agree.

**P142. Unsanitised search term interpolated into a PostgREST or() filter**

`src/app/actions/customers.ts:116` | `filter-injection` | CONFIRMED

`getCustomerList` builds a PostgREST `.or()` string by string-concatenating the raw `searchTerm` from the URL, with no escaping of the comma, parenthesis or wildcard characters that delimit PostgREST filter syntax. Every sibling customer-search route sanitises the same input. A user visits `/customers?search=x,sms_status.eq.opted_out` (or pastes it into the search box, which pushes it straight to the query string). The comma terminates the intended `first_name.ilike` clause and appends an attacker-chosen predicate to the OR list, so the returned set and the three count queries no longer reflect the filters the page believes it applied. Crafted terms turn the list into a blind oracle over other `customers` columns, including `internal_notes`.

Fix: Run the search term through the same `normalizeSearchTerm` strip (comma, percent, underscore, parentheses, quotes, backslash) before building the or() string, or move the search to an RPC with bound parameters.

**P143. Win-back bulk marketing SMS is gated on customers.manage, not messages.send_marketing**

`src/app/actions/customers.ts:539` | `wrong-permission-module` | CONFIRMED

`sendWinBackCampaign` dispatches a bulk marketing SMS blast but only checks `customers.manage`. Every other bulk-marketing path in the codebase checks `messages.send_marketing`, and the customers page itself uses that permission to decide whether bulk messaging is allowed. A role is granted `customers.manage` so the holder can edit and merge customer records. That grant now also lets them send an arbitrary 160-character SMS to every customer with marketing consent (373 rows live) without ever being granted `messages.send_marketing`. The messaging permission model no longer controls who can message customers.

Fix: Require `messages.send_marketing` in `sendWinBackCampaign`, in addition to (or instead of) `customers.manage`.

**P144. Unreachable destructive deleteTestCustomers action left in the server-action file**

`src/app/actions/customers.ts:669` | `dead-code` | CONFIRMED | DEAD CODE

deleteTestCustomers is declared without export inside a 'use server' file and has no caller anywhere in src, so it is dead code , but it is a bulk delete that matches any customer whose name merely contains 'test'. A maintainer reads customers.ts, sees a fully wired bulk-delete with audit logging and assumes it is a live feature, then exports it or calls it. CustomerService.deleteTestCustomers() matches `first_name.ilike.%test%,last_name.ilike.%test%` with no other guard, so any genuine customer whose surname contains that substring (for example 'Testa') is deleted along with their cascaded messages, consents and event bookings. Meanwhile the audit entry it writes uses operation_type 'bulk_delete' on resource_type 'customers' with no per-row record.

Fix: Delete both unreachable helpers, or if they are wanted, export them behind an explicit super-admin permission check and tighten the match to an exact marker rather than a substring.

**P145. Dead server actions and service methods in the Customers section**

`src/app/actions/customers.ts:669` | `dead-code` | CONFIRMED | DEAD CODE

Four entry points in the customers action/service layer have no caller: `deleteTestCustomers` and `bulkAssignLabel` are declared inside `'use server'` files but never exported and never referenced, and `getDeliveryFailureReport`/`getSmsDeliveryStats` are exported server actions with no consumer anywhere in src/. A maintainer reading src/app/actions/customers.ts sees a bulk-delete-test-customers flow with audit logging and assumes there is a UI for it, or edits `CustomerService.deleteTestCustomers` believing it is live. Nothing in the app can invoke any of these, so the code is untested, unreachable and misleading about what the section can do.

Fix: Delete the four functions and their now-unused service methods, or wire the SMS-health pair into the SMS health screen if that was the intent.

**P146. GDPR erasure cannot reach any customer , it only resolves staff profiles**

`src/app/actions/gdpr.ts:99` | `unreachable-flow` | CONFIRMED

`deleteUserData` looks the target up in `profiles` by email and returns "No user found with that email" if there is no match; `GdprService.deleteUserData` then re-reads `profiles` and only touches `customers` rows whose email equals that profile's email. Pub guests have no `profiles` row, so a customer right-to-be-forgotten request cannot be actioned through the UI at all. A guest emails asking to be erased. A super-admin opens Settings → GDPR & Privacy, clicks "Request Data Deletion", types the guest's email and gets "No user found with that email". There is no other erasure path in the app, so the request has to be fulfilled by hand in SQL or silently dropped.

Fix: Add a customer-scoped erasure entry point (by customer id from the customer profile page, or by matching `customers.email`/`mobile_e164` directly) rather than requiring a `profiles` row.

**P147. Loyalty star on the customers list can never render , `isLoyal` is set nowhere**

`src/components/features/customers/CustomerName.tsx:16` | `dead-feature` | CONFIRMED

`CustomerName` renders a gold star when `customer.isLoyal` is true, but nothing in the codebase ever sets that property. The list passes plain `Customer` rows from `getCustomerList`, whose select list has no loyalty column, so the star is permanently invisible. `src/lib/customerUtils.ts` exists solely to hold the `CustomerWithLoyalty` type plus a private `sortCustomersByLoyalty` that is never called. A maintainer sees the loyalty star markup and the `sortCustomersByLoyalty` helper and assumes loyal customers are highlighted and floated to the top of the list. They are not , every row renders identically, and there is no code path that could ever populate the flag.

Fix: Either populate `isLoyal` from `loyalty_members`/`customer_scores` in `getCustomerList`, or remove the star, the `CustomerWithLoyalty` type and `src/lib/customerUtils.ts`.

**P148. Customer phone numbers written to server logs**

`src/lib/sms/customers.ts:429` | `pii-in-logs` | CONFIRMED

The SMS recipient safety checks log full E.164 phone numbers into Vercel's log stream on every mismatch, including the customer's stored numbers and the destination number. A booking is edited so the contact phone no longer matches the linked customer. The mismatch branch fires and writes the customer id together with every phone number on that customer record into the production log. Vercel logs are retained and readable by anyone with project access, and they are outside the GDPR erasure path in src/services/gdpr.ts, so an erased customer's number persists there indefinitely.

Fix: Log the customer id and a masked suffix (last four digits) rather than the full numbers, matching the id-only convention already used in src/lib/sms/bulk.ts.

**P149. customer_scores is writable by any authenticated user and the policy is not in the repo**

`supabase/migrations/20260420000003_bookings_v05_foundations.sql:547` | `missing-permission-check` | CONFIRMED

`customer_scores` is created with no RLS policy in any migration, yet production carries a policy `customer_scores_authenticated_all` granting ALL commands to any authenticated user. The table drives the win-back audience, so any logged-in account can silently corrupt or delete the marketing targeting data, and the policy cannot be reproduced from the repo. Any authenticated account, including the shared FOH kiosk login, runs `supabase.from('customer_scores').delete().neq('customer_id','00000000-0000-0000-0000-000000000000')`. The engagement scoring table empties, and the next win-back campaign silently finds zero eligible customers (the action joins through `customer_scores`) while reporting success. Nothing in the migrations would recreate or explain the policy.

Fix: Add a migration that replaces the policy with SELECT gated on `customers.view` and writes restricted to service_role, so the production state matches the repo.

## Messages

**P150. Composer SMS segment counters under-report cost for multi-segment messages**

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:113` | `wrong-arithmetic` | CONFIRMED

Both message composers divide by the single-segment limit (160/70) instead of the multipart limits (153/67) and ignore GSM-7 extended characters that cost two septets, so staff see fewer billable segments than Twilio will charge; a correct implementation already exists in src/lib/sms/gsm7.ts. A staff member drafts a 320-character plain-ASCII bulk message. The UI shows `Math.ceil(320/160) = 2 SMS segments`, but Twilio bills `Math.ceil(320/153) = 3` because a concatenated message only carries 153 septets per part. Over a 500-recipient send that is 500 unbudgeted segments. The same under-count applies to any GSM extended character (`[ ] { } ~ | ^ \ €`), each of which costs two septets but is counted as one.

Fix: Delete both local countSmsSegments helpers and import countSmsSegments/normaliseToGsm7 from @/lib/sms/gsm7, previewing the normalised body so the count matches what sendSMS actually transmits.

**P151. The "New Message" button sends staff to /unauthorized and its label does not match its destination**

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:457` | `broken-navigation` | CONFIRMED

The button is gated on messages:send_transactional OR messages:manage but navigates to /messages/bulk, whose page guard requires messages:send_marketing. It is also labelled "New Message" while opening the Bulk Messages campaign screen. The `staff` role holds messages:view and messages:send_transactional but not messages:send_marketing (verified against role_permissions in production). A staff user opens Messages, sees the primary "New Message" call to action, clicks it, and is hard-redirected to /unauthorized with no explanation and no way back to what they wanted. Even for a manager the label misleads: they expect a compose-to-one-customer dialog and land on a filtered campaign builder.

Fix: Gate the button on messages:send_marketing (matching the destination) and rename it "Bulk Message" or "New Campaign".

**P152. Thread action buttons are 25px tall on iPad Pro portrait, below the 44px touch target**

`src/app/(authenticated)/messages/_components/MessagesClient.tsx:611` | `touch-target` | PLAUSIBLE

The conversation header packs four size="sm" buttons (Back, Mark read, Mark unread, View profile) and the composer Send is also size="sm". The responsive override that grows sm buttons to 34px is capped at max-width: 820px, so any iPad wider than that gets the 25px desktop token. On an iPad Pro 11-inch in portrait (834 CSS px, outside the 820px media query) the Mark read / Mark unread / View profile buttons render at h-25px with px-2.5, sitting adjacent in a flex-wrap row. Staff mis-tap between Mark read and Mark unread, or between Back and the customer link, because the targets are roughly half the 44px minimum this venue's FOH hardware needs. Even inside the breakpoint they only reach 34px.

Fix: Use size="md" for the thread header and composer controls, or extend the responsive token override to cover the tablet band (max-width: 1024px) and raise --spacing-btn-h-sm to 44px there.

**P153. The "SMS Opt-in: All customers" filter is wired to nothing**

`src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx:395` | `control-does-nothing` | CONFIRMED

The bulk-message SMS Opt-in select is passed through to the get_bulk_sms_recipients RPC as p_sms_opt_in_only, but both overloads of that function declare the parameter and never reference it in the query body , the WHERE clause always hard-requires sms_opt_in AND marketing_sms_opt_in. A manager switches "SMS Opt-in" from "Opted in only" to "All customers" expecting a wider audience for a one-off announcement. The list refetches (the debounce fires) and returns exactly the same rows, giving the impression the data is wrong or the filter is broken. Verified live: SELECT total_count FROM get_bulk_sms_recipients(NULL,NULL,true,...) and the same call with false both return 353.

Fix: Remove the control (marketing SMS should not be sendable to non-opted-in customers anyway), or leave it and relabel it so it no longer promises behaviour the RPC will not perform.

**P154. Holding queue Ignore has no confirmation, both buttons share one pending flag, and success is silent**

`src/app/(authenticated)/messages/holding/_components/HoldingQueueActions.tsx:88` | `missing-state` | CONFIRMED

Ignore permanently removes an unmatched customer message from the queue with a single unconfirmed click, Link and Ignore share the same isPending so both spin whichever is pressed, and neither shows any success feedback , only a router.refresh(). A staff member intends to press Link, mis-taps Ignore on the iPad (the two buttons sit adjacent in the same flex row) and the row is set to status 'ignored' with no dialog, no undo and no toast , the customer enquiry disappears from the queue and there is no UI anywhere that lists ignored rows. Because both buttons take `loading={isPending}`, the spinner gives no clue which action actually ran, and on success the only signal is the list silently getting shorter.

Fix: Wrap Ignore in the DS ConfirmDialog naming the consequence, track a separate pending flag per action, and toast on success.

**P155. Holding queue renders received_at in UTC, an hour behind London in summer**

`src/app/(authenticated)/messages/holding/page.tsx:65` | `timezone-bug` | CONFIRMED

The unmatched-communication timestamp is formatted with `new Date(...).toLocaleString('en-GB')` inside an async server component, which uses the server's timezone; Vercel runs UTC, so BST timestamps display one hour early. A customer texts the pub at 20:15 BST and it lands in the holding queue. Because the page is a server component rendered on Vercel (no TZ override is set in next.config.mjs, vercel.json or .env.example), toLocaleString formats in UTC and staff see "19:15". When they link the message and compare it against the booking or shift timeline (which uses the London-aware helpers) the ordering looks wrong, and "before/after service" judgements about the message are made against the wrong hour.

Fix: Use formatDateInLondon (or pass `{ timeZone: 'Europe/London' }`) from src/lib/dateUtils for this timestamp, as the rest of the app does.

**P156. Holding queue timestamps render an hour early in British Summer Time**

`src/app/(authenticated)/messages/holding/page.tsx:65` | `timezone-bug` | CONFIRMED

The holding queue is a force-dynamic server component that formats received_at with raw new Date(...).toLocaleString('en-GB') and no timeZone option, so it renders in the Vercel process timezone (UTC) rather than Europe/London. An unmatched SMS arrives at 22:30 London time on 10 August. The page renders "10/08/2026, 21:30:00" , an hour early , and for anything between midnight and 01:00 London it also shows the previous calendar date. Staff triaging the queue mis-order or mis-attribute the message. Verified: TZ=UTC node renders '10/08/2026, 21:30:00' where TZ=Europe/London renders '10/08/2026, 22:30:00' for the same instant. The queue is live: unmatched_communications currently holds 2 rows with status 'unmatched'.

Fix: Use formatDateInLondon(row.received_at, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hourCycle: 'h12' }) from src/lib/dateUtils.ts.

**P157. Dead exported server actions and a dead action file in the Messages surface**

`src/app/actions/diagnose-messages.ts:8` | `dead-code` | CONFIRMED | DEAD CODE

Four exported entry points in the messaging area have no callers anywhere: the entire diagnose-messages.ts file, sendBulkSMSAsync, getDeliveryFailureReport and getSmsDeliveryStats. A fifth, getUnreadMessageCount in messagesActions.ts, is a private function that is never invoked. diagnoseMessages is a Twilio-reconciliation tool that lists up to 1000 Twilio messages and diffs them against the DB , exactly the tool someone would reach for when investigating missing messages , but there is no route, page or button that reaches it, so an engineer chasing a delivery gap either rediscovers it by grep or rebuilds it. sendBulkSMSAsync is a second, divergent bulk-marketing send path (it correctly returns sent/failed/errors, unlike the live one) that nothing calls, so a maintainer reading it can easily believe the bulk screen already surfaces failure counts.

Fix: Delete the unreachable exports, or surface diagnoseMessages behind a settings page if the reconciliation tool is still wanted.

**P158. Message diagnosis window is a UTC day, not a London day**

`src/app/actions/diagnose-messages.ts:36` | `timezone-bug` | CONFIRMED | DEAD CODE

diagnoseMessages parses a YYYY-MM-DD input with `new Date(date)`, which is UTC midnight, so during BST the Twilio query covers 01:00-01:00 London and mis-attributes messages sent in the first hour of the day. An admin diagnoses missing messages for 11 Aug. Messages Twilio sent between 00:00 and 01:00 London on 11 Aug fall outside `dateSentAfter = 2026-08-11T00:00:00Z`, so genuinely missing messages from that hour are never listed, while the last hour of 11 Aug London (00:00-01:00 on the 12th UTC) is wrongly included in the 11 Aug report.

Fix: Build the range with the project's London helpers (for example startOfLondonDayUtc, already used in src/lib/sms/cross-promo.ts:377) so the window is a true London day.

**P159. Stop logging raw customer phone numbers to application logs**

`src/lib/sms/reply-to-book.ts:225` | `pii-in-logs` | CONFIRMED

The reply-to-book handler and the sendSms action log raw customer mobile numbers into logger metadata on ordinary warn/error paths. The logger writes straight to console, so these land in Vercel's log stream where they are retained and readable by anyone with project log access, outside the app's RBAC and outside the GDPR erasure sweep. A promo-context lookup fails for a customer who replied to a marketing text. logger.warn writes { phoneNumber: '+447…' } to stdout, which Vercel retains. That mobile number is now in a log store that GdprService never touches, so after the customer is erased from the database their number is still discoverable in logs by any teammate with Vercel access.

Fix: Log a hashed or last-four-digit form of the number, or the resolved customerId, instead of the raw E.164 value in these metadata objects.

**P160. hasCustomerReviewed swallows query errors and reports nobody has reviewed**

`src/lib/sms/review-once.ts:49` | `error-swallowing` | CONFIRMED

The three review-history queries have their `error` fields ignored entirely, so a failed query yields an empty set, which the engagement cron reads as "this customer has never reviewed" and sends another review-request SMS. During a transient Supabase error (or a schema change to `private_bookings.review_clicked_at`) one of the three queries fails. `bookings.data` is null, `?? []` yields an empty array, and hasCustomerReviewed returns an empty Set. The event-guest-engagement cron then treats every customer as un-reviewed and sends review-request texts to people who already clicked a review link from another booking channel: a paid, customer-visible duplicate ask, with no error logged anywhere.

Fix: Collect the three `.error` values and throw (as getFirstVisitReviewEligibleCandidateKeys already does) so the cron fails closed rather than sending duplicate review asks.

**P161. First-visit review ordering mixes UTC timestamps with timezone-less date+time strings**

`src/lib/sms/review-once.ts:248` | `timezone-bug` | CONFIRMED

parseDateTimeParts builds `YYYY-MM-DDTHH:MM:SS` with no offset, which Date.parse treats as server-local (UTC on Vercel), so bookings dated by date+time are ranked an hour later than true London time and can be ordered incorrectly against rows that carry a real timestamptz. A customer has a table booking at 19:00 on 11 Aug (BST) and an event booking the same evening whose `events.start_datetime` is stored as 2026-08-11T18:30:00Z (19:30 London). The event row parses to 18:30 UTC from a true timestamptz; the table row parses to 19:00 UTC because no offset is supplied. getFirstVisitReviewEligibleCandidateKeys therefore ranks the event as the first visit when in reality the table booking came first, so the review request is attached to the wrong booking (and the genuinely first visit is suppressed as not-first).

Fix: Parse date+time pairs through the project's London-aware helper (parseLondonDateTimeLocal, already used in src/lib/sms/cross-promo.ts:121) instead of raw Date.parse on a bare local string.

**P162. Unreferenced messages statistics helpers silently truncate at PostgREST's 1000-row cap**

`src/services/messages.ts:301` | `dead-code` | CONFIRMED | DEAD CODE

getSmsDeliveryStats and getDeliveryFailureReport run unbounded selects that PostgREST caps at 1000 rows and have no UI caller, so they are dead code that would report wrong totals if anyone wired them up. A developer surfaces the existing getSmsDeliveryStats action on a dashboard. `customers.total` renders as 1000 and active/inactive split is computed from an arbitrary 1000-row slice, because production already holds 1049 customers; the same applies to getDeliveryFailureReport, which selects every failing customer plus an embedded messages array with no limit.

Fix: Delete the unused service methods and their wrapper actions (and the unused getUnreadMessageCount), or if they are to be kept, replace the client-side counting with `{ count: 'exact', head: true }` aggregate queries.

## Parking

**P163. "Total Bookings" stat and the page subtitle report the filtered count**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:525` | `misleading-copy` | CONFIRMED

The Total Bookings stat and the PageHeader subtitle both read bookings.length, which is the current filtered and capped result set from listParkingBookings, not the total number of parking bookings. A staff member filters the list to 'Cancelled'. The header still says 'Parking' with the subtitle '2 bookings total' and the first stat card reads 'Total Bookings 2', which reads as the whole car park having only two bookings ever. The Upcoming and Pending Payments cards next to it are similarly scoped to the filter, so the three cards look like a dashboard summary while actually restating the filtered table.

Fix: Relabel the stat to 'Matching bookings' (and the subtitle likewise), or fetch the unfiltered totals separately for the stat row.

**P164. Parking search fires a server round-trip on every keystroke**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:551` | `efficiency` | CONFIRMED

SearchInput is rendered without the debounceDelay prop, so each keystroke calls setSearch immediately, which retriggers the useEffect and issues a fresh listParkingBookings server action. The customers and employees screens pass debounceDelay={350} for exactly this reason. A staff member types the eight-character reference 'PAR-2026' into the search box. That fires eight sequential listParkingBookings server actions, each doing an auth check, a checkUserPermission RPC and an ilike query against parking_bookings. Responses can also land out of order, so the list can briefly settle on the results for a prefix rather than the full term.

Fix: Pass debounceDelay={350} to the parking SearchInput, matching the customers and employees screens.

**P165. Status and payment filter selects have no accessible name**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:552` | `accessibility` | CONFIRMED

Both filter selects are rendered without a label prop and without aria-label. The DS Select only emits a <label> element when the label prop is supplied and adds no fallback accessible name, so screen readers announce two adjacent unnamed combo boxes. A screen-reader user tabs through the bookings toolbar and hears 'combo box, All statuses' then 'combo box, All payment states'. Neither control announces what it filters, and the two are only distinguishable by guessing from the current option text. Once a value is chosen (for example 'Confirmed' and 'Paid') the two controls become indistinguishable by name.

Fix: Pass aria-label="Filter by booking status" and aria-label="Filter by payment status" (or visible labels) to the two filter selects.

**P166. Refund History card renders empty, and duplicates its own heading when it is not**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:724` | `missing-empty-state` | CONFIRMED

The Refund History Card is rendered for every paid booking that has a payment record, but RefundHistoryTable returns null when there are no refunds, so the card shows a header over nothing. When there are refunds, the table renders its own h4 'Refund History' directly under the card header of the same name. A staff member selects any paid parking booking. Below the details panel a card appears titled 'Refund History' with a completely blank body, which reads as a component that failed to load rather than 'no refunds'. On a booking that has been refunded, the same panel shows the words 'Refund History' twice, one immediately under the other.

Fix: Have RefundHistoryTable render an empty state instead of null, drop its internal h4 when it is used inside a Card, or only render the card when refunds exist.

**P167. Notifications tab is a dead end with no way to pick a booking**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:744` | `broken-navigation` | CONFIRMED

Notifications is a top-level SectionNav tab, but it renders only the notification history of whichever booking happens to be selected on the Bookings tab. It contains no booking picker, never names the booking it is showing, and its own empty state tells the user to do something the tab cannot do. A staff member clicks Notifications to check whether a payment reminder went out. With nothing selected they get 'No notifications - Select a booking first to view notifications', but the tab offers no way to select one and the Refresh button is disabled. They have to work out for themselves that they must switch back to Bookings, click a row, then switch back. If they had a booking selected earlier, the tab shows that booking's history with no heading saying which booking it belongs to, so they can easily read the wrong booking's reminders.

Fix: Move notification history into the booking detail sidebar (or a tab inside it), or give the Notifications section its own booking selector and put the reference in the CardHeader subtitle.

**P168. Refund dialog always receives captureExpired=false, so it offers PayPal refunds past the 180-day window**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:995` | `stale-prop` | CONFIRMED

getParkingPaymentForRefund returns captureDate, but ParkingClient never stores it and hardcodes captureExpired={false}. The dialog therefore defaults to the PayPal method and leaves the PayPal radio enabled for captures the server will refuse. Staff refund a parking payment captured 200 days ago. The dialog preselects PayPal (because hasPayPalCapture is true and captureExpired is false), they type an amount and reason and press Process Refund, and only then see "PayPal refund window expired (180 days). Use manual refund instead." The guidance the component was designed to give up front never fires.

Fix: Store captureDate from getParkingPaymentForRefund and pass captureExpired computed from it (now - captureDate > 180 days).

**P169. Parking hardcodes captureExpired={false}, offering a PayPal refund the server will reject**

`src/app/(authenticated)/parking/_components/ParkingClient.tsx:995` | `wrong-ui-state` | CONFIRMED

ParkingClient passes captureExpired={false} to RefundDialog instead of computing it from the capture date, even though getParkingPaymentForRefund explicitly returns captureDate for that purpose. Table bookings and private bookings both compute it. For a capture older than the 180-day PayPal window the dialog preselects and enables PayPal, and the server action then refuses. Parking payment 0e676870-c55b-4e9d-bd73-31c5c19537e6 was paid on 2025-10-12, 303 days ago in prod. A super_admin selects booking PAR-20251012-0001, clicks Refund, and the dialog opens with method already set to 'paypal' and the PayPal radio enabled. They enter an amount and reason, click Process Refund, and processPayPalRefund rejects on the 180-day window. Nothing on screen ever told them PayPal was unavailable; on every other section the radio is disabled with the label 'Refund window expired (180 days)'.

Fix: Store captureDate alongside paymentId in ParkingClient state and pass captureExpired computed from it, matching the table-bookings and private-bookings callers.

**P170. Parking runs a private fork of RefundDialog and RefundHistoryTable that has already drifted**

`src/app/(authenticated)/parking/_components/RefundDialog.tsx:26` | `duplicate-implementation` | CONFIRMED

Every other section imports RefundDialog and RefundHistoryTable from @/components/features/invoices; parking has local copies under _components. The fork has lost the radio option descriptions that explain why PayPal is unavailable, and it renders its action buttons inside the Modal's scrollable body instead of the pinned footer prop. A super_admin opens the parking refund dialog on a booking with no PayPal capture. The PayPal radio is silently disabled with no explanation, whereas the shared dialog labels it 'No PayPal payment on record' or 'Refund window expired (180 days)'. On an iPad the Cancel and Process Refund buttons sit inside the modal's overflow-y-auto body and scroll out of view, whereas the shared dialog pins them in the modal footer. Any future fix to the shared dialog also has to be applied twice, and one copy will be missed.

Fix: Delete the parking copies and import the shared components, moving the parking-specific token classes into the shared version if the theming difference is the reason for the fork.

**P171. Parking page renders instead of redirecting when the permission RPC errors**

`src/app/(authenticated)/parking/page.tsx:32` | `fail-open-permission-check` | CONFIRMED

The unauthorized redirect is guarded by `!canView && !canViewError`, so when the user_has_permission RPC returns an error the page renders for a user whose view permission was never established, rather than failing closed. The user_has_permission RPC fails (stale PostgREST schema cache, transient DB error). A staff account with no parking permission at all loads /parking and gets the full page shell, stats and section navigation instead of /unauthorized, with a banner saying access could not be verified. The bookings list itself is still blocked by the server action's own check, so no data leaks today, but the page's redirect no longer means what it says and any future data passed from this server component would be exposed.

Fix: Treat an RPC error as a denial: redirect to /unauthorized whenever canView is not explicitly true.

**P172. Booking creation reports success when the payment order and payment-request SMS both fail**

`src/app/actions/parking.ts:183` | `error-swallowing` | CONFIRMED

createParkingBooking wraps createParkingPaymentOrder and sendParkingPaymentRequest in a catch that only console.errors, then returns { success: true } with paymentLink undefined. The UI shows an unqualified success toast, so staff believe the customer has been texted a payment link when nothing was sent. PayPal is briefly unavailable (or PAYPAL_CLIENT_ID is misconfigured). Staff create a booking with "Send payment link now" on. createParkingPaymentOrder throws, the catch logs and continues, and the action returns success. The UI shows "Parking booking created successfully" with no warning. The customer receives nothing, the booking sits pending, and the 7-day expiry quietly kills it. No parking_booking_notifications row is written either, so the Notifications tab shows nothing that would tip staff off.

Fix: Return a warning field from the action when the payment order or SMS fails and surface it as a toast.error / persistent banner, so staff know to generate the link manually.

**P173. updateParkingBookingStatus writes whatever object the client sends, with no validation and no legal-transition check**

`src/app/actions/parking.ts:597` | `missing-validation` | CONFIRMED

The updates argument is only constrained by a TypeScript type, which is erased at runtime; it is spread into updatesToApply and passed straight to a Supabase .update(). Any column on parking_bookings can be written by any caller with parking:manage, and no transition is checked, so terminal states can be reversed. A caller invokes the server action with { status: 'confirmed', calculated_price: 0 } (server actions accept arbitrary deserialised JSON from the browser). The price is silently zeroed on the row and an expired or cancelled booking is resurrected to 'confirmed' with no capacity re-check and no clearing of cancelled_at, so the booking now holds a space and shows as live with the wrong amount. The audit log records the raw payload but nothing rejects it.

Fix: Parse updates with a zod schema that allowlists status/payment_status/notes/cancelled_at with enum values, and reject transitions out of terminal states (cancelled, expired, completed) unless a re-check of capacity and payment state passes.

**P174. updateParkingBookingStatus writes any client-supplied column to parking_bookings (mass assignment)**

`src/app/actions/parking.ts:597` | `mass-assignment` | CONFIRMED

The updates argument is only constrained by a TypeScript Pick type, which is erased at runtime. The object is spread into updatesToApply and handed straight to a service-role .update(), so any caller with parking:manage can write arbitrary parking_bookings columns, bypassing the business guards enforced in updateParkingBookingDetails. A user with parking:manage invokes the server action (its id ships in the /parking client bundle) with `{ override_price: 0.01 }` or `{ calculated_price: 0, payment_status: 'paid', status: 'confirmed' }`. The values are written directly. This defeats updateParkingBookingDetails' guard at line 481-483 ('Paid parking bookings cannot have price-affecting fields edited') and also skips the price re-calculation, the pending-payment amount sync and the old_values captured for audit, leaving a booking whose price and payment state were changed with no trace of what actually changed.

Fix: Parse updates with a zod schema restricted to the four allowed keys and their enum values, and reject anything else before it reaches updateParkingBooking.

**P175. Guest page promises an email confirmation that is never sent to the customer**

`src/app/parking/guest/[id]/_components/PublicParkingClient.tsx:57` | `misleading-copy` | CONFIRMED

The public booking page tells the guest "You will receive email confirmation", but the only email sent on payment goes to manager@the-anchor.pub. The customer gets an SMS and nothing else, and gets no SMS at all if they have opted out. A guest books online, pays, and reads "Confirmation - You will receive email confirmation" on the page. Only sendConfirmationNotifications runs, which sends an SMS to the customer and buildPaymentConfirmationManagerEmail to the venue manager. No email is ever addressed to booking.customer_email. The guest waits for an email that will not arrive and calls the pub, or (if they are SMS-opted-out) has no written confirmation of a paid booking at all.

Fix: Either send a customer confirmation email when customer_email is present, or change the assurance copy to describe what actually happens (SMS confirmation).

**P176. Guest parking page promises an email confirmation the customer never receives**

`src/app/parking/guest/[id]/_components/PublicParkingClient.tsx:57` | `misleading-copy` | CONFIRMED

The reassurance block on the public guest page states 'Confirmation - You will receive email confirmation'. No parking code path ever emails the customer. The only email in the whole parking module goes to manager@the-anchor.pub, and the customer's email address is an optional field. A guest pays for parking, sees 'You will receive email confirmation' on the confirmation page, and waits for an email that never arrives. Their confirmation is an SMS. A guest who booked without giving an email, or whose confirmation SMS failed or was blocked by an opt-out, has no confirmation at all and rings the pub.

Fix: Change the copy to 'You will receive a text confirmation', or send the customer a confirmation email when booking.customer_email is present.

**P177. Availability slots are cut on UTC day and hour boundaries, not Europe/London**

`src/lib/parking/capacity.ts:55` | `timezone-bug` | CONFIRMED

generateSlotBoundaries uses setUTCHours/setUTCDate, so a "day" slot runs 00:00-23:59:59.999 UTC. During BST that is 01:00 to 00:59:59 London, shifting every bookings' day attribution by an hour and mis-reporting availability on the public availability API. On 15 June (BST) the website asks /api/parking/availability?granularity=day. A booking from 00:30 to 08:00 London on 16 June is stored as 23:30 on 15 June UTC, so it is counted against the 15 June slot and not the 16 June one. The website shows a space free on 16 June that is in fact taken, and shows 15 June busier than it is.

Fix: Build the slot boundaries in Europe/London (date-fns-tz fromZonedTime/toZonedTime, already a dependency) so a "day" is a London calendar day, and keep the emitted start_at/end_at as UTC instants.

**P178. Capacity and availability treat touching intervals as overlapping, blocking back-to-back bookings**

`src/lib/parking/capacity.ts:114` | `off-by-one` | CONFIRMED

Both the JS overlaps() helper and the check_parking_capacity SQL use closed ranges on both ends, so a booking that ends exactly when another starts is counted as concurrent. One space is therefore double-counted at every handover, and a one-hour booking consumes two hourly availability slots. Capacity is 10 and ten bookings run 09:00-10:00. A customer books 10:00-11:00. check_parking_capacity evaluates tstzrange(09:00,10:00,'[]') && tstzrange(10:00,11:00,'[]') as true for all ten, returns remaining = 0, and createPendingParkingBooking throws "No parking spaces remaining for the selected period" for a car park that is completely empty at 10:00.

Fix: Use half-open intervals: '[)' in the SQL range operands, and `interval.startMs < slotEnd && interval.endMs > slotStart` in overlaps().

**P179. Five unused SMS and email templates plus an unreachable reminder stage in the parking notifications module**

`src/lib/parking/notifications.ts:16` | `dead-code` | CONFIRMED | DEAD CODE

notifications.ts contains five non-exported, never-called builders (buildPaymentReminderSms, buildPaymentReminderManagerEmail, buildSessionStartSms, buildSessionEndSms, buildSessionManagerEmail), and the 'overdue' branch of the live buildPaymentReminderSmsForStage is never reached because the cron only ever passes the week and day stages. Two more dead helpers sit in the actions and services files. A manager asks for the wording of the day-of parking reminder to be changed. A developer finds buildSessionStartSms ('your parking starts today from ...') and edits it, because it is the only template that matches that description. Nothing changes: the only live session reminders are the three-day ones from buildSessionThreeDayReminderSms, and no day-of SMS exists at all. ESLint cannot catch this because @typescript-eslint/no-unused-vars is off in this repo.

Fix: Delete the five unused builders, the unreachable 'overdue' branch and its union member, getParkingBookingById and the ParkingService class.

**P180. Successful PayPal capture on the guest return path writes no audit log**

`src/lib/parking/payments.ts:418` | `missing-audit-log` | CONFIRMED

captureParkingPayment moves a booking from pending_payment to confirmed/paid and marks the payment row paid, but never calls logAuditEvent. Both callers, the public PayPal return handler and the website capture API, also omit it, so the primary money-state transition for guest bookings leaves no audit trail. A guest pays via the PayPal approval link and is redirected to /api/parking/payment/return. The booking becomes confirmed and paid and the payment record is stamped with the capture transaction id, but audit_logs contains nothing. When a payment is later disputed or a discrepancy is investigated, there is no record of who or what confirmed it, unlike the webhook path which does insert an audit row.

Fix: Insert an audit_logs row inside captureParkingPayment after a successful capture, mirroring the fields the webhook handler already writes.

**P181. Dead refundParkingPayment in payments.ts has no amount ceiling and would mis-record partial refunds**

`src/lib/parking/payments.ts:434` | `dead-code` | CONFIRMED | DEAD CODE

refundParkingPayment is defined but never exported or called anywhere in the repo. It also accepts any amount without checking it against the captured amount and unconditionally marks the booking cancelled and the payment fully refunded, so if anyone wires it up it will over-refund and corrupt state. A future maintainer sees a purpose-built parking refund helper and calls it with a partial amount, e.g. refundParkingPayment(booking, 20) on a £180 payment. PayPal refunds £20, but the booking is set to status='cancelled', payment_status='refunded' and the payment row to 'refunded', so the remaining £160 becomes invisible to the balance logic in reserve_refund_balance (which reads payment_refunds, a table this function never writes). Passing an amount larger than the capture is not blocked at all.

Fix: Delete the function so the refundActions path is the single refund entry point.

**P182. Dead refundParkingPayment helper performs an unpermissioned PayPal refund**

`src/lib/parking/payments.ts:434` | `dead-code` | CONFIRMED | DEAD CODE

refundParkingPayment calls PayPal, cancels the booking and marks the payment refunded, with no auth check, no permission check, no audit log and no payment_refunds ledger row. It is not exported and has no callers anywhere in the repo, so it is dead code that models the wrong refund flow for anyone who wires it up. A future maintainer looking for the parking refund path finds this function first, exports it and calls it from a server action. Money leaves the PayPal account with no parking:refund check, no audit trail and no payment_refunds row, so the refundable-balance guard in reserve_refund_balance never sees it and the same amount can be refunded a second time through processPayPalRefund.

Fix: Delete refundParkingPayment; processPayPalRefund in refundActions.ts is the sanctioned path.

**P183. Dead 61-line refundParkingPayment duplicates a refund flow that no longer runs**

`src/lib/parking/payments.ts:434` | `dead-code` | CONFIRMED | DEAD CODE

refundParkingPayment is neither exported nor called anywhere in the repo. It is a complete, superseded refund implementation that calls PayPal, force-cancels the booking and marks the payment refunded without writing a payment_refunds row. The live path is processPayPalRefund/processManualRefund in refundActions.ts. A maintainer asked to change parking refund behaviour opens src/lib/parking/payments.ts, finds a self-contained refundParkingPayment that looks like the refund path, and edits it. Nothing changes in production, because the actual refund runs through src/app/actions/refundActions.ts. Worse, the dead function encodes behaviour the live path deliberately does not have (it force-cancels the booking on any refund, including a partial one) so it also misleads about intent.

Fix: Delete refundParkingPayment.

## Private Bookings

**P184. List-page quick links send view-only staff straight to /unauthorized**

`src/app/(authenticated)/private-bookings/_components/PrivateBookingsClient.tsx:866` | `broken-navigation` | CONFIRMED

Three prominent "Manage Spaces / Catering Options / Preferred Vendors" buttons at the foot of the bookings list are rendered for every viewer, but each destination redirects to /unauthorized unless the user holds the matching manage permission. A staff member with `private_bookings:view` scrolls to the bottom of the bookings list, clicks the large "Manage Spaces" button, and is bounced to the unauthorized page with no explanation and no way back other than the browser's back button. The same page already knows how to do this properly , the header's "PB Settings" button is gated on `canManageSettings`, and the Settings hub itself disables each card's button when the permission is missing.

Fix: Wrap each quick link in the corresponding permission check (`manage_spaces` / `manage_catering` / `manage_vendors`, or `manage`), matching settings/page.tsx.

**P185. Items tab offers Add / Edit / Delete controls to view-only staff**

`src/app/(authenticated)/private-bookings/[id]/items/page.tsx:841` | `missing-permission-gating` | CONFIRMED

The route layout admits anyone with `view`, and the page renders the Add Item button plus per-row edit and delete buttons with no permission check, even though every underlying action requires `edit` or `manage`. A staff member with view-only private-bookings access opens a booking's Items tab, clicks Add Item, fills in the space, quantity, price, discount and customer-facing notes, submits, and only then sees "You do not have permission to modify private bookings". The same person can click the trash icon on a line and confirm a delete that will always be rejected. The Overview tab gets this right, gating the identical controls behind `canEdit`.

Fix: Pass an edit permission flag from a server component (or check `private_bookings:edit` in items/layout.tsx) and hide the Add/Edit/Delete controls, as the Overview tab already does.

**P186. The private bookings calendar is orphaned , only reachable from the SMS Queue page**

`src/app/(authenticated)/private-bookings/sms-queue/page.tsx:143` | `unreachable-route` | CONFIRMED

`/private-bookings/calendar` has a fully built page and a 15KB CalendarView component, but the single link to it in the whole app sits in the SMS Queue page's tab bar. It is absent from the sidebar, the bookings list, the settings hub and every booking-level tab bar. A manager wanting a month view of venue hire has no route to it: the sidebar has one "Private Bookings" entry pointing at the list, and neither the list header, the settings hub nor any booking page mentions a calendar. They would only find it by opening Settings, then SMS Queue, and noticing an unrelated tab. Meanwhile the SMS Queue's own tab bar ("Bookings / Calendar / SMS Queue") does not match the tab bar on any other page in the section, so the navigation is inconsistent in both directions.

Fix: Add a Calendar link to the bookings list header (or the settings hub) and align the section's tab bars, or retire the route and CalendarView if the calendar is no longer wanted.

**P187. Unauthenticated portal endpoint creates a PayPal order and writes to the booking on every call with no throttle**

`src/app/actions/portalPayPalActions.ts:46` | `missing-rate-limit` | CONFIRMED

createDepositPaymentOrderByToken is a public server action gated only by the non-expiring portal token. Each call creates a new PayPal order at the PayPal API and overwrites paypal_deposit_order_id on the booking. There is no rate limiting or throttle, unlike the comparable guest token routes. Anyone holding or guessing a portal link (which never expires, see the token finding) loops the action. Each iteration burns a PayPal API call against the merchant account and rewrites paypal_deposit_order_id, invalidating the approve URL the customer was actually given. A customer who clicks their emailed PayPal link after such a loop hits an order id that no longer matches the booking, and captureDepositPaymentByToken rejects the capture with 'Payment reference does not match this booking'.

Fix: Wrap the portal PayPal actions in the existing guest token throttle (or an equivalent per-booking limiter) so a link cannot be used to spin up unlimited orders.

**P188. Dead server action `getPrivateBookings` has no callers**

`src/app/actions/privateBookingActions.ts:154` | `dead-code` | CONFIRMED | DEAD CODE

`getPrivateBookings` is an exported `'use server'` action that nothing in the codebase imports or calls; the list screen uses `fetchPrivateBookings` from private-bookings-dashboard.ts instead. A maintainer adding a filter to the bookings list edits `getPrivateBookings`, ships it, and sees no change, because the live list page calls `fetchPrivateBookings` (a different function against the same view with pagination and payment enrichment). The stale comment on the function reinforces the confusion.

Fix: Delete `getPrivateBookings` from privateBookingActions.ts; the service function it wraps is still used directly by the dashboard and daily summary.

**P189. updateBookingStatus writes no audit trail for draft to confirmed or confirmed to completed transitions**

`src/app/actions/privateBookingActions.ts:534` | `missing-audit-log` | CONFIRMED

The updateBookingStatus server action checks permission and calls the service but never calls logAuditEvent, and 'status' is not in the field-level audit list inside updateBooking, so confirming or completing a booking leaves no record of who did it or when. A staff member marks a booking confirmed (which is what releases the hold and drives deposit expectations) or completed (which triggers the post-event review and feedback flows). Nothing is written to audit_logs or private_booking_audit. When a dispute arises about when a booking was confirmed, there is no evidence. Cancellations are audited and form-based edits are audited, so the gap is invisible until someone looks for one of these two specific transitions.

Fix: Add a logAuditEvent call in updateBookingStatus recording the old and new status, or add 'status' to auditedFieldKeys in updateBooking.

**P190. sendBookingContract mints a contract version and stores a snapshot before checking the booking has an email address**

`src/app/actions/privateBookingActions.ts:2782` | `correctness` | PLAUSIBLE

`generateContractDocument` is awaited first , it increments `contract_version`, writes a `contract_generated` audit row, uploads a snapshot to storage, inserts a `private_booking_documents` row and can stamp `waiver_status` from 'required' to 'sent'. Only afterwards does the action check `booking.contact_email` and bail out. A send that never happened therefore leaves permanent evidence that a contract was issued. Staff click "Send contract" on a booking captured by phone with no email. The action returns "This booking has no contact email address", but `contract_version` is now 1, a `contract-v1.html` document row exists and (for a bring-your-own-food booking) `waiver_status` reads 'sent' to a customer who received nothing. The booking can no longer be deleted , `getBookingDeleteEligibility` and `deletePrivateBooking` both reject on `contract_version > 0` and on the presence of a `private_booking_documents` row , and every retry after the email is added bumps the version again.

Fix: Load the booking and validate `contact_email` before calling `generateContractDocument`, so no version, snapshot, audit row or waiver stamp is created for a send that cannot proceed.

**P191. private-booking-monitor never selects date_tbd, so TBD suppression silently falls back to the legacy notes marker**

`src/app/api/cron/private-booking-monitor/route.ts:467` | `missing-column` | CONFIRMED

Every pass in the monitor cron calls `isBookingDateTbd(booking)` but none of the five selects include `date_tbd`; they select only `internal_notes`. `booking.date_tbd` is therefore always `undefined` and the primary signal in `isBookingDateTbd` is dead , suppression depends entirely on the legacy `'Event date/time to be confirmed'` string surviving in `internal_notes`. A booking is flagged date-TBD by any path that sets the column without appending the note (a direct SQL correction, a future admin screen, or an edit that trims `internal_notes`). The cron's `isBookingDateTbd` returns false, and the customer receives balance/event reminders quoting `event_date` , which for a TBD booking is the placeholder creation date written by `createBooking` (mutations.ts:612). Production currently has 1 TBD booking and it does carry the note, so no live message is wrong today; the guard is latent, not exercised.

Fix: Add `date_tbd` to each of the five selects in the monitor cron (and to `CommunicationsTabServer`, which reads only `internal_notes` for the same purpose).

**P192. Expire-holds cron formats the customer-facing event date with no timezone**

`src/app/api/cron/private-bookings-expire-holds/route.ts:136` | `timezone-bug` | CONFIRMED

The expiry SMS builds its date with `new Date(event_date).toLocaleDateString('en-GB', ...)` and no `timeZone` option, unlike every other private-booking message which uses `formatDateInLondon`. It happens to be correct today only because Vercel functions run with TZ=UTC; the date-only value is parsed as UTC midnight, so any runtime west of UTC would render the previous day. The function region or local TZ changes (or the route is exercised in a non-UTC environment): `new Date('2026-08-15')` is 2026-08-15T00:00:00Z, and `toLocaleDateString` with a host offset of -1h or worse renders "14 August 2026". The customer is told their hold on the wrong date has lapsed. There is no test or lint rule catching it because the value never passes through `dateUtils`.

Fix: Use `formatDateInLondon(booking.event_date, { day: 'numeric', month: 'long', year: 'numeric' })` here, as the equivalent `expireBooking` service path already does.

**P193. Cancellation refund policy is evaluated against a placeholder event date for date-TBD bookings**

`src/services/private-bookings/financial.ts:190` | `correctness` | CONFIRMED

`createBooking` writes `event_date = today` when no date is supplied for a date-TBD booking. `getPrivateBookingCancellationOutcome` reads that column with no `date_tbd` awareness, so once the placeholder date drifts into the past the 30-day cancellation test silently fails and a refundable deposit is downgraded to a General Manager retention decision. A customer enquires with no firm date; `createBooking` stores `event_date = 2025-09-27` (the creation date , production booking 77e53093-aa57-4951-8454-8b60cc19d96c has exactly `event_date = created_at::date` with `date_tbd = true`). They pay the £250 deposit. Six weeks later they cancel. `daysUntilEvent` returns a large negative number, so the `days >= 30` branch is skipped and the outcome is `gm_review_required`: the customer is sent "We're reviewing payments and your deposit" and a manager is asked to decide a retention against costs incurred for an event that was never scheduled, instead of the automatic deposit-less-5% refund the policy gives a 30-days-out cancellation.

Fix: Select `date_tbd`/`internal_notes` in `getPrivateBookingPaidTotals` and treat a date-TBD booking as having no event date, so cancellation falls into the no-deadline (fully refundable / partial-refund) branch rather than GM review.

**P194. Setup-reminder SMS omits the setup time it was triggered by, so a second setup change is permanently suppressed**

`src/services/private-bookings/mutations.ts:1420` | `correctness` | CONFIRMED

`updateBooking` formats `setupTimeReadable` for the setup reminder and then never passes it: `setupReminderMessage` only receives the first name and the event date. Every setup-change reminder for a given booking therefore has a byte-identical body, and `SmsQueueService.queueAndSend` dedups on `(booking_id, trigger_type, template_key, recipient_phone, message_body)` with no time window, so only the first one is ever sent. Staff set the setup time to 14:00 and save; the customer receives "5 September is nearly here. Send any final setup details our way". The customer later asks to move setup to 10:00, staff save again , `shouldSendSetupReminder` is true, `queueAndSend` finds the earlier row with the identical `message_body` in status 'sent', records `sms_suppressed / duplicate_queue_entry` and returns `suppressed: true`. The customer is never told the setup time changed, and the staff-facing result reports success.

Fix: Add the setup date/time to `setupReminderMessage` and pass `setupTimeReadable`, so the body varies with the change that triggered it (the same pattern the deposit reminders already use for `holdExpiry`).

**P195. deleteCateringPackage audit-logs two columns that do not exist on catering_packages**

`src/services/private-bookings/mutations.ts:3154` | `snake-case-mapping` | CONFIRMED

The delete audit writes `package_type` and `description` from the fetched row, but `catering_packages` has neither column , the create/update paths in the same file write `serving_style`, `category` and `summary`. Both audit values are silently `undefined`, so the audit trail for a deleted package loses its type and description. A manager deletes a catering package. The audit entry is written with `package_type: undefined` and `description: undefined`, so the only record of what was removed is its name and price. If the deletion is later disputed or needs reversing, the package's serving style, category and customer-facing summary cannot be recovered from the audit log.

Fix: Replace `package_type`/`description` with `serving_style`, `category` and `summary` so the delete audit mirrors the fields the create/update paths already record.

**P196. Dead recordFinalPayment service function marks a booking fully paid without recording any payment**

`src/services/private-bookings/payments.ts:560` | `dead-code` | CONFIRMED | DEAD CODE

`recordFinalPayment` in the service layer stamps `final_payment_date`/`final_payment_method` on the booking and sends the "balance paid in full" SMS, but never inserts a `private_booking_payments` row. Nothing calls it , the identically named server action at privateBookingActions.ts:1205 delegates to `recordBalancePayment` instead , so it is dead code that silently invites a money-losing regression. A future change wires `PrivateBookingService.recordFinalPayment` back up (the name matches the action, and it is re-exported at src/services/private-bookings.ts:109). The booking is then flagged fully paid with zero rows in `private_booking_payments`, so `calculate_private_booking_balance` still reports the full gross outstanding, `getPrivateBookingPaidTotals` reports `balance_payments_total = 0`, and a subsequent cancellation computes a £0 refund for a customer who paid in full. Production booking f10ad80d-39a7-4103-82e1-67a18cd75e49 already shows this exact inconsistent shape (`final_payment_date` set, balance 15.00 still outstanding).

Fix: Delete `recordFinalPayment` from payments.ts and its re-export in src/services/private-bookings.ts, leaving `recordBalancePayment`/`record_balance_payment` as the single path that can stamp `final_payment_date`.

**P197. Dead `PrivateBookingService.recordFinalPayment` shadows the live payment path**

`src/services/private-bookings/payments.ts:560` | `dead-code` | CONFIRMED | DEAD CODE

`recordFinalPayment` in the payments service is exported, attached to the service facade, and called by nothing. The identically named server action calls `recordBalancePayment` instead. The dead version stamps `final_payment_date` without inserting a `private_booking_payments` row. A maintainer tracing "how is a final payment recorded?" lands on this 105-line function, which marks a booking fully paid with no payment record and no balance reconciliation, and reasons about (or reuses) the wrong behaviour. The live path is `recordBalancePayment` (payments.ts:671), which goes through the atomic `record_balance_payment` RPC.

Fix: Delete `recordFinalPayment` from payments.ts and the facade in src/services/private-bookings.ts, or rename it to make clear it is not the balance-payment path.

**P198. Scheduled-SMS preview reads post_event_outcome and review_sms_sent_at from a view that does not expose them**

`src/services/private-bookings/scheduled-sms.ts:400` | `missing-column` | CONFIRMED

`getBookingScheduledSms` queries `private_bookings_with_details` but `post_event_outcome` and `review_sms_sent_at` exist only on the `private_bookings` table, not on that view. Both reads are therefore always `undefined`, so the review-request branch can never be entered and the Communications tab never shows the review SMS that the private-booking-monitor cron will actually send. A manager clicks "went well" on the post-event outcome email. `private_bookings.post_event_outcome` becomes 'went_well' and the cron queues a Google-review SMS to the customer on its next run. Staff open the booking's Communications tab to check what the customer is about to receive: `booking.post_event_outcome` is `undefined`, the `=== 'went_well'` test is false, and no review-request row is rendered , so the tab silently understates what will be sent. Ten production bookings currently have `post_event_outcome = 'went_well'`.

Fix: Fetch `post_event_outcome`, `review_sms_sent_at` and `review_processed_at` from `private_bookings` (a second lookup, or add them to the view) instead of relying on `select('*')` on the view.

## Cross-cutting

**P199. sendDepositPaymentLink writes no audit record for a customer-facing money action**

`src/app/actions/privateBookingActions.ts:2420` | `missing-audit-log` | PLAUSIBLE

sendDepositPaymentLink creates a live PayPal order, stores paypal_deposit_order_id on the booking and emails the customer a payment link, all with no logAuditEvent call , so there is no record of who sent a deposit demand or when. A customer disputes receiving a deposit demand, or two staff each fire a payment link and the customer pays twice against different PayPal orders. audit_logs has nothing for either event: no user, no timestamp, no booking id, no amount. The booking row only carries the most recent paypal_deposit_order_id, so the earlier order is untraceable.

Fix: Add a logAuditEvent call (operation_type 'update', resource_type 'private_booking', with the deposit amount and PayPal order id in additional_info) before returning success, matching editPrivateBookingPayment.

**P200. Message thread timestamps render in US format and the browser's timezone, not Europe/London**

`src/components/features/messages/MessageThread.tsx:97` | `timezone-bug` | PLAUSIBLE

The customer profile's message thread formats times with toLocaleTimeString('en-US') and groups messages with a bare toLocaleDateString(), both with no timeZone option, bypassing the project's mandatory dateUtils helpers and Europe/London default. A manager checking a customer's history from a device set to a non-UK timezone (or with the OS timezone reset after an update , a common iPad state) sees every message time shifted, and the date separators regroup around the wrong midnight, so 'Today' can land on the wrong day. Even on a correctly configured device, times render as '3:45 PM' rather than the British format used everywhere else in the app.

Fix: Route both helpers through src/lib/dateUtils.ts (formatTime12Hour / formatDateInLondon) so the thread pins to Europe/London like the rest of the app.

---

# Appendix: rejected during verification (12)

Recorded so nobody re-raises them.

**Deleting an employee gives no feedback and leaves the user on the deleted record's page** (employees, `src/components/features/employees/DeleteEmployeeButton.tsx`)

REFUTED , the described failure cannot happen; Next.js re-renders the page after the action. The empty useEffect at DeleteEmployeeButton.tsx:33-36 and the absent redirect in deleteEmployee (employeeActions.ts:654-655) are both real as quoted, but the conclusion is wrong. Disproving code, which I read in the installed Next 15.5.14: revalidatePath() sets `store.pathWasRevalidated = true` (node_modules/next/dist/server/web/spec-extension/revalidate.js:156). action-handler.js:686-690 then calls generateFlight with `skipFlight: !workStore.pathWasRevalidated || actionWasForwarded` , false here , so the CURRENT route /employees/{id} is re-rendered inside the same POST and returned as flight data, and the client applies it (client/components/router-reducer/reducers/server-action-reducer.js:183 iterates flightData and mutates the tree). On that re-render EmployeeService.getEmployeeByIdWithDetails throws 'Employee not found.', getEmployeeDetailData catches it and returns { notFound: true } (actions/employeeDetails.ts:119-120), and employees/[employee_id]/page.tsx:87-89 calls notFound(). The whole page subtree , modal included , is replaced by the 404 boundary. So the manager is NOT left on the deleted record, the modal does NOT stay open, and the 'click Delete again -> Employee not found error looks like failure' scenario is unreachable. Additional guard the finder missed: several FKs to employees are ON DELETE RESTRICT in production (checklist_task_instances x2, checklist_spot_checks, checklist_todos), so for any employee with checklist rows the delete fails and the inline red error at DeleteEmployeeButton.tsx:72-76 is the designed, working feedback. Residual nit only (not the reported bug, not high): success lands on a bare 404 rather than redirecting to /employees with a toast. Not worth a high-severity ticket.

**Row-action touch targets in the Employees section are roughly half the 44px iPad minimum** (employees, `src/components/features/employees/EmergencyContactsTab.tsx`)

The line citations are accurate (EmergencyContactsTab.tsx:183 edit button `className="p-1 text-gray-400 hover:text-gray-600"` with `<PencilIcon className="h-4 w-4" />`, :54 delete button, and EmployeesClient.tsx:93 the bare `text-xs text-primary` invite button inside a TableRow whose onClick at :246 pushes to the employee record) but the central claim , that these are half the 44px iPad minimum , is disproved by global CSS the finder did not check. src/app/globals.css:1025 opens `@media (max-width: 820px)` and lines 1049-1056 apply `button:not(.ds-sidebar button):not([role="switch"]):not(.guest-btn), a[role="button"], [role="button"], select, .touch-target { min-height: 44px; min-width: 44px; }`. A second, near-identical rule sits at globals.css:195-206 under `@media (max-width: 768px)`. globals.css is imported at src/app/layout.tsx:3, so it applies app-wide. Both cited controls are plain `<button type="button">` elements matching those selectors, and the p-1/text-xs classes set padding and font-size only, so there is no property conflict , at every viewport the project defines as tablet or phone (<=820px, which is the shell breakpoint this repo deliberately pins at 820/821px, covering iPad portrait) these buttons are already forced to 44x44. EmployeesClient.tsx has no md:hidden/hidden md: card fallback, so the table with these buttons is what actually renders at those widths. Above 820px the repo treats the viewport as desktop pointer input, and the icon buttons compute to exactly 24x24 CSS px (16px icon + 4px padding each side), which meets WCAG 2.2 SC 2.5.8 Target Size (Minimum). The residual , the invite button being under 24px tall at >820px , is too marginal to spend a maintainer's time on. Marking real=false.

**Right to Work "Legacy –" document-type labelling is unreachable** (employees, `src/components/features/employees/RightToWorkTab.tsx`)

The bare factual observation is accurate but it is not a defect, and the stated failure scenario is backwards. Facts I confirmed: line 20 is `const LEGACY_DOCUMENT_TYPES: readonly string[] = []`, line 23 is `const isLegacyDocumentType = (value: string) => LEGACY_DOCUMENT_TYPES.includes(value)`, and line 298 `{isLegacyDocumentType(option) ? `Legacy – ${option}` : option}` therefore always takes the else branch today. The file is live, not a dead duplicate: src/app/(authenticated)/employees/[employee_id]/page.tsx:21 imports it and :237 renders it as the 'Right to Work' tab. What disproves the finding: (a) the claimed harm is that a maintainer 'will assume they can retire an old one by adding it to this list, when in fact... the whole helper is inert' , that is wrong; isLegacyDocumentType is a correct, working predicate, so adding any string to LEGACY_DOCUMENT_TYPES immediately makes line 298 render 'Legacy – X' exactly as a maintainer would expect. It is an unused extension point, not broken machinery. (b) There is no unhandled path: the documentTypeOptions useMemo at lines 105-112 no longer gates on legacy status at all (`if (existingType && !options.includes(existingType)) options.push(existingType)`), so any historical document_type stored in the DB is still surfaced in the dropdown and rendered plainly. Every input produces correct UI. (c) git history shows this was deliberate, not an oversight: commit 4b18dd60 created the file with `LEGACY_DOCUMENT_TYPES = ['List A', 'List B']`, and commit d883d489 ('Revamp employee onboarding flow') promoted 'List A' and 'List B' into DOCUMENT_TYPE_OPTIONS (line 19) and emptied the legacy array in the same change. Net residue is two lines of inert but correct code with zero user-visible effect and zero behavioural risk , not worth a maintainer's time as a reported finding.

**FOH customer search runs on the service-role client under a table_bookings grant** (customers, `src/app/api/foh/customers/search/route.ts`)

The mechanics are described accurately (route.ts:58 requireFohPermission('edit'), route.ts:96 auth.supabase.from('customers'), and src/lib/api/permissions.ts:22 does return the service-role client) but the conclusion does not hold. Three things refute it. First, this is not an unchecked admin-client path: requireModulePermission (src/lib/api/permissions.ts:10-35) calls createClient() then auth.getUser(), returns 401 when there is no session, then calls the user_has_permission RPC and returns 403 unless it passes - a genuine server-side auth plus RBAC check, which is this codebase's standard pattern for API routes. Second, the endpoint exists solely to power the feature the role is granted: grep shows the only two callers are src/app/(authenticated)/table-bookings/foh/hooks/useFohCreateBooking.ts:155 (the FOH create-booking customer picker) and src/app/(authenticated)/vouchers/foh/lib.ts:246. foh_staff holds table_bookings.edit precisely so it can create bookings; gating this on customers.view instead would return zero rows through the anon client and break FOH booking creation outright. Third, the gate-on-the-surface-module pattern is deliberate and consistently applied - the sibling src/app/api/events/customers/search/route.ts:53 is the identical route gated on events.manage, which the finder itself noticed. The disclosure is also narrow and job-appropriate: minimum 2-character term, no email, no internal_notes, no consent flags, 20-row query capped to 12 scored results (route.ts:96-121), and the FOH surface already displays customer names and phone numbers on the day's bookings. The residual point - that a table_bookings.edit holder can search names outside its own bookings - is a soft boundary question about product design, not a defect a maintainer should action.

**Inbound MMS with media but no text is silently discarded** (messages, `src/app/api/webhooks/twilio/route.ts`)

The stated mechanism and the cited evidence are both disproven. Real Twilio inbound webhooks in this account always carry a status field: `select params->>'SmsStatus', params->>'MessageStatus' ... where params ? 'NumMedia'` returns 358 rows with SmsStatus='received' and 8 with MessageStatus='received', zero without. So for a caption-less media message webhookStatus='received', and at src/app/api/webhooks/twilio/route.ts:505 `isStatusUpdate = Boolean(webhookStatus) && !isInboundMessage` evaluates TRUE , control goes to handleStatusUpdate (line 507), never to the unknown_type branch at line 513 that the finding describes. The 802 unknown_type rows offered as proof are not dropped MMS at all: every one has `params` containing only AccountSid and a body beginning `ParentAccountSid=&Payload={"resource_sid":...,"error_code":"12300"}&Level=ERROR` , they are Twilio error-log/debugger callbacks. Exposure is also nil: every webhook_logs row that carries NumMedia has NumMedia='0' (no MMS has ever arrived , UK Twilio numbers do not receive MMS), the messages table contains only message_type='sms' (7660 outbound / 336 inbound, zero whatsapp), and the media capture at line 618 is gated behind `isCommunicationBodyMediaCaptureEnabled()` (COMMUNICATION_CAPTURE_BODY_MEDIA_ENABLED === 'true', src/lib/communications/capture.ts:5). Residual worth one line only: a caption-less media inbound would still be dropped, but via handleStatusUpdate's `message_not_found` return at route.ts:970-984, not the path described, and it has never happened in production.

**ensureReplyInstruction is a no-op that only trims, yet 14 call sites compute a support phone for it** (messages, `src/lib/sms/support.ts`)

REFUTED - the no-op is deliberate, documented, and depended upon. The code is as quoted (support.ts is three lines, returns message.trim()). Git history shows it was originally an appender (added in a3b4a969) and was reduced to a trim in 1ac8dfe5. The finder treated that as accidental rot and built the whole finding on 'a maintainer would reasonably conclude every SMS carries a reply-to number'. That premise is disproved by the project's own design docs, which call it out explicitly: - docs/superpowers/specs/2026-04-18-private-bookings-sms-redesign-design.md:94 has a dedicated section headed "`ensureReplyInstruction()` is a no-op" reading "It currently just trims the message. Any SMS-length planning must budget the full 306 chars as message only - no suffix is appended." - docs/superpowers/plans/2026-04-18-private-bookings-sms-redesign.md:59 instructs "No change to `ensureReplyInstruction` (stays a no-op)". - The same plan's checklist at line 2866 states "`ensureReplyInstruction` is NOT claimed to append anything - length budget is 306 for body only." So the current SMS length budgeting is built ON the no-op. Restoring the suffix would silently add ~50 characters to every outbound message and push many over the 160-char GSM-7 segment boundary, doubling SMS cost - the opposite of a fix. I also grepped all of src for 'Reply to this message': zero occurrences, consistent with a deliberate removal of that copy rather than a half-finished change. What is left is a naming/cleanup nit (a misleading function name and ~20 call sites computing a discarded phone argument, correctly marked `_phone`). That is a style observation, not a defect, and the misleading-name risk is already mitigated by the design docs. Not worth a maintainer's time as a reported finding.

**Enforce marketing_sms_opt_in on the SMS send path as WhatsApp already does** (messages, `src/lib/twilio.ts`)

The mechanical observation is correct but the failure scenario is disproven, and the proposed fix would be a regression. What is true: src/lib/twilio.ts:142-146 declares `options?: { allowTransactionalOverride?: boolean }` only, selects `'sms_status, sms_opt_in, mobile_e164, mobile_number'` (line 151) and never reads marketing_sms_opt_in. sendSMS calls it at twilio.ts:341-343 passing only allowTransactionalOverride. (The cited evidence line twilio.ts:828 is NOT in sendSMS , it is inside sendWhatsApp, twilio.ts:806-830. sendSMS never passes `marketing` to the eligibility check at all.) Why it is not the bug claimed: 1) SMS marketing consent in this system is deliberately keyed on marketing_sms_opted_out_at, NOT marketing_sms_opt_in. The LIVE production definition of get_cross_promo_audience carries the comment `-- Soft opt-in: the SMS channel is live and they have never opted out of marketing. Replaces the previous c.marketing_sms_opt_in = TRUE.` and filters `c.sms_opt_in = TRUE AND c.marketing_sms_opted_out_at IS NULL`. src/app/api/webhooks/twilio/route.ts:700-702 says the same: 'Both tiers stamp the *_opted_out_at column... the soft opt-in audience in get_cross_promo_audience keys off it'. Adding the finder's proposed `marketing_sms_opt_in !== true -> block` gate would silence the entire designed soft opt-in audience , the same 367 customers the finding cites. 2) Every caller that actually sets metadata.marketing === true is audience-filtered upstream and DOES honour the opt-out. grep for `marketing: true` in src/ returns exactly two non-test sites, src/lib/sms/cross-promo.ts:571 and :706. Recipients for :571 come from get_cross_promo_audience (excludes marketing_sms_opted_out_at IS NOT NULL); recipients for :706 come from get_follow_up_recipients, whose live definition contains `AND c.marketing_sms_opt_in = TRUE`. src/lib/notifications/notify.ts:214 blocks marketing when marketing_sms_opt_in !== true. src/lib/sms/bulk.ts:266 does the same. The bulk campaign path does not even set `marketing` (bulk.ts:331-341 sets `bulk_sms: true`). 3) The finder's own message-thread scenario cannot be fixed by this gate. sendSmsReply -> MessageService.sendReply (src/services/messages.ts:133-142) sends with `template_key: 'message_thread_reply'` and no marketing flag, so the proposed check would be inert on exactly the path described. 4) Live production check: `select count(*) from customers where marketing_sms_opted_out_at is not null` returns 0. No customer has ever used NOEVENTS/NOPROMO/NOOFFERS, so the state the scenario depends on does not exist. The 367 figure is customers who never explicitly opted in , precisely the soft opt-in cohort the design intends to reach , not people who opted out. The finding conflates the two.

**Do not derive the send permission from caller-supplied metadata in sendSms** (messages, `src/app/actions/sms.ts`)

The quoted code is accurate (src/app/actions/sms.ts:172-177, and src/lib/sms/metadata.ts:11-13 does spread params.metadata verbatim), but no privilege boundary is actually crossed. 1) The capability the finding describes as an escalation already exists through the sanctioned path with the same permission. src/app/actions/messageActions.ts:68-85 sendSmsReply checks only `messages:send_transactional` OR `messages:manage`, then calls MessageService.sendReply (src/services/messages.ts:103-142), which sends completely free-form body text to any customer. A send_transactional holder can therefore already type and send promotional copy through the normal Messages thread UI. Omitting metadata.marketing on sendSms grants nothing new. 2) What send_marketing actually gates in this app is the bulk campaign mechanism, not content classification: src/app/actions/bulk-messages.ts:83, src/app/actions/sms-bulk-direct.ts:43, src/app/actions/job-queue.ts:39 and src/app/actions/sms.ts:293 all hardcode `checkUserPermission('messages','send_marketing')` with no caller-supplied input. sendSms sends exactly one message and cannot reach any of them, so the split the finding says 'never applies' is in fact enforced where it matters. 3) The flag is not a consent gate on the SMS path either, so omitting it bypasses no protection: sendSMS never consumes metadata.marketing (the only consumers are src/lib/sms/safety.ts:106 dedupe-context keying and src/lib/sms/promo-context.ts:37 backfill filtering). 4) Live production: `select count(*) from profiles p where user_has_permission(p.id,'messages','send_transactional') and not user_has_permission(p.id,'messages','send_marketing')` returns 0 of 20 profiles. No account is in the state the failure scenario requires. Deriving which permission to check from caller-supplied metadata is a poor pattern worth tidying, but it does not produce the escalation described.

**Bulk Messages is styled with raw Tailwind greys while the sibling inbox uses design tokens** (messages, `src/app/(authenticated)/messages/bulk/BulkMessagesClient.tsx`)

The quoted lines are accurate (BulkMessagesClient.tsx:260 'font-medium text-gray-900', :275 'text-gray-600', :575 'bg-gray-50 p-3 border border-gray-200', :617 'text-yellow-600') and both clients are live (bulk/page.tsx:7 imports BulkMessagesClient, messages/page.tsx:3 imports MessagesClient), but the framing is wrong on two counts and the finding is a style nitpick, not a defect. First, it is not a Messages-section inconsistency: `grep -rn 'text-gray-\|bg-gray-\|border-gray-' src/app/(authenticated)/ --include=*.tsx` returns 2205 matches across 137 files, so raw Tailwind greys are the prevailing state of the authenticated app, not a bulk-screen anomaly. Second, the stated failure mode cannot occur: src/app/globals.css has no dark-mode block at all , grep for 'prefers-color-scheme', '.dark' and 'darkMode' in globals.css returns nothing , so there is no theme switch that would 'leave the bulk screen behind'. The token values themselves are near-identical greys (globals.css:29-31 --color-text #1c1917, --color-text-strong #0c0a09, --color-text-muted #57534e versus Tailwind gray-900 #111827 / gray-600 #4b5563): warm stone against cool grey, a difference a designer would spot side by side and a staff member would not. No user-visible breakage, no functional consequence, and no way to act on it without a 137-file sweep that has nothing to do with Messages.

**Public parking payment retry endpoint has no rate limit, origin check or CSRF token** (parking, `src/app/api/parking/payment/retry/route.ts`)

Route is live (src/app/parking/guest/[id]/_components/PublicParkingClient.tsx:99 renders `<form action="/api/parking/payment/retry" method="post">`, and route.test.ts covers it), and the middleware allowlist claim is accurate (src/middleware.ts:13 `'/api'`). But the finding's actual mechanism is disproven. (1) 'Each call ... triggers a live PayPal create-order API call' is false: src/lib/parking/payments.ts:81-91 `const existingPending = await getPendingParkingPayment(booking.id, supabase); if (existingPending) { ... return { payment: existingPending, orderId: ..., approveUrl: (existingPending.metadata as any)?.approve_url || '' } }` returns before `createSimplePayPalOrder` (line 99). getPendingParkingPayment (src/lib/parking/repository.ts:114-135) selects status='pending' for the booking, so after the first call the endpoint is DB reads only. A loop creates at most one PayPal order per booking. (2) 'No CSRF token' is inapplicable: this is a deliberately session-less guest payment endpoint reached from the public /parking/guest path (middleware.ts:26), so there is no ambient authority for a forged POST to abuse. Cross-site auto-submit only redirects the attacker's own browser to PayPal for a booking whose UUID they already know. (3) Every branch is guarded before any side effect: route.ts:39-54 requires status==='pending_payment', payment_status in ('pending','failed'), amount>0 and payment_due_at in the future, so an unauthenticated caller cannot move the booking into any state the guest's own Pay button would not. (4) Booking ids are gen_random_uuid() v4, unguessable. What remains is the generic observation that a public endpoint has no rate limiter, which is true of every public page in this app and has no concrete failure. Not worth a maintainer's time.

**Raw single-use guest feedback token is written to application logs** (private-bookings, `src/app/g/[token]/private-feedback/action/route.ts`)

The cited code is real , src/app/g/[token]/private-feedback/action/route.ts:83-88 does pass `token` into logger.warn metadata , but the log never reaches production. src/lib/logger.ts:71-96: `private log(level, message, context) { const formattedMessage = this.formatMessage(...); if (this.isDevelopment || level === 'error') { switch (level) { ... } } }` with `private isDevelopment = process.env.NODE_ENV === 'development'` at line 11. On Vercel NODE_ENV is 'production' and the level here is 'warn', so the condition is false and nothing is emitted; the trailing comment at lines 94-95 confirms it ('In production, you could send logs to a logging service here'). There is exactly one logger module (src/lib/logger.ts , no src/lib/logger/ directory), so no alternate implementation applies. Second, independent refutation: the raw token is already the URL path segment of the request (/g/<token>/private-feedback/action), which Vercel records in its request logs for every call regardless, so this line adds no exposure that does not already exist. Not worth a maintainer's time as filed.

**Failed SMS to private-booking customers are invisible on every screen** (private-bookings, `src/app/(authenticated)/private-bookings/[id]/messages/PrivateBookingMessagesClient.tsx`)

The three sub-facts are true but the conclusion is false, and the disproof sits in the finder's own quoted evidence. The Communications tab is a sibling nav item on the very same tab bar the finder listed (messages client :275, PrivateBookingDetailClient.tsx:1785, items/page.tsx:830), and it shows failed messages. src/components/private-bookings/CommunicationsTabServer.tsx:26-33 queries private_booking_sms_queue with NO status filter - `.select('id, created_at, trigger_type, template_key, status, message_body, twilio_sid, scheduled_for').eq('booking_id', bookingId).order('created_at', {ascending:false}).limit(50)` - and passes status straight through. src/components/private-bookings/CommunicationsTab.tsx:32-33 maps `case 'failed': return 'error'` and renders it as a red Badge at :95-96 over every history row. That route is live: communications/page.tsx renders `<CommunicationsTabServer bookingId={bookingId} />` after a private_bookings view/manage check. I also checked the RLS objection, since the wrapper uses the cookie client: production policies on private_booking_sms_queue include 'Users can view SMS queue with permission' (user_has_permission(auth.uid(),'private_bookings','view_sms_queue')) and 'Authenticated users can view their own' (created_by = auth.uid() OR user is super_admin/manager), so managers and anyone with view_sms_queue read the failed rows fine. What survives is minor and cosmetic: sms-queue/page.tsx:101 really does fetch only ['pending','approved','cancelled']; the Messages tab really does filter history to status === 'sent' (:137-139, :154); and the 'SMS Delivery Status' card at :461-485 really is a hard-coded three-row legend with no data behind it, which is decorative clutter rather than a bug. Live counts confirmed: sent 116, failed 14, pending 11. Not worth a maintainer's time as filed.

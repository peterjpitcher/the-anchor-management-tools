### SEC-001: Public timeclock kiosk can clock in or out any active employee without authentication
- **File:** [src/app/(timeclock)/timeclock/page.tsx:11](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/%28timeclock%29/timeclock/page.tsx#L11), [src/app/actions/timeclock.ts:73](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/timeclock.ts#L73), [src/app/actions/timeclock.ts:135](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/timeclock.ts#L135)
- **Severity / Category / OWASP:** High | Auth | A01 Broken Access Control
- **Description:** `/timeclock` is public and exposes active employee identifiers; `clockIn` and `clockOut` then mutate attendance with the Supabase service-role client and no user auth, PIN, kiosk secret, or device restriction.
- **Impact:** Any internet user can falsify attendance records and payroll inputs for staff.
- **Suggested fix:** Require a kiosk secret plus per-employee PIN/QR, restrict by trusted device or network, and avoid service-role writes in an unauthenticated flow.

### SEC-002: Public private-booking config endpoint leaks internal vendor and commercial data
- **File:** [src/app/api/public/private-booking/config/route.ts:10](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/config/route.ts#L10), [src/services/private-bookings.ts:2208](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings.ts#L2208)
- **Severity / Category / OWASP:** High | Data Exposure | A01 Broken Access Control
- **Description:** `/api/public/private-booking/config` is unauthenticated and returns admin-backed vendor/package data instead of a strict public DTO, exposing internal supplier/contact and finance-related fields.
- **Impact:** External users can enumerate internal supplier details, invoice contacts, pricing-adjacent metadata, tax identifiers, and other non-public booking configuration.
- **Suggested fix:** Return an explicit public allowlist only and split internal vendor/package records from public booking-calculator data.

### SEC-003: Public private-booking creation route permits mass assignment and customer ID spoofing
- **File:** [src/app/api/public/private-booking/route.ts:156](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/public/private-booking/route.ts#L156), [src/services/private-bookings.ts:168](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings.ts#L168)
- **Severity / Category / OWASP:** High | Input Validation | A01 Broken Access Control
- **Description:** The public route spreads nearly the full request body into the booking payload, and the service trusts caller-controlled fields such as `customer_id` and internal status or finance attributes.
- **Impact:** Anonymous callers can attach enquiries to other customers and tamper with booking state, payment metadata, and internal workflow fields.
- **Suggested fix:** Replace body spreading with a strict public schema and server-side mapper; ignore all internal fields from the client and resolve customer ownership server-side only.

### SEC-004: Employee document download actions sign arbitrary storage paths with service-role access
- **File:** [src/app/actions/employeeActions.ts:812](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L812), [src/app/actions/employeeActions.ts:1252](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L1252), [src/services/employees.ts:565](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/employees.ts#L565)
- **Severity / Category / OWASP:** High | Auth | A01 Broken Access Control
- **Description:** `getAttachmentSignedUrl` and `getRightToWorkPhotoUrl` accept raw storage paths from the caller and create signed URLs with the admin client without proving the file belongs to an attachment/right-to-work record the caller may access.
- **Impact:** Any user with `employees.view_documents` can retrieve hidden, orphaned, or mislinked HR and identity documents if they can guess or obtain a bucket path.
- **Suggested fix:** Look up the file by attachment/right-to-work record ID, verify employee-level authorization against the database, and sign only the resolved path.

### SEC-005: Employee attachment metadata trusts caller-supplied `storage_path` and can exfiltrate arbitrary bucket objects
- **File:** [src/app/actions/employeeActions.ts:649](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L649), [src/app/actions/employeeActions.ts:721](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L721), [src/app/actions/employeeActions.ts:158](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/employeeActions.ts#L158)
- **Severity / Category / OWASP:** High | Input Validation | A04 Insecure Design
- **Description:** `saveEmployeeAttachmentRecord` accepts a caller-controlled `storage_path`, only checks that it starts with `employee_id/`, stores it with service-role privileges, and may then download and email that object to the employee.
- **Impact:** A user with `employees.upload_documents` can register an existing bucket object as someone else’s attachment and potentially force sensitive files to be emailed out.
- **Suggested fix:** Bind metadata to the exact path returned by the server-generated upload URL, reject caller-supplied paths, and verify object ownership before any email or signed-URL operation.

### SEC-006: Protected system roles can still be modified through permission assignment
- **File:** [src/services/permission.ts:267](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/permission.ts#L267), [src/app/actions/rbac.ts:311](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/rbac.ts#L311)
- **Severity / Category / OWASP:** High | Auth | A01 Broken Access Control
- **Description:** `updateRole()` and `deleteRole()` block `is_system` roles, but `assignPermissionsToRole()` does not, so protected roles remain mutable through another server-side path.
- **Impact:** A user with `roles.manage` can alter system roles and grant themselves broader administrative permissions.
- **Suggested fix:** Enforce `is_system` immutability in every role-mutation path, including permission assignment.

### SEC-007: Two cron routes fail open when `CRON_SECRET` is unset
- **File:** [src/app/api/cron/table-booking-deposit-timeout/route.ts:9](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/table-booking-deposit-timeout/route.ts#L9), [src/app/api/cron/private-bookings-expire-holds/route.ts:10](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/cron/private-bookings-expire-holds/route.ts#L10)
- **Severity / Category / OWASP:** High | Auth | A05 Security Misconfiguration
- **Description:** These handlers compare directly against ``Bearer ${process.env.CRON_SECRET}``; if the env var is missing, `Authorization: Bearer undefined` is accepted.
- **Impact:** A production misconfiguration would expose destructive booking-expiry jobs and related side effects to the public internet.
- **Suggested fix:** Reuse a shared helper that hard-fails when `CRON_SECRET` is absent and rejects all requests until the secret is configured.

### SEC-008: View-only staff can mint anonymous booking-portal links that never expire or revoke
- **File:** [src/app/actions/privateBookingActions.ts:1624](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts#L1624), [src/lib/private-bookings/booking-token.ts:16](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/private-bookings/booking-token.ts#L16), [src/app/booking-portal/[token]/page.tsx:127](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/booking-portal/%5Btoken%5D/page.tsx#L127)
- **Severity / Category / OWASP:** High | Auth | A01 Broken Access Control
- **Description:** Any user with `private_bookings.view` can generate a no-login customer portal URL for any booking, and the token is a deterministic HMAC over `bookingId` with no expiry, rotation, one-time use, or revocation.
- **Impact:** Internal read access can be converted into durable external access to booking details, payment status, accessibility notes, and related customer PII.
- **Suggested fix:** Require a stronger permission for link generation, replace deterministic tokens with random stored tokens, and add expiry, rotation, and revocation.

### SEC-009: RBAC revocation remains effective for up to 60 seconds after admin removal
- **File:** [src/services/permission.ts:85](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/permission.ts#L85), [src/services/permission.ts:233](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/permission.ts#L233), [src/app/actions/rbac.ts:19](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/rbac.ts#L19)
- **Severity / Category / OWASP:** Medium | Auth | A01 Broken Access Control
- **Description:** Effective permissions are served from a cached service-role RPC result, but role deletion and role-permission changes do not invalidate affected users’ cached authorization state.
- **Impact:** A compromised or offboarded account can continue invoking privileged server actions briefly after access is revoked.
- **Suggested fix:** Invalidate the permission cache on every role-permission change, role deletion, and user-role membership change.

### SEC-010: Booking discounts rely on client-side constraints only
- **File:** [src/app/actions/privateBookingActions.ts:802](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/privateBookingActions.ts#L802), [src/services/private-bookings.ts:868](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/services/private-bookings.ts#L868)
- **Severity / Category / OWASP:** Medium | Input Validation | A04 Insecure Design
- **Description:** `applyBookingDiscount` and the underlying service accept arbitrary numeric discount values with no server-side bounds check for negative amounts, impossible fixed discounts, or percentages above 100.
- **Impact:** Users with `private_bookings.edit` can manipulate totals, invoices, and payment records by bypassing the UI’s validation.
- **Suggested fix:** Enforce server-side validation for allowed discount types, positive amounts, percentage caps, and booking-total bounds before writing to the database.

### SEC-011: PayPal and Twilio webhook handlers persist untrusted payloads before verification and over-retain raw data
- **File:** [src/app/api/webhooks/paypal/route.ts:82](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/paypal/route.ts#L82), [src/app/api/webhooks/paypal/table-bookings/route.ts:164](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/paypal/table-bookings/route.ts#L164), [src/app/api/webhooks/twilio/route.ts:114](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/webhooks/twilio/route.ts#L114)
- **Severity / Category / OWASP:** Medium | Webhook | A05 Security Misconfiguration
- **Description:** Public webhook routes create service-role clients and write request bodies or message content into `webhook_logs` before trust is established, and Twilio logging retains full SMS content and phone metadata beyond what verification needs.
- **Impact:** Attackers can poison logs and drive storage growth, while operators and downstream backups gain unnecessary access to payment and SMS payload data.
- **Suggested fix:** Verify signatures before any privileged write, log only minimal metadata, and hash, truncate, or drop raw payload bodies unless there is a strict retention requirement.
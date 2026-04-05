I found 7 concrete issues. Two are immediate against the current codebase if this spec is implemented as written: the existing `/receipts` export path is broader than `super_admin`, and `oj_projects` is currently granted to `manager`.

### SEC-001: Existing `/receipts` export would leak super_admin-only finance data
- **Spec Section:** 1, 7.1-7.5
- **Severity:** High
- **Category:** Auth
- **Description:** The spec adds Mileage, Expenses, MGD, receipt images, and the Claim Summary PDF into the existing quarterly `/receipts` export, but it does not tighten that export’s permission model. In the current app, that export is guarded by `receipts:export`, which is broader than `super_admin`.
- **Impact:** A user who can export receipts but is not `super_admin` could download super_admin-only claim totals, MGD data, and expense receipt files.
- **Suggested fix:** Do not piggyback on `receipts:export`. Require `super_admin` explicitly for the enhanced bundle, or split the new finance-claims export into a separate endpoint with its own permission.

### SEC-002: Bare `authenticated` RLS breaks the super_admin-only boundary
- **Spec Section:** 10
- **Severity:** High
- **Category:** RLS
- **Description:** Section 10 explicitly says “a simple `authenticated` policy suffices.” That makes database enforcement weaker than the stated access model in section 2. Any query path using a user-scoped Supabase client would be allowed for any logged-in user, and UUID-based object access becomes an IDOR surface.
- **Impact:** Non-super_admin users could read or tamper with mileage, expense, receipt-metadata, and MGD rows if they reach the tables through any direct query path or future endpoint that relies on RLS.
- **Suggested fix:** Make RLS permission-aware on every new table, e.g. `public.is_super_admin(auth.uid())` or `public.user_has_permission(auth.uid(), '<module>', 'view/manage')`. Do not use bare `authenticated` policies for these modules.

### SEC-003: OJ-Projects sync trigger creates an unguarded cross-module write path
- **Spec Section:** 3.1, 4.1, 10
- **Severity:** High
- **Category:** Auth
- **Description:** The `oj_entries` trigger writes directly into `mileage_trips`, outside mileage server actions. In the current RBAC seeds, `oj_projects` permissions are granted beyond `super_admin`, so a user with OJ Projects write access can create, alter, or delete finance mileage rows indirectly.
- **Impact:** Privilege escalation into a super_admin-only module, with fraudulent reimbursement claims or silent deletion of claimable mileage.
- **Suggested fix:** Treat the sync as a trusted backend path only. Either require the source actor to be `super_admin`, or move sync into a secured RPC/job run by trusted backend code and audit the originating `oj_entry` actor.

### SEC-004: Upload flow allows resource-exhaustion attacks before validation
- **Spec Section:** 3.2, 8.1
- **Severity:** High
- **Category:** File Upload
- **Description:** The spec says “no client-side size limit” and does not add server-side hard limits. Files are sent via `FormData`, images are decoded and transformed with `sharp`, and PDFs are stored as-is. Large files, many files, image bombs, or huge PDFs will consume CPU, memory, runtime, and storage before the app can reject them.
- **Impact:** Easy DoS against Node workers/server actions, failed exports, storage exhaustion, and avoidable cost growth.
- **Suggested fix:** Add server-side caps for request size, per-file size, number of files per expense, image megapixels/dimensions, PDF size/page count, and processing timeouts. Reject before `sharp` where possible.

### SEC-005: File type trust is client-side only, and PDFs are redistributed unsanitized
- **Spec Section:** 3.2, 8.1
- **Severity:** Medium
- **Category:** File Upload
- **Description:** The spec only mentions client validation of JPEG/PNG/WebP/HEIC/PDF. It does not require server-side signature checking, MIME sniffing, or PDF sanitization. A mislabeled or malicious file can be stored and later shipped inside the quarterly ZIP.
- **Impact:** Malicious PDFs or polyglot files can be delivered to privileged users through the export bundle; if a future preview/download path serves by stored MIME, this can become active content delivery.
- **Suggested fix:** Validate magic bytes server-side, derive MIME/extension from content, re-encode images, and virus-scan or sanitize PDFs. Serve all stored files as attachments, not inline.

### SEC-006: `expense-receipts` bucket is private but not authorization-aware
- **Spec Section:** 8.2
- **Severity:** Medium
- **Category:** Storage
- **Description:** “Private, service-role access” means the bucket itself is not enforcing super_admin access; every read/write depends entirely on application code using the service role correctly. The spec does not define how preview/download/delete paths must authorize an `expense_files` object before touching `storage_path`.
- **Impact:** One auth bug in a file endpoint can expose or delete any receipt object in the bucket; storage becomes all-or-nothing instead of least privilege.
- **Suggested fix:** Never accept raw `storage_path` from callers. Resolve by `expense_files.id`, join to `expenses`, enforce `super_admin`, and only then issue a short-lived signed URL or perform a server-side download/delete.

### SEC-007: Server-side validation and DB constraints are underspecified for financial inputs
- **Spec Section:** 3.1-3.3, 6, 10
- **Severity:** Medium
- **Category:** Input Validation
- **Description:** The spec defines UI rules and columns, but not concrete Zod schemas or DB `CHECK` constraints for non-negative amounts/miles, sane maxima, enum fields, period validity, or mileage-leg chain integrity. User-controlled text also flows into CSV/PDF/export filenames.
- **Impact:** Crafted requests can store negative or absurd values, invalid statuses, broken route legs, or oversized text that corrupts reimbursement totals, MGD calculations, and exports.
- **Suggested fix:** Add explicit server-side schemas for every create/update path and mirror them in DB constraints: non-negative numeric ranges, max string lengths, enums for `source/status`, `period_start <= period_end`, `date_paid` only when `status='paid'`, and transactional validation for contiguous `mileage_trip_legs`.

Not separately flagged: section 7.3 does carry formula-injection protection across the new CSVs, so I would not count CSV formula injection as an open gap in this spec. I also do not see a standalone PDF code-injection issue if the implementation stays with text-only `pdfkit`/`react-pdf` rendering; the larger risks are authz and unbounded input.
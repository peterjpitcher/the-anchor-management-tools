**Findings**

1. `SEC-001: Raw PostgREST filter injection in destination delete pre-check`  
File: [src/app/actions/mileage.ts:529](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/mileage.ts#L529)  
Severity: Medium  
Category: Injection  
Description: `deleteDestination()` accepts `id` without UUID validation and interpolates it directly into `.or(\`from_destination_id.eq.${id},to_destination_id.eq.${id}\`)`. This is not raw SQL, but it is still an injection surface because `.or()` consumes raw PostgREST filter syntax.  
Impact: A crafted `id` can alter or break the privileged “is this destination referenced?” check. Because the action uses the service-role client, that manipulated filter executes outside RLS and can undermine the deletion safeguard.  
Fix: Validate `id` as a UUID before use and stop building the `.or()` string from untrusted input. Use two parameterized filters/RPC instead of raw filter-string interpolation.

2. `SEC-002: Expense file-count limit is raceable and not reliably enforced`  
File: [src/app/actions/expenses.ts:438](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/expenses.ts#L438)  
Severity: Medium  
Category: File Upload  
Description: `uploadExpenseFile()` enforces the 10-file cap by reading the current count and then uploading/inserting files afterward, outside any lock or transaction. Two concurrent requests can both see the same count and both proceed.  
Impact: The documented 10-file limit can be exceeded, leading to unexpected storage growth and heavier export/review workloads. The 20MB per-file size cap is enforced; the count cap is not atomic.  
Fix: Enforce the cap in the database or serialize uploads per `expense_id` with a transaction/advisory lock and a re-check immediately before insert.

3. `SEC-003: Mutation validation is incomplete despite privileged service-role execution`  
File: [src/app/actions/mileage.ts:36](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/mileage.ts#L36), [src/app/actions/mileage.ts:454](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/mileage.ts#L454), [src/app/actions/expenses.ts:290](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/expenses.ts#L290), [src/app/actions/expenses.ts:416](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/expenses.ts#L416), [src/app/actions/mgd.ts:81](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/mgd.ts#L81)  
Severity: Low  
Category: Input Validation  
Description: Several mutations do not fully validate all inputs with Zod. Examples: mileage `description` is unbounded, multiple update/delete actions only check that `id` is present rather than UUID-valid, `uploadExpenseFile()` parses `FormData` ad hoc without a schema for `expense_id`, and `updateReturnStatus()` accepts any string for `date_paid`.  
Impact: Malformed input reaches privileged DB/storage calls, causing inconsistent failures and false-success audit trails, and it widens the parser/builder attack surface around already-privileged code.  
Fix: Add per-mutation Zod schemas that cover all fields, including UUIDs, bounded text, and ISO date strings, and parse `FormData` into a schema before any admin-client call.

**Checked With No Finding**

- All reviewed server actions and the export route do perform auth/permission checks before using the admin client.
- Expense upload does validate magic bytes server-side via `validateFileType()`.
- The migration uses `public.is_super_admin(auth.uid())` for the new table/storage policies rather than bare `authenticated`.
- The enhanced finance bundle in the receipts export is explicitly gated behind `isSuperAdmin`.
- Reviewed expense flows derive storage paths server-side; they do not accept a client-supplied `storage_path`.

Assumption: I treated the current RBAC model as intended `super_admin`-only access for these modules, per the design spec. Because these actions use the service-role client, the effective enforcement for these code paths is the action-layer permission check, not RLS.
The spec is implementable in broad shape, but several requirements need adjustment because the live send, booking, and RBAC contracts are stricter than the spec assumes.

**Traceability Matrix**
| ID | Spec Area | Requirement | Status | Trace / Issue | Specific Resolution |
|---|---|---|---|---|---|
| SC1 | Success Criteria | Event + `Without Bookings` returns customers not booked to that event | NEEDS ADJUSTMENT | Codebase distinguishes active vs cancelled/expired bookings and reminder-only rows | Define “booked” as active, non-reminder bookings in the RPC |
| SC2 | Success Criteria | All six filters work correctly in any combination | NEEDS ADJUSTMENT | Filter semantics are underspecified for current booking/category rules | Reuse one shared eligibility/booking predicate across all filter combinations |
| SC3 | Success Criteria | Only customers with a valid mobile number and SMS opt-in appear | CONTRADICTORY | Spec later allows invalid numbers; send layer also requires more than `sms_opt_in` | Filter on a usable sendable phone and align with send-time eligibility |
| SC4 | Success Criteria | No silent exclusions; what you see is what gets sent | CONTRADICTORY | Unchanged send layer still excludes `marketing_sms_opt_in`, blocked `sms_status`, and unusable numbers | Make fetch RPC mirror send eligibility exactly, or change send pipeline first |
| SC5 | Success Criteria | `<=100` direct, `>100` queue send path | FEASIBLE | Existing actions already support this split | - |
| CT1 | Constraints | No pagination; load all matches (~400 contacts) | FEASIBLE | Dataset size and existing UI primitives support this | - |
| CT2 | Constraints | Keep existing SMS safety guards | FEASIBLE | Current send actions/helper already enforce them | - |
| CT3 | Constraints | Check RBAC `messages:create` | CONTRADICTORY | Live messaging flows use `messages:view` and `messages:send`, not `messages:create` | Use `messages:send` for bulk send flows, or explicitly redefine permissions |
| CT4 | Constraints | Reuse existing send infra; only filtering/UI rebuilt | FEASIBLE | Can be done if fetch eligibility matches send eligibility | - |
| ARC1 | Architecture | Server wrapper page + client component + RPC; no API route/in-memory filtering/pagination | FEASIBLE | Fits App Router and current codebase | - |
| RPC1 | RPC Design | New `get_bulk_sms_recipients` with core params (`event/date/search`) | FEASIBLE | New RPC fits existing migration pattern | - |
| RPC2 | RPC Design | `p_booking_status` logic for event/category filtering | NEEDS ADJUSTMENT | Spec SQL counts any booking row, including cancelled/expired/reminder-only | Add active-status and non-reminder predicates |
| RPC3 | RPC Design | `p_sms_opt_in_only` drives eligibility | NEEDS ADJUSTMENT | Boolean can exist, but fetch still must enforce marketing/status/usable-phone rules | Keep param, but always enforce fixed send eligibility predicates |
| RPC4 | RPC Design | Return `mobile_number` and `last_booking_date` | NEEDS ADJUSTMENT | Send path prefers canonical phone; `last_booking_date` semantics are undefined | Return canonical/sendable phone and compute last booking with defined booking semantics |
| RPC5 | RPC Design | `SECURITY DEFINER` function | NEEDS ADJUSTMENT | Current secure RPC pattern uses `SET search_path = public` | Add `SET search_path = public` |
| RPC6 | RPC Design | No `marketing_sms_opt_in` gate | CONTRADICTORY | Current send pipeline and route both require it | Keep the gate, or separately change send/data model first |
| RPC7 | RPC Design | Exclude only null/empty mobile numbers | NEEDS ADJUSTMENT | “Valid mobile number” needs more than non-empty `mobile_number` | Filter on canonical/usable send number |
| PAGE1 | Page Structure | Server page auth check via `supabase.auth.getUser()` | FEASIBLE | Redundant with authenticated layout, but valid | - |
| PAGE2 | Page Structure | Page permission check via `checkUserPermission('messages','create')` | CONTRADICTORY | Does not match live permission usage | Use `messages:send` or document a new permission rollout |
| PAGE3 | Page Structure | Fetch events/categories server-side for dropdowns | AMBIGUOUS | Events are behind `events:view`; spec does not define fetch auth model or which events appear | Decide admin vs user-scoped fetch, and define selectable event set |
| FIL1 | Filter Panel | Event filter is a searchable select | NEEDS ADJUSTMENT | `ui-v2` has `Select` and `SearchInput`, but no searchable combobox | Build a small combobox/popover or relax to plain `Select` |
| FIL2 | Filter Panel | Booking Status disabled/hidden until event selected | FEASIBLE | Straightforward client logic | - |
| FIL3 | Filter Panel | SMS Opt-in filter = `Opted In` / `All` | NEEDS ADJUSTMENT | “All” is misleading if blocked/unsendable customers are still excluded | Define it as “all send-eligible” or rename/copy accordingly |
| FIL4 | Filter Panel | Event Category select | FEASIBLE | Existing category data/action supports this | - |
| FIL5 | Filter Panel | Date range on `created_at` | FEASIBLE | Straightforward SQL/UI | - |
| FIL6 | Filter Panel | Search on name/mobile | FEASIBLE | Straightforward SQL/UI | - |
| FIL7 | Filter Panel | Recipient reload debounced at 300ms | NEEDS ADJUSTMENT | Existing `SearchInput` debounce does not cover controlled state + all filters | Add an explicit debounced fetch layer over filter state |
| FIL8 | Filter Panel | Clear Filters resets defaults; state stays in component, not URL | FEASIBLE | Current page already uses local state | - |
| LIST1 | Recipient List | Table with checkbox/name/mobile/last booking + select-all + count line | FEASIBLE | `DataTable` already supports selection and loading states | - |
| LIST2 | Recipient List | Empty state: “Apply filters to find recipients” when no filters | CONTRADICTORY | Conflicts with default `smsOptIn='opted_in'` and edge case “all filters cleared shows all recipients” | Choose one model; safest is auto-load default eligible recipients |
| LIST3 | Recipient List | Loading skeleton rows | FEASIBLE | `DataTable` supports this | - |
| COMP1 | Compose Panel | Textarea, char/segment count, variable buttons | FEASIBLE | Straightforward client implementation | - |
| COMP2 | Compose Panel | Preview with first selected recipient; placeholder if none | FEASIBLE | Straightforward client implementation | - |
| SEND1 | Send Controls | Disabled button, dynamic label, confirmation modal with preview/count | FEASIBLE | Existing modal/button primitives support this | - |
| SEND2 | Send Controls | Threshold branch, feedback states, clear message/selection after success | FEASIBLE | Existing send actions return enough data for this | - |
| ACT1 | Server Action | `fetchBulkRecipients` uses `getSupabaseServerClient()` | NEEDS ADJUSTMENT | Helper does not exist in repo | Use `createClient()` |
| ACT2 | Server Action | `fetchBulkRecipients` checks `messages:view` and proceeds | CONTRADICTORY | Pseudocode ignores the boolean result; permission also broadens access vs current `messages:send` route | Check the boolean result and use the agreed permission, likely `messages:send` |
| ACT3 | Server Action | RPC param mapping and `data ?? []` return | FEASIBLE | Straightforward once final RPC contract is fixed | - |
| TYPE1 | Types | `BulkRecipientFilters` definition | FEASIBLE | Matches intended filter state shape | - |
| TYPE2 | Types | `BulkRecipient` only exposes `mobile_number` | NEEDS ADJUSTMENT | UI truthfulness needs canonical/sendable phone, not just legacy display number | Add `phone_number`/`sendable_phone` (optionally keep display phone too) |
| FLOW1 | Send Flow | `enqueueBulkSMSJob` from `src/app/actions/sms-bulk-direct.ts`; no send changes | NEEDS ADJUSTMENT | Action lives in a different file, and unchanged send infra only works if fetch eligibility matches it | Fix file reference to `job-queue.ts` and explicitly align fetch with send eligibility |
| FILE1 | Files | File plan covers all changes/deletions | MISSING | App files are covered, but test-file churn is omitted | Add replacement/removal of route tests and new action/component tests |
| EDGE1 | Edge Cases | Event selected without booking status; booking status without event; zero-booking event | FEASIBLE | UI/RPC can support these | - |
| EDGE2 | Edge Cases | Invalid mobile still shown and fails at send time | CONTRADICTORY | Conflicts with success criteria and truthful recipient list | Exclude invalid/unsendable numbers up front, or relax the success criteria |
| EDGE3 | Edge Cases | All filters cleared shows all opted-in customers | CONTRADICTORY | Conflicts with “Apply filters to find recipients” empty state | Remove one of the two behaviors |
| EDGE4 | Edge Cases | Special-character search is safe because parameterized `ILIKE` | NEEDS ADJUSTMENT | Parameterization stops injection, but `%` and `_` still act as wildcards | Escape wildcard characters or document wildcard search behavior |
| TEST1 | Testing Strategy | Manual SQL verification for RPC | NEEDS ADJUSTMENT | Missing tests for marketing/status/usable-phone and active-vs-cancelled/reminder bookings | Add those scenarios to RPC verification |
| TEST2 | Testing Strategy | Unit test `fetchBulkRecipients` | NEEDS ADJUSTMENT | Should cover denied permission, helper replacement, and final error contract | Mock `createClient()`, auth failure, permission denial, RPC error, param mapping |
| TEST3 | Testing Strategy | Manual UI test list | NEEDS ADJUSTMENT | Missing default-state behavior, 100/101 threshold, preview correctness, eligibility alignment | Add those scenarios and replace route-centric regressions |

**Non-Feasible Notes**
1. `SC3`, `SC4`, `RPC3`, `RPC6`, `RPC7`, `FIL3`, `TYPE2`, `EDGE2`, `FLOW1`  
Issue: the spec’s recipient eligibility is looser than the unchanged send pipeline. [bulk.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/sms/bulk.ts:243) still drops recipients without `marketing_sms_opt_in`, with blocked `sms_status`, or without a usable send number, and the current route mirrors that in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/messages/bulk/customers/route.ts:165). Resolution: make `get_bulk_sms_recipients` use the same predicate as send-time, preferably matching the newer audience RPC in [20260404000002_cross_promo_infrastructure.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260404000002_cross_promo_infrastructure.sql:31), and return the canonical phone actually used for sending.

2. `SC1`, `SC2`, `RPC2`, `RPC4`  
Issue: booking semantics are underspecified for a codebase that treats only `pending_payment` and `confirmed` as active bookings and excludes reminder-only rows from attendance stats. Evidence is in [20260420000025_event_booking_rebook_after_cancel.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:7), [20260606000000_prevent_event_delete_with_active_bookings.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260606000000_prevent_event_delete_with_active_bookings.sql:11), and [20260216210000_fix_customer_category_stats.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260216210000_fix_customer_category_stats.sql:27). Resolution: define “booked” and `last_booking_date` explicitly as active, non-reminder bookings unless product wants historical-any-row behavior.

3. `CT3`, `PAGE2`, `ACT2`  
Issue: the spec’s permission model does not match live usage. Read actions use `messages:view` in [messageActions.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/messageActions.ts:11), while the current bulk route and both send actions use `messages:send` in [route.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/api/messages/bulk/customers/route.ts:322), [sms-bulk-direct.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/sms-bulk-direct.ts:43), and [job-queue.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/job-queue.ts:39). Resolution: explicitly decide the boundary; the safest match to current production behavior is `messages:send` for page access, recipient fetch, and send.

4. `PAGE3`  
Issue: the page wrapper’s event/category loading is not fully specified against RLS. Events are protected by `events:view` in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:5099), while categories are readable by any authenticated user in [20251123120000_squashed.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20251123120000_squashed.sql:4812). Resolution: say whether the wrapper uses an admin fetch after a messaging permission check, or whether bulk-message users must also have `events:view`; also define whether the dropdown includes all events or only a subset.

5. `FIL1`, `FIL7`  
Issue: the UI library does not already have the exact controls the spec assumes. [FilterPanel.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/display/FilterPanel.tsx:248) renders native `Select`, and [SearchInput.tsx](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/components/ui-v2/forms/SearchInput.tsx:100) does not by itself solve debounced fetching for fully controlled multi-filter state. Resolution: build a small event combobox and use a debounced derived filter state before calling the server action.

6. `LIST2`, `EDGE3`  
Issue: the spec contradicts itself on the default/empty state. The filter table defaults SMS opt-in to `Opted In`, but the recipient section says “Apply filters to find recipients,” while the edge-case table says clearing filters shows all opted-in recipients. Resolution: pick one behavior. Given the rest of the spec, auto-loading the default eligible audience is the cleaner option.

7. `ACT1`  
Issue: the pseudo-code uses a helper that does not exist. The real server helper is [createClient()](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/lib/supabase/server.ts:5). Resolution: implement `fetchBulkRecipients` with `createClient()`.

8. `RPC5`  
Issue: the RPC security pattern is incomplete. Newer security-definer functions in this repo use `SET search_path = public`, for example [20260420000025_event_booking_rebook_after_cancel.sql](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/supabase/migrations/20260420000025_event_booking_rebook_after_cancel.sql:11). Resolution: add `SET search_path = public` to the new RPC.

9. `FLOW1`  
Issue: the send-flow section points to the wrong file for `enqueueBulkSMSJob`; the action is defined in [job-queue.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/src/app/actions/job-queue.ts:32), not `sms-bulk-direct.ts`. Resolution: fix the file reference and keep the page-level threshold branch exactly as written.

10. `FILE1`, `TEST1`, `TEST2`, `TEST3`  
Issue: the spec’s file and test plan is incomplete. It omits replacing the current route regression test in [bulkCustomersRouteMarketingEligibility.test.ts](/Users/peterpitcher/Cursor/OJ-AnchorManagementTools/tests/api/bulkCustomersRouteMarketingEligibility.test.ts:1) and does not add coverage for the new action/client/RPC contract. Resolution: update the file plan to remove or replace route tests, add action tests for auth/permission/RPC mapping, and add regression cases for eligibility alignment, booking semantics, and the 100/101 send split.

11. `EDGE4`  
Issue: “parameterized `ILIKE`” is not the same as literal special-character matching. It prevents injection, but `%` and `_` still behave as wildcards. Resolution: either escape wildcard characters in the RPC or document that wildcard semantics are intentional.
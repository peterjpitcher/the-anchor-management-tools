---
phase: quick
plan: 260628-mde
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/actions/sms.ts
  - tests/actions/smsActions.test.ts
autonomous: true
requirements: [SEC-DEADCODE-01]
must_haves:
  truths:
    - "The ungated sendOTPMessage server action no longer exists in the codebase"
    - "The remaining gated SMS actions (sendSms, sendBulkSMSAsync) still work and are still tested"
    - "Lint, typecheck, and the SMS action test suite all pass after removal"
  artifacts:
    - path: "src/app/actions/sms.ts"
      provides: "SMS server actions with sendOTPMessage removed, gated siblings intact"
      contains: "sendSms"
    - path: "tests/actions/smsActions.test.ts"
      provides: "SMS action tests with sendOTPMessage cases removed, sibling tests intact"
      contains: "sendBulkSMSAsync"
  key_links:
    - from: "src/app/actions/sms.ts"
      to: "tests/actions/smsActions.test.ts"
      via: "import statement"
      pattern: "sendOTPMessage"
      note: "After removal, the string sendOTPMessage MUST NOT appear in either file"
---

<objective>
Delete the dead, ungated server action `sendOTPMessage` from `src/app/actions/sms.ts` and its associated test cases from `tests/actions/smsActions.test.ts`.

Purpose: `sendOTPMessage` is a security liability — it is a `'use server'` action that uses the RLS-bypassing service-role client (`createAdminClient()`) with NO `supabase.auth.getUser()`, NO `checkUserPermission()`, and NO rate limiter, yet it writes a customer record and sends an SMS to a caller-supplied phone number and message. It has ZERO production callers (verified repo-wide). Removing it eliminates an exploitable, unauthenticated SMS/customer-write surface with no functional cost.

Output: A smaller `sms.ts` with the dead action gone, a `smsActions.test.ts` with only the dead-action tests removed, and a green verification pipeline.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

# Files to edit
@src/app/actions/sms.ts
@tests/actions/smsActions.test.ts

<facts>
<!-- All verified before planning. Trust these — no codebase exploration needed for scoping. -->

- `src/app/actions/sms.ts` is a `'use server'` file. `export async function sendOTPMessage(params: { phoneNumber: string; message: string; customerId?: string })` spans approximately lines 170-246.
- Inside sendOTPMessage: it calls `createAdminClient()` (service role, bypasses RLS) with NO `supabase.auth.getUser()`, NO `checkUserPermission()`, and NO `rateLimiters.sms` — then writes a customer via `ensureCustomerForPhone` and sends an SMS via `sendSMS`.
- Verified repo-wide: the ONLY references to `sendOTPMessage` are its definition (sms.ts:170) and the test file (import on line 47; test blocks around lines 175, 191, 201, 237). ZERO production callers, no API route, no dynamic dispatch.
- Siblings `sendSms` and `sendBulkSMSAsync` in the SAME file ARE correctly gated (checkUserPermission + rateLimiters.sms). They MUST NOT be touched. No shared helper is removed by deleting sendOTPMessage.
- This mirrors a previously completed quick task (260610-bop) that deleted dead unauthenticated RLS-bypassing phone-cleanup actions — same pattern, same approach.
</facts>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Remove sendOTPMessage action and its tests</name>
  <files>src/app/actions/sms.ts, tests/actions/smsActions.test.ts</files>
  <action>
Delete the dead, ungated `sendOTPMessage` server action and its tests. Two surgical edits, nothing else.

**1. `src/app/actions/sms.ts`**
- Delete the entire `export async function sendOTPMessage(...) { ... }` block (approximately lines 170-246). Confirm the exact start/end lines by reading the file first — delete from the function's leading export/doc-comment through its closing brace, leaving no orphaned comment or blank-line cluster.
- Do NOT touch `sendSms`, `sendBulkSMSAsync`, or any shared imports/helpers. After deletion, check whether any import (e.g. `createAdminClient`, `ensureCustomerForPhone`) is now unused ONLY by the deleted function. Note: `@typescript-eslint/no-unused-vars` is OFF in this project, so an unused import will NOT fail lint — but if an import becomes genuinely orphaned (used nowhere else in the file), remove it for cleanliness. Verify usage elsewhere in the file before removing any import.

**2. `tests/actions/smsActions.test.ts`**
- Remove `sendOTPMessage` from the import statement on line 47 (keep `sendSms` / `sendBulkSMSAsync` and any other imports intact).
- Delete ONLY the test cases that exercise `sendOTPMessage` (the blocks around lines 175, 191, 201, 237). If those cases live inside a `describe('sendOTPMessage', ...)` wrapper, remove the whole wrapper. Leave all `sendSms` / `sendBulkSMSAsync` tests untouched.

**Final guard:** after both edits, the literal string `sendOTPMessage` must not appear anywhere in either file (or anywhere in the repo). Do not add replacement code, do not refactor the gated siblings, do not change behaviour of anything that remains.
  </action>
  <verify>
<automated>! grep -rn "sendOTPMessage" src/ tests/ && npm run lint && npx tsc --noEmit && npx vitest run tests/actions/smsActions.test.ts</automated>
  </verify>
  <done>
`grep -rn "sendOTPMessage" src/ tests/` returns no matches. `npm run lint` passes with zero warnings. `npx tsc --noEmit` is clean. `npx vitest run tests/actions/smsActions.test.ts` passes with all remaining (sendSms / sendBulkSMSAsync) tests green. `sendSms` and `sendBulkSMSAsync` are unchanged.
  </done>
</task>

</tasks>

<verification>
- Repo-wide: `grep -rn "sendOTPMessage" src/ tests/` returns nothing.
- `npm run lint` — zero warnings (enforced via --max-warnings=0).
- `npx tsc --noEmit` — clean compile.
- `npx vitest run tests/actions/smsActions.test.ts` — all remaining tests pass.
- Manual diff review: only the sendOTPMessage function and its tests/import were removed; sendSms and sendBulkSMSAsync are byte-for-byte unchanged.
</verification>

<success_criteria>
- The `sendOTPMessage` server action is fully removed from `src/app/actions/sms.ts`.
- Its import and test cases are removed from `tests/actions/smsActions.test.ts`.
- No other code is modified; gated SMS actions remain intact and tested.
- All three verification commands (lint, typecheck, targeted vitest) pass.
</success_criteria>

<output>
After completion, create `.planning/quick/260628-mde-delete-dead-ungated-server-action-sendot/260628-mde-SUMMARY.md`
</output>

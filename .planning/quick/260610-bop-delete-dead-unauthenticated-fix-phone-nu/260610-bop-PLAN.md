---
phase: quick
plan: 260610-bop
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/actions/fix-phone-numbers.ts
autonomous: true
requirements: [F5]
must_haves:
  truths:
    - "The unauthenticated phone-cleanup server actions no longer exist in the codebase"
    - "Production typecheck and lint pass with zero warnings after removal"
    - "No source or script references the deleted module"
  artifacts:
    - path: src/app/actions/fix-phone-numbers.ts
      provides: "REMOVED - file must NOT exist after this plan"
  key_links: []
---

<objective>
Delete `src/app/actions/fix-phone-numbers.ts` - a dead, one-off phone-cleanup server-action file that exposes two `'use server'` actions (`analyzePhoneNumbers`, `fixPhoneNumbers`) which call `createAdminClient()` (RLS bypass) and write to `customers.mobile_number` with NO `getUser()` / `checkUserPermission()` guard. This is audit finding F5 in `docs/audits/2026-06-10-application-review.md`.

Purpose: Close a latent security hole. Because `'use server'` actions are reachable as RPC endpoints, this code path could trigger an unauthenticated mass UPDATE of customer phone numbers via the service-role (RLS-bypassing) client. The file has zero importers, so deletion is the correct fix (locked decision) rather than retro-fitting an auth guard onto code nobody uses.

Output: The file removed from the repo; typecheck and lint remain green; a conventional commit recording the security rationale.
</objective>

<execution_context>
@~/.claude/get-shit-done/workflows/execute-plan.md
@~/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md

Evidence already gathered by the orchestrator (do NOT re-investigate - proceed to deletion):

1. The file src/app/actions/fix-phone-numbers.ts (221 lines) begins with 'use server' and exports
   analyzePhoneNumbers and fixPhoneNumbers. Both obtain a Supabase client via createAdminClient()
   (service role, bypasses RLS) and fixPhoneNumbers runs an UPDATE of mobile_number against the
   customers table. Neither calls supabase.auth.getUser() nor checkUserPermission(). Audit finding F5.

2. Zero importers. grep across src/ and scripts/ for "fix-phone-numbers", "analyzePhoneNumbers", and
   "fixPhoneNumbers" matches ONLY the file itself. Dead since June 2025.

3. The one-off data cleanup is finished. Live DB checked read-only on 2026-06-10: of 801 customers
   with a mobile_number, 758 are already E.164 +44; 0 rows match any format the script's
   standardizePhoneNumber() can fix; the remaining 43 are formats the script itself classifies as
   unfixable. Nothing left for this script to do.

4. Ongoing normalisation is handled at write time by formatPhoneForStorage() (libphonenumber-js) per
   project conventions - see workspace CONVENTIONS, "Phone Numbers".

Locked decision (do NOT revisit): DELETE the file. Do not add auth guards, do not preserve it as a
script, do not comment it out - remove it entirely.
</context>

<tasks>

<task type="auto">
  <name>Task 1: Delete the dead unauthenticated phone-cleanup action file (F5)</name>
  <files>src/app/actions/fix-phone-numbers.ts</files>
  <action>
Delete the file src/app/actions/fix-phone-numbers.ts outright using git, so the removal is staged:

    git rm src/app/actions/fix-phone-numbers.ts

Rationale (per F5): the file is a 'use server' module whose fixPhoneNumbers action performs a
service-role (RLS-bypassing) UPDATE on customers.mobile_number with no getUser() /
checkUserPermission() check - a latent unauthenticated admin-write endpoint. It has zero importers
and the one-off cleanup it was written for is already complete (live DB verified). Per the locked
decision, remove the file entirely - do NOT add an auth guard, comment it out, or convert it to a
standalone script.

Do NOT touch any other file. There are no importers to update, no barrel exports to prune
(src/app/actions/ does not use barrel exports per project conventions), and no documentation that
references these symbols other than the audit report itself (docs/audits/, which should stay intact).
  </action>
  <verify>
    <automated>test ! -e src/app/actions/fix-phone-numbers.ts</automated>
  </verify>
  <done>src/app/actions/fix-phone-numbers.ts no longer exists on disk and is staged for removal in git.</done>
</task>

<task type="auto">
  <name>Task 2: Verify no stragglers, then typecheck and lint the codebase</name>
  <files>(verification only - no files modified)</files>
  <action>
Confirm the deletion left no dangling references and that the project still compiles and lints clean.
Run each step and stop at the first failure.

Step 1 - no surviving references. Grep src/ and scripts/ (NOT docs/, which holds the audit report)
for the deleted module and its exported symbols. Run inside the context-mode sandbox via ctx_execute
(language shell) to keep raw output out of context. Expect ZERO matches:

    grep -rn -e fix-phone-numbers -e analyzePhoneNumbers -e fixPhoneNumbers src/ scripts/

If anything matches, STOP - there is an importer the orchestrator's evidence missed. Surface the
match rather than proceeding.

Step 2 - typecheck the whole project. The deleted file is server-side TypeScript, so tsc is the
authoritative check that nothing imported it. Must exit 0:

    npx tsc --noEmit

Step 3 - lint with zero warnings enforced (project gate; npm run lint runs ESLint with
--max-warnings=0). Must exit 0:

    npm run lint

The full Vitest suite is intentionally NOT required: the file had zero importers and no test
exercised it, so there is no behaviour to re-verify beyond compilation and lint.

Step 4 - commit. Use a conventional commit that explains the security WHY, and include the deletion
plus this plan file:

    git add .planning/quick/260610-bop-delete-dead-unauthenticated-fix-phone-nu/260610-bop-PLAN.md
    git commit -m "fix(security): delete dead unauthenticated phone-cleanup actions (audit F5)" -m "Remove src/app/actions/fix-phone-numbers.ts: a 'use server' module whose fixPhoneNumbers action did a service-role (RLS-bypassing) UPDATE of customers.mobile_number with no getUser()/checkUserPermission() guard - a latent unauthenticated admin-write endpoint. Zero importers; the one-off cleanup is complete (live DB verified, 0 fixable rows) and ongoing normalisation is handled at write time by formatPhoneForStorage()."

If the working tree carries unrelated staged changes you did not create, do NOT bundle them - commit
only the deleted action file and this plan.
  </action>
  <verify>
    <automated>npx tsc --noEmit</automated>
    <automated>npm run lint</automated>
  </verify>
  <done>grep over src/ and scripts/ returns no matches for the module or its symbols; tsc and lint both exit 0; the deletion is committed with a conventional security-rationale message.</done>
</task>

</tasks>

<verification>
- File gone: `test ! -e src/app/actions/fix-phone-numbers.ts` succeeds.
- No dangling references: grep for `fix-phone-numbers`, `analyzePhoneNumbers`, `fixPhoneNumbers` over `src/` and `scripts/` returns nothing.
- Typecheck clean: `npx tsc --noEmit` exits 0.
- Lint clean: `npm run lint` exits 0 (zero warnings enforced).
- Committed with a conventional `fix(security): ...` message that states the F5 rationale.
</verification>

<success_criteria>
- src/app/actions/fix-phone-numbers.ts no longer exists in the repository.
- The latent unauthenticated, RLS-bypassing customer phone-number write path (audit F5) is gone.
- `npx tsc --noEmit` and `npm run lint` both pass, confirming nothing depended on the removed file.
- A single conventional commit records the deletion and the security reason.
</success_criteria>

<output>
After completion, create `.planning/quick/260610-bop-delete-dead-unauthenticated-fix-phone-nu/260610-bop-SUMMARY.md`
</output>

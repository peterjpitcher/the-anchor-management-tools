---
phase: quick
plan: 260610-bop
subsystem: security
tags: [security, server-actions, rls, dead-code, customers]
requirements: [F5]
provides:
  - "Removal of latent unauthenticated, RLS-bypassing customer phone-number write path (audit F5)"
requires: []
affects:
  - src/app/actions/
tech-stack:
  added: []
  patterns:
    - "Dead 'use server' modules are an attack surface (reachable as RPC) and must be deleted, not left dormant"
key-files:
  created: []
  modified: []
  deleted:
    - src/app/actions/fix-phone-numbers.ts
decisions:
  - "DELETE the file entirely (locked decision) rather than retro-fit a getUser()/checkUserPermission() guard onto code with zero importers"
metrics:
  duration: 4min
  tasks: 2
  files: 1
  completed: "2026-06-10"
---

# Phase quick Plan 260610-bop: Delete Dead Unauthenticated Phone-Cleanup Actions Summary

Deleted `src/app/actions/fix-phone-numbers.ts`, a dead one-off `'use server'` module whose `fixPhoneNumbers` action performed a service-role (RLS-bypassing) `UPDATE` of `customers.mobile_number` with no `getUser()` / `checkUserPermission()` guard — closing audit finding F5 (a latent unauthenticated admin-write endpoint reachable as an RPC).

## What Was Done

### Task 1: Delete the dead unauthenticated phone-cleanup action file (F5)
- Removed `src/app/actions/fix-phone-numbers.ts` (221 lines) via `git rm`, staging the deletion.
- The file exported `analyzePhoneNumbers` and `fixPhoneNumbers`, both obtaining a Supabase client via `createAdminClient()` (service role, bypasses RLS); `fixPhoneNumbers` ran an `UPDATE` of `mobile_number` against `customers` with no auth/permission check.
- Verify gate `test ! -e src/app/actions/fix-phone-numbers.ts` passed.
- Commit: `98dadb72`

### Task 2: Verify no stragglers, then typecheck and lint
- **Straggler grep** over `src/` and `scripts/` for `fix-phone-numbers`, `analyzePhoneNumbers`, `fixPhoneNumbers`: **0 matches** (grep exit code 1, no output). Confirms zero importers. `docs/` deliberately excluded so the audit report stays intact.
- **`npx tsc --noEmit`**: exit code **0**, zero output lines — nothing depended on the removed file.
- **`npm run lint`** (ESLint with `--max-warnings=0`): exit code **0**, zero warnings/errors.
- The full Vitest suite was intentionally not run: the file had zero importers and no test exercised it, so there is no behaviour to re-verify beyond compilation and lint.
- Deletion + plan file committed together in `98dadb72`.

## Verification Results (actual command output)

| Gate | Command | Result |
|------|---------|--------|
| File gone | `test ! -e src/app/actions/fix-phone-numbers.ts` | PASS |
| No stragglers | `grep -rn -e fix-phone-numbers -e analyzePhoneNumbers -e fixPhoneNumbers src/ scripts/` | 0 matches (exit 1) |
| Typecheck | `npx tsc --noEmit` | exit 0, 0 lines output |
| Lint | `npm run lint` | exit 0, 0 warnings |

## Deviations from Plan

None — plan executed exactly as written.

The plan suggested running the straggler grep inside the context-mode sandbox; it was instead run via the standard Bash tool because the output was a single integer exit code (zero matches), well under the context-flooding threshold. The verification result is identical: zero references.

## Authentication Gates

None.

## Known Stubs

None. This plan removed code; it added no UI, data sources, or placeholders.

## Commits

- `98dadb72`: `fix(security): delete dead unauthenticated phone-cleanup actions (audit F5)` — removes `src/app/actions/fix-phone-numbers.ts` and adds this plan file.

## Notes

- Ongoing phone-number normalisation remains handled at write time by `formatPhoneForStorage()` (libphonenumber-js) per project conventions — no functional regression from this deletion.
- The one-off cleanup the script was written for is complete: live DB verified read-only on 2026-06-10 (758 of 801 mobile numbers already E.164 `+44`; 0 rows fixable by the script; the remaining 43 are formats the script itself classifies as unfixable).

## Self-Check: PASSED

- `src/app/actions/fix-phone-numbers.ts` confirmed gone from disk and shows `221 deletions` in commit `98dadb72`.
- Commit `98dadb72` found in git history.
- `260610-bop-SUMMARY.md` exists.

# Claude Hand-Off Brief: Private Booking Delete — Cancelled Booking Fix

**Generated:** 2026-04-23
**Review mode:** B (Code Review)
**Overall risk:** Low

## DO NOT REWRITE

- The three-layer bypass for `status = 'cancelled'` — structurally correct across all layers
- The eligibility check's early return for cancelled bookings (`privateBookingActions.ts:479-487`)
- The service mutation's conditional SMS gate skip (`mutations.ts:1374`)
- The DB trigger's `OLD.status = 'cancelled'` early return (`20260623000000:11-13`)
- The existing SMS gate logic for non-cancelled bookings — unchanged and correct

## SPEC REVISION REQUIRED

None.

## IMPLEMENTATION CHANGES REQUIRED

None — all reviewer findings were investigated and resolved:

- [x] AB-002 (orphaned SMS rows): Confirmed `ON DELETE CASCADE` on FK — no orphan risk
- [x] AB-001/SEC-001/SEC-002 (cancelled ≠ notified): All app cancel paths send SMS — accepted residual risk for direct SQL only
- [x] WF-001 (deploy ordering): Existing pipeline runs migrations before app deploy
- [x] SEC-003 (race condition): DB trigger closes the race within the transaction

## ASSUMPTIONS TO RESOLVE

None — all assumptions verified against codebase.

## REPO CONVENTIONS TO PRESERVE

- `supabase/.temp/gotrue-version` and `storage-version` should NOT be committed (AB-005)
- Changes manifest is session-managed — truncation is expected (AB-004)

## RE-REVIEW REQUIRED AFTER FIXES

None — no code changes recommended.

## REVISION PROMPT

No revisions needed. The fix is ready for commit and deploy.

# Changes Log — BOH Table Bookings Filter + Auto-Cancel Cron

Date: 2026-03-15

---

## DEFECT-001 — Cancelled bookings never visible in BOH UI

**File**: `src/app/api/boh/table-bookings/route.ts`

**Changes**:
1. Removed `statusFilterRaw` variable (was reading `?status=` param the client never sends)
2. Removed `searchQuery` variable (was reading `?q=` param the client never sends)
3. Removed `parsedStatusFilters` Set construction
4. Removed `showingCancelledExplicitly` boolean
5. Removed the entire `.filter()` block (lines ~522–540) — it was the code stripping cancelled bookings from every response because `showingCancelledExplicitly` was always `false`
6. Preserved the `.sort()` at the end of the chain

**Result**: Route now returns ALL bookings for the date range. Client-side `useMemo` in `BohBookingsClient.tsx` handles all status filtering correctly.

**Test cases satisfied**:
- TC001: Cancelled filter now shows cancelled bookings (server no longer strips them)
- TC002: All-statuses view no longer hides cancelled bookings
- TC003: Search for Loveridge will find TB-8BAA3C8F (data reaches the client)

---

## DEFECT-002 + DEFECT-003 — Auto-cancellation cron ignores `deposit_waived` + no audit trail

**File**: `src/app/api/cron/table-booking-deposit-timeout/route.ts`

**Changes**:
1. Added `import { logAuditEvent } from '@/app/actions/audit'`
2. Added `deposit_waived` to the SELECT columns
3. Added `.eq('deposit_waived', false)` filter to the Supabase query — bookings with a waived deposit are now excluded from auto-cancellation entirely at the DB level
4. Added `logAuditEvent()` call after each successful cancellation, logging `operation_type: 'table_booking.auto_cancelled'` with booking ID, reference, and reason

**Result**: Bookings with `deposit_waived = true` are never touched by the cron. Every auto-cancellation now has an audit trail entry.

**Test cases satisfied**:
- TC010: `deposit_waived=true` bookings are skipped (DB filter excludes them before the loop)
- TC012: `deposit_waived=false` bookings past 24h are still cancelled correctly
- DEFECT-003: Every cancellation now writes `table_booking.auto_cancelled` to the audit log

---

## Root Cause of TB-8BAA3C8F (Jason Loveridge, 15 Mar 2026 17:00)

This booking had `deposit_waived = true` (no payment required) but remained in `pending_payment` status — correct behaviour. The cron's missing `deposit_waived = false` guard caused it to be auto-cancelled. Both defects are now fixed; a similar booking will not be cancelled again, and if any edge case fires, the audit trail will capture it.

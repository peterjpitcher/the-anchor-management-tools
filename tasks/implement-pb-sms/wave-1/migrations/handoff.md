# Wave 1 — Migrations + Legacy Cron Retirement Handoff

Agent: Migrations-Ops
Branch: feat/private-bookings-sms-redesign
Completed: 2026-04-18

## Commits created (7 total on branch; 5 owned by me)

Mine (in chronological order):
- `3be02365` feat(db): add post_event_outcome lifecycle columns to private_bookings (Task 1.1)
- `aa7b61ff` feat(db): add private_booking_outcome action to guest_tokens (Task 1.2)
- `333bdffd` feat(db): add private_booking_send_idempotency table (Task 1.3)
- `3af8aab8` feat(db): add delete-gate trigger on private_bookings (Task 1.4)
- `175a2870` chore(cron): retire post-event-followup and booking-balance-reminders (Task 1.7)

Parallel-agent commits interleaved on the branch (FYI, not mine):
- `fac83476` feat(sms): add sanitiseSmsVariable helper (Task 1.5 owner)
- `d3c966e1` feat(private-bookings): extract isBookingDateTbd helper (Task 1.6 owner)

## Migration files created

| File | Summary |
|---|---|
| `supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql` | Adds `post_event_outcome` (text, CHECK IN ('pending','went_well','issues','skip'), default 'pending'), `post_event_outcome_decided_at`, `outcome_email_sent_at`, `review_sms_sent_at` to `private_bookings`. Backfills `post_event_outcome='skip'` and `post_event_outcome_decided_at=review_processed_at` for rows where `review_processed_at IS NOT NULL`. |
| `supabase/migrations/20260418120100_pb_outcome_token_action.sql` | Replaces `guest_tokens_action_type_check` to add `'private_booking_outcome'` to the allowed values. **Preserves all 8 existing values**: `manage`, `sunday_preorder`, `card_capture`, `payment`, `review_redirect`, `charge_approval`, `waitlist_offer`, `private_feedback`. |
| `supabase/migrations/20260418120200_pb_send_idempotency.sql` | Creates `private_booking_send_idempotency(idempotency_key PK, booking_id FK→private_bookings ON DELETE CASCADE, trigger_type, window_key, created_at)` with indexes on `booking_id` and `created_at`, RLS enabled, policy = service-role only. |
| `supabase/migrations/20260418120300_pb_delete_gate_trigger.sql` | Creates `prevent_hard_delete_when_sms_sent()` function + `private_bookings_delete_gate` BEFORE DELETE trigger on `private_bookings`. Blocks when `status='sent'` OR (`status='approved'` AND `scheduled_for IS NOT NULL` AND `scheduled_for > now()`). Uses ERRCODE `check_violation`. |

## Critical Deviation from Plan (Task 1.2)

The plan template assumed the guest_tokens column was `action` and the constraint was `guest_tokens_action_check`. **Reality on this codebase**:

- Column is named **`action_type`** (not `action`).
- Authoritative constraint name is **`guest_tokens_action_type_check`** (established by `20260420000016_guest_token_sunday_preorder_action.sql`).
- The authoritative pre-existing action list is 8 values, not the 5 the plan suggested.

**My migration adapts accordingly**:
- Uses a `DO $$` block with `pg_catalog` lookup to drop ANY CHECK constraint on the column (resilient to historical naming drift), then re-adds `guest_tokens_action_type_check` with all 8 existing values + the new `'private_booking_outcome'`.
- Retains `'card_capture'` even though that feature was retired in `20260508000007`, because 2 live rows still use it (documented in that prior migration).

Downstream agents writing helpers that issue tokens with `action_type = 'private_booking_outcome'` must use `action_type`, not `action`, to match the real schema.

## Verification Performed

- `npx supabase db push --dry-run` ran after each migration — **all 4 succeeded**, listing only new migrations for application, no destructive ops flagged.
- `npm run build` — **PASS** (full Next.js build compiled after legacy cron routes removed).
- `npx tsc --noEmit` — **PASS clean** (empty output) after the build regenerated `.next/types/validator.ts`.

> Note: first run of `tsc` before the build showed 2 stale-type errors from `.next/types/validator.ts` still referencing the deleted route files. These auto-cleared after the next `npm run build` regenerated the route type manifest. This is a Next.js generated-types quirk; no source code edits required.

## Legacy Cron Retirement

Deleted directories (verified gone):
- `src/app/api/cron/post-event-followup/` (entire route dir)
- `src/app/api/cron/booking-balance-reminders/` (entire route dir)

`vercel.json` — removed the 2 matching cron entries. Crons array now has 28 entries (was 30), valid JSON, no trailing commas.

Verified no other source file references these two route paths before deletion (only docs/tasks/Obsidian notes reference them, which is expected).

## Concerns / Notes for Downstream Waves

1. **Pass 5 monitor guard** (Wave 4 reviewer): the existing `private-booking-monitor` cron still uses `review_processed_at` as its gate. Downstream Wave needs to migrate that gate to the new `post_event_outcome` lifecycle so the backfill (`skip` for already-processed rows) actually takes effect. Until that happens, the new columns are inert.

2. **Token action values** (Wave 2 email/token helpers): when creating `guest_tokens` for the manager outcome email, use `action_type: 'private_booking_outcome'` (NOT `action`). If any guest_tokens helper in `src/lib/guest/tokens.ts` uses a TS union type for action, that type must be extended to include `'private_booking_outcome'`.

3. **Idempotency key format**: `{booking_id}:{trigger_type}:{window_key}`. The `window_key` semantics are not enforced at DB level — downstream (Wave 2 monitor agent) must be consistent. Suggested conventions from the spec: e.g. `dep7d-2026-04-25`, `bal1d-2026-04-25`, `rev-2026-04-26`.

4. **Delete gate covers only `private_booking_sms_queue`**. If future email-scheduling work adds an analogous email queue, that table will need its own guard or the trigger body extended.

5. **Parallel-agent commits on branch**: Agents owning Tasks 1.5 (sanitiseSmsVariable) and 1.6 (isBookingDateTbd) landed commits interleaved with mine. I did not touch their files. If a later rebase is needed, the 5 commits I made are all `feat(db)` / `chore(cron)` and touch only migration SQL, vercel.json, and route files.

## Definition of Done Checklist

- [x] Four migration files exist with correct 20260418120000–20260418120300 timestamps.
- [x] Each migration has `BEGIN;` / `COMMIT;` wrapper.
- [x] Task 1.2 preserves all 8 existing guest_tokens action_type values.
- [x] Delete-gate trigger uses correct status semantics (status='sent' OR (status='approved' AND scheduled_for > now())).
- [x] `vercel.json` valid JSON, 28 cron entries, no trailing commas, both legacy entries removed.
- [x] Legacy cron directories deleted (`git status` shows them as `D`).
- [x] `npx tsc --noEmit` passes (clean after build regenerates types).
- [x] `npm run build` succeeds.
- [x] 5 commits made (4 migrations + 1 cron retirement), none pushed.
- [x] Handoff written (this file).

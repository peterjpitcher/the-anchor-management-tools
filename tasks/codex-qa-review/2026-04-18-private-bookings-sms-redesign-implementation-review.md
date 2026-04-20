# Private Bookings SMS Redesign Implementation Review

- 1. ✅ Verified — outcome GET never mutates. GET reads `guest_tokens` with `action_type = private_booking_outcome` and renders a confirmation form only (`src/app/api/private-bookings/outcome/[outcome]/[token]/route.ts:92`, `:107`, `:159`). POST does throttle/token validation and conditionally updates with `post_event_outcome = pending` (`:168`, `:219`, `:229`, `:230`).

- 2. ✅ Verified — legacy cron routes gone. `vercel.json` cron list has no `/api/cron/post-event-followup` or `/api/cron/booking-balance-reminders` entries (`vercel.json:95`, `:125`); no tracked route files exist for those paths. Replacement logic is in monitor Pass 3/5 (`src/app/api/cron/private-booking-monitor/route.ts:762`, `:952`).

- 3. ✅ Verified — review lifecycle coherent. Migration adds `post_event_outcome`, `post_event_outcome_decided_at`, `outcome_email_sent_at`, `review_sms_sent_at` and backfills processed rows to `skip` (`supabase/migrations/20260418120000_pb_sms_review_lifecycle.sql:13`, `:23`). Pass 5b filters/claims `post_event_outcome` + `review_sms_sent_at`, not `review_processed_at` (`route.ts:1026`, `:1031`, `:1053`).

- 4. ✅ Verified — delete gate uses real statuses. `deletePrivateBooking` blocks `status='sent'` or future `status='approved'` rows (`src/services/private-bookings/mutations.ts:1366`, `:1370`) before deleting (`:1383`).

- 5. ✅ Verified — refund model has four variants. `CancellationFinancialOutcome` exports all four required values (`src/services/private-bookings/financial.ts:17`). `cancelBooking` resolves/switches variants before queueing (`src/services/private-bookings/mutations.ts:152`, `:165`, `:178`, `:191`, `:1065`). Four templates exist (`src/lib/private-bookings/messages.ts:147`, `:156`, `:166`, `:176`).

- 6. ⚠️ Partial — review SMS claim is atomic; outcome email claim is not. `review_sms_sent_at` is conditionally claimed before send (`route.ts:1051`, `:1053`, `:1058`, `:1107`). But Pass 5a sends email first (`:984`) and only then stamps `outcome_email_sent_at` with `.is(..., null)` (`:992`, `:998`). Concurrent cron can duplicate manager emails.

- 7. ✅ Verified — `guest_tokens` reused. Outcome route reads/consumes `guest_tokens` with `action_type = private_booking_outcome` (`outcome route.ts:107`, `:111`, `:201`, `:205`, `:268`). Migration extends guest-token action type (`supabase/migrations/20260418120100_pb_outcome_token_action.sql:41`, `:53`). No `private_booking_outcome_tokens` table found.

- 8. ✅ Verified — stable idempotency key exists and is used. Table exists with PK `idempotency_key` (`supabase/migrations/20260418120200_pb_send_idempotency.sql:12`). Helper inserts and skips `23505` (`route.ts:97`, `:102`, `:115`). Passes 1/3/4 reserve before `queueAndSend` (`:532`, `:546`, `:822`, `:829`, `:906`, `:921`).

- 9. ✅ Verified — delete-gate DB trigger exists. Migration creates `prevent_hard_delete_when_sms_sent`, blocks `sent` or future `approved`, and attaches `BEFORE DELETE` trigger (`supabase/migrations/20260418120300_pb_delete_gate_trigger.sql:18`, `:21`, `:34`).

- 10. ✅ Verified — control-char sanitisation exists and is wired for names. `sanitiseSmsVariable` strips controls/collapses whitespace/caps length (`src/lib/sms/sanitise.ts:11`). `messages.ts` imports it and applies it through `name()` (`src/lib/private-bookings/messages.ts:2`, `:7`).

- 11. ✅ Verified — TBD helper exists and every monitor pass calls it. Helper wraps `DATE_TBD_NOTE`/`internal_notes` (`src/lib/private-bookings/tbd-detection.ts:15`). Passes 1, 2, 3, 4, 5a, 5b call it (`route.ts:481`, `:659`, `:727`, `:880`, `:972`, `:1046`).

- 12. ✅ Verified — tone refresh removed `"The Anchor:"` from target files. Exact grep had no matches in `mutations.ts`, `payments.ts`, or `private-booking-monitor/route.ts`. These paths now call shared builders (`mutations.ts:68`, `payments.ts:105`, `route.ts:539`, `:1101`).

- 13. ⚠️ Partial — Communications tab exists, but helper is not actually shared with cron and suppression reasons are incomplete. Page renders `CommunicationsTabServer` (`src/app/(authenticated)/private-bookings/[id]/communications/page.tsx:17`, `:89`); server calls `getBookingScheduledSms` (`src/components/private-bookings/CommunicationsTabServer.tsx:47`). Helper returns `ScheduledSmsPreview[]` (`src/services/private-bookings/scheduled-sms.ts:62`) and declares suppression reasons (`:28`), but comments reserve `stop_opt_out`/`policy_skip` as “not evaluated” (`:23`) and actual logic only emits date/flag/already-sent suppressions (`:336`). Its own comment says cron should migrate to it “in future” (`:42`).

- 14. ✅ Verified — manager email reuses `manager-notifications.ts`. `sendPrivateBookingOutcomeEmail` is exported there (`src/lib/private-bookings/manager-notifications.ts:466`), imports `sendEmail` (`:2`), uses `PRIVATE_BOOKINGS_MANAGER_EMAIL` (`:10`, `:558`), and cron calls it (`route.ts:12`, `:984`).

## BLOCKER

- B6 remains open: Pass 5a must atomically claim `outcome_email_sent_at` before sending, or concurrent cron runs can send duplicate manager outcome emails.
- Communications success criterion is not met: `getBookingScheduledSms` is UI-only today, explicitly not shared with cron, and does not implement declared `stop_opt_out` / `policy_skip` suppression reasons.

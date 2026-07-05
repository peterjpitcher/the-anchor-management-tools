# Discovery — Comms, Crons & Adjacent Areas vs SOP Pack

Agent: comms/crons audit. Base commit: 1e53841d.

## 1. Scheduled jobs

| Cron | Schedule | vercel.json |
|---|---|---|
| `/api/cron/private-booking-monitor` | daily 09:00 | :133 |
| `/api/cron/private-bookings-expire-holds` | daily 06:00 | :245 |
| `/api/cron/private-bookings-weekly-summary` | hourly, gated weekly London send | :189 |
| `/api/cron/paypal-deposit-reconciliation` | */15 min, no customer comms | :129 |

**private-booking-monitor** (`src/app/api/cron/private-booking-monitor/route.ts`), five passes:
- PASS 1 (:454) hold/deposit reminders: `deposit_reminder_7day` (diffDays<=7 && >1, :513,519), `deposit_reminder_1day` (:584,590). Whitelist :48–53 — **no 3-day reminder** (pack §10 requires 7/3/1).
- PASS 3 (:658) balance reminders: `if (![14,7,1].includes(daysUntilEvent)) continue` (:699) → `balance_reminder_14day/7day/1day` (:714–740). **Pack §13 requires 21/16/15/14 days before event.** Since balance is due at −14, the 7/1-day sends chase past-due balance (pack: missed deadline → manual GM review). **No immediate catch-up for late bookings** — booking created 13 days out skips 14-day reminder (exact-match; mirrored `src/services/private-bookings/scheduled-sms.ts:208,234`).
- PASS 4 (:813) event reminder 1d before (:834).
- PASS 5a (:904) morning-after outcome email to manager (:957); 5b (:986) review-request SMS gated on "went well" (:1115).

**expire-holds**: cancels drafts `hold_expiry < now` (:22–33), cancels queued SMS (:81–84), sends release confirmation SMS `bookingExpiredMessage` (:130–161). ✅ §10.7, but SMS-only and daily granularity (hold can sit ~24h past expiry).

## 2. Message templates

SMS templates code-defined in `src/lib/private-bookings/messages.ts` (no DB templates for private bookings; `message_templates` table serves events module). Emails: `src/lib/email/private-booking-emails.ts`.

**Contradictions vs pack:**
1. **Automatic full deposit retention <30 days** (pack §14: "may retain up to… reasonable and evidenced", GM approves):
   - `private-booking-emails.ts:413`: "If you cancel less than 30 days before the event, your deposit is non-refundable."
   - `messages.ts:183` (cancellation SMS): "the £X deposit is retained per our booking terms."
   - `contract-template.ts:466,467,514,515`: forfeiture / retained-in-full wording.
   - **Enforced in code**: `src/services/private-bookings/financial.ts:108–110,184–200` — `<30 days → 'non_refundable_retained'`, no GM review step (manual review only when `has_open_dispute`, :169).
2. **Balance due = event − 7 days, not 14**:
   - App default `src/services/private-bookings/mutations.ts:321–325`.
   - DB trigger `supabase/migrations/20260629000000_add_date_tbd_column.sql:21`, `20251123120000_squashed.sql:40`; column comment squashed.sql:3016.
   - Contradicts the app's own contract (14 days, `contract-template.ts:466,468`, fallback calc :113–122). Reminders quote the 7-day-derived date (`messages.ts:77`).
3. **Hold cap at event − 7 days** (pack: hold must not pass event − 14 without GM approval): `src/services/private-bookings/types.ts:79–94`, `mutations.ts:1491–1495`.
4. **Hold extension requires no reason**: `extendHold(id, days: 7|14|30, extendedBy?)` (`mutations.ts:1466–1469`).
5. **Refund SLA wording**: cancellation SMS promise refunds "within 10 working days" (`messages.ts:162,173`); pack has no cancellation-refund SLA (48h is post-event only — correctly stated in emails :210,274 and contract :508). Owner to confirm.

**Aligned:** £250 default (`mutations.ts:331`); deposit purpose wording; 14-day hold + cleared funds; deposit-separate-from-balance everywhere; 48h post-event refund; 5% calculated from deposit only (`financial.ts:184–190`).

## 3. Legacy language sweep (repo-wide)

- "credit card hold"/"card hold"/"holding deposit": 0 hits.
- "refuse service for any reason": 0 hits.
- "non-refundable" customer-facing: `private-booking-emails.ts:413`; `messages.ts:177–185`. (Events module placeholder `EventCategoryFormGrouped.tsx:753` + test fixture — separate module.)
- "ex VAT"/"excluding VAT": all in OJ Projects / invoices modules (B2B) — none in private-booking customer comms. Owner should spot-check invoice/quote PDFs show VAT + total payable (§12.3).
- "7 days before": events-module label (`MessageTemplatesClient.tsx:66`); comments documenting the hold cap; view label squashed.sql:2794 — plus the behavioural issues above.

## 4. Communications logging (§28.17)

- **Email**: `requireLog: true` + `privateBookingId` + commType (`private-booking-emails.ts:44–56`) → `email_messages` table with recipient/subject/status (`emailService.ts:65–105`; `logging.ts:75,116`); fails loudly if logging fails.
- **SMS**: `SmsQueueService.queueAndSend` → `private_booking_sms_queue` (:441–460,569–583) + `private_booking_audit` at queue/sent/failed (:405,525,600,679) + unified `messages` table (`sms/logging.ts:121`).
- **Gap**: no `contract_sent_at`/`sent_to`/`acceptance_method` anywhere. **Contract is never emailed by the app** — generated on demand only (`api/private-bookings/contract/route.ts`, version incremented :82–99). No stored PDF snapshot. Payment-before-contract flag impossible.

## 5. Confirmation / cancellation / release flows

- Confirmation email + ICS calendar invite present (`private-booking-emails.ts:171,303–353`; `payments.ts:145–171,256–259`; `mutations.ts:873–877`; resend `privateBookingActions.ts:2012`). Staff Google Calendar sync (`mutations.ts:453–457`).
- **Cancellation confirmation: SMS only** (5 outcome-specific messages, `mutations.ts:222–300,1152`). No cancellation email. **Dead code**: `sendBalanceReminderEmail`, `sendDepositRefundEmail`, `sendDepositRefundWithDeductionsEmail` non-exported, zero callers (`private-booking-emails.ts:451,519,581`).
- Release-of-hold confirmation present (SMS).
- **No privacy notice link and no complaints wording anywhere** in contract or customer emails (§26/§27/§28).

## 6. Adjacent areas for owner review

1. **Table bookings** — absolute-retention framing in customer SMS ("within 3 days, the deposit can't be refunded", `src/lib/table-bookings/bookings.ts:1327`; "refund will land within 5-10 days" :1326). Decide whether to adopt "may retain up to" posture.
2. **Events module** — per-category free-text `cancellationPolicy` shown to customers; placeholder suggests "Tickets are non-refundable…". Review stored category policies in DB.
3. **Invoices/quotes/OJ Projects** — Orange Jelly details + ex-VAT displays (B2B). §12.3: VAT + total payable must be clear before acceptance.
4. **GDPR/retention (§27)** — `exportUserData`/`deleteUserData` exist (`src/app/actions/gdpr.ts:12,71`); comms-retention + recruitment-retention crons exist. **No private-booking retention schedule** (7-year/18-month table), no dispute record-locking (only `has_open_dispute`), no allergy/accessibility anonymisation.
5. **Complaints (§26)** — **no complaints module exists** (only Resend spam webhook). Nearest hooks: post-event "issues" outcome email; private feedback funnel (`src/lib/private-bookings/feedback.ts`).
6. **the-anchor.pub website** — separate repo; AMS comms currently link to NO policy/privacy pages, so the gap is absent links, not stale ones.

## Top contradictions (priority order)

1. Balance due at event − 7 (trigger + app default) vs contract's promised 14 days.
2. Automatic full-deposit retention <30 days in code, SMS, email, contract.
3. Reminder schedules wrong: hold 7/1 (no 3-day); balance 14/7/1 post-due chasing (should be 21/16/15/14); no late-booking catch-up.
4. No contract send/acceptance tracking, no snapshot, contract never sent by app.
5. No privacy or complaints wording in any customer document/email.
6. Hold cap at −7 and extensions without mandatory reason.

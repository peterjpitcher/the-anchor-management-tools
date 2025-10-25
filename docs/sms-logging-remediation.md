# SMS Logging Remediation Plan

## Context
During discovery we catalogued every Twilio send path and noted several gaps where outbound messages might not land in the `messages` table (which feeds `/customers/:id`). This document captures the remediation work required plus suggested validation steps.

## Issues To Address
- `src/app/actions/sms.ts:232` – `sendOTPMessage` only records when `customerId` is provided, so OTPs sent before a contact is created never appear in timelines.
- `src/app/api/bookings/initiate/route.ts:181` & `src/app/api/bookings/confirm/route.ts:113` – initiation SMS lives in `pending_bookings.metadata.initial_sms`; if the flow never confirms, staff cannot see it.
- `src/app/actions/table-bookings.ts:578` & `:685` – direct inserts into `messages` ignore Supabase errors.
- `src/app/api/table-bookings/payment/return/route.ts:188` – same silent failure risk when logging PayPal confirmation SMS.
- `src/app/actions/sms-bulk-direct.ts:235` – bulk inserts log on failure but still report overall success.
- `src/lib/background-jobs.ts:283` & `src/lib/unified-job-queue.ts:336` – job processors treat `recordOutboundSmsMessage` failure as success.
- Hardcoded `from_number` values in immediate sends (`src/app/actions/table-bookings.ts:588`, `src/app/actions/table-bookings.ts:695`, `src/app/api/table-bookings/payment/return/route.ts:198`, `src/app/actions/sms-bulk-direct.ts:200`) ignore the actual from field when using a Messaging Service SID.
- Parking cron jobs (`src/app/api/cron/parking-notifications/route.ts:87` et al.) skip logging entirely if `customer_id` is missing; messages still send but never appear in timelines.

## Remediation Outline
1. **OTP Logging**
   - Resolve to the customer via phone or create a temporary record, then call `recordOutboundSmsMessage` with the resulting `customer_id`.
2. **Booking Initiation Visibility**
   - Either create a lightweight timeline entry at send time (with a placeholder customer linkage that updates later) or surface metadata in admin tooling so partial flows are visible.
3. **Immediate Table-Booking Logs**
   - Check the insert result and surface/log errors (including duplicates) so operators know when a send fails to persist.
4. **Payment Return Handler**
   - Mirror the above error handling, and ensure failures bubble back to monitoring or retry logic.
5. **Direct Bulk Sender**
   - Treat failed batch inserts as an error response (do not return success if `messages` insert fails); consider retrying with smaller batches.
6. **Job Queue Logging**
   - Add error handling around `recordOutboundSmsMessage` inside `processSendSms`, `processBulkSms`, and the unified queue to mark jobs failed/retry when logging breaks.
7. **Accurate `from_number`**
   - Capture `twilioMessage.from` (or fallback) in every manual insert so numbers remain consistent with Messaging Service sends.
8. **Parking Notifications Without Customer Links**
   - Backfill/ensure `customer_id` exists (create or map customer records) before logging, or store messages under a service customer to keep history intact.

## Validation Checklist
- Exercise each flow after fixes (OTP, booking initiation/confirmation, table-booking confirmation/payment, bulk sends, parking cron) and confirm new rows in `messages` with accurate `from_number`, `twilio_message_sid`, and metadata.
- Use Supabase logs or an automated test harness to simulate insert failures (duplicate SIDs, missing customer) and confirm the application now flags them.
- Send at least one SMS through a Messaging Service SID and verify `from_number` matches Twilio’s response.
- For parking notifications, craft a record without `customer_id` and confirm the remediation path still produces a visible timeline entry.

## Next Steps
Prioritise the fixes above, then schedule a regression test covering all SMS entry points before deployment. Consider adding automated tests around `recordOutboundSmsMessage` usage to catch future regressions.

# SMS Status Tracking Implementation

## 📑 Document Index
**Lines 1-50: Overview & Problem Statement**
- L5-15: Executive Summary
- L17-30: Root Cause Analysis
- L32-50: Solution Architecture

**Lines 51-150: Implementation Details**
- L51-80: Environment Configuration
- L81-120: SMS Sending Updates
- L121-150: Webhook Handler Improvements

**Lines 151-250: Database & Reconciliation**
- L151-180: Database Schema Updates
- L181-220: Reconciliation Process
- L221-250: Cron Job Configuration

**Lines 251-350: Testing & Monitoring**
- L251-280: Testing Strategy
- L281-310: Monitoring & Alerts
- L311-350: Troubleshooting Guide

---

## Executive Summary

The SMS status tracking system has been completely overhauled to properly track message delivery status using Twilio's webhook callbacks. Previously, messages were sent without the `statusCallback` parameter, leaving them perpetually marked as "queued" even when delivered.

### Key Changes
1. **Added `statusCallback` parameter** to all SMS sending functions
2. **Implemented idempotent webhook handler** with status progression guard
3. **Added hourly reconciliation** for missed callbacks
4. **Created comprehensive error tracking** with user-friendly messages
5. **Environment-aware webhook URLs** for development/staging/production

---

## Root Cause Analysis

### The Problem
Messages appeared "stuck" in queued status because:
- No `statusCallback` parameter in Twilio API calls
- Twilio never knew where to send status updates
- Database showed "queued" forever, even for delivered messages

### Affected Code Locations
1. `/src/lib/twilio.ts` - Core SMS utility
2. `/src/app/actions/messageActions.ts` - Customer reply function
3. `/src/app/api/bookings/initiate/route.ts` - Booking confirmations

---

## Solution Architecture

### Components
1. **Status Callback Configuration**: Centralized webhook URL management
2. **Status Progression Guard**: Prevents status regression from duplicate/out-of-order webhooks
3. **Error Tracking**: Captures and formats Twilio error codes
4. **Hourly Reconciliation**: Safety net for missed callbacks
5. **Comprehensive Testing**: Unit and integration tests

---

## Environment Configuration

### New Environment Variables
```env
# Webhook Base URL (defaults to NEXT_PUBLIC_APP_URL)
WEBHOOK_BASE_URL=https://management.orangejelly.co.uk

# Optional: Messaging Service SID (alternative to from number)
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# Development only - skip signature validation
SKIP_TWILIO_SIGNATURE_VALIDATION=true
```

### Environment Helper (`/src/lib/env.ts`)
- Smart URL detection for different environments
- Automatic fallback chain: WEBHOOK_BASE_URL → NEXT_PUBLIC_SITE_URL → NEXT_PUBLIC_APP_URL → VERCEL_URL
- Type-safe environment variable access
- Helper functions for feature detection

---

## SMS Sending Updates

### Before (No Status Tracking)
```typescript
await client.messages.create({
  body: message,
  from: fromNumber,
  to: phoneNumber
})
```

### After (With Status Tracking)
```typescript
await client.messages.create({
  body: message,
  from: fromNumber,
  to: phoneNumber,
  statusCallback: TWILIO_STATUS_CALLBACK,
  statusCallbackMethod: 'POST'
})
```

### Updated Files
1. **`/src/lib/twilio.ts`**
   - Added statusCallback to sendSMS function
   - Support for messaging service SID
   - Environment-aware configuration

2. **`/src/app/actions/messageActions.ts`**
   - Updated sendSmsReply with callbacks
   - Proper status mapping on save
   - Direction set to 'outbound-api'

3. **`/src/app/api/bookings/initiate/route.ts`**
   - Added webhook URL to booking SMS
   - Consistent with other sending methods

---

## Webhook Handler Improvements

### Idempotency & Order Protection
```typescript
// Status progression order
const STATUS_ORDER = {
  accepted: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  delivered: 4,
  failed: 4,  // Terminal states at same level
  undelivered: 4,
  canceled: 4
}

// Prevent regression
if (!isStatusUpgrade(current, new)) {
  // Log but don't update
  return { success: true, note: 'Status regression prevented' }
}
```

### Error Handling
- Captures ErrorCode and ErrorMessage from Twilio
- Formats error codes to user-friendly messages
- Handles missing message rows gracefully (returns 200 to stop retries)

---

## Database Schema Updates

### Migration: `20250821083439_add_sms_error_tracking.sql`

#### New Columns
- `error_code TEXT` - Twilio error code
- `error_message TEXT` - Human-readable error message
- `sent_at TIMESTAMPTZ` - When message was sent
- `delivered_at TIMESTAMPTZ` - When message was delivered
- `failed_at TIMESTAMPTZ` - When message failed

#### New Indexes
- `messages_twilio_sid_unique_idx` - Unique constraint on Twilio SID
- `messages_stuck_idx` - Partial index for reconciliation queries
- `message_delivery_status_message_created_idx` - History queries

---

## Reconciliation Process

### Script: `/scripts/reconcile-sms-status.ts`
- Runs hourly via cron job
- Finds messages stuck in queued/sent status
- Fetches actual status from Twilio API
- Updates database with correct status
- Handles rate limiting with delays

### Thresholds
- **Queued**: Stuck if > 1 hour old
- **Sent**: Stuck if > 2 hours old
- **Delivery Unknown**: Marked if sent > 6 hours without delivery

### API Endpoint: `/api/cron/reconcile-sms`
- Protected by CRON_SECRET
- Processes up to 50 messages per run
- Returns summary of updates
- Logs all changes for audit

---

## Cron Job Configuration

### Added to `vercel.json`
```json
{
  "path": "/api/cron/reconcile-sms",
  "schedule": "0 * * * *"  // Every hour
}
```

### Alternative Scheduling Options
- Supabase pg_cron (if available)
- GitHub Actions workflow
- External service (cron-job.org)

---

## Testing Strategy

### Unit Tests (`/tests/sms-status-tracking.spec.ts`)
1. **Status Mapping Tests**
   - All Twilio statuses map correctly
   - Unknown statuses handled gracefully
   - Case-insensitive handling

2. **Progression Guard Tests**
   - Valid progressions allowed
   - Regressions prevented
   - Idempotent updates work

3. **Error Formatting Tests**
   - Common error codes formatted
   - Unknown codes handled
   - Null/undefined handled

4. **Stuck Detection Tests**
   - Correct time thresholds
   - Direction filtering works
   - String/Date handling

### Integration Testing Checklist
- [ ] Send test SMS
- [ ] Verify webhook receives callback
- [ ] Check status updates in database
- [ ] Wait for reconciliation run
- [ ] Verify stuck messages recovered

---

## Monitoring & Alerts

### Key Metrics to Monitor
1. **Webhook Success Rate**
   - Query: `SELECT COUNT(*) FROM webhook_logs WHERE status = 'success'`
   - Alert if < 95% success rate

2. **Stuck Messages**
   - Query: `SELECT COUNT(*) FROM messages WHERE status IN ('queued','sent') AND created_at < NOW() - INTERVAL '2 hours'`
   - Alert if > 10 stuck messages

3. **Delivery Rate**
   - Track delivered vs failed ratio
   - Alert on unusual failure spikes

### Dashboard Queries
```sql
-- Daily SMS statistics
SELECT 
  DATE(created_at) as date,
  status,
  COUNT(*) as count
FROM messages
WHERE direction IN ('outbound', 'outbound-api')
GROUP BY DATE(created_at), status
ORDER BY date DESC, status;

-- Error analysis
SELECT 
  error_code,
  error_message,
  COUNT(*) as occurrences
FROM messages
WHERE error_code IS NOT NULL
GROUP BY error_code, error_message
ORDER BY occurrences DESC;
```

---

## Troubleshooting Guide

### Common Issues

#### 1. Messages Still Showing as Queued
**Check:**
- Webhook URL is accessible from internet
- Twilio signature validation not blocking
- statusCallback parameter present in sends

**Fix:**
```bash
# Test webhook manually
curl -X POST https://your-domain/api/webhooks/twilio \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "MessageSid=test&MessageStatus=delivered"

# Run reconciliation manually
tsx scripts/reconcile-sms-status.ts
```

#### 2. Webhook Signature Validation Failing
**Check:**
- TWILIO_AUTH_TOKEN is correct
- URL in signature matches actual URL
- No proxy modifying headers

**Fix:**
- Temporarily set SKIP_TWILIO_SIGNATURE_VALIDATION=true (dev only)
- Verify auth token matches Twilio console
- Use ngrok for local testing

#### 3. Reconciliation Not Running
**Check:**
- Cron job configured in vercel.json
- CRON_SECRET set correctly
- No errors in Vercel functions log

**Fix:**
```bash
# Test cron endpoint manually
curl https://your-domain/api/cron/reconcile-sms \
  -H "Authorization: Bearer YOUR_CRON_SECRET"
```

---

## Security Considerations

1. **Webhook Signature Validation**
   - Always enabled in production
   - Uses raw body for validation
   - Returns 401 for invalid signatures

2. **Rate Limiting**
   - Reconciliation limited to 50 messages per run
   - 100ms delay between Twilio API calls
   - Prevents API rate limit issues

3. **PII Protection**
   - Message bodies truncated in logs
   - Phone numbers can be partially masked
   - Old webhook logs auto-deleted after 90 days

---

## Migration Path

### For Existing Messages
1. Run initial reconciliation to update old messages
2. Mark very old queued messages as 'delivery_unknown'
3. Clear out test messages if needed

### Rollback Plan
If issues arise:
1. Remove statusCallback parameter from sends
2. Disable reconciliation cron job
3. Messages will function as before (stuck in queued)

---

## Success Metrics

### Target Performance
- ✅ 95% of messages show correct status within 5 minutes
- ✅ Zero status regressions from duplicate callbacks
- ✅ 100% of failed messages have error codes
- ✅ < 0.5% of messages stuck after reconciliation
- ✅ Webhook handler responds in < 500ms

### Monitoring Commands
```bash
# Check current queue status
tsx scripts/check-sms-queue.ts

# View webhook logs
tsx scripts/check-webhook-logs-new.ts

# Run reconciliation manually
tsx scripts/reconcile-sms-status.ts

# Test webhook endpoint
curl -X POST http://localhost:3000/api/webhooks/twilio \
  -d "MessageSid=test&MessageStatus=delivered"
```

---

## Future Enhancements

1. **Messaging Service Configuration**
   - Configure status callback URL in Twilio console
   - Acts as fallback if per-message callback missing

2. **Advanced Analytics**
   - Delivery rate by carrier
   - Time-to-delivery metrics
   - Geographic delivery patterns

3. **Proactive Monitoring**
   - Auto-retry failed messages
   - Alert on delivery anomalies
   - Customer-specific delivery health scores

---

## Conclusion

The SMS status tracking implementation resolves the critical issue of messages appearing stuck in "queued" status. With proper webhook callbacks, idempotent handling, and hourly reconciliation, the system now provides accurate, real-time delivery status for all SMS messages.

For questions or issues, check the webhook_logs table first, then run the reconciliation script manually if needed.
# Booking Flow Debug Summary - December 2024

## Overview
We've been debugging a critical issue where the booking initiation flow fails with a "null customer_id" error when trying to record SMS messages. The core problem is that during booking initiation, we're trying to record an SMS message for a customer that doesn't exist yet.

## Key Issue
**Error**: `null value in column 'customer_id' of relation 'messages' violates not-null constraint`

This occurs because:
1. New customers initiate bookings via API
2. The system tries to send and record an SMS
3. But the customer doesn't exist in the database yet
4. The messages table requires a non-null customer_id

## What We've Tried

### 1. Modified Booking Initiation Flow (Implemented)
**File**: `/src/app/api/bookings/initiate/route.ts`

**Changes Made**:
- Removed the call to `sendSms()` function (which requires customer_id)
- Implemented direct Twilio SMS sending without recording in messages table
- Store SMS details in `pending_bookings.metadata` for later recording
- Added comprehensive error tracking and debug information

**Key Code Changes**:
```typescript
// Instead of using sendSms() which requires customer_id:
// await sendSms(standardizedPhone, smsMessage);

// We now send directly via Twilio:
const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

const twilioMessage = await twilioClient.messages.create({
  body: smsMessage,
  to: standardizedPhone,
  from: process.env.TWILIO_PHONE_NUMBER
});

// Store SMS details for later recording
smsDetails = {
  message_sid: twilioMessage.sid,
  body: smsMessage,
  from_number: twilioMessage.from,
  to_number: twilioMessage.to,
  segments,
  cost_usd: costUsd,
  sent_at: new Date().toISOString(),
};

// Save to pending_bookings metadata
await supabase
  .from('pending_bookings')
  .update({
    metadata: {
      initial_sms: smsDetails,
    }
  })
  .eq('token', bookingToken);
```

### 2. Modified Booking Confirmation Flow (Implemented)
**File**: `/src/app/api/bookings/confirm/route.ts`

**Changes Made**:
- After creating the customer, record the deferred SMS message
- Pull SMS details from `pending_bookings.metadata.initial_sms`
- Record the message with the newly created customer_id

**Key Code**:
```typescript
// After customer is created, record the initial SMS
if (pendingBooking.metadata?.initial_sms) {
  const smsData = pendingBooking.metadata.initial_sms;
  await supabase
    .from('messages')
    .insert({
      customer_id: customerId, // Now we have a valid customer_id!
      direction: 'outbound',
      message_sid: smsData.message_sid,
      twilio_message_sid: smsData.message_sid,
      body: smsData.body,
      status: 'delivered',
      twilio_status: 'delivered',
      from_number: smsData.from_number,
      to_number: smsData.to_number,
      message_type: 'sms',
      segments: smsData.segments,
      cost_usd: smsData.cost_usd,
      created_at: smsData.sent_at,
      read_at: new Date().toISOString(),
    });
}
```

### 3. Created Diagnostic Tools

#### a. Comprehensive Booking Diagnosis Script
**File**: `/scripts/diagnose-booking-issues.ts`

This script checks:
- Recent pending bookings and their metadata
- Recent SMS messages and orphaned records
- Database constraints on messages table
- Audit logs for booking operations
- Webhook logs for SMS issues

**Key Finding**: All pending bookings show empty metadata `{}`, suggesting the code wasn't deployed properly.

#### b. Deployment Test Script
**File**: `/scripts/test-deployment.ts`

Checks deployment status and provides manual verification steps.

#### c. API Test Script
**File**: `/scripts/test-booking-api.ts`

Directly tests the booking initiation API with enhanced error reporting.

#### d. Environment Check Script
**File**: `/scripts/check-production-env.ts`

Guides through checking Vercel environment variables.

### 4. Enhanced Error Tracking (Latest Changes)
Modified the booking initiation endpoint to include:
- Detailed debug information in responses
- Tracking of all errors and warnings
- SMS attempt status
- Better error handling throughout

### 5. Created Action Plan
**File**: `/URGENT-ACTION-PLAN.md`

Comprehensive plan for fixing the issues, including:
- Deployment verification steps
- Emergency SQL migration option
- Success criteria
- Escalation paths

## Current Status

### What's Working:
- ✅ Code changes are committed to GitHub
- ✅ Deployment shows as successful (commit 3aee739)
- ✅ Other SMS functions work fine (Twilio credentials are valid)
- ✅ API endpoints are accessible

### What's Not Working:
- ❌ Booking initiation SMS not being sent
- ❌ Console.log statements not appearing in Vercel logs
- ❌ pending_bookings metadata remains empty
- ❌ No visible errors in logs

### Mysteries:
1. **Why aren't console.log statements appearing?** 
   - Vercel production logging doesn't always capture console.log
   - We've added structured error responses instead

2. **Why is metadata empty in pending_bookings?**
   - Could indicate code isn't actually running the new logic
   - Or database update is failing silently

3. **Why do other SMS functions work but not this one?**
   - Other functions use the `sendSms()` function with existing customer_id
   - This is the only flow trying to send SMS before customer exists

## Next Steps to Try

### 1. Test the Enhanced API Endpoint
```bash
# Add to .env.local:
# TEST_API_KEY=your-api-key
# TEST_EVENT_ID=your-event-id

tsx scripts/test-booking-api.ts
```

The enhanced error tracking will show:
- Detailed debug information
- Which Twilio environment variables are detected
- Exact error messages if SMS fails
- Summary of what was attempted

### 2. Check Actual Code Execution
Add a simple test endpoint to verify deployment:
```typescript
// /src/app/api/test-deployment/route.ts
export async function GET() {
  return Response.json({
    deployment: 'v2-with-fixes',
    timestamp: new Date().toISOString(),
    hasInitiateFixes: true
  });
}
```

### 3. Database Migration Option
If we need to quickly fix production:
```sql
-- Make customer_id nullable temporarily
ALTER TABLE messages ALTER COLUMN customer_id DROP NOT NULL;

-- Later, after fixing the code properly:
-- ALTER TABLE messages ALTER COLUMN customer_id SET NOT NULL;
```

### 4. Alternative Approach - Queue SMS
Instead of sending SMS immediately, queue it:
```typescript
// Queue SMS for processing after customer exists
await supabase.from('jobs').insert({
  type: 'send_booking_confirmation_sms',
  payload: {
    pending_booking_id: pendingBooking.id,
    phone: standardizedPhone,
    message: smsMessage
  },
  run_at: new Date(Date.now() + 60000) // 1 minute delay
});
```

## Key Learning
The fundamental issue is architectural: the system assumes all SMS messages have an associated customer, but the booking initiation flow violates this assumption. We've implemented a deferred recording approach, but need to verify it's actually deployed and running.

## Files Modified
1. `/src/app/api/bookings/initiate/route.ts` - Direct Twilio SMS, deferred recording
2. `/src/app/api/bookings/confirm/route.ts` - Record deferred SMS after customer creation
3. Created multiple diagnostic scripts in `/scripts/`
4. Created `/URGENT-ACTION-PLAN.md`

## Commit Reference
All changes committed in: 3aee739 (according to user, this deployed successfully)

## Important Note
User confirmed: "The twilio credentials work perfectly well for every other SMS function in the application"

This rules out credential issues and points to either:
1. Code not actually running in production
2. Silent failure in the try/catch blocks
3. Some other environmental difference

The enhanced error tracking added today should reveal the actual issue when tested.
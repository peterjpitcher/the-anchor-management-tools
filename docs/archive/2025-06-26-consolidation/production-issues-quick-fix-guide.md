# Quick Fix Guide: SMS and Google Calendar Issues

## 🚨 Immediate Actions Required

### Fix SMS (5 minutes)

1. **Run this SQL in Supabase Dashboard:**
```sql
-- Add missing columns to private_booking_sms_queue
ALTER TABLE private_booking_sms_queue 
ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS template_key VARCHAR(100),
ADD COLUMN IF NOT EXISTS message_body TEXT,
ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS twilio_message_sid VARCHAR(255),
ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ DEFAULT NOW();

-- Verify columns were added
SELECT column_name FROM information_schema.columns 
WHERE table_name = 'private_booking_sms_queue' 
ORDER BY ordinal_position;
```

2. **Verify Twilio Environment Variables in Vercel:**
   - Go to Vercel Dashboard → Your Project → Settings → Environment Variables
   - Ensure these are set:
     - `TWILIO_ACCOUNT_SID`
     - `TWILIO_AUTH_TOKEN`
     - `TWILIO_PHONE_NUMBER` (must start with +44 for UK)

### Fix Google Calendar (10 minutes)

1. **Add Environment Variables to Vercel:**
   ```
   GOOGLE_CALENDAR_ID=1f93cf916fd9f821b2cf49c471e92cabcd6a61a2461473c9a3ed1f9adf8e2635@group.calendar.google.com
   
   GOOGLE_SERVICE_ACCOUNT_KEY=<paste your corrected JSON here>
   ```

2. **Share Your Calendar:**
   - Go to Google Calendar
   - Find your calendar → Settings → Share with specific people
   - Add: `application-automation@anchor-management-tools.iam.gserviceaccount.com`
   - Permission: "Make changes to events"
   - Click "Send"

3. **Redeploy:**
   - After adding env vars, trigger a new deployment in Vercel

---

## 🧪 Testing

### Test SMS:
1. Create a new private booking with a phone number
2. Check Vercel Function logs for any errors
3. SMS should be sent immediately for bookings

### Test Calendar:
1. Visit: `https://management.orangejelly.co.uk/settings/calendar-test`
2. Click "Test Connection"
3. Create a private booking
4. Check your Google Calendar

---

## 📊 Verification Queries

Run these in Supabase SQL Editor to verify:

```sql
-- Check SMS queue status
SELECT 
  id,
  booking_id,
  status,
  trigger_type,
  customer_phone,
  created_at,
  message_body
FROM private_booking_sms_queue
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;

-- Check recent private bookings
SELECT 
  id,
  customer_name,
  customer_first_name,
  contact_phone,
  event_date,
  calendar_event_id,
  created_at
FROM private_bookings
WHERE created_at > NOW() - INTERVAL '1 hour'
ORDER BY created_at DESC;
```

---

## 🔍 If Still Not Working

### SMS Issues:
1. Check Vercel Logs:
   - Look for: "Error sending booking creation SMS"
   - Look for: "Twilio not configured"
   
2. Common errors:
   - "violates foreign key constraint" → booking_id doesn't exist
   - "null value in column" → missing required field
   - "Twilio not configured" → missing env vars

### Calendar Issues:
1. Check Vercel Logs:
   - Look for: "[Google Calendar] Configuration check"
   - Look for: "Failed to sync with Google Calendar"
   
2. Common errors:
   - "Invalid JSON" → Service account key not properly escaped
   - "403 Forbidden" → Calendar not shared with service account
   - "404 Not Found" → Wrong calendar ID

---

## 🛠️ Alternative: Disable Until Fixed

If you need to disable these features temporarily:

```typescript
// In privateBookingActions.ts, comment out:

// SMS sending
// const smsResult = await queueAndSendPrivateBookingSms({...})

// Calendar sync
// if (data && isCalendarConfigured()) {
//   try {
//     const eventId = await syncCalendarEvent(data)
//     ...
//   } catch (error) {...}
// }
```

---

## 📱 Contact for Help

If issues persist after following this guide:
1. Check Vercel Function Logs
2. Check Supabase Logs
3. Run the verification queries
4. Document any error messages

The issues are almost certainly configuration-related, not code bugs.
# Technical Analysis: SMS and Google Calendar Integration Issues

## SMS Integration Deep Dive

### Database Schema Mismatch

**Expected Schema (from code):**
```typescript
// From private-booking-sms.ts
const { error: insertError } = await supabase
  .from('private_booking_sms_queue')
  .insert({
    booking_id: data.booking_id,
    trigger_type: data.trigger_type,        // MISSING IN PROD
    template_key: data.template_key,        // MISSING IN PROD
    message_body: data.message_body,        // MISSING IN PROD
    customer_phone: data.customer_phone,    // MISSING IN PROD
    customer_name: data.customer_name,      // MISSING IN PROD
    recipient_phone: recipientPhone,
    status: 'pending',
    created_by: data.created_by,
    metadata: data.metadata || {},
    priority: data.priority || 10,
    scheduled_for: data.scheduled_for || new Date().toISOString()
  })
```

**Actual Production Schema (likely):**
```sql
-- Basic columns only
CREATE TABLE private_booking_sms_queue (
  id UUID PRIMARY KEY,
  booking_id UUID REFERENCES private_bookings(id),
  recipient_phone VARCHAR,
  status VARCHAR,
  created_at TIMESTAMP,
  created_by UUID,
  metadata JSONB
);
```

### Error Flow Analysis

1. **Silent Failure in Action:**
```typescript
// In privateBookingActions.ts
const smsResult = await queueAndSendPrivateBookingSms({...})

if (smsResult.error) {
  console.error('Error sending booking creation SMS:', smsResult.error)
  // ERROR IS LOGGED BUT NOT RETURNED TO USER
} else if (smsResult.sent) {
  console.log('Booking creation SMS sent successfully')
}
```

2. **Twilio Configuration Check:**
```typescript
// In sms.ts
if (!TWILIO_ACCOUNT_SID || !TWILIO_AUTH_TOKEN || 
    (!TWILIO_PHONE_NUMBER && !TWILIO_MESSAGING_SERVICE_SID)) {
  console.warn('Twilio not configured - skipping SMS send')
  return { success: false, error: 'SMS service not configured' }
  // RETURNS EARLY WITHOUT SENDING
}
```

### Verification Queries

```sql
-- Check if required columns exist
SELECT 
  column_name,
  data_type,
  is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'private_booking_sms_queue'
ORDER BY ordinal_position;

-- Check for failed SMS attempts
SELECT 
  id,
  booking_id,
  status,
  created_at,
  metadata
FROM private_booking_sms_queue
WHERE created_at > NOW() - INTERVAL '24 hours'
ORDER BY created_at DESC;
```

---

## Google Calendar Integration Deep Dive

### Configuration Flow

```typescript
// In google-calendar.ts
export function isCalendarConfigured(): boolean {
  const hasServiceAccount = !!(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY &&
    process.env.GOOGLE_CALENDAR_ID
  )
  
  const hasOAuth = !!(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN &&
    process.env.GOOGLE_CALENDAR_ID
  )
  
  return hasServiceAccount || hasOAuth
}
```

### Common Failure Scenarios

1. **Missing Environment Variables:**
```javascript
// This check happens BEFORE any API calls
if (isCalendarConfigured()) {
  try {
    const eventId = await syncCalendarEvent(data)
    // ...
  } catch (error) {
    console.error('Failed to sync with Google Calendar:', error)
    // FAILURE IS CAUGHT BUT NOT REPORTED
  }
}
// If not configured, this entire block is skipped silently
```

2. **JSON Parsing Error:**
```javascript
// Service account key must be properly escaped
const auth = new google.auth.GoogleAuth({
  credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
  // COMMON ERROR: Unescaped newlines in private key
})
```

3. **Permission Errors:**
```javascript
// 403 Error Response
{
  "error": {
    "errors": [{
      "domain": "calendar",
      "reason": "requiredAccessLevel",
      "message": "You need to have writer access to this calendar."
    }],
    "code": 403,
    "message": "You need to have writer access to this calendar."
  }
}
```

### Debugging Commands

```bash
# Test configuration locally with production vars
GOOGLE_SERVICE_ACCOUNT_KEY='...' \
GOOGLE_CALENDAR_ID='...' \
npx tsx scripts/debug-google-calendar.ts

# Check if service account can access calendar
curl -X GET \
  "https://www.googleapis.com/calendar/v3/calendars/${CALENDAR_ID}" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}"
```

---

## Environment Variable Requirements

### SMS (Twilio)
```bash
# Required for SMS
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx

# One of these is required
TWILIO_PHONE_NUMBER=+44xxxxxxxxxx  # OR
TWILIO_MESSAGING_SERVICE_SID=MGxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

### Google Calendar
```bash
# Option 1: Service Account (Recommended)
GOOGLE_SERVICE_ACCOUNT_KEY='{"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n",...}'
GOOGLE_CALENDAR_ID=xxxxxxxxxxxxxxxxxxxxxxxxxx@group.calendar.google.com

# Option 2: OAuth2
GOOGLE_CLIENT_ID=xxxxxxxxxxxx-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_REFRESH_TOKEN=1//xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
GOOGLE_CALENDAR_ID=primary  # or specific calendar ID
```

---

## Production Debugging Steps

### 1. Verify Environment Variables
```javascript
// Add temporary debug endpoint
app.get('/api/debug-config', async (req, res) => {
  res.json({
    sms: {
      configured: !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN),
      hasPhoneOrService: !!(process.env.TWILIO_PHONE_NUMBER || process.env.TWILIO_MESSAGING_SERVICE_SID)
    },
    calendar: {
      configured: isCalendarConfigured(),
      hasServiceAccount: !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY,
      hasCalendarId: !!process.env.GOOGLE_CALENDAR_ID
    }
  })
})
```

### 2. Check Database Schema
```sql
-- Get full table structure
SELECT 
  table_name,
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name IN ('private_booking_sms_queue', 'private_bookings')
ORDER BY table_name, ordinal_position;
```

### 3. Monitor Real-time Logs
- Vercel Dashboard → Functions → Real-time logs
- Look for:
  - `[privateBookingActions]` prefixed logs
  - `[Google Calendar]` prefixed logs
  - `[sendPrivateBookingSms]` prefixed logs
  - Database error messages

---

## Quick Fix Scripts

### Fix SMS Queue Table
```sql
-- Add missing columns if they don't exist
ALTER TABLE private_booking_sms_queue 
ADD COLUMN IF NOT EXISTS trigger_type VARCHAR(50),
ADD COLUMN IF NOT EXISTS template_key VARCHAR(100),
ADD COLUMN IF NOT EXISTS message_body TEXT,
ADD COLUMN IF NOT EXISTS customer_phone VARCHAR(20),
ADD COLUMN IF NOT EXISTS customer_name VARCHAR(255),
ADD COLUMN IF NOT EXISTS twilio_message_sid VARCHAR(255);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_sms_queue_status ON private_booking_sms_queue(status);
CREATE INDEX IF NOT EXISTS idx_sms_queue_created ON private_booking_sms_queue(created_at);
```

### Test Calendar Access
```javascript
// Quick test script
async function testCalendarAccess() {
  const { google } = require('googleapis')
  
  const auth = new google.auth.GoogleAuth({
    credentials: JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY),
    scopes: ['https://www.googleapis.com/auth/calendar']
  })
  
  const calendar = google.calendar({ version: 'v3', auth })
  
  try {
    const response = await calendar.calendarList.list()
    console.log('Calendars:', response.data.items)
  } catch (error) {
    console.error('Calendar access error:', error.message)
  }
}
```
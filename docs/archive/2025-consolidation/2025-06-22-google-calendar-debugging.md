# Google Calendar Integration Debugging Guide

## Overview
This document explains the debugging enhancements added to help diagnose Google Calendar integration issues with private bookings.

## Enhanced Logging

### 1. Configuration Check Logging
- **Location**: `isCalendarConfigured()` in `/src/lib/google-calendar.ts`
- **What it logs**: 
  - Whether calendar ID is set
  - Whether service account or OAuth is configured
  - Final configuration status
- **Log prefix**: `[Google Calendar]`

### 2. Authentication Logging
- **Location**: `getOAuth2Client()` in `/src/lib/google-calendar.ts`
- **What it logs**:
  - Which authentication method is being used
  - Service account details (client email, project ID)
  - Authentication success/failure

### 3. Calendar Sync Logging
- **Location**: `syncCalendarEvent()` in `/src/lib/google-calendar.ts`
- **What it logs**:
  - Booking details being synced
  - Event object preparation
  - Calendar API calls (create/update)
  - Success/failure with event IDs
  - Detailed error information with specific remediation steps

### 4. Private Booking Actions Logging
- **Location**: `/src/app/actions/privateBookingActions.ts`
- **What it logs**:
  - When calendar sync is triggered
  - Booking ID and configuration status
  - Calendar event ID storage success/failure
- **Log prefix**: `[privateBookingActions]`

## Debugging Tools

### 1. Browser-Based Calendar Test
- **URL**: `/settings/calendar-test`
- **Features**:
  - Test calendar connection with one click
  - Shows configuration status
  - Displays detailed error messages
  - Provides specific setup instructions based on error type
  - Shows calendar access role and permissions

### 2. Command Line Debug Script
- **Run**: `npm run tsx scripts/debug-google-calendar.ts`
- **Features**:
  - Checks all environment variables
  - Validates service account JSON format
  - Verifies calendar ID format
  - Provides setup instructions if not configured

### 3. API Test Endpoint
- **Endpoint**: `GET /api/test-calendar`
- **Features**:
  - Protected endpoint (requires admin/manager role)
  - Returns detailed connection status
  - Tests actual calendar API access
  - Verifies write permissions

## Common Issues and Solutions

### 1. "Calendar not found" (404 Error)
**Cause**: Incorrect GOOGLE_CALENDAR_ID
**Solution**: 
- Check the calendar ID in Google Calendar settings
- Use "primary" for the main calendar
- Or use full ID like "abc123@group.calendar.google.com"

### 2. "Permission denied" (403 Error)
**Cause**: Service account doesn't have calendar access
**Solution**:
1. Go to Google Calendar settings
2. Find your calendar → "Settings and sharing"
3. Under "Share with specific people", add the service account email
4. Grant "Make changes to events" permission

### 3. "Invalid JSON" 
**Cause**: Service account key not properly formatted
**Solution**:
1. Download service account key from Google Cloud Console
2. Convert to single line: `cat key.json | jq -c . | pbcopy`
3. Paste into .env.local as: `GOOGLE_SERVICE_ACCOUNT_KEY=<paste>`

### 4. Events not appearing
**Possible causes**:
- Wrong calendar ID (events going to different calendar)
- Timezone issues (events created in Europe/London timezone)
- Calendar sync disabled (check isCalendarConfigured())

## How to Debug

1. **Enable Console Logging**:
   - Open browser Developer Tools (F12)
   - Go to Console tab
   - Create/update a private booking
   - Look for logs starting with `[Google Calendar]` or `[privateBookingActions]`

2. **Check Database**:
   ```sql
   -- Check if calendar_event_id is being stored
   SELECT id, customer_name, event_date, calendar_event_id, created_at 
   FROM private_bookings 
   ORDER BY created_at DESC 
   LIMIT 10;
   ```

3. **Test Connection**:
   - Go to `/settings/calendar-test`
   - Click "Test Connection"
   - Review the detailed results

4. **Check Server Logs**:
   - In development: Check terminal where `npm run dev` is running
   - In production: Check Vercel function logs

## Environment Variables Required

```env
# Calendar ID (required)
GOOGLE_CALENDAR_ID=primary
# or
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com

# Authentication (one of these methods required)
# Method 1: Service Account (recommended)
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"-----BEGIN PRIVATE KEY-----\\n...\\n-----END PRIVATE KEY-----\\n","client_email":"..."}

# Method 2: OAuth2
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_REFRESH_TOKEN=your-refresh-token
```

## Calendar Event Format

Events are created with:
- **Title**: `[STATUS] - BookingRef - CustomerName @ The Anchor`
- **Location**: "The Anchor Pub"
- **Timezone**: Europe/London
- **Colors**: Draft (gray), Tentative (yellow), Confirmed (green), etc.
- **Reminders**: Email (24h before), Popup (1h before)
- **Description**: Includes customer details, phone, email, guest count, and booking link

## Testing Checklist

1. ✅ Run `npm run tsx scripts/debug-google-calendar.ts`
2. ✅ Visit `/settings/calendar-test` and click "Test Connection"
3. ✅ Create a test private booking
4. ✅ Check browser console for logs
5. ✅ Verify calendar_event_id in database
6. ✅ Check Google Calendar for the event
7. ✅ Update the booking and verify event updates
8. ✅ Delete the booking and verify event deletion
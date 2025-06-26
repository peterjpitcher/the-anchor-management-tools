# Production Issues Investigation Report

**Date:** June 22, 2025  
**Issues:** SMS and Google Calendar integration not working for private bookings  
**Status:** Investigation Complete

## Executive Summary

Two critical features are not functioning in production:
1. **SMS notifications** are not being sent when private bookings are created
2. **Google Calendar events** are not being created for private bookings

Both issues appear to be configuration/environment related rather than code defects. The code implementations are correct but are failing silently due to missing database columns, environment variables, or permissions.

---

## Issue 1: SMS Messages Not Sending

### Root Cause Analysis

#### Primary Cause: Missing Database Columns
The `private_booking_sms_queue` table is missing critical columns that the application expects:
- `trigger_type` (varchar)
- `template_key` (varchar) 
- `customer_phone` (varchar)
- `customer_name` (varchar)
- `twilio_message_sid` (varchar)
- `message_body` (text)

These columns are defined in migration `20250622_private_booking_sms_enhancements.sql` which is in the "already run" folder but apparently hasn't been executed in production.

#### Secondary Causes:
1. **Silent Failure Handling**: Errors are caught but only logged to console, not visible to users
2. **Missing Twilio Credentials**: If Twilio environment variables aren't set, SMS sending fails silently
3. **No User Feedback**: The UI doesn't indicate whether SMS was sent successfully

### Current Flow
```
1. User creates private booking
2. queueAndSendPrivateBookingSms() is called
3. Attempts to insert into private_booking_sms_queue table
4. INSERT fails due to missing columns
5. Error is logged to console but user sees no error
6. Booking is created successfully without SMS
```

### Proposed Solutions

#### Solution 1: Quick Fix - Run Missing Migration
**Approach:** Execute the missing migration to add required columns
- **Pros:** 
  - Minimal code changes required
  - Fixes the immediate issue
  - Preserves existing architecture
- **Cons:** 
  - Doesn't address silent failure issue
  - Requires manual database intervention
  - No improvement to error visibility

**Implementation:**
1. Run `20250622_private_booking_sms_enhancements.sql` in production
2. Verify Twilio credentials are set in Vercel
3. Test SMS sending

#### Solution 2: Add Fallback Compatibility
**Approach:** Modify code to work with existing table structure
- **Pros:**
  - No database changes needed
  - Works immediately
  - Backwards compatible
- **Cons:**
  - Loses some functionality (auto-send, templates)
  - Technical debt
  - More complex code

**Implementation:**
1. Modify `queueAndSendPrivateBookingSms` to only insert columns that exist
2. Add column existence check before insert
3. Fallback to simpler SMS queue structure

#### Solution 3: Comprehensive Error Handling
**Approach:** Add user-visible error handling and monitoring
- **Pros:**
  - Makes all failures visible
  - Better user experience
  - Easier debugging in future
- **Cons:**
  - Requires UI changes
  - More development effort
  - Still needs migration to fully work

**Implementation:**
1. Add toast notifications for SMS status
2. Return SMS status in action response
3. Add Sentry error tracking
4. Create admin SMS status dashboard

### Recommended Solution: **Hybrid of Solutions 1 & 3**

Execute the migration AND improve error handling:
1. Run the missing migration immediately
2. Add user feedback for SMS status
3. Implement proper error tracking

This provides immediate fix while preventing future silent failures.

---

## Issue 2: Google Calendar Events Not Creating

### Root Cause Analysis

#### Primary Causes:
1. **Missing Environment Variables**: Google Calendar requires specific credentials not set in production
2. **Silent Configuration Check**: `isCalendarConfigured()` returns false, skipping sync without notification
3. **Permission Issues**: Service account may not have calendar write access

#### Configuration Requirements:
```javascript
// Service Account Method (Recommended)
GOOGLE_SERVICE_ACCOUNT_KEY='{...}' // Full JSON key
GOOGLE_CALENDAR_ID='...'            // Calendar ID

// OAuth2 Method (Alternative)
GOOGLE_CLIENT_ID='...'
GOOGLE_CLIENT_SECRET='...'
GOOGLE_REFRESH_TOKEN='...'
GOOGLE_CALENDAR_ID='...'
```

### Current Flow
```
1. Private booking created
2. isCalendarConfigured() checks for credentials
3. Returns false (missing env vars)
4. Calendar sync skipped silently
5. Booking created without calendar event
```

### Proposed Solutions

#### Solution 1: Add Missing Configuration
**Approach:** Simply add the required environment variables to Vercel
- **Pros:**
  - No code changes needed
  - Immediate functionality
  - Uses existing implementation
- **Cons:**
  - No visibility into failures
  - Manual configuration required
  - No user feedback

**Implementation:**
1. Add `GOOGLE_SERVICE_ACCOUNT_KEY` to Vercel
2. Add `GOOGLE_CALENDAR_ID` to Vercel
3. Ensure service account has calendar access

#### Solution 2: Add Configuration UI
**Approach:** Create admin UI for managing calendar settings
- **Pros:**
  - User-friendly configuration
  - Testable from UI
  - No manual env var editing
- **Cons:**
  - Significant development effort
  - Security considerations for storing keys
  - Overkill for single calendar

**Implementation:**
1. Create settings page for calendar config
2. Store encrypted credentials in database
3. Add test connection button
4. Show sync status in UI

#### Solution 3: Optional Calendar with Status Indicators
**Approach:** Make calendar sync optional with clear status
- **Pros:**
  - Works without configuration
  - Clear user feedback
  - Graceful degradation
- **Cons:**
  - Requires UI changes
  - Users might miss the feature
  - Still need configuration eventually

**Implementation:**
1. Add calendar sync toggle in booking form
2. Show sync status after booking creation
3. Add retry mechanism for failed syncs
4. Display calendar configuration status

### Recommended Solution: **Solution 1 with Enhanced Logging**

1. **Immediate:** Add the required environment variables
2. **Enhancement:** Improve logging to make failures visible
3. **Future:** Add simple status indicator in UI

This is the fastest path to working functionality while setting foundation for better visibility.

---

## Critical Configuration Checklist

### For SMS:
- [ ] Run migration: `20250622_private_booking_sms_enhancements.sql`
- [ ] Verify in Vercel: `TWILIO_ACCOUNT_SID`
- [ ] Verify in Vercel: `TWILIO_AUTH_TOKEN`
- [ ] Verify in Vercel: `TWILIO_PHONE_NUMBER` or `TWILIO_MESSAGING_SERVICE_SID`

### For Google Calendar:
- [ ] Add to Vercel: `GOOGLE_SERVICE_ACCOUNT_KEY` (properly escaped JSON)
- [ ] Add to Vercel: `GOOGLE_CALENDAR_ID`
- [ ] Share calendar with service account email
- [ ] Grant "Make changes to events" permission

---

## Testing Plan

### SMS Testing:
1. Check if columns exist: 
   ```sql
   SELECT column_name FROM information_schema.columns 
   WHERE table_name = 'private_booking_sms_queue';
   ```
2. Create test booking with phone number
3. Check `private_booking_sms_queue` table for entry
4. Verify SMS received

### Calendar Testing:
1. Run: `npx tsx scripts/debug-google-calendar.ts` locally with production env vars
2. Use Calendar Test page: `/settings/calendar-test`
3. Create test booking
4. Check calendar for event

---

## Long-term Recommendations

1. **Implement Health Checks**: Add endpoint to verify all integrations
2. **Add Monitoring**: Use Sentry or similar for error tracking
3. **Improve Feedback**: Show integration status in UI
4. **Create Admin Dashboard**: For monitoring SMS and calendar sync status
5. **Document Requirements**: Clear setup guide for new deployments

---

## Next Steps

1. **Immediate Action Required:**
   - Run the missing SMS migration in production
   - Add Google Calendar environment variables to Vercel

2. **Follow-up Actions:**
   - Test both features after configuration
   - Monitor logs for any errors
   - Consider implementing enhanced error handling

3. **Future Improvements:**
   - Add user feedback for integration status
   - Implement retry mechanisms
   - Create monitoring dashboard
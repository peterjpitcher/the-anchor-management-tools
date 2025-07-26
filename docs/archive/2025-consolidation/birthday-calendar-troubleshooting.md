# Birthday Calendar Troubleshooting Guide

## Issue: Birthday Events Not Appearing in Calendar

### Root Cause Identified
The birthday calendar implementation was using its own OAuth2 client initialization instead of sharing the robust implementation from the main Google Calendar integration used by private bookings.

### Fix Applied
1. **Shared Authentication**: Birthday calendar now uses the same `getOAuth2Client()` function from the main google-calendar.ts file
2. **Enhanced Error Handling**: Added detailed logging and error messages to match private bookings
3. **Same Calendar**: Both systems use the same `GOOGLE_CALENDAR_ID` environment variable

## Testing the Fix

### 1. Run the Test Script
```bash
tsx scripts/test-birthday-calendar-sync.ts
```

This will:
- Verify calendar configuration
- Test calendar connection
- Create a test birthday event
- Confirm the event is recurring

### 2. Manual Testing
1. Go to Settings > Sync Birthdays in the admin panel
2. Click "Sync All Birthdays to Calendar"
3. Check your Google Calendar for birthday events

### 3. Check Individual Employee
1. Create or edit an employee with a date of birth
2. Ensure their status is "Active"
3. Save the employee
4. Check the console logs for sync status
5. Verify the birthday appears in Google Calendar

## Common Issues and Solutions

### Issue: "Calendar not configured"
**Solution**: Ensure these environment variables are set in `.env.local`:
- `GOOGLE_CALENDAR_ID` - Your Google Calendar ID
- `GOOGLE_SERVICE_ACCOUNT_KEY` - The service account JSON (see `.env.google-calendar-example`)

### Issue: "Permission denied (403)"
**Solution**: 
1. Go to Google Calendar settings
2. Find your calendar and click "Settings and sharing"
3. Under "Share with specific people", add the service account email
4. Grant "Make changes to events" permission

### Issue: "Calendar not found (404)"
**Solution**: 
- Verify the `GOOGLE_CALENDAR_ID` is correct
- Ensure you're using the full calendar ID (e.g., `abc123@group.calendar.google.com`)
- Check that the calendar exists and hasn't been deleted

### Issue: "Authentication error"
**Solution**:
1. Verify your service account JSON is properly formatted
2. Run `tsx scripts/format-google-service-account.ts` to fix formatting issues
3. Ensure the JSON is wrapped in single quotes in `.env.local`
4. Check that newlines in the private key are escaped as `\\n`

## Event Properties
Birthday events created by the system have:
- **Recurrence**: Annual (RRULE:FREQ=YEARLY)
- **All-day events**: No specific time
- **Color**: Yellow (birthday color)
- **Reminders**: Day of and 1 week before
- **ID Format**: `birthday-{employeeId}` (no year)

## Migration from Old Events
If you had year-specific birthday events before, run:
```bash
tsx scripts/migrate-birthday-events-to-recurring.ts
```

This will:
1. Delete old year-specific events
2. Create new recurring events
3. Verify the migration

## Debugging
Enable detailed logging by checking console output during sync:
- Look for `[Birthday Calendar]` prefixed messages
- Check for `[Google Calendar]` messages for auth issues
- Review error codes and suggested fixes in the logs
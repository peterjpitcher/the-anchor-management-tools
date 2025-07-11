# Google Calendar Integration Analysis

## Summary

The Google Calendar integration is properly configured but failing due to a Node.js v22 compatibility issue with the Google Auth library's cryptographic operations.

## Current Configuration Status

### ✅ Configuration is Valid
- **Calendar ID**: Set correctly (1f93cf916fd9f821b2cf49c471e92cabcd6a61a2461473c9a3ed1f9adf8e2635@group.calendar.google.com)
- **Service Account**: Valid JSON with all required fields
- **Client Email**: application-automation@anchor-management-tools.iam.gserviceaccount.com
- **Project ID**: anchor-management-tools
- **Private Key**: Present and properly formatted

### ❌ Runtime Issue
- **Error**: `ERR_OSSL_UNSUPPORTED: error:1E08010C:DECODER routines::unsupported`
- **Cause**: Node.js v22 incompatibility with the Google Auth library's private key signing operations
- **Impact**: Calendar events are not being created when private bookings are added/updated

## Code Flow Analysis

1. **Private Booking Creation** (`src/app/actions/privateBookingActions.ts`)
   - Booking is created successfully in the database
   - `isCalendarConfigured()` returns `true`
   - `syncCalendarEvent()` is called with the booking data

2. **Calendar Sync** (`src/lib/google-calendar.ts`)
   - Configuration check passes
   - Service account authentication is attempted
   - Authentication succeeds but fails during the actual API call
   - The error occurs when the private key is used to sign the JWT token

3. **Error Handling**
   - The error is caught and logged but doesn't block the booking creation
   - Calendar event ID is not saved to the database
   - Users can still create bookings without calendar integration

## Solutions

### 1. **Immediate Fix - Use Node.js v20 (Recommended)**
```bash
# Install nvm if not already installed
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Install and use Node.js v20
nvm install 20
nvm use 20

# Restart the development server
npm run dev
```

### 2. **Production Environment**
- Added `"engines": { "node": "20.x" }` to package.json
- This ensures Vercel uses Node.js v20 in production
- Deploy this change to fix production calendar sync

### 3. **Alternative - OAuth2 Setup**
If you need to use Node.js v22, configure OAuth2 instead:
1. Create OAuth2 credentials in Google Cloud Console
2. Set up these environment variables:
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
3. Remove `GOOGLE_SERVICE_ACCOUNT_KEY`

### 4. **Temporary Workaround**
To disable calendar sync temporarily:
- Remove `GOOGLE_CALENDAR_ID` from environment variables
- The app will continue working without calendar integration

## Verification Steps

After implementing the fix:

1. **Test Calendar Connection**
   ```bash
   npx tsx scripts/test-calendar-sync.ts
   ```

2. **Create a Test Booking**
   - Go to `/private-bookings/new`
   - Create a test booking
   - Check browser console for `[Google Calendar]` logs

3. **Verify in Database**
   ```sql
   SELECT id, customer_name, calendar_event_id, created_at 
   FROM private_bookings 
   ORDER BY created_at DESC 
   LIMIT 5;
   ```

4. **Check Google Calendar**
   - Open the calendar with ID: 1f93cf916fd9f821b2cf49c471e92cabcd6a61a2461473c9a3ed1f9adf8e2635@group.calendar.google.com
   - Look for events with format: `[STATUS] - BookingRef - CustomerName @ The Anchor`

## Files Involved

1. **Configuration**: `.env.local`
2. **Calendar Integration**: `/src/lib/google-calendar.ts`
3. **Booking Actions**: `/src/app/actions/privateBookingActions.ts`
4. **Test Page**: `/src/app/(authenticated)/settings/calendar-test/page.tsx`
5. **Debug Scripts**:
   - `/scripts/debug-google-calendar.ts`
   - `/scripts/test-calendar-sync.ts`
   - `/scripts/validate-service-account-key.ts`

## Next Steps

1. **Development**: Switch to Node.js v20 using nvm
2. **Production**: Deploy the package.json change to specify Node.js v20
3. **Testing**: Run the test scripts to verify calendar sync works
4. **Monitoring**: Check Vercel logs for any calendar-related errors after deployment

## Additional Notes

- The service account (application-automation@anchor-management-tools.iam.gserviceaccount.com) must have "Make changes to events" permission on the calendar
- Events are created in the Europe/London timezone
- Calendar events include color coding based on booking status (draft=gray, confirmed=green, etc.)
- The integration is designed to fail gracefully - bookings work even if calendar sync fails
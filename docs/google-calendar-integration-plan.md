# Google Calendar Integration Implementation Plan

## Current Status Summary

The Google Calendar integration is **properly implemented** but currently **not functioning** due to a Node.js v22 compatibility issue with Google's authentication library.

### What's Working ✅
1. **Service Account Configuration**
   - Valid service account JSON key stored in `GOOGLE_SERVICE_ACCOUNT_KEY`
   - Calendar ID properly configured in `GOOGLE_CALENDAR_ID`
   - Service account has necessary permissions on the calendar

2. **Code Implementation**
   - Integration code in `/src/lib/google-calendar.ts` is correctly implemented
   - Proper error handling and fallback behavior
   - Calendar sync is triggered at the right points in booking workflow

### What's Not Working ❌
- JWT token signing fails with `ERR_OSSL_UNSUPPORTED` error in Node.js v22
- This prevents any calendar operations from succeeding

## Root Cause

Node.js v22 introduced breaking changes to OpenSSL that are incompatible with how Google's auth library signs JWT tokens for service account authentication.

Error: `error:1E08010C:DECODER routines::unsupported`

## Solution Plan

### Option 1: Switch to Node.js v20 LTS (Recommended)

**Timeline: Immediate**

1. **Development Environment**
   ```bash
   # Using nvm
   nvm install 20
   nvm use 20
   
   # Or using fnm
   fnm install 20
   fnm use 20
   ```

2. **Production Environment**
   - Already configured in `package.json` with `"engines": { "node": "20.x" }`
   - Vercel will automatically use Node.js 20 for deployments

3. **Verify Fix**
   ```bash
   # Test calendar sync
   npm run tsx scripts/test-calendar-sync.ts
   
   # Or use the web interface
   # Navigate to: /settings/calendar-test
   ```

### Option 2: Implement OAuth2 Flow (Alternative)

**Timeline: 1-2 days**

If you need to stay on Node.js v22, implement OAuth2 authentication:

1. **Set up OAuth2 in Google Cloud Console**
   - Create OAuth2 credentials
   - Set up redirect URIs
   - Configure consent screen

2. **Implement OAuth2 Flow**
   ```typescript
   // New file: /src/lib/google-oauth.ts
   import { google } from 'googleapis'
   
   const oauth2Client = new google.auth.OAuth2(
     process.env.GOOGLE_CLIENT_ID,
     process.env.GOOGLE_CLIENT_SECRET,
     process.env.GOOGLE_REDIRECT_URI
   )
   
   // Generate auth URL
   export function getAuthUrl() {
     return oauth2Client.generateAuthUrl({
       access_type: 'offline',
       scope: ['https://www.googleapis.com/auth/calendar.events']
     })
   }
   
   // Exchange code for tokens
   export async function getTokens(code: string) {
     const { tokens } = await oauth2Client.getToken(code)
     oauth2Client.setCredentials(tokens)
     return tokens
   }
   ```

3. **Store and Refresh Tokens**
   - Create database table for OAuth tokens
   - Implement token refresh logic
   - Update calendar sync to use OAuth2 client

### Option 3: Wait for Library Update

**Timeline: Unknown**

Monitor Google's auth library for Node.js v22 support:
- Issue: https://github.com/googleapis/google-auth-library-nodejs/issues/1810
- No ETA provided by Google team

## Implementation Steps (Option 1 - Recommended)

### Step 1: Switch Node.js Version
```bash
# Install Node.js 20
nvm install 20.18.1
nvm use 20.18.1

# Verify version
node --version  # Should show v20.x.x

# Reinstall dependencies
rm -rf node_modules package-lock.json
npm install
```

### Step 2: Verify Service Account Configuration
```bash
# Run validation script
npm run tsx scripts/validate-service-account-key.ts

# Expected output:
# ✓ Service account key is valid
# ✓ All required fields present
# ✓ Key format is correct
```

### Step 3: Test Calendar Integration
```bash
# Test with script
npm run tsx scripts/test-calendar-sync.ts

# Or test via web UI
# 1. Start dev server: npm run dev
# 2. Navigate to: http://localhost:3000/settings/calendar-test
# 3. Click "Test Calendar Integration"
```

### Step 4: Create Test Booking
1. Navigate to `/private-bookings/new`
2. Create a test booking with:
   - Valid customer details
   - Future date
   - Clear event description
3. Save the booking
4. Check Google Calendar for the created event

### Step 5: Monitor Logs
```typescript
// Check server logs for calendar sync status
// Look for messages like:
// "Calendar event created successfully: [event_id]"
// or
// "Failed to sync calendar event: [error_message]"
```

## Verification Checklist

- [ ] Node.js version is 20.x
- [ ] `npm run tsx scripts/validate-service-account-key.ts` passes
- [ ] `npm run tsx scripts/test-calendar-sync.ts` creates test event
- [ ] Web UI calendar test at `/settings/calendar-test` works
- [ ] New private bookings create calendar events
- [ ] Updated private bookings update calendar events
- [ ] Cancelled private bookings delete calendar events

## Troubleshooting

### Issue: "Calendar not found" error
**Solution**: Ensure the service account email has been granted access to the calendar:
1. Go to Google Calendar settings
2. Find the specific calendar
3. Add service account email with "Make changes to events" permission

### Issue: "Invalid credentials" error
**Solution**: Regenerate service account key:
1. Go to Google Cloud Console
2. Navigate to IAM & Admin > Service Accounts
3. Create new key for the service account
4. Update `GOOGLE_SERVICE_ACCOUNT_KEY` in `.env.local`

### Issue: Events not appearing in calendar
**Solution**: Check calendar ID:
1. Verify `GOOGLE_CALENDAR_ID` is correct
2. Use primary calendar: `primary` or specific ID
3. Test with scripts to confirm connectivity

## Future Enhancements

1. **Two-way Sync**
   - Implement webhooks to sync changes from Google Calendar back to the app
   - Handle conflicts when events are modified in both places

2. **Rich Event Details**
   - Add venue space details to event description
   - Include booking items and special requirements
   - Add customer contact information (respecting privacy)

3. **Recurring Events**
   - Support for recurring private bookings
   - Sync recurring patterns with Google Calendar

4. **Multiple Calendars**
   - Different calendars for different venue spaces
   - Staff assignment calendars
   - Customer-facing public calendar

## Environment Variables Reference

```bash
# Required for Google Calendar integration
GOOGLE_CALENDAR_ID=your-calendar-id@group.calendar.google.com
GOOGLE_SERVICE_ACCOUNT_KEY={"type":"service_account","project_id":"...","private_key":"...","client_email":"..."}

# Optional - for enhanced logging
CALENDAR_SYNC_ENABLED=true
CALENDAR_SYNC_DEBUG=true
```

## Security Considerations

1. **Service Account Key**
   - Never commit to version control
   - Rotate keys periodically
   - Use environment variables only

2. **Calendar Permissions**
   - Grant minimum necessary permissions
   - Use separate calendar for bookings
   - Audit access regularly

3. **Data Privacy**
   - Limit customer information in calendar events
   - Use booking references instead of full details
   - Implement data retention policies

## Monitoring

1. **Add logging for calendar operations**
   ```typescript
   // In /src/lib/google-calendar.ts
   console.log('[Calendar Sync]', {
     action: 'create_event',
     bookingId: booking.id,
     status: 'success',
     eventId: event.data.id
   })
   ```

2. **Track sync failures**
   - Log to error tracking service (e.g., Sentry)
   - Create admin notifications for repeated failures
   - Monitor sync success rate

3. **Set up alerts**
   - Alert on authentication failures
   - Alert on quota exceeded errors
   - Daily summary of sync operations

## Conclusion

The Google Calendar integration is well-implemented and ready to use. The only blocker is the Node.js v22 compatibility issue, which can be immediately resolved by switching to Node.js v20 LTS.

Once running on Node.js v20, the integration will:
- Automatically create calendar events for new bookings
- Update events when bookings are modified
- Delete events when bookings are cancelled
- Handle errors gracefully without affecting core booking functionality
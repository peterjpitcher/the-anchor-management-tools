# SMS Template Troubleshooting Guide

## Overview
This guide helps troubleshoot issues where SMS messages are using hard-coded templates instead of the database templates defined in `/settings/message-templates`.

## Common Issues and Solutions

### 1. Templates Not Loading (Falls back to hard-coded)

**Symptoms:**
- SMS messages use the old hard-coded format
- Templates exist in the database but aren't being used
- Works locally but not in production

**Possible Causes:**

1. **Cached null values**: If template lookup failed once, it might cache `null` for 1 hour
2. **Missing environment variables**: Service role key might not be available in production
3. **RPC function not finding templates**: Templates might not be marked as default/active

**Solutions:**

1. **Disable template caching temporarily**:
   - Add `DISABLE_TEMPLATE_CACHE=true` to your environment variables
   - This forces fresh database lookups for every SMS

2. **Check template configuration**:
   ```bash
   tsx scripts/check-production-templates.ts
   ```
   This verifies:
   - Templates exist in the database
   - Templates are marked as `is_default = true` and `is_active = true`
   - RPC function returns templates correctly

3. **Verify templates are set as default**:
   ```bash
   tsx scripts/verify-message-templates.ts
   ```
   This ensures all required template types have active defaults.

### 2. Debugging Template Loading

**Enable debug logging**:
The code now includes extensive logging. Check your server logs for:
- `[SMS] Template lookup:` - Shows which template type is being requested
- `[getMessageTemplate] Called with:` - Shows the template request details
- `[getMessageTemplate] RPC result:` - Shows what the database returned
- `[SMS] Falling back to hard-coded template` - Indicates template loading failed

**Test template loading**:
```bash
# Test locally
tsx scripts/test-template-loading.ts

# Test against production
tsx scripts/test-production-templates.ts
```

**Check production via API**:
```
https://management.orangejelly.co.uk/api/debug/test-template?type=bookingConfirmation
```

### 3. Template Types and Mapping

The system maps legacy template names to database types:

| Code Name | Database Type | Used For |
|-----------|--------------|----------|
| `bookingConfirmation` | `booking_confirmation` | Bookings with seats |
| `reminderOnly` | `booking_reminder_confirmation` | 0-seat reminders |
| `dayBeforeReminder` | `reminder_24_hour` | 24-hour reminders |
| `weekBeforeReminder` | `reminder_7_day` | 7-day reminders |

### 4. Required Template Variables

Each template type expects certain variables:

**All templates:**
- `{{first_name}}` - Customer's first name
- `{{event_name}}` - Event name
- `{{event_date}}` - Formatted event date
- `{{event_time}}` - Event time
- `{{venue_name}}` - Venue name (The Anchor)
- `{{contact_phone}}` - Contact phone number

**Booking confirmation only:**
- `{{seats}}` - Number of seats booked
- `{{booking_reference}}` - Booking ID (first 8 chars)

### 5. Environment Variables

Ensure these are set in production:
- `NEXT_PUBLIC_SUPABASE_URL` - Your Supabase URL
- `SUPABASE_SERVICE_ROLE_KEY` - Service role key for admin access
- `DISABLE_TEMPLATE_CACHE` (optional) - Set to 'true' to disable caching

### 6. Cache Behavior

- Templates are cached for 1 hour (`LONG` cache TTL)
- Cache is in-memory per serverless function instance
- Cache key format: `template:{eventId}:{templateType}`
- Null values are NOT cached (prevents caching failures)

### 7. Vercel/Serverless Considerations

- Each function invocation has its own cache
- Environment variables must be configured in Vercel dashboard
- Check function logs for debug output
- Cold starts reset the cache

## Quick Fixes

1. **Force fresh templates**: Add `DISABLE_TEMPLATE_CACHE=true` to environment
2. **Verify defaults**: Run `tsx scripts/verify-message-templates.ts`
3. **Check logs**: Look for `[SMS]` and `[getMessageTemplate]` prefixed messages
4. **Test directly**: Use the debug API endpoint to test template loading

## Still Having Issues?

1. Check Vercel function logs for detailed debug output
2. Verify environment variables are set correctly in production
3. Ensure templates are marked as default and active
4. Try disabling cache temporarily to isolate the issue
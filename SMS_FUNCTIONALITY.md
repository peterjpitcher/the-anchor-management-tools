# SMS Functionality Documentation

## Overview
The Event Planner application uses Twilio for sending SMS reminders to customers about their upcoming events. The system is automated through GitHub Actions, which triggers daily checks for upcoming events and sends reminders accordingly.

## Architecture

### Key Components

1. **SMS Action** (`src/app/actions/sms.ts`)
   - Server action for sending SMS messages
   - Handles event reminder logic
   - Integrates with Twilio API
   - Queries Supabase for upcoming events

2. **GitHub Actions Workflow** (`.github/workflows/reminders.yml`)
   - Runs daily at 9 AM UTC
   - Triggers the SMS endpoint securely
   - Includes detailed logging and error handling
   - Uses environment secrets for authentication

3. **SMS Templates** (`src/lib/smsTemplates.ts`)
   - Predefined message templates
   - Handles different event scenarios
   - Supports dynamic content insertion

## Implementation Details

### SMS Action Implementation
```typescript
// src/app/actions/sms.ts
- Queries upcoming events within 24-hour window
- Filters events requiring reminders
- Validates mobile numbers
- Handles Twilio message sending
- Includes comprehensive error logging
```

### GitHub Actions Workflow
```yaml
# .github/workflows/reminders.yml
- Daily scheduled execution
- Secret validation (VERCEL_URL, CRON_SECRET_KEY)
- Detailed HTTP request logging
- Response validation and error handling
```

### API Route
```typescript
// src/app/api/cron/reminders/route.ts
- Validates CRON_SECRET_KEY
- Triggers sendEventReminders function
- Returns detailed execution status
- Includes error handling and logging
```

## Environment Variables
Required configuration:
```env
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_PHONE_NUMBER=your_twilio_phone_number
CRON_SECRET_KEY=your_cron_secret_key
VERCEL_URL=your_vercel_deployment_url
```

## Security Features
1. **API Protection**
   - CRON_SECRET_KEY validation
   - Environment variable encryption
   - Secure secret storage in GitHub

2. **Error Handling**
   - Graceful failure management
   - Detailed error logging
   - Failed message retry logic

3. **Data Validation**
   - Mobile number formatting
   - Event date validation
   - Template parameter verification

## Workflow Details

### Daily Reminder Process
1. GitHub Action triggers at 9 AM UTC
2. Validates required secrets
3. Makes HTTP request to reminder endpoint
4. Endpoint validates CRON_SECRET_KEY
5. System checks for upcoming events
6. Sends SMS reminders as needed
7. Logs execution details

### SMS Sending Logic
1. Queries events within next 24 hours
2. Filters for valid mobile numbers
3. Applies appropriate message template
4. Sends message via Twilio
5. Logs success/failure

## Testing
To test the SMS system:
1. Set up required environment variables
2. Create a test event for tomorrow
3. Manually trigger GitHub Action
4. Check logs for execution details
5. Verify SMS delivery
6. Monitor Twilio dashboard

## Debugging Tools

### GitHub Actions Logs
- Workflow execution details
- HTTP request/response information
- Secret validation status
- Timing information

### Vercel Logs
- API route execution
- Database query results
- SMS sending attempts
- Error messages

### Twilio Dashboard
- Message delivery status
- Sending history
- Error reports
- Usage metrics

## Common Issues and Solutions

### GitHub Actions Issues
- Check secret configuration
- Verify CRON_SECRET_KEY matches
- Ensure VERCEL_URL is correct
- Review workflow syntax

### SMS Sending Issues
- Verify Twilio credentials
- Check mobile number format
- Review message template
- Monitor rate limits

### Database Issues
- Check Supabase connection
- Verify query syntax
- Monitor connection pool
- Review error logs

## Maintenance
To maintain the SMS system:
1. Monitor Twilio costs and usage
2. Review and update message templates
3. Check GitHub Actions execution history
4. Update dependencies as needed
5. Monitor error logs regularly
6. Test system after updates

## Best Practices
1. **Message Content**
   - Keep messages concise
   - Include essential information only
   - Use consistent formatting
   - Respect local time zones

2. **Error Handling**
   - Log all failures
   - Implement retry logic
   - Monitor error rates
   - Alert on critical failures

3. **Testing**
   - Use test phone numbers
   - Verify message content
   - Check delivery status
   - Monitor costs

## Future Improvements
Consider implementing:
1. Message delivery confirmation
2. Customer preference management
3. Multi-language support
4. Advanced retry logic
5. Analytics dashboard 
# SMS Notifications

## Overview

The SMS notification system automatically sends text messages to customers for booking confirmations and event reminders. Built on Twilio's reliable infrastructure, it ensures customers stay informed about their upcoming events at The Anchor.

## Features

### Automatic Messages
- Instant booking confirmations
- 7-day advance reminders
- 24-hour advance reminders
- Personalized content
- Reliable delivery

### Message Types

#### Booking Confirmation
Sent immediately when a booking is created or modified:
```
Hi [Name], your booking for [Event] on [Date] at [Time] is confirmed. We've reserved [X] seat(s) for you. Reply to this message if you need to make any changes. The Anchor.
```

#### 7-Day Reminder
Sent to all customers with bookings 7 days before an event:
```
Hi [Name], don't forget, we've got our [Event] on [Date] at [Time]! If you'd like to book seats, WhatsApp/Call 01753682707. The Anchor.
```

#### 24-Hour Reminder
Sent to customers with seat reservations 24 hours before:
```
Hi [Name], just a reminder that you're booked for [Event] tomorrow at [Time]. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.
```

### Delivery System
- Daily automated dispatch at 9 AM
- Timezone-aware scheduling
- Batch processing for efficiency
- Error handling and retries
- Delivery status tracking

## Architecture

### Components
1. **Twilio Integration** - SMS gateway service
2. **Cron Jobs** - Scheduled message triggers
3. **Server Actions** - Message sending logic
4. **Templates** - Message formatting system
5. **Logging** - Delivery tracking

### Message Flow
1. Trigger event (booking/schedule)
2. Query relevant customers
3. Generate personalized messages
4. Send via Twilio API
5. Log delivery status
6. Handle any failures

## Configuration

### Twilio Setup
Required configuration:
- Account SID
- Auth Token
- Phone Number
- Webhook URLs (optional)

### Environment Variables
```env
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+441234567890
```

### Cron Schedule
Daily execution at 9:00 AM UTC:
```yaml
cron: '0 9 * * *'
```

## Implementation Details

### Booking Confirmations
Triggered by:
- New booking creation
- Booking modifications
- Seat count changes

Process:
1. Extract booking details
2. Format customer name
3. Apply message template
4. Send immediately
5. Log result

### Daily Reminders
Execution process:
1. Cron triggers at 9 AM
2. Query events for tomorrow
3. Query events for next week
4. Get associated bookings
5. Send appropriate messages
6. Report completion

### Message Formatting
Dynamic fields:
- `{{customer_name}}` - First name
- `{{event_name}}` - Event title
- `{{event_date}}` - Formatted date
- `{{event_time}}` - Time string
- `{{seats}}` - Booking count

## Security

### API Security
- Secret key validation
- HTTPS only
- Rate limiting
- IP restrictions (optional)
- Audit logging

### Data Protection
- No message storage
- Minimal data exposure
- Secure transmission
- PII handling
- Compliance ready

### Access Control
- Cron secret required
- Authenticated routes
- Service isolation
- Error suppression
- Monitoring alerts

## Monitoring

### Delivery Tracking
Monitor via:
- Twilio dashboard
- Vercel function logs
- Custom logging
- Error alerts
- Success metrics

### Common Metrics
- Messages sent daily
- Delivery success rate
- Error frequency
- Cost per message
- Response rates

### Troubleshooting Tools
- Twilio debugger
- Message logs
- Test numbers
- Webhook inspector
- Status callbacks

## Best Practices

### Message Content
- Keep concise (<160 chars)
- Include key details only
- Clear call-to-action
- Professional tone
- Venue identification

### Phone Numbers
- Validate format
- Include country code
- Handle landlines gracefully
- Update changes promptly
- Test before sending

### Timing
- Respect quiet hours
- Consider time zones
- Avoid holidays
- Plan for delays
- Monitor delivery times

## Error Handling

### Common Issues

**Invalid Phone Number**
- Validation before sending
- Log invalid attempts
- Notify staff
- Update records
- Prevent future errors

**Rate Limits**
- Batch processing
- Queue management
- Retry logic
- Backoff strategy
- Monitor limits

**Network Failures**
- Automatic retries
- Exponential backoff
- Failure logging
- Alert on persistent failures
- Manual intervention

### Recovery Procedures
1. Identify failed messages
2. Diagnose root cause
3. Fix underlying issue
4. Retry failed batch
5. Verify delivery
6. Update monitoring

## Cost Management

### Pricing Structure
- Per-message charges
- Country-based rates
- Volume discounts
- Monthly commitments
- Overage charges

### Optimization
- Message length limits
- Batch where possible
- Remove duplicates
- Valid numbers only
- Regular audits

### Budgeting
- Monitor daily usage
- Set usage alerts
- Review monthly bills
- Plan for growth
- Consider alternatives

## Testing

### Test Procedures
1. Use test phone numbers
2. Verify message content
3. Check delivery time
4. Monitor costs
5. Test error cases

### Test Scenarios
- New booking flow
- Reminder triggers
- Invalid numbers
- Network failures
- Rate limiting

### Debugging
- Enable verbose logging
- Use Twilio test credentials
- Check webhook events
- Verify cron execution
- Review error logs

## Compliance

### Regulations
- GDPR compliance
- PECR regulations
- Opt-out handling
- Data minimization
- Consent management

### Best Practices
- Clear opt-in process
- Easy opt-out method
- Message frequency limits
- Content guidelines
- Record keeping

## Future Enhancements

### Planned Features
1. Two-way messaging
2. WhatsApp integration
3. Message templates
4. Delivery receipts
5. Analytics dashboard

### Potential Improvements
1. Multi-language support
2. Rich media messages
3. Interactive responses
4. Booking modifications via SMS
5. Preference management

## API Reference

### Server Actions
```typescript
// Send booking confirmation
sendBookingConfirmation(booking: Booking, customer: Customer, event: Event)

// Send event reminders
sendEventReminders()

// Send single SMS
sendSMS(to: string, message: string)
```

### Twilio Client
```typescript
// Initialize client
const twilioClient = twilio(accountSid, authToken)

// Send message
twilioClient.messages.create({
  body: messageText,
  from: twilioNumber,
  to: customerNumber
})
```

### Cron Endpoint
```typescript
// POST /api/cron/reminders
// Headers: { 'Authorization': `Bearer ${CRON_SECRET}` }
// Response: { success: boolean, messages: number, errors: any[] }
```

## Maintenance

### Regular Tasks
1. Monitor delivery rates
2. Check error logs
3. Update phone numbers
4. Review costs
5. Test system health

### Periodic Reviews
1. Message effectiveness
2. Delivery timing
3. Customer feedback
4. Cost optimization
5. Compliance updates
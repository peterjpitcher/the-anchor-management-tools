# Table Bookings SMS System Report

## Executive Summary
The table booking system has a comprehensive SMS messaging feature that automatically sends booking confirmations, reminders, and allows manual SMS communication with customers. The system is fully integrated with Twilio and uses templated messages with variable substitution.

## 🚀 SMS Triggers

### Automatic SMS Sending

| Trigger | When Sent | Template Used | Conditions |
|---------|-----------|---------------|------------|
| **Booking Confirmation** | Immediately on booking creation | `booking_confirmation_regular` | Status = 'confirmed', Regular booking |
| **Payment Request** | Immediately on booking creation | `payment_request` | Status = 'pending_payment', Sunday Lunch |
| **Payment Confirmation** | After successful payment | `booking_confirmation_sunday_lunch` | Sunday Lunch, payment completed |
| **Booking Reminder** | 24 hours before (configurable) | `reminder_regular` or `reminder_sunday_lunch` | Via cron job, if reminder_sent = false |
| **Cancellation Notice** | When booking cancelled | `cancellation` | Status changed to 'cancelled' |

### Manual SMS Options

1. **Individual Booking Page** (`/table-bookings/[id]`)
   - "Send Reminder SMS" button
   - Sends immediate reminder using appropriate template

2. **SMS Template Testing** (`/table-bookings/settings/sms-templates`)
   - Test any template with sample data
   - Verify message formatting before use

## 📝 SMS Templates

### Available Templates

1. **booking_confirmation_regular**
   ```
   Hi {{customer_name}}, your table for {{party_size}} is confirmed for {{date}} at {{time}}. 
   Reference: {{reference}}. Call {{contact_phone}} if you need to make changes.
   ```

2. **booking_confirmation_sunday_lunch**
   ```
   Hi {{customer_name}}, payment received! Your Sunday lunch for {{party_size}} is confirmed for {{date}} at {{time}}.
   Roast selections: {{roast_summary}}
   Reference: {{reference}}
   ```

3. **reminder_regular**
   ```
   Reminder: Your table for {{party_size}} is booked for tomorrow at {{time}}.
   Reference: {{reference}}. We look forward to seeing you!
   ```

4. **reminder_sunday_lunch**
   ```
   Reminder: Your Sunday lunch for {{party_size}} is tomorrow at {{time}}.
   Your roast selections: {{roast_summary}}
   See you soon!
   ```

5. **payment_request**
   ```
   Hi {{customer_name}}, to confirm your Sunday lunch booking for {{party_size}} on {{date}}, 
   please complete your deposit payment: {{payment_link}}
   ```

6. **cancellation**
   ```
   Hi {{customer_name}}, your booking for {{date}} at {{time}} has been cancelled.
   Reference: {{reference}}. Call {{contact_phone}} if this is an error.
   ```

### Template Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `{{customer_name}}` | Customer's first name | "John" |
| `{{party_size}}` | Number of people | "4" |
| `{{date}}` | Full date format | "Sunday, March 10" |
| `{{time}}` | 12-hour time format | "2:00 PM" |
| `{{reference}}` | Booking reference | "BK-2024-0123" |
| `{{contact_phone}}` | Restaurant phone | "01234 567890" |
| `{{roast_summary}}` | Sunday lunch selections | "2x Beef, 1x Chicken, 1x Vegetarian" |
| `{{payment_link}}` | Payment URL | "https://..." |
| `{{allergies}}` | Allergy information | "Nut allergy noted" |

## ⚙️ SMS Configuration

### Template Management
- **Location**: `/table-bookings/settings/sms-templates`
- **Features**:
  - Edit template text
  - Character count (SMS limit: 160 chars)
  - Variable validation
  - Test sending with sample data
  - Preview with actual data

### Reminder Settings
- **Default**: 24 hours before booking
- **Configurable** via booking policies
- **Skip if**: Customer opted out or reminder already sent

## 🔄 SMS Processing Flow

### 1. Immediate Messages (Confirmations)
```
Booking Created → Check SMS Opt-in → Format Message → Send via Twilio → Log in Database
```

### 2. Scheduled Reminders
```
Cron Job (Daily) → Find Upcoming Bookings → Check Reminder Window → Queue SMS → Process Queue → Update reminder_sent Flag
```

### 3. Manual Messages
```
Staff Clicks Send → Select Template → Populate Variables → Send Immediately → Log Activity
```

## 📊 SMS Monitoring

### Message Tracking
- All SMS stored in `messages` table
- Delivery status tracked via Twilio webhooks
- Failed messages logged for review

### Customer Health
- `customer_messaging_health` table tracks:
  - Delivery failures
  - Opt-out status
  - SMS suspension flags

### Audit Trail
- All SMS activities logged
- Staff-initiated messages tracked
- Template changes audited

## 🛠️ Technical Implementation

### Key Files
```
/src/app/actions/table-booking-sms.ts     # SMS sending functions
/src/app/actions/table-bookings.ts        # Booking actions with SMS triggers
/src/lib/twilio.ts                        # Twilio integration
/src/lib/background-jobs.ts               # Job queue processing
/src/app/api/cron/table-booking-reminders # Reminder cron job
```

### Database Tables
```
table_booking_sms_templates  # SMS template storage
table_bookings               # reminder_sent flag
messages                     # SMS log
customer_messaging_health    # Delivery tracking
jobs                        # SMS queue
```

## 🔐 Security & Compliance

1. **Phone Number Validation**
   - UK format validation
   - E.164 conversion (+44...)
   
2. **Opt-in Management**
   - Customer consent tracked
   - Opt-out honored automatically
   
3. **Rate Limiting**
   - Prevents SMS flooding
   - Cost control measures

## 💡 Best Practices

### Do's
- ✅ Test templates before bulk sending
- ✅ Keep messages under 160 characters
- ✅ Include booking reference
- ✅ Provide contact number for queries
- ✅ Send reminders 24 hours before

### Don'ts
- ❌ Send to opted-out customers
- ❌ Send duplicate reminders
- ❌ Include sensitive payment details
- ❌ Send outside reasonable hours

## 📈 Usage Statistics

The system tracks:
- Total messages sent
- Delivery success rate
- Template usage frequency
- Customer opt-out rate
- Cost per message

## 🚨 Troubleshooting

### Common Issues

1. **Message Not Sending**
   - Check customer opt-in status
   - Verify phone number format
   - Check Twilio credentials
   - Review job queue status

2. **Reminder Not Triggered**
   - Check cron job running
   - Verify reminder_sent flag
   - Check reminder window settings

3. **Template Variables Not Replacing**
   - Verify variable names match exactly
   - Check data availability
   - Test with sample data first

## 🎯 Future Enhancements

Potential improvements:
- WhatsApp integration
- Multi-language templates
- Smart reminder timing
- Two-way SMS conversations
- Automated review requests post-visit
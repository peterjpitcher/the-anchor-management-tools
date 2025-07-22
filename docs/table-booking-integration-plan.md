# Table Booking System Integration Plan

## Overview

This document outlines how the new table booking system will integrate with existing systems in the Anchor Management Tools ecosystem, ensuring seamless operation while maintaining data consistency and security.

## Integration Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Website (External)                      │
├─────────────────────────────────────────────────────────────┤
│                      API Gateway                             │
│                  (API Key Authentication)                    │
├─────────────────────────────────────────────────────────────┤
│                  Table Booking System                        │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │   Booking    │  │   Payment    │  │  Availability   │  │
│  │   Engine     │  │  Processing  │  │   Calculator    │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
├─────────────────────────────────────────────────────────────┤
│                   Existing Systems                           │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │  Customer    │  │     SMS      │  │     Email       │  │
│  │ Management   │  │   (Twilio)   │  │  (MS Graph)     │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────┐  │
│  │    RBAC      │  │    Audit     │  │   Business      │  │
│  │   System     │  │   Logging    │  │    Hours        │  │
│  └──────────────┘  └──────────────┘  └─────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

## 1. Customer Management Integration

### Customer Record Synchronization

#### Existing System
- **Table**: `customers`
- **Key Fields**: `id`, `mobile_number`, `first_name`, `last_name`, `sms_opt_in`
- **Phone Matching**: Uses `generatePhoneVariants()` function

#### Integration Points

```typescript
// Customer lookup and creation
export async function findOrCreateCustomer(customerData: {
  first_name: string;
  last_name: string;
  mobile_number: string;
  email?: string;
  sms_opt_in: boolean;
}): Promise<Customer> {
  const standardizedPhone = formatPhoneForStorage(customerData.mobile_number);
  const phoneVariants = generatePhoneVariants(standardizedPhone);
  
  // Use existing customer matching logic
  const { data: existingCustomer } = await supabase
    .from('customers')
    .select('*')
    .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
    .single();
    
  if (existingCustomer) {
    // Update opt-in status if changed
    if (customerData.sms_opt_in !== existingCustomer.sms_opt_in) {
      await updateCustomerOptIn(existingCustomer.id, customerData.sms_opt_in);
    }
    return existingCustomer;
  }
  
  // Create new customer using existing patterns
  return createCustomer(customerData);
}
```

#### New Fields Added
- `table_booking_count` - Tracks total table bookings
- `no_show_count` - Tracks no-shows for risk assessment
- `last_table_booking_date` - For customer segmentation

### Customer Health Tracking

Integrate with existing `customer_messaging_health` system:

```typescript
// Check before sending booking confirmations
const canSendSMS = await checkCustomerMessagingHealth(customerId);
if (!canSendSMS) {
  // Fall back to email only
  await sendEmailConfirmation(booking);
}
```

## 2. SMS Notification Integration

### Using Existing SMS Infrastructure

#### SMS Templates (New)
```typescript
// Add to /lib/smsTemplates.ts
export const tableBookingTemplates = {
  booking_confirmation: {
    regular: `Hi {{customer_name}}, your table for {{party_size}} at The Anchor on {{date}} at {{time}} is confirmed. Reference: {{reference}}. Reply STOP to opt out.`,
    
    sunday_lunch: `Hi {{customer_name}}, your Sunday lunch booking for {{party_size}} on {{date}} at {{time}} is confirmed. We have your roast selections ready! Reference: {{reference}}.`
  },
  
  reminder: {
    regular: `Reminder: Your table at The Anchor is booked for today at {{time}}. Party of {{party_size}}. We look forward to seeing you! Ref: {{reference}}`,
    
    sunday_lunch: `Sunday Lunch Reminder: Table for {{party_size}} at {{time}} today. {{roast_summary}}. Allergies noted: {{allergies}}. See you soon! Ref: {{reference}}`
  },
  
  cancellation: `Your booking {{reference}} at The Anchor has been cancelled. {{refund_message}} For assistance call {{contact_phone}}.`,
  
  review_request: `Thanks for dining at The Anchor today! We'd love your feedback: {{review_link}} Reply STOP to opt out.`
};
```

#### Integration with Job Queue
```typescript
// Queue SMS through existing job system
export async function queueBookingConfirmationSMS(
  booking: TableBooking,
  customer: Customer
): Promise<void> {
  if (!customer.sms_opt_in) return;
  
  const template = booking.booking_type === 'sunday_lunch' 
    ? tableBookingTemplates.booking_confirmation.sunday_lunch
    : tableBookingTemplates.booking_confirmation.regular;
    
  await supabase.from('jobs').insert({
    type: 'send_sms',
    payload: {
      to: customer.mobile_number,
      template: 'table_booking_confirmation',
      variables: {
        customer_name: customer.first_name,
        party_size: booking.party_size,
        date: format(booking.booking_date, 'dd/MM/yyyy'),
        time: booking.booking_time,
        reference: booking.booking_reference
      }
    },
    scheduled_for: new Date().toISOString()
  });
}
```

## 3. Email Integration

### Using Microsoft Graph API

#### Email Templates
```typescript
// Customer confirmation email
export async function sendBookingConfirmationEmail(
  booking: TableBooking,
  customer: Customer,
  includeCalendarFile: boolean = true
): Promise<void> {
  const emailHtml = await renderBookingConfirmationTemplate(booking);
  const attachments = [];
  
  if (includeCalendarFile) {
    attachments.push({
      name: `booking-${booking.booking_reference}.ics`,
      content: generateICSFile(booking),
      contentType: 'text/calendar'
    });
  }
  
  await sendEmail({
    to: customer.email,
    subject: `Booking Confirmation - ${booking.booking_reference}`,
    html: emailHtml,
    attachments
  });
}

// Staff notifications
export async function sendStaffBookingAlert(
  booking: TableBooking,
  recipientType: 'manager' | 'kitchen'
): Promise<void> {
  const recipient = recipientType === 'manager' 
    ? 'manager@the-anchor.pub' 
    : 'kitchen@the-anchor.pub';
    
  const template = recipientType === 'manager'
    ? 'staff_booking_alert'
    : 'kitchen_prep_list';
    
  await sendEmail({
    to: recipient,
    subject: `New Booking Alert: ${booking.booking_reference}`,
    template,
    data: {
      booking,
      allergies_highlighted: booking.allergies.length > 0
    }
  });
}
```

## 4. Business Hours Integration

### Kitchen Hours Validation

```typescript
// Leverage existing business hours system - no manual time slot configuration
export async function validateBookingTime(
  date: Date,
  time: string,
  bookingType: 'regular' | 'sunday_lunch'
): Promise<ValidationResult> {
  const dayOfWeek = date.getDay();
  
  // Get hours from existing system
  const { data: hours } = await supabase
    .from('business_hours')
    .select('*')
    .eq('day_of_week', dayOfWeek)
    .single();
    
  // Check special hours
  const { data: specialHours } = await supabase
    .from('special_hours')
    .select('*')
    .eq('date', format(date, 'yyyy-MM-dd'))
    .single();
    
  const activeHours = specialHours || hours;
  
  if (!activeHours || activeHours.is_closed) {
    return { valid: false, reason: 'Restaurant closed' };
  }
  
  // Validate kitchen hours
  if (!isTimeWithinRange(time, activeHours.kitchen_opens, activeHours.kitchen_closes)) {
    return { valid: false, reason: 'Kitchen closed at this time' };
  }
  
  return { valid: true };
}
```

## 5. Audit Logging Integration

### Comprehensive Audit Trail

```typescript
// Log all booking actions using existing audit system
export async function logBookingAction(
  action: string,
  booking: TableBooking,
  metadata?: Record<string, any>
): Promise<void> {
  await logAuditEvent(supabase, {
    action: `table_booking.${action}`,
    entity_type: 'table_booking',
    entity_id: booking.id,
    metadata: {
      booking_reference: booking.booking_reference,
      booking_type: booking.booking_type,
      party_size: booking.party_size,
      booking_date: booking.booking_date,
      ...metadata
    }
  });
}

// Usage examples
await logBookingAction('created', booking, { source: 'website' });
await logBookingAction('cancelled', booking, { reason: cancellationReason });
await logBookingAction('payment_received', booking, { amount: payment.amount });
```

## 6. RBAC Integration

### Permission Structure

```typescript
// New permissions to add to rbac_permissions table
const tableBookingPermissions = [
  {
    module: 'table_bookings',
    action: 'view',
    description: 'View table bookings'
  },
  {
    module: 'table_bookings',
    action: 'create',
    description: 'Create table bookings'
  },
  {
    module: 'table_bookings',
    action: 'edit',
    description: 'Edit table bookings'
  },
  {
    module: 'table_bookings',
    action: 'cancel',
    description: 'Cancel table bookings and process refunds'
  },
  {
    module: 'table_bookings',
    action: 'manage',
    description: 'Full table booking management'
  }
];

// Permission checks in server actions
export async function cancelTableBooking(
  bookingId: string,
  reason: string
): Promise<ActionResult> {
  const hasPermission = await checkUserPermission('table_bookings', 'cancel');
  if (!hasPermission) {
    return { error: 'Insufficient permissions' };
  }
  
  // Process cancellation...
}
```

## 7. API Key System Integration

### Scope Configuration

```typescript
// Add new scopes to API key system
const newApiScopes = [
  'read:table_bookings',
  'write:table_bookings',
  'manage:table_bookings'
];

// Validate API permissions
export async function validateApiBookingAccess(
  apiKey: ApiKey,
  requiredScope: string
): Promise<boolean> {
  return apiKey.scopes.includes(requiredScope) || 
         apiKey.scopes.includes('manage:table_bookings');
}
```

## 8. Menu System Integration

### Existing Menu Integration

```typescript
// Fetch Sunday lunch menu items
export async function getSundayLunchMenu(date: Date): Promise<MenuItem[]> {
  const { data: menuItems } = await supabase
    .from('menu_items')
    .select('*')
    .eq('menu_section_id', SUNDAY_LUNCH_SECTION_ID)
    .eq('is_available', true)
    .order('sort_order');
    
  return menuItems || [];
}

// Validate menu selections
export async function validateMenuSelections(
  selections: MenuSelection[]
): Promise<ValidationResult> {
  const menuItemIds = selections.map(s => s.menu_item_id);
  
  const { data: validItems } = await supabase
    .from('menu_items')
    .select('id, price, is_available')
    .in('id', menuItemIds);
    
  // Ensure all items are available
  const unavailableItems = selections.filter(
    s => !validItems?.find(v => v.id === s.menu_item_id && v.is_available)
  );
  
  if (unavailableItems.length > 0) {
    return {
      valid: false,
      errors: unavailableItems.map(item => ({
        field: 'menu_item_id',
        message: `Item ${item.menu_item_id} is not available`
      }))
    };
  }
  
  return { valid: true };
}
```

## 9. Cron Job Integration

### New Cron Jobs

```yaml
# Add to vercel.json
{
  "crons": [
    {
      "path": "/api/cron/table-booking-reminders",
      "schedule": "0 10 * * 6"  # Saturday 10 AM for Sunday lunch
    },
    {
      "path": "/api/cron/table-booking-reviews",
      "schedule": "0 */2 * * *"  # Every 2 hours
    }
  ]
}
```

### Reminder Implementation
```typescript
// /api/cron/table-booking-reminders/route.ts
export async function GET(request: NextRequest) {
  // Verify cron secret
  if (!verifyCronSecret(request)) {
    return new Response('Unauthorized', { status: 401 });
  }
  
  // Get tomorrow's Sunday lunch bookings
  const tomorrow = addDays(new Date(), 1);
  const { data: bookings } = await supabase
    .from('table_bookings')
    .select(`
      *,
      customer:customers(*),
      items:table_booking_items(*)
    `)
    .eq('booking_date', format(tomorrow, 'yyyy-MM-dd'))
    .eq('booking_type', 'sunday_lunch')
    .eq('status', 'confirmed');
    
  // Queue reminders
  for (const booking of bookings || []) {
    await queueBookingReminderSMS(booking);
    await sendBookingReminderEmail(booking);
  }
  
  return Response.json({ 
    success: true, 
    reminders_sent: bookings?.length || 0 
  });
}
```

## 10. Payment Integration

### PayPal Webhook Handler

```typescript
// /api/webhooks/paypal/table-bookings/route.ts
export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);
  
  // Verify PayPal webhook signature
  if (!verifyPayPalWebhook(body, headers)) {
    return new Response('Invalid signature', { status: 401 });
  }
  
  const event = JSON.parse(body);
  
  // Log webhook
  await supabase.from('webhook_logs').insert({
    provider: 'paypal',
    event_type: event.event_type,
    webhook_id: event.id,
    payload: event,
    headers
  });
  
  // Process based on event type
  switch (event.event_type) {
    case 'PAYMENT.CAPTURE.COMPLETED':
      await handlePaymentCompleted(event);
      break;
    case 'PAYMENT.CAPTURE.REFUNDED':
      await handleRefundCompleted(event);
      break;
  }
  
  return Response.json({ received: true });
}
```

## Migration Strategy

### Phase 1: Database Setup
1. Run migration to create new tables
2. Add new permissions to RBAC
3. Configure API scopes

### Phase 2: Integration Testing
1. Test customer matching with existing records
2. Verify SMS delivery through job queue
3. Confirm email templates render correctly
4. Validate audit logging

### Phase 3: Gradual Rollout
1. Enable for staff testing
2. Limited customer beta
3. Full launch with monitoring

## Monitoring & Alerts

### Key Metrics
- Booking creation success rate
- Payment completion rate
- SMS delivery success
- API response times
- No-show rates

### Alert Conditions
- Payment failures > 5% in 1 hour
- SMS delivery < 95% success rate
- API errors > 1% of requests
- Database connection failures

## Data Consistency

### Transaction Management
```typescript
// Ensure consistency across systems
export async function createBookingWithPayment(
  bookingData: BookingData,
  paymentData: PaymentData
): Promise<Result> {
  const { data, error } = await supabase.rpc('create_booking_transaction', {
    booking_data: bookingData,
    payment_data: paymentData
  });
  
  if (error) {
    // Rollback handled by database transaction
    return { error: 'Booking creation failed' };
  }
  
  // Queue post-creation tasks
  await Promise.all([
    queueBookingConfirmationSMS(data.booking),
    sendBookingConfirmationEmail(data.booking),
    logBookingAction('created', data.booking)
  ]);
  
  return { data };
}
```

## Security Considerations

### Data Access
- Customer can only view/modify own bookings
- Staff permissions enforced via RBAC
- API access scoped appropriately

### PII Protection
- Phone numbers stored in standardized format
- Email addresses encrypted at rest
- Payment details never stored (PayPal handles)

### Rate Limiting
- Reuse existing rate limiting infrastructure
- Special limits for booking creation
- Protect availability endpoint from abuse
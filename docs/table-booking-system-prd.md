# Product Requirements Document: Table Booking System

## Executive Summary

The Anchor Pub requires a comprehensive table booking system to handle restaurant dining reservations (distinct from private bookings and event bookings). The system will feature PayPal integration for Sunday lunch pre-payments, provide APIs for website integration, and handle all booking functionality including availability management, customer notifications, and staff communications.

## Project Overview

### Business Context
- **Purpose**: Enable customers to book tables for dining through the pub's website
- **Distinction**: This is separate from existing private venue bookings and event bookings
- **Key Differentiator**: Sunday lunch requires pre-payment via PayPal; regular dining does not

### Success Criteria
- Reduce phone booking calls by 70%
- Achieve 95% booking accuracy
- Increase Sunday lunch attendance by 30%
- Generate 50+ new Google reviews through automated follow-ups
- Process 100% of Sunday lunch bookings with pre-payment

## System Architecture

### Integration Points
1. **Existing Systems**
   - Customer management system (existing)
   - SMS notification system (Twilio - existing)
   - Email system (Microsoft Graph - existing)
   - Audit logging system (existing)
   - Role-based access control (existing)

2. **New Integrations**
   - PayPal Payment Gateway
   - Table management system
   - Kitchen capacity planning

### Technical Stack
- **Backend**: Next.js 15 with Server Actions
- **Database**: Supabase (PostgreSQL)
- **Payments**: PayPal API v2
- **SMS**: Twilio (existing integration)
- **Email**: Microsoft Graph API (existing)
- **Authentication**: Supabase Auth (existing)
- **Hosting**: Vercel

## Core Features

### 1. Table Availability Management

#### Business Hours Integration
- Leverage existing `business_hours` and `special_hours` tables
- Kitchen hours enforcement from existing settings:
  - Tuesday-Friday: 6pm-9pm
  - Saturday: 1pm-7pm
  - Sunday: 12pm-5pm (Sunday lunch special)
  - Monday: Closed
- Holiday overrides and special closures managed through existing Business Hours settings page
- No separate time slot configuration needed - all derived from kitchen hours

#### Capacity Management
- Define total table capacity
- Track real-time availability
- Support different table sizes (2, 4, 6, 8 seaters)
- Time slots automatically generated from kitchen hours in business_hours table
- Default 2-hour booking duration

### 2. Booking Types

#### A. Sunday Lunch Bookings
**Special Requirements:**
- Pre-payment required via PayPal
- Order details captured at booking time
- 1pm Saturday cutoff for same-week Sunday
- Maximum 8 weeks advance booking
- Time slots: 12:00, 12:30, 1:00, 1:30, 2:00, 2:30, 3:00

**Data Captured:**
- Customer details (name, email, phone)
- Party size vs. roast orders (not everyone may order)
- Menu selections per person
- Dietary requirements and allergies
- Special requests
- Total price calculation

#### B. Regular Table Bookings
**Requirements:**
- No pre-payment required
- 2-hour advance notice for cancellation
- Standard booking information only

**Data Captured:**
- Customer details
- Party size
- Date and time
- Special requirements
- Duration needed

### 3. PayPal Integration

#### Payment Flow
1. Customer selects Sunday lunch booking
2. System calculates total based on selections
3. PayPal checkout initiated
4. Payment confirmation received
5. Booking confirmed and logged
6. SMS/Email confirmations sent

#### Technical Implementation
- Use PayPal API v2 REST APIs
- Implement webhooks for payment status
- Handle refunds per cancellation policy
- Store transaction IDs with bookings

#### Refund Policy
- 48+ hours notice: 100% refund
- 24-48 hours notice: 50% refund
- <24 hours notice: No refund

### 4. Customer Management

#### Customer Matching
- Use existing phone number matching logic
- Check SMS opt-in status
- Create new customers if needed
- Link bookings to customer records

#### Customer Portal Features
- View upcoming bookings
- Cancel bookings (with refund eligibility)
- Modify party size or time
- Update dietary requirements

### 5. Notification System

#### Customer Notifications

**A. Immediate Booking Confirmation**
- Email with full details
- Calendar file attachment (.ics)
- Cancellation link
- Contact information

**B. Reminder Messages**
- Saturday morning for Sunday bookings
- Include all booking details
- Menu selections reminder
- Allergy information highlighted

**C. Post-Visit Review Request**
- Sent 4-6 hours after visit
- Google review link
- Thank you message

#### Staff Notifications

**A. New Booking Alert** (manager@the-anchor.pub)
- Customer details
- Order information
- **Allergies prominently displayed**
- Special requests
- Phone number for contact

**B. Kitchen Prep List** (kitchen@the-anchor.pub)
- Saturday 2pm for Sunday service
- Roast quantities by type
- All allergies listed
- Time slot breakdown
- Special dietary requirements

**C. Daily Summary** (manager@the-anchor.pub)
- Today's bookings by time
- Party sizes
- Special requirements
- Contact details

### 6. API Endpoints

#### Public Endpoints (Website Integration)

```
GET /api/table-bookings/availability
- Parameters: date, party_size, booking_type
- Returns: available time slots

POST /api/table-bookings/create
- Body: customer details, selections, payment info
- Returns: booking ID, payment URL (if needed)

GET /api/table-bookings/menu/sunday-lunch
- Returns: current Sunday lunch menu with prices

POST /api/table-bookings/confirm-payment
- Body: PayPal transaction ID, booking ID
- Returns: confirmed booking details
```

#### Management Endpoints (Internal)

```
GET /api/table-bookings
- Returns: all bookings with filters

PUT /api/table-bookings/:id
- Updates booking details

DELETE /api/table-bookings/:id
- Cancels booking (triggers refund if applicable)

POST /api/table-bookings/:id/no-show
- Marks customer as no-show
```

## Database Schema

### New Tables

#### table_bookings
```sql
- id (UUID, primary key)
- booking_reference (string, unique)
- customer_id (UUID, references customers)
- booking_date (date)
- booking_time (time)
- party_size (integer)
- tables_assigned (JSONB) -- flexibility for table assignment
- booking_type (enum: 'regular', 'sunday_lunch')
- status (enum: 'pending', 'confirmed', 'cancelled', 'no_show', 'completed')
- created_at (timestamp)
- updated_at (timestamp)
```

#### table_booking_items (Sunday lunch orders)
```sql
- id (UUID, primary key)
- booking_id (UUID, references table_bookings)
- menu_item_id (UUID, references menu_items)
- quantity (integer)
- special_requests (text)
- price_at_booking (decimal)
```

#### table_booking_payments
```sql
- id (UUID, primary key)
- booking_id (UUID, references table_bookings)
- payment_method (enum: 'paypal')
- transaction_id (string)
- amount (decimal)
- currency (string, default 'GBP')
- status (enum: 'pending', 'completed', 'refunded', 'partial_refund')
- refund_amount (decimal, nullable)
- payment_metadata (JSONB)
- created_at (timestamp)
```

#### table_configuration
```sql
- id (UUID, primary key)
- table_number (string)
- capacity (integer)
- is_active (boolean)
- notes (text)
```

#### booking_time_slots
```sql
- id (UUID, primary key)
- day_of_week (integer)
- slot_time (time)
- duration_minutes (integer, default 120)
- max_covers (integer)
- booking_type (enum: 'regular', 'sunday_lunch', 'both')
- is_active (boolean)
```
Note: Time slots are automatically generated based on kitchen hours from business_hours table. This table primarily stores capacity limits per time period.

### Updates to Existing Tables

#### customers
- Add `booking_count` (integer)
- Add `no_show_count` (integer)
- Add `last_booking_date` (timestamp)

## Security & Compliance

### Data Protection
- PCI compliance not required (PayPal handles card data)
- GDPR compliance for customer data
- Secure storage of personal information
- Audit trail for all booking modifications

### Access Control
- Use existing RBAC system
- New permissions:
  - `table_bookings.view`
  - `table_bookings.create`
  - `table_bookings.edit`
  - `table_bookings.cancel`
  - `table_bookings.manage`

## Implementation Phases

### Phase 1: Foundation (Week 1-2)
1. Database schema creation
2. Basic CRUD operations
3. Availability calculation engine
4. Integration with existing systems

### Phase 2: Booking Flow (Week 3-4)
1. Regular table booking implementation
2. Customer portal basic features
3. Staff notification system
4. Basic reporting

### Phase 3: Sunday Lunch & Payments (Week 5-6)
1. PayPal integration
2. Sunday lunch specific features
3. Menu item selection
4. Payment processing and refunds

### Phase 4: Polish & Launch (Week 7-8)
1. Comprehensive testing
2. Staff training materials
3. Customer documentation
4. Performance optimization
5. Launch preparation

## Success Metrics

### Technical Metrics
- API response time < 200ms
- 99.9% uptime
- Zero payment processing errors
- 100% notification delivery rate

### Business Metrics
- Booking conversion rate > 80%
- Customer satisfaction score > 4.5/5
- Staff time saved: 10 hours/week
- Revenue increase from pre-payments
- Reduction in no-shows by 50%

## Risk Mitigation

### Technical Risks
- **Payment failures**: Implement retry logic and manual override
- **System downtime**: Fallback to phone bookings
- **Data loss**: Regular backups and audit trails

### Business Risks
- **Customer adoption**: Incentivize online bookings
- **Staff resistance**: Comprehensive training program
- **No-shows**: Pre-payment for Sunday lunch, deposit option for large parties

## Future Enhancements

### Phase 2 Considerations
1. Loyalty program integration
2. Dynamic pricing for peak times
3. Table preference management
4. Waiting list functionality
5. Integration with POS system
6. Advanced analytics and forecasting

## Appendix

### API Authentication
- Use existing API key system
- Require `write:bookings` scope for modifications
- Public read endpoints for availability

### Error Handling
- Comprehensive error messages
- User-friendly feedback
- Detailed logging for debugging
- Graceful degradation

### Testing Strategy
- Unit tests for business logic
- Integration tests for payment flow
- End-to-end tests for booking journey
- Load testing for Sunday lunch rush
- User acceptance testing with staff
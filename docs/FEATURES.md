# Anchor Management Tools - Features Documentation

## Overview

The Anchor Management Tools is a comprehensive venue management system that streamlines operations for The Anchor pub. It integrates event scheduling, customer management, employee records, private bookings, table reservations, invoicing, SMS communications, and loyalty programs into a unified platform.

## Feature Matrix

| Feature | Module | Status | Key Capabilities |
|---------|--------|--------|------------------|
| **Authentication** | Core | ✅ Live | Email/password login, session management, route protection |
| **Events Management** | Events | ✅ Live | Event creation, booking management, capacity tracking |
| **Customer Management** | Customers | ✅ Live | Customer records, booking history, SMS preferences |
| **Employee Management** | Employees | ✅ Live | Staff records, documents, notes, compliance tracking |
| **SMS Communications** | SMS | ✅ Live | Automated reminders, confirmations, Twilio integration |
| **Private Bookings** | Private Bookings | ✅ Live | Venue hire, deposits, contracts, item management |
| **Table Bookings** | Table Bookings | ✅ Live | Restaurant reservations, PayPal integration, availability |
| **Parking Management** | Parking | 🚧 Beta | Car-park bookings, PayPal payments, automated SMS/email reminders (UI live; refunds & automated tests pending) |
| **Invoicing System** | Invoices | ✅ Live | Invoice/quote management, VAT compliance, payment tracking |
| **Loyalty Program** | Loyalty | 🚧 Planned | Points, tiers, achievements, rewards, check-in system |

## Feature Documentation

### 1. Authentication System

**Purpose**: Secure access control for staff members using Supabase Auth.

**Key Features**:
- Email/password authentication
- Secure session management via JWT tokens
- Automatic session refresh
- Protected route middleware
- No public registration (admin-controlled)

**User Flow**:
1. User visits protected route
2. Middleware checks for valid session
3. Redirects to `/auth/login` if not authenticated
4. User enters credentials
5. Successful login redirects to original destination

**Security Features**:
- Passwords hashed with bcrypt
- HTTP-only secure cookies
- CSRF protection
- Session expiry after inactivity
- Server-side validation

---

### 2. Events Management

**Purpose**: Core system for creating and managing venue events with customer bookings.

**Key Features**:
- Event creation with name, date, time, and optional capacity
- Chronological event listing with booking counts
- Customer booking management per event
- Automatic SMS reminders (7-day and 24-hour)
- Cascade deletion of bookings when event deleted

**Event Types Supported**:
- Regular events (open capacity)
- Limited capacity events
- Reminder-only registrations (0 seats)

**Booking Integration**:
- One booking per customer per event
- Seats tracking (0 = reminder only)
- Optional booking notes
- Direct booking from event page
- SMS confirmation on booking

**Business Rules**:
- Events sorted by date ascending
- Time stored as free text for flexibility
- Capacity is optional (null = unlimited)
- All changes trigger appropriate SMS

---

### 3. Customer Management

**Purpose**: Comprehensive customer database with booking history and communication tracking.

**Key Features**:
- Customer profiles (name, mobile number)
- Complete booking history
- SMS communication preferences
- Active bookings vs reminder-only display
- Quick booking creation from customer page

**Customer Data Model**:
```typescript
{
  id: string
  first_name: string
  last_name: string
  mobile_number: string
  created_at: string
}
```

**Booking Management**:
- View all customer bookings
- Separate sections for active bookings and reminders
- Edit/delete bookings with SMS notifications
- Add new bookings with event selection modal

**SMS Integration**:
- Automatic confirmations for new bookings
- Updates sent on modifications
- 7-day and 24-hour event reminders
- Personalized message templates

---

### 4. Employee Management

**Purpose**: Complete employee record system with document storage and compliance tracking.

**Key Features**:
- Comprehensive employee profiles
- Document management (contracts, IDs, reviews)
- Time-stamped notes system
- Emergency contact information
- Employment status tracking (Active/Former)

**Document Categories**:
- Contract
- ID Scan
- Right to Work Document
- Performance Review
- Other

**File Management**:
- Secure Supabase Storage
- 10MB file size limit
- Supported: PDF, PNG, JPG, JPEG
- Organized by employee ID
- Signed URLs for secure access

**Notes System**:
- Permanent, time-stamped entries
- Cannot be edited or deleted
- User attribution tracking
- Chronological display
- Audit trail compliance

**Employment Tracking**:
- Start/end dates
- Job titles
- Status management
- Email uniqueness validation

---

### 5. SMS Communications

**Purpose**: Automated customer notifications via Twilio for bookings and reminders.

**Message Types**:

**Booking Confirmation** (Immediate):
```
Hi [Name], your booking for [Event] on [Date] at [Time] 
is confirmed. We've reserved [X] seat(s) for you. 
Reply to this message if you need to make any changes. 
The Anchor.
```

**7-Day Reminder** (All customers):
```
Hi [Name], don't forget, we've got our [Event] on [Date] 
at [Time]! If you'd like to book seats, WhatsApp/Call 
01753682707. The Anchor.
```

**24-Hour Reminder** (Booked customers):
```
Hi [Name], just a reminder that you're booked for [Event] 
tomorrow at [Time]. We look forward to seeing you! 
Reply to this message if you need to make any changes. 
The Anchor.
```

**Technical Implementation**:
- Daily cron job at 9 AM UTC
- Batch processing for efficiency
- Phone number validation (UK format)
- Delivery status tracking
- Error handling and retries

**Configuration**:
- Twilio Account SID
- Auth Token
- Phone Number (+44 format)
- Webhook URLs for status callbacks

---

### 6. Private Bookings

**Purpose**: Manage private venue hire with deposits, contracts, and comprehensive tracking.

**Key Features**:
- Booking workflow (Draft → Tentative → Confirmed → Completed)
- Financial management (deposits, payments, discounts)
- Item management (spaces, catering, vendors)
- Contract generation with version tracking
- SMS automation for status changes
- Complete audit trail

**Booking Components**:
- Customer details (existing or new)
- Event date/time with setup time
- Guest count tracking
- Special requirements
- Internal notes

**Financial Features**:
- Deposit tracking
- Final payment recording
- Percentage or fixed discounts
- Balance calculations
- Payment due dates

**Item Management**:
- Venue spaces (Bar, Restaurant, etc.)
- Catering packages
- Third-party vendors
- Custom line items
- Quantity and pricing

**Status Workflow**:
1. **Draft**: Initial inquiry
2. **Tentative**: Provisional booking
3. **Confirmed**: Deposit received
4. **Completed**: Event finished
5. **Cancelled**: Booking cancelled

**User Flow Overview**:

**Creating a Booking**:
1. Navigate to Private Bookings list → Click "New Booking"
2. Search for existing customer or enter new customer details
3. Fill in event details (date, type, times, guest count)
4. Add setup details and any notes/requests
5. Submit form → Booking created in 'Draft' status
6. System automatically queues draft SMS notification

**Managing a Booking**:
From the booking view page, users can:
- Change booking status (following allowed transitions)
- Record deposit and final payments
- Manage booking items (spaces, catering, vendors)
- Apply percentage or fixed discounts
- Send SMS messages using templates
- Generate and track contract versions
- Edit basic booking details

**Financial Management**:
- Custom deposit amounts with payment method tracking
- Final payment recording with balance calculation
- Discount application with reason tracking
- Automatic financial status updates
- Payment methods: Card, Cash, Invoice

**Item Management**:
- **Venue Spaces**: Bar, Restaurant, Beer Garden, etc.
- **Catering Packages**: Predefined meal options
- **Vendor Services**: Third-party suppliers
- **Utilities**: Fixed electricity charge (£25)
- **Custom Items**: Free-text entries for flexibility

**Communication Flow**:
- Automatic SMS on status changes
- Manual message sending with template selection
- Message preview before sending
- Approval workflow for certain message types
- Complete message history tracking

**Known Limitations**:
- Some fields only accessible via modals (not forms)
- Cannot change customer after booking creation
- Limited bulk operations for multiple bookings
- Two-step process for financial updates

---

### 7. Table Bookings

**Purpose**: Restaurant table reservation system with PayPal integration for Sunday lunch.

**Key Features**:
- Online table reservations
- PayPal pre-payment for Sunday lunch
- Regular dining bookings (no payment)
- API endpoints for website integration
- Automated customer notifications
- Kitchen capacity management

**Booking Types**:

**Sunday Lunch** (Special):
- Pre-payment required via PayPal
- Menu selections captured
- Saturday 1pm cutoff
- 8 weeks advance booking limit
- Dietary requirements tracking

**Regular Dining**:
- No pre-payment required
- 2-hour advance notice for cancellation
- Standard booking information
- Duration tracking

**Business Hours Integration**:
- Leverages existing business_hours table
- Kitchen hours enforcement:
  - Tuesday-Friday: 6pm-9pm
  - Saturday: 1pm-7pm
  - Sunday: 12pm-5pm
  - Monday: Closed
- Holiday overrides supported

**API Endpoints**:
```
GET  /api/table-bookings/availability
POST /api/table-bookings/create
GET  /api/table-bookings/menu/sunday-lunch
POST /api/table-bookings/confirm-payment
```

**Notifications**:
- Immediate booking confirmation
- Saturday morning reminder for Sunday
- Post-visit review request
- Staff alerts for new bookings
- Kitchen prep list (Saturday 2pm)

---

### 8. Invoicing System

**Purpose**: Comprehensive invoice and quote management with UK VAT compliance.

**Access**: Super Admin role required

**Invoice Features**:
- Create/edit invoices with line items
- VAT calculation (0%, 5%, 20%)
- Line and invoice-level discounts
- Payment tracking
- Status management
- Bulk export functionality

**Quote Features**:
- Create professional quotes
- Valid until dates
- Convert to invoice when accepted
- Status tracking (Draft/Sent/Accepted/Rejected)

**Financial Calculations**:
1. Line subtotal
2. Line discount application
3. Invoice discount application
4. VAT calculation
5. Final total

**Export Capabilities**:
- Date range selection
- Status filtering
- ZIP file generation with:
  - Individual HTML invoices
  - CSV summary
  - README documentation

**Email Integration**:
- Send invoices/quotes via email
- PDF attachment generation
- Microsoft Graph API integration
- Automatic status updates

**Company Details**:
- Orange Jelly Limited
- VAT Number: 315203647
- Company Registration: 08869155
- Bank: Starling Bank

---

### 9. Loyalty Program (Planned)

**Purpose**: Comprehensive digital loyalty platform with gamification and rewards.

**Core Components**:

**Tier System**:
- 🌟 VIP Member (0 events) - Entry level
- 🥉 VIP Bronze (5+ events) - 100 points/visit
- 🥈 VIP Silver (10+ events) - 150 points/visit
- 🥇 VIP Gold (20+ events) - 200 points/visit
- 💎 VIP Platinum (40+ events) - 300 points/visit

**Points System**:
- Base attendance: 50 points
- Tier multipliers: 2x-6x
- Bonus opportunities:
  - First visit of month: +50
  - Bring new member: +100
  - Birthday month: Double points
  - Bad weather: Triple points

**Achievements**:
- First Timer (25 points)
- Week Warrior (100 points)
- Event Explorer (150 points)
- Social Butterfly (200 points)
- Super Fan (500 points)

**Rewards Catalog**:
- 100 points: House snack
- 500 points: House drink
- 1000 points: Bring a friend free
- 2000 points: £10 credit
- 5000 points: Host theme night

**Check-In System**:
- Event-specific QR codes
- Phone number verification
- Instant point allocation
- Staff scanning interface

**Customer Portal (/loyalty)**:
- Phone + SMS OTP authentication
- Points balance and tier status
- Achievement badges
- Event history
- Reward redemption

---

## Feature Interactions

### Customer Journey Flow
1. **New Customer** → Created in system → Books event → Receives SMS
2. **Booking Created** → SMS confirmation → Added to event → Reminders scheduled
3. **Event Day** → Check-in (future) → Points earned → Achievement progress
4. **Post-Event** → Review request → Loyalty points → Tier progression

### Staff Workflow Integration
1. **Daily Operations** → Check events → Review bookings → Print attendee lists
2. **Customer Service** → Look up customer → View history → Make bookings
3. **Financial Tasks** → Create invoices → Track payments → Generate reports
4. **Employee Management** → Update records → Upload documents → Add notes

### System Dependencies
- **Authentication** → Required for all features
- **Customers** → Central to bookings, SMS, loyalty
- **Events** → Drives bookings and reminders
- **SMS** → Triggered by bookings, events, loyalty
- **Private/Table Bookings** → Separate but use same customer base

---

## Configuration Options

### Environment Variables
```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY

# Twilio SMS
TWILIO_ACCOUNT_SID
TWILIO_AUTH_TOKEN
TWILIO_PHONE_NUMBER

# PayPal (Table Bookings)
PAYPAL_CLIENT_ID
PAYPAL_CLIENT_SECRET

# Microsoft Graph (Email)
MICROSOFT_TENANT_ID
MICROSOFT_CLIENT_ID
MICROSOFT_CLIENT_SECRET
MICROSOFT_USER_EMAIL

# Contact Information
NEXT_PUBLIC_CONTACT_PHONE_NUMBER
```

### Business Settings
- **Business Hours**: Managed via settings page
- **SMS Templates**: Customizable in codebase
- **Capacity Limits**: Per event or table configuration
- **Payment Terms**: Configurable for invoices
- **Loyalty Tiers**: Database-driven configuration

### Role Permissions
- **Super Admin**: Full system access
- **Manager**: Most features except invoicing
- **Staff**: Basic operations, no financial access

---

## Usage Examples

### Creating an Event with Bookings
1. Navigate to Events → Add Event
2. Enter event details (name, date, time, capacity)
3. Save event
4. From event page, click "Add Booking"
5. Search/select customer
6. Enter seats and notes
7. Save - SMS confirmation sent automatically

### Processing a Private Booking
1. Create new private booking
2. Select/create customer
3. Set event details and requirements
4. Add venue spaces and catering
5. Generate contract
6. Record deposit to confirm
7. System sends confirmation SMS

### Managing Employee Records
1. Add new employee with required fields
2. Upload contract and ID documents
3. Add onboarding notes
4. Set as Active status
5. Update throughout employment
6. Change to Former on departure

### Creating an Invoice
1. Navigate to Invoices (Super Admin only)
2. Select vendor or create new
3. Add line items with VAT rates
4. Apply discounts if needed
5. Save as draft or send
6. Record payments as received
7. Export for accounting

---

## Best Practices

### Data Entry
- Use consistent name formatting
- Verify phone numbers for SMS
- Complete all required fields
- Add notes for special requirements
- Keep status fields current

### Customer Service
- Always verify customer identity
- Check booking history before creating new
- Use notes field for important details
- Follow up on special requests
- Monitor SMS delivery status

### Financial Management
- Record payments promptly
- Keep invoice statuses updated
- Regular payment reconciliation
- Monthly export for accounting
- Track outstanding balances

### System Maintenance
- Regular data backups
- Monitor SMS usage/costs
- Review audit logs
- Update employee records
- Clean up old data periodically

---

## Troubleshooting Guide

### Common Issues

**Customer SMS Not Received**:
- Verify phone number format (+44...)
- Check SMS logs in system
- Test with known working number
- Review Twilio dashboard
- Check customer messaging health

**Booking Conflicts**:
- Check event capacity
- Verify customer not already booked
- Review event date/time
- Check for system errors
- Clear browser cache

**Login Problems**:
- Verify email address
- Check password requirements
- Clear cookies
- Try incognito mode
- Contact admin for reset

**File Upload Failures**:
- Check file size (<10MB)
- Verify file type allowed
- Test internet connection
- Try different browser
- Check storage quota

---

## Future Enhancements

### Confirmed Roadmap
1. **Loyalty Program Launch** - Points, tiers, and rewards
2. **Enhanced Analytics** - Comprehensive dashboards
3. **Mobile App** - Staff and customer versions
4. **POS Integration** - Direct order linking

### Under Consideration
- Multi-venue support
- Advanced reporting suite
- Customer self-service portal
- Automated marketing campaigns
- Inventory management
- Staff scheduling integration

---

## Support & Resources

- **Technical Documentation**: `/docs` directory
- **API Documentation**: `/docs/API.md`
- **Database Schema**: `/docs/DATABASE.md`
- **Security Guidelines**: `/docs/SECURITY.md`
- **Development Guide**: `/CLAUDE.md`

For additional support, contact the development team or refer to the comprehensive documentation in the project repository.

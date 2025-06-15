# Customer Management

## Overview

The customer management system allows The Anchor staff to maintain a comprehensive database of venue patrons, track their bookings, and communicate via SMS. This system integrates closely with events and automated messaging.

## Features

### Customer Records
- Store essential contact information
- Track booking history
- Manage communication preferences
- Support for notes and special requirements
- Mobile-optimized interface

### Customer Creation
- Simple form for new customers
- Required: First name, last name, mobile number
- Automatic validation of phone numbers
- No duplicate checking (allows same name)
- Immediate availability for bookings

### Customer Listing
- Alphabetical display by last name
- Shows name and mobile number
- Quick search capabilities
- Click to view full details
- Responsive table/card layout

### Customer Details
- Complete profile information
- Active bookings section
- Reminder-only bookings section
- Booking history with dates
- Direct booking management

### Customer Editing
- Update any customer information
- Phone number validation
- Changes apply immediately
- Maintains booking associations
- Historical data preserved

### Customer Deletion
- Remove customer records
- Cascade deletes all bookings
- No SMS sent on deletion
- Confirmation required
- Permanent removal

## User Interface

### Customers List Page (`/customers`)
Main customer management hub:
- Header with "Add Customer" button
- Searchable customer list
- Name and phone display
- Click for detailed view
- Mobile-friendly cards

### Add Customer Page (`/customers/new`)
Streamlined form:
- First name (required)
- Last name (required)
- Mobile number (required)
- Save and Cancel buttons
- Validation feedback

### Customer Details Page (`/customers/[id]`)
Comprehensive view includes:
- Customer information header
- Edit and Delete buttons
- Active bookings table
- Reminders table
- Add booking functionality
- Booking management options

### Edit Customer Page (`/customers/[id]/edit`)
Update form with:
- Pre-filled current data
- Same fields as creation
- Validation on save
- Cancel option
- Success confirmation

## Booking Management

### From Customer Page
- "Add Booking" button
- First select event from modal
- Then complete booking form
- Seats and notes options
- Automatic SMS confirmation

### Viewing Bookings
Two sections displayed:
1. **Active Bookings** (seats > 0)
   - Event name and date
   - Number of seats
   - Booking notes
   - Edit/Delete options

2. **Reminders** (seats = 0)
   - Event information
   - Note that it's reminder only
   - Same management options

### Editing Bookings
- Click edit on any booking
- Modal with current details
- Update seats or notes
- Save sends confirmation SMS
- Instant updates

## SMS Communication

### Automatic Messages
Customers receive SMS for:
- New booking confirmation
- Booking modifications
- 7-day event reminders
- 24-hour event reminders
- All messages personalized

### Message Personalization
Templates include:
- Customer first name
- Event details
- Booking specifics
- Venue contact info
- Clear call-to-action

## Data Model

### Customer Table Structure
```typescript
{
  id: string              // UUID primary key
  first_name: string      // Customer's first name
  last_name: string       // Customer's last name
  mobile_number: string   // SMS-capable number
  created_at: string      // Registration timestamp
}
```

### Related Data
- **bookings**: All customer bookings
- **events**: Events they're booked for
- Cascade deletion enabled

## Business Rules

### Customer Constraints
- Both names required
- Valid mobile number format
- Phone must support SMS
- No email required
- Simple data model

### Booking Rules
- One booking per event
- Can book multiple events
- Zero seats = reminder
- Positive seats = attending
- Notes optional

### Data Privacy
- Minimal data collection
- No sensitive information
- Secure storage
- Admin access only
- GDPR considerations

## Best Practices

### Data Entry
- Consistent name formatting
- Verify phone numbers
- Use proper capitalization
- Avoid abbreviations
- Complete all fields

### Phone Numbers
- Include country code if needed
- Verify SMS capability
- Test with customer if unsure
- Update if changed
- Handle international formats

### Customer Service
- Keep notes updated
- Track preferences
- Record special needs
- Note communication issues
- Build relationships

## Common Workflows

### New Customer Registration
1. Customer expresses interest
2. Staff creates profile
3. Enter accurate details
4. Verify phone number
5. Book for relevant events

### Repeat Customer Booking
1. Search existing customers
2. Open customer profile
3. Click "Add Booking"
4. Select event
5. Confirm details

### Customer Information Update
1. Customer provides new details
2. Find customer record
3. Click Edit button
4. Update information
5. Save changes

## Search and Filter

### Finding Customers
- Search by name
- Filter by booking status
- Sort alphabetically
- Quick navigation
- Keyboard shortcuts

### Advanced Search
Future features planned:
- Phone number search
- Booking history filter
- Date range queries
- Export capabilities
- Saved searches

## Troubleshooting

### Customer Not Found
- Check spelling
- Try partial search
- Verify in database
- Check deleted status
- Review filters

### SMS Not Received
- Verify phone number
- Check SMS logs
- Test number validity
- Review Twilio status
- Consider blocklists

### Booking Issues
- Ensure event exists
- Check duplicate bookings
- Verify customer data
- Review validation
- Check capacity

## Performance

### Large Customer Lists
- Pagination implemented
- Efficient queries
- Indexed searches
- Progressive loading
- Optimized rendering

### Bulk Operations
Currently limited, future:
- Bulk SMS sending
- Mass updates
- Import/Export
- Batch deletion
- Group management

## Integration Points

### Event System
- Seamless booking creation
- Real-time availability
- Capacity checking
- Date validation
- SMS triggers

### SMS System
- Automatic messaging
- Template variables
- Delivery tracking
- Error handling
- Retry logic

## Future Enhancements

### Planned Features
1. Customer preferences
2. Booking history analytics
3. Loyalty tracking
4. Email communication
5. Advanced search

### Potential Improvements
1. Duplicate detection
2. Merge customers
3. Household grouping
4. Tags/Categories
5. Custom fields

## API Reference

### Server Actions
```typescript
// Create customer
addCustomer(formData: FormData)

// Update customer
updateCustomer(id: string, formData: FormData)

// Delete customer
deleteCustomer(id: string)

// Get customer with bookings
getCustomerWithBookings(id: string)
```

### Database Queries
```typescript
// List all customers
supabase.from('customers').select('*').order('last_name')

// Get single customer
supabase.from('customers').select('*').eq('id', customerId)

// Get with bookings
supabase.from('customers').select(`
  *,
  bookings (
    *,
    event:events(*)
  )
`).eq('id', customerId)
```

## Privacy and Compliance

### Data Protection
- Minimal data collection
- Secure storage
- Access controls
- Audit trails
- Regular reviews

### Customer Rights
- Data access requests
- Correction capabilities
- Deletion options
- Export functionality
- Consent management
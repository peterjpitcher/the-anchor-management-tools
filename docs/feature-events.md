# Event Management

## Overview

The event management system is the core of The Anchor Management Tools, allowing staff to create, manage, and track events at the venue. Events serve as the foundation for customer bookings and automated SMS reminders.

## Features

### Event Creation
- Add new events with name, date, and time
- Optional capacity limits for attendee management
- Simple form-based interface
- Automatic validation of required fields

### Event Listing
- Chronological display (ascending by date)
- Shows event name, date, time, and booking count
- Quick access to event details
- Responsive table/card layout for mobile

### Event Details
- Complete event information display
- List of all attendees with booking details
- Customer notes visible inline
- Quick links to edit customer bookings
- Add new bookings directly from event page

### Event Editing
- Update event name, date, time, or capacity
- Changes reflected immediately
- Validation prevents invalid updates
- Maintains booking associations

### Event Deletion
- Remove events when needed
- Cascade deletion of associated bookings
- Confirmation required to prevent accidents
- No orphaned data left behind

## User Interface

### Events List Page (`/events`)
The main events page displays:
- Page header with "Add Event" button
- Table of all events sorted by date
- Event name, date, time, and booking count
- Click any event to view details
- Responsive design for mobile devices

### Add Event Page (`/events/new`)
Simple form interface:
- Event name (required)
- Event date (date picker)
- Event time (text input, e.g., "7:00pm")
- Capacity (optional number)
- Save and Cancel buttons

### Event Details Page (`/events/[id]`)
Comprehensive event view:
- Event header with name and date/time
- Action buttons for booking management
- Attendees section with booking details
- Customer names link to their profiles
- Booking notes displayed inline
- Edit and back navigation

### Edit Event Page (`/events/[id]/edit`)
Pre-populated form:
- All current event details loaded
- Same fields as add event
- Save changes or cancel
- Validation on submission

## Booking Integration

### From Event Page
- "Add Booking" button opens modal
- Select customer from dropdown
- Only shows customers not already booked
- Enter seats and optional notes
- Automatic SMS confirmation sent

### Viewing Bookings
- All bookings listed on event page
- Shows customer name and seat count
- Notes displayed if present
- Click customer to navigate to booking

### Managing Bookings
- Edit booking via customer page
- Delete bookings individually
- Automatic SMS for changes
- Maintains data integrity

## SMS Integration

Events trigger automated SMS:
- **Booking Confirmation**: Sent immediately when booking created
- **7-Day Reminder**: Sent to all customers 7 days before
- **24-Hour Reminder**: Sent to booked customers 1 day before

## Data Model

### Event Table Structure
```typescript
{
  id: string          // UUID primary key
  name: string        // Event name
  date: string        // ISO date format
  time: string        // Time as text (e.g., "7:00pm")
  capacity?: number   // Optional max attendees
  created_at: string  // Timestamp
}
```

### Related Tables
- **bookings**: Links events to customers
- **customers**: Contains customer details
- Both use foreign keys for relationships

## Business Rules

### Event Constraints
- Name is required and must be non-empty
- Date must be valid calendar date
- Time stored as free text for flexibility
- Capacity is optional (null = unlimited)

### Booking Rules
- One booking per customer per event
- Customers can have zero seats (reminder only)
- Deleting event removes all bookings
- Changes trigger appropriate SMS

### Date Handling
- Dates stored in ISO format
- Displayed in user-friendly format
- Timezone considerations for SMS
- Proper sorting by date

## Best Practices

### Event Naming
- Use clear, descriptive names
- Include key details if helpful
- Consistent naming conventions
- Avoid special characters

### Time Entry
- Use consistent format (e.g., "7:00pm")
- Include AM/PM designation
- Consider 24-hour format
- Be precise for SMS timing

### Capacity Management
- Set realistic limits
- Leave null if unlimited
- Monitor booking counts
- Plan for walk-ins

## Common Workflows

### Weekly Event Setup
1. Review upcoming week
2. Create recurring events
3. Set appropriate capacities
4. Verify dates and times
5. Check SMS will send correctly

### Event Day Management
1. Review attendee list
2. Check for last-minute bookings
3. Note any special requirements
4. Print attendee list if needed
5. Track actual attendance

### Post-Event Tasks
1. Review attendance numbers
2. Note any issues
3. Update customer notes
4. Plan follow-up if needed
5. Archive or delete old events

## Troubleshooting

### Event Not Showing
- Check date filter/sorting
- Verify event was saved
- Refresh page
- Check for errors

### Can't Add Booking
- Verify customer exists
- Check not already booked
- Ensure event has capacity
- Review validation errors

### SMS Not Sending
- Verify phone numbers
- Check Twilio configuration
- Review SMS logs
- Test with known number

## Performance Tips

### Large Event Lists
- Events load progressively
- Use date filtering when available
- Archive old events periodically
- Monitor page load times

### Many Attendees
- Pagination for large lists
- Optimize queries
- Consider capacity limits
- Use search features

## Future Enhancements

### Planned Features
1. Recurring event templates
2. Event categories/types
3. Advanced capacity management
4. Waitlist functionality
5. Event check-in system

### Potential Improvements
1. Calendar view interface
2. Bulk event operations
3. Event duplication
4. Custom SMS templates
5. Attendance tracking

## API Reference

### Server Actions
```typescript
// Create event
addEvent(formData: FormData)

// Update event
updateEvent(id: string, formData: FormData)

// Delete event
deleteEvent(id: string)

// Get event with bookings
getEventWithBookings(id: string)
```

### Database Queries
```typescript
// List all events
supabase.from('events').select('*').order('date')

// Get single event
supabase.from('events').select('*').eq('id', eventId)

// Get event with bookings
supabase.from('events').select(`
  *,
  bookings (
    *,
    customer:customers(*)
  )
`).eq('id', eventId)
```
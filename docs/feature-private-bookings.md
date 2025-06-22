# Private Bookings Feature

## Overview

The Private Bookings feature enables management of venue hire for private events at The Anchor. It provides comprehensive booking management including customer details, event specifications, financial tracking, item management, and automated SMS communications.

## Key Features

- **Booking Management**: Create and manage private venue hire bookings with detailed event information
- **Customer Integration**: Link bookings to existing customers or create new ones
- **Financial Tracking**: Deposit and payment management with customizable amounts
- **Item Management**: Add venue spaces, catering packages, vendor services, and custom items
- **Status Workflow**: Structured progression from draft through to completion
- **SMS Automation**: Automatic notifications for booking confirmations and status changes
- **Document Generation**: Contract creation with version tracking
- **Audit Trail**: Complete history of all booking changes

## Database Schema

### Primary Table: `private_bookings`
- Stores core booking information including customer, event details, and financial data
- Uses UUID primary keys with foreign key relationships
- Includes generated columns for computed values
- Implements check constraints for data validation

### Related Tables:
- `private_booking_items`: Line items for spaces, catering, vendors
- `private_booking_documents`: Generated contracts and documents
- `private_booking_sms_queue`: SMS message queue with approval workflow
- `private_booking_audit`: Change history tracking

## User Interface

### List View (`/private-bookings`)
- Filterable list of all bookings
- Status badges with color coding
- Quick stats (upcoming, pending deposits, etc.)
- Links to create new bookings

### Create New Booking (`/private-bookings/new`)
- Customer search or new customer creation
- Event date and time selection
- Setup time configuration
- Basic notes and requests

### View Booking (`/private-bookings/[id]`)
- Complete booking details display
- Status management with modal
- Financial summary with payment recording
- Item management (add/edit/delete)
- Quick actions (SMS, contract, etc.)
- Notes and requirements display

### Edit Booking (`/private-bookings/[id]/edit`)
- Limited field editing
- Customer details (name, contact)
- Event details (date, time, guests)
- Notes and internal comments

### Additional Pages:
- **Messages** (`/[id]/messages`): Send SMS with templates
- **Contract** (`/[id]/contract`): Generate and view contracts
- **Calendar** (`/calendar`): Visual calendar view
- **SMS Queue** (`/sms-queue`): Manage pending messages
- **Settings** (`/settings/*`): Manage spaces, catering, vendors

## Permissions

Uses RBAC system with module-based permissions:
- `private_bookings.view`: View bookings
- `private_bookings.create`: Create new bookings
- `private_bookings.edit`: Modify existing bookings
- `private_bookings.delete`: Remove bookings
- `private_bookings.manage`: Full access including settings

## API Endpoints

### Server Actions (No REST API):
- `getPrivateBookings()`: List with filtering
- `getPrivateBooking()`: Single booking details
- `createPrivateBooking()`: Create new booking
- `updatePrivateBooking()`: Update existing
- `deletePrivateBooking()`: Soft delete
- `updateBookingStatus()`: Status transitions
- `recordDepositPayment()`: Record deposit
- `recordFinalPayment()`: Record final payment
- `applyBookingDiscount()`: Apply discounts

### Booking Items:
- `getBookingItems()`: List items for booking
- `addBookingItem()`: Add new item
- `updateBookingItem()`: Modify item
- `deleteBookingItem()`: Remove item

## Business Logic

### Status Workflow:
1. **Draft**: Initial inquiry state
2. **Tentative**: Provisional booking
3. **Confirmed**: Deposit received
4. **Completed**: Event finished
5. **Cancelled**: Booking cancelled

### Financial Calculations:
- Subtotal: Sum of all line items
- Discounts: Percentage or fixed amount
- Total: Subtotal minus discounts
- Balance: Total minus payments

### Automatic Actions:
- SMS queued on booking creation
- Balance due date calculated (7 days before event)
- Status change notifications

## SMS Integration

### Templates:
- Booking inquiry received
- Booking confirmed
- Payment reminders
- Custom messages

### Queue System:
- Messages queued with metadata
- Manager approval for certain types
- Automatic sending for others
- Status tracking and error handling

## Known Limitations

### Form Field Gaps:
1. **Missing in all forms**:
   - Special requirements field
   - Accessibility needs field
   - Booking source tracking

2. **Create form only**:
   - Setup date (missing in edit)
   - Customer selection (cannot change later)

3. **Modal-only access**:
   - Status changes
   - Payment recording
   - Discount application

### Workflow Issues:
- Two-step processes for common tasks
- Cannot reassign booking to different customer
- Financial fields not editable in forms
- Inconsistent event_type input (text vs dropdown)

## Best Practices

1. **Always set setup date** during creation if needed (cannot add later)
2. **Verify customer** before creating (cannot change later)
3. **Use internal notes** for staff communication
4. **Check SMS queue** after status changes
5. **Generate contract** before confirming booking
6. **Record deposits promptly** to secure bookings

## Security Considerations

- Row Level Security on all tables
- Audit logging for compliance
- Phone number validation
- Email format validation
- Permission checks on all operations

## Future Enhancements

### Planned:
- Document upload functionality
- Calendar integration
- Automated payment reminders
- Booking templates

### Recommended:
- Add missing form fields
- Enable customer reassignment
- Unify financial management
- Bulk operations support
- Enhanced reporting
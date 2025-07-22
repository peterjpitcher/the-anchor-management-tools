# Table Booking Admin Interface Specification

## Overview

The table booking admin interface will be integrated into the existing management system at `/table-bookings` with full RBAC support. Staff will have different levels of access based on their permissions.

## Navigation Structure

```
/table-bookings
├── /                          # Dashboard & Today's Bookings
├── /calendar                  # Calendar View
├── /search                    # Search & Filter Bookings
├── /new                       # Create Walk-in Booking
├── /[id]                      # Booking Details
├── /[id]/edit                 # Edit Booking
├── /reports                   # Reports & Analytics
├── /settings                  # Table Booking Settings
│   ├── /tables               # Table Configuration
│   ├── /time-slots           # Time Slot Management
│   ├── /policies             # Booking Policies
│   ├── /sms-templates        # SMS Template Editor
│   └── /menu                 # Sunday Lunch Menu Management
```

## Page Specifications

### 1. Dashboard (`/table-bookings`)

**Purpose**: Overview of today's bookings and key metrics

**Features**:
- Today's bookings timeline view
- Quick stats (covers today, no-shows this week, revenue)
- Upcoming arrivals (next 2 hours)
- Recent modifications/cancellations
- Quick actions (new booking, check availability)

**Components**:
```typescript
// Key sections
- BookingTimeline: Visual timeline of today's bookings
- ArrivalsList: Next arrivals with countdown
- QuickStats: Today's metrics
- RecentActivity: Last 10 booking actions
```

**Permissions**: `table_bookings.view`

### 2. Calendar View (`/table-bookings/calendar`)

**Purpose**: Visual calendar showing booking density

**Features**:
- Month/Week/Day views
- Color coding by booking type (regular/Sunday lunch)
- Capacity indicators
- Click to view day's bookings
- Drag & drop to reschedule (with permission)

**Components**:
```typescript
- CalendarGrid: Interactive calendar
- CapacityBar: Visual capacity indicator
- BookingTooltip: Hover details
- LegendPanel: Color/status legend
```

**Permissions**: `table_bookings.view`

### 3. Search & Filter (`/table-bookings/search`)

**Purpose**: Find bookings across all time periods

**Features**:
- Search by: Reference, customer name, phone, email
- Filter by: Date range, status, booking type, party size
- Bulk actions (export, print)
- Saved filters

**Components**:
```typescript
- SearchBar: Multi-field search
- FilterPanel: Advanced filters
- ResultsTable: Paginated results
- BulkActions: Export, print, etc.
```

**Permissions**: `table_bookings.view`

### 4. Create Walk-in Booking (`/table-bookings/new`)

**Purpose**: Quick booking creation for phone/walk-in customers

**Features**:
- Customer lookup by phone
- Real-time availability check
- Table assignment
- Skip payment for walk-ins
- Print confirmation

**Components**:
```typescript
- CustomerLookup: Phone number search
- AvailabilityGrid: Visual table availability
- BookingForm: Simplified form
- TableSelector: Drag to assign tables
```

**Permissions**: `table_bookings.create`

### 5. Booking Details (`/table-bookings/[id]`)

**Purpose**: Complete booking information and actions

**Features**:
- Full booking details
- Customer history
- Payment status
- Modification history
- Action buttons (edit, cancel, no-show)
- Communication log

**Layout**:
```
┌─────────────────────────────────────────────────┐
│ Booking TB-2024-1234         [Edit] [Cancel]   │
├─────────────────────────────────────────────────┤
│ Customer Info          │ Booking Details        │
│ ├─ Name               │ ├─ Date/Time           │
│ ├─ Phone              │ ├─ Party Size          │
│ ├─ Email              │ ├─ Tables              │
│ └─ Previous Bookings  │ └─ Special Requests    │
├─────────────────────────────────────────────────┤
│ Sunday Lunch Order (if applicable)              │
│ ├─ Items with quantities                        │
│ ├─ Allergies (highlighted)                      │
│ └─ Total: £XX.XX                               │
├─────────────────────────────────────────────────┤
│ Payment Information    │ Actions                │
│ ├─ Status             │ ├─ Send Reminder       │
│ ├─ Amount             │ ├─ Mark No-Show        │
│ └─ Transaction ID     │ └─ Process Refund      │
├─────────────────────────────────────────────────┤
│ Activity Log                                    │
│ └─ Booking created, modified, etc.             │
└─────────────────────────────────────────────────┘
```

**Permissions**: `table_bookings.view` (+ specific actions need edit/manage)

### 6. Edit Booking (`/table-bookings/[id]/edit`)

**Purpose**: Modify existing bookings

**Features**:
- Change date/time (with availability check)
- Update party size
- Modify menu selections
- Add/remove tables
- Update contact info
- Reason for change required

**Components**:
```typescript
- EditForm: Pre-populated form
- AvailabilityChecker: Real-time validation
- PaymentAdjustment: Calculate refund/additional payment
- ChangeReason: Required field
```

**Permissions**: `table_bookings.edit`

### 7. Reports (`/table-bookings/reports`)

**Purpose**: Analytics and reporting

**Features**:
- Daily/Weekly/Monthly summaries
- Revenue reports (Sunday lunch focus)
- No-show analysis
- Peak time analysis
- Customer frequency reports
- Export to CSV/PDF

**Report Types**:
```typescript
interface ReportTypes {
  daily: {
    bookings: number;
    covers: number;
    revenue: number;
    noShows: number;
    utilization: number; // percentage
  };
  
  sundayLunch: {
    roastsSold: Record<string, number>;
    averagePartySize: number;
    prepaymentRate: number;
    popularTimeSlots: string[];
  };
  
  customerAnalytics: {
    repeatCustomers: number;
    newCustomers: number;
    averageFrequency: number;
    topCustomers: Customer[];
  };
}
```

**Permissions**: `table_bookings.view` (sensitive data needs `manage`)

### 8. Settings (`/table-bookings/settings`)

Note: Time slots are automatically generated from kitchen hours configured in Business Hours settings. Holiday overrides are also managed through the Business Hours page.

#### 8.1 Table Configuration (`/settings/tables`)

**Features**:
- Add/edit/remove tables
- Set capacity per table
- Mark tables inactive
- Define table combinations for larger parties
- Manage total restaurant capacity

**UI**:
```
Table Management
================

Individual Tables:
┌─────────────────────────────────────────────────┐
│ Table │ Capacity │ Status │ Actions            │
├─────────────────────────────────────────────────┤
│ 1     │ 2        │ Active │ [Edit] [Delete]    │
│ 2     │ 2        │ Active │ [Edit] [Delete]    │
│ 3     │ 4        │ Active │ [Edit] [Delete]    │
│ 6     │ 6        │ Active │ [Edit] [Delete]    │
└─────────────────────────────────────────────────┘
Total Capacity: 40 seats                [Add Table]

Table Combinations:
┌─────────────────────────────────────────────────┐
│ Name         │ Tables │ Capacity │ Actions     │
├─────────────────────────────────────────────────┤
│ Large Party  │ 6 + 7  │ 12       │ [Edit] [X]  │
│ Corner Group │ 3 + 4  │ 8        │ [Edit] [X]  │
└─────────────────────────────────────────────────┘
                                   [Add Combination]
```

**Permissions**: `table_bookings.manage`

#### 8.2 Time Slots (`/settings/time-slots`)

**Note**: Time slots are automatically generated from kitchen hours configured in Business Hours settings. This page shows read-only information about current slots.

**Features**:
- View available booking slots per day
- See kitchen hours for each day
- View max covers per time period
- Different capacity for regular vs Sunday lunch

**UI**:
```
Current Booking Slots (from Kitchen Hours)
==========================================

Monday: CLOSED (No kitchen hours set)

Tuesday - Friday:
Kitchen Hours: 18:00 - 21:00
├─ 18:00 (30 covers)
├─ 18:30 (30 covers)
├─ 19:00 (30 covers)
├─ 19:30 (30 covers)
├─ 20:00 (30 covers)
└─ 20:30 (30 covers)

Saturday:
Kitchen Hours: 13:00 - 19:00
├─ 13:00 (30 covers)
├─ 13:30 (30 covers)
├─ ... continues ...

Sunday:
Kitchen Hours: 12:00 - 17:00
Regular Dining: 20 covers per slot
Sunday Lunch: 40-60 covers per slot
├─ 12:00 (40 Sunday lunch / 20 regular)
├─ 12:30 (40 Sunday lunch / 20 regular)
├─ 13:00 (60 Sunday lunch / 20 regular)
└─ ... continues ...

Note: To modify kitchen hours, visit Business Hours settings.
```

**Permissions**: `table_bookings.view`

#### 8.3 Booking Policies (`/settings/policies`)

**Features**:
- Edit refund windows
- Set advance booking limits
- Configure party size limits
- Manage cancellation fees

**Form Fields**:
```typescript
interface PolicyEditor {
  bookingType: 'regular' | 'sunday_lunch';
  fullRefundHours: number;
  partialRefundHours: number;
  partialRefundPercentage: number;
  maxPartySize: number;
  minAdvanceHours: number;
  maxAdvanceDays: number;
  modificationAllowed: boolean;
  cancellationFee: number;
}
```

**Permissions**: `table_bookings.manage`

#### 8.4 SMS Templates (`/settings/sms-templates`)

**Features**:
- Edit message templates
- Preview with sample data
- Variable insertion helper
- Character count
- Test send functionality

**UI**:
```
┌─────────────────────────────────────────┐
│ Template: Booking Confirmation          │
├─────────────────────────────────────────┤
│ Message:                                │
│ ┌─────────────────────────────────────┐ │
│ │ Hi {{customer_name}}, your table   │ │
│ │ for {{party_size}} at The Anchor   │ │
│ │ on {{date}} at {{time}} is         │ │
│ │ confirmed. Reference: {{reference}} │ │
│ └─────────────────────────────────────┘ │
│ Characters: 127/160                     │
│                                         │
│ Variables: [customer_name] [party_size] │
│           [date] [time] [reference]     │
│                                         │
│ [Preview] [Test Send] [Save]           │
└─────────────────────────────────────────┘
```

**Permissions**: `table_bookings.manage`

#### 8.5 Sunday Lunch Menu (`/settings/menu`)

**Features**:
- Manage main roast options
- Configure side dishes
- Set prices for all items
- Mark items unavailable
- Add dietary/allergen info
- Bundle deals (e.g., "All roasts include Yorkshire pudding and vegetables")

**UI**:
```
Sunday Lunch Menu Management
============================

Main Courses:
┌─────────────────────────────────────────────────────────┐
│ Item              │ Price  │ Status    │ Actions       │
├─────────────────────────────────────────────────────────┤
│ Roast Beef       │ £16.95 │ Available │ [Edit] [X]    │
│ Roast Chicken    │ £14.95 │ Available │ [Edit] [X]    │
│ Roast Pork       │ £15.95 │ Available │ [Edit] [X]    │
│ Nut Roast (V)    │ £13.95 │ Available │ [Edit] [X]    │
└─────────────────────────────────────────────────────────┘
                                            [Add Main]

Side Dishes:
┌─────────────────────────────────────────────────────────┐
│ Item              │ Price  │ Included? │ Actions       │
├─────────────────────────────────────────────────────────┤
│ Yorkshire Pudding │ £0.00  │ ✓ Yes     │ [Edit]        │
│ Roast Potatoes   │ £0.00  │ ✓ Yes     │ [Edit]        │
│ Seasonal Veg     │ £0.00  │ ✓ Yes     │ [Edit]        │
│ Cauliflower Cheese│ £3.50  │ ✗ Extra   │ [Edit] [X]    │
│ Extra Yorkshire  │ £2.50  │ ✗ Extra   │ [Edit] [X]    │
└─────────────────────────────────────────────────────────┘
                                            [Add Side]

Edit Item Form:
┌─────────────────────────────────────────────────────────┐
│ Name: [Roast Beef                    ]                  │
│ Description: [28-day aged beef with traditional trim... ]│
│ Price: £[16.95]                                         │
│ Type: (•) Main  ( ) Side  ( ) Extra                     │
│ Included with mains: [ ] (for sides only)               │
│                                                         │
│ Dietary Info:                                           │
│ [ ] Vegetarian  [ ] Vegan  [✓] Gluten-free available   │
│                                                         │
│ Allergens: [May contain: celery, mustard]              │
│                                                         │
│ [Save] [Cancel]                                         │
└─────────────────────────────────────────────────────────┘
```

**Permissions**: `table_bookings.manage`

## Mobile Responsiveness

All admin pages must work on tablets for staff use:

```typescript
// Responsive breakpoints
const breakpoints = {
  mobile: '640px',   // Simplified view
  tablet: '768px',   // Full functionality
  desktop: '1024px', // Enhanced features
};

// Mobile adaptations
- Booking list: Card view instead of table
- Calendar: Day view default
- Forms: Full screen modals
- Actions: Bottom sheet menus
```

## Real-time Features

### 1. Live Updates
```typescript
// WebSocket subscriptions
- New bookings appear instantly
- Status changes update in real-time
- Availability updates as bookings made
- Notification badges for new activity
```

### 2. Notifications
```typescript
interface AdminNotifications {
  newBooking: {
    trigger: 'Large party (8+) or special requirements';
    alert: 'Toast + Sound';
  };
  
  upcomingArrival: {
    trigger: '15 minutes before arrival';
    alert: 'Toast notification';
  };
  
  noShow: {
    trigger: '30 minutes after booking time';
    alert: 'Badge on booking';
  };
}
```

## Integration Points

### 1. Customer Management
- Click customer name → Customer profile
- Booking history in customer view
- SMS opt-out affects booking confirmations

### 2. Events System
- Show conflicts with private events
- Warn if kitchen closed for event
- Cross-reference busy periods

### 3. Staff Management
- Show who created/modified bookings
- Staff performance metrics
- Booking handling times

## Quick Actions & Shortcuts

### Keyboard Shortcuts
```
Ctrl/Cmd + N: New booking
Ctrl/Cmd + F: Search bookings
Ctrl/Cmd + D: Today's bookings
Ctrl/Cmd + P: Print day sheet
```

### Quick Actions Menu
```typescript
const quickActions = [
  { label: 'Check Availability', icon: CalendarIcon, shortcut: 'A' },
  { label: 'New Walk-in', icon: UserPlusIcon, shortcut: 'W' },
  { label: 'Find Booking', icon: SearchIcon, shortcut: 'F' },
  { label: 'No-show List', icon: XCircleIcon, shortcut: 'N' },
  { label: 'Print Day Sheet', icon: PrinterIcon, shortcut: 'P' },
];
```

## Reporting & Exports

### Daily Operations Sheet
```
THE ANCHOR - Table Bookings
Date: Sunday, 10 March 2024

LUNCH SERVICE (12:00 - 17:00)
============================
12:00 - Smith, J. (4) - Table 3 - *NUTS ALLERGY*
12:00 - Wilson, M. (2) - Table 1
12:30 - Brown, S. (6) - Tables 6+7 - Birthday

Total Covers: 46
Roasts Required: Beef x18, Chicken x15, Veg x8

ALLERGIES/DIETARY:
- 12:00 Smith - NUTS
- 13:30 Jones - Gluten Free
```

### Export Formats
- CSV: For spreadsheet analysis
- PDF: For printing/archiving
- ICS: Calendar integration
- JSON: API integration

## Performance Considerations

### 1. Data Loading
```typescript
// Implement pagination
const PAGE_SIZE = 50;

// Use React Query for caching
const { data, isLoading } = useQuery({
  queryKey: ['bookings', filters],
  queryFn: () => fetchBookings(filters),
  staleTime: 5 * 60 * 1000, // 5 minutes
});
```

### 2. Optimistic Updates
```typescript
// Update UI immediately
const mutation = useMutation({
  mutationFn: updateBooking,
  onMutate: async (newData) => {
    // Optimistically update UI
    await queryClient.cancelQueries(['bookings']);
    const previous = queryClient.getQueryData(['bookings']);
    queryClient.setQueryData(['bookings'], old => ({
      ...old,
      ...newData,
    }));
    return { previous };
  },
  onError: (err, newData, context) => {
    // Rollback on error
    queryClient.setQueryData(['bookings'], context.previous);
  },
});
```

## Security & Permissions

### Role-Based Views
```typescript
// Different UI based on role
if (hasPermission('table_bookings.manage')) {
  // Show financial data, customer details
} else if (hasPermission('table_bookings.edit')) {
  // Show operational data only
} else if (hasPermission('table_bookings.view')) {
  // Read-only access
}
```

### Audit Requirements
- All modifications logged
- Reason required for changes
- Cancellation tracking
- Refund authorization

## Success Metrics

### KPIs to Display
1. **Utilization Rate**: Seats filled vs capacity
2. **No-show Rate**: Track problem customers
3. **Average Party Size**: Optimize table setup
4. **Booking Lead Time**: How far ahead people book
5. **Revenue Per Cover**: Especially Sunday lunch
6. **Peak Times**: Heat map of busy periods

### Alerts & Thresholds
```typescript
const alerts = {
  highNoShow: threshold > 10%, // Weekly
  lowUtilization: capacity < 50%, // Daily
  lastMinuteBookings: leadTime < 2 hours, // Monitor
  largePartyAlert: partySize >= 8, // Immediate
};
```
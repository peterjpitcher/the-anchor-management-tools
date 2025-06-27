# UI Elements Catalog for Playwright Testing

This document provides a comprehensive catalog of all UI elements (buttons, fields, forms, etc.) throughout the Anchor Management Tools application. This catalog is designed to facilitate comprehensive Playwright test development.

## Table of Contents
- [Authentication Pages](#authentication-pages)
- [Layout & Navigation](#layout--navigation)
- [Dashboard](#dashboard)
- [Events Module](#events-module)
- [Customers Module](#customers-module)
- [Employees Module](#employees-module)
- [Private Bookings Module](#private-bookings-module)
- [Messages Module](#messages-module)
- [Settings Module](#settings-module)
- [Common UI Components](#common-ui-components)

---

## Authentication Pages

### Login Page (`/auth/login`)
**Form Elements:**
- Email Input
  - `id="email"`
  - `name="email"`
  - `type="email"`
  - `placeholder="Email address"`
  - Required field
  - Screen reader label: "Email address"
  
- Password Input
  - `id="password"`
  - `name="password"`
  - `type="password"`
  - `placeholder="Password"`
  - Required field
  - Screen reader label: "Password"

**Buttons:**
- Sign In Button
  - `type="submit"`
  - Text: "Sign in" (normal) / "Signing in..." (loading)
  - Full width button
  - Indigo color scheme

**Links:**
- Create Account Link
  - `href="/auth/signup"`
  - Text: "create a new account"

### Sign Up Page (`/auth/signup`)
**Form Elements:**
- Email Input
  - `id="email"`
  - `name="email"`
  - `type="email"`
  - `placeholder="Email address"`
  - Required field
  - Screen reader label: "Email address"
  
- Password Input
  - `id="password"`
  - `name="password"`
  - `type="password"`
  - `placeholder="Password"`
  - Required field
  - Screen reader label: "Password"
  
- Confirm Password Input
  - `id="confirm-password"`
  - `name="confirm-password"`
  - `type="password"`
  - `placeholder="Confirm Password"`
  - Required field
  - Screen reader label: "Confirm Password"

**Buttons:**
- Create Account Button
  - `type="submit"`
  - Text: "Create account" (normal) / "Creating account..." (loading)
  - Full width button
  - Indigo color scheme

**Links:**
- Sign In Link
  - `href="/auth/login"`
  - Text: "sign in to your account"

---

## Layout & Navigation

### Main Navigation (Desktop Sidebar)
**Primary Navigation Items:**
1. Dashboard
   - `href="/"`
   - Icon: HomeIcon
   - Permission: dashboard.view

2. Events
   - `href="/events"`
   - Icon: CalendarIcon
   - Permission: events.view

3. Private Bookings
   - `href="/private-bookings"`
   - Icon: BuildingOfficeIcon
   - Permission: private_bookings.view

4. Customers
   - `href="/customers"`
   - Icon: UserGroupIcon
   - Permission: customers.view

5. Messages
   - `href="/messages"`
   - Icon: EnvelopeIcon
   - Badge: Unread count (if > 0)
   - Permission: messages.view

**Secondary Navigation Items:**
1. Employees
   - `href="/employees"`
   - Icon: IdentificationIcon
   - Permission: employees.view

2. Quick Add Note
   - Action button (not a link)
   - Icon: PencilSquareIcon
   - Opens modal dialog

3. Settings
   - `href="/settings"`
   - Icon: CogIcon
   - Permission: settings.view

**Sign Out Button:**
- Located at bottom of sidebar
- Icon: ArrowRightOnRectangleIcon
- Text: "Sign out"
- Triggers signOut action

### Bottom Navigation (Mobile)
- Shows on mobile devices only
- Contains key navigation items

### Add Note Modal
- Triggered by "Quick Add Note" button
- Modal dialog for quick note creation

---

## Dashboard

### Dashboard Page (`/dashboard`)
**Quick Stats Cards:**
1. Today's Events Card
   - Displays count of today's events
   - Non-clickable

2. Total Customers Card
   - Displays total customer count
   - Non-clickable

3. Unread Messages Card
   - Displays unread message count
   - Clickable link to `/messages`

**Today's Events Section:**
- Each event is a clickable card linking to `/events/[id]`
- Displays:
  - Event name
  - Event time
  - Booking count/capacity (format: "X/Y" or "X/∞")

**Upcoming Events Section:**
- "View all" link to `/events`
- Each event is a clickable card linking to `/events/[id]`
- Displays:
  - Event name
  - Date and time
  - "This week" badge (if applicable)
  - Booking count/capacity

**Quick Actions Grid:**
1. New Event
   - Link to `/events/new`
   - Icon: CalendarIcon

2. Customers
   - Link to `/customers`
   - Icon: UsersIcon

3. Messages
   - Link to `/messages`
   - Icon: ChatBubbleLeftIcon
   - Red notification dot if unread messages

4. Private Booking
   - Link to `/private-bookings/new`
   - Icon: PlusIcon

---

## Events Module

### Events List Page (`/events`)
**Page Header:**
- Title: "Events" (h1, text-2xl font-bold)
- Subtitle: "Manage your events and track bookings"
- Manage Categories button
  - Link to `/settings/event-categories`
  - Icon: Cog6ToothIcon
  - Gray button style
- Create Event button
  - Link to `/events/new`
  - Icon: PlusIcon
  - Primary button style

**Upcoming Events Section:**
- Section title: "Upcoming Events" (gray background header)
- Empty state:
  - Icon: CalendarIcon
  - Text: "No upcoming events"
  - Subtext: "Get started by creating a new event."
  - New Event button

**Events Table:**
- Table headers:
  - Event (name and category)
  - Date & Time
  - Bookings
  - Actions
- Row features:
  - Today's events highlighted with yellow background
  - Event name is clickable link to `/events/[id]`
  - Category badge with custom color
  - Date with "Today" badge if applicable
  - Booking count format: "X / Y" or "X / ∞"
  - Progress bar for capacity (green/yellow/red based on fill)
  - Actions: View link | Edit link with icon

**Past Events Section:**
- Collapsible details element
- Summary shows: "Past Events (count)"
- Same table structure as upcoming events
- Shows last 20 events in reverse order
- Grayed out styling

### New Event Page (`/events/new`)
**Page Header:**
- Title: "Create New Event"
- Subtitle: "Add a new event to your calendar"

**Form Sections:**

1. **Event Image Upload:**
   - SquareImageUpload component
   - Label: "Event Image"
   - Help text: "Upload a square image for your event (recommended: 1080x1080px)"
   - Upload/Delete functionality

2. **Basic Information Section:**
   - Event Name input *
     - `id="name"`
     - Required field
     - Full width on mobile, col-span-4 on desktop
   
   - Category dropdown
     - `id="category"`
     - Options: "No category" + dynamic categories
     - col-span-2
   
   - Date input *
     - `id="date"`
     - `type="date"`
     - Min: today, Max: 2 years from today
     - Required field
     - col-span-2
   
   - Start Time input *
     - `id="time"`
     - `type="time"`
     - Required field
     - col-span-2
   
   - End Time input
     - `id="end_time"`
     - `type="time"`
     - Optional
     - col-span-2
   
   - Description textarea
     - `id="description"`
     - 3 rows
     - Full width

3. **Event Details Section:**
   - Capacity input
     - `id="capacity"`
     - `type="number"`
     - Min: 1
     - Placeholder: "Unlimited"
     - col-span-2
   
   - Status dropdown
     - `id="status"`
     - Options: Scheduled, Cancelled, Postponed, Sold Out
     - Default: "scheduled"
     - col-span-2
   
   - Price input
     - `id="price"`
     - `type="number"`
     - Min: 0, Step: 0.01
     - Label includes "£"
     - col-span-2

4. **Performer Information:**
   - Performer Name input
     - `id="performer_name"`
     - col-span-3
   
   - Performer Type input
     - `id="performer_type"`
     - Placeholder: "e.g., Band, DJ, Comedian"
     - col-span-3

**Action Buttons:**
- Cancel button (returns to /events)
- Submit button (creates event)
- Loading state during submission

### Event Details Page (`/events/[id]`)
**Display Elements:**
- Event title
- Date and time
- Capacity and booking count
- Description
- Images/video
- Booking list (if applicable)

**Action Buttons:**
- Edit Event (if user has edit permission)
- Delete Event (if user has delete permission)
- Export Bookings
- Send SMS to attendees

### Edit Event Page (`/events/[id]/edit`)
- Same form elements as New Event page
- Pre-filled with existing data
- Update button
- Cancel button

---

## Customers Module

### Customers List Page (`/customers`)
**Page Header:**
- Title: "Customers" (h1, text-2xl font-bold)
- Subtitle: "A list of all customers including their name and mobile number."
- Import button
  - Icon: ArrowUpOnSquareIcon
  - Variant: outline
  - Opens import modal
- Add Customer button
  - Icon: PlusIcon
  - Primary button style
  - Opens create form

**Search Section:**
- Search input
  - `placeholder="Search customers..."`
  - Debounced search (300ms delay)
  - Searches: first_name, last_name, mobile_number
  - Full width

**Empty State:**
- Message: "No customers found"
- Subtext: "Adjust your search or add a new customer."

**Customers Table (Desktop):**
- Table headers:
  - Name
  - Mobile
  - Actions
- Row features:
  - Customer name is clickable link to `/customers/[id]`
  - Loyalty badge for loyal customers
  - Unread message count badge (if > 0)
  - Action buttons:
    - View (link to customer details)
    - Edit (PencilIcon)
    - Delete (TrashIcon, with confirmation)

**Mobile View:**
- Card-based layout
- Each card shows:
  - Customer name with loyalty badge
  - Mobile number
  - Unread message indicator
  - Edit/Delete buttons

**Pagination:**
- Page size: 50 customers
- Shows current page and total pages
- Previous/Next navigation
- Total count display

### Customer Create/Edit Form
**Form Header:**
- Title: "Create New Customer" or "Edit Customer"

**Form Fields:**
- First Name input *
  - `id="first_name"`
  - `name="first_name"`
  - `autoComplete="given-name"`
  - Required field
  
- Last Name input *
  - `id="last_name"`
  - `name="last_name"`
  - `autoComplete="family-name"`
  - Required field
  
- Mobile Number input *
  - `id="mobile_number"`
  - `name="mobile_number"`
  - `type="tel"`
  - `placeholder="07700 900000"`
  - `pattern="^(\+?44|0)?[0-9]{10,11}$"`
  - `autoComplete="tel"`
  - `inputMode="tel"`
  - Required field
  - Help text: "Enter a UK mobile number (starting with 07 or +44)"
  - "UK" badge in right side
  - Auto-formats to E.164 format on submit

**Action Buttons:**
- Cancel button
  - Returns to customer list
  - Gray style
- Submit button
  - Text: "Create Customer" or "Update Customer"
  - Loading state: "Saving..."
  - Green primary style

### Customer Import Modal
**Import Features:**
- CSV file upload
- Preview of data to import
- Duplicate detection
- Field mapping
- Validation feedback

### Customer Details Page (`/customers/[id]`)
**Display Elements:**
- Customer name with loyalty badge
- Contact information
- SMS opt-in status
- Messaging health status
- Booking history
- Message history
- Notes/comments

**Action Buttons:**
- Edit Customer
- Send SMS
- Export Data
- Delete Customer (if permitted)

---

## Employees Module

### Employees List Page (`/employees`)
**Page Header:**
- Title: "Employees" (h1, text-2xl font-bold)
- Subtitle: Shows total count with breakdown (e.g., "15 total employees (12 active, 3 former)")
- Export dropdown menu
  - Button with ArrowDownTrayIcon and ChevronDownIcon
  - Options:
    - Export as CSV (with "Spreadsheet format" subtitle)
    - Export as JSON (with "Data integration format" subtitle)
  - Disabled when no employees
- Add Employee button
  - Link to `/employees/new`
  - Icon: PlusIcon
  - Primary button style

**Search and Filter Section:**
- Search input
  - Icon: MagnifyingGlassIcon (left side)
  - `placeholder="Search by name, email, or job title..."`
  - Full width on mobile, flex-1 on desktop
  
- Status Filter Pills
  - Label: "Status:"
  - Three toggle buttons:
    - All (shows total count)
    - Active (shows active count)
    - Former (shows former count)
  - Active filter has green background

**Search Results:**
- Shows count when searching: "Found X employee(s) matching 'search term'"

**Empty State:**
- Message: "No employees found"
- Conditional subtext based on search

**Employees Table (Desktop):**
- Table headers:
  - Name
  - Job Title
  - Email
  - Start Date
  - Status
- Row features:
  - Name is clickable link to `/employees/[employee_id]`
  - Email is mailto link
  - Status badge (green for Active, red for Former)
  - Hover state on rows

**Mobile View:**
- Card-based layout
- Each card shows all employee info in stacked format
- Same clickable elements as desktop

**Pagination:**
- Page size: 50 employees
- Standard pagination controls

### New Employee Page (`/employees/new`)
**Page Header:**
- Title: "Add New Employee"
- Subtitle: "Please fill in the details of the employee."

**Form Fields (grid layout: label col-span-1, input col-span-3):**
1. **Required Fields** (marked with red *)
   - First Name *
     - `name="first_name"`
     - `type="text"`
     
   - Last Name *
     - `name="last_name"`
     - `type="text"`
     
   - Email Address *
     - `name="email_address"`
     - `type="email"`
     
   - Job Title *
     - `name="job_title"`
     - `type="text"`
     
   - Employment Start Date *
     - `name="employment_start_date"`
     - `type="date"`
     
   - Status *
     - `name="status"`
     - Dropdown with options: Active, Former
     - Default: "Active"

2. **Optional Fields**
   - Date of Birth
     - `name="date_of_birth"`
     - `type="date"`
     
   - Address
     - `name="address"`
     - `type="textarea"`
     - 3 rows
     
   - Phone Number
     - `name="phone_number"`
     - `type="tel"`
     
   - Employment End Date
     - `name="employment_end_date"`
     - `type="date"`

**Field Features:**
- All inputs have max-width-lg
- Error messages displayed below fields in red
- Form uses server actions with useActionState

**Action Buttons:**
- Cancel link
  - Returns to `/employees`
  - Gray button style
- Save Employee button
  - `type="submit"`
  - Loading state: "Saving..."
  - Green primary style
  - Disabled during submission

### Employee Details Page (`/employees/[employee_id]`)
**Page Header:**
- Employee full name (h1, text-2xl font-bold)
- Job title and "Back to all employees" link
- Action buttons:
  - Edit button
    - Link to `/employees/[employee_id]/edit`
    - Icon: PencilSquareIcon
    - Primary button style
  - Delete Employee button
    - DeleteEmployeeButton component
    - Confirmation dialog required
    - Red/danger styling

**Recent Changes Component:**
- EmployeeRecentChanges component
- Shows recent modifications with timestamps

**Tabs Component:**
Five tabs with content:

1. **Details Tab:**
   - Definition list layout (dl/dt/dd)
   - Fields displayed:
     - Full Name
     - Email Address (mailto link)
     - Job Title
     - Employment Status (badge: green for Active, red for Inactive)
     - Start Date
     - End Date
     - Date of Birth
     - Phone Number (tel link)
     - Address (full width)

2. **Emergency Contacts Tab:**
   - EmergencyContactsTab component
   - Add/edit/delete emergency contacts

3. **Financial Details Tab:**
   - FinancialDetailsTab component
   - Encrypted financial information

4. **Health Records Tab:**
   - HealthRecordsTab component
   - Medical information and records

5. **Version History Tab:**
   - EmployeeVersionHistory component
   - Audit trail of all changes

**Employee Notes Section:**
- Section title: "Employee Notes"
- Subtitle: "Record of time-stamped updates and comments."
- AddEmployeeNoteForm component
- EmployeeNotesList component (with Suspense)
- Loading state: "Loading notes..."

**Employee Attachments Section:**
- Section title: "Employee Attachments"
- Subtitle: "Scanned documents and other attached files."
- "Manage Categories" link to `/settings/categories`
- AddEmployeeAttachmentForm component
  - File upload functionality
  - Category selection
  - Success callback
- EmployeeAttachmentsList component
  - Display attachments with categories
  - Download links
  - Delete functionality

### Edit Employee Page (`/employees/[employee_id]/edit`)
- Same form elements as New Employee
- Pre-filled with existing data
- Update button
- Cancel button

---

## Private Bookings Module

### Private Bookings List Page (`/private-bookings`)
**Page Header:**
- Title: "Private Bookings" (text-3xl font-bold)
- Subtitle: "Manage venue hire and private events"
- Action buttons:
  - SMS Queue link
    - `href="/private-bookings/sms-queue"`
    - Icon: ChatBubbleLeftRightIcon
    - Purple color scheme
  - Calendar View link
    - `href="/private-bookings/calendar"`
    - Icon: CalendarIcon
    - Gray color scheme
  - New Booking button (if has create permission)
    - `href="/private-bookings/new"`
    - Icon: PlusIcon
    - Blue primary style

**Upcoming Bookings Section:**
- Section title: "Upcoming Bookings (count)"
- Empty state:
  - Icon: CalendarIcon
  - Message: "No upcoming bookings"
  - Subtext: "Get started by creating a new booking."
  - New Booking button (if has permission)

**Bookings Table:**
- Headers:
  - Customer (name and phone)
  - Event Details (type and guest count)
  - Date & Time
  - Status
  - Total
  - Actions
- Row features:
  - Today's events highlighted with yellow background
  - Customer name is clickable link to `/private-bookings/[id]`
  - Phone number with PhoneIcon
  - Guest count with UserGroupIcon
  - Date badges: "Today", "Tomorrow", "This week"
  - Status badges with colors (draft/confirmed/completed/cancelled)
  - Deposit paid indicator (CheckCircleIcon)
  - Total with CurrencyPoundIcon
  - Actions: View link, Delete button (if has permission)

**Completed Bookings Section:**
- Collapsible details element
- Summary: "Completed Bookings (count)"
- Same table structure as upcoming bookings
- Gray styling for past events

### New Private Booking Page (`/private-bookings/new`)
**Page Header:**
- Back link to `/private-bookings` with ArrowLeftIcon
- Title: "New Private Booking"
- Subtitle: "Create a new venue hire booking"
- Gradient background (blue to indigo)

**Form Sections:**

1. **Customer Information Section**
   - Section icon: UserIcon
   - Customer Search:
     - CustomerSearchInput component
     - `placeholder="Search by name or phone number..."`
     - Help text: "Search for an existing customer or leave blank to create a new one"
   
   - Customer Details (2-column grid):
     - First Name *
       - `id="customer_first_name"`
       - `name="customer_first_name"`
       - Required field
       - Placeholder: "John"
     
     - Last Name
       - `id="customer_last_name"`
       - `name="customer_last_name"`
       - Placeholder: "Smith"
     
     - Phone Number
       - `id="contact_phone"`
       - `name="contact_phone"`
       - `type="tel"`
       - Icon: PhoneIcon
       - Placeholder: "07700 900000"
     
     - Email Address (full width)
       - `id="contact_email"`
       - `name="contact_email"`
       - `type="email"`
       - Icon: EnvelopeIcon
       - Placeholder: "john@example.com"

2. **Event Details Section**
   - Section icon: CalendarIcon
   - Fields (2-column grid):
     - Event Date *
       - `id="event_date"`
       - `name="event_date"`
       - `type="date"`
       - Required field
       - Default: tomorrow
       - Min: today, Max: 1 year from now
     
     - Event Type
       - `id="event_type"`
       - `name="event_type"`
       - Icon: CalendarIcon
       - Placeholder: "Birthday Party, Wedding, Corporate Event..."
     
     - Booking Source
       - `id="source"`
       - `name="source"`
       - Dropdown options: Phone, Email, Walk-in, Website, Referral, Other
       - Icon: BuildingOfficeIcon
   
   - Time and Guest Fields (3-column grid):
     - Start Time *
       - `id="start_time"`
       - `name="start_time"`
       - `type="time"`
       - Default: "18:00"
       - Icon: ClockIcon
     
     - End Time
       - `id="end_time"`
       - `name="end_time"`
       - `type="time"`
       - Default: "23:00"
     
     - Guest Count
       - `id="guest_count"`
       - `name="guest_count"`
       - `type="number"`
       - Min: 1
       - Icon: UserGroupIcon
       - Placeholder: "50"

3. **Setup Details Section** (continues in form...)

**Form Features:**
- All inputs have focus states with blue ring
- Error handling with displayed messages
- Loading state during submission
- Auto-fills customer details when existing customer selected

### Calendar View (`/private-bookings/calendar`)
- Monthly calendar view
- Day/week/month toggle
- Booking details on click
- Create new booking from calendar

### SMS Queue (`/private-bookings/sms-queue`)
- Pending SMS list
- Send now button
- Cancel message button
- Message preview

### Booking Details Page (`/private-bookings/[id]`)
**Sections:**
- Booking information
- Customer details
- Payment status
- Items/services
- Messages/communication

**Sub-pages:**
- Contract (`/private-bookings/[id]/contract`)
- Items (`/private-bookings/[id]/items`)
- Messages (`/private-bookings/[id]/messages`)

### Private Booking Details Page (`/private-bookings/[id]`)
**Page Header:**
- Customer name (large text)
- Event type and date
- Status badge
- Action buttons:
  - Edit Booking
  - Send Message
  - Generate Contract
  - Delete (if permitted)

**Information Cards:**
1. **Event Details:**
   - Date and time
   - Guest count
   - Event type
   - Special requirements

2. **Customer Information:**
   - Name
   - Phone (clickable)
   - Email (clickable)
   - Notes

3. **Financial Summary:**
   - Subtotal
   - VAT
   - Total
   - Deposit status
   - Payment history

4. **Items & Services:**
   - List of booked items
   - Quantities and prices
   - Add/remove items

**Sub-Navigation:**
- Contract tab
- Items tab
- Messages tab

### Contract Page (`/private-bookings/[id]/contract`)
**Elements:**
- Contract preview (PDF-style)
- Generate Contract button
- Download PDF button
- Email Contract button
- Contract history/versions

### Items Page (`/private-bookings/[id]/items`)
**Features:**
- Add Item form
  - Item search/select
  - Quantity input
  - Price override
- Items table:
  - Name
  - Category
  - Quantity
  - Unit price
  - Total
  - Remove action
- Recalculate totals button

### Booking Messages (`/private-bookings/[id]/messages`)
**Elements:**
- Message thread display
- Send new message form
- Message templates dropdown
- SMS/Email toggle
- Delivery status indicators

### Private Booking Settings

**Catering Settings (`/private-bookings/settings/catering`):**
- Add Catering Option button
- Catering items table:
  - Name
  - Description
  - Price per person
  - Min/max quantities
  - Active toggle
  - Edit/Delete actions
- Bulk import/export

**Spaces Settings (`/private-bookings/settings/spaces`):**
- Add Space button
- Spaces grid:
  - Space name
  - Capacity
  - Hourly rate
  - Setup requirements
  - Availability rules
  - Edit/Delete

**Vendors Settings (`/private-bookings/settings/vendors`):**
- Add Vendor button
- Vendors list:
  - Company name
  - Contact person
  - Phone/Email
  - Services offered
  - Preferred status
  - Edit/Delete

---

## Messages Module

### Messages List Page (`/messages`)
**Page Header:**
- Title: "Unread Messages" (text-2xl font-bold)
- Subtitle: "New conversations from customers"
- Unread count display (if > 0): "(X unread message(s))"
- Action buttons:
  - Send Bulk Message link
    - `href="/messages/bulk"`
    - Green primary style
    - Min height 44px for mobile
  - Mark all as read button (if unread > 0)
    - Click handler for bulk marking
    - Green color scheme

**Empty State:**
- Centered text: "No unread messages"
- Subtext: "All customer messages have been read"
- Gray styling

**Conversations List:**
- Container with shadow and rounded corners
- Each conversation is a clickable link to `/customers/[id]`
- Blue background (bg-blue-50) with hover state (bg-blue-100)
- Conversation card shows:
  - Customer name (first + last)
  - Unread count badge (blue color scheme)
  - Mobile number
  - Time since last message (using formatDistanceToNow)
  - Total message count
- Auto-refreshes every 5 seconds

### Bulk Messaging Page (`/messages/bulk`)
**Page Header:**
- Back arrow link to `/messages`
- Title: "Send Bulk SMS"
- Subtitle: "Send personalized messages to multiple customers"

**Filter Section:**
1. **SMS Opt-in Filter**
   - Radio buttons:
     - Opted In (default)
     - Not Opted Out
     - All Customers

2. **Booking Filters**
   - Has Bookings dropdown:
     - All Customers
     - With Bookings
     - Without Bookings

3. **Event Filters**
   - Event Selection dropdown
     - Shows all events with date/time
     - Icon: CalendarIcon
   - Event Attendance radio:
     - All
     - Attending
     - Not Attending
   - Booking Type radio:
     - All
     - Bookings Only
     - Reminders Only

4. **Category Filters**
   - Category Selection dropdown
     - Icon: TagIcon
   - Category Attendance radio:
     - All
     - Regular Attendees
     - Never Attended

5. **Date Range Filters**
   - Created After date input
   - Created Before date input

6. **Search Filter**
   - Search input with MagnifyingGlassIcon
   - Placeholder: "Search by name or phone..."

**Customer Selection:**
- Summary stats:
  - Filtered customers count
  - Selected customers count
- Select All checkbox
- Customer list with:
  - Checkbox for selection
  - Name (first + last)
  - Phone number
  - SMS opt-in status icon
  - Total bookings count

**Message Composition:**
- Message textarea
  - Placeholder with variable hints
  - Character counter
- Available variables displayed:
  - {{customer_name}}
  - {{first_name}}
  - {{venue_name}}
  - {{contact_phone}}
  - {{event_name}} (if event selected)
  - {{event_date}} (if event selected)
  - {{event_time}} (if event selected)
  - {{category_name}} (if category selected)

**Message Preview:**
- Shows personalized preview with sample data
- Updates in real-time as message is typed

**Action Buttons:**
- Send Messages button
  - Shows selected count
  - Confirmation dialog
  - Loading state during send
  - Handles batches >50 via job queue
  - Progress indicators for success/failed

---

## Settings Module

### Main Settings Page (`/settings`)
**Page Header:**
- Title: "Settings" (text-2xl font-bold)
- Subtitle: "Manage application settings and configurations"

**Settings Sections (Permission-Based):**
Settings are grouped into three categories, each showing only items the user has permission to access:

1. **User Management Section:**
   - My Profile
     - Icon: UserCircleIcon
     - Description: "View and edit your personal profile information"
     - Link: `/profile`
     - No permission required
   
   - User Management
     - Icon: UsersIcon
     - Description: "Manage users and their role assignments"
     - Link: `/users`
     - Permission: users.view
   
   - Role Management
     - Icon: KeyIcon
     - Description: "Create and manage roles and permissions"
     - Link: `/roles`
     - Permission: roles.view

2. **System Settings Section:**
   - Event Categories
     - Icon: CalendarDaysIcon
     - Description: "Manage event categories and standardize event types"
     - Link: `/settings/event-categories`
     - Permission: events.manage
   
   - Business Hours
     - Icon: ClockIcon
     - Description: "Manage regular opening hours and special dates"
     - Link: `/settings/business-hours`
     - Permission: settings.manage
   
   - Attachment Categories
     - Icon: TagIcon
     - Description: "Manage categories for employee file attachments"
     - Link: `/settings/categories`
     - Permission: settings.manage
   
   - Message Templates
     - Icon: DocumentTextIcon
     - Description: "Manage SMS message templates and customize content"
     - Link: `/settings/message-templates`
     - Permission: messages.manage_templates
   
   - Import Messages from Twilio
     - Icon: ArrowDownTrayIcon
     - Description: "Import historical SMS messages from your Twilio account"
     - Link: `/settings/import-messages`
     - Permission: messages.manage

3. **Monitoring & Logs Section:**
   - SMS Delivery Statistics
     - Icon: ChatBubbleLeftRightIcon
     - Description: "Monitor SMS delivery performance and manage customer messaging"
     - Link: `/settings/sms-delivery`
     - Permission: sms_health.view
   
   - SMS Health Dashboard
     - Icon: ShieldCheckIcon
     - Description: "Advanced delivery tracking with automatic deactivation management"
     - Link: `/settings/sms-health`
     - Permission: sms_health.view
   
   - Audit Logs
     - Icon: ShieldCheckIcon
     - Description: "View system audit logs for security and compliance"
     - Link: `/settings/audit-logs`
     - Permission: settings.manage
   
   - Background Jobs
     - Icon: CpuChipIcon
     - Description: "Monitor and manage background job processing"
     - Link: `/settings/background-jobs`
     - Permission: settings.manage
   
   - Calendar Test
     - Icon: CalendarDaysIcon
     - Description: "Test Google Calendar integration and debug connection issues"
     - Link: `/settings/calendar-test`
     - Permission: settings.manage
   
   - API Keys
     - Icon: CommandLineIcon
     - Description: "Manage API keys for external integrations"
     - Link: `/settings/api-keys`
     - Permission: settings.manage
   
   - GDPR & Privacy
     - Icon: ShieldCheckIcon
     - Description: "Export your data or manage privacy settings"
     - Link: `/settings/gdpr`
     - No permission required

**UI Features:**
- Each setting item is a clickable link with hover state
- Icons displayed on the left
- ChevronRightIcon on the right
- Sections only appear if user has at least one item they can access

### Event Categories Page (`/settings/event-categories`)
**Page Elements:**
- Loading state with spinner
- Add New Category button
  - Icon: PlusIcon
  - Opens form modal
- Analyze Historical Events button
  - Icon: SparklesIcon
  - Confirmation dialog
  - Loading state during analysis
  - Success messages for categorization and stats

**Categories List:**
- Grid layout (responsive columns)
- Each category card shows:
  - Category icon (emoji based on icon name)
  - Category name
  - Color badge
  - Event count
  - Active/Inactive status toggle
  - Edit button (PencilIcon)
  - Delete button (TrashIcon) with confirmation
  - Sort order display
  - Keywords list
  - Features badges (if any)

**Category Form Modal:**
- EventCategoryFormSimple component
- Fields include:
  - Name
  - Color picker
  - Icon selector
  - Keywords
  - Sort order
  - Active status
  - Features configuration

### API Keys (`/settings/api-keys`)
- Generate New Key button
- Keys table with columns:
  - Key name
  - Key value (partially hidden)
  - Created date
  - Last used
  - Revoke action

### Audit Logs (`/settings/audit-logs`)
- Date range picker
- User filter dropdown
- Action type filter
- Logs table:
  - Timestamp
  - User name
  - Action type
  - Entity affected
  - Details (expandable)
- Export to CSV button

### SMS Health Dashboard (`/settings/sms-health`)
- Provider status card
- Delivery statistics cards:
  - Success rate
  - Failed messages
  - Suspended customers
- Recent failures table
- Test SMS section
- Auto-suspension settings

### Business Hours (`/settings/business-hours`)
**Form Elements:**
- Day selector checkboxes
- Time inputs for each day:
  - Opening time
  - Closing time
  - Closed toggle
- Special dates section:
  - Add special date
  - Date picker
  - Custom hours or closed
- Save Changes button

### Message Templates (`/settings/message-templates`)
**Page Elements:**
- Create Template button
- Templates grid:
  - Template name
  - Category
  - Preview text
  - Variable count
  - Edit/Delete/Duplicate

**Template Editor:**
- Name input
- Category dropdown
- Message body textarea
- Available variables list:
  - {{customer_name}}
  - {{venue_name}}
  - {{event_name}}
  - etc.
- Preview pane
- Save/Cancel buttons

### Webhook Monitor (`/settings/webhook-monitor`)
**Statistics Cards:**
- Success Count (green)
- Error Count (red)  
- Auth Failed (yellow)
- Total Requests

**Webhook Logs Table:**
- Timestamp
- Type (SMS/Email)
- Status badge
- From/To
- Message preview
- View Details action

**Features:**
- Auto-refresh toggle
- Date range filter
- Export logs button

### Background Jobs (`/settings/background-jobs`)
**Jobs Queue Table:**
- Job ID
- Type
- Status (pending/processing/completed/failed)
- Created at
- Started at
- Completed at
- Error message (if failed)
- Retry button

**Statistics:**
- Pending jobs count
- Failed jobs count
- Average processing time

### GDPR Settings (`/settings/gdpr`)
**Data Export Section:**
- Export All Data button
- Select data types:
  - Profile information
  - Bookings
  - Messages
  - Audit logs
- Format selection (JSON/CSV)

**Data Deletion:**
- Request account deletion
- Deletion request status
- Cancellation period info

### Import Messages (`/settings/import-messages`)
**Import Form:**
- Date range selector
- Twilio account credentials
- Test connection button
- Preview messages
- Import button with progress

### Fix Phone Numbers (`/settings/fix-phone-numbers`)
**Utility Page:**
- Scan for invalid numbers
- Preview changes table
- Bulk fix button
- Manual edit option
- Export report

---

## Special Pages

### Landing Page (`/`)
- Redirects to `/dashboard` for authenticated users
- Shows login prompt for unauthenticated users

### Unauthorized Page (`/unauthorized`)
**Elements:**
- 403 error icon
- "Access Denied" heading
- Explanation text
- Contact administrator button
- Return to dashboard link

### Error Pages
**404 Not Found:**
- Icon illustration
- "Page not found" message
- Return home button

**500 Error:**
- Error icon
- "Something went wrong" message
- Try again button
- Contact support link

---

## User Management Module

### Profile Page (`/profile`)
**Page Sections:**

1. **Profile Information Card:**
   - Avatar Upload
     - Circular image with camera icon overlay
     - Click to upload new avatar
     - Loading state during upload
     - Stored in Supabase Storage
   
   - Full Name field
     - Editable text input
     - Save button with loading state
   
   - Email (read-only)
   - Member since date

2. **Security Card:**
   - Change Password link
     - Link to `/profile/change-password`
     - Icon: KeyIcon
     - "Update your password"

3. **Notification Preferences Card:**
   - Toggle switches for:
     - SMS Notifications
     - Email Notifications
   - Auto-saves on toggle

4. **Data & Privacy Card:**
   - Export Your Data button
     - Icon: ArrowDownTrayIcon
     - Downloads user data as JSON
   
   - Request Account Deletion button
     - Icon: TrashIcon
     - Red text color
     - Confirmation dialog
     - Creates deletion request

### Change Password Page (`/profile/change-password`)
**Form Fields:**
- Current Password input
  - `type="password"`
  - Required field
  
- New Password input
  - `type="password"`
  - Min length validation
  - Required field
  
- Confirm New Password input
  - `type="password"`
  - Must match new password
  - Required field

**Buttons:**
- Cancel link (returns to profile)
- Update Password button
  - Loading state during submission
  - Success redirects to profile

### Users List Page (`/users`)
**Page Elements:**
- Title: "User Management"
- User table with columns:
  - Name
  - Email
  - Role (dropdown for role assignment)
  - Status (Active/Inactive)
  - Last Login
  - Actions

**Features:**
- Role assignment dropdown
  - Updates user role on change
  - Permission check required
- User status toggle
- Search/filter functionality

### Roles Page (`/roles`)
**Page Elements:**
- Title: "Role Management"
- New Role button (if has permission)
- Roles table:
  - Role name
  - Description
  - User count
  - Permissions summary
  - Edit/Delete actions

### New/Edit Role Page (`/roles/new`, `/roles/[id]/edit`)
**Form Fields:**
- Role Name input
- Description textarea
- Permissions Matrix:
  - Module-based checkboxes
  - Actions: view, create, edit, delete, manage
  - Select all/none helpers

---

## Common UI Components

### Button Component
**Variants:**
- Primary (default) - Blue/Indigo background
- Secondary - White background with border
- Danger - Red for destructive actions
- Ghost - Transparent background
- Outline - Border only

**States:**
- Normal
- Hover (darker shade)
- Disabled (opacity 50%)
- Loading (with spinner)

**Common Props:**
- `size`: sm, md, lg
- `asChild`: For Link components
- Icon support (left/right)
- Full width option

### Form Components
**Input Fields:**
- Standard text input
  - Border on focus: ring-2 ring-blue-500
  - Error state: red border
  - Disabled state: gray background
  - Help text support

**Select Dropdowns:**
- Native HTML select styling
- Custom dropdown with Headless UI
- Search/filter capability
- Multi-select options

**Date/Time Inputs:**
- Native HTML5 date picker
- Time picker with 24h format
- Min/max date constraints

**File Upload:**
- Drag & drop zones
- Preview for images
- Progress indicators
- File type restrictions

### Data Tables
**Features:**
- Responsive (horizontal scroll on mobile)
- Sortable column headers
- Hover states on rows
- Sticky header on scroll
- Empty state message
- Loading skeleton

**Row Actions:**
- View links
- Edit buttons
- Delete with confirmation
- Custom action menus

### Pagination Component
**Elements:**
- Previous/Next buttons
- Page number display
- Total count
- Page size selector
- Keyboard navigation support

### Modal/Dialog Components
**Structure:**
- Backdrop overlay
- Center-aligned content
- Close button (X icon)
- Title and description
- Footer with actions

**Animations:**
- Fade in/out
- Scale transform
- Focus trap

### Toast Notifications (react-hot-toast)
**Types & Colors:**
- Success - Green with checkmark
- Error - Red with X icon
- Info - Blue with info icon
- Loading - With spinner

**Position:** Top-center by default

### Loading States
**Page Loading:**
- PageLoadingSkeleton component
- Full page spinner
- Skeleton screens for content

**Inline Loading:**
- Button loading states
- Spinner icons (animate-spin)
- Progress bars

### Empty States
**Standard Pattern:**
- Large icon (gray-400)
- Heading text
- Description text
- Optional CTA button

### Permission-Based UI
**Pattern:**
- Components check permissions
- Conditional rendering
- Disabled states for unauthorized
- Hidden elements based on role

### Mobile Adaptations
**Breakpoints:**
- sm: 640px
- md: 768px  
- lg: 1024px
- xl: 1280px

**Mobile Patterns:**
- Bottom navigation bar
- Full-width buttons (min-height: 44px)
- Stacked forms
- Slide-out menus
- Touch-friendly tap targets

---

## Test Selectors Strategy

For Playwright tests, use the following selector priority:
1. `data-testid` attributes (when available)
2. `id` attributes
3. `name` attributes for form elements
4. `aria-label` for accessibility
5. Text content for buttons and links
6. CSS selectors as last resort

## Responsive Behavior

- Desktop: Full sidebar navigation
- Tablet: Collapsible sidebar
- Mobile: Bottom navigation bar
- Breakpoints:
  - Mobile: < 768px
  - Tablet: 768px - 1024px
  - Desktop: > 1024px

---

This catalog will be continuously updated as new features are added to the application.

## Documentation Status

### ✅ Fully Completed Documentation

This UI Elements Catalog now comprehensively documents **ALL** UI components and pages in the Anchor Management Tools application, including:

1. **Authentication System**
   - Login page with form fields and validation
   - Signup page with password confirmation
   - Auth callback handling

2. **Navigation & Layout**
   - Desktop sidebar with permission-based items
   - Mobile bottom navigation
   - Responsive breakpoints and adaptations

3. **Core Modules (Complete)**
   - Dashboard with stats, events, and quick actions
   - Events management (list, create, edit, details)
   - Customer management with search, import, and details
   - Employee records with tabs, attachments, and version history
   - Private bookings with full booking flow and sub-pages
   - Messages with conversations and bulk SMS

4. **User Management (Complete)**
   - Profile page with avatar upload and preferences
   - Change password functionality
   - Users list with role assignment
   - Roles management with permissions matrix

5. **Settings & Configuration (Complete)**
   - Main settings page with three categorized sections
   - Event categories with icon customization
   - Business hours configuration
   - Message templates editor
   - SMS health and delivery monitoring
   - Webhook monitoring and diagnostics
   - Background jobs queue
   - API keys management
   - GDPR compliance tools
   - Audit logs with filtering
   - Import/export utilities
   - Phone number cleanup tool

6. **Special Pages**
   - Landing page redirect
   - Unauthorized access page
   - Error pages (404, 500)

7. **Common Components**
   - Buttons (5 variants with states)
   - Forms (inputs, selects, dates, files)
   - Tables with sorting and actions
   - Modals with animations
   - Toast notifications
   - Loading states and skeletons
   - Empty states pattern
   - Permission-based rendering
   - Pagination controls
   - Mobile-specific adaptations

### 📝 Usage for Playwright Testing

This catalog provides:
- Specific element IDs and names for selectors
- Form field types and validation rules
- Button texts and expected behaviors
- Table structures for data verification
- Permission requirements for access testing
- Mobile vs desktop variations

When writing Playwright tests, reference this document to:
1. Find the correct selectors for elements
2. Understand form validation requirements
3. Know which permissions to test
4. Verify expected UI states and behaviors
5. Handle responsive design variations

### 🔄 Keeping This Document Updated

As the application evolves:
1. Update element IDs if they change
2. Add new pages or features as they're developed
3. Document any new UI patterns or components
4. Note changes in permissions or access control
5. Update mobile breakpoints if modified
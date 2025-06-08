# The Anchor - Management Tools

A web-based application for managing events, customers, and employees at The Anchor, with automated SMS notifications.

## Features

- User authentication with Supabase Auth
- Event management (create, edit, delete)
- Customer management (create, edit, delete)
- Employee management (create, edit, delete, notes, attachments)
- Booking management (underlying functionality for creating bookings, with SMS confirmations/reminders)
- Automated SMS notifications via Twilio
  - Booking confirmations
  - 7-day reminders
  - 24-hour reminders

## Tech Stack

- **Frontend**: Next.js 14 with TypeScript and Tailwind CSS
- **Authentication**: Supabase Auth
- **Database**: Supabase (PostgreSQL)
- **SMS Service**: Twilio
- **Hosting**: Vercel
- **Scheduler**: GitHub Actions

## Documentation

- [Authentication](./AUTHENTICATION.md)
- [Product Requirements Document (PRD)](./PRD.md)
- [SMS Functionality](./SMS_FUNCTIONALITY.md)
- [Application Color Palette](./docs/color_palette.md)
- [CSS Setup and Issues](./docs/css_setup_and_issue_summary.md)
- [Navigation System](./docs/NAVIGATION.md)

## Prerequisites

- Node.js 18.17 or later
- npm 9.6.7 or later
- Supabase account
- Twilio account
- GitHub account (for deployment and scheduled tasks)

## Environment Variables

Create a `.env.local` file in the root directory with the following variables:

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=your-supabase-project-url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-supabase-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-supabase-service-role-key

# Twilio
TWILIO_ACCOUNT_SID=your-twilio-account-sid
TWILIO_AUTH_TOKEN=your-twilio-auth-token
TWILIO_PHONE_NUMBER=your-twilio-phone-number

# General
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

## Setup Instructions

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up your environment variables
4. Set up your Supabase database tables
5. Run the development server:
   ```bash
   npm run dev
   ```

## Database Schema

### Events Table
- `id` (UUID, Primary Key)
- `name` (string, required)
- `date` (date, required)
- `time` (string, required)
- `created_at` (timestamp, auto-generated)

### Customers Table
- `id` (UUID, Primary Key)
- `first_name` (string, required)
- `last_name` (string, required)
- `mobile_number` (string, required)
- `created_at` (timestamp, auto-generated)

### Bookings Table
- `id` (UUID, Primary Key)
- `customer_id` (foreign key to Customers)
- `event_id` (foreign key to Events)
- `seats` (integer, nullable)
- `created_at` (timestamp, auto-generated)

## SMS Templates

### Booking Confirmation
```
Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} is confirmed. We've reserved {{seats}} seat(s) for you. Reply to this message if you need to make any changes. The Anchor.
```

### 7-Day Reminder
```
Hi {{customer_name}}, don't forget, we've got our {{event_name}} on {{event_date}} at {{event_time}}! If you'd like to book seats, WhatsApp/Call 01753682707. The Anchor.
```

### 24-Hour Reminder
```
Hi {{customer_name}}, just a reminder that you're booked for {{event_name}} tomorrow at {{event_time}}. We look forward to seeing you! Reply to this message if you need to make any changes. The Anchor.
```

## Contributing

This is a private project. Please do not share or distribute without permission.

## License

Private - All rights reserved

## Application Update: The Anchor Management App & Employee Features (as of [Current Date - Please Update])

This section details significant updates transforming the application into "The Anchor - Management Tools," with a primary focus on adding comprehensive Employee Management functionality. For a snapshot of the application state *before* these changes, please refer to `docs/CURRENT_APPLICATION_OVERVIEW.md`.

### 1. Core Application Name Change

- The application is now geared towards being "The Anchor - Management Tools".

### 2. Menu and Navigation Restructuring

-   **Bookings Section Removed:** The dedicated "/bookings" page and its corresponding links in the sidebar and mobile navigation have been removed. The underlying booking *functionality* (data tables, SMS confirmations/reminders) remains intact.
-   **Top-Level Menu Items:**
    *   Dashboard
    *   Events
    *   Customers
    *   *(New)* Employees (with a visual divider separating it from the above items in the sidebar)

### 3. New Feature: Employee Management

A comprehensive module for managing employee details, notes, and attachments has been added.

#### 3.1. Database Schema Additions

New tables have been added to the Supabase (PostgreSQL) database. Ensure RLS policies and (for attachments) Supabase Storage bucket policies are appropriately configured.

*   **`employees` Table:** Stores core employee information.
    *   `employee_id`: UUID (Primary Key)
    *   `first_name`: TEXT (Not Null)
    *   `last_name`: TEXT (Not Null)
    *   `date_of_birth`: DATE (Nullable)
    *   `address`: TEXT (Nullable)
    *   `phone_number`: TEXT (Nullable)
    *   `email_address`: TEXT (Unique, Not Null)
    *   `job_title`: TEXT (Not Null)
    *   `employment_start_date`: DATE (Not Null)
    *   `employment_end_date`: DATE (Nullable)
    *   `status`: TEXT (Not Null, Default: 'Active', e.g., 'Active', 'Former')
    *   `emergency_contact_name`: TEXT (Nullable)
    *   `emergency_contact_phone`: TEXT (Nullable)
    *   `created_at`: TIMESTAMPTZ (Default: now(), Not Null)
    *   `updated_at`: TIMESTAMPTZ (Default: now(), Not Null, with trigger to auto-update)

*   **`employee_notes` Table:** For time-stamped notes/updates related to an employee.
    *   `note_id`: UUID (Primary Key)
    *   `employee_id`: UUID (Foreign Key to `employees.employee_id`, CASCADE DELETE)
    *   `note_text`: TEXT (Not Null)
    *   `created_by`: UUID (Nullable, intended to link to `auth.users.id`)
    *   `created_at`: TIMESTAMPTZ (Default: now(), Not Null)

*   **`attachment_categories` Table:** Stores user-definable categories for attachments.
    *   `category_id`: UUID (Primary Key)
    *   `category_name`: TEXT (Unique, Not Null)
    *   `created_at`: TIMESTAMPTZ (Default: now(), Not Null)
    *   `updated_at`: TIMESTAMPTZ (Default: now(), Not Null, with trigger to auto-update)
    *   *Initial suggested categories:* 'Contract', 'ID Scan', 'Right to Work Document', 'Performance Review', 'Other'.

*   **`employee_attachments` Table:** Stores metadata for files attached to an employee record.
    *   `attachment_id`: UUID (Primary Key)
    *   `employee_id`: UUID (Foreign Key to `employees.employee_id`, CASCADE DELETE)
    *   `category_id`: UUID (Foreign Key to `attachment_categories.category_id`)
    *   `file_name`: TEXT (Not Null) - Original name of the uploaded file.
    *   `storage_path`: TEXT (Not Null) - Path to the file within Supabase Storage (e.g., in the 'employee-attachments' bucket).
    *   `mime_type`: TEXT (Not Null)
    *   `file_size_bytes`: BIGINT (Not Null)
    *   `description`: TEXT (Nullable)
    *   `uploaded_at`: TIMESTAMPTZ (Default: now(), Not Null)

#### 3.2. User Interface and Functionality

-   **Employee List (`/employees`):** Displays a table of all employees with key details (Name, Email, Job Title, Status) and links to view individual employee pages.
    -   Includes an "Add Employee" button.
-   **Add Employee Page (`/employees/new`):** A form to create new employee records.
-   **View Employee Page (`/employees/[employee_id]`):**
    -   Displays all details of a selected employee.
    -   Includes an "Edit Employee" button.
    -   Includes a "Delete Employee" button (with confirmation modal).
    -   **Notes Section:**
        -   Lists all notes for the employee, showing author (if available from a `profiles` table linked via `created_by`) and timestamp.
        -   Form to add new time-stamped notes (associates the current authenticated user as `created_by`).
    -   **Attachments Section:**
        -   Lists all attachments for the employee (file name, size, description, category).
        -   Provides download links for each attachment (using Supabase Storage signed URLs).
        -   Includes a delete button for each attachment (with confirmation modal), which also removes the file from Supabase Storage.
        -   Form to upload new attachments, including file selection, category dropdown (categories are fetched dynamically), and an optional description.
-   **Edit Employee Page (`/employees/[employee_id]/edit`):** A form pre-filled with existing data to update an employee's record.

#### 3.3. Backend Logic (Server Actions)

Located primarily in `src/app/actions/employeeActions.ts`:

-   `addEmployee`: Creates a new employee.
-   `updateEmployee`: Updates an existing employee.
-   `deleteEmployee`: Deletes an employee (and redirects to the employee list).
-   `addEmployeeNote`: Adds a new note for an employee.
-   `addEmployeeAttachment`: Handles file upload to Supabase Storage (bucket: `employee-attachments`) and creates a corresponding database record.
-   `deleteEmployeeAttachment`: Deletes an attachment record from the database and the associated file from Supabase Storage.

#### 3.4. Important Considerations

-   **Supabase Storage:** Ensure the bucket named `employee-attachments` (or your chosen name) is created in your Supabase project and that appropriate RLS policies are set for access (uploads, downloads, deletes).
-   **`created_by` in Notes:** The `addEmployeeNote` action attempts to capture the ID of the user creating the note. This relies on the client-side form passing the user's ID. Review and ensure this aligns with your authentication and RLS strategy for the `employee_notes` table.
-   **Error Handling & UX:** Basic error handling is in place. For a production application, consider more robust error display (e.g., toast notifications) and user feedback.
-   **Cascade Deletes:** The `employee_notes` and `employee_attachments` tables are set up with `ON DELETE CASCADE` for the `employee_id` foreign key. This means if an employee record is deleted, all their associated notes and attachment records will also be automatically deleted from the database. Files in Supabase Storage, however, are *not* automatically deleted by this database cascade and are handled by the `deleteEmployeeAttachment` action (and would need to be handled if an entire employee and their storage folder were to be bulk-deleted, which is not yet implemented).

This concludes the main implementation of the employee management feature.

### Recent Application Updates

This section details recent changes and bug fixes implemented in the application.

#### 1. Booking Form Data Loading Fix

-   **Issue:** When editing a booking from a customer's page, the booking form modal would appear, but it would not be pre-populated with the booking's existing data.
-   **Fix:** A `useEffect` hook was added to the `BookingForm` component. This hook observes the `booking` prop for changes and updates the form's internal state accordingly, ensuring that whenever a booking is selected for editing, its data is correctly loaded into the form fields.

#### 2. Linking from Event Page to Booking Edit

-   **Feature:** Clicking a customer's name on the event details page now navigates directly to that customer's page and automatically opens the edit modal for that specific booking.
-   **Implementation:** The links on the event page were updated to include a `booking_id` query parameter. The customer page was then enhanced to read this parameter, find the corresponding booking, and trigger the edit modal on page load. The query parameter is also cleared from the URL when the modal is closed.

#### 3. Next.js `params` Promise Handling

-   **Issue:** A warning from Next.js indicated that page `params` (like a customer or event ID) were being accessed directly, which is deprecated. This could lead to race conditions and errors.
-   **Fix:** The affected pages (`customers/[id]/page.tsx` and `events/[id]/page.tsx`) were updated to use the `React.use()` hook. This hook correctly unwraps the `params` promise, ensuring that the ID is resolved before it is used for data fetching, thus aligning with modern Next.js best practices.

#### 4. Centralised Supabase Client & "Add Booking" Flow Rework

-   **Issue:** The application was creating multiple Supabase client instances, leading to warnings and potential instability. Additionally, attempting to create a new booking from the customer page would cause a crash because the booking form required an `event` prop that was not being provided.
-   **Fix:**
    -   A `SupabaseProvider` using React Context was created to ensure a single, shared Supabase client instance is used across the entire application. All pages and components were refactored to use a `useSupabase` hook, eliminating the warning and improving stability.
    -   The "Add Booking" functionality on the customer page was completely overhauled. Now, clicking "Add Booking" first opens a modal to select an event. Once an event is chosen, the `BookingForm` is displayed for that specific event, resolving the crash and providing a logical user flow.
    -   Numerous related bugs and type errors were fixed during this refactoring, leading to a much more robust and error-free booking management experience.

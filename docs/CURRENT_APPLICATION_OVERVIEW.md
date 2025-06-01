# Current Application Overview

This document provides an overview of the Event Planner 3.0 application's current architecture, key technologies, data model, and relevant files before the planned modifications to transform it into a management app for "The Anchor" and add employee management features.

## 1. Project Overview

*   **Framework**: Next.js (v15.2.4) utilizing React (v19) and TypeScript.
*   **Purpose**: The application is currently designed as an event planning tool.
*   **User Interface**: Web-based, responsive design.

## 2. Core Technologies

*   **Backend & Database**: Supabase is used as the backend-as-a-service platform.
    *   The underlying database is PostgreSQL.
    *   The application interacts with Supabase using the `supabase-js` client library, initialized in `src/lib/supabase.ts`.
*   **Authentication**: Supabase Auth handles user authentication.
*   **Styling**: Tailwind CSS (v4) is used for styling, with configurations in `tailwind.config.ts` and `postcss.config.mjs`.
*   **API/Server Logic**:
    *   Implemented using Next.js Route Handlers (e.g., for CRON jobs) and Server Actions.
    *   Direct calls to the Supabase client from server components or route handlers are common for data manipulation.
*   **SMS Notifications**:
    *   Twilio is integrated for sending SMS messages.
    *   The core logic for SMS sending (booking confirmations, event reminders) resides in `src/app/actions/sms.ts`.
    *   A CRON job, defined in `src/app/api/cron/reminders/route.ts`, triggers event reminders.

## 3. Directory Structure Highlights

*   **`src/app`**: Contains the main application code, adhering to the Next.js App Router conventions.
    *   **`(authenticated)`**: A route group for pages and layouts that require user authentication.
        *   `layout.tsx`: Defines the shared layout for authenticated sections, including sidebar and mobile navigation.
        *   `dashboard/page.tsx`: The main dashboard page.
        *   `events/`: Directory for event management pages.
        *   `customers/`: Directory for customer management pages.
        *   `bookings/`: Directory for booking management pages. (The UI page for this will be removed).
    *   **`api/cron/reminders/route.ts`**: The route handler for the CRON job that processes event reminders.
    *   **`actions/sms.ts`**: Server action file containing functions for sending SMS messages via Twilio.
*   **`src/components`**: Contains reusable React components.
    *   `Navigation.tsx`: Defines the sidebar navigation menu for authenticated users.
    *   `BottomNavigation.tsx`: Defines the bottom navigation bar for mobile views for authenticated users.
*   **`src/lib`**: Contains utility functions and core initializations.
    *   `supabase.ts`: Initializes and exports the Supabase client.
    *   `twilio.ts`: Initializes the Twilio client.
    *   `smsTemplates.ts`: Contains templates for SMS messages.
*   **`src/types`**: Contains TypeScript type definitions.
    *   `database.ts`: Defines the TypeScript types representing the Supabase database schema. This is crucial for understanding the data model.
*   **`public/`**: Static assets.
*   **`docs/`**: Project documentation.

## 4. Database Schema (as defined in `src/types/database.ts`)

The database schema is managed within Supabase (PostgreSQL). The application's understanding of this schema is reflected in `src/types/database.ts`:

*   **`events` table**:
    *   `id`: string (UUID)
    *   `name`: string
    *   `date`: string (ISO date)
    *   `time`: string
    *   `capacity`: number | null
    *   `created_at`: string (timestamp)
*   **`customers` table**:
    *   `id`: string (UUID)
    *   `first_name`: string
    *   `last_name`: string
    *   `mobile_number`: string
    *   `created_at`: string (timestamp)
*   **`bookings` table**:
    *   `id`: string (UUID)
    *   `customer_id`: string (foreign key to `customers.id`)
    *   `event_id`: string (foreign key to `events.id`)
    *   `seats`: number | null
    *   `notes`: string | null
    *   `created_at`: string (timestamp)
    *   *Note*: The `bookings` table and its associated backend logic (including SMS confirmations and reminders handled by `src/app/actions/sms.ts`) will be preserved. Only the user-facing page at `/bookings` and its navigation links will be removed.

## 5. User Interface & Navigation

*   **Main Authenticated Layout**: `src/app/(authenticated)/layout.tsx` wraps all pages within the authenticated section.
*   **Desktop Navigation**: `src/components/Navigation.tsx` renders a sidebar menu.
    *   Current Items: Dashboard, Events, Customers, Bookings.
*   **Mobile Navigation**: `src/components/BottomNavigation.tsx` renders a bottom tab bar.
    *   Current Items: Dashboard, Events, Customers, Bookings.

## 6. Key Files for Planned Changes

The upcoming modifications will primarily involve:

*   **Adding Employee Management:**
    *   **Schema Definition (`src/types/database.ts`):** New tables (`Employees`, `Employee_Notes`, `Attachment_Categories`, `Employee_Attachments`) will be defined here.
    *   **New Routes/Pages (within `src/app/(authenticated)/employees/`):** For listing, viewing, adding, and editing employees and their related data (notes, attachments).
    *   **New Components (within `src/components/`):** For forms, display elements related to employees.
    *   **New API Logic/Server Actions:** For handling CRUD operations for employee data and file uploads.
*   **Menu Restructuring:**
    *   `src/components/Navigation.tsx`: Modify to remove "Bookings", add "Employees", and ensure "Customers" and "Events" are top-level.
    *   `src/components/BottomNavigation.tsx`: Apply the same menu changes.
*   **Removing Bookings Page:**
    *   The directory `src/app/(authenticated)/bookings/` and its `page.tsx` will be removed.

This overview should serve as a baseline for understanding the application before the planned development work. 
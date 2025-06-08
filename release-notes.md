# Release Notes - Session Ending 2024-07-26

This document summarises the features, bug fixes, and major improvements implemented during the latest development session.

### Key Features & Enhancements

1.  **Mobile-First Responsive Redesign**
    -   New mobile responsiveness standards have been added to the `STYLING_GUIDE.md` to enforce a consistent, mobile-first approach.
    -   All primary pages (Dashboard, Events, Customers, Employees, and their respective detail pages) have been updated to be fully mobile-friendly.
    -   Data tables now transform into card-based lists on smaller screens for improved readability and usability.
    -   Page headers now stack vertically on mobile to ensure action buttons and titles are easily accessible.

2.  **Clickable Contact Information**
    -   Across the application, all email addresses and phone numbers (for both employees and customers) are now clickable `mailto:` and `tel:` links, improving user workflow.

3.  **Standardised Date Formatting**
    -   A new `formatDate` utility was implemented to standardise all dates across the application to a `MMMM D, YYYY` format for consistency.

4.  **Direct Navigation to Booking Edit from Event Page**
    -   Users can now click a customer's name on an event's detail page to navigate directly to that specific booking for editing.
    -   This is enabled by passing the `booking_id` and a `return_to` URL in the query parameters, ensuring a seamless workflow.

5.  **Return to Event Page After Edit**
    -   After editing a booking accessed from an event page, users are now automatically redirected back to the event page, maintaining context and improving workflow efficiency.

6.  **Display Booking Notes on Event Page**
    -   The event details page now displays any notes associated with a booking directly under the customer's name, providing important context at a glance.

### Bug Fixes & Stability Improvements

1.  **Employee Edit Page Errors**
    -   **Issue:** The employee edit page was throwing errors related to incorrect `params` access and passing server functions to client components.
    -   **Fix:** The page was refactored to pass the `employee_id` in a hidden form field instead of binding it to the server action, resolving both errors.

2.  **Broken Employee Edit Button**
    -   **Issue:** The "Edit Employee" button on the employee detail page was wrapping onto two lines.
    -   **Fix:** The `whitespace-nowrap` utility class was added to the button's link to prevent the text from wrapping.
    
3.  **Centralised Supabase Client**
    -   **Issue:** The application was creating multiple Supabase client instances, causing warnings and potential instability.
    -   **Fix:** A `SupabaseProvider` was implemented using React Context to ensure a single, shared Supabase client is used across the app. All components were refactored to use a `useSupabase` hook.

4.  **"Add New Booking" Flow Rework**
    -   **Issue:** The "Add Booking" feature on the customer page would crash because the booking form was missing a required `event` prop.
    -   **Fix:** The workflow was completely overhauled. Users now first select an event from a modal, which then correctly initialises the booking form, resolving the crash.

5.  **Booking Form Data Loading**
    -   **Issue:** The booking edit form failed to pre-populate with existing booking data.
    -   **Fix:** A `useEffect` hook was added to the `BookingForm` to correctly load the booking's data whenever the edit modal is opened.

6.  **Reminder Note Validation**
    -   **Issue:** Users could not add a note to a reminder (a booking with 0 seats) due to a validation error requiring at least 1 seat.
    -   **Fix:** The `min="1"` validation was removed from the "Number of Seats" input field in the `BookingForm`, allowing notes to be added to reminders without error.

7.  **Layout & UI Fixes**
    -   **Issue:** The UI on the customer details page was simplified unintentionally during refactoring.
    -   **Fix:** The original, more detailed layout with a customer info header and separate tables for "Active Bookings" and "Reminders" was restored.

### Technical & Build Fixes

1.  **Next.js `params` Promise Handling**
    -   **Issue:** A Next.js warning indicated that page `params` were being accessed directly, which is deprecated.
    -   **Fix:** Affected pages were updated to use the `React.use()` hook, ensuring `params` are resolved correctly before use.

2.  **Build Error Resolution**
    -   **Issue:** The project was failing to build due to an error in generating static paths for dynamic pages.
    -   **Fix:** Pages with dynamic routes (`/customers/[id]` and `/events/[id]`) were configured for dynamic, on-demand rendering at request time, which resolves the static generation error and is more appropriate for these data-driven pages. 
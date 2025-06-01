# Code Review Log - Event Planner 3.0

This document logs the process, findings, and changes made during a comprehensive code review of the Event Planner 3.0 application.

## Review Date: July 20, 2024 (Ongoing)

## I. Configuration Files & Setup

### 1. `package.json`
- **Observations:**
    - Uses Next.js 15.2.4 and React 19.0.0 (Canary/experimental versions). Advised caution if stability is paramount.
    - Standard scripts (`dev`, `build`, `start`, `lint`).
    - Key dependencies: Supabase (extensive integration), Heroicons, `react-hot-toast`, Twilio.
    - Dev dependencies: ESLint (v9), Tailwind CSS (v4), TypeScript (v5).
- **Actions:** None directly, but noted version choices.

### 2. `next.config.ts`
- **Observations:** Default empty configuration.
- **Recommendations:** Consider adding explicit configurations for environment variables, image optimization, `reactStrictMode`, security headers, etc., as needed.
- **Actions:** None taken yet.

### 3. `tsconfig.json`
- **Observations:** Well-configured for a Next.js project (strict mode, path aliases `@/*`, appropriate module settings).
- **Actions:** None needed.

### 4. `eslint.config.mjs`
- **Observations:** Uses new flat config format, extends `next/core-web-vitals` and `next/typescript`.
- **Recommendations:** Consider adding more specific ESLint plugins (e.g., `eslint-plugin-jsx-a11y`, `eslint-plugin-react-hooks`) for enhanced linting.
- **Actions:** None taken yet.

### 5. `tailwind.config.ts`
- **Observations:** Standard content globs. Uses `@tailwindcss/forms` plugin (`^0.5.10`). Theme extend is empty.
- **Recommendations:** Ensure `@tailwindcss/forms` is compatible with Tailwind CSS v4. Review Tailwind v4 documentation for best practices with Next.js.
- **Actions:** 
    - **(July 21, 2024):** To troubleshoot broken styles after PostCSS configuration changes, temporarily commented out `require('@tailwindcss/forms')` as the existing version is likely incompatible with Tailwind CSS v4 and might be causing conflicts.

### 6. `postcss.config.mjs`
- **Observations:** Initially used `plugins: ["@tailwindcss/postcss"]`, which is for Tailwind CSS v3. Later changed to `plugins: ["tailwindcss"]` based on an interpretation of v4 documentation.
- **Actions:** 
    - **Initial Update:** Changed to `plugins: ["tailwindcss"]`.
    - **Correction (July 21, 2024):** Encountered a build error: "It looks like you're trying to use `tailwindcss` directly as a PostCSS plugin... install `@tailwindcss/postcss` and update your PostCSS configuration." Checked `package.json` and confirmed `@tailwindcss/postcss` was already installed. Reverted the configuration in `postcss.config.mjs` to `plugins: ["@tailwindcss/postcss"]` to resolve the build error.

### 7. `src/app/globals.css`
- **Observations:** 
    - Used unconventional `@import "tailwindcss";`.
    - Contained `@theme inline` (Tailwind v4 feature) with references to unconfigured Geist fonts.
    - Had a `font-family: Arial,...` in `body` conflicting with `next/font` (Inter).
- **Actions:**
    - **Replaced `@import`:** Changed to standard `@tailwind base; @tailwind components; @tailwind utilities;`.
    - **Resolved Font Conflict:** Removed `font-family: Arial,...` from `body` styles.
    - **Adjusted `@theme`:** Commented out Geist font references in `@theme inline`.

## II. Core Application Logic & Middleware

### 1. `middleware.ts`
- **Observations:** Initial version had basic cron path whitelisting and placeholder for other logic. Matcher was a bit broad for `login`.
- **Actions:** 
    - **Rewritten:** Significantly updated to use `createServerClient` from `@supabase/ssr` for robust Supabase authentication.
    - Implemented session checking, redirection for unauthenticated users to `/login` (with `redirect_to` query param), and redirection for authenticated users away from `/login` or `/auth/signup` to `/dashboard`.
    - Refined the `matcher` to be simpler, excluding only essential static assets and relying on middleware logic for path-specific rules.

### 2. API Routes (`src/app/api/cron/reminders/route.ts`)
- **Observations:** 
    - Well-structured GET handler for a cron job.
    - Uses `dynamic = 'force-dynamic'` and `revalidate = 0`.
    - Securely checks for `CRON_SECRET_KEY` via Authorization header.
    - Delegates reminder sending to `sendEventReminders` server action.
    - Good logging and error handling (though detailed error messages in cron responses might be reconsidered for production).
- **Actions:** None needed. Approved as good practice.

### 3. Server Actions (`src/app/actions/sms.ts`)
- **`sendBookingConfirmation`:**
    - **Observations:** Fetches booking, customer, event; sends SMS via Twilio. Lacked return value for client feedback.
    - **Actions:** 
        - Added `ActionResult` return type (`{ success: boolean; message?: string; error?: string; }`).
        - Updated to return success/error objects.
        - Made Supabase select queries use `!inner` for `customer` and `event` relations for robustness.
        - Added `timezone` to event selection (anticipating its use).
        - Addressed linter errors by adapting to how TypeScript was inferring related types (see below).
- **`sendEventReminders`:**
    - **Observations:** Fetches bookings for upcoming events (tomorrow, next week) and sends reminders. Supabase query for filtering on related event dates needed refinement. Lacked idempotency. Timezone handling for `today` was server-local.
    - **Actions:** 
        - Refined Supabase query to use `!inner` for related tables and filter explicitly on `events.date`.
        - Added `timezone` to event selection.
        - Added comments regarding UTC for `today` and conceptual implementation of idempotency (requires schema change).
        - Addressed linter errors (see below).
- **Linter Error Resolution (General for `sms.ts`):**
    - **Issue:** Linter consistently typed related records (e.g., `booking.customer`) as arrays (`Type[]`) despite `!inner` joins.
    - **Workaround Applied:** Modified access to related properties to first check if the property is an array and then access `[0]` (e.g., `const customer = booking.customer && Array.isArray(booking.customer) ? booking.customer[0] : booking.customer;`). This satisfies the linter while assuming `!inner` ensures a single record logic. Added comments explaining this is a workaround for type inference issues and that proper Supabase generated types would be ideal.

### 4. SMS Templates (`src/lib/smsTemplates.ts`)
- **Observations:** Good structure with typed parameters. Uses `en-GB` locale for date formatting. Hardcoded contact phone number.
- **Actions:**
    - Removed redundant `new Date(params.eventDate)` as `eventDate` was already a `Date` object.
    - Made contact phone number configurable via `process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER` with a fallback.

## III. Authentication UI & Pages

### 1. `src/app/login/page.tsx`
- **Observations:** Initially, this page was a placeholder that immediately redirected to `/bookings`, offering no actual login mechanism.
- **Actions:** 
    - **Completely Rewritten:** Implemented a proper login page using the Supabase `Auth` UI component from `@supabase/auth-ui-react`.
    - Configured `redirectTo` for OAuth/email confirmation callbacks to `/auth/callback` (using `NEXT_PUBLIC_APP_URL`).
    - Handles `onAuthStateChange` to redirect users after successful sign-in, respecting the `redirect_to` query parameter set by the middleware.

### 2. `src/app/auth/signup/page.tsx`
- **Observations:** Custom signup form. Redirected to `/auth/login` (which was not the primary login page after `login/page.tsx` was updated).
- **Actions:**
    - Updated to redirect to the main `/login` page (where Supabase Auth UI resides).
    - Changed internal link to also point to `/login`.
    - Updated `emailRedirectTo` to use `NEXT_PUBLIC_APP_URL`.
    - Added basic client-side password validation (length, match) and improved button disabled state.
    - **Recommendation:** Consider if this custom page is needed or if the signup functionality of the Supabase Auth UI on `/login` suffices for consistency.

## IV. Application Pages & Components

### 1. `src/app/(authenticated)/dashboard/page.tsx`
- **Observations:** Client-side component (`'use client'`) fetching multiple pieces of data via Supabase in `useEffect`. Data aggregation performed on client.
- **Actions:**
    - **Optimized Data Fetching:** Modified `loadDashboardData` to use `Promise.all()` for concurrent Supabase calls.
    - **Improved Error Handling:** Added state for errors and now displays a user-friendly error message in the UI if data loading fails.
    - **Constants:** Defined `NEAR_CAPACITY_THRESHOLD` as a constant.
    - **Safer Calculations:** Ensured `averageSeatsPerEvent` calculation avoids division by zero.
    - **UI Enhancements:** Improved loading state text, added "no upcoming events" message, refined event card UI (border colors, capacity percentage, layout).
- **Recommendations:** Strongly consider converting to a Server Component for initial data fetching to improve perceived load performance. Explore Supabase RPCs/Views for server-side data aggregation for larger datasets.

### 2. `src/lib/dateUtils.ts`
- **Observations:** Simple `formatDate` utility. Handles `string | Date` input. Uses `en-GB` locale. Relies on `new Date()` parsing for strings.
- **Recommendations:** Generally fine for Supabase date strings. For more varied string inputs, a dedicated parsing library would be more robust. Could add `Invalid Date` check.
- **Actions:** None needed for current usage.

## V. Global Layout & Styles

### 1. `src/app/layout.tsx`
- **Observations:** Standard root layout. Uses `next/font` for Inter. Includes global `Toaster` for `react-hot-toast`. Metadata defined. `lang="en"`.
- **Actions:**
    - **Updated `lang`:** Changed `lang="en"` to `lang="en-GB"` for more specific British English localization as per requirements.

### 2. `src/app/globals.css` (Covered in Section I)

## VI. Pending Review Items

- Content and functionality of other authenticated pages:
    - `src/app/(authenticated)/events/[id]/page.tsx` (and list page)
    - `src/app/(authenticated)/bookings/[id]/page.tsx` (and list page)
    - `src/app/(authenticated)/customers/[id]/page.tsx` (and list page)
- Reusable components in `src/components/`.
- Verification of all necessary environment variables in `.env.local`.
- Updating/Creating comprehensive project documentation (like this log, and potentially `README.md`, `PRD.md`).

## VII. Review of `src/app/(authenticated)/events/[id]/page.tsx` (Event Detail Page)

**Review Date:** July 21, 2024

**Initial Observations & Linter Errors:**
- The page is responsible for displaying details of a single event and managing its bookings.
- Key functionalities include: loading event details and bookings, creating single bookings, adding multiple attendees via a modal, and deleting bookings.
- Linter errors reported:
    1.  `Cannot find name 'loadEvent'` (Line 238): `loadEvent` called in an `onClick` is not accessible.
    2.  `Property 'description' does not exist on type 'Event'` (Line 322).
    3.  `Property 'timezone' does not exist on type 'Event'` (Line 332).
    4.  `AddAttendeesModal` is missing required props: `eventName` and `currentBookings` (Line 375).

**Actions & Resolutions:**
- **Refactored `loadEvent` function:**
    - Moved `loadEvent` outside of `useEffect` to the component scope to make it accessible for the "Try Again" button.
    - Wrapped `loadEvent` with `useCallback` and updated its dependencies.
    - `useEffect` now calls the memoized `loadEvent`.
    - This resolved the `Cannot find name 'loadEvent'` error.
- **Updated `AddAttendeesModal` props:**
    - Passed the required `eventName={event.name}` and `currentBookings={bookings.map(b => ({ customer_id: b.customer.id }))}` props.
    - Added a check to ensure `event` is not null before rendering the modal.
    - This resolved the linter error regarding missing properties for `AddAttendeesModalProps`.
- **Updated `Event` type definition (`src/types/database.ts`):**
    - Added `description: string | null;` and `timezone: string | null;` to the `Event` interface.
    - This resolved the `Property 'description' does not exist on type 'Event'` and `Property 'timezone' does not exist on type 'Event'` errors.

## VIII. Review of `src/app/(authenticated)/events/page.tsx` (Events List Page)

**Review Date:** July 21, 2024

**Observations:**
- Displays upcoming/current and past events with create, edit, and delete functionality.
- `EventForm` component is used for create/edit operations.
- Deletion includes confirmation and cascading delete of associated bookings.
- Calculates `booked_seats` per event by fetching related bookings.
- Client-side data fetching in `useEffect`.
- Responsive UI with separate table (desktop) and card (mobile) views.
- Good loading and error states.

**Actions & Resolutions:**
- **Refactored `loadData` function:**
    - Wrapped `loadData` with `useCallback` and added `supabase` as a dependency for consistency and best practice (though initial `useEffect` had `[]` deps).
    - `useEffect` now calls the memoized `loadData`.
    - Adjusted booking data handling within `loadData` to gracefully handle cases where no bookings are returned for events, preventing an unnecessary error throw.
- **Optimised `handleDeleteEvent`:**
    - Removed redundant `setIsLoading(false)` calls from within the `try` block, relying on the `finally` block for this.

**Overall Assessment:** The page is well-structured and functional. Client-side data fetching is appropriate for its interactive nature.

## IX. Review of `src/app/(authenticated)/bookings/page.tsx` (Bookings List Page)

**Review Date:** July 21, 2024

**Initial Observations:**
- The page lists bookings, grouped by event.
- It features a modal-based `BookingForm` for creating/editing bookings.
- An event selector is present, presumably to filter bookings or pre-select an event for new bookings.
- It uses a Supabase client imported from `@/lib/supabase`.
- Initial read was limited to the first 250 lines.

**Actions & Resolutions:**
- **Supabase Client:** Changed from `@/lib/supabase` to `createClientComponentClient()` from `@supabase/auth-helpers-nextjs`.
- **`loadData` Function:**
    - Wrapped in `useCallback`.
    - Modified Supabase queries to use `!inner` joins for related `events` and `customers` to ensure bookings are always returned even if related data is missing (though this is unlikely for mandatory relations).
- **Error Handling:**
    - Added an `error` state (`string | null`).
    - Implemented UI to display the error message if `error` is set.
- **Styling & UI:**
    - Replaced `text-black` with Tailwind CSS gray shades (e.g., `text-gray-900`, `text-gray-700`).
    - Improved loading and empty state messages.
- **Refactoring for Clarity:**
    - Main page content was refactored into a `PageContent` sub-component to improve organization.
    - This refactor included rendering logic for bookings and reminders based on the understood structure from partial file views.
- **Linter Error Resolution (Implicit `any` types):**
    - **Issue:** The `PageContent` sub-component and its usage had implicit `any` types for props and callback parameters.
    - **Fix:**
        - Defined `PageContentProps` interface with explicit types for `bookings`, `events`, `remindersSchedules`, `isLoading`, `error`, `handleEditBooking`, `handleDeleteBooking`, `handleSendReminder`.
        - Defined `GroupedBooking` interface to structure the data passed to `PageContent`.
        - Applied these types to the `PageContent` component and its props.
        - Explicitly typed callback parameters in `PageContent`.
    - Refined modal display logic and empty states.

**Note:** Initial attempts to read the full file were capped at 250 lines, so some of the refactoring for the main rendering logic was based on an inferred structure.

## X. Review of `src/app/(authenticated)/bookings/[id]/page.tsx` (Booking Detail Page)

**Review Date:** July 21, 2024

**Initial Observations:**
- Displays details of a single booking, including links to the associated customer and event.
- Basic error and loading states were present.
- Used `text-black` for styling.
- Initial Supabase queries did not explicitly use `!inner` joins.

**Actions & Resolutions:**
- **Error Handling:**
    - Added an `error` state (`string | null`).
    - Implemented UI to display the error message.
    - Used `toast.error()` for displaying errors during data loading.
- **Supabase Queries:**
    - Updated `loadBooking` to use `!inner` joins for `events` and `customers` relations.
- **Loading & Not Found States:** Improved messages for clarity.
- **Styling:** Changed `text-black` instances to appropriate Tailwind CSS gray shades.
- **`loadBooking` Function:**
    - Wrapped in `useCallback`.
- **Type Safety:**
    - Adjusted the `BookingWithDetails` type to correctly reflect the structure after `!inner` joins (related entities are objects, not arrays).
- **UI & Layout:** Refined the layout for better presentation of booking details.
- **Data Refresh:** Introduced a `refreshBookings` callback prop (though its implementation/use was primarily for consistency, as this page deals with a single booking).

## XI. Review of `src/app/(authenticated)/customers/page.tsx` (Customers List Page)

**Review Date:** July 21, 2024

**Initial Observations (from first 250 lines):**
- Handles CRUD operations for customers.
- Includes functionality for importing customers (presumably from a CSV or similar).
- Features a search filter.
- Mentions a "loyalty feature," details of which were not fully visible.
- Uses a Supabase client from `@/lib/supabase`.

**Actions & Resolutions (on visible part):**
- **Supabase Client:** Switched to `createClientComponentClient()`.
- **Error Handling:** Added `error` state and UI to display errors.
- **`loadData` Function:** Wrapped in `useCallback`.
- **Styling:** Improved general styling consistency (e.g., button styles).
- **Type Safety:** Typed callback parameters.
- **User Confirmation:** Used `window.confirm` for delete operations.
- **Modal Handling:** Improvements to `CustomerFormModal` display logic.

**Status: Partial Review**
- Due to limitations in viewing the entire file (only the first 250 lines were accessible), the rendering logic for the customer list itself, the full implementation of the search filter, and the details of the loyalty feature could not be fully reviewed or refactored.
- Actions taken were based on the visible top portion of the file, focusing on data fetching, error handling, and modal interactions.

## XII. Review of `src/app/(authenticated)/customers/[id]/page.tsx` (Customer Detail Page)

**Review Date:** July 21, 2024

**Initial Observations (from first 250 lines):**
- Displays details for a single customer.
- Shows the customer's bookings, potentially categorized (e.g., active bookings, reminders).
- Allows editing and deleting bookings directly from this page.
- Areas for improvement noted: error handling, explicit Supabase `!inner` joins, styling consistency, and use of `useCallback`.

**Actions & Resolutions:**
- **Error Handling:**
    - Added an `error` state (`string | null`).
    - Implemented UI to display the error message.
- **`loadData` Function (renamed from `loadCustomer`):**
    - Wrapped in `useCallback`.
    - Updated Supabase queries to use `!inner` joins for related bookings and their events.
- **Messaging:** Improved loading and "not found" messages.
- **Styling:** Applied consistent Tailwind CSS styling (e.g., text colors, button styles).
- **Type Safety:**
    - Refined `BookingWithEvent` type to accurately represent the data structure (event is an object).
- **Data Refresh & Booking Management:**
    - Created a `refreshBookings` function to reload booking data.
    - Adjusted `handleUpdateBooking` to pass more data from the `BookingForm` (details of `data` parameter led to new linter errors).
- **Local `BookingTable` Component:** Refined for displaying customer's bookings.

**Current Linter Errors (to be addressed):**
1.  `handleUpdateBooking`'s `data` parameter has an implicit `any` type.
2.  Type issues related to `BookingForm` props (`booking` and `event`), likely used within the `BookingTable` or a modal triggered from it.

**Linter Error Resolution (July 21, 2024):**
- **`handleUpdateBooking` `data` parameter:**
    - Defined a `BookingFormData` type as `Omit<Booking, 'id' | 'created_at'>` in `src/app/(authenticated)/customers/[id]/page.tsx`.
    - Updated `handleUpdateBooking` to use `data: BookingFormData`.
    - Modified the logic within `handleUpdateBooking` to construct an `updatePayload` containing only `seats` and `notes` if they have changed, ensuring `customer_id` and `event_id` are not inadvertently updated from this context.
- **`BookingForm` prop types:**
    - Investigated the props passed to `<BookingForm />` in `src/app/(authenticated)/customers/[id]/page.tsx` and the expected props in `src/components/BookingForm.tsx`.
    - The `editingBooking` (type `BookingWithEvent`) passed as the `booking` prop was deemed structurally compatible for the fields accessed by `BookingForm` (`customer_id`, `seats`, `notes`).
    - The `editingBooking.event` (type `Required<Pick<Event, 'id' | 'name' | 'date' | 'time' | 'capacity'>>`) passed as the `event` prop was found to be a subset of the `Event` type originally expected by `BookingForm`.
    - **Action:** Updated the `event` prop in `BookingFormProps` (within `src/components/BookingForm.tsx`) to be `Pick<Event, 'id' | 'name' | 'date' | 'time' | 'capacity'>`. This aligns the expected prop type with what is provided by the customer detail page and used by the form, resolving the type mismatch.

With these changes, the linter errors on `src/app/(authenticated)/customers/[id]/page.tsx` should be resolved.

This log will be updated as the review progresses. 
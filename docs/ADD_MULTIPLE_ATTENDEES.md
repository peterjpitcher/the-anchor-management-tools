# Feature: Add Multiple Attendees to an Event

**Date:** 2024-07-26

**Objective:** Implement functionality to allow a user to select multiple people (Customers) from a list using checkboxes and add them as attendees to an existing event. This will involve creating multiple `Booking` records.

## 1. Overview

The feature will be integrated into the `EventViewPage` (event detail page). A new button, "Add Attendees", will open a modal dialogue. This modal will display a list of available customers who are not already booked for the current event. Users can select multiple customers via checkboxes and, upon submission, new `Booking` records will be created for each selected customer for the current event.

## 2. Affected Components and Files

*   **`src/app/(authenticated)/events/[id]/page.tsx` (`EventViewPage`):**
    *   Will host the new "Add Attendees" button.
    *   Will manage the state for showing/hiding the new `AddAttendeesModal`.
    *   Will contain the logic to handle the creation of multiple `Booking` records upon successful submission from the modal.
    *   Will refresh its list of bookings after new attendees are added.
*   **`src/components/AddAttendeesModal.tsx` (New Component):**
    *   A modal component responsible for displaying the list of customers, handling selections, and triggering the add operation.
*   **`src/types/database.ts`:**
    *   No changes required. The existing `Customer` and `Booking` types and the Supabase schema for `bookings` (as a join table between `events` and `customers`) are suitable.

## 3. Detailed Plan

### 3.1. `EventViewPage.tsx` (`src/app/(authenticated)/events/[id]/page.tsx`)

1.  **UI Changes:**
    *   Add a new button, "Add Attendees" (e.g., with a `UserGroupIcon`), next to or near the existing "Quick Book" button.
    *   This button will toggle a state variable (e.g., `showAddAttendeesModal: boolean`).
2.  **State Management:**
    *   Introduce `const [showAddAttendeesModal, setShowAddAttendeesModal] = useState(false);`.
3.  **New Handler Function (`handleAddMultipleAttendees`):**
    *   **Input:** `customerIds: string[]` (from the modal).
    *   **Logic:**
        *   Check if `event` details are loaded and `customerIds` is not empty.
        *   Construct an array of `Booking` objects to be inserted. Each object will be:
            ```json
            {
              "event_id": "current_event_id",
              "customer_id": "selected_customer_id",
              "seats": 1 // Default to 1 seat. This can be made configurable later if needed.
            }
            ```
        *   Use `supabase.from('bookings').insert(newBookingsData)` to perform a bulk insert.
        *   Handle success: Show a success toast (e.g., "X attendees added successfully!"), close the modal, and refresh the bookings list on the page (re-fetch bookings for the current event).
        *   Handle error: Show an error toast (e.g., "Failed to add attendees."), log the error. The modal might remain open or close depending on the desired UX for error scenarios. Re-throw error to allow modal to manage its own submission state.
4.  **Modal Integration:**
    *   Conditionally render `<AddAttendeesModal />` based on `showAddAttendeesModal`.
    *   Pass necessary props to the modal:
        *   `eventId: string` (current event's ID).
        *   `eventName: string` (current event's name, for the modal title).
        *   `currentBookings: BookingWithCustomer[]` (to allow the modal to filter out already booked customers; ensure this matches or is compatible with the type used in `EventViewPage`).
        *   `onClose: () => setShowAddAttendeesModal(false)`.
        *   `onAddAttendees: handleAddMultipleAttendees`.

### 3.2. `AddAttendeesModal.tsx` (`src/components/AddAttendeesModal.tsx`) - New File

1.  **Props:**
    *   `eventId: string`
    *   `eventName: string`
    *   `currentBookings: Array<{ customer_id: string; /* other booking fields, ideally matching BookingWithCustomer or a relevant subset */ }>` (Type should align with `BookingWithCustomer` from `EventViewPage`)
    *   `onClose: () => void`
    *   `onAddAttendees: (customerIds: string[]) => Promise<void>`
2.  **Internal State:**
    *   `allCustomers: Customer[]` (fetched list of all customers).
    *   `availableCustomers: Customer[]` (customers filtered by not already booked and search term).
    *   `selectedCustomerIds: string[]` (IDs of customers selected via checkboxes).
    *   `isLoading: boolean` (for customer fetching state).
    *   `isSubmitting: boolean` (for submission state).
    *   `searchTerm: string` (for client-side search/filter of customers).
3.  **Lifecycle & Data Fetching (`useEffect`):**
    *   On component mount, fetch all customers from the `customers` table via Supabase (`supabase.from('customers').select('*').order('first_name')`).
    *   Handle loading and error states for the fetch operation.
4.  **Customer Filtering (`useEffect`):**
    *   Create a derived list `availableCustomers` by:
        *   Filtering `allCustomers` to exclude those whose `customer_id` is present in `props.currentBookings`. (Ensure `props.currentBookings` provides `customer_id` for effective filtering).
        *   Further filtering based on `searchTerm` (matching against first name, last name, mobile number).
5.  **UI Elements:**
    *   Modal container (fixed position overlay, centered content).
    *   Title (e.g., "Add Attendees to {props.eventName}").
    *   Search input field bound to `searchTerm`.
    *   A table or scrollable list displaying `availableCustomers`. Each row should show:
        *   A checkbox, bound to `selectedCustomerIds`.
        *   Customer's full name (`first_name` `last_name`).
        *   Customer's mobile number (optional, for identification).
    *   A "Select All" / "Deselect All" checkbox in the table header to toggle selection of all `availableCustomers`.
    *   Loading indicator while `isLoading` is true.
    *   Message like "No new customers available to add." if `availableCustomers` is empty after loading and filtering.
    *   Action buttons:
        *   "Add Selected Attendees": Calls `handleSubmit`. Disabled if `selectedCustomerIds` is empty or `isSubmitting` is true.
        *   "Cancel": Calls `props.onClose`.
6.  **Event Handlers:**
    *   `handleSelectCustomer(customerId: string)`: Toggles the presence of `customerId` in `selectedCustomerIds`.
    *   `handleSelectAll()`: Selects or deselects all `availableCustomers`.
    *   `handleSubmit()`:
        *   Sets `isSubmitting` to true.
        *   Validates that `selectedCustomerIds` is not empty.
        *   Calls `props.onAddAttendees(selectedCustomerIds)`.
        *   On successful promise resolution from `onAddAttendees`, `props.onClose()` is called (as `onAddAttendees` in parent will close it).
        *   On error, `isSubmitting` is set to false. The error toast is handled by the parent.
7.  **Styling:**
    *   Ensure the modal is responsive and follows the existing application's design language (e.g., Tailwind CSS classes).

## 4. Data Model Considerations

*   **`Booking` Table:** The existing `bookings` table (with `event_id`, `customer_id`, `seats`, etc.) is the correct mechanism for linking customers to events.
*   **Default Seats:** When adding multiple attendees, a default of `1` seat per booking will be assumed. If these "attendees" are different from "bookings with seats" (e.g., just a guest list), the `seats` could be set to `0` or `null`. For now, `1` is a reasonable default.

## 5. Future Enhancements (Optional)

*   Server-side pagination for the customer list in the modal if the number of customers becomes very large.
*   More advanced filtering options for customers (e.g., by tags, groups if such concepts exist).
*   Allowing specification of `seats` or `notes` per customer during the bulk add process (more complex UI).

This plan provides a clear path for implementing the desired functionality. 
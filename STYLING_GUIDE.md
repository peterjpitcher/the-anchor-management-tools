# Styling Guide

This document outlines the styling conventions used throughout the application to ensure a consistent and "cosy" user experience.

## Layout

- **Overall Layout**: All page content should be structured within cards. The main page container should have a `space-y-6` or `space-y-8` class to provide consistent vertical spacing between these cards.
- **Page Container**: The primary container for a page's content within the main layout should not have a `max-width` constraint, allowing it to be full-width.

## Page Headers

- **Layout**: The header of each page (containing the title, description, and primary actions) should be encapsulated within its own card. This card will typically be the first element in the main `space-y-` container.
- **Structure**:
  - The card itself should have `bg-white shadow sm:rounded-lg`.
  - The padding for the header card should be `px-4 py-5 sm:p-6`.
  - Inside the card, use `flex justify-between items-center` to create two columns: one for the title/description and one for the action buttons.
- **Example from `/events/[id]` page:**

```html
<div class="bg-white shadow sm:rounded-lg">
  <div class="px-4 py-5 sm:p-6">
    <div class="flex justify-between items-center">
      <div>
        <h1 class="text-2xl font-bold text-gray-900">Event Name</h1>
        <p class="mt-1 text-sm text-gray-500">
          Event Date and Time
        </p>
      </div>
      <div class="flex space-x-3">
        <button type="button" class="...">Add Attendees</button>
        <button type="button" class="...">New Booking</button>
      </div>
    </div>
  </div>
</div>
```

## Content Cards

- **Appearance**: All subsequent sections on a page should also be contained within their own cards, following the same base style: `bg-white shadow sm:rounded-lg`.
- **Padding**: The padding for content cards can be either `p-5` or `px-4 py-5 sm:p-6`, depending on the complexity of the content.

## Forms

- **Layout**: Forms, particularly those used for editing data, should use a compact, two-column grid layout for clarity and space efficiency.
  - The direct container for the list of fields should have `space-y-4`.
  - Each field row should use `sm:grid sm:grid-cols-4 sm:items-start sm:gap-x-2`.
  - The `label` for the field should use `sm:col-span-1`.
  - The `div` wrapping the input element should use `sm:col-span-3`.
- **Input Padding**: All `input`, `select`, and `textarea` elements should have consistent internal padding. The standard is `px-3 py-2`.
- **Input Borders**: All form inputs (`input`, `select`, `textarea`) should have a visible, persistent border using `border border-gray-300`.

## Detail Views (Read-Only)

- **Layout**: Pages that display detailed information (like an employee's profile) should use a definition list (`<dl>`) inside a card.
- **Structure**: Each data row in the list should be a `div` with the following classes: `py-3 sm:py-3 sm:grid sm:grid-cols-4 sm:gap-4`.
  - The label (`<dt>`) should have the class `text-sm font-medium text-gray-500`.
  - The value (`<dd>`) should have the classes `mt-1 text-sm text-gray-900 sm:mt-0 sm:col-span-3`.

## Mobile Responsiveness

- **General Principle**: We will take a mobile-first approach. All layouts should be fluid and readable on small screens by default, with more complex layouts introduced at larger breakpoints (`sm`, `md`, etc.).

- **Page Headers**:
  - The `flex justify-between items-center` layout used for headers should be responsive. On small screens, the title/description and the action buttons should stack.
  - Apply `flex-col space-y-4 sm:flex-row sm:space-y-0 sm:justify-between sm:items-center` to the flex container. This ensures content stacks vertically on mobile and moves to a horizontal layout on larger screens.

- **Tables**:
  - Complex data tables are not mobile-friendly. For any table, we must provide an alternative list or card-based view for mobile screens.
  - Use the responsive `hidden` utility: The `<table>` element should have `hidden md:block` and the mobile list view (e.g., a `<ul>`) should have `block md:hidden`. This shows the list on small/medium screens and the table on large screens.

- **Grids (Forms & Detail Views)**:
  - Multi-column grids must stack to a single column on mobile to ensure readability and usability.
  - The default state should be single-column (e.g., `grid-cols-1`). Breakpoints should be used to create multiple columns on larger screens (e.g., `sm:grid-cols-4`). This pattern is already in use for forms and should be maintained.

By following these guidelines, we can ensure all pages in the application have a unified and predictable layout across all device sizes. 
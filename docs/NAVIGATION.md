# Navigation System

This document outlines the primary navigation structure and styling for The Anchor - Management Tools application.

## Authenticated User Navigation (Sidebar)

- **Location:** The main sidebar navigation for logged-in users is implemented within the `src/app/(authenticated)/layout.tsx` file.
- **Component:** The list of navigation links is rendered by the `src/components/Navigation.tsx` component. It includes:
    - Primary Links: Dashboard, Events, Customers.
    - Secondary Links: Employees, Quick Add Note (opens a modal to add a note to an employee).
- **Styling:**
    - The sidebar background uses the application's `primary` color (`#005131` - green), defined in `tailwind.config.js` and applied as `bg-primary`.
    - Navigation links and the "Management Tools" title use `text-white` or light variants (`text-gray-100`, `text-green-200`) for readability against the green background.
    - Active navigation links are highlighted with a darker green background (`bg-green-700`).
    - Icons are from the `@heroicons/react` library.

## Button Styling

- **Primary Action Buttons:** A reusable button component is available at `src/components/ui/Button.tsx`.
- **Color:** The `primary` variant of this button (which is also the default) uses the application's `primary` color (`#005131` - green) for its background (`bg-primary`) with `text-white` for the text. This aligns with the main navigation's color scheme. The previous gold button style has been replaced.

## Mobile Navigation

- A `BottomNavigation` component (`src/components/BottomNavigation.tsx`) exists for mobile viewports (hidden on `md` and larger screens), providing quick access to main sections.
- **Links Included:** Dashboard, Events, Customers, Employees.
- **Actions Included:** Add Note (opens a modal to add a note to an employee).
- Its styling is currently distinct from the main sidebar (white background with blue/gray text).
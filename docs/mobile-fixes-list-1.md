# Mobile Fixes - List 1
**Focus: Core UI Components, Navigation, and Form Improvements**

This list focuses on foundational components and forms that are used throughout the application. Fixing these will have the broadest impact.

## 1. Core UI Components & Navigation (High Impact)

### Touch Target Fixes
- [ ] **Button Component** (`/src/components/ui/Button.tsx`)
  - Increase small variant padding to meet 44px minimum
  - Add responsive padding for all sizes
  - Enhance focus states for mobile

- [ ] **Navigation Components**
  - [ ] **BottomNavigation** (`/src/components/BottomNavigation.tsx`)
    - Add safe area support: `pb-safe` or `padding-bottom: env(safe-area-inset-bottom)`
    - Increase min-width from 80px to 90px
    - Add scroll indicators for overflow
    - Fix badge positioning overlap
  - [ ] **Navigation** (`/src/components/Navigation.tsx`)
    - Implement mobile hamburger menu
    - Increase touch targets for all nav items
    - Add mobile-specific navigation pattern

### Modal Improvements
- [ ] **Modal Component** (`/src/components/ui/Modal.tsx`)
  - Change fixed max-width to responsive: `max-w-full sm:max-w-md lg:max-w-2xl`
  - Adjust max-height for mobile: `max-h-[85vh]` with safe area support
  - Increase close button touch target
  - Add responsive padding

### Other Core Components
- [ ] **Tabs Component** (`/src/components/ui/Tabs.tsx`)
  - Change spacing from `space-x-8` to `space-x-4 sm:space-x-8`
  - Increase tab button padding for touch
  - Add visual indicators for scrollable tabs
  - Combine mobile/desktop implementations

- [ ] **Pagination** (`/src/components/Pagination.tsx`)
  - Increase page number button sizes to 44x44px
  - Add better touch-friendly spacing
  - Improve mobile layout with larger prev/next buttons

## 2. Form Components (Critical for User Input)

### Form Input Components
- [ ] **FormInput** (`/src/components/ui/FormInput.tsx`)
  - Increase padding to ensure 44px height
  - Ensure 16px minimum font size to prevent iOS zoom
  - Add proper input modes for different field types

- [ ] **FormSelect** (`/src/components/ui/FormSelect.tsx`)
  - Increase touch target size
  - Improve mobile dropdown behavior

- [ ] **FormTextarea** (`/src/components/ui/FormTextarea.tsx`)
  - Make rows responsive to viewport
  - Improve mobile resize behavior

### Complex Forms
- [ ] **CustomerForm** (`/src/components/CustomerForm.tsx`)
  - Fix text sizing consistency
  - Improve button layout for mobile
  - Add proper field spacing

- [ ] **EventFormSimple** (`/src/components/EventFormSimple.tsx`)
  - Increase all input padding (currently px-3 py-2)
  - Fix date/time input handling for mobile
  - Add progressive disclosure sections
  - Improve button area padding
  - Make form sections collapsible on mobile

- [ ] **BookingForm** (`/src/components/BookingForm.tsx`)
  - Fix modal height calculation for mobile keyboards
  - Add inputMode="numeric" for phone field
  - Simplify nested form structure
  - Fix button ordering for mobile

- [ ] **EmployeeForm** (`/src/components/EmployeeForm.tsx`)
  - Improve label/input stacking on mobile
  - Add field grouping for better organization
  - Optimize error message display
  - Make form sections collapsible

## 3. Table Responsiveness (Major UX Impact)

### Priority Table Conversions
- [ ] **Event List Table** (`/src/app/(authenticated)/events/page.tsx`)
  - Implement mobile card-based layout
  - Hide less important columns on mobile
  - Add responsive breakpoints

- [ ] **Customer List Table** (`/src/app/(authenticated)/customers/page.tsx`)
  - Consolidate duplicate desktop/mobile implementations
  - Improve mobile card layout
  - Fix touch targets in list items

- [ ] **Messages List** (`/src/app/(authenticated)/messages/page.tsx`)
  - Fix header button overflow
  - Optimize conversation list for mobile
  - Improve touch targets throughout

## 4. Image & Upload Components

- [ ] **Image Upload Components** (EventImageUpload, SquareImageUpload)
  - Optimize file input for touch
  - Make preview images responsive
  - Fix delete button positioning
  - Add better mobile upload flow

- [ ] **MessageThread** (`/src/components/MessageThread.tsx`)
  - Make height responsive: `h-[400px] md:h-[500px] max-h-[60vh]`
  - Add landscape orientation support
  - Improve scroll behavior

## 5. Dashboard & Data Display

- [ ] **Dashboard Page** (`/src/app/(authenticated)/dashboard/page.tsx`)
  - Fix icon touch targets (increase from 20px to 44px)
  - Add mobile touch feedback states
  - Fix grid stacking for quick actions
  - Improve text sizing for mobile

- [ ] **Dashboard Widgets** (`/src/components/dashboard/`)
  - Fix filter button wrapping
  - Handle text overflow properly
  - Make visualizations responsive
  - Add proper mobile breakpoints

## Estimated Effort: ~40-50 hours
This list focuses on high-impact, reusable components that will improve mobile experience across the entire application. Most changes involve CSS/Tailwind updates with some JavaScript modifications for behavior.
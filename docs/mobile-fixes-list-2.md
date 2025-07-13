# Mobile Fixes - List 2
**Focus: Module-Specific Pages, Complex Layouts, and Specialized Components**

This list focuses on specific module pages and complex layouts that require more specialized mobile solutions.

## 1. Complex Module Pages

### Private Bookings Module
- [ ] **Booking List** (`/src/app/(authenticated)/private-bookings/page.tsx`)
  - Fix header button stacking
  - Implement responsive table solution
  - Improve quick links grid for mobile

- [ ] **Booking Detail** (`/src/app/(authenticated)/private-bookings/[id]/page.tsx`)
  - Fix all modal widths for mobile
  - Simplify complex grid forms
  - Improve financial summary layout
  - Make 3-column layout responsive

- [ ] **New Booking** (`/src/app/(authenticated)/private-bookings/new/page.tsx`)
  - Fix 3-column time grid for mobile
  - Add better form section spacing
  - Implement progressive form navigation

- [ ] **CalendarView Component** (`/src/components/private-bookings/CalendarView.tsx`)
  - Implement mobile agenda/list view
  - Add swipe gestures
  - Make calendar cells tappable for details
  - Add mobile-specific controls

### Invoice Module
- [ ] **Invoice List** (`/src/app/(authenticated)/invoices/page.tsx`)
  - Implement responsive table with card view
  - Fix header button stacking
  - Improve filter controls for mobile

- [ ] **Invoice Detail** (`/src/app/(authenticated)/invoices/[id]/page.tsx`)
  - Fix action button overflow
  - Improve grid layout for mobile
  - Make line items table responsive
  - Optimize nested grids

- [ ] **New Invoice** (`/src/app/(authenticated)/invoices/new/page.tsx`)
  - Fix 12-column line item grid
  - Make input fields full-width on mobile
  - Fix catalog dropdown positioning
  - Improve form layout

- [ ] **Product Catalog** (`/src/app/(authenticated)/invoices/catalog/page.tsx`)
  - Make modal responsive
  - Improve table layout
  - Fix action button touch targets
  - Optimize form grid

## 2. Employee Module Pages

- [ ] **Employee Detail** (`/src/app/(authenticated)/employees/[employee_id]/page.tsx`)
  - Implement mobile-friendly tab navigation
  - Reduce information density
  - Improve grid layouts
  - Add collapsible sections

- [ ] **New/Edit Employee** (`/src/app/(authenticated)/employees/new/page.tsx`)
  - Break long form into steps
  - Add progress indicator
  - Fix checkbox touch targets
  - Add sticky save button

- [ ] **Employee Birthdays** (`/src/app/(authenticated)/employees/birthdays/page.tsx`)
  - Improve list density for mobile
  - Fix badge sizing
  - Optimize month headers
  - Better horizontal layout handling

## 3. Loyalty Module

- [ ] **Check-in Page** (`/src/app/(authenticated)/loyalty/check-in/page.tsx`)
  - Fix 3-column method selection grid
  - Simplify search results display
  - Add mobile QR scanner constraints
  - Optimize success state display

- [ ] **Admin Dashboard** (`/src/app/(authenticated)/loyalty/admin/page.tsx`)
  - Fix header action overflow
  - Improve stats card layout
  - Make charts mobile-friendly
  - Fix quick action cards

- [ ] **Rewards Page** (`/src/app/(authenticated)/loyalty/admin/rewards/page.tsx`)
  - Stack filter controls vertically
  - Improve summary stats display
  - Fix reward card touch targets
  - Make modal responsive

- [ ] **Analytics Page** (`/src/app/(authenticated)/loyalty/analytics/page.tsx`)
  - Make date selector mobile-friendly
  - Simplify metrics display
  - Convert tables to cards
  - Optimize data visualizations

- [ ] **Redemption Terminal** (`/src/app/(authenticated)/loyalty/redeem/page.tsx`)
  - Optimize for one-handed use
  - Fix large text overflow
  - Improve grid stacking
  - Add mobile QR optimization

## 4. Settings & Admin Pages

- [ ] **Settings Pages** (Various in `/src/app/(authenticated)/settings/`)
  - Implement responsive tables across all settings
  - Fix filter interfaces
  - Improve modal sizing
  - Add mobile breakpoints for stats

- [ ] **Business Hours** (`/src/app/(authenticated)/settings/business-hours/page.tsx`)
  - Make time input table responsive
  - Stack table rows on mobile
  - Improve input field sizing

- [ ] **SMS Health** (`/src/app/(authenticated)/settings/sms-health/page.tsx`)
  - Fix stats grid for mobile
  - Make filter buttons wrap properly
  - Implement responsive table

- [ ] **Message Templates** (`/src/app/(authenticated)/settings/message-templates/page.tsx`)
  - Make modal responsive
  - Fix variable button overflow
  - Adapt preview for mobile

## 5. Public & Auth Pages

- [ ] **Login Page** (`/src/app/auth/login/page.tsx`)
  - Increase input padding for 44px height
  - Fix button padding consistency
  - Ensure proper text sizing

- [ ] **Reset Password** (`/src/app/auth/reset-password/page.tsx`)
  - Fix button padding
  - Ensure inputs don't trigger zoom

- [ ] **Loyalty Portal** (`/src/app/loyalty/portal/page.tsx`)
  - Fix tab overflow with scroll
  - Make points grid responsive
  - Increase redeem button size
  - Handle long customer names

- [ ] **Privacy Policy** (`/src/app/privacy/page.tsx`)
  - Increase mobile padding
  - Add grid spacing
  - Optimize text width

## 6. Specialized Components

- [ ] **CustomerSearchInput** (`/src/components/CustomerSearchInput.tsx`)
  - Fix dropdown positioning
  - Increase result touch targets
  - Handle phone number overflow
  - Optimize debounce for mobile

- [ ] **List Components** (EmployeeAttachmentsList, EmployeeNotesList)
  - Space action buttons properly
  - Handle file name overflow
  - Optimize modals for mobile
  - Fix timeline visualization

- [ ] **Quote Pages** (`/src/app/(authenticated)/quotes/`)
  - Apply similar fixes as Invoice pages
  - Fix table responsiveness
  - Improve form layouts
  - Optimize button placement

## Estimated Effort: ~40-50 hours
This list focuses on module-specific implementations and complex layout challenges. Many changes require creating new mobile-specific views or significantly restructuring existing layouts.
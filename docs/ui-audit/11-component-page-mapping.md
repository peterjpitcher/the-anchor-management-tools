# Component to Page Mapping

## Overview
This document maps all 75+ proposed components to the 107 pages where they'll be implemented, ensuring complete coverage during migration.

## Component Categories

### Core Layout Components (Used on almost every page)

#### 1. **Page Component** - 105/107 pages
Used on all authenticated pages except:
- `/login` - Uses different layout
- `/booking-confirmation/[token]` - Public page with minimal layout

#### 2. **Card Component** - 95/107 pages
High usage across all modules for content containers

#### 3. **Container Component** - 107/107 pages
Universal usage for responsive width management

#### 4. **Section Component** - 89/107 pages
Used on all pages with forms or grouped content

### Navigation Components

#### 5. **BackButton Component** - 72/107 pages
Used on all detail/edit/new pages:
- All `[id]` routes
- All `/new` routes
- All `/edit` routes
- Settings subpages

#### 6. **Breadcrumbs Component** - 45/107 pages
Needed on deeper navigation pages:
- Invoice pages (7 pages)
- Quote pages (5 pages)
- Private booking subpages (8 pages)
- Employee subpages (5 pages)
- Settings subpages (20 pages)

#### 7. **TabNav Component** - 23/107 pages
- Employee edit pages
- Customer detail pages
- Private booking detail pages
- Loyalty admin pages
- Settings pages with subsections

### Form Components (Critical for consistency)

#### 8. **Input Component** - 78/107 pages
All pages with forms:
- All `/new` pages (15)
- All `/edit` pages (12)
- All search pages (8)
- Settings pages (20)
- Profile pages (2)
- Login/auth pages (3)
- Table booking pages (8)
- Others (10)

#### 9. **Select Component** - 65/107 pages
Pages with dropdowns:
- Event forms (category, status)
- Employee forms (role, department)
- Booking forms (time slots, spaces)
- Filter interfaces
- Settings pages

#### 10. **Textarea Component** - 42/107 pages
Pages with multi-line input:
- Event descriptions
- Private booking notes
- Message composition
- Invoice/quote items
- Customer notes

#### 11. **Checkbox Component** - 38/107 pages
- Settings pages (toggles)
- Bulk selection pages
- Filter options
- Permission controls
- Feature flags

#### 12. **Radio Component** - 25/107 pages
- Payment method selection
- Booking type selection
- Report options
- Export formats
- View preferences

#### 13. **DateTimePicker Component** - 45/107 pages
Critical component for:
- Event scheduling (6 pages)
- Private bookings (8 pages)
- Table bookings (6 pages)
- Employee records (4 pages)
- Reports/filters (10 pages)
- Others (11 pages)

#### 14. **FormGroup Component** - 78/107 pages
Wrapper for all form fields (same as Input usage)

#### 15. **Form Component** - 78/107 pages
Form wrapper with validation

### Data Display Components

#### 16. **DataTable Component** - 42/107 pages
List/table views:
- `/events` 
- `/customers`
- `/employees`
- `/messages`
- `/invoices` + `/quotes`
- `/private-bookings`
- `/table-bookings`
- All admin lists
- Report pages

#### 17. **EmptyState Component** - 42/107 pages
All pages with DataTable need empty states

#### 18. **Pagination Component** - 42/107 pages
All pages with DataTable need pagination

#### 19. **Badge Component** - 55/107 pages
Status displays:
- Event status
- Booking status
- Employee status
- Message read/unread
- Counts on tabs
- Feature flags

#### 20. **Stat Component** - 15/107 pages
- Dashboard (main)
- Analytics pages
- Report summaries
- Loyalty analytics
- Business metrics

### Feedback Components

#### 21. **Alert Component** - 89/107 pages
Error/success messages on:
- All form pages
- All action pages
- Settings pages
- Import/export pages

#### 22. **Toast Component** - 107/107 pages
Global notifications (every page needs this)

#### 23. **Skeleton Component** - 95/107 pages
Loading states (all pages except static)

#### 24. **Spinner Component** - 95/107 pages
Loading indicators (all dynamic pages)

#### 25. **ProgressBar Component** - 18/107 pages
- File uploads
- Import processes
- Bulk operations
- Long-running tasks

### Overlay Components

#### 26. **Modal Component** - 67/107 pages
Dialogs for:
- Confirmations
- Quick forms
- Detail views
- Image previews
- Help content

#### 27. **Drawer Component** - 35/107 pages
Mobile navigation and filters:
- Mobile menu (all pages)
- Filter panels
- Settings panels
- Quick actions

#### 28. **Popover Component** - 28/107 pages
- User menu
- Notification center
- Quick actions
- Info tooltips
- Date picker calendar

#### 29. **Tooltip Component** - 85/107 pages
Help text and hints throughout

### File Management Components

#### 30. **FileUpload Component** - 22/107 pages
- Employee attachments (5 pages)
- Event images (3 pages)
- Customer documents (2 pages)
- Import pages (6 pages)
- Settings (6 pages)

#### 31. **FileList Component** - 15/107 pages
- Employee detail page
- Employee edit page
- Document management pages
- Export history pages

#### 32. **ImageEditor Component** - 8/107 pages
- Event image upload
- Employee photos
- Venue images
- Marketing materials

### Search & Filter Components

#### 33. **SearchInput Component** - 35/107 pages
- All main list pages
- Customer search
- Employee search
- Event search
- Message search
- Global search (header)

#### 34. **FilterPanel Component** - 28/107 pages
- Event filters
- Booking filters
- Report filters
- Analytics filters
- Transaction filters

#### 35. **SearchResults Component** - 35/107 pages
Paired with SearchInput usage

### Permission Components

#### 36. **PermissionGate Component** - 95/107 pages
All authenticated pages need permission checks

#### 37. **UnauthorizedMessage Component** - 95/107 pages
Fallback for PermissionGate

### Mobile-Specific Components

#### 38. **MobileDrawer Component** - 107/107 pages
Global mobile navigation

#### 39. **TouchList Component** - 25/107 pages
Mobile-optimized lists:
- Customer list
- Message list
- Booking list
- Event list
- Quick actions

#### 40. **MobileActionSheet Component** - 42/107 pages
Mobile context menus on all list pages

### Real-time Components

#### 41. **RealtimeIndicator Component** - 12/107 pages
- Dashboard
- Messages
- Live bookings
- Analytics
- Active events

#### 42. **OptimisticUpdate Component** - 35/107 pages
All pages with inline editing

### Specialized Display Components

#### 43. **Timeline Component** - 8/107 pages
- Event timeline
- Booking timeline
- Customer history
- Audit logs
- Activity feeds

#### 44. **Calendar Component** - 12/107 pages
- Event calendar
- Private booking calendar
- Table booking calendar
- Employee schedules
- Business hours

#### 45. **DataGrid Component** - 15/107 pages
Advanced tables:
- Financial reports
- Analytics
- Inventory
- Complex schedules

#### 46. **VirtualList Component** - 8/107 pages
Large lists:
- Message history
- Audit logs
- Transaction logs
- Customer lists (1000+)

### Utility Components

#### 47. **CopyToClipboard Component** - 22/107 pages
- Booking references
- API keys
- Share links
- Phone numbers
- Email addresses

#### 48. **KeyboardShortcut Component** - 107/107 pages
Global keyboard navigation

#### 49. **InfiniteScroll Component** - 18/107 pages
- Message lists
- Activity feeds
- Audit logs
- Large reports

#### 50. **ConfirmDialog Component** - 78/107 pages
All pages with delete/destructive actions

## Page-by-Page Component Requirements

### Dashboard (`/dashboard`)
- Page, Container, Card (x6)
- Stat (x4), Badge (x3)
- RealtimeIndicator
- Timeline, Calendar preview
- SearchInput (global)
- EmptyState (for widgets)
- Skeleton, Spinner

### Events Module (12 pages)

#### `/events` (List)
- Page, Container, Card
- DataTable, Pagination, EmptyState
- SearchInput, FilterPanel
- Badge (status), Button
- Toast, Alert, Skeleton

#### `/events/new` (Create)
- Page, Container, Card, Section (x4)
- Form, FormGroup (x8)
- Input (x6), Select (x3), Textarea (x2)
- DateTimePicker (x2)
- FileUpload (image)
- Button (x2), BackButton
- Alert, Toast, Spinner

#### `/events/[id]` (Detail)
- Page, Container, Card (x5)
- Badge (status), Button (x4)
- DataTable (bookings)
- Timeline (activity)
- CopyToClipboard (x2)
- Modal (x2), ConfirmDialog
- BackButton, Breadcrumbs

#### `/events/[id]/edit` (Edit)
- Same as `/events/new` plus:
- BackButton, Breadcrumbs
- ConfirmDialog (for changes)

### Customers Module (2 pages)

#### `/customers` (List)
- Page, Container, Card
- DataTable, Pagination, EmptyState
- SearchInput, FilterPanel
- Badge (x2), Button (x3)
- Modal (quick view)
- Toast, Alert, Skeleton

#### `/customers/[id]` (Detail)
- Page, Container, Card (x6)
- TabNav (x4 tabs)
- DataTable (x3 - bookings, messages, transactions)
- Timeline (activity)
- Badge (x3), Button (x5)
- Modal (x3), ConfirmDialog
- BackButton

### Employees Module (8 pages)

#### `/employees` (List)
- Page, Container, Card
- DataTable, Pagination, EmptyState
- SearchInput, FilterPanel (x2)
- Badge (status), Avatar
- Button (x4), ExportButton
- Modal, Toast, Skeleton

#### `/employees/new` (Create)
- Page, Container, Card
- TabNav (x3 tabs)
- Form, FormGroup (x12)
- Input (x8), Select (x4)
- DateTimePicker (x3)
- FileUpload (documents)
- BackButton, Alert

#### `/employees/[id]` (Detail)
- Page, Container, Card (x8)
- TabNav (x5 tabs)
- FileList, DataTable (x2)
- Badge (x3), Avatar
- Timeline, Button (x6)
- Modal (x4), ConfirmDialog
- BackButton, Breadcrumbs

### Table Bookings Module (14 pages)

#### `/table-bookings` (List)
- Page, Container, Card
- DataTable, Pagination, EmptyState
- SearchInput, FilterPanel
- Badge (x2), Button (x4)
- DateTimePicker (filter)
- Modal (x2), Toast

#### `/table-bookings/new` (Create)
- Page, Container, Card, Section (x5)
- Form, FormGroup (x10)
- Input (x6), Select (x4)
- DateTimePicker (x2)
- Checkbox (x3)
- Alert, Toast, Spinner
- BackButton

#### `/table-bookings/calendar` (Calendar View)
- Page, Container, Card
- Calendar (full page)
- FilterPanel, DateTimePicker
- Badge (x3), Legend
- Modal (x2), Drawer (mobile)
- TouchList (mobile)

### Private Bookings Module (15 pages)

#### `/private-bookings` (List)
- Page, Container, Card
- DataTable, Pagination, EmptyState
- SearchInput, FilterPanel (x3)
- Badge (x3), Button (x4)
- DateRangePicker
- Modal, Toast, Skeleton

#### `/private-bookings/new` (Create)
- Page, Container, Card, Section (x6)
- Form, FormGroup (x15)
- Input (x10), Select (x5)
- Textarea (x4), Checkbox (x2)
- DateTimePicker (x3)
- CustomerSearch (autocomplete)
- Alert, Toast, Spinner
- BackButton

#### `/private-bookings/[id]` (Detail)
- Page, Container, Card (x10)
- TabNav (x6 tabs)
- DataTable (x3), Timeline
- Badge (x5), Button (x8)
- FileList, ProgressBar
- Modal (x5), ConfirmDialog (x3)
- BackButton, Breadcrumbs

### Settings Module (25+ pages)

#### `/settings` (Main)
- Page, Container, Card (grid)
- Button (x20+), Icon (x20+)
- SearchInput (settings search)

#### `/settings/business-hours`
- Page, Container, Card (x7)
- Form, FormGroup (x14)
- Select (x14), Input (x14)
- Toggle/Checkbox (x7)
- Button (x3), BackButton
- Alert, Toast

#### `/settings/api-keys`
- Page, Container, Card
- DataTable, EmptyState
- Button (x3), Badge
- CopyToClipboard (x2)
- Modal (create key)
- ConfirmDialog (revoke)
- BackButton

### Messages Module (2 pages)

#### `/messages`
- Page, Container, Card
- VirtualList, EmptyState
- Badge (unread), Avatar
- RealtimeIndicator
- InfiniteScroll
- SearchInput, FilterPanel

#### `/messages/bulk`
- Page, Container, Card, Section (x3)
- Form, FormGroup (x5)
- Textarea (message), Select (x3)
- CustomerMultiSelect
- ProgressBar, Alert
- Button (x3), BackButton

### Invoices/Quotes Modules (16 pages total)
Similar patterns to Private Bookings with:
- Heavy Form usage
- DataTable for line items
- PDF preview/generation
- Payment processing UI
- Export capabilities

### Loyalty Module (15 pages)
Unique components:
- QR code scanner
- Point calculator
- Achievement badges
- Leaderboards
- Campaign builder

### Auth Pages (4 pages)

#### `/login`
- Container, Card
- Form, FormGroup (x2)
- Input (x2)
- Button, Link
- Alert, Toast

#### `/auth/reset-password`
- Container, Card
- Form, FormGroup (x2)
- Input (x2)
- Button, BackButton
- Alert, ProgressSteps

### Public Pages (6 pages)
Minimal component usage:
- Container, Card
- Basic forms
- Public-facing styles

## Migration Priority Based on Usage

### Top 10 Most Used Components
1. **Container** - 107 pages (100%)
2. **Page** - 105 pages (98%)
3. **Toast** - 107 pages (100%)
4. **Card** - 95 pages (89%)
5. **Button** - 95 pages (89%)
6. **Skeleton** - 95 pages (89%)
7. **PermissionGate** - 95 pages (89%)
8. **Section** - 89 pages (83%)
9. **Alert** - 89 pages (83%)
10. **Tooltip** - 85 pages (79%)

### High-Impact Pages (Most Components)
1. **Private Bookings Detail** - 45+ components
2. **Employee Edit** - 40+ components
3. **Events New/Edit** - 38+ components
4. **Table Bookings New** - 35+ components
5. **Dashboard** - 30+ components

## Component Development Order

Based on usage analysis, build components in this order:

### Week 1-2: Foundation (10 components)
1. Container (107 pages)
2. Page (105 pages)
3. Card (95 pages)
4. Button (enhance existing)
5. Section (89 pages)
6. Alert (89 pages)
7. Form (78 pages)
8. FormGroup (78 pages)
9. Input (78 pages)
10. Toast (wrapper)

### Week 3-4: Core Features (15 components)
11. DataTable (42 pages)
12. EmptyState (42 pages)
13. Pagination (42 pages)
14. Select (65 pages)
15. DateTimePicker (45 pages)
16. Modal (enhance existing)
17. BackButton (72 pages)
18. SearchInput (35 pages)
19. Badge (55 pages)
20. Skeleton (95 pages)
21. Spinner (95 pages)
22. Textarea (42 pages)
23. FilterPanel (28 pages)
24. Breadcrumbs (45 pages)
25. TabNav (23 pages)

### Week 5-6: Enhanced Features (20 components)
26-45. [Additional components based on module needs]

### Week 7-8: Specialized (20 components)
46-65. [Domain-specific components]

### Week 9-10: Polish (10 components)
66-75. [Final utility components]

## Validation Checklist

Before marking a page as complete:
- [ ] All required components implemented
- [ ] No inline styles remaining
- [ ] Responsive design verified
- [ ] Accessibility tested
- [ ] Loading states present
- [ ] Error handling complete
- [ ] Permissions checked
- [ ] Mobile experience optimized
- [ ] Performance validated
- [ ] Documentation updated

## Notes

1. Some components like `Container` and `Toast` should be implemented at the app level, not per-page
2. Many components can be built incrementally (basic version first, enhance later)
3. Focus on high-usage components first for maximum impact
4. Some pages may need custom components not listed here
5. Component counts are estimates based on current implementation

This mapping ensures no page is forgotten during migration and provides clear priorities for component development based on actual usage needs.
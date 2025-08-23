# UI Files for Standards Review

This document contains a comprehensive list of all UI files that need to be reviewed for UI standards compliance in the Anchor Management Tools application.

## Authenticated Pages

### Dashboard
- `/src/app/(authenticated)/dashboard/page.tsx` - Main dashboard (optimized version)
- `/src/app/(authenticated)/dashboard/page-complex.tsx` - Complex dashboard version
- `/src/app/(authenticated)/dashboard/page-original.tsx` - Original dashboard version
- `/src/app/(authenticated)/dashboard/page-slow.tsx` - Slow dashboard version

### Customers
- `/src/app/(authenticated)/customers/page.tsx` - Customer list page
- `/src/app/(authenticated)/customers/[id]/page.tsx` - Customer detail page

### Events
- `/src/app/(authenticated)/events/page.tsx` - Event list page
- `/src/app/(authenticated)/events/new/page.tsx` - Create event page
- `/src/app/(authenticated)/events/[id]/page.tsx` - Event detail page
- `/src/app/(authenticated)/events/[id]/edit/page.tsx` - Edit event page

### Employees
- `/src/app/(authenticated)/employees/page.tsx` - Employee list page
- `/src/app/(authenticated)/employees/new/page.tsx` - Create employee page
- `/src/app/(authenticated)/employees/[employee_id]/page.tsx` - Employee detail page
- `/src/app/(authenticated)/employees/[employee_id]/edit/page.tsx` - Edit employee page

### Private Bookings
- `/src/app/(authenticated)/private-bookings/page.tsx` - Private bookings list
- `/src/app/(authenticated)/private-bookings/new/page.tsx` - Create private booking
- `/src/app/(authenticated)/private-bookings/[id]/page.tsx` - Booking detail page
- `/src/app/(authenticated)/private-bookings/[id]/edit/page.tsx` - Edit booking page
- `/src/app/(authenticated)/private-bookings/[id]/contract/page.tsx` - Contract page
- `/src/app/(authenticated)/private-bookings/[id]/items/page.tsx` - Booking items page
- `/src/app/(authenticated)/private-bookings/[id]/messages/page.tsx` - Booking messages
- `/src/app/(authenticated)/private-bookings/calendar/page.tsx` - Calendar view
- `/src/app/(authenticated)/private-bookings/sms-queue/page.tsx` - SMS queue page

### Private Booking Settings
- `/src/app/(authenticated)/private-bookings/settings/catering/page.tsx` - Catering settings
- `/src/app/(authenticated)/private-bookings/settings/spaces/page.tsx` - Venue spaces settings
- `/src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` - Vendors settings

### Messages
- `/src/app/(authenticated)/messages/page.tsx` - Messages page
- `/src/app/(authenticated)/messages/bulk/page.tsx` - Bulk messaging page

### Users & Roles
- `/src/app/(authenticated)/users/page.tsx` - Users list page
- `/src/app/(authenticated)/roles/page.tsx` - Roles list page
- `/src/app/(authenticated)/roles/new/page.tsx` - Create role page

### Profile
- `/src/app/(authenticated)/profile/page.tsx` - User profile page
- `/src/app/(authenticated)/profile/change-password/page.tsx` - Change password page

### Settings
- `/src/app/(authenticated)/settings/page.tsx` - Main settings page
- `/src/app/(authenticated)/settings/api-keys/page.tsx` - API keys management
- `/src/app/(authenticated)/settings/audit-logs/page.tsx` - Audit logs viewer
- `/src/app/(authenticated)/settings/background-jobs/page.tsx` - Background jobs monitor
- `/src/app/(authenticated)/settings/business-hours/page.tsx` - Business hours settings
- `/src/app/(authenticated)/settings/calendar-test/page.tsx` - Calendar test page
- `/src/app/(authenticated)/settings/categories/page.tsx` - Categories management
- `/src/app/(authenticated)/settings/event-categories/page.tsx` - Event categories
- `/src/app/(authenticated)/settings/fix-phone-numbers/page.tsx` - Phone number fix utility
- `/src/app/(authenticated)/settings/gdpr/page.tsx` - GDPR settings
- `/src/app/(authenticated)/settings/import-messages/page.tsx` - Import messages
- `/src/app/(authenticated)/settings/message-templates/page.tsx` - Message templates
- `/src/app/(authenticated)/settings/sms-delivery/page.tsx` - SMS delivery settings
- `/src/app/(authenticated)/settings/sms-health/page.tsx` - SMS health monitor
- `/src/app/(authenticated)/settings/webhook-diagnostics/page.tsx` - Webhook diagnostics
- `/src/app/(authenticated)/settings/webhook-monitor/page.tsx` - Webhook monitor
- `/src/app/(authenticated)/settings/webhook-test/page.tsx` - Webhook testing

### Other Authenticated Pages
- `/src/app/(authenticated)/unauthorized/page.tsx` - Unauthorized access page
- `/src/app/(authenticated)/layout.tsx` - Authenticated layout wrapper

## Public Pages

### Authentication
- `/src/app/auth/login/page.tsx` - Login page
- `/src/app/auth/signup/page.tsx` - Signup page
- `/src/app/login/page.tsx` - Alternative login page

### Other Public Pages
- `/src/app/page.tsx` - Landing/home page
- `/src/app/privacy/page.tsx` - Privacy policy page
- `/src/app/global-error.tsx` - Global error page
- `/src/app/layout.tsx` - Root layout

## Components

### Forms
- `/src/components/CustomerForm.tsx` - Customer form component
- `/src/components/EmployeeForm.tsx` - Employee form component
- `/src/components/BookingForm.tsx` - Booking form component
- `/src/components/EventCategoryForm.tsx` - Event category form
- `/src/components/EventCategoryFormSimple.tsx` - Simple event category form
- `/src/components/EventFormSimple.tsx` - Simple event form
- `/src/components/FinancialDetailsForm.tsx` - Financial details form
- `/src/components/HealthRecordsForm.tsx` - Health records form
- `/src/components/AddEmployeeAttachmentForm.tsx` - Employee attachment form
- `/src/components/AddEmployeeNoteForm.tsx` - Employee note form

### Modals
- `/src/components/modals/AddNoteModal.tsx` - Add note modal
- `/src/components/modals/AddEmergencyContactModal.tsx` - Emergency contact modal
- `/src/components/AddAttendeesModal.tsx` - Add attendees modal
- `/src/components/AddAttendeesModalWithCategories.tsx` - Add attendees with categories

### Navigation
- `/src/components/Navigation.tsx` - Main navigation component
- `/src/components/BottomNavigation.tsx` - Mobile bottom navigation

### Dashboard Components
- `/src/components/dashboard/StatsCard.tsx` - Statistics card
- `/src/components/dashboard/AuditTrailWidget.tsx` - Audit trail widget
- `/src/components/dashboard/CategoryAnalyticsWidget.tsx` - Category analytics
- `/src/components/dashboard/EmployeeActivityWidget.tsx` - Employee activity
- `/src/components/dashboard/EnhancedActivityFeed.tsx` - Enhanced activity feed
- `/src/components/dashboard/MessageTemplatesWidget.tsx` - Message templates
- `/src/components/dashboard/SmsHealthWidget.tsx` - SMS health monitor

### Private Booking Components
- `/src/components/private-bookings/CalendarView.tsx` - Calendar view component
- `/src/components/private-bookings/DeleteBookingButton.tsx` - Delete booking button

### Employee Components
- `/src/components/EmployeeAttachmentsList.tsx` - Employee attachments list
- `/src/components/EmployeeNotesList.tsx` - Employee notes list
- `/src/components/EmployeeRecentChanges.tsx` - Recent changes display
- `/src/components/EmployeeVersionHistory.tsx` - Version history display

### Customer Components
- `/src/components/CustomerImport.tsx` - Customer import utility
- `/src/components/CustomerName.tsx` - Customer name display
- `/src/components/CustomerSearchInput.tsx` - Customer search input
- `/src/components/CustomerCategoryPreferences.tsx` - Category preferences
- `/src/components/CategoryCustomerSuggestions.tsx` - Customer suggestions

### Role/User Components
- `/src/app/(authenticated)/roles/components/RoleList.tsx` - Role list component
- `/src/app/(authenticated)/roles/components/RoleForm.tsx` - Role form component
- `/src/app/(authenticated)/roles/components/RoleCard.tsx` - Role card component
- `/src/app/(authenticated)/roles/components/RolePermissionsModal.tsx` - Permissions modal
- `/src/app/(authenticated)/users/components/UserList.tsx` - User list component
- `/src/app/(authenticated)/users/components/UserRolesModal.tsx` - User roles modal

### Settings Components
- `/src/app/(authenticated)/settings/api-keys/ApiKeysManager.tsx` - API keys manager
- `/src/app/(authenticated)/settings/business-hours/BusinessHoursManager.tsx` - Business hours
- `/src/app/(authenticated)/settings/business-hours/SpecialHoursManager.tsx` - Special hours

### Image/Upload Components
- `/src/components/EventImageUpload.tsx` - Event image upload
- `/src/components/EventImageUploadFixed.tsx` - Fixed event image upload
- `/src/components/EventImageGallery.tsx` - Event image gallery
- `/src/components/SquareImageUpload.tsx` - Square image upload

### Tab Components
- `/src/components/ui/Tabs.tsx` - Tab component
- `/src/components/FinancialDetailsTab.tsx` - Financial details tab
- `/src/components/HealthRecordsTab.tsx` - Health records tab
- `/src/components/EmergencyContactsTab.tsx` - Emergency contacts tab

### Delete/Action Components
- `/src/components/DeleteEmployeeButton.tsx` - Delete employee button
- `/src/components/VenueSpaceDeleteButton.tsx` - Delete venue space button
- `/src/components/CateringPackageDeleteButton.tsx` - Delete catering package
- `/src/components/VendorDeleteButton.tsx` - Delete vendor button

### Other UI Components
- `/src/components/ui/Button.tsx` - Button component
- `/src/components/ui/SkeletonLoader.tsx` - Skeleton loader
- `/src/components/Pagination.tsx` - Pagination component
- `/src/components/MessageThread.tsx` - Message thread display
- `/src/components/EventTemplateManager.tsx` - Event template manager

### Context Providers
- `/src/components/providers/SupabaseProvider.tsx` - Supabase provider
- `/src/contexts/PermissionContext.tsx` - Permission context

## Summary

Total files to review: **135 files**

### By Category:
- **Pages**: 64 files (including authenticated and public pages)
- **Components**: 71 files (forms, modals, UI components, etc.)

### Priority Areas:
1. **High Traffic Pages**: Dashboard, Events, Customers, Private Bookings
2. **Forms**: All form components for data input
3. **Settings Pages**: All settings and configuration pages
4. **Public Pages**: Login, signup, and landing pages
5. **Components**: Reusable UI components that appear across multiple pages

### Review Focus:
- Consistent styling and spacing
- Proper error handling and loading states
- Mobile responsiveness
- Accessibility standards
- User feedback mechanisms
- Form validation displays
- Navigation consistency
- Button and action consistency
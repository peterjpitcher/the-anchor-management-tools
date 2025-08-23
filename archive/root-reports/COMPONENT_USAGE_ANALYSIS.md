# Component Usage Analysis - Anchor Management Tools

## Executive Summary

The application shows significant opportunities for better component reuse and standardization. While there's a good foundation of UI components, many pages implement similar patterns inline rather than using existing components. The table-bookings module in particular has minimal component usage, relying heavily on inline implementations.

## Component Usage by Module

### 1. Events Module (`/events`)
**High Component Usage**
- Uses specialized components: `EventFormGrouped`, `BookingForm`, `AddAttendeesModalWithCategories`, `EventTemplateManager`
- UI components: `Button`, `LoadingSpinner`
- Icon libraries: Heroicons extensively used
- Well-componentized with good separation of concerns

### 2. Employees Module (`/employees`)
**Very High Component Usage**
- Most componentized module in the application
- Specialized components: `EmployeeForm`, `EmployeeNotesList`, `EmployeeAttachmentsList`, `DeleteEmployeeButton`, `EmployeeAuditTrail`, `EmployeeRecentChanges`
- Tab components: `EmergencyContactsTab`, `FinancialDetailsTab`, `HealthRecordsTab`, `RightToWorkTab`, `OnboardingChecklistTab`
- UI components: `Badge`, `Pagination`, `Tabs`, `PageLoadingSkeleton`
- Uses both Heroicons and Lucide icons

### 3. Private Bookings Module (`/private-bookings`)
**Moderate Component Usage**
- Specialized components: `DeleteBookingButton`, `CalendarView`, `CustomerSearchInput`
- Delete buttons: `VendorDeleteButton`, `CateringPackageDeleteButton`, `VenueSpaceDeleteButton`
- Limited use of UI components
- Heavy reliance on inline styled elements

### 4. Table Bookings Module (`/table-bookings`)
**Very Low Component Usage**
- Almost no component imports beyond `SupabaseProvider` and `Loader2`
- Extensive inline implementation of forms, tables, and UI elements
- No use of existing UI components like `Button`, `Modal`, `FormInput`
- All styling done inline with Tailwind classes
- Major opportunity for componentization

### 5. Customers Module (`/customers`)
**High Component Usage**
- Specialized components: `CustomerForm`, `CustomerImport`, `CustomerName`, `CustomerLabelDisplay`, `CustomerLabelSelector`, `CustomerCategoryPreferences`, `CustomerLoyaltyCard`
- UI components: `Button`, `Pagination`, `PageLoadingSkeleton`
- Shared components: `BookingForm`, `MessageThread`
- Good balance of specialized and generic components

### 6. Settings Module (`/settings`)
**Moderate Component Usage**
- UI components: `Button`, `Modal`, `FormInput`, `FormSelect`, `LineChart`, `LoadingSpinner`
- Some specialized components: `BusinessHoursManager`, `SpecialHoursManager`, `ApiKeysManager`
- Many settings pages implement forms inline
- Mixed use of Heroicons and Lucide icons

### 7. Dashboard Module
**Minimal Component Usage**
- No component imports in main `page.tsx`
- All UI implemented inline
- Dashboard widgets exist in `/components/dashboard/` but are not used

## Component Inventory

### Most Used Components
1. **SupabaseProvider** - Used in nearly every client component
2. **Button** - Used in 15+ files
3. **Loader2** (Lucide) - Used extensively for loading states
4. **Pagination** - Used in list views
5. **Badge** - Used for status indicators
6. **Modal** - Used in several modules
7. **Tabs** - Used primarily in employee module

### Underutilized Components
1. **FormInput/FormSelect/FormTextarea** - Only used in a few places despite many forms
2. **LoadingSpinner** - Often replaced with inline Loader2
3. **SkeletonLoader** - Only used in 2-3 places
4. **ListItem** - Not used at all
5. **StatusIndicator** - Not used despite many status displays
6. **DataTable** - Not found in usage despite being referenced
7. **Dashboard components** - StatsCard, widgets not used in main dashboard

### Icon Usage
- **Heroicons**: Primary icon library, used extensively
- **Lucide React**: Secondary, mainly for Loader2 and some specific icons
- Mixed usage creates inconsistency

## Repeated Patterns Not Componentized

### 1. Card/Container Pattern
Found 140+ instances of inline card styling:
```jsx
<div className="bg-white shadow rounded-lg p-6">
```
Should be a `Card` component.

### 2. Page Headers
Every page implements its own header with back button:
```jsx
<div className="mb-6">
  <Link href="/back" className="flex items-center text-blue-600">
    <ArrowLeftIcon className="h-5 w-5 mr-2" />
    Back
  </Link>
  <h1 className="text-2xl font-semibold">Title</h1>
</div>
```
Should be a `PageHeader` component.

### 3. Form Sections
Repeated pattern for form sections:
```jsx
<div className="space-y-4">
  <h3 className="text-lg font-medium">Section Title</h3>
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
    {/* form fields */}
  </div>
</div>
```

### 4. Data Tables
Table bookings module has 10+ inline table implementations that could use a shared `DataTable` component.

### 5. Empty States
Repeated pattern:
```jsx
<div className="text-center py-12 text-gray-500">
  No items found
</div>
```

### 6. Error States
Inline error handling repeated across modules:
```jsx
{error && (
  <div className="bg-red-50 border border-red-400 text-red-700 px-4 py-3 rounded">
    {error}
  </div>
)}
```

### 7. Success Messages
Similar to errors, success messages are implemented inline repeatedly.

## Recommendations

### Immediate Actions
1. **Create Core Layout Components**:
   - `Card` - For consistent container styling
   - `PageHeader` - With optional back button
   - `EmptyState` - For no data scenarios
   - `ErrorAlert` & `SuccessAlert` - For feedback messages

2. **Standardize Icon Usage**:
   - Choose either Heroicons or Lucide as primary
   - Create an icon mapping for consistency

3. **Refactor Table Bookings Module**:
   - Extract repeated table implementations to use DataTable
   - Use existing form components instead of inline forms
   - Implement consistent styling with Card components

### Medium-term Improvements
1. **Create Specialized Components**:
   - `PhoneNumberInput` - For consistent phone formatting
   - `DateTimePicker` - For event scheduling
   - `PriceInput` - For financial data entry
   - `SearchBar` - For consistent search UI

2. **Enhance Existing Components**:
   - Add loading and error states to all data components
   - Create compound components (e.g., `Card.Header`, `Card.Body`)
   - Add TypeScript props documentation

3. **Module-Specific Libraries**:
   - Create component libraries for each major module
   - Share common patterns while allowing specialization

### Long-term Vision
1. **Component Documentation**:
   - Create a Storybook or similar documentation
   - Document all component props and usage examples
   - Establish design system guidelines

2. **Performance Optimization**:
   - Lazy load heavy components
   - Implement virtualization for long lists
   - Use React.memo for expensive renders

3. **Testing Strategy**:
   - Unit tests for all shared components
   - Visual regression tests for UI components
   - Integration tests for complex components

## Conclusion

The application has a solid foundation of components but suffers from inconsistent usage and many missed opportunities for reuse. The table bookings module represents the biggest opportunity for improvement, while the employees module serves as a good example of effective componentization. By implementing the recommended changes, the codebase would become more maintainable, consistent, and easier to extend.
# Component Inventory

## Overview
This document provides a comprehensive inventory of all UI components currently in use across the Anchor Management Tools application, including their usage patterns and adoption rates.

## Existing Components

### Core UI Components (`/src/components/ui/`)

| Component | Files Using | Usage Rate | Status |
|-----------|------------|------------|--------|
| **Badge.tsx** | 3 files | Low | Underutilized |
| **Button.tsx** | 15+ files | High | Well-adopted |
| **FormInput.tsx** | 2 files | Very Low | Needs promotion |
| **FormSelect.tsx** | 1 file | Very Low | Needs promotion |
| **FormTextarea.tsx** | 1 file | Very Low | Needs promotion |
| **LineChart.tsx** | 0 files | Not used | Review for removal |
| **ListItem.tsx** | 0 files | Not used | Review for removal |
| **LoadingSpinner.tsx** | Multiple | Medium | In use |
| **Modal.tsx** | 5+ files | Medium | Specialized usage |
| **SkeletonLoader.tsx** | 3 files | Low | Limited adoption |
| **StatusIndicator.tsx** | 0 files | Not used | Review for removal |
| **Tabs.tsx** | 3 files | Low | Limited adoption |

### Feature-Specific Components

#### Dashboard Components
- **ActivityFeed.tsx** - Event activity display
- **BusinessHours.tsx** - Hours display
- **CustomerHealthWidget.tsx** - SMS health metrics
- **QuickActions.tsx** - Action grid
- **RecentEvents.tsx** - Event list
- **StatCard.tsx** - Metric display

*Note: Dashboard components exist but are not imported in the main dashboard page*

#### Employee Components
- **EmployeeActions.tsx** - Action buttons
- **EmployeeCard.tsx** - Mobile view card
- **EmployeeForm.tsx** - Create/edit form
- **EmployeeInformation.tsx** - Detail view
- **EmployeeListView.tsx** - Table component
- **PageLoadingSkeleton.tsx** - Loading state

#### Event Components
- **EventActions.tsx** - Event-specific actions
- **EventDetails.tsx** - Event information display
- **EventForm.tsx** - Create/edit form
- **EventFormGrouped.tsx** - Grouped form layout

#### Private Booking Components
- **BookingInvoiceModal.tsx** - Invoice display
- **ContractTermsForm.tsx** - Contract editing
- **DeleteBookingButton.tsx** - Delete action
- **DepositSection.tsx** - Deposit management
- **ItemsTable.tsx** - Booking items display
- **PaymentSection.tsx** - Payment handling
- **SendMessageModal.tsx** - SMS sending

### Third-Party Components

#### Headless UI
- **Dialog** - Modal dialogs
- **Menu** - Dropdown menus
- **Transition** - Animations
- **Listbox** - Select dropdowns

#### External Libraries
- **Lucide React** - Icons (Loader2, etc.)
- **Heroicons** - Primary icon library
- **React Hot Toast** - Toast notifications

## Component Usage by Module

### Well-Componentized Modules
1. **Employees** (90% componentized)
   - Uses dedicated components for all features
   - Good separation of concerns
   - Reusable patterns

2. **Events** (80% componentized)
   - EventForm components
   - Good use of shared components
   - Some inline implementations remain

3. **Private Bookings** (70% componentized)
   - Specialized components for complex features
   - Good modal usage
   - Some layout inconsistencies

### Poorly-Componentized Modules
1. **Table Bookings** (<10% componentized)
   - Almost entirely inline implementations
   - No use of form components
   - Custom table implementations

2. **Settings** (20% componentized)
   - Mix of approaches
   - Many one-off implementations
   - Inconsistent patterns

3. **Dashboard** (30% componentized)
   - Components exist but not used
   - Inline implementations preferred
   - Missed reusability opportunities

## Repeated Patterns Not Componentized

### 1. Card/Panel Container
```tsx
<div className="bg-white shadow overflow-hidden sm:rounded-lg">
  <div className="px-4 py-5 sm:p-6">
    {/* Content */}
  </div>
</div>
```
**Found in**: 140+ locations

### 2. Page Header with Back Button
```tsx
<div className="mb-6">
  <Link href="/back" className="flex items-center gap-2 text-gray-600 hover:text-gray-900">
    <ArrowLeftIcon className="h-4 w-4" />
    Back to X
  </Link>
</div>
<h1 className="text-2xl font-bold">Page Title</h1>
```
**Found in**: 50+ locations

### 3. Empty State Pattern
```tsx
<div className="text-center py-12">
  <Icon className="mx-auto h-12 w-12 text-gray-400" />
  <h3 className="mt-2 text-sm font-medium text-gray-900">No items</h3>
  <p className="mt-1 text-sm text-gray-500">Get started by creating...</p>
</div>
```
**Found in**: 30+ locations

### 4. Data Table Structure
```tsx
<table className="min-w-full divide-y divide-gray-200">
  <thead className="bg-gray-50">
    {/* Headers */}
  </thead>
  <tbody className="bg-white divide-y divide-gray-200">
    {/* Rows */}
  </tbody>
</table>
```
**Found in**: 25+ locations

### 5. Form Section
```tsx
<div className="bg-gray-50 px-4 py-5 sm:p-6 rounded-lg">
  <h3 className="text-lg font-medium leading-6 text-gray-900">Section Title</h3>
  <div className="mt-2 max-w-xl text-sm text-gray-500">
    <p>Section description</p>
  </div>
  <div className="mt-5">
    {/* Form fields */}
  </div>
</div>
```
**Found in**: 40+ locations

### 6. Alert/Notification Banner
```tsx
<div className="rounded-md bg-yellow-50 p-4">
  <div className="flex">
    <ExclamationTriangleIcon className="h-5 w-5 text-yellow-400" />
    <div className="ml-3">
      <p className="text-sm text-yellow-800">Alert message</p>
    </div>
  </div>
</div>
```
**Found in**: 20+ locations

## Component Adoption Analysis

### High Adoption (>50% where applicable)
- Button component
- SupabaseProvider
- Icon libraries
- React Hot Toast

### Medium Adoption (20-50%)
- Modal component
- Pagination component
- LoadingSpinner
- Headless UI components

### Low Adoption (<20%)
- Form components (Input, Select, Textarea)
- Badge component
- Tabs component
- SkeletonLoader

### Zero Adoption
- StatusIndicator
- ListItem
- LineChart

## Key Findings

### 1. Component Underutilization
- Form components exist but are rarely used
- Developers prefer inline implementations
- Missing documentation may be a factor

### 2. Missing Essential Components
- No Card/Panel component (most repeated pattern)
- No PageHeader component
- No EmptyState component
- No DataTable component
- No Alert component

### 3. Inconsistent Component APIs
- Different prop patterns across components
- Inconsistent naming conventions
- Mixed styling approaches

### 4. Module-Specific Silos
- Each module develops its own components
- Little cross-module reusability
- Duplicate implementations

## Recommendations

### Immediate Actions
1. Create missing essential components
2. Document existing components
3. Establish component guidelines

### Short-term Goals
1. Refactor high-repetition patterns
2. Promote form component usage
3. Standardize component APIs

### Long-term Vision
1. Comprehensive component library
2. Storybook documentation
3. Automated usage tracking

## Next Steps
See [Proposed Component Library](./05-proposed-component-library.md) for the standardization plan.
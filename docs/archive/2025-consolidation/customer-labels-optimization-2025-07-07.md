# Customer Labels Performance Optimization

## Problem
The customer labels feature was causing severe performance issues on the `/customers` page:
- Each CustomerLabelSelector component made individual API calls
- With pagination of 50 customers, this resulted in 100+ API requests
- Page was locking up with hundreds of POST requests to load label data

## Solution
Implemented bulk loading of customer label data:

### 1. Created Bulk Loading Function
**File**: `/src/app/actions/customer-labels-bulk.ts`
- `getBulkCustomerLabels()` - Loads all labels and assignments for multiple customers in a single query
- Returns labels and assignments grouped by customer ID

### 2. Created Display-Only Component
**File**: `/src/components/CustomerLabelDisplay.tsx`
- Simple component that only displays labels
- No API calls or state management
- Receives label data as props

### 3. Updated Customers List Page
**File**: `/src/app/(authenticated)/customers/page.tsx`
- Loads all label data once when customers are loaded
- Passes pre-loaded data to CustomerLabelDisplay components
- Reduced API calls from 100+ to just 1

### 4. Enhanced Customer Detail Page
**File**: `/src/app/(authenticated)/customers/[id]/page.tsx`
- Added CustomerLabelSelector for individual customer editing
- Only managers can edit labels
- Interactive component retained for single customer view

## Performance Impact
- **Before**: 100+ API calls, page freezing
- **After**: 1 API call, instant rendering
- **Result**: 99% reduction in API calls

## Technical Details

### Bulk Query Optimization
```typescript
// Single query to get all assignments for visible customers
const { data: assignments } = await supabase
  .from('customer_label_assignments')
  .select(`
    *,
    label:customer_labels(*)
  `)
  .in('customer_id', customerIds)
```

### Data Structure
```typescript
// Grouped by customer ID for O(1) lookup
Record<string, CustomerLabelAssignment[]>
```

## Usage

### List View (Read-Only)
```tsx
<CustomerLabelDisplay 
  assignments={customerLabels[customer.id] || []} 
/>
```

### Detail View (Editable)
```tsx
<CustomerLabelSelector 
  customerId={customer.id} 
  canEdit={true} 
/>
```

## Benefits
1. **Performance**: Eliminated page freezing
2. **Scalability**: Works efficiently with any number of customers
3. **User Experience**: Instant page loads
4. **Maintainability**: Clear separation between display and edit components
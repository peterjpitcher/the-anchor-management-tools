# Add Attendees Modal - Customer Suggestions Fix

## Issue
The "Add Attendees" modal shows empty "Regulars" and "Might Enjoy" tabs despite data existing in the database.

## Root Cause
The CategoryCustomerSuggestions component only displays suggestions to users with specific permissions:
- `customers:manage` OR
- `customers:view`

## Solution

### Option 1: Grant Permissions (Recommended)
Grant the user the appropriate customer permissions:

1. Navigate to **Settings > User Management**
2. Find the user and click **Edit**
3. Assign a role that includes `customers:view` permission (e.g., Manager or create a custom role)

### Option 2: Modify Permission Requirements
If you want all staff to see suggestions, update the permission check in `/src/components/CategoryCustomerSuggestions.tsx`:

```typescript
// Line 32 - Current:
const canViewSuggestions = hasPermission('customers', 'manage') || hasPermission('customers', 'view')

// Change to allow all authenticated users:
const canViewSuggestions = true

// Or to allow staff role:
const canViewSuggestions = hasPermission('customers', 'manage') || 
                          hasPermission('customers', 'view') || 
                          hasPermission('events', 'view')
```

## Verification
The system is working correctly:
- ✅ Events have categories assigned
- ✅ customer_category_stats table has 128 records
- ✅ Queries return correct data (e.g., Bingo Night has 5 regulars)
- ✅ RPC permission functions work correctly
- ✅ Labels are showing on the customers page

## Technical Details

### Fixed Issues
1. **RPC Parameter Name**: Changed `p_resource` to `p_module_name` in permission checks
2. **Type Compatibility**: Fixed TypeScript type issues in customers page

### Data Flow
1. When Add Attendees modal opens for an event with a category
2. CategoryCustomerSuggestions component checks user permissions
3. If permitted, it queries:
   - **Regulars**: Customers who attended this category in last 90 days
   - **Might Enjoy**: Customers who attend similar categories but not this one
4. Results are displayed in tabbed interface

## Testing
To test the fix:
1. Log in as a user with Manager or Admin role
2. Navigate to an event that has a category (e.g., "Quiz Night", "Bingo Night")
3. Click "Add Attendees"
4. You should see populated "Regulars" and "Might Enjoy" tabs

If tabs are still empty, check:
- User role in Settings > User Management
- Event has a category assigned
- Customers have SMS opt-in enabled (required for suggestions)
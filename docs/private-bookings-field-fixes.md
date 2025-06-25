# Private Bookings Database Field Fixes

## Summary
Fixed all database field mismatches in the private bookings module to ensure proper data persistence and display.

## Changes Made

### 1. Venue Spaces (✅ Completed)
Fixed field name mismatches in both server actions and display pages:
- `capacity` → `capacity_seated`
- `hire_cost` → `rate_per_hour`
- `is_active` → `active`

Files updated:
- `/src/app/actions/privateBookingActions.ts` - Updated createVenueSpace and updateVenueSpace functions
- `/src/app/(authenticated)/private-bookings/settings/spaces/page.tsx` - Updated display values

### 2. Catering Packages (✅ Completed)
Fixed field name mismatches:
- `per_head_cost` → `cost_per_head`
- `minimum_order` → `minimum_guests`
- `is_active` → `active`

Files updated:
- `/src/app/actions/privateBookingActions.ts` - Updated createCateringPackage and updateCateringPackage functions
- `/src/app/(authenticated)/private-bookings/settings/catering/page.tsx` - Updated display values

### 3. Vendors (✅ Completed)
Fixed field name mismatches:
- `vendor_type` → `service_type`
- `phone` → `contact_phone`
- `is_preferred` → `preferred`
- `is_active` → `active`

Files updated:
- `/src/app/actions/privateBookingActions.ts` - Updated createVendor and updateVendor functions
- `/src/app/(authenticated)/private-bookings/settings/vendors/page.tsx` - Updated display values and queries

### 4. Private Bookings Table (✅ Completed)
Added missing columns that were being used in forms:
- `special_requirements` - For equipment needs, layout preferences, technical requirements
- `accessibility_needs` - For wheelchair access, hearing loops, dietary restrictions

Migration created:
- `/supabase/migrations/20250625_add_missing_private_booking_fields.sql`

## Next Steps

1. **Run the database migration** in Supabase:
   - Go to your Supabase dashboard
   - Navigate to SQL Editor
   - Paste and run the migration from `/supabase/migrations/20250625_add_missing_private_booking_fields.sql`

2. **Test the updated functionality**:
   - Create/update venue spaces and verify capacity and rate values persist
   - Create/update catering packages and verify all fields save correctly
   - Create/update vendors and verify contact information saves properly
   - Create a new private booking with special requirements and accessibility needs

## Implementation Pattern

For future reference, the pattern used for fixing field mismatches:

```typescript
// In server actions, map form fields to database columns:
const dbData = {
  name: data.name,
  capacity_seated: data.capacity,  // Form field → DB column
  rate_per_hour: data.hire_cost,   // Form field → DB column
  active: data.is_active           // Form field → DB column
}

// In display pages, use the correct database field:
defaultValue={space.capacity_seated}  // Not space.capacity
defaultValue={space.rate_per_hour}    // Not space.hire_cost
defaultValue={space.active}           // Not space.is_active
```

This ensures consistency between what the user sees/enters and what's stored in the database.
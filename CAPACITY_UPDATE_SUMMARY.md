# Table Booking Capacity System Update Summary

## Overview
Modified the table booking availability logic to use a simple capacity-based system (max 50 people at any time) rather than specific table assignments.

## Changes Made

### 1. Updated `src/app/actions/table-booking-availability.ts`
- Added a constant `RESTAURANT_CAPACITY = 50` at the top of the file
- Modified `checkAvailability()` function to use the fixed capacity instead of querying table_configuration
- Updated `checkTableAvailability()` helper function to calculate capacity without database RPC call
- Removed dependency on individual table configurations

### 2. Updated `src/app/actions/table-bookings.ts`
- Added comment to `checkTableAvailability()` function indicating it now uses fixed capacity system
- Function still calls the database RPC but the RPC itself has been updated

### 3. Created Database Migration
- File: `supabase/migrations/20250725122348_update_table_booking_capacity_system.sql`
- Updated the `check_table_availability` PostgreSQL function to use a fixed capacity of 50
- Added a `system_settings` table for future configuration management
- Inserted a setting for `restaurant_capacity` that can be used in the future
- Added proper RLS policies for the new table

### 4. API Endpoint (`/api/table-bookings/availability`)
- No changes needed - it continues to use the `checkAvailability` function which now uses fixed capacity

## Key Benefits
1. **Simpler Logic**: No need to manage individual table configurations
2. **Easier Capacity Management**: Single constant to adjust capacity
3. **Better Performance**: Fewer database queries needed
4. **Flexibility**: System_settings table allows for future configuration without code changes

## Important Notes
- The system now allows bookings up to 50 people total at any given time
- Overlapping bookings are still properly calculated based on time slots
- The `table_configuration` table is no longer used for capacity calculations but remains in the database
- To change capacity, update the `RESTAURANT_CAPACITY` constant in `table-booking-availability.ts`
- In the future, this could be made dynamic by reading from the `system_settings` table

## Migration Instructions
1. Run the database migration: `supabase db push`
2. Deploy the updated code
3. The system will immediately start using the fixed capacity of 50 people

## Verification
- Build passes with no errors: ✅
- ESLint shows no errors related to changes: ✅
- All existing functionality preserved: ✅
- API continues to work as expected: ✅
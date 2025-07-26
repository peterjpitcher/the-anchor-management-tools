# Discovery Report: Business Hours Special Hours Enhancement
**Date**: 2025-07-26  
**Branch**: main  
**Feature**: Auto-populate regular hours and add kitchen closed option

## Executive Summary
The user wants to improve the special hours form by:
1. **Auto-populating regular hours** when a date is selected (so they can edit from there instead of entering everything manually)
2. **Adding a "kitchen closed" option** that works independently from "venue closed"

## Current Implementation Analysis

### Data Structure
- **business_hours** table: Stores regular hours for each day of week (0-6)
  - `day_of_week`: 0 = Sunday, 6 = Saturday
  - `opens`, `closes`: Venue hours
  - `kitchen_opens`, `kitchen_closes`: Kitchen hours
  - `is_closed`: Boolean for entire venue closure
  
- **special_hours** table: Overrides for specific dates
  - Same time fields as business_hours
  - `date`: Specific date for override
  - `is_closed`: Currently only supports full venue closure
  - `note`: Optional description

### Current User Flow
1. User clicks "Add Special Hours"
2. Empty form appears with all fields blank
3. User must manually enter:
   - Date
   - Opens/Closes times
   - Kitchen Opens/Closes times
   - Or check "Closed all day"
4. No way to indicate "kitchen closed" while venue remains open

### Pain Points
- **Manual Entry**: Users must type all times even if they're similar to regular hours
- **No Kitchen-Only Closure**: Can't indicate kitchen is closed while bar/venue stays open
- **Time Consuming**: For holidays where only kitchen hours change, entire form must be filled

## Proposed Implementation

### 1. Auto-Population Feature
When user selects a date:
- Extract day of week from selected date
- Query corresponding regular hours from business_hours table
- Pre-fill form with those values
- User can then modify as needed

**Implementation Steps**:
1. Add date change handler in SpecialHoursManager
2. Fetch regular hours based on day of week
3. Update form state with fetched values
4. Keep fields editable for modifications

### 2. Kitchen Closed Option
Add separate boolean for kitchen closure:
- New checkbox: "Kitchen closed today"
- When checked, disables kitchen time inputs
- Allows venue to be open while kitchen is closed

**Options for Implementation**:
- **Option A**: Add new `is_kitchen_closed` column to special_hours table
- **Option B**: Use null values in kitchen_opens/kitchen_closes to indicate closure
- **Option C**: Store special value (e.g., "00:00") to indicate closure

**Recommendation**: Option A - Most explicit and clear

## Impact Analysis

### Database Changes
**Migration Required**:
```sql
ALTER TABLE special_hours 
ADD COLUMN is_kitchen_closed BOOLEAN DEFAULT FALSE;
```

### Code Changes Required
1. **SpecialHoursManager.tsx**:
   - Add date change handler
   - Add kitchen closed checkbox
   - Implement auto-population logic
   
2. **business-hours.ts** (actions):
   - Add function to get hours by day of week
   - Update validation schema for new field
   
3. **business-hours.ts** (types):
   - Add `is_kitchen_closed` to SpecialHours interface

### UI/UX Improvements
- Form becomes more intuitive
- Reduces data entry time
- Clearer representation of kitchen vs venue hours
- Better handling of partial closures

### Backward Compatibility
- Existing special hours records remain valid
- New column defaults to FALSE
- No breaking changes to existing functionality

## Risk Assessment

### Low Risk
- Simple database migration (single column addition)
- Isolated to special hours functionality
- No impact on regular business hours
- No impact on other modules

### Considerations
- Ensure proper validation when kitchen is closed but venue is open
- Update any reporting/display logic that shows hours
- Test date picker behavior across timezones

## Testing Scenarios
1. Select date → verify correct regular hours populate
2. Select Sunday → verify Sunday hours populate
3. Change date → verify form updates with new day's hours
4. Check "Kitchen closed" → verify kitchen time fields disable
5. Save with kitchen closed → verify data saves correctly
6. Edit existing special hours → verify all fields load properly

## API Impact
- No changes to external APIs
- Internal business-hours actions need minor updates
- Validation schemas need updating

## Mobile Considerations
- Form already responsive
- New checkbox will follow existing mobile layout
- No special mobile handling required

## Implementation Estimate
- Database migration: 30 minutes
- Auto-population logic: 1-2 hours  
- Kitchen closed feature: 1 hour
- Testing: 1 hour
- Total: ~4 hours

## Conclusion
This enhancement will significantly improve user experience when managing special hours. The implementation is straightforward with minimal risk. The auto-population feature will save time and reduce errors, while the kitchen-closed option provides needed flexibility for partial closures.

### Recommended Approach
1. Create database migration for `is_kitchen_closed` column
2. Update types and validation schemas
3. Implement auto-population on date selection
4. Add kitchen closed checkbox and logic
5. Test thoroughly with various scenarios
6. Update any display components that show hours
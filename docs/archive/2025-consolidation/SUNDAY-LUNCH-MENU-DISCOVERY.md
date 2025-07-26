# Sunday Lunch Menu Discovery Report

## Current State Analysis

### Database Structure

1. **Table: `sunday_lunch_menu_items`**
   - Categories: `'main', 'side', 'dessert', 'extra'`
   - Current data shows:
     - Mains: Roasted Chicken, Lamb Shank, Pork Belly, Vegetarian Wellington, Kids Chicken
     - Sides: Roast Potatoes, Yorkshire Pudding, Seasonal Vegetables (all £0)
     - Extras: Cauliflower Cheese (£3.99)
     - No desserts in the provided data

2. **Table: `table_booking_items`**
   - `item_type` constraint: `'main', 'side', 'extra'`
   - Links menu selections to bookings
   - Stores `price_at_booking` to lock in prices

### Key Files & Components

1. **API Endpoint**: `/api/table-bookings/menu/sunday-lunch/route.ts`
   - Uses `getSundayLunchMenu()` from table-booking-menu.ts
   - Currently returns hardcoded menu data, NOT from database

2. **Menu Management**: `/src/app/actions/sunday-lunch-menu.ts`
   - Full CRUD operations for database menu items
   - Uses categories: `'main', 'side', 'extra'`
   - Properly integrated with database

3. **Legacy Menu Function**: `/src/app/actions/table-booking-menu.ts`
   - `getSundayLunchMenu()` returns HARDCODED menu data
   - Includes starters, desserts (not in DB)
   - Uses 'extra' for additional sides like Cauliflower Cheese

4. **Admin UI**: `/table-bookings/settings/sunday-lunch/page.tsx`
   - Manages menu items via database
   - Shows categories: main, side, dessert, extra
   - Properly uses `getSundayLunchMenuItems()` from database

5. **Booking Form**: `/table-bookings/new/page.tsx`
   - Hardcoded sides list
   - Special handling for "Cauliflower Cheese (£3.99 extra)"
   - Maps to `item_type: 'extra'` for priced sides

### Issues Identified

1. **Confusion Source**: Two different menu data sources:
   - Database table (properly managed via admin UI)
   - Hardcoded data in `table-booking-menu.ts`

2. **API Inconsistency**: 
   - API endpoint uses hardcoded data
   - Admin UI uses database
   - Booking form uses mix of both

3. **Category Naming**:
   - Database allows 'dessert' but it's not used
   - 'extra' is used for priced sides (like Cauliflower Cheese)
   - Should be simplified to just 'main' and 'side'

### Required Changes

1. **Database Migration**:
   - Update `sunday_lunch_menu_items` CHECK constraint: remove 'dessert', keep 'extra' as 'side'
   - Update `table_booking_items` CHECK constraint: change 'extra' to 'side'
   - Migrate existing 'extra' items to 'side' category

2. **Code Updates**:
   - Update `getSundayLunchMenu()` to fetch from database
   - Remove hardcoded menu data
   - Update all references from 'extra' to 'side'
   - Simplify category enums to just ['main', 'side']

3. **API Documentation**:
   - Remove references to starters and desserts
   - Update to show only mains and sides
   - Clarify that sides can be free (included) or priced

### Files That Need Updates

1. `/src/app/actions/table-booking-menu.ts` - Replace hardcoded data with DB query
2. `/src/app/actions/sunday-lunch-menu.ts` - Update schema enum
3. `/src/app/(authenticated)/table-bookings/settings/sunday-lunch/page.tsx` - Update category options
4. `/src/app/(authenticated)/table-bookings/new/page.tsx` - Update item type mapping
5. `/src/app/api/table-bookings/route.ts` - Update validation schema
6. `/docs/api/COMPLETE_API_DOCUMENTATION.md` - Update menu structure docs
7. Database migrations for constraint updates

### Migration Strategy

1. Create migration to update CHECK constraints
2. Update all 'extra' items to 'side' in database
3. Update code to use new categories
4. Remove hardcoded menu data
5. Update API to use database
6. Test thoroughly
7. Update documentation
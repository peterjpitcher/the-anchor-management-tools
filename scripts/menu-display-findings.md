# Menu Display Investigation Findings

## Summary

I've investigated why menu items aren't showing on the payment page. Here's what I found:

### ✅ What's Working:
1. **Database Storage**: Menu items are being stored correctly with all details (custom_item_name, guest_name, etc.)
2. **Admin UI**: The internal booking details page shows menu items correctly
3. **Manager Email**: Fetches and displays all menu item details properly
4. **Confirmation Email Template**: Has proper code to display menu items

### ❌ The Problem:
The **public API endpoint** used by the payment page is only fetching limited fields from `table_booking_items`.

## Specific Issue

**File**: `src/app/api/table-bookings/[booking_reference]/public/route.ts`
**Lines**: 28-31

Current code:
```typescript
table_booking_items(
  quantity,
  price_at_booking
)
```

Should be:
```typescript
table_booking_items(
  quantity,
  price_at_booking,
  custom_item_name,
  guest_name,
  special_requests,
  item_type
)
```

## Impact

This causes the payment page to receive incomplete data:
- It gets quantity and price
- But NOT the item names, guest names, or special requests

The payment page has the correct display code (lines 242-267 in `table-booking/[reference]/payment/page.tsx`), but it's receiving incomplete data from the API.

## Required Fix

Update the public API endpoint to fetch all menu item fields. This is a simple one-line change to add the missing fields to the select query.
# Sunday Lunch Booking API - Current Implementation Review

## Executive Summary
This document provides a comprehensive overview of the current Sunday lunch booking API implementation for senior developer review. The API handles restaurant table bookings with a special focus on Sunday lunch service, which requires pre-selection of menu items and advance payment.

## System Architecture
- **Framework**: Next.js 15.3.3 with App Router
- **Database**: Supabase (PostgreSQL)
- **Payment**: PayPal integration
- **SMS/Email**: Twilio for SMS, Microsoft Graph for email

## Current API Design Issues

### Primary Issue: Redundant Data Requirements
The API currently requires both `menu_item_id` AND `custom_item_name` for each menu selection, leading to:
1. **Data redundancy** - The name exists in the database but must be passed again
2. **Potential inconsistency** - Name in request might not match database
3. **Extra client-side complexity** - Client must fetch and track both values
4. **Missing data problems** - As seen in production where `custom_item_name` is null

## API Endpoint Structure

### 1. Create Booking Endpoint
**POST** `/api/table-bookings`

#### Request Body Schema:
```typescript
{
  booking_type: 'regular' | 'sunday_lunch',
  date: string,           // Format: "YYYY-MM-DD"
  time: string,           // Format: "HH:MM"
  party_size: number,     // 1-20
  customer: {
    first_name: string,
    last_name: string,
    email?: string,
    mobile_number: string,
    sms_opt_in: boolean
  },
  special_requirements?: string,
  dietary_requirements?: string[],
  allergies?: string[],
  celebration_type?: string,
  duration_minutes?: number,  // Default: 120
  source?: string,            // Default: 'website'
  
  // CRITICAL: Required for Sunday lunch bookings
  menu_selections?: Array<{
    menu_item_id?: string,        // UUID from sunday_lunch_menu_items table
    custom_item_name?: string,    // Actual dish name (PROBLEM: This is often null)
    item_type: 'main' | 'side',
    quantity: number,
    special_requests?: string,
    guest_name?: string,          // e.g., "Guest 1", "Guest 2"
    price_at_booking: number      // Price snapshot at time of booking
  }>
}
```

#### Validation Logic (Zod Schema):
```typescript
const CreateBookingSchema = z.object({
  booking_type: z.enum(['regular', 'sunday_lunch']),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  time: z.string().regex(/^\d{2}:\d{2}$/),
  party_size: z.number().min(1).max(20),
  customer: z.object({
    first_name: z.string().min(1),
    last_name: z.string().min(1),
    email: z.string().email().optional(),
    mobile_number: z.string().min(10),
    sms_opt_in: z.boolean().default(true),
  }),
  special_requirements: z.string().optional(),
  dietary_requirements: z.array(z.string()).optional().default([]),
  allergies: z.array(z.string()).optional().default([]),
  celebration_type: z.string().optional(),
  duration_minutes: z.number().optional().default(120),
  source: z.string().optional().default('website'),
  menu_selections: z.array(z.object({
    menu_item_id: z.string().optional(),
    custom_item_name: z.string().optional(),
    item_type: z.enum(['main', 'side']),
    quantity: z.number().min(1),
    special_requests: z.string().optional(),
    guest_name: z.string().optional(),
    price_at_booking: z.number(),
  })).optional(),
});
```

### 2. Menu Fetching Endpoint
**GET** `/api/table-bookings/menu/sunday-lunch?date=YYYY-MM-DD`

#### Response Structure:
```typescript
{
  menu_date: string,
  main_courses: Array<{
    id: string,
    name: string,
    price: number,
    description?: string,
    dietary_info?: string[],
    allergens?: string[],
    is_available: boolean
  }>,
  included_sides: Array<{
    id: string,
    name: string,
    price: 0,  // Always 0 for included items
    description?: string
  }>,
  extra_sides: Array<{
    id: string,
    name: string,
    price: number,  // Actual price for extras
    description?: string
  }>,
  cutoff_time: string
}
```

## Database Schema

### table_bookings
```sql
CREATE TABLE table_bookings (
  id UUID PRIMARY KEY,
  booking_reference VARCHAR(10) UNIQUE,
  customer_id UUID REFERENCES customers(id),
  booking_date DATE,
  booking_time TIME,
  party_size INTEGER,
  booking_type VARCHAR(20), -- 'regular' or 'sunday_lunch'
  status VARCHAR(20),       -- 'pending_payment', 'confirmed', etc.
  special_requirements TEXT,
  dietary_requirements JSONB,
  allergies JSONB,
  -- ... other fields
);
```

### table_booking_items (Where menu selections are stored)
```sql
CREATE TABLE table_booking_items (
  id UUID PRIMARY KEY,
  booking_id UUID REFERENCES table_bookings(id),
  menu_item_id UUID,         -- References sunday_lunch_menu_items(id)
  custom_item_name VARCHAR,  -- Stores the actual dish name
  item_type VARCHAR(10),     -- 'main' or 'side'
  quantity INTEGER,
  special_requests TEXT,
  price_at_booking DECIMAL,
  guest_name VARCHAR,        -- e.g., "Guest 1"
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

### sunday_lunch_menu_items (Menu configuration)
```sql
CREATE TABLE sunday_lunch_menu_items (
  id UUID PRIMARY KEY,
  name VARCHAR NOT NULL,
  category VARCHAR,       -- 'main' or 'side'
  price DECIMAL,
  description TEXT,
  dietary_info JSONB,
  allergens JSONB,
  is_active BOOLEAN,
  display_order INTEGER
);
```

## Current Process Flow

### Booking Creation Flow:
```javascript
// 1. API receives POST request
const body = await req.json();
const validatedData = CreateBookingSchema.parse(body);

// 2. Check availability
const availability = await checkAvailability(
  validatedData.date,
  validatedData.party_size,
  validatedData.booking_type
);

// 3. Find or create customer
const { data: customer } = await supabase
  .from('customers')
  .select('*')
  .or(phoneVariants.map(v => `mobile_number.eq.${v}`).join(','))
  .single();

// 4. Create booking
const { data: booking } = await supabase
  .from('table_bookings')
  .insert({
    customer_id: customer.id,
    booking_date: validatedData.date,
    booking_time: validatedData.time,
    party_size: validatedData.party_size,
    booking_type: validatedData.booking_type,
    status: validatedData.booking_type === 'sunday_lunch' 
      ? 'pending_payment' 
      : 'confirmed',
    // ... other fields
  })
  .select()
  .single();

// 5. Add menu selections (Sunday lunch only)
if (validatedData.booking_type === 'sunday_lunch' && validatedData.menu_selections) {
  const { error: itemsError } = await supabase
    .from('table_booking_items')
    .insert(validatedData.menu_selections.map(item => ({
      booking_id: booking.id,
      ...item,  // PROBLEM: If custom_item_name is null, kitchen doesn't know what to cook
    })));
}

// 6. Calculate payment
totalAmount = validatedData.menu_selections.reduce(
  (sum, item) => sum + (item.price_at_booking * item.quantity), 
  0
);
depositAmount = validatedData.party_size * 5; // £5 per person

// 7. Create PayPal order for deposit
const paypalOrder = await createPayPalOrder(
  bookingWithItems,
  returnUrl,
  cancelUrl,
  true // depositOnly
);
```

## Problems with Current Implementation

### 1. Data Redundancy Problem
The client must pass both `menu_item_id` AND `custom_item_name`:
```javascript
// Current requirement - redundant
{
  menu_item_id: "7da6244a-1588-44fc-ae2c-94c077ae844f",
  custom_item_name: "Roast Beef",  // Why pass this if we have the ID?
  price_at_booking: 15.49
}
```

### 2. Incomplete Data in Production
Real production data showing the problem:
```javascript
// What's being stored (custom_item_name is NULL!)
{
  id: "09e8ed8b-fdee-44c8-aeef-f1cc4fb2326a",
  booking_id: "042a0766-ac20-4017-a4fc-5e4198038bcc",
  menu_item_id: "7da6244a-1588-44fc-ae2c-94c077ae844f",
  custom_item_name: null,  // CRITICAL: Kitchen doesn't know what to cook!
  item_type: "main",
  quantity: 1,
  price_at_booking: "15.49",
  guest_name: "Guest 1"
}
```

### 3. Missing Included Sides
The API expects complete meal data but often only receives main courses:
```javascript
// What's being sent (WRONG - incomplete)
[
  {
    menu_item_id: "main-uuid",
    item_type: "main",
    quantity: 1,
    price_at_booking: 15.49,
    guest_name: "Guest 1"
  }
  // Missing: Yorkshire pudding, roast potatoes, vegetables (included sides)
]

// What should be sent (CORRECT - complete meal)
[
  {
    menu_item_id: "main-uuid",
    custom_item_name: "Roast Beef",
    item_type: "main",
    quantity: 1,
    price_at_booking: 15.49,
    guest_name: "Guest 1"
  },
  {
    menu_item_id: "yorkshire-uuid",
    custom_item_name: "Yorkshire Pudding",
    item_type: "side",
    quantity: 1,
    price_at_booking: 0,  // Included with main
    guest_name: "Guest 1"
  },
  // ... other included sides
]
```

## Recommended API Improvements

### Option 1: Auto-populate from menu_item_id
Modify the API to fetch item details when only `menu_item_id` is provided:
```javascript
// API should accept just:
{
  menu_item_id: "7da6244a-1588-44fc-ae2c-94c077ae844f",
  quantity: 1,
  guest_name: "Guest 1",
  special_requests: "Well done"
}

// API internally fetches and stores:
const menuItem = await supabase
  .from('sunday_lunch_menu_items')
  .select('name, price, category')
  .eq('id', selection.menu_item_id)
  .single();

await supabase
  .from('table_booking_items')
  .insert({
    booking_id: booking.id,
    menu_item_id: selection.menu_item_id,
    custom_item_name: menuItem.name,  // Auto-populated
    item_type: menuItem.category,     // Auto-populated
    price_at_booking: menuItem.price, // Auto-populated
    quantity: selection.quantity,
    guest_name: selection.guest_name,
    special_requests: selection.special_requests
  });
```

### Option 2: Simplify Data Structure
Instead of individual items, accept complete guest meals:
```javascript
{
  booking_type: "sunday_lunch",
  guest_meals: [
    {
      guest_name: "Guest 1",
      main_course_id: "beef-uuid",
      included_side_ids: ["yorkshire-uuid", "potatoes-uuid"],  // Optional, can be auto-added
      extra_side_ids: ["cauliflower-uuid"],
      special_requests: "No gravy on vegetables"
    },
    {
      guest_name: "Guest 2",
      main_course_id: "chicken-uuid",
      // Included sides auto-added if not specified
      special_requests: null
    }
  ]
}
```

### Option 3: Use menu_item_id OR custom_item_name (not both)
Make the API intelligent enough to handle either:
```javascript
// If menu_item_id provided, fetch details from database
// If custom_item_name provided (for truly custom items), use that
if (selection.menu_item_id) {
  const menuItem = await fetchMenuItem(selection.menu_item_id);
  selection.custom_item_name = menuItem.name;
  selection.price_at_booking = menuItem.price;
} else if (!selection.custom_item_name) {
  throw new Error('Either menu_item_id or custom_item_name required');
}
```

## Critical Questions for Review

1. **Why require both menu_item_id AND custom_item_name?** This creates redundancy and potential for errors.

2. **Should included sides be automatically added?** Currently, the client must explicitly add Yorkshire pudding, roast potatoes, etc. for each guest.

3. **Is the guest tracking mechanism sufficient?** Using string names like "Guest 1" makes it difficult to match with actual customer names.

4. **Should the API validate meal completeness?** The API accepts incomplete meals (just mains, no sides).

5. **How should custom/off-menu items be handled?** Current structure allows custom_item_name without menu_item_id, but this isn't well documented.

## Recommended Immediate Fix

Before any major refactoring, the immediate fix for the production issue:

```javascript
// In the API endpoint, after receiving menu_selections:
for (const selection of validatedData.menu_selections) {
  // If menu_item_id provided but custom_item_name missing
  if (selection.menu_item_id && !selection.custom_item_name) {
    const { data: menuItem } = await supabase
      .from('sunday_lunch_menu_items')
      .select('name, category, price')
      .eq('id', selection.menu_item_id)
      .single();
    
    if (menuItem) {
      selection.custom_item_name = menuItem.name;
      // Optionally validate/override price
      if (!selection.price_at_booking) {
        selection.price_at_booking = menuItem.price;
      }
    }
  }
  
  // Validate that we have a name for kitchen display
  if (!selection.custom_item_name) {
    throw new Error(`Missing item name for ${selection.guest_name || 'guest'}`);
  }
}
```

## Performance Considerations

Current implementation makes multiple database calls:
1. Check availability
2. Find/create customer  
3. Create booking
4. Insert menu items (no validation against menu table)
5. Create payment record

This could be optimized with:
- Batch fetching of menu items
- Transaction wrapping for atomicity
- Caching of menu data (changes infrequently)

## Security Considerations

1. **Price validation**: Currently trusts client-provided `price_at_booking` without validation
2. **Menu item validation**: Doesn't verify menu_item_id exists or is active
3. **No rate limiting**: Could be abused for booking spam

## Conclusion

The current API design has significant issues that lead to incomplete data in production. The requirement for redundant data (both ID and name) creates unnecessary complexity and error potential. The API should be refactored to either:
1. Auto-populate missing data from the database
2. Simplify the data structure to be more meal-oriented rather than item-oriented
3. Add validation to ensure complete meal data is stored

The most critical immediate need is ensuring `custom_item_name` is always populated so kitchen staff know what to prepare.
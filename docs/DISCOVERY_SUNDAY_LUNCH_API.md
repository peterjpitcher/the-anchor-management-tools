# Sunday Lunch API - Discovery Report

## Date: 2025-08-10
## Branch: main

## System State Analysis

### ✅ Build & Lint Status
- **Lint**: PASSED - No ESLint errors
- **TypeScript**: Compiles successfully
- **Production URL**: https://management.orangejelly.co.uk

### 🔴 Critical Issues Found

#### 1. **Race Condition in Availability Check**
**Location**: `src/app/actions/table-booking-availability.ts:114-118`
```typescript
// NO LOCKING - Multiple requests can read same availability
const { data: existingBookings } = await supabase
  .from('table_bookings')
  .select('booking_time, party_size, duration_minutes')
  .eq('booking_date', date)
  .in('status', ['confirmed', 'pending_payment']);
```
**Risk**: Two simultaneous bookings can both pass availability check and overbook

#### 2. **No Transaction Wrapping**
**Location**: `src/app/api/table-bookings/route.ts:140-199`
- Customer creation (line 94-101)
- Booking creation (line 140-178)  
- Menu items insertion (line 184-199)
- Payment record creation (line 247-262)

**Risk**: Partial failures leave orphaned records

#### 3. **Client-Trusted Data**
**Location**: `src/app/api/table-bookings/route.ts:186-189`
```typescript
// Directly inserts client-provided data
.insert(validatedData.menu_selections.map(item => ({
  booking_id: booking.id,
  ...item,  // Trusts price_at_booking, custom_item_name from client
})));
```
**Risk**: Price manipulation, null custom_item_name (as seen in production)

#### 4. **No Idempotency Protection**
**Location**: Entire POST endpoint
- No idempotency key handling
- No duplicate request detection
- Risk of double bookings from retries

### 📊 Database Schema Current State

#### Existing ENUM Types ✅
```sql
-- Already using ENUMs (good!)
CREATE TYPE "public"."table_booking_status" AS ENUM (
    'pending_payment', 'confirmed', 'cancelled', 'no_show', 'completed'
);

CREATE TYPE "public"."table_booking_type" AS ENUM (
    'regular', 'sunday_lunch'
);
```

#### table_bookings Structure
```sql
CREATE TABLE "public"."table_bookings" (
    id UUID PRIMARY KEY,
    booking_reference VARCHAR(20) NOT NULL,
    customer_id UUID,
    booking_date DATE NOT NULL,
    booking_time TIME NOT NULL,
    party_size INTEGER NOT NULL,
    booking_type table_booking_type NOT NULL,
    status table_booking_status DEFAULT 'pending_payment',
    -- ... other fields
    CONSTRAINT party_size_check CHECK (party_size > 0)
);
```

#### table_booking_items Structure
```sql
CREATE TABLE "public"."table_booking_items" (
    id UUID PRIMARY KEY,
    booking_id UUID NOT NULL,
    menu_item_id UUID,
    custom_item_name VARCHAR(255),
    item_type VARCHAR(20) DEFAULT 'main',  -- NOT ENUM!
    quantity INTEGER DEFAULT 1 NOT NULL,
    price_at_booking NUMERIC(10,2) NOT NULL,
    guest_name VARCHAR(100),
    CONSTRAINT item_name_required CHECK (
        (menu_item_id IS NOT NULL) OR (custom_item_name IS NOT NULL)
    )
);
```

**Good**: Already has CHECK constraint for item_name_required
**Bad**: item_type is VARCHAR not ENUM

### 🔍 Missing Components

#### 1. No Service Slots Table
- No capacity enforcement at DB level
- No time window definitions
- No locking mechanism

#### 2. No Idempotency Table
```sql
-- MISSING: Need this table
CREATE TABLE idempotency_keys (
    key VARCHAR(255) PRIMARY KEY,
    request_hash VARCHAR(64),
    response JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 3. No Booking Audit Table
```sql
-- MISSING: Need audit trail
CREATE TABLE booking_audit (
    id BIGSERIAL PRIMARY KEY,
    booking_id UUID NOT NULL,
    event VARCHAR(50) NOT NULL,
    meta JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

#### 4. No Sunday Lunch Menu Date Awareness
- Menu items not linked to service dates
- No price versioning
- No included sides configuration

### 🚨 Production Data Issues

#### Current Bad State Example:
```json
{
  "id": "09e8ed8b-fdee-44c8-aeef-f1cc4fb2326a",
  "booking_id": "042a0766-ac20-4017-a4fc-5e4198038bcc",
  "menu_item_id": "7da6244a-1588-44fc-ae2c-94c077ae844f",
  "custom_item_name": null,  // CRITICAL: Kitchen blind!
  "item_type": "main",
  "quantity": 1,
  "price_at_booking": "15.49",
  "guest_name": "Guest 1"
}
```

### 📈 Impact Analysis

#### Tables Affected by Changes:
- [x] table_bookings - Status tracking, capacity
- [x] table_booking_items - Menu data integrity
- [x] customers - Phone normalization
- [x] sunday_lunch_menu_items - Date awareness needed
- [ ] service_slots - NEW TABLE NEEDED
- [ ] idempotency_keys - NEW TABLE NEEDED
- [ ] booking_audit - NEW TABLE NEEDED
- [ ] booking_payments - Needs state machine improvement

#### Server Actions Requiring Updates:
- `checkAvailability()` - Add locking
- `createBooking()` - Wrap in transaction
- `addBookingMenuSelections()` - Server-side lookups
- `getSundayLunchMenu()` - Date-aware menus

#### API Endpoints Affected:
- POST `/api/table-bookings` - Main booking creation
- GET `/api/table-bookings/menu/sunday-lunch` - Menu fetching
- POST `/api/table-bookings/payment/return` - Payment confirmation
- POST `/api/table-bookings/confirm-payment` - Manual confirmation

### 🔐 Security Findings

1. **No Rate Limiting** - Can spam booking attempts
2. **Price Trust** - Client provides price_at_booking
3. **No Request Signing** - API key only, no HMAC
4. **Missing Validation** - Party size vs menu items mismatch allowed

### ⚡ Performance Concerns

1. **Multiple Sequential DB Calls**:
   - Check availability (1 call)
   - Find customer (1 call)
   - Create customer if needed (1 call)
   - Policy check (1 call)
   - Create booking (1 call)
   - Insert menu items (1 call)
   - Create payment (1 call)
   Total: 7+ database roundtrips

2. **No Caching** - Menu fetched on every request
3. **No Connection Pooling** - Using serverless functions

### ✅ What's Working Well

1. **ENUM types** already in use for booking_type and status
2. **CHECK constraints** exist for critical fields
3. **Zod validation** on API input
4. **API key authentication** implemented
5. **PayPal integration** functional

### 🎯 Immediate Actions Required

#### Phase 1A: Critical Data Fix (TODAY)
```typescript
// Add to route.ts after line 183
if (validatedData.booking_type === 'sunday_lunch' && validatedData.menu_selections) {
  // Fetch and populate missing item names
  const menuItemIds = validatedData.menu_selections
    .filter(s => s.menu_item_id)
    .map(s => s.menu_item_id);
    
  const { data: menuItems } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id, name, price, category')
    .in('id', menuItemIds);
    
  const itemMap = new Map(menuItems?.map(i => [i.id, i]) || []);
  
  // Enrich selections with DB data
  validatedData.menu_selections = validatedData.menu_selections.map(selection => {
    if (selection.menu_item_id && !selection.custom_item_name) {
      const dbItem = itemMap.get(selection.menu_item_id);
      if (dbItem) {
        return {
          ...selection,
          custom_item_name: dbItem.name,
          item_type: dbItem.category,
          price_at_booking: selection.price_at_booking || dbItem.price
        };
      }
    }
    return selection;
  });
}
```

#### Phase 1B: Add Idempotency (TODAY)
```typescript
// Check for idempotency key
const idempotencyKey = req.headers.get('Idempotency-Key');
if (idempotencyKey) {
  const { data: existing } = await supabase
    .from('idempotency_keys')
    .select('response')
    .eq('key', idempotencyKey)
    .single();
    
  if (existing) {
    return NextResponse.json(existing.response);
  }
}
```

### 📝 Migration Priority

1. **Immediate** (No schema change):
   - Fix null custom_item_name
   - Add idempotency checking
   - Validate meal completeness

2. **This Week** (Schema changes):
   - Create service_slots table
   - Add booking_audit table
   - Implement transaction wrapper

3. **Next Week** (Major refactor):
   - Date-aware menus
   - Guest meals structure
   - Payment state machine

### 🔄 Rollback Safety

All Phase 1 changes are:
- ✅ Backward compatible
- ✅ No schema changes required
- ✅ Can be feature-flagged
- ✅ Won't break existing bookings

### 📊 Metrics to Track

Before and after implementation:
1. Count of null custom_item_name entries
2. Number of overbookings per day
3. Failed booking attempts
4. Orphaned payment records
5. Average response time

### 🚀 Next Steps

1. **Implement Phase 1A fix** - Populate custom_item_name
2. **Add monitoring** - Track null entries
3. **Create test suite** - Concurrent booking tests
4. **Document changes** - Update API docs
5. **Notify frontend team** - About new requirements

## Conclusion

The system has critical data integrity issues that need immediate attention. The good news is that some infrastructure (ENUMs, constraints) is already in place. The Phase 1 fixes can be deployed today without schema changes, buying time for proper refactoring.
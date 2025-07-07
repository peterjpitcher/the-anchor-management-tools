# Database Field Mismatches Report

**Date**: 2025-07-06  
**Report Type**: Comprehensive Database vs Application Field Analysis

## Executive Summary

This report documents all instances where the application code references database fields that don't exist, or where database fields exist but aren't being used in the application UI. This analysis was performed to identify and resolve data access errors like the `image_url` field error in the events table.

**CRITICAL FINDING**: There's a migration file (`20250127_simplify_images_and_add_category_fields.sql`) that should convert the events table from multiple image fields to a single `image_url` field, but the schema dump from 2025-06-30 shows this migration hasn't been applied yet. This is causing the exact error you're experiencing.

## Critical Issues Found

### 1. Events Table - Migration Pending Issue

#### Root Cause: Unapplied Database Migration
The code expects a single `image_url` field, but the database still has multiple image fields because migration `20250127_simplify_images_and_add_category_fields.sql` hasn't been applied.

#### Current State (Schema from 2025-06-30):
- Database has:
  - `image_urls` (JSONB array)
  - `hero_image_url` (text)
  - `gallery_image_urls` (JSONB array)
  - `poster_image_url` (text)
  - `thumbnail_image_url` (text)

#### Expected State (After Migration):
- Database should have:
  - `image_url` (single text field)

#### Code References to Non-Existent `image_url`:
- `/src/app/actions/events.ts` (line 81) - Schema validation
- `/src/types/event.ts` (line 27) - Type definition
- API endpoints expecting single image field

#### Code Still Using Old Fields (Inconsistent):
- `/src/components/EventFormSimple.tsx` (lines 33, 65-68) - Uses `hero_image_url`, `thumbnail_image_url`, `poster_image_url`
- `/src/types/database.ts` - Still defines old image fields
- `/src/app/actions/eventsEnhanced.ts` - Mixed usage

#### Unused Database Fields (Exist in Database but Not Used in UI)
- `performer_name` - For event performers
- `performer_type` - Type of performer
- `price_currency` - Currency code (defaults to 'GBP')
- `is_recurring` - Boolean for recurring events
- `recurrence_rule` - Rules for recurring events
- `parent_event_id` - Reference to parent event for recurring series
- `highlights` - JSONB array of bullet points
- `keywords` - JSONB array for SEO
- `highlight_video_urls` - JSONB array of video URLs
- `doors_time` - Door opening time
- `last_entry_time` - Last entry time for event

### 2. Event Categories Table

#### Potentially Missing Fields
- `faqs` field referenced in some API endpoints but not present in `event_categories` table
  - Note: There is a separate `event_faqs` table that might be the intended source

### 3. Customers Table

All fields appear to be properly mapped. No mismatches found.

### 4. Messages Table

All fields appear to be properly mapped. The table correctly uses:
- `twilio_message_sid` instead of just `message_sid`
- `twilio_status` for status tracking
- No `is_read` field (uses `read_at` timestamp instead)

### 5. Employees Table

All core fields appear to be properly mapped. Related tables:
- `employee_attachments` - For file storage
- `employee_emergency_contacts` - Emergency contact info
- `employee_financial_details` - Financial information
- `employee_health_records` - Health records
- `employee_notes` - Notes system

### 6. Private Bookings Table

The table has both legacy and new fields for customer names:
- Legacy: `customer_name` (deprecated)
- New: `customer_first_name`, `customer_last_name`, `customer_full_name` (generated)

Additional fields not commonly used in UI:
- `source` - Where booking originated
- `special_requirements` - Special event requirements
- `accessibility_needs` - Accessibility requirements

### 7. Bookings Table

All fields appear to be properly mapped. No mismatches found.

## Recommendations

### Immediate Actions Required

1. **URGENT: Resolve Database/Code Mismatch**
   Two options:
   
   **Option A: Apply the pending migration** (Recommended)
   - Run migration `20250127_simplify_images_and_add_category_fields.sql`
   - This will convert all image fields to single `image_url`
   - Code will work as expected
   
   **Option B: Revert code to use old fields**
   - Update `/src/app/actions/events.ts` to use `hero_image_url` instead of `image_url`
   - Update all type definitions to match current database
   - More work, but doesn't require database changes

2. **Fix Code Inconsistencies**
   - Some files use new field names, others use old
   - Standardize based on chosen approach above

3. **Review FAQs Implementation**
   - The migration adds `faqs` field to `event_categories` table
   - But there's already a separate `event_faqs` table
   - Decide on single approach and update code accordingly

### Medium Priority

1. **Utilize Unused Event Fields**
   - Consider adding UI for performer info
   - Add support for recurring events
   - Implement doors/last entry times

2. **Clean Up Private Bookings**
   - Complete migration from `customer_name` to split name fields
   - Add UI for source, special requirements, and accessibility fields

### Low Priority

1. **Documentation**
   - Document which image fields should be used for what purpose
   - Create field mapping documentation

## Technical Details

### Events Table Image Fields Structure
```sql
-- Current database structure
image_urls JSONB DEFAULT '[]'::jsonb,          -- Array of image URLs
hero_image_url TEXT,                           -- Main hero image
gallery_image_urls JSONB DEFAULT '[]'::jsonb,  -- Gallery images
poster_image_url TEXT,                         -- Event poster
thumbnail_image_url TEXT,                      -- Thumbnail for lists

-- Code is trying to use:
image_url TEXT  -- This field doesn't exist!
```

### Affected Files for image_url Issue
1. `/src/app/actions/events.ts`
2. `/src/components/EventFormSimple.tsx`
3. `/src/app/(authenticated)/events/[id]/page.tsx`
4. `/src/app/actions/eventsEnhanced.ts`
5. `/src/types/event.ts`
6. `/src/app/api/events/[id]/route.ts`
7. `/src/lib/api/schema.ts`

## Validation Queries

To verify these findings, run these queries:

```sql
-- Check events table structure
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'events' 
AND column_name LIKE '%image%';

-- Check for image_url usage in events
SELECT * FROM events WHERE image_url IS NOT NULL; -- This will fail

-- Check event_categories for faqs
SELECT column_name 
FROM information_schema.columns 
WHERE table_name = 'event_categories' 
AND column_name = 'faqs';
```

## Conclusion

The primary issue causing the error is the `image_url` field reference in the events table operations. This needs to be updated to use one of the existing image fields. Additionally, there are several unused database fields that could enhance the application if implemented in the UI.
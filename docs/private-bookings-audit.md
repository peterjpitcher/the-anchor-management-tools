# Private Bookings Functionality Audit

Generated: June 21, 2025

## Executive Summary

This document provides a comprehensive review of the private-bookings functionality in The Anchor Management Tools. The audit reveals significant inconsistencies between the database schema, view pages, and edit/create forms. Many fields present in the database and displayed on view pages are missing from the forms, limiting the system's functionality.

## Database Schema Analysis

### Core `private_bookings` Table Fields

The database schema includes 34 fields with comprehensive functionality:

#### Customer Information
- `customer_id` (UUID, FK to customers)
- `customer_name` (text, NOT NULL) - **deprecated**
- `customer_first_name` (text)
- `customer_last_name` (text)
- `customer_full_name` (text, GENERATED) - computed from first/last name
- `contact_phone` (text, UK phone format validation)
- `contact_email` (text, email format validation)

#### Event Details
- `event_date` (date, NOT NULL)
- `start_time` (time, NOT NULL)
- `setup_date` (date)
- `setup_time` (time, must be <= start_time)
- `end_time` (time, must be > start_time)
- `guest_count` (integer)
- `event_type` (text)

#### Financial Information
- `status` (text, DEFAULT 'draft') - draft/tentative/confirmed/completed/cancelled
- `deposit_amount` (numeric(10,2), DEFAULT 250.00)
- `deposit_paid_date` (timestamp)
- `deposit_payment_method` (text)
- `total_amount` (numeric(10,2), DEFAULT 0)
- `balance_due_date` (date)
- `final_payment_date` (timestamp)
- `final_payment_method` (text)

#### Discount Information
- `discount_type` (text) - percent/fixed
- `discount_amount` (numeric(10,2), DEFAULT 0)
- `discount_reason` (text)

#### Additional Fields
- `calendar_event_id` (text)
- `contract_version` (integer, DEFAULT 0)
- `internal_notes` (text)
- `customer_requests` (text)
- `special_requirements` (text) - **not in TypeScript types**
- `accessibility_needs` (text) - **not in TypeScript types**
- `source` (text) - **not in TypeScript types**
- `created_by` (UUID, FK to auth.users)
- `created_at` (timestamp)
- `updated_at` (timestamp)

### Related Tables

1. **private_booking_items** - Line items for the booking
2. **private_booking_documents** - Document storage
3. **private_booking_sms_queue** - SMS messaging queue
4. **private_booking_audit** - Audit trail

## Field Usage Analysis

### View Page ([id]/page.tsx)

The view page displays all the following fields:

✅ **Displayed Fields:**
- All customer information (including full name display)
- All event details
- All financial information with payment recording modals
- Discount information with apply discount modal
- Notes section showing:
  - customer_requests
  - internal_notes
  - special_requirements
  - accessibility_needs
- Booking source
- Booking metadata (ID, created, updated, contract version)
- Status with change modal
- Related items, documents, and SMS functionality

### Edit Page ([id]/edit/page.tsx)

The edit page only includes a subset of fields:

✅ **Included Fields:**
- customer_first_name (required)
- customer_last_name
- contact_phone
- contact_email
- event_type (dropdown with limited options)
- event_date (required)
- guest_count
- setup_time
- start_time (required)
- end_time
- customer_requests
- internal_notes

❌ **Missing Fields:**
- customer_id (no customer linking)
- setup_date
- status (cannot change status)
- All financial fields (deposit, payments, total amount)
- All discount fields
- special_requirements
- accessibility_needs
- source
- balance_due_date
- calendar_event_id
- contract_version

### Create Page (new/page.tsx)

The create page includes:

✅ **Included Fields:**
- Customer search and selection (customer_id)
- customer_first_name (required)
- customer_last_name
- contact_phone
- contact_email
- event_date (required)
- event_type (free text input)
- start_time (required)
- end_time
- guest_count
- setup_date
- setup_time
- customer_requests
- internal_notes

❌ **Missing Fields:**
- status (always defaults to 'draft')
- All financial fields
- All discount fields
- special_requirements
- accessibility_needs
- source
- balance_due_date

## Key Inconsistencies

### 1. Field Availability Gaps

**Critical Missing Fields in Forms:**
- **Financial Management**: No ability to set deposit amount, total amount, or payment methods in create/edit forms
- **Accessibility**: `special_requirements` and `accessibility_needs` fields exist in DB and are shown on view but cannot be edited
- **Business Tracking**: `source` field exists but cannot be set or edited

### 2. Type Definition Misalignments

**Database fields missing from TypeScript types:**
- `special_requirements` - Present in DB schema but commented as "not in TypeScript types"
- `accessibility_needs` - Present in DB schema but commented as "not in TypeScript types"  
- `source` - Present in DB schema but commented as "not in TypeScript types"

**Note**: These fields ARE actually in the TypeScript interface (lines 42-44), so this appears to be an incorrect comment.

### 3. Form Field Type Inconsistencies

- **event_type**: 
  - Edit page: Dropdown with fixed options (birthday, wedding, corporate, etc.)
  - Create page: Free text input
  - Should be consistent across both forms

### 4. Customer Management

- Create page has customer search/selection functionality
- Edit page does NOT allow changing the linked customer
- This could be problematic if wrong customer was selected initially

### 5. Status Management

- Status can only be changed via the view page modal
- No status field in create/edit forms
- This forces a two-step process for status changes

### 6. Financial Workflow Limitations

- Deposits and payments can only be recorded from view page
- No ability to set custom deposit amounts during creation
- Balance due date is auto-calculated but cannot be manually adjusted

## Recommendations

### High Priority

1. **Add Missing Critical Fields to Forms**
   - Add `special_requirements` and `accessibility_needs` to both create and edit forms
   - Add `source` field to track booking origin
   - Add `setup_date` to edit form (already in create form)

2. **Standardize event_type Field**
   - Use consistent input type (recommend dropdown with "Other" option)
   - Add same options to both create and edit forms

3. **Enable Customer Re-selection**
   - Add customer search to edit form
   - Allow changing linked customer if needed

### Medium Priority

4. **Financial Fields in Forms**
   - Add deposit_amount override to create form
   - Add ability to set custom balance_due_date
   - Consider adding total_amount estimate field

5. **Status Management**
   - Consider adding status field to edit form
   - Implement proper status transition rules

6. **Improve TypeScript Types**
   - Ensure all database fields are properly typed
   - Remove incorrect comments about missing fields

### Low Priority

7. **Enhanced Form Features**
   - Add calendar_event_id management
   - Add contract version tracking
   - Consider inline discount application

8. **UI/UX Improvements**
   - Add field grouping consistent with view page
   - Add tooltips for complex fields
   - Implement progressive disclosure for advanced fields

## Technical Debt

1. **customer_name Field**: Marked as deprecated but still required in DB. Should be removed in favor of first_name/last_name fields.

2. **Validation Inconsistency**: Database has phone/email regex validation but forms don't enforce the same patterns client-side.

3. **Generated Fields**: `customer_full_name` is a generated column but the logic is duplicated in TypeScript.

## Conclusion

The private bookings functionality has solid foundations but suffers from incomplete form implementations. Many fields that exist in the database and are displayed on view pages cannot be created or edited through the UI, forcing workarounds or preventing full utilization of the system's capabilities. Addressing these gaps would significantly improve the user experience and system completeness.
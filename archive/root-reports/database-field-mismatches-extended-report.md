# Extended Database Field Mismatches Report

## Overview
This report covers additional pages and components that were not included in the initial database field mismatch review.

## 1. Background Jobs Page (`/settings/background-jobs`)
**File**: `src/app/(authenticated)/settings/background-jobs/page.tsx`

### Table: `background_jobs`
All fields referenced in the component appear to be valid:
- ✅ `id`, `type`, `payload`, `status`, `priority`, `attempts`, `max_attempts`
- ✅ `scheduled_for`, `created_at`, `processed_at`, `completed_at`
- ✅ `error`, `result`, `duration_ms`

**Status**: No mismatches found

## 2. Audit Logs Page (`/settings/audit-logs`)
**File**: `src/app/(authenticated)/settings/audit-logs/page.tsx`

### Table: `audit_logs`
All fields referenced appear to be valid:
- ✅ `id`, `created_at`, `user_email`, `operation_type`, `resource_type`
- ✅ `resource_id`, `operation_status`, `ip_address`, `error_message`
- ✅ `old_values`, `new_values`, `additional_info`

**Status**: No mismatches found

## 3. API Keys Page (`/settings/api-keys`)
**File**: `src/app/(authenticated)/settings/api-keys/page.tsx`

### Tables Referenced:
- `user_roles` - Checking for super_admin role
- `api_keys` - Fetching API keys

**Potential Issue**: The code references `roles(name)` in a select query, which suggests a join with a `roles` table. Need to verify this relationship exists.

## 4. Webhook Monitor Page (`/settings/webhook-monitor`)
**File**: `src/app/(authenticated)/settings/webhook-monitor/page.tsx`

### Table: `webhook_logs`
All fields referenced appear to be valid:
- ✅ `id`, `processed_at`, `status`, `from_number`, `to_number`
- ✅ `message_body`, `message_sid`, `error_message`
- ✅ `headers`, `params`, `error_details`

**Status**: No mismatches found

## 5. Private Bookings Contract Page
**File**: `src/app/(authenticated)/private-bookings/[id]/contract/page.tsx`

This page simply redirects to an API endpoint and doesn't directly query the database.

**Status**: No database queries to check

## 6. Private Bookings Items Page
**File**: `src/app/(authenticated)/private-bookings/[id]/items/page.tsx`

### Tables Referenced (via server actions):
- `private_bookings` - Via `getPrivateBooking` action
- `booking_items` - Via `getBookingItems`, `addBookingItem`, etc.
- `venue_spaces` - Via `getVenueSpaces`
- `catering_packages` - Via `getCateringPackages`
- `vendors` - Via `getVendors`

### Fields Referenced in Interfaces:
**BookingItem**:
- `id`, `booking_id`, `item_type`, `space_id`, `package_id`, `vendor_id`
- `description`, `quantity`, `unit_price`, `discount_value`, `discount_type`
- `line_total`, `notes`

**VenueSpace**:
- `id`, `name`, `capacity`, `description`, `is_active`, `hire_cost`

**CateringPackage**:
- `id`, `name`, `description`, `per_head_cost`, `is_active`

**Vendor**:
- `id`, `name`, `vendor_type`, `contact_email`, `contact_phone`
- `is_active`, `typical_rate`

**Note**: These are TypeScript interfaces, actual database queries are in server actions which would need separate verification.

## 7. GDPR Page (`/settings/gdpr`)
**File**: `src/app/(authenticated)/settings/gdpr/page.tsx`

This page uses server actions (`exportUserData`, `deleteUserData`) and doesn't directly query the database.

**Status**: No direct database queries to check

## 8. Users Page
**File**: `src/app/(authenticated)/users/page.tsx`

Uses server actions (`getAllUsers`, `getAllRoles`) for database operations.

**Status**: No direct database queries to check

## 9. Profile Page
**File**: `src/app/(authenticated)/profile/page.tsx`

### Table: `profiles`
Fields referenced:
- ✅ `id`, `email`, `full_name`, `avatar_url`
- ✅ `created_at`, `updated_at`
- ⚠️ `sms_notifications`, `email_notifications` - Need to verify these columns exist

### Other Tables:
- `bookings` - Fetching user's bookings with customer_id
- `messages` - Fetching user's messages with customer_id
- `audit_logs` - Creating deletion request entries

**Potential Issues**:
1. The `profiles` table might not have `sms_notifications` and `email_notifications` columns
2. Uses `avatars` storage bucket for file uploads

## 10. Webhook Test Page (`/settings/webhook-test`)
**File**: `src/app/(authenticated)/settings/webhook-test/page.tsx`

### Table: `user_roles`
Queries for checking super_admin access.

**Status**: Standard role checking, no issues

## 11. Calendar Test Page (`/settings/calendar-test`)
**File**: `src/app/(authenticated)/settings/calendar-test/page.tsx`

No direct database queries, uses API endpoint for testing.

**Status**: No database queries to check

## 12. Webhook Diagnostics Page (`/settings/webhook-diagnostics`)
**File**: `src/app/(authenticated)/settings/webhook-diagnostics/page.tsx`

Uses server action (`diagnoseWebhookIssues`) for diagnostics.

**Status**: No direct database queries to check

## 13. Private Bookings Messages Page
**File**: `src/app/(authenticated)/private-bookings/[id]/messages/page.tsx`

### Types Referenced:
- `PrivateBookingWithDetails` - Custom type with many fields
- `PrivateBookingSmsQueue` - SMS queue entries

### Fields Used in Templates:
- `customer_name`, `customer_first_name`, `event_date`, `event_type`
- `guest_count`, `start_time`, `setup_time`
- `deposit_amount`, `calculated_total`, `deposit_paid_date`
- `balance_due_date`, `contact_phone`
- `sms_queue` (array of messages)

**Note**: Uses server actions for database operations. The template system references many booking fields that should be verified.

## Summary of New Findings

### Confirmed Issues:
1. **Profile Page**: References `sms_notifications` and `email_notifications` columns in the `profiles` table that may not exist

### Needs Verification:
1. **API Keys Page**: References a `roles` table relationship
2. **Private Bookings Messages**: Uses many booking fields in templates that should be verified against the schema

### No Issues Found:
- Background Jobs page
- Audit Logs page
- Webhook Monitor page
- All other pages that use server actions for database operations

## Recommendations

1. **Verify Profile Columns**: Check if the `profiles` table has `sms_notifications` and `email_notifications` columns. If not, either:
   - Add these columns via migration
   - Remove the functionality from the UI
   - Store preferences elsewhere

2. **Verify Roles Relationship**: Confirm that the `user_roles` -> `roles` relationship exists and is properly configured

3. **Review Server Actions**: While not directly visible in these components, the server actions they use should be reviewed for database field references

4. **Template Field Validation**: The private bookings message templates reference many fields. Consider adding validation to ensure all referenced fields exist before template processing.
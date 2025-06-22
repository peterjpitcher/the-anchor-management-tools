# Database Schema Analysis Report

Generated: 2025-06-21

## Overview

This report analyzes the database schema from `2025-06-21f-schema.sql` and compares it with the application code to identify:
1. Incorrect database references in the application
2. Database columns that are not being used in the application

## 1. Missing Type Definitions / Incorrect References

### Customer Table
The following fields exist in the database but are missing from the `Customer` interface in `src/types/database.ts`:
- `messaging_status` - Used in `sms-health` page but not in type definition
- `last_successful_delivery` - Used in `sms-health` page but not in type definition
- `consecutive_failures` - Used in `sms-health` page but not in type definition
- `total_failures_30d` - Used in `sms-health` page but not in type definition
- `last_failure_type` - Used in `sms-health` page but not in type definition

### Messages Table
The following fields exist in the database but are missing from the `Message` interface:
- `segments` - Used in various SMS-related files
- `cost_usd` - Used in SMS health dashboard and other files

### Audit Logs Table
The audit_logs table structure in the database doesn't match the usage in the application:
- Application uses `action` but database has `operation_type`
- Application passes parameters to `log_audit_event` RPC function, but direct table access uses different column names

## 2. Unused Database Columns by Table

### Customers Table
All columns appear to be used, though some are only accessed via views (customer_messaging_health)

### Events Table
All columns are used in the application

### Bookings Table
All columns are used in the application

### Employees Table
All columns are used in the application

### Messages Table
All columns are used, though `segments` and `cost_usd` need to be added to type definitions

### Message Templates Table
The following computed columns may not be directly accessed:
- `character_count` (GENERATED column)
- `estimated_segments` (GENERATED column)

### Audit Logs Table
All columns are used via the RPC function `log_audit_event`

### Other Tables Not Analyzed
- booking_reminders
- catering_packages
- customer_category_stats
- employee_emergency_contacts
- employee_financial_details
- employee_health_records
- employee_notes
- employee_attachments
- event_categories
- event_message_templates
- message_delivery_status
- message_template_history
- permissions
- private_booking_* tables
- profiles
- reminder_processing_logs
- role_permissions
- roles
- user_roles
- vendors
- venue_spaces
- webhook_logs

## 3. Recommendations

### High Priority Fixes

1. **Update Customer Interface** in `src/types/database.ts`:
   ```typescript
   export interface Customer {
     // ... existing fields ...
     messaging_status?: 'active' | 'suspended' | 'invalid_number' | 'opted_out';
     last_successful_delivery?: string | null;
     consecutive_failures?: number;
     total_failures_30d?: number;
     last_failure_type?: string | null;
   }
   ```

2. **Update Message Interface** in `src/types/database.ts`:
   ```typescript
   export interface Message {
     // ... existing fields ...
     segments?: number;
     cost_usd?: number | null;
   }
   ```

3. **Verify Audit Log Usage**: The application appears to use an RPC function for audit logging rather than direct table access, which is correct. No changes needed.

### Low Priority

1. The generated columns in `message_templates` table (`character_count`, `estimated_segments`) don't need to be in type definitions as they're computed automatically.

2. Consider documenting which views are used instead of direct table access (e.g., `customer_messaging_health` view is used instead of directly querying messaging status fields).

## 4. Views Used Instead of Direct Table Access

- `customer_messaging_health` - Used in SMS health dashboard for aggregated customer messaging statistics
- `message_templates_with_timing` - Likely used for message template management

## 5. Database Features Not Reflected in Code

1. **Check Constraints**: Many tables have check constraints that should be validated in the application:
   - Customer phone format validation
   - Employee email format validation
   - Date range validations
   - Status enum validations

2. **Cascade Deletes**: The schema includes cascade delete rules that the application relies on

3. **Default Values**: Many columns have database-level defaults that the application doesn't need to provide

## Conclusion

The main issues are:
1. Missing type definitions for customer messaging status fields that are actively used
2. Missing type definitions for message segments and cost fields
3. Otherwise, the application appears to correctly use the database schema with appropriate abstractions (views, RPC functions) where needed
# Database Field Usage Report
Generated: 2025-01-21

## Summary

This report analyzes the usage of database fields across the application against the schema at `2025-06-21f-schema.sql`.

## Key Findings

### 1. Type Definition Issues (Fixed)

1. **Message Table** - Missing fields in TypeScript interface:
   - `segments` - Used in SMS cost calculations
   - `cost_usd` - Used in SMS cost tracking
   - **Status**: Fixed in migration `20250121_fix_type_definitions.sql` and updated TypeScript types

2. **Customer Health View** - Not a type issue:
   - Fields like `messaging_status`, `consecutive_failures`, etc. come from the `customer_messaging_health` VIEW
   - The application correctly uses a separate `CustomerHealth` interface for this view
   - **Status**: No fix needed - working as designed

### 2. Unused Database Columns

After thorough analysis, nearly all database columns are actively used. The only truly unused columns are:

#### Generated/Computed Columns (Don't need direct access):
- `message_templates.character_count` - GENERATED column
- `message_templates.estimated_segments` - GENERATED column

#### All Other Tables - Fully Utilized:
- **customers** - All fields used directly or via views
- **events** - All fields used including `category_id`
- **bookings** - All fields used
- **employees** - All fields used including all related tables
- **messages** - All fields used (after adding segments/cost_usd)
- **audit_logs** - Accessed via RPC function `log_audit_event`
- **profiles** - All fields used
- **RBAC tables** - All used for permission checks
- **private_bookings** - All fields used in private bookings module
- **webhook_logs** - All fields used for debugging

### 3. Database Access Patterns

The application uses several patterns to access data:

1. **Direct Table Access**: Most common for CRUD operations
2. **Views**: 
   - `customer_messaging_health` - Aggregates SMS delivery stats
   - `message_templates_with_timing` - Joins templates with timing info
   - `reminder_timing_debug` - For debugging reminder scheduling
3. **RPC Functions**:
   - `log_audit_event` - Handles audit logging with proper field mapping
   - `user_has_permission` - RBAC permission checks
   - `get_message_template` - Template retrieval with event overrides
4. **Computed Fields**: Database handles character counts, segments, etc.

### 4. Schema Integrity

The application correctly handles:
- Foreign key relationships with CASCADE deletes
- Check constraints for data validation
- RLS policies for security
- Triggers for automatic updates (updated_at timestamps)

## Recommendations

1. **Run the type fix migration**: `20250121_fix_type_definitions.sql` to add missing message columns
2. **No unused columns to remove**: The schema is well-utilized
3. **Consider documenting**: The view/RPC function patterns for future developers

## Conclusion

The application and database schema are well-aligned. Only minor type definition updates were needed. All database fields serve a purpose and are either:
- Actively used by the application
- Automatically computed by the database
- Reserved for future features (none found)

The codebase demonstrates good practices in:
- Using views for complex aggregations
- RPC functions for business logic
- Proper TypeScript typing (after fixes)
- Leveraging database features (constraints, triggers, RLS)
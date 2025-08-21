# Invoice and Quote Permissions Migration Verification

## Migration File Created
- **File**: `/supabase/migrations/20250820195912_add_invoice_permissions.sql`
- **Timestamp**: 2025-08-20 19:59:12
- **Format**: Follows proper naming convention `YYYYMMDDHHMMSS_descriptive_name.sql`

## Summary of Changes

### 1. Database Permissions Added

#### Invoice Module Permissions:
- `invoices.view` - View invoices and access invoice list
- `invoices.create` - Create new invoices  
- `invoices.edit` - Edit existing invoices
- `invoices.delete` - Delete invoices
- `invoices.export` - Export invoices to PDF/Excel
- `invoices.manage` - Full management including settings and templates
- `invoices.send` - Send invoices via email

#### Quote Module Permissions:
- `quotes.view` - View quotes and access quote list
- `quotes.create` - Create new quotes
- `quotes.edit` - Edit existing quotes  
- `quotes.delete` - Delete quotes
- `quotes.export` - Export quotes to PDF/Excel
- `quotes.manage` - Full management including settings and templates
- `quotes.send` - Send quotes via email
- `quotes.convert` - Convert quotes to invoices (unique to quotes)

### 2. Role Permission Assignments

#### Super Admin (`super_admin` role):
- **Invoices**: All permissions (view, create, edit, delete, export, manage, send)
- **Quotes**: All permissions (view, create, edit, delete, export, manage, send, convert)

#### Manager (`manager` role):
- **Invoices**: All except delete (view, create, edit, export, manage, send)
- **Quotes**: All except delete (view, create, edit, export, manage, send, convert)

#### Staff (`staff` role):
- **Invoices**: View only
- **Quotes**: View only

### 3. TypeScript Types Updated

#### File: `/src/types/rbac.ts`

**Added to ModuleName type:**
```typescript
| 'quotes'  // Added to existing invoice module
```

**Added to ActionType type:**
```typescript
| 'convert'  // Added for quote-to-invoice conversion
```

## Migration Safety Features

### Idempotent Design:
- Uses `IF NOT EXISTS` checks before inserting permissions
- Uses `NOT EXISTS` checks before creating role assignments
- Safe to run multiple times without duplicating data

### Error Handling:
- Wrapped in DO blocks with proper error handling
- Will skip operations if roles don't exist
- Provides helpful log messages on completion

### Performance:
- Creates indexes for new permissions
- Optimized queries for role assignment checks

## Verification Queries

After running the migration, you can verify it worked with these SQL queries:

```sql
-- Check all invoice and quote permissions
SELECT p.module_name, p.action, p.description 
FROM permissions p 
WHERE p.module_name IN ('invoices', 'quotes')
ORDER BY p.module_name, p.action;

-- Check role assignments
SELECT r.name, p.module_name, p.action 
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module_name IN ('invoices', 'quotes')
ORDER BY r.name, p.module_name, p.action;
```

## Next Steps

1. **Apply Migration**: Run `supabase db push` to apply the migration to your database
2. **Test Permissions**: Verify that users with different roles can access appropriate invoice/quote functions
3. **Update UI**: Ensure invoice and quote interfaces use the new permission checks

## Files Modified

1. **Migration**: `/supabase/migrations/20250820195912_add_invoice_permissions.sql`
2. **Types**: `/src/types/rbac.ts`

Both files have been created/updated and the project builds successfully with no TypeScript errors.
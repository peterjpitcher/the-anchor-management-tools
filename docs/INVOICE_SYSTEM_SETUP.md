# Invoice System Setup & Testing Guide

## 📑 Document Index
**Lines 1-50: Overview & Prerequisites**
- L5-10: System Overview
- L12-25: Prerequisites
- L27-50: Migration Steps

**Lines 51-150: Database Setup**
- L51-75: Running Migrations
- L76-100: Verifying Tables
- L101-150: Permission Configuration

**Lines 151-250: Configuration**
- L151-175: Environment Variables
- L176-200: Email Setup
- L201-250: Cron Jobs

**Lines 251-400: Testing Guide**
- L251-300: Basic Functionality Tests
- L301-350: Advanced Features
- L351-400: Troubleshooting

## System Overview

The Anchor Management Tools invoice system is a comprehensive billing solution featuring:
- Full invoice management with PDF generation
- Quote system with conversion to invoices
- Recurring invoice automation
- Payment tracking and reminders
- Email integration via Microsoft Graph API
- Vendor and catalog management

## Prerequisites

### Required Environment Variables
```bash
# Microsoft Graph API (for email)
MICROSOFT_TENANT_ID=your_tenant_id
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_USER_EMAIL=your_email@domain.com

# Cron Job Secret
CRON_SECRET=your_cron_secret

# Supabase
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
```

## 🚀 Setup Steps

### Step 1: Apply Database Migrations

```bash
# Apply the permissions migration
supabase db push supabase/migrations/20250820195912_add_invoice_permissions.sql

# Initialize invoice series
supabase db push supabase/migrations/20250820200100_initialize_invoice_series.sql
```

### Step 2: Verify Database State

Run the diagnostic SQL directly in Supabase SQL Editor:

```sql
-- Check if invoice permissions were added
SELECT COUNT(*) as permission_count
FROM permissions 
WHERE module_name IN ('invoices', 'quotes');
-- Expected: 15 (7 for invoices, 8 for quotes)

-- Check role assignments
SELECT r.name as role_name, COUNT(p.id) as permission_count
FROM roles r
JOIN role_permissions rp ON r.id = rp.role_id
JOIN permissions p ON rp.permission_id = p.id
WHERE p.module_name IN ('invoices', 'quotes')
GROUP BY r.name
ORDER BY r.name;
-- Expected: super_admin (15), manager (13), staff (2)

-- Check invoice series initialization
SELECT * FROM invoice_series;
-- Expected: INV and QTE series with current_sequence = 0

-- Check if tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name LIKE '%invoice%'
ORDER BY table_name;
-- Expected: 13+ invoice-related tables
```

### Step 3: Verify User Roles

```sql
-- Check your user's role
SELECT 
  u.email,
  r.name as role_name
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'your_email@example.com';
```

### Step 4: Test Email Configuration (Optional)

```typescript
// Run this test script
tsx scripts/test-microsoft-graph.ts
```

## 📊 Testing the Invoice System

### Basic Functionality Tests

1. **Access Invoice List**
   - Navigate to `/invoices`
   - Should see empty list with "Create Invoice" button
   - Summary cards should display (Outstanding, Overdue, etc.)

2. **Create First Vendor**
   - Go to `/invoices/vendors`
   - Click "Add Vendor"
   - Fill in vendor details
   - Save and verify in list

3. **Create Line Item Catalog (Optional)**
   - Go to `/invoices/catalog`
   - Add common items/services
   - Set default prices and VAT rates

4. **Create First Invoice**
   - Click "Create Invoice" from `/invoices`
   - Select vendor
   - Add line items (manual or from catalog)
   - Set payment terms
   - Save as draft
   - Invoice number should be INV-001

5. **Test Invoice Operations**
   - View invoice details
   - Edit draft invoice
   - Change status to "Sent"
   - Download PDF
   - Record payment
   - Check status updates

### Advanced Features

6. **Test Quote System**
   - Navigate to `/quotes`
   - Create new quote
   - Convert accepted quote to invoice

7. **Setup Recurring Invoice**
   - Go to `/invoices/recurring`
   - Create recurring template
   - Set frequency (monthly/quarterly/yearly)
   - Verify next invoice date

8. **Test Email Functionality**
   - Open an invoice
   - Click "Send Invoice"
   - Enter recipient email
   - Check email delivery

9. **Test Export**
   - Go to `/invoices/export`
   - Select date range
   - Export to CSV/ZIP
   - Verify file contents

### Mobile Testing

10. **Responsive Design**
    - Test on mobile device/browser
    - Check navigation menu
    - Test form inputs
    - Verify table/card views

## 🔧 Troubleshooting

### Common Issues

#### "You don't have permission to view invoices"
- User lacks invoice permissions
- Run permission check SQL above
- Ensure user has appropriate role

#### Invoice number not generating
- Invoice series not initialized
- Run the initialize_invoice_series migration
- Check invoice_series table has INV/QTE entries

#### PDF download fails
- Check Puppeteer installation: `npm ls puppeteer`
- Verify serverless function memory limits
- Check browser console for errors

#### Email not sending
- Microsoft Graph API not configured
- Check environment variables
- Test with `tsx scripts/test-microsoft-graph.ts`
- Verify MICROSOFT_USER_EMAIL is correct

#### Recurring invoices not generating
- Check cron job configuration in vercel.json
- Verify CRON_SECRET is set
- Check `/api/cron/recurring-invoices` endpoint
- Review logs for cron execution

### Verification Scripts

```bash
# Check invoice system health
tsx scripts/check-invoice-system.ts

# Test connectivity
tsx scripts/test-connectivity.ts

# Verify permissions
tsx scripts/check-permissions.ts
```

## 📅 Cron Job Configuration

### Vercel Cron Jobs (vercel.json)
```json
{
  "crons": [
    {
      "path": "/api/cron/recurring-invoices",
      "schedule": "0 8 * * *"
    },
    {
      "path": "/api/cron/invoice-reminders",
      "schedule": "0 10 * * *"
    }
  ]
}
```

### Manual Testing
- Visit `/settings/cron-test` to manually trigger cron jobs
- Check audit logs for execution history

## 🎯 Production Checklist

- [ ] All environment variables set
- [ ] Database migrations applied
- [ ] Invoice series initialized
- [ ] Permissions configured
- [ ] User roles assigned
- [ ] Email configuration tested
- [ ] PDF generation verified
- [ ] Cron jobs active
- [ ] First invoice created successfully
- [ ] Audit logging confirmed

## 📈 Monitoring

### Key Metrics to Track
- Invoice creation rate
- Payment collection rate
- Overdue invoice count
- Email delivery success
- Cron job execution
- PDF generation performance

### Audit Trail
All invoice operations are logged in `audit_logs` table:
```sql
SELECT * FROM audit_logs 
WHERE entity_type IN ('invoice', 'quote', 'payment')
ORDER BY created_at DESC
LIMIT 20;
```

## 🔐 Security Notes

1. **Never expose** SUPABASE_SERVICE_ROLE_KEY to client
2. **Always validate** permissions before operations
3. **Audit log** all financial transactions
4. **Sanitize** user inputs in invoice descriptions
5. **Use signed URLs** for PDF downloads
6. **Verify webhook** signatures for payment processors

## 📚 Additional Resources

- [Invoice API Documentation](/docs/api-reference.md#invoices)
- [Database Schema](/docs/database-schema.md#invoice-tables)
- [Email Templates](/src/lib/email-templates/)
- [PDF Templates](/src/lib/invoice-template.ts)

## Support

For issues or questions:
1. Check audit logs for errors
2. Review browser console for client errors
3. Check Vercel function logs for server errors
4. Contact support with error details and timestamps
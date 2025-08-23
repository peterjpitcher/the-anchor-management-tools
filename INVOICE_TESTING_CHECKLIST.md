# 🎉 Invoice System Testing Checklist

**Database Push Complete!** Now let's verify everything is working correctly.

## ✅ Quick Verification (Do This First)

Run this SQL in your Supabase SQL Editor to confirm setup:

```sql
-- Quick health check
SELECT 
  (SELECT COUNT(*) FROM permissions WHERE module_name IN ('invoices', 'quotes')) as permissions_count,
  (SELECT COUNT(*) FROM invoice_series WHERE series_code IN ('INV', 'QTE')) as series_count,
  (SELECT COUNT(*) FROM roles r 
   JOIN role_permissions rp ON r.id = rp.role_id 
   JOIN permissions p ON rp.permission_id = p.id 
   WHERE p.module_name = 'invoices') as roles_with_access;
```

**Expected Results:**
- permissions_count: 15
- series_count: 2  
- roles_with_access: 3 or more

## 📋 Testing Checklist

### 1️⃣ Basic Access Test
- [ ] Navigate to https://management.orangejelly.co.uk/invoices
- [ ] Page should load without errors
- [ ] You should see:
  - Empty invoice list
  - "Create Invoice" button
  - Summary cards (Outstanding, Overdue, This Month, Drafts)
  - Navigation tabs for Vendors, Catalog, Recurring, Export

### 2️⃣ Create Your First Vendor
- [ ] Click on "Vendors" tab or go to `/invoices/vendors`
- [ ] Click "Add Vendor"
- [ ] Fill in test vendor details:
  - Name: "Test Customer Ltd"
  - Contact: "John Doe"
  - Email: "test@example.com"
  - Payment Terms: 30 days
- [ ] Save vendor
- [ ] Verify vendor appears in list

### 3️⃣ Create Your First Invoice
- [ ] Click "Create Invoice" from main invoices page
- [ ] Select the vendor you just created
- [ ] Add a line item:
  - Description: "Test Service"
  - Quantity: 1
  - Unit Price: £100
  - VAT Rate: 20%
- [ ] Verify calculations:
  - Subtotal: £100.00
  - VAT: £20.00
  - Total: £120.00
- [ ] Add optional reference: "TEST-001"
- [ ] Save as Draft
- [ ] **Invoice number should be INV-001**

### 4️⃣ Test Invoice Operations
- [ ] View the invoice you created
- [ ] Click "Edit" - should open edit form
- [ ] Change status to "Sent"
- [ ] Try "Download PDF" - should generate PDF
- [ ] Click "Record Payment":
  - Amount: £120
  - Method: Bank Transfer
  - Reference: "PAYMENT-001"
- [ ] Verify status changes to "Paid"

### 5️⃣ Test Quote System
- [ ] Navigate to `/quotes`
- [ ] Create a new quote
- [ ] Add line items
- [ ] Save quote (should be QTE-001)
- [ ] View quote details
- [ ] If quote status is "Accepted", test "Convert to Invoice"

### 6️⃣ Test Recurring Invoices
- [ ] Go to `/invoices/recurring`
- [ ] Click "Create Recurring Invoice"
- [ ] Set up a monthly recurring invoice
- [ ] Verify "Next Invoice Date" is shown
- [ ] Save template

### 7️⃣ Test Additional Features
- [ ] **Line Item Catalog** (`/invoices/catalog`)
  - Add a catalog item
  - Use it in a new invoice
- [ ] **Export** (`/invoices/export`)
  - Select date range
  - Export to CSV
- [ ] **Email** (if Microsoft Graph configured)
  - Open an invoice
  - Click "Send Invoice"
  - Test email delivery

### 8️⃣ Mobile Responsiveness
- [ ] Open invoice pages on mobile device/responsive mode
- [ ] Check navigation works
- [ ] Test creating invoice on mobile
- [ ] Verify tables switch to card view

## 🔍 Troubleshooting

### If you see "Permission Denied"
```sql
-- Check your user's role
SELECT u.email, r.name as role
FROM auth.users u
JOIN user_roles ur ON u.id = ur.user_id  
JOIN roles r ON ur.role_id = r.id
WHERE u.email = 'your-email@example.com';
```

### If invoice number isn't generating
```sql
-- Check series initialization
SELECT * FROM invoice_series;
-- If empty, run:
INSERT INTO invoice_series (series_code, current_sequence) 
VALUES ('INV', 0), ('QTE', 0);
```

### If PDF download fails
- Check browser console for errors
- Verify Puppeteer is installed: `npm ls puppeteer`
- May need to deploy to Vercel for serverless function

### If email isn't working
- Microsoft Graph API credentials needed in environment
- Check: MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, MICROSOFT_TENANT_ID

## 📊 Success Metrics

After testing, you should have:
- ✅ At least 1 vendor created
- ✅ At least 1 invoice (INV-001)
- ✅ At least 1 quote (QTE-001) 
- ✅ Successful PDF generation
- ✅ Working payment recording
- ✅ Status transitions working
- ✅ Optional: Recurring invoice template
- ✅ Optional: Catalog items

## 🎯 Next Steps

Once basic testing is complete:

1. **Production Data Setup**
   - Import real vendors
   - Create actual catalog items
   - Set up recurring invoices for regular clients

2. **Email Configuration**
   - Test with real email addresses
   - Customize email templates if needed

3. **Automation**
   - Verify cron jobs are running
   - Test payment reminders
   - Monitor recurring invoice generation

4. **Training**
   - Train staff on invoice creation
   - Document your specific workflows
   - Set up approval processes if needed

## 🚀 Quick Commands

```bash
# Check system health
tsx scripts/test-invoice-setup.sql

# View recent audit logs
SELECT * FROM audit_logs 
WHERE entity_type IN ('invoice', 'quote', 'payment')
ORDER BY created_at DESC LIMIT 10;

# Check for any errors
SELECT * FROM invoice_audit 
WHERE action LIKE '%error%' 
ORDER BY created_at DESC;
```

## ✨ Congratulations!

Your invoice system is now active! The repeating invoice functionality has been restored and you have access to:
- Full invoice management
- Quote system with conversion
- Recurring invoice automation
- Payment tracking
- PDF generation
- Email integration
- Vendor management
- Audit trail

Report any issues with specific error messages and timestamps for quick resolution.
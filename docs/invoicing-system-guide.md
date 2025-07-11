# Invoicing System User Guide

## Overview

The Orange Jelly Limited invoicing system provides comprehensive invoice and quote management with UK VAT compliance, payment tracking, and vendor management capabilities.

## Access Requirements

- **Role Required**: Super Admin only
- **Module**: Invoices
- **Location**: Main menu → Invoices

## Features

### 1. Invoice Management

#### Creating an Invoice
1. Navigate to **Invoices** from the main menu
2. Click **New Invoice**
3. Fill in the invoice details:
   - **Vendor**: Select from existing vendors or create new
   - **Invoice Date**: Defaults to today
   - **Due Date**: Payment due date
   - **Reference**: Optional PO number or reference
   - **Line Items**: Add products/services with:
     - Description
     - Quantity
     - Unit Price (excluding VAT)
     - Line Discount %
     - VAT Rate (0%, 5%, or 20%)
   - **Invoice Discount**: Optional discount applied to entire invoice
   - **Notes**: Visible on invoice
   - **Internal Notes**: For internal reference only

#### Invoice Statuses
- **Draft**: Not yet sent to vendor
- **Sent**: Invoice has been sent
- **Partially Paid**: Some payment received
- **Paid**: Fully paid
- **Overdue**: Past due date
- **Void**: Cancelled invoice
- **Written Off**: Bad debt

#### Recording Payments
1. Open the invoice
2. Click **Record Payment**
3. Enter payment details:
   - Payment Date
   - Amount (up to outstanding balance)
   - Payment Method
   - Reference (e.g., transaction ID)
   - Notes

#### Bulk Export
1. Go to **Invoices** → **Export**
2. Select date range or use presets (Q1-Q4, This Year, Last Year)
3. Choose status filter (All, Paid Only, Unpaid Only)
4. Click **Export Invoices**
5. Download ZIP file containing:
   - Individual HTML files for each invoice
   - CSV summary of all invoices
   - README with export details

### 2. Quote Management

#### Creating a Quote
1. Navigate to **Quotes** from invoices menu
2. Click **New Quote**
3. Fill in quote details:
   - **Vendor**: Select existing vendor
   - **Quote Date**: Date of quote
   - **Valid Until**: Expiry date
   - **Reference**: Optional reference
   - **Line Items**: Same as invoices
   - **Quote Discount**: Optional overall discount
   - **Notes**: Visible on quote

#### Quote Workflow
1. **Draft** → Can be edited
2. **Sent** → Mark when sent to vendor
3. **Accepted/Rejected** → Update based on vendor response
4. **Expired** → Automatically set after valid until date
5. **Convert to Invoice** → Create invoice from accepted quote

#### Converting Quote to Invoice
1. Quote must be in "Accepted" status
2. Click **Convert to Invoice** on the quote
3. Review conversion details
4. Confirm to create draft invoice
5. Quote is marked as converted

### 3. Vendor Management

#### Adding a Vendor
1. Go to **Invoices** → **Vendors**
2. Click **Add Vendor**
3. Enter vendor details:
   - Company Name
   - Contact Name
   - Email
   - Phone
   - Address
   - VAT Number
   - Payment Terms (days)
   - Notes

#### Managing Vendors
- **Edit**: Update vendor details
- **Delete**: Only if no invoices exist
- **Soft Delete**: Vendors with invoices are deactivated

### 4. VAT & Pricing

#### VAT Calculation
- All prices entered exclude VAT
- VAT is calculated on top of net prices
- Standard UK VAT rates: 0%, 5%, 20%
- VAT calculated after all discounts

#### Discount Application
1. **Line Item Discounts**: Applied to individual items
2. **Invoice/Quote Discount**: Applied to subtotal after line discounts
3. **Order of calculation**:
   - Line subtotal
   - Line discount
   - Invoice discount
   - VAT calculation
   - Final total

### 5. Invoice Numbering

- **Format**: INV-XXXXX (e.g., INV-03QD)
- **Quotes**: QTE-XXXXX (e.g., QTE-00ABC)
- Numbers appear random but maintain sequential integrity
- Cannot be manually changed

## Key Information

### Company Details on Invoices
- Orange Jelly Limited
- VAT Number: 315203647
- Company Registration: 08869155
- Bank Details: Included on all invoices

### Payment Information
- Bank: Starling Bank
- Account Name: Orange Jelly Limited
- Sort Code: 60-83-71
- Account Number: 63773124

### Important Notes

1. **Audit Trail**: All actions are logged with user, timestamp, and details
2. **Permissions**: Only super admins can access invoicing features
3. **Data Retention**: Deleted items are soft-deleted for audit purposes
4. **PDF Generation**: Use browser print function or Download button
5. **Email Sending**: Available via Send Email button (requires Microsoft Graph configuration)

## Common Tasks

### Finding an Invoice
1. Use search box to find by:
   - Invoice number
   - Vendor name
   - Reference
2. Filter by status using dropdown
3. Sort by clicking column headers

### Checking Outstanding Payments
- Dashboard shows summary cards:
  - Total Outstanding
  - Overdue Amount
  - This Month's Collections
  - Draft Count

### Year-End Export
1. Go to Export page
2. Select "Last Year" preset
3. Choose "All Invoices"
4. Export for accountant submission

### Handling Refunds
1. Create a credit note (negative invoice)
2. Link to original invoice in reference
3. Record as paid when refund processed

### Sending Invoices by Email
1. Open the invoice or quote
2. Click **Send Email** button (only visible if email is configured)
3. Review/edit the email details:
   - Recipient email (pre-filled from vendor)
   - Subject line
   - Email body message
4. Click **Send Email**
5. Invoice/Quote status automatically updates to "Sent"
6. Email history is logged for audit trail

## Troubleshooting

### Can't Delete Vendor
- Check if vendor has invoices
- Use vendor list to find associations
- Deactivate instead of delete

### Invoice Won't Save
- Ensure all required fields filled
- Check line items have descriptions
- Verify VAT rates are valid

### Payment Exceeds Invoice
- System prevents overpayment
- Check outstanding balance
- Record multiple partial payments if needed

### Quote Won't Convert
- Must be in "Accepted" status
- Cannot already be converted
- Check for any validation errors

## Best Practices

1. **Regular Exports**: Export monthly for backup
2. **Payment Recording**: Record same day as received
3. **Status Updates**: Keep statuses current
4. **Internal Notes**: Use for important reminders
5. **Vendor Details**: Keep VAT numbers updated
6. **Quote Validity**: Set reasonable expiry dates
7. **Reference Numbers**: Use client PO numbers

### Email Not Working
- Check Microsoft Graph configuration in .env
- Ensure all required credentials are set:
  - MICROSOFT_TENANT_ID
  - MICROSOFT_CLIENT_ID
  - MICROSOFT_CLIENT_SECRET
  - MICROSOFT_USER_EMAIL
- Verify app has Mail.Send permission in Azure AD

## Future Enhancements

- Recurring invoice automation
- Payment reminder system
- Multi-currency support
- Advanced reporting dashboard
- Invoice templates
- Credit note management

---

For technical support or feature requests, contact the development team.
# Invoice System GENERATED Columns Fix

## Issue Summary

The `convertQuoteToInvoice` function in `src/app/actions/quotes.ts` was attempting to insert values into GENERATED columns when creating invoice line items from quote line items. This caused the following PostgreSQL error:

```
cannot insert a non-DEFAULT value into column "subtotal_amount"
```

## Root Cause

The invoice system uses PostgreSQL GENERATED columns for automatic calculations:

### Tables with GENERATED Columns:
1. **invoice_line_items**
   - `subtotal_amount` - GENERATED ALWAYS AS (quantity * unit_price) STORED
   - `discount_amount` - GENERATED ALWAYS AS (quantity * unit_price * discount_percentage / 100) STORED
   - `vat_amount` - GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * vat_rate / 100) STORED
   - `total_amount` - GENERATED ALWAYS AS ((quantity * unit_price - quantity * unit_price * discount_percentage / 100) * (1 + vat_rate / 100)) STORED

2. **quote_line_items**
   - Same GENERATED columns as invoice_line_items

### Tables WITHOUT GENERATED Columns:
- **recurring_invoice_line_items** - Uses regular columns, no GENERATED columns

## The Fix

### File: `src/app/actions/quotes.ts`

**Before (lines 559-571):**
```typescript
const invoiceLineItems = quote.line_items.map((item: QuoteLineItem) => ({
  invoice_id: invoice.id,
  catalog_item_id: item.catalog_item_id,
  description: item.description,
  quantity: item.quantity,
  unit_price: item.unit_price,
  discount_percentage: item.discount_percentage,
  vat_rate: item.vat_rate,
  subtotal_amount: item.subtotal_amount,  // ❌ GENERATED column
  discount_amount: item.discount_amount,  // ❌ GENERATED column
  vat_amount: item.vat_amount,           // ❌ GENERATED column
  total_amount: item.total_amount        // ❌ GENERATED column
}))
```

**After:**
```typescript
const invoiceLineItems = quote.line_items.map((item: QuoteLineItem) => ({
  invoice_id: invoice.id,
  catalog_item_id: item.catalog_item_id,
  description: item.description,
  quantity: item.quantity,
  unit_price: item.unit_price,
  discount_percentage: item.discount_percentage,
  vat_rate: item.vat_rate
  // Note: subtotal_amount, discount_amount, vat_amount, and total_amount are GENERATED columns
  // and will be automatically calculated by the database
}))
```

## Other Code Locations Checked

All other insert operations were verified to be correct:

1. **src/app/actions/invoices.ts**
   - `createInvoice` (line 220-228) - Correctly excludes GENERATED columns
   - `updateInvoice` (line 820-829) - Correctly excludes GENERATED columns

2. **src/app/actions/quotes.ts**
   - `createQuote` (line 217-228) - Correctly excludes GENERATED columns
   - `updateQuote` (line 439-452) - Correctly excludes GENERATED columns

3. **src/app/actions/recurring-invoices.ts**
   - `createRecurringInvoice` (line 190-200) - No GENERATED columns in this table
   - `updateRecurringInvoice` (line 290-300) - No GENERATED columns in this table

## Best Practices

When inserting into tables with GENERATED columns:

1. **Only include source columns** - quantity, unit_price, discount_percentage, vat_rate
2. **Never include GENERATED columns** - subtotal_amount, discount_amount, vat_amount, total_amount
3. **Let PostgreSQL calculate** - The database will automatically compute GENERATED column values

## Testing

The fix was tested with:
1. Direct database inserts confirming GENERATED column behavior
2. Quote to invoice conversion test script
3. Full build and lint verification

All tests passed successfully, confirming the fix resolves the issue without introducing new problems.
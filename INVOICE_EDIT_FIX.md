# ✅ Recurring Invoice Edit Error Fixed

## 🔍 Issue
**Error**: `TypeError: formData.get is not a function` when trying to edit a recurring invoice

## 🔧 Root Cause
The `updateRecurringInvoice` server action expects a single `FormData` parameter with the ID included in it, but the edit page was calling it with two parameters: `updateRecurringInvoice(id, formData)`.

## ✅ Solution Applied
Modified `/src/app/(authenticated)/invoices/recurring/[id]/edit/page.tsx`:

### Before:
```typescript
const formData = new FormData()
formData.append('vendor_id', vendorId)
// ... other fields
const result = await updateRecurringInvoice(id, formData)  // ❌ Wrong
```

### After:
```typescript
const formData = new FormData()
formData.append('id', id)  // ✅ Include ID in FormData
formData.append('vendor_id', vendorId)
// ... other fields
const result = await updateRecurringInvoice(formData)  // ✅ Correct
```

## 🧪 Testing Steps

1. Navigate to `/invoices/recurring`
2. Click on any recurring invoice to view details
3. Click "Edit" button
4. Make changes to the recurring invoice
5. Click "Update Recurring Invoice"
6. ✅ Should save successfully without errors

## 📝 Additional Notes

The server action signature is:
```typescript
export async function updateRecurringInvoice(formData: FormData)
```

It expects the ID to be included in the FormData, not as a separate parameter. This follows the same pattern as other server actions in the codebase.

## ✨ Result
Recurring invoice editing now works correctly without the `formData.get is not a function` error.
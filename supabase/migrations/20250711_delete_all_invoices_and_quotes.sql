-- Description: Delete all invoices, quotes, and recurring invoices from the system
-- WARNING: This will permanently delete all invoice and quote data!

-- Delete all invoice line items first (due to foreign key constraints)
DELETE FROM invoice_line_items;

-- Delete all invoices
DELETE FROM invoices;

-- Delete all quote line items
DELETE FROM quote_line_items;

-- Delete all quotes
DELETE FROM quotes;

-- Delete all recurring invoice line items
DELETE FROM recurring_invoice_line_items;

-- Delete all recurring invoices
DELETE FROM recurring_invoices;

-- Reset the invoice number sequences back to 1
UPDATE invoice_series 
SET current_sequence = 0 
WHERE series_code IN ('INV', 'QTE');

-- Log this cleanup operation
INSERT INTO audit_logs (
  user_id,
  operation_type,
  resource_type,
  operation_status,
  additional_info
) VALUES (
  auth.uid(),
  'bulk_delete',
  'invoices_and_quotes',
  'success',
  jsonb_build_object(
    'description', 'Deleted all invoices, quotes, and recurring invoices from the system',
    'deleted_at', NOW()
  )
);
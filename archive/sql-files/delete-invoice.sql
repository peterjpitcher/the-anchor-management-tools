-- Delete a specific invoice and its line items
-- Invoice ID: fcee02c7-a0c4-4a85-8bb7-4361f3ff3bcf

-- First delete the line items
DELETE FROM invoice_line_items 
WHERE invoice_id = 'fcee02c7-a0c4-4a85-8bb7-4361f3ff3bcf';

-- Then delete the invoice
DELETE FROM invoices 
WHERE id = 'fcee02c7-a0c4-4a85-8bb7-4361f3ff3bcf';

-- Verify deletion
SELECT 'Invoice deleted successfully' as status;
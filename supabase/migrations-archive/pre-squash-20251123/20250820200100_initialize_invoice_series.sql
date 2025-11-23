-- Description: Initialize invoice series for invoice and quote numbering
-- This ensures the invoice_series table has the required series codes

-- Initialize invoice series (INV for invoices, QTE for quotes)
INSERT INTO invoice_series (series_code, current_sequence)
VALUES 
  ('INV', 0),
  ('QTE', 0)
ON CONFLICT (series_code) 
DO NOTHING;

-- Verify the series exist
DO $$
DECLARE
  inv_count INTEGER;
  qte_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO inv_count FROM invoice_series WHERE series_code = 'INV';
  SELECT COUNT(*) INTO qte_count FROM invoice_series WHERE series_code = 'QTE';
  
  IF inv_count > 0 AND qte_count > 0 THEN
    RAISE NOTICE 'Invoice series initialized successfully: INV and QTE series ready';
  ELSE
    RAISE WARNING 'Invoice series initialization may have failed. Please check manually.';
  END IF;
END $$;
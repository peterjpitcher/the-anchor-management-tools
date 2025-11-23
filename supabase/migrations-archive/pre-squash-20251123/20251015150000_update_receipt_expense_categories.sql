-- Align receipt expense categories with updated accounting list
BEGIN;

-- Drop existing validation constraints so remapping can use the new labels safely
ALTER TABLE receipt_transactions
  DROP CONSTRAINT IF EXISTS receipt_transactions_expense_category_valid;

ALTER TABLE receipt_rules
  DROP CONSTRAINT IF EXISTS receipt_rules_expense_category_valid;

-- Remap existing transaction expense categories to the new labels
UPDATE receipt_transactions
SET expense_category = CASE expense_category
  WHEN 'Wages & Salaries inc NI' THEN 'Total Staff'
  WHEN 'Business Rates' THEN 'Business Rate'
  WHEN 'Heat / Light / Power' THEN 'Heat/Light/Power'
  WHEN 'Repairs & Maintenance' THEN 'Premises Repairs/Maintenance'
  WHEN 'Insurance & MSA' THEN 'Maintenance and Service Plan Charges'
  WHEN 'Sky & PRS' THEN 'Sky / PRS / Vidimix'
  WHEN 'Marketing, Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE expense_category
END
WHERE expense_category IN (
  'Wages & Salaries inc NI',
  'Business Rates',
  'Heat / Light / Power',
  'Repairs & Maintenance',
  'Insurance & MSA',
  'Sky & PRS',
  'Marketing, Promotional & Advertising',
  'Print / Post & Stationery',
  'Travel & Car',
  'Cleaning Materials & Waste Disposal',
  'Accountant / Stock taker / Prof fees',
  'Bank Charges',
  'Sundries & Consumables'
);

-- Remap rule default expense categories to the new labels
UPDATE receipt_rules
SET set_expense_category = CASE set_expense_category
  WHEN 'Wages & Salaries inc NI' THEN 'Total Staff'
  WHEN 'Business Rates' THEN 'Business Rate'
  WHEN 'Heat / Light / Power' THEN 'Heat/Light/Power'
  WHEN 'Repairs & Maintenance' THEN 'Premises Repairs/Maintenance'
  WHEN 'Insurance & MSA' THEN 'Maintenance and Service Plan Charges'
  WHEN 'Sky & PRS' THEN 'Sky / PRS / Vidimix'
  WHEN 'Marketing, Promotional & Advertising' THEN 'Marketing/Promotion/Advertising'
  WHEN 'Print / Post & Stationery' THEN 'Print/Post Stationary'
  WHEN 'Travel & Car' THEN 'Travel/Car'
  WHEN 'Cleaning Materials & Waste Disposal' THEN 'Waste Disposal/Cleaning/Hygiene'
  WHEN 'Accountant / Stock taker / Prof fees' THEN 'Accountant/StockTaker/Professional Fees'
  WHEN 'Bank Charges' THEN 'Bank Charges/Credit Card Commission'
  WHEN 'Sundries & Consumables' THEN 'Sundries/Consumables'
  ELSE set_expense_category
END
WHERE set_expense_category IN (
  'Wages & Salaries inc NI',
  'Business Rates',
  'Heat / Light / Power',
  'Repairs & Maintenance',
  'Insurance & MSA',
  'Sky & PRS',
  'Marketing, Promotional & Advertising',
  'Print / Post & Stationery',
  'Travel & Car',
  'Cleaning Materials & Waste Disposal',
  'Accountant / Stock taker / Prof fees',
  'Bank Charges',
  'Sundries & Consumables'
);

-- Make sure saved P&L targets and manual actuals align with the new metric keys
UPDATE pl_targets
SET metric_key = CASE metric_key
  WHEN 'wages_salaries' THEN 'total_staff'
  WHEN 'business_rates' THEN 'business_rate'
  WHEN 'repairs_maintenance' THEN 'premises_repairs_maintenance'
  WHEN 'insurance_msa' THEN 'maintenance_service_plans'
  WHEN 'sky_prs' THEN 'sky_prs_vidimix'
  WHEN 'marketing' THEN 'marketing_promotion_advertising'
  WHEN 'print_post_stationery' THEN 'print_post_stationary'
  WHEN 'cleaning_waste' THEN 'waste_disposal_cleaning_hygiene'
  WHEN 'professional_fees' THEN 'accountant_stocktaker_professional_fees'
  WHEN 'bank_charges' THEN 'bank_charges_credit_card_commission'
  ELSE metric_key
END
WHERE metric_key IN (
  'wages_salaries',
  'business_rates',
  'repairs_maintenance',
  'insurance_msa',
  'sky_prs',
  'marketing',
  'print_post_stationery',
  'cleaning_waste',
  'professional_fees',
  'bank_charges'
);

UPDATE pl_manual_actuals
SET metric_key = CASE metric_key
  WHEN 'wages_salaries' THEN 'total_staff'
  WHEN 'business_rates' THEN 'business_rate'
  WHEN 'repairs_maintenance' THEN 'premises_repairs_maintenance'
  WHEN 'insurance_msa' THEN 'maintenance_service_plans'
  WHEN 'sky_prs' THEN 'sky_prs_vidimix'
  WHEN 'marketing' THEN 'marketing_promotion_advertising'
  WHEN 'print_post_stationery' THEN 'print_post_stationary'
  WHEN 'cleaning_waste' THEN 'waste_disposal_cleaning_hygiene'
  WHEN 'professional_fees' THEN 'accountant_stocktaker_professional_fees'
  WHEN 'bank_charges' THEN 'bank_charges_credit_card_commission'
  ELSE metric_key
END
WHERE metric_key IN (
  'wages_salaries',
  'business_rates',
  'repairs_maintenance',
  'insurance_msa',
  'sky_prs',
  'marketing',
  'print_post_stationery',
  'cleaning_waste',
  'professional_fees',
  'bank_charges'
);

-- Refresh validation constraints to use the new category list
ALTER TABLE receipt_transactions
  ADD CONSTRAINT receipt_transactions_expense_category_valid
    CHECK (
      expense_category IS NULL OR expense_category IN (
        'Total Staff',
        'Business Rate',
        'Water Rates',
        'Heat/Light/Power',
        'Premises Repairs/Maintenance',
        'Equipment Repairs/Maintenance',
        'Gardening Expenses',
        'Buildings Insurance',
        'Maintenance and Service Plan Charges',
        'Licensing',
        'Tenant Insurance',
        'Entertainment',
        'Sky / PRS / Vidimix',
        'Marketing/Promotion/Advertising',
        'Print/Post Stationary',
        'Telephone',
        'Travel/Car',
        'Waste Disposal/Cleaning/Hygiene',
        'Third Party Booking Fee',
        'Accountant/StockTaker/Professional Fees',
        'Bank Charges/Credit Card Commission',
        'Equipment Hire',
        'Sundries/Consumables',
        'Drinks Gas'
      )
    );

ALTER TABLE receipt_rules
  ADD CONSTRAINT receipt_rules_expense_category_valid
    CHECK (
      set_expense_category IS NULL OR set_expense_category IN (
        'Total Staff',
        'Business Rate',
        'Water Rates',
        'Heat/Light/Power',
        'Premises Repairs/Maintenance',
        'Equipment Repairs/Maintenance',
        'Gardening Expenses',
        'Buildings Insurance',
        'Maintenance and Service Plan Charges',
        'Licensing',
        'Tenant Insurance',
        'Entertainment',
        'Sky / PRS / Vidimix',
        'Marketing/Promotion/Advertising',
        'Print/Post Stationary',
        'Telephone',
        'Travel/Car',
        'Waste Disposal/Cleaning/Hygiene',
        'Third Party Booking Fee',
        'Accountant/StockTaker/Professional Fees',
        'Bank Charges/Credit Card Commission',
        'Equipment Hire',
        'Sundries/Consumables',
        'Drinks Gas'
      )
    );

COMMIT;

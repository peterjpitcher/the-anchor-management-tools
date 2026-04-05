-- Update default mileage rate from £0.42 to £0.45 for all vendors
UPDATE public.oj_vendor_billing_settings
SET mileage_rate = 0.45
WHERE mileage_rate = 0.42;

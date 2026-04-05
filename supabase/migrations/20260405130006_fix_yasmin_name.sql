-- Fix Yasmin → Yasmin Janvtih (correct full name for the cleaner)
UPDATE public.expenses SET company_ref = 'Yasmin Janvtih' WHERE company_ref = 'Yasmin';

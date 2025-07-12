-- Remove sort_code_in_words and account_number_in_words fields from employee_financial_details
ALTER TABLE employee_financial_details 
DROP COLUMN IF EXISTS sort_code_in_words,
DROP COLUMN IF EXISTS account_number_in_words;
-- Description: Add bank account verification fields to employee_financial_details table

-- Add verification columns to financial details table
ALTER TABLE employee_financial_details
ADD COLUMN IF NOT EXISTS sort_code_in_words TEXT,
ADD COLUMN IF NOT EXISTS account_number_in_words TEXT;

-- Add comments for documentation
COMMENT ON COLUMN employee_financial_details.sort_code_in_words IS 'Sort code written in words for verification (e.g., "zero-one-two-three-four-five")';
COMMENT ON COLUMN employee_financial_details.account_number_in_words IS 'Account number written in words for verification (e.g., "zero-one-two-three-four-five-six-seven")';
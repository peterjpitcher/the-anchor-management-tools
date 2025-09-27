-- Add email support to customers for event check-in flow
ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS email text;

-- Optional: ensure stored emails are unique when present
CREATE UNIQUE INDEX IF NOT EXISTS idx_customers_email_unique
  ON customers (lower(email))
  WHERE email IS NOT NULL;

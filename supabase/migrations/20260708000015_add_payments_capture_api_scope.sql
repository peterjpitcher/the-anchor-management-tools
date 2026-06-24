-- Grant the new PayPal capture scope to existing external keys that currently
-- power the website booking/payment flow through read:events.
UPDATE public.api_keys
SET
  permissions = permissions || '["payments:capture"]'::jsonb,
  updated_at = now()
WHERE jsonb_typeof(permissions) = 'array'
  AND permissions ? 'read:events'
  AND NOT permissions ? 'payments:capture'
  AND NOT permissions ? '*';

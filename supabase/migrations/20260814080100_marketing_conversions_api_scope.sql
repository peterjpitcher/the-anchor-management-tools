-- Give the website API key permission to record marketing conversions.
--
-- Scoped to the one active key actually named "website" (the key that carries
-- create:bookings and payments:capture and powers the public site). The earlier
-- payments:capture grant widened to every key holding read:events, which handed the scope
-- to unrelated integrations; recording conversions is a write, so this one stays narrow.
--
-- Idempotent: the append only fires when the scope is missing, and the || preserves every
-- other entry in the array.

UPDATE public.api_keys
SET
  permissions = permissions || '["write:marketing_conversions"]'::jsonb,
  updated_at = now()
WHERE jsonb_typeof(permissions) = 'array'
  AND lower(name) = 'website'
  AND is_active = true
  AND permissions ? 'create:bookings'
  AND permissions ? 'payments:capture'
  AND NOT permissions ? 'write:marketing_conversions'
  AND NOT permissions ? '*';

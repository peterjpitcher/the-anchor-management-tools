-- Give the website API key permission to ask for an operations alert text.
--
-- POST /api/website/payment-failure-alert texts the pub's own alert number when a payment
-- fails on the public website. The route asks for write:ops_alerts, a scope no key holds
-- until this runs, so deploying the code alone sends nothing.
--
-- Scoped to the one active key actually named "website" (the key that carries
-- create:bookings and payments:capture and powers the public site), the same narrow match
-- as 20260814080100_marketing_conversions_api_scope.sql. Sending a text is a write, so no
-- other integration is given it.
--
-- Idempotent: the append only fires when the scope is missing, and the || preserves every
-- other entry in the array. Data only: no table, view or function is added or changed.

UPDATE public.api_keys
SET
  permissions = permissions || '["write:ops_alerts"]'::jsonb,
  updated_at = now()
WHERE jsonb_typeof(permissions) = 'array'
  AND lower(name) = 'website'
  AND is_active = true
  AND permissions ? 'create:bookings'
  AND permissions ? 'payments:capture'
  AND NOT permissions ? 'write:ops_alerts'
  AND NOT permissions ? '*';

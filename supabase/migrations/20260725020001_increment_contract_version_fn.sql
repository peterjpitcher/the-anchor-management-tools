-- Atomic contract-version increment for private bookings (TP-11).
--
-- The contract route previously did a read-then-write increment with the
-- RLS-scoped client: two concurrent generates could mint the same version, and
-- an RLS-blocked update silently diverged from the audit trail. This function
-- performs the increment in a single SQL statement and returns the new value.
-- Called only via the service-role client from
-- src/app/api/private-bookings/contract/route.ts. Returns NULL when the
-- booking id does not exist.

CREATE OR REPLACE FUNCTION public.increment_private_booking_contract_version(p_booking_id uuid)
RETURNS integer
LANGUAGE sql
SET search_path = public, pg_catalog
AS $$
  UPDATE private_bookings
  SET contract_version = COALESCE(contract_version, 0) + 1
  WHERE id = p_booking_id
  RETURNING contract_version;
$$;

-- Service-role only. New public functions default to EXECUTE for anon and
-- authenticated (REVOKE FROM PUBLIC alone is not enough) — revoke explicitly
-- so the increment cannot be called around the API route's permission checks.
REVOKE ALL ON FUNCTION public.increment_private_booking_contract_version(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.increment_private_booking_contract_version(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.increment_private_booking_contract_version(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.increment_private_booking_contract_version(uuid) TO service_role;

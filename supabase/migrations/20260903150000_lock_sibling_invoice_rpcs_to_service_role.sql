-- Close the `authenticated` EXECUTE grant on three SECURITY DEFINER routines.
--
-- ORDERING: this migration must be applied only AFTER the code that moves
-- `create_credit_note_atomic` and `record_balance_payment` onto the service
-- role client is live. Applied early it breaks the credit note button and the
-- record-balance-payment flow outright, because both were calling the RPC as
-- the signed-in user.
--
-- Why
-- ---
-- All three are SECURITY DEFINER, so they run with the definer's rights
-- whoever calls them. Their only real gate is the permission check in the
-- server action above them. While `authenticated` held EXECUTE, any signed-in
-- member of staff could POST straight to /rest/v1/rpc/<name> and skip that
-- check entirely: raise a private booking invoice, issue a credit note, or
-- record a balance payment against any booking.
--
-- `authenticated` picks this grant up through ALTER DEFAULT PRIVILEGES and
-- holds it in its own right, so a `REVOKE ... FROM PUBLIC` does not remove it.
-- It has to be named explicitly. `reissue_oj_invoice_transaction` and
-- `cancel_private_booking_invoice_atomic` are the shape being matched here:
-- service_role only.
--
-- Callers after the companion code change:
--   create_private_booking_invoice_atomic  admin client (was already)
--   create_credit_note_atomic              admin client (moved)
--   record_balance_payment                 admin client (moved)

DO $$
DECLARE
  v_signature text;
BEGIN
  FOREACH v_signature IN ARRAY ARRAY[
    'public.create_private_booking_invoice_atomic',
    'public.create_credit_note_atomic',
    'public.record_balance_payment'
  ]
  LOOP
    -- Every overload of each name, so a stale signature cannot keep the grant.
    EXECUTE (
      SELECT coalesce(string_agg(
        format(
          'REVOKE ALL ON FUNCTION %s(%s) FROM PUBLIC, anon, authenticated;',
          v_signature,
          pg_get_function_identity_arguments(p.oid)
        ), ' '), '')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = v_signature
    );

    EXECUTE (
      SELECT coalesce(string_agg(
        format(
          'GRANT EXECUTE ON FUNCTION %s(%s) TO service_role;',
          v_signature,
          pg_get_function_identity_arguments(p.oid)
        ), ' '), '')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname || '.' || p.proname = v_signature
    );
  END LOOP;
END;
$$;

-- Fail the migration rather than ship a silent no-op.
DO $$
DECLARE
  v_leaked text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO v_leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_private_booking_invoice_atomic',
      'create_credit_note_atomic',
      'record_balance_payment'
    )
    AND (
      has_function_privilege('authenticated', p.oid, 'EXECUTE')
      OR has_function_privilege('anon', p.oid, 'EXECUTE')
    );

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'anon or authenticated still holds EXECUTE on: %', v_leaked;
  END IF;
END;
$$;

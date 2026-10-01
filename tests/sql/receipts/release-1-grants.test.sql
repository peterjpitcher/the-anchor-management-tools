-- The Release 1 functions are callable by the service role only.
\set ON_ERROR_STOP on

DO $$
DECLARE
  v_fn text;
  v_oid oid;
BEGIN
  FOREACH v_fn IN ARRAY ARRAY[
    'public.complete_receipt_upload(uuid, text, uuid, text, text, text, text, bigint, text)',
    'public.release_receipt_upload_intent(uuid, text, uuid)',
    'public.apply_receipt_invoice_match(uuid, uuid, text, uuid, text, boolean, numeric, numeric, numeric, jsonb, boolean, uuid, text, uuid)'
  ] LOOP
    v_oid := v_fn::regprocedure::oid;
    ASSERT NOT has_function_privilege('anon', v_oid, 'EXECUTE'), format('%s must not be callable by anon', v_fn);
    ASSERT NOT has_function_privilege('authenticated', v_oid, 'EXECUTE'), format('%s must not be callable by authenticated', v_fn);
    ASSERT has_function_privilege('service_role', v_oid, 'EXECUTE'), format('%s must be callable by service_role', v_fn);
    ASSERT (SELECT prosecdef AND proconfig IS NOT NULL FROM pg_proc WHERE oid = v_oid), format('%s must be SECURITY DEFINER with a pinned search_path', v_fn);
  END LOOP;
END $$;

\echo 'RECEIPTS GRANTS TESTS PASSED'

CREATE TABLE IF NOT EXISTS public.receipt_rules_transaction_type_backup (
  id uuid PRIMARY KEY,
  match_transaction_type text NOT NULL,
  match_description text,
  backed_up_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE v_backup int; v_nulled int;
BEGIN
  INSERT INTO public.receipt_rules_transaction_type_backup (id, match_transaction_type, match_description)
  SELECT id, match_transaction_type, match_description FROM public.receipt_rules
  WHERE match_transaction_type IS NOT NULL AND match_description IS NOT NULL AND btrim(match_description) <> ''
  ON CONFLICT (id) DO NOTHING;
  GET DIAGNOSTICS v_backup = ROW_COUNT;

  -- Only null match_transaction_type for rules that ALSO carry a real description keyword.
  -- Type-only rules (no description) and whitespace-only-description rules intentionally
  -- retain their match_transaction_type, since it is their sole matching criterion.
  UPDATE public.receipt_rules SET match_transaction_type = NULL
  WHERE match_transaction_type IS NOT NULL AND match_description IS NOT NULL AND btrim(match_description) <> '';
  GET DIAGNOSTICS v_nulled = ROW_COUNT;

  RAISE NOTICE 'receipt rules: backed up %, nulled %', v_backup, v_nulled;
  RAISE NOTICE 'receipt rules: type-only and whitespace-only-description rules retained their match_transaction_type';
  IF v_backup <> v_nulled THEN
    RAISE EXCEPTION 'Backup/null count mismatch (% vs %)', v_backup, v_nulled;
  END IF;
END $$;

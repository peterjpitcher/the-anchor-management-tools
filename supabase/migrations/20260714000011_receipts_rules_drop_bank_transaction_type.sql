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

  UPDATE public.receipt_rules SET match_transaction_type = NULL
  WHERE match_transaction_type IS NOT NULL AND match_description IS NOT NULL AND btrim(match_description) <> '';
  GET DIAGNOSTICS v_nulled = ROW_COUNT;

  RAISE NOTICE 'receipt rules: backed up %, nulled %', v_backup, v_nulled;
  IF v_backup <> v_nulled THEN
    RAISE EXCEPTION 'Backup/null count mismatch (% vs %)', v_backup, v_nulled;
  END IF;
END $$;

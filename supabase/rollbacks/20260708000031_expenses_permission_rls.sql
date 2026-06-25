BEGIN;

DROP POLICY IF EXISTS "expenses_permission_select" ON public.expenses;
DROP POLICY IF EXISTS "expenses_permission_insert" ON public.expenses;
DROP POLICY IF EXISTS "expenses_permission_update" ON public.expenses;
DROP POLICY IF EXISTS "expenses_permission_delete" ON public.expenses;

DROP POLICY IF EXISTS "expense_files_permission_select" ON public.expense_files;
DROP POLICY IF EXISTS "expense_files_permission_insert" ON public.expense_files;
DROP POLICY IF EXISTS "expense_files_permission_delete" ON public.expense_files;

DROP POLICY IF EXISTS "expense_receipts_permission_upload" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_permission_select" ON storage.objects;
DROP POLICY IF EXISTS "expense_receipts_permission_delete" ON storage.objects;

CREATE OR REPLACE FUNCTION public.delete_expense_atomic(p_expense_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_paths text[] := ARRAY[]::text[];
BEGIN
  PERFORM 1
  FROM public.expenses
  WHERE id = p_expense_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Expense not found';
  END IF;

  SELECT COALESCE(array_agg(storage_path ORDER BY uploaded_at, id), ARRAY[]::text[])
  INTO v_file_paths
  FROM public.expense_files
  WHERE expense_id = p_expense_id;

  DELETE FROM public.expenses
  WHERE id = p_expense_id;

  RETURN v_file_paths;
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_expense_atomic(uuid) TO authenticated, service_role;

COMMIT;

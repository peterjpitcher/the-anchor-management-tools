BEGIN;

CREATE POLICY "expenses_permission_select"
ON public.expenses
FOR SELECT
TO authenticated
USING (
  public.user_has_permission(auth.uid(), 'expenses', 'view')
  OR public.user_has_permission(auth.uid(), 'expenses', 'manage')
);

CREATE POLICY "expenses_permission_insert"
ON public.expenses
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_has_permission(auth.uid(), 'expenses', 'manage')
  AND created_by = auth.uid()
);

CREATE POLICY "expenses_permission_update"
ON public.expenses
FOR UPDATE
TO authenticated
USING (public.user_has_permission(auth.uid(), 'expenses', 'manage'))
WITH CHECK (public.user_has_permission(auth.uid(), 'expenses', 'manage'));

CREATE POLICY "expenses_permission_delete"
ON public.expenses
FOR DELETE
TO authenticated
USING (public.user_has_permission(auth.uid(), 'expenses', 'manage'));

CREATE POLICY "expense_files_permission_select"
ON public.expense_files
FOR SELECT
TO authenticated
USING (
  public.user_has_permission(auth.uid(), 'expenses', 'view')
  OR public.user_has_permission(auth.uid(), 'expenses', 'manage')
);

CREATE POLICY "expense_files_permission_insert"
ON public.expense_files
FOR INSERT
TO authenticated
WITH CHECK (
  public.user_has_permission(auth.uid(), 'expenses', 'manage')
  AND uploaded_by = auth.uid()
);

CREATE POLICY "expense_files_permission_delete"
ON public.expense_files
FOR DELETE
TO authenticated
USING (public.user_has_permission(auth.uid(), 'expenses', 'manage'));

CREATE POLICY "expense_receipts_permission_upload"
ON storage.objects
FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'expense-receipts'
  AND public.user_has_permission(auth.uid(), 'expenses', 'manage')
);

CREATE POLICY "expense_receipts_permission_select"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND (
    public.user_has_permission(auth.uid(), 'expenses', 'view')
    OR public.user_has_permission(auth.uid(), 'expenses', 'manage')
  )
);

CREATE POLICY "expense_receipts_permission_delete"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'expense-receipts'
  AND public.user_has_permission(auth.uid(), 'expenses', 'manage')
);

CREATE OR REPLACE FUNCTION public.delete_expense_atomic(p_expense_id uuid)
RETURNS text[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_file_paths text[] := ARRAY[]::text[];
BEGIN
  IF auth.uid() IS NULL OR NOT public.user_has_permission(auth.uid(), 'expenses', 'manage') THEN
    RAISE EXCEPTION 'Insufficient permissions';
  END IF;

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

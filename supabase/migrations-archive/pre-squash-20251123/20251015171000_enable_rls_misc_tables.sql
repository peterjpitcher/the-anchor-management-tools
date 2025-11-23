-- Enable row level security and add policies for tables flagged by database lint
BEGIN;

-- 1. AI usage events should only be written by trusted service processes
ALTER TABLE public.ai_usage_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages ai_usage_events" ON public.ai_usage_events;
CREATE POLICY "Service role manages ai_usage_events"
  ON public.ai_usage_events
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.ai_usage_events FROM anon;
REVOKE ALL ON public.ai_usage_events FROM authenticated;

-- 2. P&L targets are managed by receipts team
ALTER TABLE public.pl_targets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Receipts users can view pl_targets" ON public.pl_targets;
DROP POLICY IF EXISTS "Receipts managers can modify pl_targets" ON public.pl_targets;
CREATE POLICY "Receipts users can view pl_targets"
  ON public.pl_targets
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'view')
  );
CREATE POLICY "Receipts managers can modify pl_targets"
  ON public.pl_targets
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  );
REVOKE ALL ON public.pl_targets FROM anon;

-- 3. P&L manual actuals follow the same rule set
ALTER TABLE public.pl_manual_actuals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Receipts users can view pl_manual_actuals" ON public.pl_manual_actuals;
DROP POLICY IF EXISTS "Receipts managers can modify pl_manual_actuals" ON public.pl_manual_actuals;
CREATE POLICY "Receipts users can view pl_manual_actuals"
  ON public.pl_manual_actuals
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'view')
  );
CREATE POLICY "Receipts managers can modify pl_manual_actuals"
  ON public.pl_manual_actuals
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'receipts', 'manage')
  );
REVOKE ALL ON public.pl_manual_actuals FROM anon;

-- 4. Phone standardization issues are diagnostic and should stay internal
ALTER TABLE public.phone_standardization_issues ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role manages phone_standardization_issues" ON public.phone_standardization_issues;
CREATE POLICY "Service role manages phone_standardization_issues"
  ON public.phone_standardization_issues
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
REVOKE ALL ON public.phone_standardization_issues FROM anon;
REVOKE ALL ON public.phone_standardization_issues FROM authenticated;

-- 5. Service slot configuration overrides are maintained by table bookings staff
ALTER TABLE public.service_slot_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Table bookings users can view service_slot_config" ON public.service_slot_config;
DROP POLICY IF EXISTS "Table bookings managers manage service_slot_config" ON public.service_slot_config;
CREATE POLICY "Table bookings users can view service_slot_config"
  ON public.service_slot_config
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'view')
  );
CREATE POLICY "Table bookings managers manage service_slot_config"
  ON public.service_slot_config
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  );
REVOKE ALL ON public.service_slot_config FROM anon;

ALTER TABLE public.service_slot_overrides ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Table bookings users can view service_slot_overrides" ON public.service_slot_overrides;
DROP POLICY IF EXISTS "Table bookings managers manage service_slot_overrides" ON public.service_slot_overrides;
CREATE POLICY "Table bookings users can view service_slot_overrides"
  ON public.service_slot_overrides
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'view')
  );
CREATE POLICY "Table bookings managers manage service_slot_overrides"
  ON public.service_slot_overrides
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'table_bookings', 'manage')
  );
REVOKE ALL ON public.service_slot_overrides FROM anon;

-- 6. Attachment categories are used when managing employee files
ALTER TABLE public.attachment_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Employees can view attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can insert attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can update attachment_categories" ON public.attachment_categories;
DROP POLICY IF EXISTS "Employees can delete attachment_categories" ON public.attachment_categories;
CREATE POLICY "Employees can view attachment_categories"
  ON public.attachment_categories
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'view_documents')
  );
CREATE POLICY "Employees can insert attachment_categories"
  ON public.attachment_categories
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  );
CREATE POLICY "Employees can update attachment_categories"
  ON public.attachment_categories
  FOR UPDATE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'upload_documents')
  );
CREATE POLICY "Employees can delete attachment_categories"
  ON public.attachment_categories
  FOR DELETE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'employees', 'delete_documents')
  );
REVOKE ALL ON public.attachment_categories FROM anon;

-- 7. Invoice number series must honour invoice permissions
ALTER TABLE public.invoice_series ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice users can view invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can modify invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can insert invoice_series" ON public.invoice_series;
DROP POLICY IF EXISTS "Invoice users can delete invoice_series" ON public.invoice_series;
CREATE POLICY "Invoice users can view invoice_series"
  ON public.invoice_series
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
  );
CREATE POLICY "Invoice users can modify invoice_series"
  ON public.invoice_series
  FOR UPDATE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
CREATE POLICY "Invoice users can insert invoice_series"
  ON public.invoice_series
  FOR INSERT TO authenticated
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
CREATE POLICY "Invoice users can delete invoice_series"
  ON public.invoice_series
  FOR DELETE TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
REVOKE ALL ON public.invoice_series FROM anon;

-- 8. Vendor contacts align with invoice permissions
ALTER TABLE public.invoice_vendor_contacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Invoice users can view vendor contacts" ON public.invoice_vendor_contacts;
DROP POLICY IF EXISTS "Invoice users can manage vendor contacts" ON public.invoice_vendor_contacts;
CREATE POLICY "Invoice users can view vendor contacts"
  ON public.invoice_vendor_contacts
  FOR SELECT TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'view')
  );
CREATE POLICY "Invoice users can manage vendor contacts"
  ON public.invoice_vendor_contacts
  FOR ALL TO authenticated
  USING (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  )
  WITH CHECK (
    auth.role() = 'service_role'
    OR public.user_has_permission(auth.uid(), 'invoices', 'edit')
  );
REVOKE ALL ON public.invoice_vendor_contacts FROM anon;

COMMIT;

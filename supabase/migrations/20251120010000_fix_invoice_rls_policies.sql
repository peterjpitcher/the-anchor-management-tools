-- Description: Fix RLS policies for Invoices module to allow access based on RBAC permissions
-- Previously only super_admin had access via policies in the dump.

-- ==============================================================================
-- 1. INVOICES TABLE
-- ==============================================================================

-- Ensure RLS is enabled
ALTER TABLE "public"."invoices" ENABLE ROW LEVEL SECURITY;

-- View Policy
CREATE POLICY "Users with invoices view permission can view invoices" 
ON "public"."invoices" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy
CREATE POLICY "Users with invoices create permission can create invoices" 
ON "public"."invoices" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'create')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update invoices" 
ON "public"."invoices" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices delete permission can delete invoices" 
ON "public"."invoices" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
);


-- ==============================================================================
-- 2. INVOICE LINE ITEMS TABLE
-- ==============================================================================

ALTER TABLE "public"."invoice_line_items" ENABLE ROW LEVEL SECURITY;

-- View Policy (Inherit 'view' from invoices module)
CREATE POLICY "Users with invoices view permission can view line items" 
ON "public"."invoice_line_items" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy (Inherit 'create' or 'edit' - users need to add lines when creating OR editing)
CREATE POLICY "Users with invoices create/edit permission can add line items" 
ON "public"."invoice_line_items" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'create') OR
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update line items" 
ON "public"."invoice_line_items" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices edit/delete permission can delete line items" 
ON "public"."invoice_line_items" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit') OR
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'delete')
);


-- ==============================================================================
-- 3. INVOICE PAYMENTS TABLE
-- ==============================================================================

ALTER TABLE "public"."invoice_payments" ENABLE ROW LEVEL SECURITY;

-- View Policy
CREATE POLICY "Users with invoices view permission can view payments" 
ON "public"."invoice_payments" 
FOR SELECT 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'view')
);

-- Create Policy (Recording a payment is considered an 'edit' to the invoice state)
CREATE POLICY "Users with invoices edit permission can record payments" 
ON "public"."invoice_payments" 
FOR INSERT 
TO "authenticated" 
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Update Policy
CREATE POLICY "Users with invoices edit permission can update payments" 
ON "public"."invoice_payments" 
FOR UPDATE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

-- Delete Policy
CREATE POLICY "Users with invoices edit permission can delete payments" 
ON "public"."invoice_payments" 
FOR DELETE 
TO "authenticated" 
USING (
  "public"."user_has_permission"("auth"."uid"(), 'invoices', 'edit')
);

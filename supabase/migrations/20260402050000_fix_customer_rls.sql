-- Fix Customer RLS policies to include 'manage' permission
-- This allows users with 'customers.manage' to perform all actions,
-- resolving the issue where creators couldn't see the customer they just created
-- if they only had 'manage' permission but not explicit 'view'/'create' permissions.

-- 1. Create
DROP POLICY IF EXISTS "Users with customers create permission can create customers" ON "public"."customers";
CREATE POLICY "Users with customers create permission can create customers" ON "public"."customers"
FOR INSERT TO "authenticated"
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'create'::"text") OR
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'manage'::"text")
);

-- 2. Delete
DROP POLICY IF EXISTS "Users with customers delete permission can delete customers" ON "public"."customers";
CREATE POLICY "Users with customers delete permission can delete customers" ON "public"."customers"
FOR DELETE TO "authenticated"
USING (
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'delete'::"text") OR
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'manage'::"text")
);

-- 3. Update
DROP POLICY IF EXISTS "Users with customers edit permission can update customers" ON "public"."customers";
CREATE POLICY "Users with customers edit permission can update customers" ON "public"."customers"
FOR UPDATE TO "authenticated"
USING (
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text") OR
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'manage'::"text")
)
WITH CHECK (
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'edit'::"text") OR
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'manage'::"text")
);

-- 4. View
DROP POLICY IF EXISTS "Users with customers view permission can view customers" ON "public"."customers";
CREATE POLICY "Users with customers view permission can view customers" ON "public"."customers"
FOR SELECT TO "authenticated"
USING (
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'view'::"text") OR
  "public"."user_has_permission"("auth"."uid"(), 'customers'::"text", 'manage'::"text")
);

-- Update RLS policies for cashing_up module to use permission checks

-- cashup_sessions
DROP POLICY IF EXISTS "Authenticated users can view sessions" ON cashup_sessions;
DROP POLICY IF EXISTS "Authenticated users can insert sessions" ON cashup_sessions;
DROP POLICY IF EXISTS "Authenticated users can update sessions" ON cashup_sessions;

CREATE POLICY "Users can view sessions with permission" ON cashup_sessions
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert sessions with permission" ON cashup_sessions
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create'));

CREATE POLICY "Users can update sessions with permission" ON cashup_sessions
    FOR UPDATE TO authenticated
    USING (
        public.user_has_permission(auth.uid(), 'cashing_up', 'edit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'submit') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'approve') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'lock') OR
        public.user_has_permission(auth.uid(), 'cashing_up', 'unlock')
    );

-- cashup_payment_breakdowns
DROP POLICY IF EXISTS "Authenticated users can view breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can insert breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can update breakdowns" ON cashup_payment_breakdowns;
DROP POLICY IF EXISTS "Authenticated users can delete breakdowns" ON cashup_payment_breakdowns;

CREATE POLICY "Users can view breakdowns with permission" ON cashup_payment_breakdowns
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert breakdowns with permission" ON cashup_payment_breakdowns
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create') OR public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can update breakdowns with permission" ON cashup_payment_breakdowns
    FOR UPDATE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can delete breakdowns with permission" ON cashup_payment_breakdowns
    FOR DELETE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit')); -- Deleting breakdowns happens during update/upsert

-- cashup_cash_counts
DROP POLICY IF EXISTS "Authenticated users can view counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can insert counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can update counts" ON cashup_cash_counts;
DROP POLICY IF EXISTS "Authenticated users can delete counts" ON cashup_cash_counts;

CREATE POLICY "Users can view counts with permission" ON cashup_cash_counts
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

CREATE POLICY "Users can insert counts with permission" ON cashup_cash_counts
    FOR INSERT TO authenticated
    WITH CHECK (public.user_has_permission(auth.uid(), 'cashing_up', 'create') OR public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can update counts with permission" ON cashup_cash_counts
    FOR UPDATE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

CREATE POLICY "Users can delete counts with permission" ON cashup_cash_counts
    FOR DELETE TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'edit'));

-- cashup_config
DROP POLICY IF EXISTS "Authenticated users can view config" ON cashup_config;
CREATE POLICY "Users can view config with permission" ON cashup_config
    FOR SELECT TO authenticated
    USING (public.user_has_permission(auth.uid(), 'cashing_up', 'view'));

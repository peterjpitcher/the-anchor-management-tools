-- Enable Row Level Security for all employee tables
ALTER TABLE employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_financial_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE employee_attachments ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if any (for idempotency)
DROP POLICY IF EXISTS "Users can view all employees" ON employees;
DROP POLICY IF EXISTS "Users can create employees" ON employees;
DROP POLICY IF EXISTS "Users can update employees" ON employees;
DROP POLICY IF EXISTS "Users can delete employees" ON employees;

DROP POLICY IF EXISTS "Users can view emergency contacts" ON employee_emergency_contacts;
DROP POLICY IF EXISTS "Users can manage emergency contacts" ON employee_emergency_contacts;

DROP POLICY IF EXISTS "Users can view financial details" ON employee_financial_details;
DROP POLICY IF EXISTS "Users can manage financial details" ON employee_financial_details;

DROP POLICY IF EXISTS "Users can view health records" ON employee_health_records;
DROP POLICY IF EXISTS "Users can manage health records" ON employee_health_records;

DROP POLICY IF EXISTS "Users can view notes" ON employee_notes;
DROP POLICY IF EXISTS "Users can create notes" ON employee_notes;
DROP POLICY IF EXISTS "Users can update own notes" ON employee_notes;
DROP POLICY IF EXISTS "Users can delete own notes" ON employee_notes;

DROP POLICY IF EXISTS "Users can view attachments" ON employee_attachments;
DROP POLICY IF EXISTS "Users can manage attachments" ON employee_attachments;

-- Policies for employees table
-- Allow authenticated users to view all employees
CREATE POLICY "Users can view all employees" 
ON employees FOR SELECT 
TO authenticated 
USING (true);

-- Allow authenticated users to create employees
CREATE POLICY "Users can create employees" 
ON employees FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow authenticated users to update employees
CREATE POLICY "Users can update employees" 
ON employees FOR UPDATE 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Allow authenticated users to delete employees
CREATE POLICY "Users can delete employees" 
ON employees FOR DELETE 
TO authenticated 
USING (true);

-- Policies for employee_emergency_contacts
CREATE POLICY "Users can view emergency contacts" 
ON employee_emergency_contacts FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can manage emergency contacts" 
ON employee_emergency_contacts FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Policies for employee_financial_details
CREATE POLICY "Users can view financial details" 
ON employee_financial_details FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can manage financial details" 
ON employee_financial_details FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Policies for employee_health_records
CREATE POLICY "Users can view health records" 
ON employee_health_records FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can manage health records" 
ON employee_health_records FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Policies for employee_notes
-- Allow viewing all notes
CREATE POLICY "Users can view notes" 
ON employee_notes FOR SELECT 
TO authenticated 
USING (true);

-- Allow creating notes
CREATE POLICY "Users can create notes" 
ON employee_notes FOR INSERT 
TO authenticated 
WITH CHECK (true);

-- Allow users to update only their own notes
DO $$
DECLARE
    col_name text;
BEGIN
    -- Check which column name exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_notes' 
        AND column_name = 'created_by_user_id'
    ) THEN
        col_name := 'created_by_user_id';
    ELSE
        col_name := 'created_by';
    END IF;
    
    -- Create policy with the correct column name
    EXECUTE format('
        CREATE POLICY "Users can update own notes" 
        ON employee_notes FOR UPDATE 
        TO authenticated 
        USING (auth.uid() = %I)
        WITH CHECK (auth.uid() = %I)',
        col_name, col_name
    );
END $$;

-- Allow users to delete only their own notes
DO $$
DECLARE
    col_name text;
BEGIN
    -- Check which column name exists
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_notes' 
        AND column_name = 'created_by_user_id'
    ) THEN
        col_name := 'created_by_user_id';
    ELSE
        col_name := 'created_by';
    END IF;
    
    -- Create policy with the correct column name
    EXECUTE format('
        CREATE POLICY "Users can delete own notes" 
        ON employee_notes FOR DELETE 
        TO authenticated 
        USING (auth.uid() = %I)',
        col_name
    );
END $$;

-- Policies for employee_attachments
CREATE POLICY "Users can view attachments" 
ON employee_attachments FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Users can manage attachments" 
ON employee_attachments FOR ALL 
TO authenticated 
USING (true)
WITH CHECK (true);

-- Note: In a production environment, you might want to:
-- 1. Add role-based access control (e.g., only HR managers can view financial/health records)
-- 2. Add audit logging for sensitive operations
-- 3. Restrict deletion of employees with related records
-- 4. Add more granular permissions based on user roles
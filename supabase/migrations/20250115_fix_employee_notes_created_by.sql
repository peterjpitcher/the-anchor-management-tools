-- Fix the created_by field name inconsistency
-- The database has 'created_by' but the UI is using 'created_by_user_id'

-- Rename the column to match what the UI expects
DO $$ 
BEGIN
    -- Check if created_by exists and created_by_user_id doesn't
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_notes' 
        AND column_name = 'created_by'
    ) AND NOT EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employee_notes' 
        AND column_name = 'created_by_user_id'
    ) THEN
        -- Rename the column
        ALTER TABLE employee_notes 
        RENAME COLUMN created_by TO created_by_user_id;
        
        RAISE NOTICE 'Renamed column created_by to created_by_user_id in employee_notes table';
    END IF;
END $$;

-- Also update the RLS policies if they reference the old column name
DO $$
BEGIN
    -- Drop and recreate policies that reference created_by
    IF EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'employee_notes' 
        AND policyname = 'Users can update own notes'
    ) THEN
        DROP POLICY IF EXISTS "Users can update own notes" ON employee_notes;
        CREATE POLICY "Users can update own notes" 
        ON employee_notes FOR UPDATE 
        TO authenticated 
        USING (auth.uid() = created_by_user_id)
        WITH CHECK (auth.uid() = created_by_user_id);
    END IF;
    
    IF EXISTS (
        SELECT 1 
        FROM pg_policies 
        WHERE tablename = 'employee_notes' 
        AND policyname = 'Users can delete own notes'
    ) THEN
        DROP POLICY IF EXISTS "Users can delete own notes" ON employee_notes;
        CREATE POLICY "Users can delete own notes" 
        ON employee_notes FOR DELETE 
        TO authenticated 
        USING (auth.uid() = created_by_user_id);
    END IF;
END $$;
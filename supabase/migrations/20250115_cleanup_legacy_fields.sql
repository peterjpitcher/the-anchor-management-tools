-- Remove legacy fields from employees table that were supposed to be removed in previous migrations
-- These fields still exist in schema.sql but should have been removed

-- Check if the columns exist before trying to drop them
DO $$ 
BEGIN
    -- Remove emergency_contact_name if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employees' 
        AND column_name = 'emergency_contact_name'
    ) THEN
        ALTER TABLE employees DROP COLUMN emergency_contact_name;
        RAISE NOTICE 'Dropped column emergency_contact_name from employees table';
    END IF;

    -- Remove emergency_contact_phone if it exists
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employees' 
        AND column_name = 'emergency_contact_phone'
    ) THEN
        ALTER TABLE employees DROP COLUMN emergency_contact_phone;
        RAISE NOTICE 'Dropped column emergency_contact_phone from employees table';
    END IF;

    -- Remove ni_number if it still exists in employees table
    -- (it should have been moved to employee_financial_details)
    IF EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employees' 
        AND column_name = 'ni_number'
    ) THEN
        -- First check if any data needs to be migrated
        IF EXISTS (
            SELECT 1 
            FROM employees 
            WHERE ni_number IS NOT NULL 
            AND ni_number != ''
        ) THEN
            -- Migrate any remaining ni_number data to employee_financial_details
            INSERT INTO employee_financial_details (employee_id, ni_number)
            SELECT employee_id, ni_number
            FROM employees
            WHERE ni_number IS NOT NULL 
            AND ni_number != ''
            AND employee_id NOT IN (
                SELECT employee_id 
                FROM employee_financial_details
            );
            
            -- Update existing records if they don't have ni_number
            UPDATE employee_financial_details efd
            SET ni_number = e.ni_number
            FROM employees e
            WHERE efd.employee_id = e.employee_id
            AND efd.ni_number IS NULL
            AND e.ni_number IS NOT NULL
            AND e.ni_number != '';
            
            RAISE NOTICE 'Migrated ni_number data to employee_financial_details';
        END IF;
        
        -- Now drop the column
        ALTER TABLE employees DROP COLUMN ni_number;
        RAISE NOTICE 'Dropped column ni_number from employees table';
    END IF;
END $$;
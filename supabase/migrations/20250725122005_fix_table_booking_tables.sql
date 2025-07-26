-- Description: Fix table booking configuration tables and relationships

-- Create table_configuration if it doesn't exist
CREATE TABLE IF NOT EXISTS public.table_configuration (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    table_number VARCHAR(10) NOT NULL,
    capacity INTEGER NOT NULL CHECK (capacity > 0),
    is_active BOOLEAN DEFAULT true,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on table_number
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_configuration_table_number 
    ON public.table_configuration(LOWER(table_number));

-- Create table_combinations if it doesn't exist
CREATE TABLE IF NOT EXISTS public.table_combinations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100),
    table_ids UUID[] NOT NULL,
    total_capacity INTEGER NOT NULL,
    preferred_for_size INTEGER[],
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Create unique index on name
CREATE UNIQUE INDEX IF NOT EXISTS idx_table_combinations_name 
    ON public.table_combinations(LOWER(name));

-- Create index on is_active
CREATE INDEX IF NOT EXISTS idx_table_combinations_active 
    ON public.table_combinations(is_active);

-- Create table_combination_tables junction table
CREATE TABLE IF NOT EXISTS public.table_combination_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    combination_id UUID NOT NULL,
    table_id UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add unique constraint
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_combination_id_table_id_key;
ALTER TABLE public.table_combination_tables 
    ADD CONSTRAINT table_combination_tables_combination_id_table_id_key 
    UNIQUE (combination_id, table_id);

-- Drop old foreign key constraints if they exist
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_combination_id_fkey;
ALTER TABLE public.table_combination_tables 
    DROP CONSTRAINT IF EXISTS table_combination_tables_table_id_fkey;

-- Add foreign key constraints with correct references
ALTER TABLE public.table_combination_tables
    ADD CONSTRAINT table_combination_tables_combination_id_fkey 
    FOREIGN KEY (combination_id) REFERENCES public.table_combinations(id) ON DELETE CASCADE;

ALTER TABLE public.table_combination_tables
    ADD CONSTRAINT table_combination_tables_table_id_fkey 
    FOREIGN KEY (table_id) REFERENCES public.table_configuration(id) ON DELETE CASCADE;

-- Enable RLS
ALTER TABLE public.table_configuration ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.table_combination_tables ENABLE ROW LEVEL SECURITY;

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Managers can manage table configuration" ON public.table_configuration;
DROP POLICY IF EXISTS "Staff can view table configuration" ON public.table_configuration;
DROP POLICY IF EXISTS "Admins manage table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Staff can view table combinations" ON public.table_combinations;
DROP POLICY IF EXISTS "Managers can manage table combination tables" ON public.table_combination_tables;
DROP POLICY IF EXISTS "Staff can view table combination tables" ON public.table_combination_tables;

-- Create RLS policies for table_configuration
CREATE POLICY "Users can manage table configuration with permission" 
    ON public.table_configuration
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table configuration with permission" 
    ON public.table_configuration
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Create RLS policies for table_combinations
CREATE POLICY "Users can manage table combinations with permission" 
    ON public.table_combinations
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table combinations with permission" 
    ON public.table_combinations
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Create RLS policies for table_combination_tables
CREATE POLICY "Users can manage table combination tables with permission" 
    ON public.table_combination_tables
    FOR ALL 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'manage'));

CREATE POLICY "Users can view table combination tables with permission" 
    ON public.table_combination_tables
    FOR SELECT 
    USING (public.user_has_permission(auth.uid(), 'table_bookings', 'view'));

-- Add triggers for updated_at
CREATE OR REPLACE TRIGGER table_configuration_updated_at 
    BEFORE UPDATE ON public.table_configuration 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

CREATE OR REPLACE TRIGGER table_combinations_updated_at 
    BEFORE UPDATE ON public.table_combinations 
    FOR EACH ROW 
    EXECUTE FUNCTION public.update_updated_at_column();

-- Grant permissions
GRANT ALL ON TABLE public.table_configuration TO authenticated;
GRANT ALL ON TABLE public.table_combinations TO authenticated;
GRANT ALL ON TABLE public.table_combination_tables TO authenticated;

-- Insert some default tables if none exist
INSERT INTO public.table_configuration (table_number, capacity, notes)
SELECT * FROM (VALUES 
    ('1', 2, 'Window table'),
    ('2', 4, 'Corner booth'),
    ('3', 4, 'Center table'),
    ('4', 6, 'Large round table'),
    ('5', 2, 'Bar seating'),
    ('6', 4, 'Outdoor patio'),
    ('7', 4, 'Outdoor patio'),
    ('8', 2, 'Small table'),
    ('9', 6, 'Private dining'),
    ('10', 8, 'Large group table')
) AS default_tables(table_number, capacity, notes)
WHERE NOT EXISTS (SELECT 1 FROM public.table_configuration);

-- Create some default combinations if tables were inserted
DO $$
DECLARE
    table_1_id UUID;
    table_2_id UUID;
    table_3_id UUID;
    table_4_id UUID;
    combination_id UUID;
BEGIN
    -- Only create combinations if we just inserted the default tables
    IF (SELECT COUNT(*) FROM public.table_configuration) = 10 AND 
       (SELECT COUNT(*) FROM public.table_combinations) = 0 THEN
        
        -- Get table IDs
        SELECT id INTO table_1_id FROM public.table_configuration WHERE table_number = '1';
        SELECT id INTO table_2_id FROM public.table_configuration WHERE table_number = '2';
        SELECT id INTO table_3_id FROM public.table_configuration WHERE table_number = '3';
        SELECT id INTO table_4_id FROM public.table_configuration WHERE table_number = '4';
        
        -- Create combination for tables 1 + 2
        INSERT INTO public.table_combinations (name, table_ids, total_capacity, preferred_for_size)
        VALUES ('Tables 1 & 2', ARRAY[table_1_id, table_2_id], 6, ARRAY[5, 6])
        RETURNING id INTO combination_id;
        
        -- Insert junction records
        INSERT INTO public.table_combination_tables (combination_id, table_id)
        VALUES (combination_id, table_1_id), (combination_id, table_2_id);
        
        -- Create combination for tables 3 + 4
        INSERT INTO public.table_combinations (name, table_ids, total_capacity, preferred_for_size)
        VALUES ('Tables 3 & 4', ARRAY[table_3_id, table_4_id], 10, ARRAY[7, 8, 9, 10])
        RETURNING id INTO combination_id;
        
        -- Insert junction records
        INSERT INTO public.table_combination_tables (combination_id, table_id)
        VALUES (combination_id, table_3_id), (combination_id, table_4_id);
    END IF;
END $$;
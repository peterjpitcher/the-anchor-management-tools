-- Create messages table if it doesn't exist
-- This table stores SMS message history

CREATE TABLE IF NOT EXISTS public.messages (
    id UUID DEFAULT gen_random_uuid() NOT NULL,
    customer_id UUID NOT NULL,
    direction TEXT NOT NULL,
    message_sid TEXT NOT NULL,
    body TEXT NOT NULL,
    status TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    CONSTRAINT messages_direction_check CHECK (direction = ANY (ARRAY['inbound'::text, 'outbound'::text]))
);

-- Add primary key
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_pkey PRIMARY KEY (id);

-- Add foreign key to customers table
ALTER TABLE ONLY public.messages
    ADD CONSTRAINT messages_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES public.customers(id) ON DELETE CASCADE;

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_messages_created_at ON public.messages USING btree (created_at);
CREATE INDEX IF NOT EXISTS idx_messages_customer_id ON public.messages USING btree (customer_id);

-- Create trigger to update the updated_at column
CREATE OR REPLACE FUNCTION public.update_messages_updated_at() RETURNS trigger
    LANGUAGE plpgsql
    AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON public.messages 
    FOR EACH ROW EXECUTE FUNCTION public.update_messages_updated_at();

-- Enable RLS
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow authenticated users to read messages" 
    ON public.messages 
    FOR SELECT 
    TO authenticated 
    USING (true);

CREATE POLICY "Allow authenticated users to insert messages" 
    ON public.messages 
    FOR INSERT 
    TO authenticated 
    WITH CHECK (true);

-- Grant permissions
GRANT ALL ON TABLE public.messages TO anon;
GRANT ALL ON TABLE public.messages TO authenticated;
GRANT ALL ON TABLE public.messages TO service_role;
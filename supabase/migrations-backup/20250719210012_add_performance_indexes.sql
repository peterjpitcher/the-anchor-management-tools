-- Description: Add missing database indexes for performance optimization
-- These indexes address the slow query issues, especially in private bookings
-- This version checks for column existence before creating indexes

-- Helper function to check if column exists
CREATE OR REPLACE FUNCTION column_exists(tbl_name text, col_name text) 
RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = tbl_name 
        AND column_name = col_name
    );
END;
$$ LANGUAGE plpgsql;

-- Customer table indexes (frequent lookups)
DO $$
BEGIN
    IF column_exists('customers', 'mobile_number') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_mobile_number ON customers(mobile_number);
    END IF;
    
    IF column_exists('customers', 'messaging_status') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_messaging_status ON customers(messaging_status);
    END IF;
    
    IF column_exists('customers', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_customers_created_at ON customers(created_at DESC);
    END IF;
END $$;

-- Messages table indexes (heavy queries)
DO $$
BEGIN
    IF column_exists('messages', 'customer_id') AND column_exists('messages', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_customer_created ON messages(customer_id, created_at DESC);
    END IF;
    
    IF column_exists('messages', 'twilio_message_sid') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_twilio_sid ON messages(twilio_message_sid) WHERE twilio_message_sid IS NOT NULL;
    END IF;
    
    IF column_exists('messages', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_messages_status ON messages(status);
    END IF;
END $$;

-- Private bookings indexes (reported as slow - PRIORITY)
DO $$
BEGIN
    IF column_exists('private_bookings', 'event_date') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_event_date ON private_bookings(event_date DESC);
    END IF;
    
    IF column_exists('private_bookings', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_status ON private_bookings(status);
    END IF;
    
    IF column_exists('private_bookings', 'customer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_customer_id ON private_bookings(customer_id);
    END IF;
    
    IF column_exists('private_bookings', 'vendor_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_vendor_id ON private_bookings(vendor_id) WHERE vendor_id IS NOT NULL;
    END IF;
    
    IF column_exists('private_bookings', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_created_at ON private_bookings(created_at DESC);
    END IF;
    
    -- Composite index for common query pattern
    IF column_exists('private_bookings', 'status') AND column_exists('private_bookings', 'event_date') THEN
        CREATE INDEX IF NOT EXISTS idx_private_bookings_status_date ON private_bookings(status, event_date DESC);
    END IF;
END $$;

-- Private booking related tables
DO $$
BEGIN
    IF column_exists('private_booking_items', 'booking_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_items_booking_id ON private_booking_items(booking_id);
    END IF;
    
    IF column_exists('private_booking_payments', 'booking_id') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_payments_booking_id ON private_booking_payments(booking_id);
    END IF;
    
    IF column_exists('private_booking_payments', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_private_booking_payments_status ON private_booking_payments(status);
    END IF;
END $$;

-- Events table indexes
DO $$
BEGIN
    IF column_exists('events', 'event_date') AND column_exists('events', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_events_date_status ON events(event_date, status);
    END IF;
    
    IF column_exists('events', 'category_id') THEN
        CREATE INDEX IF NOT EXISTS idx_events_category_id ON events(category_id);
    END IF;
    
    IF column_exists('events', 'is_published') THEN
        CREATE INDEX IF NOT EXISTS idx_events_is_published ON events(is_published) WHERE is_published = true;
    END IF;
    
    IF column_exists('events', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at DESC);
    END IF;
END $$;

-- Bookings table indexes
DO $$
BEGIN
    IF column_exists('bookings', 'event_id') AND column_exists('bookings', 'customer_id') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_event_customer ON bookings(event_id, customer_id);
    END IF;
    
    IF column_exists('bookings', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);
    END IF;
    
    IF column_exists('bookings', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);
    END IF;
    
    IF column_exists('bookings', 'event_id') THEN
        CREATE INDEX IF NOT EXISTS idx_bookings_event_id ON bookings(event_id);
    END IF;
END $$;

-- Employees table indexes
DO $$
BEGIN
    IF column_exists('employees', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_status ON employees(status);
    END IF;
    
    IF column_exists('employees', 'department') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_department ON employees(department) WHERE department IS NOT NULL;
    END IF;
    
    IF column_exists('employees', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_employees_created_at ON employees(created_at DESC);
    END IF;
END $$;

-- Invoices table indexes
DO $$
BEGIN
    IF column_exists('invoices', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
    END IF;
    
    IF column_exists('invoices', 'vendor_id') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_vendor_id ON invoices(vendor_id);
    END IF;
    
    IF column_exists('invoices', 'invoice_date') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_invoice_date ON invoices(invoice_date DESC);
    END IF;
    
    IF column_exists('invoices', 'due_date') AND column_exists('invoices', 'status') THEN
        CREATE INDEX IF NOT EXISTS idx_invoices_due_date ON invoices(due_date) WHERE status != 'paid';
    END IF;
END $$;

-- Audit logs indexes (for faster queries)
DO $$
BEGIN
    IF column_exists('audit_logs', 'user_id') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);
    END IF;
    
    IF column_exists('audit_logs', 'resource_type') AND column_exists('audit_logs', 'resource_id') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_resource_type_id ON audit_logs(resource_type, resource_id);
    END IF;
    
    IF column_exists('audit_logs', 'created_at') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);
    END IF;
    
    IF column_exists('audit_logs', 'operation_type') THEN
        CREATE INDEX IF NOT EXISTS idx_audit_logs_operation_type ON audit_logs(operation_type);
    END IF;
END $$;

-- Analyze tables to update statistics after adding indexes
DO $$
BEGIN
    -- Only analyze tables that exist
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') THEN
        ANALYZE customers;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') THEN
        ANALYZE messages;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'private_bookings') THEN
        ANALYZE private_bookings;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'private_booking_items') THEN
        ANALYZE private_booking_items;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') THEN
        ANALYZE events;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') THEN
        ANALYZE bookings;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
        ANALYZE employees;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'invoices') THEN
        ANALYZE invoices;
    END IF;
    
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'audit_logs') THEN
        ANALYZE audit_logs;
    END IF;
END $$;

-- Clean up the helper function
DROP FUNCTION IF EXISTS column_exists(text, text);
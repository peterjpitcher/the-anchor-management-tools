-- Squashed migration: Complete schema for The Anchor Management Tools
-- Generated: 2025-06-21
-- This migration consolidates all schema elements from individual migrations

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create storage buckets
INSERT INTO storage.buckets (id, name, public) 
VALUES ('employee-attachments', 'employee-attachments', false)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
CREATE POLICY "Authenticated users can upload employee attachments" ON storage.objects
FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'employee-attachments');

CREATE POLICY "Authenticated users can view employee attachments" ON storage.objects
FOR SELECT TO authenticated
USING (bucket_id = 'employee-attachments');

CREATE POLICY "Authenticated users can delete employee attachments" ON storage.objects
FOR DELETE TO authenticated
USING (bucket_id = 'employee-attachments');

-- Core tables

-- Customers table
CREATE TABLE IF NOT EXISTS public.customers (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    first_name text,
    last_name text,
    email_address text,
    mobile_number text,
    address text,
    notes text,
    sms_opt_in boolean DEFAULT true,
    messaging_status text DEFAULT 'active' CHECK (messaging_status IN ('active', 'suspended', 'inactive')),
    sms_delivery_failures integer DEFAULT 0,
    consecutive_failures integer DEFAULT 0,
    last_failure_date timestamp with time zone,
    suspension_reason text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Event categories
CREATE TABLE IF NOT EXISTS public.event_categories (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    color text NOT NULL,
    icon text NOT NULL,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Events table
CREATE TABLE IF NOT EXISTS public.events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    date date NOT NULL,
    time time,
    location text,
    description text,
    category_id uuid REFERENCES public.event_categories(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Bookings table
CREATE TABLE IF NOT EXISTS public.bookings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    seats integer NOT NULL DEFAULT 1,
    status text DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'cancelled', 'waitlist')),
    notes text,
    discount_amount numeric(10,2) DEFAULT 0,
    discount_percentage numeric(5,2) DEFAULT 0,
    setup_time time,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(customer_id, event_id)
);

-- Employees table
CREATE TABLE IF NOT EXISTS public.employees (
    employee_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    first_name text NOT NULL,
    last_name text NOT NULL,
    email_address text UNIQUE,
    phone_number text,
    job_title text,
    employment_start_date date,
    employment_end_date date,
    date_of_birth date,
    national_insurance_number text,
    address text,
    emergency_contact_name text,
    emergency_contact_phone text,
    status text DEFAULT 'active' CHECK (status IN ('active', 'on_leave', 'terminated')),
    notes text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Employee related tables
CREATE TABLE IF NOT EXISTS public.attachment_categories (
    category_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Insert default attachment categories
INSERT INTO public.attachment_categories (name, description) VALUES
    ('legal_records', 'Legal documents such as contracts and agreements'),
    ('health_records', 'Health and medical documentation'),
    ('certifications', 'Professional certifications and qualifications'),
    ('other', 'Other miscellaneous documents')
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.employee_attachments (
    attachment_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    file_name text NOT NULL,
    file_path text NOT NULL,
    file_size integer,
    mime_type text,
    category_id uuid REFERENCES public.attachment_categories(category_id),
    uploaded_by uuid REFERENCES auth.users(id),
    uploaded_at timestamp with time zone DEFAULT now(),
    description text
);

CREATE TABLE IF NOT EXISTS public.employee_notes (
    note_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    note_text text NOT NULL,
    created_by_user_id uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_emergency_contacts (
    contact_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    contact_name text NOT NULL,
    relationship text NOT NULL,
    phone_number text NOT NULL,
    email text,
    is_primary boolean DEFAULT false,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.employee_financial_details (
    financial_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    bank_name text,
    bank_account_number text,
    bank_sort_code text,
    hourly_rate numeric(10,2),
    salary numeric(10,2),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(employee_id)
);

CREATE TABLE IF NOT EXISTS public.employee_health_records (
    health_id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    blood_type text,
    allergies text,
    medications text,
    medical_conditions text,
    emergency_medical_info text,
    gp_name text,
    gp_phone text,
    gp_address text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(employee_id)
);

-- Employee version tracking
CREATE TABLE IF NOT EXISTS public.employee_version_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
    version_number integer NOT NULL,
    changed_by uuid REFERENCES auth.users(id),
    changed_at timestamp with time zone DEFAULT now(),
    change_type text NOT NULL CHECK (change_type IN ('create', 'update', 'restore')),
    changed_fields text[],
    old_values jsonb,
    new_values jsonb,
    change_summary text,
    UNIQUE(employee_id, version_number)
);

-- Messages and SMS system
CREATE TABLE IF NOT EXISTS public.messages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
    from_number text NOT NULL,
    to_number text NOT NULL,
    message_content text NOT NULL,
    twilio_message_sid text,
    twilio_status text,
    twilio_error_code text,
    twilio_error_message text,
    num_media integer DEFAULT 0,
    num_segments integer DEFAULT 1,
    price numeric(10,4),
    price_unit text,
    sent_at timestamp with time zone,
    delivered_at timestamp with time zone,
    read_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_templates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    template_type text NOT NULL,
    template_name text NOT NULL,
    template_content text NOT NULL,
    variables jsonb DEFAULT '[]'::jsonb,
    is_active boolean DEFAULT true,
    is_default boolean DEFAULT false,
    send_timing text DEFAULT 'immediate' CHECK (send_timing IN ('immediate', '1_hour', '12_hours', '24_hours', '7_days', 'custom')),
    custom_timing_hours integer,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.message_template_history (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    template_id uuid NOT NULL REFERENCES public.message_templates(id) ON DELETE CASCADE,
    changed_by uuid REFERENCES auth.users(id),
    changed_at timestamp with time zone DEFAULT now(),
    old_content text,
    new_content text,
    change_type text NOT NULL CHECK (change_type IN ('create', 'update', 'delete'))
);

CREATE TABLE IF NOT EXISTS public.event_message_templates (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_id uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    template_type text NOT NULL,
    template_content text NOT NULL,
    is_active boolean DEFAULT true,
    send_timing text DEFAULT 'immediate',
    custom_timing_hours integer,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(event_id, template_type)
);

CREATE TABLE IF NOT EXISTS public.message_delivery_status (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    message_id uuid NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
    status text NOT NULL,
    status_details jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.booking_reminders (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
    reminder_type text NOT NULL,
    scheduled_for timestamp with time zone NOT NULL,
    sent_at timestamp with time zone,
    message_id uuid REFERENCES public.messages(id) ON DELETE SET NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'cancelled')),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.webhook_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    webhook_type text NOT NULL,
    message_sid text,
    status text,
    raw_payload jsonb,
    processed_at timestamp with time zone DEFAULT now(),
    error_message text
);

-- Private bookings module
CREATE TABLE IF NOT EXISTS public.private_bookings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_reference text UNIQUE,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
    customer_name text NOT NULL,
    event_type text NOT NULL,
    event_date date NOT NULL,
    event_time time,
    duration_hours integer DEFAULT 4,
    guest_count integer NOT NULL,
    status text DEFAULT 'draft' CHECK (status IN ('draft', 'tentative', 'confirmed', 'cancelled', 'completed')),
    total_amount numeric(10,2) DEFAULT 0,
    deposit_amount numeric(10,2) DEFAULT 0,
    deposit_paid boolean DEFAULT false,
    deposit_paid_date timestamp with time zone,
    balance_amount numeric(10,2) DEFAULT 0,
    balance_paid boolean DEFAULT false,
    balance_paid_date timestamp with time zone,
    balance_due_date date,
    notes text,
    internal_notes text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.venue_spaces (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    description text,
    capacity integer,
    hourly_rate numeric(10,2),
    half_day_rate numeric(10,2),
    full_day_rate numeric(10,2),
    amenities jsonb DEFAULT '[]'::jsonb,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.catering_packages (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    description text,
    price_per_person numeric(10,2),
    minimum_guests integer DEFAULT 1,
    includes jsonb DEFAULT '[]'::jsonb,
    dietary_options jsonb DEFAULT '[]'::jsonb,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vendors (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    service_type text NOT NULL,
    contact_name text,
    contact_phone text,
    contact_email text,
    hourly_rate numeric(10,2),
    flat_rate numeric(10,2),
    notes text,
    active boolean DEFAULT true,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.private_booking_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
    item_type text NOT NULL CHECK (item_type IN ('space', 'catering', 'vendor', 'custom')),
    item_name text NOT NULL,
    quantity integer DEFAULT 1,
    unit_price numeric(10,2) NOT NULL,
    total_price numeric(10,2) NOT NULL,
    space_id uuid REFERENCES public.venue_spaces(id) ON DELETE RESTRICT,
    package_id uuid REFERENCES public.catering_packages(id) ON DELETE RESTRICT,
    vendor_id uuid REFERENCES public.vendors(id) ON DELETE RESTRICT,
    notes text,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.private_booking_documents (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
    document_type text NOT NULL CHECK (document_type IN ('contract', 'invoice', 'receipt', 'other')),
    document_url text NOT NULL,
    generated_at timestamp with time zone DEFAULT now(),
    generated_by uuid REFERENCES auth.users(id),
    sent_at timestamp with time zone,
    notes text
);

CREATE TABLE IF NOT EXISTS public.private_booking_audit (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
    action text NOT NULL,
    old_values jsonb,
    new_values jsonb,
    performed_by uuid REFERENCES auth.users(id),
    performed_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.private_booking_sms_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    booking_id uuid NOT NULL REFERENCES public.private_bookings(id) ON DELETE CASCADE,
    template_type text NOT NULL,
    message_content text NOT NULL,
    scheduled_for timestamp with time zone DEFAULT now(),
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'sent', 'failed', 'cancelled')),
    approved_by uuid REFERENCES auth.users(id),
    approved_at timestamp with time zone,
    sent_at timestamp with time zone,
    error_message text,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now()
);

-- RBAC System
CREATE TABLE IF NOT EXISTS public.roles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL UNIQUE,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.permissions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    module_name text NOT NULL,
    action text NOT NULL,
    description text,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(module_name, action)
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS public.user_roles (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
    assigned_by uuid REFERENCES auth.users(id),
    assigned_at timestamp with time zone DEFAULT now(),
    UNIQUE(user_id, role_id)
);

-- Audit logging
CREATE TABLE IF NOT EXISTS public.audit_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id uuid REFERENCES auth.users(id),
    user_email text,
    operation_type text NOT NULL,
    resource_type text NOT NULL,
    resource_id text,
    operation_status text DEFAULT 'success',
    ip_address inet,
    user_agent text,
    old_values jsonb,
    new_values jsonb,
    error_message text,
    additional_info jsonb,
    created_at timestamp with time zone DEFAULT now()
);

-- Additional tables
CREATE TABLE IF NOT EXISTS public.profiles (
    id uuid REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
    first_name text,
    last_name text,
    email text,
    phone text,
    avatar_url text,
    role text,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_category_stats (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES public.event_categories(id) ON DELETE CASCADE,
    booking_count integer DEFAULT 0,
    last_attended_date date,
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now(),
    UNIQUE(customer_id, category_id)
);

CREATE TABLE IF NOT EXISTS public.reminder_processing_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    processing_type text NOT NULL,
    message text NOT NULL,
    booking_id uuid REFERENCES public.bookings(id) ON DELETE CASCADE,
    event_id uuid REFERENCES public.events(id) ON DELETE CASCADE,
    customer_id uuid REFERENCES public.customers(id) ON DELETE CASCADE,
    template_type text,
    reminder_type text,
    error_details jsonb,
    metadata jsonb,
    created_at timestamp with time zone DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.job_queue (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    type text NOT NULL,
    payload jsonb NOT NULL,
    status text DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    priority integer DEFAULT 0,
    max_attempts integer DEFAULT 3,
    attempt_count integer DEFAULT 0,
    scheduled_for timestamp with time zone DEFAULT now(),
    started_at timestamp with time zone,
    completed_at timestamp with time zone,
    last_error text,
    result jsonb,
    created_by uuid REFERENCES auth.users(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create all functions
CREATE OR REPLACE FUNCTION public.handle_new_user() 
RETURNS TRIGGER 
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.profiles (id, email, created_at, updated_at)
    VALUES (new.id, new.email, now(), now());
    RETURN new;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.user_has_permission(
    p_user_id uuid,
    p_module_name text,
    p_action text
) RETURNS boolean AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1
        FROM user_roles ur
        JOIN role_permissions rp ON ur.role_id = rp.role_id
        JOIN permissions p ON rp.permission_id = p.id
        WHERE ur.user_id = p_user_id
          AND p.module_name = p_module_name
          AND p.action = p_action
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_permissions(p_user_id uuid)
RETURNS TABLE(module_name text, action text) AS $$
BEGIN
    RETURN QUERY
    SELECT DISTINCT p.module_name, p.action
    FROM user_roles ur
    JOIN role_permissions rp ON ur.role_id = rp.role_id
    JOIN permissions p ON rp.permission_id = p.id
    WHERE ur.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_user_roles(p_user_id uuid)
RETURNS TABLE(role_id uuid, role_name text) AS $$
BEGIN
    RETURN QUERY
    SELECT r.id, r.name
    FROM user_roles ur
    JOIN roles r ON ur.role_id = r.id
    WHERE ur.user_id = p_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.log_audit_event(
    p_user_id uuid,
    p_user_email text,
    p_operation_type text,
    p_resource_type text,
    p_resource_id text DEFAULT NULL,
    p_operation_status text DEFAULT 'success',
    p_ip_address inet DEFAULT NULL,
    p_user_agent text DEFAULT NULL,
    p_old_values jsonb DEFAULT NULL,
    p_new_values jsonb DEFAULT NULL,
    p_error_message text DEFAULT NULL,
    p_additional_info jsonb DEFAULT NULL
) RETURNS uuid AS $$
DECLARE
    v_audit_id uuid;
BEGIN
    INSERT INTO audit_logs (
        user_id, user_email, operation_type, resource_type, resource_id,
        operation_status, ip_address, user_agent, old_values, new_values,
        error_message, additional_info, created_at
    ) VALUES (
        p_user_id, p_user_email, p_operation_type, p_resource_type, p_resource_id,
        p_operation_status, p_ip_address, p_user_agent, p_old_values, p_new_values,
        p_error_message, p_additional_info, now()
    ) RETURNING id INTO v_audit_id;
    
    RETURN v_audit_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_update()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs cannot be updated';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.prevent_audit_log_deletion()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Audit logs cannot be deleted';
    RETURN OLD;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.log_template_change()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO message_template_history (
        template_id,
        changed_by,
        changed_at,
        old_content,
        new_content,
        change_type
    ) VALUES (
        NEW.id,
        auth.uid(),
        now(),
        OLD.template_content,
        NEW.template_content,
        'update'
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_customer_messaging_health()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.status IN ('failed', 'undelivered') THEN
        UPDATE customers
        SET 
            sms_delivery_failures = sms_delivery_failures + 1,
            consecutive_failures = consecutive_failures + 1,
            last_failure_date = now()
        WHERE id = (
            SELECT customer_id 
            FROM messages 
            WHERE id = NEW.message_id
        );
    ELSIF NEW.status = 'delivered' THEN
        UPDATE customers
        SET consecutive_failures = 0
        WHERE id = (
            SELECT customer_id 
            FROM messages 
            WHERE id = NEW.message_id
        );
    END IF;
    
    UPDATE customers
    SET messaging_status = CASE
        WHEN consecutive_failures >= 5 THEN 'suspended'
        WHEN sms_delivery_failures > 10 THEN 'inactive'
        ELSE 'active'
    END
    WHERE id = (
        SELECT customer_id 
        FROM messages 
        WHERE id = NEW.message_id
    );
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_customer_sms_status()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.direction = 'outbound' AND NEW.twilio_status IN ('failed', 'undelivered') THEN
        UPDATE customers
        SET 
            sms_delivery_failures = sms_delivery_failures + 1,
            consecutive_failures = CASE 
                WHEN OLD.twilio_status NOT IN ('failed', 'undelivered') 
                THEN consecutive_failures + 1 
                ELSE consecutive_failures 
            END,
            last_failure_date = now()
        WHERE id = NEW.customer_id;
    ELSIF NEW.direction = 'outbound' AND NEW.twilio_status = 'delivered' AND OLD.twilio_status != 'delivered' THEN
        UPDATE customers
        SET consecutive_failures = 0
        WHERE id = NEW.customer_id;
    END IF;
    
    UPDATE customers
    SET messaging_status = CASE
        WHEN consecutive_failures >= 5 THEN 'suspended'
        WHEN sms_delivery_failures > 10 THEN 'inactive'
        ELSE 'active'
    END
    WHERE id = NEW.customer_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_balance_due_date()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.event_date IS NOT NULL AND NEW.balance_due_date IS NULL THEN
        NEW.balance_due_date := NEW.event_date - INTERVAL '7 days';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.sync_customer_name_from_customers()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.customer_id IS NOT NULL THEN
        SELECT name INTO NEW.customer_name
        FROM customers
        WHERE id = NEW.customer_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_next_booking_reference()
RETURNS text AS $$
DECLARE
    v_year text;
    v_count integer;
    v_reference text;
BEGIN
    v_year := to_char(CURRENT_DATE, 'YY');
    
    SELECT COUNT(*) + 1 INTO v_count
    FROM private_bookings
    WHERE booking_reference LIKE 'PB' || v_year || '%';
    
    v_reference := 'PB' || v_year || lpad(v_count::text, 4, '0');
    
    RETURN v_reference;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_messages_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.render_template(p_template text, p_variables jsonb)
RETURNS text AS $$
DECLARE
    v_rendered text := p_template;
    v_key text;
    v_value text;
BEGIN
    FOR v_key, v_value IN SELECT * FROM jsonb_each_text(p_variables)
    LOOP
        v_rendered := replace(v_rendered, '{{' || v_key || '}}', COALESCE(v_value, ''));
    END LOOP;
    
    RETURN v_rendered;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.calculate_send_time(
    p_event_timestamp timestamp with time zone,
    p_send_timing text,
    p_custom_hours integer DEFAULT NULL
) RETURNS timestamp with time zone AS $$
BEGIN
    CASE p_send_timing
        WHEN 'immediate' THEN
            RETURN NOW();
        WHEN '1_hour' THEN
            RETURN p_event_timestamp - INTERVAL '1 hour';
        WHEN '12_hours' THEN
            RETURN p_event_timestamp - INTERVAL '12 hours';
        WHEN '24_hours' THEN
            RETURN p_event_timestamp - INTERVAL '24 hours';
        WHEN '7_days' THEN
            RETURN p_event_timestamp - INTERVAL '7 days';
        WHEN 'custom' THEN
            IF p_custom_hours IS NOT NULL THEN
                RETURN p_event_timestamp - (p_custom_hours || ' hours')::INTERVAL;
            ELSE
                RETURN p_event_timestamp;
            END IF;
        ELSE
            RETURN p_event_timestamp;
    END CASE;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_message_template(
    p_event_id uuid,
    p_template_type text
) RETURNS TABLE(
    template_content text,
    send_timing text,
    custom_timing_hours integer
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        COALESCE(emt.template_content, mt.template_content) as template_content,
        COALESCE(emt.send_timing, mt.send_timing) as send_timing,
        COALESCE(emt.custom_timing_hours, mt.custom_timing_hours) as custom_timing_hours
    FROM message_templates mt
    LEFT JOIN event_message_templates emt 
        ON emt.event_id = p_event_id 
        AND emt.template_type = p_template_type
        AND emt.is_active = true
    WHERE mt.template_type = p_template_type
      AND mt.is_active = true
      AND mt.is_default = true
    LIMIT 1;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.ensure_single_default_category()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_default = true THEN
        UPDATE event_categories 
        SET is_default = false 
        WHERE id != NEW.id AND is_default = true;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.check_event_date_not_past()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Cannot create events with dates in the past';
        END IF;
    END IF;
    
    IF TG_OP = 'UPDATE' THEN
        IF OLD.date >= CURRENT_DATE AND NEW.date < CURRENT_DATE THEN
            RAISE EXCEPTION 'Cannot change event date to the past';
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.update_customer_category_stats()
RETURNS TRIGGER AS $$
DECLARE
    v_category_id uuid;
BEGIN
    SELECT category_id INTO v_category_id
    FROM events
    WHERE id = NEW.event_id;
    
    IF v_category_id IS NOT NULL THEN
        INSERT INTO customer_category_stats (
            customer_id, 
            category_id, 
            booking_count, 
            last_attended_date
        ) VALUES (
            NEW.customer_id, 
            v_category_id, 
            1, 
            (SELECT date FROM events WHERE id = NEW.event_id)
        )
        ON CONFLICT (customer_id, category_id) DO UPDATE
        SET 
            booking_count = customer_category_stats.booking_count + 1,
            last_attended_date = GREATEST(
                customer_category_stats.last_attended_date, 
                (SELECT date FROM events WHERE id = NEW.event_id)
            ),
            updated_at = now();
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.log_reminder_processing(
    p_processing_type text,
    p_message text,
    p_booking_id uuid DEFAULT NULL,
    p_event_id uuid DEFAULT NULL,
    p_customer_id uuid DEFAULT NULL,
    p_template_type text DEFAULT NULL,
    p_reminder_type text DEFAULT NULL,
    p_error_details jsonb DEFAULT NULL,
    p_metadata jsonb DEFAULT NULL
) RETURNS void AS $$
BEGIN
    INSERT INTO reminder_processing_logs (
        processing_type,
        message,
        booking_id,
        event_id,
        customer_id,
        template_type,
        reminder_type,
        error_details,
        metadata,
        created_at
    ) VALUES (
        p_processing_type,
        p_message,
        p_booking_id,
        p_event_id,
        p_customer_id,
        p_template_type,
        p_reminder_type,
        p_error_details,
        p_metadata,
        now()
    );
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION public.get_all_users_with_roles()
RETURNS TABLE(
    id uuid,
    email text,
    created_at timestamp with time zone,
    last_sign_in_at timestamp with time zone,
    roles jsonb
) AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 
        FROM public.user_roles ur
        JOIN public.roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() 
        AND r.name = 'super_admin'
    ) THEN
        RAISE EXCEPTION 'Access denied. Only super admins can view all users.';
    END IF;
    
    RETURN QUERY
    SELECT 
        u.id,
        u.email::TEXT,
        u.created_at,
        u.last_sign_in_at,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', r.id,
                    'name', r.name,
                    'description', r.description
                )
            ) FILTER (WHERE r.id IS NOT NULL),
            '[]'::jsonb
        ) as roles
    FROM auth.users u
    LEFT JOIN public.user_roles ur ON u.id = ur.user_id
    LEFT JOIN public.roles r ON ur.role_id = r.id
    GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at
    ORDER BY u.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create views
CREATE OR REPLACE VIEW public.customer_messaging_health AS
SELECT 
    c.id,
    c.name,
    c.mobile_number,
    c.sms_opt_in,
    c.messaging_status,
    c.sms_delivery_failures,
    c.consecutive_failures,
    c.last_failure_date,
    COUNT(DISTINCT m.id) as total_messages_sent,
    COUNT(DISTINCT CASE WHEN m.twilio_status = 'delivered' THEN m.id END) as delivered_count,
    COUNT(DISTINCT CASE WHEN m.twilio_status IN ('failed', 'undelivered') THEN m.id END) as failed_count,
    MAX(m.created_at) as last_message_date,
    CASE
        WHEN c.consecutive_failures >= 5 THEN 'High Risk - Multiple consecutive failures'
        WHEN c.sms_delivery_failures > 10 THEN 'Chronic Issues - High total failure count'
        WHEN c.last_failure_date > (now() - interval '7 days') THEN 'Recent Issues - Failed in last week'
        WHEN c.sms_opt_in = false THEN 'Opted Out'
        ELSE 'Healthy'
    END as health_status
FROM customers c
LEFT JOIN messages m ON m.customer_id = c.id AND m.direction = 'outbound'
GROUP BY c.id;

CREATE OR REPLACE VIEW public.message_templates_with_timing AS
SELECT 
    mt.*,
    CASE 
        WHEN mt.send_timing = 'immediate' THEN 'Immediate'
        WHEN mt.send_timing = '1_hour' THEN '1 hour before'
        WHEN mt.send_timing = '12_hours' THEN '12 hours before'
        WHEN mt.send_timing = '24_hours' THEN '24 hours before'
        WHEN mt.send_timing = '7_days' THEN '7 days before'
        WHEN mt.send_timing = 'custom' THEN mt.custom_timing_hours || ' hours before'
        ELSE mt.send_timing
    END AS timing_display
FROM message_templates mt;

CREATE OR REPLACE VIEW public.admin_users_view AS
SELECT 
    u.id,
    u.email,
    u.created_at,
    u.last_sign_in_at,
    COALESCE(
        jsonb_agg(
            DISTINCT jsonb_build_object(
                'id', r.id,
                'name', r.name,
                'description', r.description
            )
        ) FILTER (WHERE r.id IS NOT NULL),
        '[]'::jsonb
    ) as roles
FROM auth.users u
LEFT JOIN public.user_roles ur ON u.id = ur.user_id
LEFT JOIN public.roles r ON ur.role_id = r.id
GROUP BY u.id, u.email, u.created_at, u.last_sign_in_at;

CREATE OR REPLACE VIEW public.private_bookings_with_details AS
SELECT 
    pb.*,
    c.name as customer_name_from_customer,
    c.email_address as customer_email,
    c.mobile_number as customer_phone,
    COALESCE(
        jsonb_agg(
            DISTINCT jsonb_build_object(
                'id', pbi.id,
                'item_type', pbi.item_type,
                'item_name', pbi.item_name,
                'quantity', pbi.quantity,
                'unit_price', pbi.unit_price,
                'total_price', pbi.total_price
            )
        ) FILTER (WHERE pbi.id IS NOT NULL),
        '[]'::jsonb
    ) as items
FROM private_bookings pb
LEFT JOIN customers c ON pb.customer_id = c.id
LEFT JOIN private_booking_items pbi ON pb.id = pbi.booking_id
GROUP BY pb.id, c.name, c.email_address, c.mobile_number;

CREATE OR REPLACE VIEW public.private_booking_summary AS
SELECT 
    pb.id,
    pb.booking_reference,
    pb.customer_name,
    pb.event_type,
    pb.event_date,
    pb.status,
    pb.total_amount,
    pb.deposit_paid,
    pb.balance_paid,
    COUNT(DISTINCT pbi.id) as item_count,
    COUNT(DISTINCT pbd.id) as document_count
FROM private_bookings pb
LEFT JOIN private_booking_items pbi ON pb.id = pbi.booking_id
LEFT JOIN private_booking_documents pbd ON pb.id = pbd.booking_id
GROUP BY pb.id;

CREATE OR REPLACE VIEW public.recent_reminder_activity AS
SELECT 
    rpl.id,
    rpl.processing_type,
    rpl.message,
    rpl.created_at,
    rpl.template_type,
    rpl.reminder_type,
    rpl.error_details,
    b.id as booking_id,
    e.id as event_id,
    e.name as event_name,
    e.date as event_date,
    c.id as customer_id,
    c.name as customer_name
FROM reminder_processing_logs rpl
LEFT JOIN bookings b ON rpl.booking_id = b.id
LEFT JOIN events e ON rpl.event_id = e.id
LEFT JOIN customers c ON rpl.customer_id = c.id
ORDER BY rpl.created_at DESC
LIMIT 100;

CREATE OR REPLACE VIEW public.reminder_timing_debug AS
SELECT 
    b.id as booking_id,
    c.name as customer_name,
    e.name as event_name,
    e.date as event_date,
    e.time as event_time,
    (e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone as event_timestamp,
    mt.template_type,
    mt.send_timing,
    mt.custom_timing_hours,
    CASE 
        WHEN mt.send_timing = '24_hours' THEN (e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - INTERVAL '24 hours'
        WHEN mt.send_timing = '7_days' THEN (e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - INTERVAL '7 days'
        WHEN mt.send_timing = 'custom' AND mt.custom_timing_hours IS NOT NULL THEN 
            (e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - (mt.custom_timing_hours || ' hours')::INTERVAL
        ELSE NOW()
    END as calculated_send_time,
    NOW() as current_time,
    CASE 
        WHEN mt.send_timing = '24_hours' THEN 
            ((e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - INTERVAL '24 hours') <= NOW()
        WHEN mt.send_timing = '7_days' THEN 
            ((e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - INTERVAL '7 days') <= NOW()
        WHEN mt.send_timing = 'custom' AND mt.custom_timing_hours IS NOT NULL THEN 
            ((e.date + COALESCE(e.time, '00:00:00'::time))::timestamp with time zone - (mt.custom_timing_hours || ' hours')::INTERVAL) <= NOW()
        ELSE false
    END as should_send_now,
    br.id as existing_reminder_id,
    br.status as reminder_status
FROM bookings b
JOIN events e ON b.event_id = e.id
JOIN customers c ON b.customer_id = c.id
CROSS JOIN message_templates mt
LEFT JOIN booking_reminders br ON 
    br.booking_id = b.id AND 
    br.reminder_type = mt.template_type
WHERE e.date >= CURRENT_DATE
  AND c.sms_opt_in = true
  AND c.mobile_number IS NOT NULL
  AND mt.is_active = true
  AND mt.template_type IN ('booking_reminder_24_hour', 'booking_reminder_7_day')
ORDER BY e.date, e.time, c.name, mt.template_type;

-- Create indexes
CREATE INDEX idx_customers_mobile_number ON public.customers(mobile_number);
CREATE INDEX idx_customers_sms_opt_in ON public.customers(sms_opt_in);
CREATE INDEX idx_customers_messaging_status ON public.customers(messaging_status);
CREATE INDEX idx_customers_sms_delivery_failures ON public.customers(sms_delivery_failures);
CREATE INDEX idx_customers_consecutive_failures ON public.customers(consecutive_failures);
CREATE INDEX idx_customers_sms_failures ON public.customers(sms_opt_in, sms_delivery_failures) 
    WHERE sms_opt_in = false OR sms_delivery_failures > 0;

CREATE INDEX idx_events_date ON public.events(date);
CREATE INDEX idx_events_category_id ON public.events(category_id);

CREATE INDEX idx_bookings_customer_id ON public.bookings(customer_id);
CREATE INDEX idx_bookings_event_id ON public.bookings(event_id);
CREATE INDEX idx_bookings_status ON public.bookings(status);

CREATE INDEX idx_messages_customer_id ON public.messages(customer_id);
CREATE INDEX idx_messages_direction ON public.messages(direction);
CREATE INDEX idx_messages_twilio_status ON public.messages(twilio_status);
CREATE INDEX idx_messages_created_at ON public.messages(created_at);
CREATE INDEX idx_messages_from_number ON public.messages(from_number);
CREATE INDEX idx_messages_twilio_message_sid ON public.messages(twilio_message_sid);
CREATE INDEX idx_messages_customer_created ON public.messages(customer_id, created_at DESC);
CREATE INDEX idx_messages_customer_id_created_at ON public.messages(customer_id, created_at);
CREATE INDEX idx_messages_customer_direction_status ON public.messages(customer_id, direction, twilio_status) 
    WHERE direction = 'outbound';
CREATE INDEX idx_messages_direction_created_at ON public.messages(direction, created_at DESC) 
    WHERE direction = 'inbound';
CREATE INDEX idx_messages_unread_inbound ON public.messages(direction, read_at) 
    WHERE direction = 'inbound' AND read_at IS NULL;

CREATE INDEX idx_message_templates_type ON public.message_templates(template_type);
CREATE INDEX idx_message_templates_send_timing ON public.message_templates(send_timing);
CREATE INDEX idx_message_templates_default ON public.message_templates(is_default);

CREATE INDEX idx_message_delivery_status_message_id ON public.message_delivery_status(message_id);
CREATE INDEX idx_message_delivery_status_created_at ON public.message_delivery_status(created_at);
CREATE INDEX idx_message_delivery_message ON public.message_delivery_status(message_id, created_at DESC);

CREATE INDEX idx_event_message_templates_event ON public.event_message_templates(event_id);
CREATE INDEX idx_event_message_templates_send_timing ON public.event_message_templates(send_timing);

CREATE INDEX idx_booking_reminders_booking_id ON public.booking_reminders(booking_id);
CREATE INDEX idx_booking_reminders_scheduled_for ON public.booking_reminders(scheduled_for);
CREATE INDEX idx_booking_reminders_status ON public.booking_reminders(status);

CREATE INDEX idx_webhook_logs_webhook_type ON public.webhook_logs(webhook_type);
CREATE INDEX idx_webhook_logs_message_sid ON public.webhook_logs(message_sid);
CREATE INDEX idx_webhook_logs_status ON public.webhook_logs(status);
CREATE INDEX idx_webhook_logs_processed_at ON public.webhook_logs(processed_at DESC);

CREATE INDEX idx_employees_status ON public.employees(status);
CREATE INDEX idx_employees_employment_dates ON public.employees(employment_start_date, employment_end_date);
CREATE INDEX idx_employees_name_search ON public.employees(last_name, first_name);
CREATE UNIQUE INDEX idx_employees_email ON public.employees(email_address);

CREATE INDEX idx_employee_attachments_employee_id ON public.employee_attachments(employee_id);
CREATE INDEX idx_employee_attachments_category ON public.employee_attachments(category_id, uploaded_at DESC);

CREATE INDEX idx_employee_notes_employee_id ON public.employee_notes(employee_id);
CREATE INDEX idx_employee_notes_created_at ON public.employee_notes(created_at DESC);
CREATE INDEX idx_employee_notes_employee_created ON public.employee_notes(employee_id, created_at DESC);

CREATE INDEX idx_employee_emergency_contacts_employee_id ON public.employee_emergency_contacts(employee_id);
CREATE INDEX idx_employee_financial_details_employee_id ON public.employee_financial_details(employee_id);
CREATE INDEX idx_employee_health_records_employee_id ON public.employee_health_records(employee_id);

CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_operation_type ON public.audit_logs(operation_type);
CREATE INDEX idx_audit_logs_resource_type ON public.audit_logs(resource_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at DESC);
CREATE INDEX idx_audit_logs_operation_status ON public.audit_logs(operation_status);

CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_user_roles_role_id ON public.user_roles(role_id);

CREATE INDEX idx_role_permissions_role_id ON public.role_permissions(role_id);
CREATE INDEX idx_role_permissions_permission_id ON public.role_permissions(permission_id);

CREATE INDEX idx_permissions_module_name ON public.permissions(module_name);

CREATE INDEX idx_private_bookings_customer_id ON public.private_bookings(customer_id);
CREATE INDEX idx_private_bookings_status ON public.private_bookings(status);
CREATE INDEX idx_private_bookings_event_date ON public.private_bookings(event_date);
CREATE INDEX idx_private_bookings_created_at ON public.private_bookings(created_at DESC);

CREATE INDEX idx_private_booking_items_booking_id ON public.private_booking_items(booking_id);
CREATE INDEX idx_private_booking_items_type ON public.private_booking_items(item_type);

CREATE INDEX idx_private_booking_audit_booking_id ON public.private_booking_audit(booking_id);
CREATE INDEX idx_private_booking_audit_performed_at ON public.private_booking_audit(performed_at DESC);

CREATE INDEX idx_private_booking_sms_queue_booking_id ON public.private_booking_sms_queue(booking_id);
CREATE INDEX idx_private_booking_sms_queue_status_scheduled ON public.private_booking_sms_queue(status, scheduled_for) 
    WHERE status IN ('pending', 'approved');

CREATE INDEX idx_customer_category_stats_customer_id ON public.customer_category_stats(customer_id);
CREATE INDEX idx_customer_category_stats_category_id ON public.customer_category_stats(category_id);
CREATE INDEX idx_customer_category_stats_last_attended ON public.customer_category_stats(last_attended_date DESC);

CREATE INDEX idx_reminder_logs_booking_id ON public.reminder_processing_logs(booking_id);
CREATE INDEX idx_reminder_logs_created_at ON public.reminder_processing_logs(created_at DESC);
CREATE INDEX idx_reminder_logs_processing_type ON public.reminder_processing_logs(processing_type);

CREATE INDEX idx_job_queue_status ON public.job_queue(status);
CREATE INDEX idx_job_queue_type ON public.job_queue(type);
CREATE INDEX idx_job_queue_created_at ON public.job_queue(created_at);

-- Create triggers
CREATE TRIGGER on_auth_user_created AFTER INSERT ON auth.users FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

CREATE TRIGGER update_customers_updated_at BEFORE UPDATE ON public.customers FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_events_updated_at BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_bookings_updated_at BEFORE UPDATE ON public.bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_employees_updated_at BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER on_employees_updated BEFORE UPDATE ON public.employees FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER update_messages_updated_at BEFORE UPDATE ON public.messages FOR EACH ROW EXECUTE FUNCTION public.update_messages_updated_at();
CREATE TRIGGER update_message_templates_updated_at BEFORE UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_profiles_updated_at BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON public.roles FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_attachment_categories_updated_at BEFORE UPDATE ON public.attachment_categories FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_private_bookings_updated_at BEFORE UPDATE ON public.private_bookings FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_venue_spaces_updated_at BEFORE UPDATE ON public.venue_spaces FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_catering_packages_updated_at BEFORE UPDATE ON public.catering_packages FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER update_vendors_updated_at BEFORE UPDATE ON public.vendors FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER on_financial_details_updated BEFORE UPDATE ON public.employee_financial_details FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
CREATE TRIGGER on_health_records_updated BEFORE UPDATE ON public.employee_health_records FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

CREATE TRIGGER prevent_audit_log_update BEFORE UPDATE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_update();
CREATE TRIGGER prevent_audit_log_delete BEFORE DELETE ON public.audit_logs FOR EACH ROW EXECUTE FUNCTION public.prevent_audit_log_deletion();

CREATE TRIGGER log_template_changes AFTER UPDATE ON public.message_templates FOR EACH ROW EXECUTE FUNCTION public.log_template_change();

CREATE TRIGGER update_customer_health_on_delivery_status AFTER INSERT OR UPDATE ON public.message_delivery_status FOR EACH ROW EXECUTE FUNCTION public.update_customer_messaging_health();
CREATE TRIGGER update_customer_sms_status_trigger AFTER UPDATE OF twilio_status ON public.messages FOR EACH ROW WHEN (NEW.twilio_status IS DISTINCT FROM OLD.twilio_status) EXECUTE FUNCTION public.update_customer_sms_status();

CREATE TRIGGER set_balance_due_date BEFORE INSERT OR UPDATE OF event_date ON public.private_bookings FOR EACH ROW EXECUTE FUNCTION public.calculate_balance_due_date();
CREATE TRIGGER sync_customer_name_trigger BEFORE INSERT OR UPDATE OF customer_id ON public.private_bookings FOR EACH ROW EXECUTE FUNCTION public.sync_customer_name_from_customers();

CREATE TRIGGER enforce_single_default_category BEFORE INSERT OR UPDATE ON public.event_categories FOR EACH ROW WHEN (NEW.is_default = true) EXECUTE FUNCTION public.ensure_single_default_category();
CREATE TRIGGER enforce_event_date_not_past BEFORE INSERT OR UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.check_event_date_not_past();
CREATE TRIGGER booking_category_stats_trigger AFTER INSERT ON public.bookings FOR EACH ROW WHEN (NEW.seats > 0) EXECUTE FUNCTION public.update_customer_category_stats();

-- Enable Row Level Security
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_financial_details ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.employee_health_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_template_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_message_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.message_delivery_status ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.booking_reminders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_audit ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.private_booking_sms_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.venue_spaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.catering_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.event_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_category_stats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_processing_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_queue ENABLE ROW LEVEL SECURITY;

-- Create RLS policies

-- Customers policies
CREATE POLICY "Users with customers view permission can view customers" ON public.customers
    FOR SELECT TO authenticated
    USING (user_has_permission(auth.uid(), 'customers', 'view'));

CREATE POLICY "Users with customers create permission can create customers" ON public.customers
    FOR INSERT TO authenticated
    WITH CHECK (user_has_permission(auth.uid(), 'customers', 'create'));

CREATE POLICY "Users with customers edit permission can update customers" ON public.customers
    FOR UPDATE TO authenticated
    USING (user_has_permission(auth.uid(), 'customers', 'edit'))
    WITH CHECK (user_has_permission(auth.uid(), 'customers', 'edit'));

CREATE POLICY "Users with customers delete permission can delete customers" ON public.customers
    FOR DELETE TO authenticated
    USING (user_has_permission(auth.uid(), 'customers', 'delete'));

-- Events policies
CREATE POLICY "Users with events view permission can view events" ON public.events
    FOR SELECT TO authenticated
    USING (user_has_permission(auth.uid(), 'events', 'view'));

CREATE POLICY "Users with events create permission can create events" ON public.events
    FOR INSERT TO authenticated
    WITH CHECK (user_has_permission(auth.uid(), 'events', 'create'));

CREATE POLICY "Users with events edit permission can update events" ON public.events
    FOR UPDATE TO authenticated
    USING (user_has_permission(auth.uid(), 'events', 'edit'))
    WITH CHECK (user_has_permission(auth.uid(), 'events', 'edit'));

CREATE POLICY "Users with events delete permission can delete events" ON public.events
    FOR DELETE TO authenticated
    USING (user_has_permission(auth.uid(), 'events', 'delete'));

-- Bookings policies
CREATE POLICY "Users with bookings view permission can view bookings" ON public.bookings
    FOR SELECT TO authenticated
    USING (user_has_permission(auth.uid(), 'bookings', 'view'));

CREATE POLICY "Users with bookings create permission can create bookings" ON public.bookings
    FOR INSERT TO authenticated
    WITH CHECK (user_has_permission(auth.uid(), 'bookings', 'create'));

CREATE POLICY "Users with bookings edit permission can update bookings" ON public.bookings
    FOR UPDATE TO authenticated
    USING (user_has_permission(auth.uid(), 'bookings', 'edit'))
    WITH CHECK (user_has_permission(auth.uid(), 'bookings', 'edit'));

CREATE POLICY "Users with bookings delete permission can delete bookings" ON public.bookings
    FOR DELETE TO authenticated
    USING (user_has_permission(auth.uid(), 'bookings', 'delete'));

-- Employee policies
CREATE POLICY "Users can view all employees" ON public.employees
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create employees" ON public.employees
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update employees" ON public.employees
    FOR UPDATE TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can delete employees" ON public.employees
    FOR DELETE TO authenticated USING (true);

-- Employee related tables policies
CREATE POLICY "Users can view attachments" ON public.employee_attachments
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage attachments" ON public.employee_attachments
    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can view notes" ON public.employee_notes
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can create notes" ON public.employee_notes
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Users can update own notes" ON public.employee_notes
    FOR UPDATE TO authenticated
    USING (auth.uid() = created_by_user_id)
    WITH CHECK (auth.uid() = created_by_user_id);

CREATE POLICY "Users can delete own notes" ON public.employee_notes
    FOR DELETE TO authenticated
    USING (auth.uid() = created_by_user_id);

CREATE POLICY "Users can view emergency contacts" ON public.employee_emergency_contacts
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage emergency contacts" ON public.employee_emergency_contacts
    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can view financial details" ON public.employee_financial_details
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage financial details" ON public.employee_financial_details
    TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Users can view health records" ON public.employee_health_records
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can manage health records" ON public.employee_health_records
    TO authenticated USING (true) WITH CHECK (true);

-- Messages policies
CREATE POLICY "Allow authenticated users to read messages" ON public.messages
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert messages" ON public.messages
    FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "Allow authenticated users to read message delivery status" ON public.message_delivery_status
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow authenticated users to insert message delivery status" ON public.message_delivery_status
    FOR INSERT TO authenticated WITH CHECK (true);

-- Message templates policies
CREATE POLICY "Users can view all templates" ON public.message_templates
    FOR SELECT USING (true);

CREATE POLICY "Users can manage templates" ON public.message_templates
    USING (auth.role() = 'authenticated');

CREATE POLICY "Users can view event templates" ON public.event_message_templates
    FOR SELECT USING (true);

CREATE POLICY "Users can manage event templates" ON public.event_message_templates
    USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated users can view template history" ON public.message_template_history
    FOR SELECT USING (auth.role() = 'authenticated');

CREATE POLICY "System can insert template history" ON public.message_template_history
    FOR INSERT WITH CHECK (true);

-- Booking reminders policies
CREATE POLICY "Service role can manage booking_reminders" ON public.booking_reminders
    USING (auth.role() = 'service_role');

-- Webhook logs policies
CREATE POLICY "Allow public inserts to webhook_logs" ON public.webhook_logs
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Allow authenticated users to read webhook_logs" ON public.webhook_logs
    FOR SELECT TO authenticated USING (true);

-- Profiles policies
CREATE POLICY "Allow public read access to profiles" ON public.profiles
    FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');

CREATE POLICY "Allow individual users to update their own profile" ON public.profiles
    FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);

-- Audit logs policies
CREATE POLICY "audit_logs_insert_policy" ON public.audit_logs
    FOR INSERT WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

CREATE POLICY "audit_logs_read_policy" ON public.audit_logs
    FOR SELECT USING (user_has_permission(auth.uid(), 'settings', 'view') OR user_id = auth.uid());

CREATE POLICY "Users can view own auth logs" ON public.audit_logs
    FOR SELECT USING (auth.role() = 'authenticated' AND user_id = auth.uid() AND operation_type IN ('login', 'logout'));

CREATE POLICY "Users can view limited audit logs for dashboard" ON public.audit_logs
    FOR SELECT USING (auth.role() = 'authenticated' AND resource_type IN ('employee', 'message_template', 'bulk_message') AND operation_type IN ('create', 'update', 'delete'));

CREATE POLICY "Users with audit permission can view all logs" ON public.audit_logs
    FOR SELECT USING (EXISTS (
        SELECT 1 FROM user_has_permission(auth.uid(), 'audit_logs', 'view') user_has_permission(user_has_permission)
        WHERE user_has_permission = true
    ));

-- RBAC policies
CREATE POLICY "Authenticated users can view roles" ON public.roles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only users with role management permission can manage roles" ON public.roles
    TO authenticated USING (user_has_permission(auth.uid(), 'roles', 'manage'));

CREATE POLICY "Authenticated users can view permissions" ON public.permissions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only users with role management permission can manage permissio" ON public.permissions
    TO authenticated USING (user_has_permission(auth.uid(), 'roles', 'manage'));

CREATE POLICY "Authenticated users can view role permissions" ON public.role_permissions
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Only users with role management permission can manage role perm" ON public.role_permissions
    TO authenticated USING (user_has_permission(auth.uid(), 'roles', 'manage'));

CREATE POLICY "Users can view their own roles" ON public.user_roles
    FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR user_has_permission(auth.uid(), 'users', 'view'));

CREATE POLICY "Only users with user management permission can manage user role" ON public.user_roles
    TO authenticated USING (user_has_permission(auth.uid(), 'users', 'manage_roles'));

-- Private bookings policies
CREATE POLICY "Users can view private bookings with permission" ON public.private_bookings
    FOR SELECT TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'view'));

CREATE POLICY "Users can create private bookings with permission" ON public.private_bookings
    FOR INSERT TO authenticated
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'create'));

CREATE POLICY "Users can update private bookings with permission" ON public.private_bookings
    FOR UPDATE TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'edit'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'edit'));

CREATE POLICY "Users can delete private bookings with permission" ON public.private_bookings
    FOR DELETE TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'delete'));

CREATE POLICY "Users can view booking items with booking view permission" ON public.private_booking_items
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM private_bookings pb
        WHERE pb.id = private_booking_items.booking_id
        AND user_has_permission(auth.uid(), 'private_bookings', 'view')
    ));

CREATE POLICY "Users can manage booking items with booking edit permission" ON public.private_booking_items
    TO authenticated
    USING (EXISTS (
        SELECT 1 FROM private_bookings pb
        WHERE pb.id = private_booking_items.booking_id
        AND user_has_permission(auth.uid(), 'private_bookings', 'edit')
    ))
    WITH CHECK (EXISTS (
        SELECT 1 FROM private_bookings pb
        WHERE pb.id = private_booking_items.booking_id
        AND user_has_permission(auth.uid(), 'private_bookings', 'edit')
    ));

CREATE POLICY "Users can view documents with booking view permission" ON public.private_booking_documents
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM private_bookings pb
        WHERE pb.id = private_booking_documents.booking_id
        AND user_has_permission(auth.uid(), 'private_bookings', 'view')
    ));

CREATE POLICY "Users can manage documents with permission" ON public.private_booking_documents
    TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'generate_contracts'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'generate_contracts'));

CREATE POLICY "Users can view audit trail with booking view permission" ON public.private_booking_audit
    FOR SELECT TO authenticated
    USING (EXISTS (
        SELECT 1 FROM private_bookings pb
        WHERE pb.id = private_booking_audit.booking_id
        AND user_has_permission(auth.uid(), 'private_bookings', 'view')
    ));

CREATE POLICY "Users can view SMS queue with permission" ON public.private_booking_sms_queue
    FOR SELECT TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'view_sms_queue'));

CREATE POLICY "Users can approve SMS with permission" ON public.private_booking_sms_queue
    FOR UPDATE TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'approve_sms'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'approve_sms'));

-- Venue management policies
CREATE POLICY "All authenticated users can view active venue spaces" ON public.venue_spaces
    FOR SELECT TO authenticated
    USING (active = true OR user_has_permission(auth.uid(), 'private_bookings', 'manage_spaces'));

CREATE POLICY "Users can manage venue spaces with permission" ON public.venue_spaces
    TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'manage_spaces'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage_spaces'));

CREATE POLICY "All authenticated users can view active catering packages" ON public.catering_packages
    FOR SELECT TO authenticated
    USING (active = true OR user_has_permission(auth.uid(), 'private_bookings', 'manage_catering'));

CREATE POLICY "Users can manage catering packages with permission" ON public.catering_packages
    TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'manage_catering'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage_catering'));

CREATE POLICY "All authenticated users can view active vendors" ON public.vendors
    FOR SELECT TO authenticated
    USING (active = true OR user_has_permission(auth.uid(), 'private_bookings', 'manage_vendors'));

CREATE POLICY "Users can manage vendors with permission" ON public.vendors
    TO authenticated
    USING (user_has_permission(auth.uid(), 'private_bookings', 'manage_vendors'))
    WITH CHECK (user_has_permission(auth.uid(), 'private_bookings', 'manage_vendors'));

-- Event categories policies
CREATE POLICY "Event categories are viewable by authenticated users" ON public.event_categories
    FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE POLICY "Event categories are manageable by admins" ON public.event_categories
    USING (EXISTS (
        SELECT 1 FROM user_roles ur
        JOIN roles r ON ur.role_id = r.id
        WHERE ur.user_id = auth.uid() AND r.name IN ('super_admin', 'manager')
    ));

-- Customer category stats policies
CREATE POLICY "Customer category stats viewable by authenticated" ON public.customer_category_stats
    FOR SELECT USING (auth.uid() IS NOT NULL);

-- Reminder logs policies
CREATE POLICY "Users can view reminder logs" ON public.reminder_processing_logs
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Service role can manage reminder logs" ON public.reminder_processing_logs
    TO service_role USING (true);

-- Job queue policies
CREATE POLICY "Users can create jobs" ON public.job_queue
    FOR INSERT WITH CHECK (auth.uid() = created_by);

CREATE POLICY "Users can view own jobs" ON public.job_queue
    FOR SELECT USING (auth.uid() = created_by);

CREATE POLICY "Service role full access" ON public.job_queue
    USING ((auth.jwt() ->> 'role') = 'service_role');

-- Insert default data

-- Insert default roles
INSERT INTO public.roles (name, description) VALUES
    ('super_admin', 'Full system access'),
    ('manager', 'Management access'),
    ('staff', 'Staff access')
ON CONFLICT (name) DO NOTHING;

-- Insert permissions
INSERT INTO public.permissions (module_name, action, description) VALUES
    -- Events permissions
    ('events', 'view', 'View events'),
    ('events', 'create', 'Create events'),
    ('events', 'edit', 'Edit events'),
    ('events', 'delete', 'Delete events'),
    ('events', 'manage', 'Manage all event settings'),
    
    -- Customers permissions
    ('customers', 'view', 'View customers'),
    ('customers', 'create', 'Create customers'),
    ('customers', 'edit', 'Edit customers'),
    ('customers', 'delete', 'Delete customers'),
    ('customers', 'export', 'Export customer data'),
    
    -- Bookings permissions
    ('bookings', 'view', 'View bookings'),
    ('bookings', 'create', 'Create bookings'),
    ('bookings', 'edit', 'Edit bookings'),
    ('bookings', 'delete', 'Delete bookings'),
    
    -- Employees permissions
    ('employees', 'view', 'View employees'),
    ('employees', 'create', 'Create employees'),
    ('employees', 'edit', 'Edit employees'),
    ('employees', 'delete', 'Delete employees'),
    ('employees', 'view_sensitive', 'View sensitive employee data'),
    ('employees', 'manage_documents', 'Manage employee documents'),
    
    -- Messages permissions
    ('messages', 'view', 'View messages'),
    ('messages', 'send', 'Send messages'),
    ('messages', 'send_bulk', 'Send bulk messages'),
    ('messages', 'manage_templates', 'Manage message templates'),
    
    -- Settings permissions
    ('settings', 'view', 'View settings'),
    ('settings', 'edit', 'Edit settings'),
    ('settings', 'manage_integrations', 'Manage integrations'),
    
    -- Roles permissions
    ('roles', 'view', 'View roles'),
    ('roles', 'manage', 'Manage roles and permissions'),
    
    -- Users permissions
    ('users', 'view', 'View users'),
    ('users', 'create', 'Create users'),
    ('users', 'edit', 'Edit users'),
    ('users', 'delete', 'Delete users'),
    ('users', 'manage_roles', 'Manage user roles'),
    
    -- Audit logs permissions
    ('audit_logs', 'view', 'View audit logs'),
    ('audit_logs', 'export', 'Export audit logs'),
    
    -- Private bookings permissions
    ('private_bookings', 'view', 'View private bookings'),
    ('private_bookings', 'create', 'Create private bookings'),
    ('private_bookings', 'edit', 'Edit private bookings'),
    ('private_bookings', 'delete', 'Delete private bookings'),
    ('private_bookings', 'manage_spaces', 'Manage venue spaces'),
    ('private_bookings', 'manage_catering', 'Manage catering packages'),
    ('private_bookings', 'manage_vendors', 'Manage vendors'),
    ('private_bookings', 'generate_contracts', 'Generate contracts and documents'),
    ('private_bookings', 'view_financials', 'View financial details'),
    ('private_bookings', 'process_payments', 'Process payments'),
    ('private_bookings', 'view_sms_queue', 'View SMS queue'),
    ('private_bookings', 'approve_sms', 'Approve SMS messages')
ON CONFLICT (module_name, action) DO NOTHING;

-- Assign all permissions to super_admin role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'super_admin'
ON CONFLICT DO NOTHING;

-- Assign specific permissions to manager role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'manager'
  AND p.module_name IN ('events', 'customers', 'bookings', 'employees', 'messages', 'settings', 'private_bookings')
  AND p.action IN ('view', 'create', 'edit', 'delete', 'send', 'send_bulk', 'manage_templates', 'manage_spaces', 'manage_catering', 'manage_vendors', 'generate_contracts', 'view_financials', 'view_sms_queue')
ON CONFLICT DO NOTHING;

-- Assign limited permissions to staff role
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'staff'
  AND (
    (p.module_name IN ('events', 'customers', 'bookings', 'messages', 'private_bookings') AND p.action = 'view')
    OR (p.module_name = 'bookings' AND p.action IN ('create', 'edit'))
    OR (p.module_name = 'messages' AND p.action = 'send')
  )
ON CONFLICT DO NOTHING;

-- Insert default message templates
INSERT INTO public.message_templates (template_type, template_name, template_content, variables, is_default, send_timing) VALUES
    ('booking_confirmation', 'Default Booking Confirmation', 'Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} at {{event_time}} has been confirmed. We look forward to seeing you!', '["customer_name", "event_name", "event_date", "event_time"]'::jsonb, true, 'immediate'),
    ('booking_reminder_24_hour', '24 Hour Reminder', 'Hi {{customer_name}}, just a reminder that you''re booked for {{event_name}} tomorrow at {{event_time}}. See you soon!', '["customer_name", "event_name", "event_time"]'::jsonb, true, '24_hours'),
    ('booking_reminder_7_day', '7 Day Reminder', 'Hi {{customer_name}}, we''re looking forward to seeing you at {{event_name}} next week on {{event_date}} at {{event_time}}.', '["customer_name", "event_name", "event_date", "event_time"]'::jsonb, true, '7_days'),
    ('booking_cancellation', 'Booking Cancellation', 'Hi {{customer_name}}, your booking for {{event_name}} on {{event_date}} has been cancelled. If you have any questions, please get in touch.', '["customer_name", "event_name", "event_date"]'::jsonb, true, 'immediate'),
    ('event_update', 'Event Update', 'Hi {{customer_name}}, there''s been an update to {{event_name}} on {{event_date}}. {{update_message}}', '["customer_name", "event_name", "event_date", "update_message"]'::jsonb, true, 'immediate'),
    ('custom_message', 'Custom Message', '{{message}}', '["message"]'::jsonb, true, 'immediate')
ON CONFLICT DO NOTHING;

-- Insert default event category
INSERT INTO public.event_categories (name, description, color, icon, is_default) VALUES
    ('General', 'General events', '#6B7280', 'calendar', true)
ON CONFLICT (name) DO NOTHING;

-- Grant permissions
GRANT USAGE ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO postgres, anon, authenticated, service_role;

-- Comments
COMMENT ON TABLE public.customers IS 'Stores customer information including contact details and SMS preferences';
COMMENT ON TABLE public.events IS 'Stores event information including dates, times, and categories';
COMMENT ON TABLE public.bookings IS 'Stores booking information linking customers to events';
COMMENT ON TABLE public.employees IS 'Stores employee information including personal and employment details';
COMMENT ON TABLE public.messages IS 'Stores SMS messages sent and received through Twilio';
COMMENT ON TABLE public.message_templates IS 'Stores reusable message templates with variable substitution';
COMMENT ON TABLE public.private_bookings IS 'Stores private venue hire bookings with comprehensive details';
COMMENT ON TABLE public.audit_logs IS 'Immutable audit trail of all system activities';
COMMENT ON FUNCTION public.user_has_permission IS 'Checks if a user has a specific permission for a module action';
COMMENT ON FUNCTION public.calculate_send_time IS 'Calculates when a message should be sent based on event time and timing configuration';
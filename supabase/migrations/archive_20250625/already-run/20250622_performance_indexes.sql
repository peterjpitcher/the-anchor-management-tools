-- Performance optimization indexes for common query patterns

-- Bookings: Composite index for event-based queries with date filtering
CREATE INDEX IF NOT EXISTS idx_bookings_event_date 
ON public.bookings(event_id, created_at DESC);

-- Messages: Composite index for customer messages with direction and read status
CREATE INDEX IF NOT EXISTS idx_messages_customer_direction_read 
ON public.messages(customer_id, direction, read_at)
WHERE direction = 'inbound';

-- Messages: Index for unread inbound messages (common dashboard query)
CREATE INDEX IF NOT EXISTS idx_messages_unread_inbound 
ON public.messages(direction, read_at)
WHERE direction = 'inbound' AND read_at IS NULL;

-- Audit logs: Composite index for user-based queries with date filtering
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_date 
ON public.audit_logs(user_id, created_at DESC);

-- Customers: Index for phone number lookups (used in webhook processing)
CREATE INDEX IF NOT EXISTS idx_customers_mobile_number_normalized 
ON public.customers(mobile_number)
WHERE mobile_number IS NOT NULL;

-- Events: Index for upcoming events queries (without WHERE clause for immutability)
CREATE INDEX IF NOT EXISTS idx_events_date_upcoming 
ON public.events(date);

-- Bookings: Index for counting bookings per event
CREATE INDEX IF NOT EXISTS idx_bookings_event_id_count 
ON public.bookings(event_id)
INCLUDE (id);

-- Messages: Index for SMS health monitoring queries
CREATE INDEX IF NOT EXISTS idx_messages_customer_created 
ON public.messages(customer_id, created_at DESC)
WHERE direction = 'outbound';

-- Employee attachments: Index for employee-based queries (only if table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employee_attachments') THEN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_attachments' AND column_name = 'uploaded_at') THEN
      CREATE INDEX IF NOT EXISTS idx_employee_attachments_employee 
      ON public.employee_attachments(employee_id, uploaded_at DESC);
    ELSIF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'employee_attachments' AND column_name = 'created_at') THEN
      CREATE INDEX IF NOT EXISTS idx_employee_attachments_employee 
      ON public.employee_attachments(employee_id, created_at DESC);
    END IF;
  END IF;
END $$;

-- Private bookings: Index for status-based queries (if table exists)
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'private_bookings') THEN
    CREATE INDEX IF NOT EXISTS idx_private_bookings_status_date 
    ON public.private_bookings(status, event_date)
    WHERE status IN ('tentative', 'confirmed');
  END IF;
END $$;

-- Analyze tables to update statistics for query planner (only if they exist)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bookings') THEN
    ANALYZE public.bookings;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'messages') THEN
    ANALYZE public.messages;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'customers') THEN
    ANALYZE public.customers;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'events') THEN
    ANALYZE public.events;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'audit_logs') THEN
    ANALYZE public.audit_logs;
  END IF;
END $$;

-- Create a function to get dashboard stats (only if all required tables exist)
DO $$
BEGIN
  -- Check if all required tables exist before creating the function
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'customers') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'events') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'bookings') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'messages') AND
     EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'employees') THEN
    
    CREATE OR REPLACE FUNCTION get_dashboard_stats()
    RETURNS TABLE (
      total_customers bigint,
      new_customers_week bigint,
      upcoming_events bigint,
      recent_bookings bigint,
      unread_messages bigint,
      active_employees bigint
    ) AS $func$
    BEGIN
      RETURN QUERY
      SELECT 
        (SELECT COUNT(*) FROM customers)::bigint,
        (SELECT COUNT(*) FROM customers WHERE created_at >= CURRENT_DATE - INTERVAL '7 days')::bigint,
        (SELECT COUNT(*) FROM events WHERE date >= CURRENT_DATE)::bigint,
        (SELECT COUNT(*) FROM bookings WHERE created_at >= CURRENT_DATE - INTERVAL '30 days')::bigint,
        (SELECT COUNT(*) FROM messages WHERE direction = 'inbound' AND read_at IS NULL)::bigint,
        (SELECT COUNT(*) FROM employees WHERE is_active = true)::bigint;
    END;
    $func$ LANGUAGE plpgsql STABLE;
  END IF;
END $$;

-- Create an index on the date column to speed up date comparisons
CREATE INDEX IF NOT EXISTS idx_customers_created_recent 
ON public.customers(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bookings_created_recent 
ON public.bookings(created_at DESC);
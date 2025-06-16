-- Add enhanced messaging status tracking for automatic deactivation

-- Add messaging_status field to customers table
ALTER TABLE customers 
ADD COLUMN IF NOT EXISTS messaging_status TEXT DEFAULT 'active' 
CHECK (messaging_status IN ('active', 'suspended', 'invalid_number', 'opted_out'));

-- Add delivery tracking fields
ALTER TABLE customers
ADD COLUMN IF NOT EXISTS last_successful_delivery TIMESTAMP WITH TIME ZONE,
ADD COLUMN IF NOT EXISTS consecutive_failures INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS total_failures_30d INTEGER DEFAULT 0,
ADD COLUMN IF NOT EXISTS last_failure_type TEXT;

-- Create index for efficient queries
CREATE INDEX IF NOT EXISTS idx_customers_messaging_status ON customers(messaging_status);
CREATE INDEX IF NOT EXISTS idx_customers_consecutive_failures ON customers(consecutive_failures);

-- Add message cost tracking
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS segments INTEGER DEFAULT 1,
ADD COLUMN IF NOT EXISTS cost_usd DECIMAL(10, 4);

-- Create a view for customer messaging health
CREATE OR REPLACE VIEW customer_messaging_health AS
SELECT 
  c.id,
  c.first_name,
  c.last_name,
  c.mobile_number,
  c.messaging_status,
  c.sms_opt_in,
  c.consecutive_failures,
  c.total_failures_30d,
  c.last_successful_delivery,
  c.last_failure_type,
  COUNT(DISTINCT m.id) as total_messages_sent,
  COUNT(DISTINCT CASE WHEN m.twilio_status = 'delivered' THEN m.id END) as messages_delivered,
  COUNT(DISTINCT CASE WHEN m.twilio_status IN ('failed', 'undelivered') THEN m.id END) as messages_failed,
  CASE 
    WHEN COUNT(DISTINCT m.id) > 0 
    THEN ROUND(COUNT(DISTINCT CASE WHEN m.twilio_status = 'delivered' THEN m.id END)::NUMERIC / COUNT(DISTINCT m.id) * 100, 2)
    ELSE 0 
  END as delivery_rate,
  SUM(COALESCE(m.cost_usd, 0)) as total_cost_usd,
  MAX(m.created_at) as last_message_date
FROM customers c
LEFT JOIN messages m ON c.id = m.customer_id AND m.direction = 'outbound'
GROUP BY c.id, c.first_name, c.last_name, c.mobile_number, c.messaging_status, 
         c.sms_opt_in, c.consecutive_failures, c.total_failures_30d, 
         c.last_successful_delivery, c.last_failure_type;

-- Function to calculate message cost (based on segments)
CREATE OR REPLACE FUNCTION calculate_message_cost(segments INTEGER)
RETURNS DECIMAL(10, 4) AS $$
BEGIN
  -- Twilio SMS pricing for UK (approximate)
  -- $0.04 per segment
  RETURN segments * 0.04;
END;
$$ LANGUAGE plpgsql;

-- Function to update customer messaging health after status update
CREATE OR REPLACE FUNCTION update_customer_messaging_health()
RETURNS TRIGGER AS $$
DECLARE
  v_customer_id UUID;
  v_previous_status TEXT;
  v_new_status TEXT;
  v_failure_count_30d INTEGER;
BEGIN
  -- Get customer ID from the message
  SELECT customer_id INTO v_customer_id FROM messages WHERE id = NEW.message_id;
  
  IF v_customer_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Get previous status
  v_previous_status := OLD.status;
  v_new_status := NEW.status;

  -- Update based on status change
  IF v_new_status = 'delivered' THEN
    -- Reset consecutive failures on successful delivery
    UPDATE customers 
    SET 
      consecutive_failures = 0,
      last_successful_delivery = NOW()
    WHERE id = v_customer_id;
    
  ELSIF v_new_status IN ('failed', 'undelivered') THEN
    -- Increment failure counts
    UPDATE customers 
    SET 
      consecutive_failures = consecutive_failures + 1,
      last_failure_type = COALESCE(NEW.error_message, 'Unknown error')
    WHERE id = v_customer_id;
    
    -- Count failures in last 30 days
    SELECT COUNT(*) INTO v_failure_count_30d
    FROM messages m
    JOIN message_delivery_status mds ON m.id = mds.message_id
    WHERE m.customer_id = v_customer_id
      AND mds.status IN ('failed', 'undelivered')
      AND mds.created_at >= NOW() - INTERVAL '30 days';
    
    UPDATE customers 
    SET total_failures_30d = v_failure_count_30d
    WHERE id = v_customer_id;
    
    -- Apply automatic deactivation rules
    UPDATE customers 
    SET 
      messaging_status = CASE
        -- Invalid number: immediate suspension
        WHEN NEW.error_code IN ('21211', '21217', '21219', '21408', '21610', '21611', '21612', '21614') THEN 'invalid_number'
        -- Carrier violations after 3 strikes
        WHEN consecutive_failures >= 3 AND NEW.error_code IN ('30003', '30004', '30005', '30006', '30007', '30008') THEN 'suspended'
        -- General failures after 5 consecutive attempts
        WHEN consecutive_failures >= 5 THEN 'suspended'
        -- High failure rate in 30 days
        WHEN total_failures_30d >= 10 THEN 'suspended'
        ELSE messaging_status
      END,
      sms_opt_in = CASE
        WHEN messaging_status != 'active' THEN false
        ELSE sms_opt_in
      END
    WHERE id = v_customer_id
      AND messaging_status = 'active'; -- Only auto-deactivate active customers
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for automatic health updates
DROP TRIGGER IF EXISTS update_customer_health_on_delivery_status ON message_delivery_status;
CREATE TRIGGER update_customer_health_on_delivery_status
AFTER INSERT OR UPDATE ON message_delivery_status
FOR EACH ROW
EXECUTE FUNCTION update_customer_messaging_health();

-- Add comments
COMMENT ON COLUMN customers.messaging_status IS 'Current messaging status: active, suspended, invalid_number, opted_out';
COMMENT ON COLUMN customers.consecutive_failures IS 'Number of consecutive delivery failures';
COMMENT ON COLUMN customers.total_failures_30d IS 'Total delivery failures in the last 30 days';
COMMENT ON COLUMN customers.last_failure_type IS 'Description of the last delivery failure';
COMMENT ON VIEW customer_messaging_health IS 'Comprehensive view of customer messaging health and statistics';
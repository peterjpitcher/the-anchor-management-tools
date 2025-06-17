-- Fix RLS policy for message_template_history table
-- The current policy only allows SELECT but the trigger needs INSERT permission

-- Drop existing policies
DROP POLICY IF EXISTS "Users can view template history" ON message_template_history;

-- Create new policies that allow the trigger to insert history records
CREATE POLICY "Enable insert for authenticated users via trigger" ON message_template_history
  FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "Users can view template history" ON message_template_history
  FOR SELECT TO authenticated
  USING (true);

-- Also ensure the trigger function runs with appropriate permissions
-- Recreate the trigger function with SECURITY DEFINER
CREATE OR REPLACE FUNCTION log_template_changes()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Only log if there are actual changes
    IF OLD IS DISTINCT FROM NEW THEN
      INSERT INTO message_template_history (
        template_id,
        operation,
        changed_by,
        old_data,
        new_data
      ) VALUES (
        NEW.id,
        TG_OP,
        auth.uid(),
        to_jsonb(OLD),
        to_jsonb(NEW)
      );
    END IF;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO message_template_history (
      template_id,
      operation,
      changed_by,
      old_data,
      new_data
    ) VALUES (
      OLD.id,
      TG_OP,
      auth.uid(),
      to_jsonb(OLD),
      NULL
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Recreate the trigger to ensure it uses the updated function
DROP TRIGGER IF EXISTS message_template_audit ON message_templates;
CREATE TRIGGER message_template_audit
  AFTER UPDATE OR DELETE ON message_templates
  FOR EACH ROW
  EXECUTE FUNCTION log_template_changes();

-- Grant necessary permissions
GRANT INSERT, SELECT ON message_template_history TO authenticated;
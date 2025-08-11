-- Fix the auto_generate_weekly_slots function to use correct audit_logs columns

CREATE OR REPLACE FUNCTION auto_generate_weekly_slots()
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
  v_result JSONB;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_from_config(CURRENT_DATE, 90);
  
  -- Log the result (using correct column names)
  INSERT INTO audit_logs (
    resource_type,
    resource_id,
    operation_type,
    operation_status,
    additional_info
  ) VALUES (
    'service_slots',
    NULL,
    'auto_generate',
    'success',
    jsonb_build_object(
      'slots_created', v_slots_created,
      'run_date', CURRENT_DATE,
      'period_days', 90
    )
  );
  
  v_result := jsonb_build_object(
    'success', true,
    'slots_created', v_slots_created,
    'message', format('Generated %s service slots for the next 90 days', v_slots_created)
  );
  
  RETURN v_result;
EXCEPTION
  WHEN OTHERS THEN
    -- Return error without failing
    RETURN jsonb_build_object(
      'success', false,
      'error', SQLERRM,
      'message', 'Failed to generate slots'
    );
END;
$$;

-- Also create a simpler version without audit logging
CREATE OR REPLACE FUNCTION generate_slots_simple()
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_slots_created INTEGER;
BEGIN
  -- Generate slots for the next 90 days
  v_slots_created := generate_service_slots_from_config(CURRENT_DATE, 90);
  
  RETURN format('Generated %s service slots', v_slots_created);
END;
$$;
-- Function to atomically update menu target GP and propagate to dishes
CREATE OR REPLACE FUNCTION update_menu_target_gp_transaction(
  p_new_target_gp NUMERIC,
  p_user_id UUID DEFAULT NULL,
  p_user_email TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_setting_key TEXT := 'menu_target_gp_pct';
  v_old_setting_value JSONB;
  v_new_setting_value JSONB;
  v_log_id UUID;
BEGIN
  -- 1. Upsert (Update or Insert) the system setting
  INSERT INTO system_settings (key, value, description)
  VALUES (v_setting_key, jsonb_build_object('target_gp_pct', p_new_target_gp), 'Standard gross profit target applied to all dishes.')
  ON CONFLICT (key) DO UPDATE SET
    value = EXCLUDED.value,
    description = EXCLUDED.description,
    updated_at = NOW()
  RETURNING value INTO v_old_setting_value; -- Retrieve old value if it was an update

  v_new_setting_value := jsonb_build_object('target_gp_pct', p_new_target_gp);

  -- 2. Propagate the new target to all active menu_dishes
  UPDATE menu_dishes
  SET target_gp_pct = p_new_target_gp,
      updated_at = NOW()
  WHERE is_active = TRUE;

  -- 3. Log audit event (similar to log_audit_event in JS, but simpler here)
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    old_values,
    new_values,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    'update',
    'system_setting',
    v_setting_key,
    'success',
    v_old_setting_value,
    v_new_setting_value,
    jsonb_build_object('setting_name', 'Menu Target GP', 'propagated_to_dishes', TRUE)
  )
  RETURNING id INTO v_log_id;

  -- 4. Return success status and the new target
  RETURN jsonb_build_object('success', TRUE, 'new_target_gp', p_new_target_gp);

EXCEPTION WHEN OTHERS THEN
  -- Log the error to audit_logs as a failure
  INSERT INTO audit_logs (
    user_id,
    user_email,
    operation_type,
    resource_type,
    resource_id,
    operation_status,
    error_message,
    additional_info
  ) VALUES (
    p_user_id,
    p_user_email,
    'update',
    'system_setting',
    v_setting_key,
    'failure',
    SQLERRM,
    jsonb_build_object('setting_name', 'Menu Target GP', 'propagated_to_dishes', TRUE)
  );
  RAISE;
END;
$$;

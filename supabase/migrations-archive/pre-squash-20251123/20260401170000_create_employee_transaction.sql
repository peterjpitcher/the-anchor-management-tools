-- Function to handle atomic creation of employee with details
CREATE OR REPLACE FUNCTION create_employee_transaction(
  p_employee_data JSONB,
  p_financial_data JSONB DEFAULT NULL,
  p_health_data JSONB DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id UUID;
  v_employee_record JSONB;
BEGIN
  -- 1. Insert Employee
  INSERT INTO employees (
    first_name,
    last_name,
    email_address,
    job_title,
    employment_start_date,
    status,
    date_of_birth,
    address,
    phone_number,
    employment_end_date
  ) VALUES (
    p_employee_data->>'first_name',
    p_employee_data->>'last_name',
    p_employee_data->>'email_address',
    p_employee_data->>'job_title',
    (p_employee_data->>'employment_start_date')::DATE,
    p_employee_data->>'status',
    (p_employee_data->>'date_of_birth')::DATE,
    p_employee_data->>'address',
    p_employee_data->>'phone_number',
    (p_employee_data->>'employment_end_date')::DATE
  )
  RETURNING employee_id INTO v_employee_id;

  -- 2. Insert Financial Details (if provided)
  IF p_financial_data IS NOT NULL THEN
    INSERT INTO employee_financial_details (
      employee_id,
      ni_number,
      bank_account_number,
      bank_sort_code,
      bank_name,
      payee_name,
      branch_address
    ) VALUES (
      v_employee_id,
      p_financial_data->>'ni_number',
      p_financial_data->>'bank_account_number',
      p_financial_data->>'bank_sort_code',
      p_financial_data->>'bank_name',
      p_financial_data->>'payee_name',
      p_financial_data->>'branch_address'
    );
  END IF;

  -- 3. Insert Health Records (if provided)
  IF p_health_data IS NOT NULL THEN
    INSERT INTO employee_health_records (
      employee_id,
      doctor_name,
      doctor_address,
      allergies,
      illness_history,
      recent_treatment,
      has_diabetes,
      has_epilepsy,
      has_skin_condition,
      has_depressive_illness,
      has_bowel_problems,
      has_ear_problems,
      is_registered_disabled,
      disability_reg_number,
      disability_reg_expiry_date,
      disability_details
    ) VALUES (
      v_employee_id,
      p_health_data->>'doctor_name',
      p_health_data->>'doctor_address',
      p_health_data->>'allergies',
      p_health_data->>'illness_history',
      p_health_data->>'recent_treatment',
      COALESCE((p_health_data->>'has_diabetes')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_epilepsy')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_skin_condition')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_depressive_illness')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_bowel_problems')::BOOLEAN, false),
      COALESCE((p_health_data->>'has_ear_problems')::BOOLEAN, false),
      COALESCE((p_health_data->>'is_registered_disabled')::BOOLEAN, false),
      p_health_data->>'disability_reg_number',
      (p_health_data->>'disability_reg_expiry_date')::DATE,
      p_health_data->>'disability_details'
    );
  END IF;

  -- 4. Return the created employee record
  SELECT to_jsonb(e) INTO v_employee_record
  FROM employees e
  WHERE e.employee_id = v_employee_id;

  RETURN v_employee_record;

EXCEPTION WHEN OTHERS THEN
  RAISE;
END;
$$;

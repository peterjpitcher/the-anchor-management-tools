-- Employee onboarding improvements
-- - Adds missing columns used by the onboarding UI
-- - Updates create_employee_transaction to persist new fields

-- Employees: additional contact + onboarding fields
ALTER TABLE IF EXISTS public.employees
  ADD COLUMN IF NOT EXISTS post_code text,
  ADD COLUMN IF NOT EXISTS mobile_number text,
  ADD COLUMN IF NOT EXISTS first_shift_date date,
  ADD COLUMN IF NOT EXISTS uniform_preference text,
  ADD COLUMN IF NOT EXISTS keyholder_status boolean DEFAULT false;

-- Health records: align with onboarding questionnaire
ALTER TABLE IF EXISTS public.employee_health_records
  ADD COLUMN IF NOT EXISTS has_allergies boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS had_absence_over_2_weeks_last_3_years boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS had_outpatient_treatment_over_3_months_last_3_years boolean DEFAULT false NOT NULL,
  ADD COLUMN IF NOT EXISTS absence_or_treatment_details text;

-- Emergency contacts: match onboarding form fields
ALTER TABLE IF EXISTS public.employee_emergency_contacts
  ADD COLUMN IF NOT EXISTS priority text,
  ADD COLUMN IF NOT EXISTS mobile_number text;

-- Right to work: capture verification method + reference numbers/share codes
ALTER TABLE IF EXISTS public.employee_right_to_work
  ADD COLUMN IF NOT EXISTS check_method text,
  ADD COLUMN IF NOT EXISTS document_reference text;

-- Atomic create: persist new employee + health fields (financial unchanged)
CREATE OR REPLACE FUNCTION public.create_employee_transaction(
  p_employee_data jsonb,
  p_financial_data jsonb DEFAULT NULL,
  p_health_data jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_employee_id uuid;
  v_employee_record jsonb;
BEGIN
  -- 1. Insert Employee
  INSERT INTO public.employees (
    first_name,
    last_name,
    email_address,
    job_title,
    employment_start_date,
    status,
    date_of_birth,
    address,
    post_code,
    phone_number,
    mobile_number,
    first_shift_date,
    uniform_preference,
    keyholder_status,
    employment_end_date
  ) VALUES (
    p_employee_data->>'first_name',
    p_employee_data->>'last_name',
    p_employee_data->>'email_address',
    p_employee_data->>'job_title',
    (p_employee_data->>'employment_start_date')::date,
    p_employee_data->>'status',
    (p_employee_data->>'date_of_birth')::date,
    p_employee_data->>'address',
    p_employee_data->>'post_code',
    p_employee_data->>'phone_number',
    p_employee_data->>'mobile_number',
    (p_employee_data->>'first_shift_date')::date,
    p_employee_data->>'uniform_preference',
    COALESCE((p_employee_data->>'keyholder_status')::boolean, false),
    (p_employee_data->>'employment_end_date')::date
  )
  RETURNING employee_id INTO v_employee_id;

  -- 2. Insert Financial Details (if provided)
  IF p_financial_data IS NOT NULL THEN
    INSERT INTO public.employee_financial_details (
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
    INSERT INTO public.employee_health_records (
      employee_id,
      doctor_name,
      doctor_address,
      allergies,
      has_allergies,
      had_absence_over_2_weeks_last_3_years,
      had_outpatient_treatment_over_3_months_last_3_years,
      absence_or_treatment_details,
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
      COALESCE((p_health_data->>'has_allergies')::boolean, false),
      COALESCE((p_health_data->>'had_absence_over_2_weeks_last_3_years')::boolean, false),
      COALESCE((p_health_data->>'had_outpatient_treatment_over_3_months_last_3_years')::boolean, false),
      p_health_data->>'absence_or_treatment_details',
      p_health_data->>'illness_history',
      p_health_data->>'recent_treatment',
      COALESCE((p_health_data->>'has_diabetes')::boolean, false),
      COALESCE((p_health_data->>'has_epilepsy')::boolean, false),
      COALESCE((p_health_data->>'has_skin_condition')::boolean, false),
      COALESCE((p_health_data->>'has_depressive_illness')::boolean, false),
      COALESCE((p_health_data->>'has_bowel_problems')::boolean, false),
      COALESCE((p_health_data->>'has_ear_problems')::boolean, false),
      COALESCE((p_health_data->>'is_registered_disabled')::boolean, false),
      p_health_data->>'disability_reg_number',
      (p_health_data->>'disability_reg_expiry_date')::date,
      p_health_data->>'disability_details'
    );
  END IF;

  -- 4. Return the created employee record
  SELECT to_jsonb(e) INTO v_employee_record
  FROM public.employees e
  WHERE e.employee_id = v_employee_id;

  RETURN v_employee_record;
END;
$$;


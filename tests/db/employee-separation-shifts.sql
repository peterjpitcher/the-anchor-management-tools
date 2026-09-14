\set ON_ERROR_STOP on

CREATE OR REPLACE FUNCTION fixture_assert(condition boolean, label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF condition IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL %', label;
  END IF;
  RAISE NOTICE 'PASS %', label;
END;
$$;

INSERT INTO auth.users(id) VALUES
  ('00000000-0000-0000-0000-000000000099');

INSERT INTO public.employees (
  employee_id, email_address, first_name, last_name, employment_start_date, status
) VALUES
  ('00000000-0000-0000-0000-000000000001', 'worker@example.invalid', 'Alex', 'Worker', '2026-09-01', 'Active'),
  ('00000000-0000-0000-0000-000000000002', 'released@example.invalid', 'Rae', 'Lease', '2026-09-01', 'Active'),
  ('00000000-0000-0000-0000-000000000003', 'invalid@example.invalid', 'Invalid', 'Date', '2026-09-16', 'Active');

INSERT INTO public.rota_weeks(id, week_start, status) VALUES
  ('10000000-0000-0000-0000-000000000001', '2026-09-14', 'published'),
  ('10000000-0000-0000-0000-000000000002', '2026-09-21', 'draft');

INSERT INTO public.rota_shift_templates (
  id, name, start_time, end_time, department, employee_id
) VALUES
  ('20000000-0000-0000-0000-000000000001', 'Recurring', '12:00', '17:00', 'bar', '00000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', 'Released recurring', '12:00', '17:00', 'bar', '00000000-0000-0000-0000-000000000002');

INSERT INTO public.rota_shifts (
  id, week_id, employee_id, shift_date, start_time, end_time, department, status,
  is_open_shift, acceptance_status, name
) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-09-14', '09:00', '11:00', 'bar', 'scheduled', false, 'accepted', 'Already started'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-09-14', '15:00', '18:00', 'bar', 'scheduled', false, 'accepted', 'Later today'),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-09-16', '12:00', '17:00', 'bar', 'scheduled', false, 'auto_accepted', 'Last day'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000001', '2026-09-17', '12:00', '17:00', 'bar', 'scheduled', false, 'pending', 'After last day'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', '2026-09-22', '12:00', '17:00', 'training', 'scheduled', false, 'pending', 'Draft after last day'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '2026-09-14', '09:00', '11:00', 'bar', 'scheduled', false, 'accepted', 'Released already started'),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '2026-09-14', '15:00', '18:00', 'bar', 'scheduled', false, 'accepted', 'Released later today'),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000002', '2026-09-18', '12:00', '17:00', 'bar', 'scheduled', false, 'pending', 'Released future');

INSERT INTO public.rota_published_shifts (
  id, week_id, employee_id, shift_date, start_time, end_time, department, status,
  is_open_shift, acceptance_status, name
)
SELECT id, week_id, employee_id, shift_date, start_time, end_time, department, status,
       is_open_shift, acceptance_status, name
FROM public.rota_shifts
WHERE week_id = '10000000-0000-0000-0000-000000000001';

CREATE TEMP TABLE work_result AS
SELECT public.begin_employee_separation(
  '00000000-0000-0000-0000-000000000001',
  '2026-09-16',
  'work_remaining',
  '00000000-0000-0000-0000-000000000099',
  '2026-09-14 11:00:00+00'
) AS value;

SELECT fixture_assert((value->>'state') = 'started', 'work remaining starts separation') FROM work_result;
SELECT fixture_assert(jsonb_array_length(value->'retained_shifts') = 2, 'work remaining retains later today and last day') FROM work_result;
SELECT fixture_assert(jsonb_array_length(value->'released_shifts') = 2, 'work remaining releases published and draft shifts after last day') FROM work_result;
SELECT fixture_assert(
  (SELECT status = 'Started Separation'
          AND separation_shift_policy = 'work_remaining'
          AND separation_started_at = '2026-09-14 11:00:00+00'
   FROM public.employees WHERE employee_id = '00000000-0000-0000-0000-000000000001'),
  'employee stores the separation decision'
);
SELECT fixture_assert(
  (SELECT employee_id IS NULL FROM public.rota_shift_templates WHERE id = '20000000-0000-0000-0000-000000000001'),
  'work remaining clears recurring template assignment'
);
SELECT fixture_assert(
  (SELECT employee_id = '00000000-0000-0000-0000-000000000001' AND NOT is_open_shift
   FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000001'),
  'already-started shift remains assigned'
);
SELECT fixture_assert(
  (SELECT employee_id IS NULL AND is_open_shift AND acceptance_status IS NULL
   FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000004'),
  'published shift after last day becomes open in live rota'
);
SELECT fixture_assert(
  (SELECT employee_id IS NULL AND is_open_shift AND acceptance_status IS NULL
   FROM public.rota_published_shifts WHERE id = '30000000-0000-0000-0000-000000000004'),
  'published shift after last day becomes open in staff snapshot'
);
SELECT fixture_assert(
  NOT EXISTS (SELECT 1 FROM public.rota_published_shifts WHERE id = '30000000-0000-0000-0000-000000000005'),
  'draft shift is not invented in published snapshot'
);
SELECT fixture_assert(
  (SELECT count(*) = 1 FROM public.rota_shift_calendar_cancellations WHERE employee_id = '00000000-0000-0000-0000-000000000001'),
  'only the released published shift records a calendar cancellation'
);

CREATE TEMP TABLE release_result AS
SELECT public.begin_employee_separation(
  '00000000-0000-0000-0000-000000000002',
  '2026-09-20',
  'release_remaining',
  '00000000-0000-0000-0000-000000000099',
  '2026-09-14 11:00:00+00'
) AS value;

SELECT fixture_assert(jsonb_array_length(value->'retained_shifts') = 0, 'immediate release retains no future shift') FROM release_result;
SELECT fixture_assert(jsonb_array_length(value->'released_shifts') = 2, 'immediate release includes later today and future shifts') FROM release_result;
SELECT fixture_assert(
  (SELECT employee_id = '00000000-0000-0000-0000-000000000002' AND NOT is_open_shift
   FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000006'),
  'immediate release leaves an already-started shift intact'
);
SELECT fixture_assert(
  (SELECT count(*) = 2 FROM public.rota_shift_calendar_cancellations WHERE employee_id = '00000000-0000-0000-0000-000000000002'),
  'immediate release records both published calendar cancellations'
);

DO $$
BEGIN
  BEGIN
    UPDATE public.rota_shifts
    SET employee_id = '00000000-0000-0000-0000-000000000002',
        is_open_shift = false
    WHERE id = '30000000-0000-0000-0000-000000000007';
    RAISE EXCEPTION 'FAIL released employee was assigned a new shift';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'Employee has been released from remaining shifts and cannot be assigned.' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS released employee cannot be assigned a new shift';
  END;

  BEGIN
    UPDATE public.rota_shift_templates
    SET employee_id = '00000000-0000-0000-0000-000000000002'
    WHERE id = '20000000-0000-0000-0000-000000000002';
    RAISE EXCEPTION 'FAIL released employee was assigned a recurring template';
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'Employee has been released from remaining shifts and cannot be assigned.' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS released employee cannot be assigned a recurring template';
  END;
END;
$$;

CREATE TEMP TABLE invalid_result AS
SELECT public.begin_employee_separation(
  '00000000-0000-0000-0000-000000000003',
  '2026-09-14',
  'release_remaining',
  '00000000-0000-0000-0000-000000000099',
  '2026-09-14 11:00:00+00'
) AS value;

SELECT fixture_assert((value->>'state') = 'invalid_end_date', 'end date on or before start date is refused') FROM invalid_result;
SELECT fixture_assert(
  (SELECT status = 'Active' AND separation_shift_policy IS NULL
   FROM public.employees WHERE employee_id = '00000000-0000-0000-0000-000000000003'),
  'invalid date leaves employee unchanged'
);

SELECT fixture_assert(
  NOT has_function_privilege('anon', 'public.begin_employee_separation(uuid,date,text,uuid,timestamptz)', 'EXECUTE'),
  'anon cannot begin a separation'
);
SELECT fixture_assert(
  NOT has_function_privilege('authenticated', 'public.begin_employee_separation(uuid,date,text,uuid,timestamptz)', 'EXECUTE'),
  'authenticated cannot call the transaction directly'
);
SELECT fixture_assert(
  has_function_privilege('service_role', 'public.begin_employee_separation(uuid,date,text,uuid,timestamptz)', 'EXECUTE'),
  'service role can begin a separation'
);

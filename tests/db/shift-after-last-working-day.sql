\set ON_ERROR_STOP on

-- guard_shift_after_last_working_day: nobody on notice or Former is given a shift after their last
-- working day, whatever their separation policy. Edits to rows already on the rota still save.

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

-- Refused with the guard's own message, or the test fails.
CREATE OR REPLACE FUNCTION fixture_expect_refusal(statement text, label text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION
    WHEN check_violation THEN
      IF SQLERRM <> 'This shift is after the employee''s last working day, so they cannot be given it.' THEN
        RAISE;
      END IF;
      RAISE NOTICE 'PASS %', label;
      RETURN;
  END;
  RAISE EXCEPTION 'FAIL % (it was allowed)', label;
END;
$$;

INSERT INTO public.employees (
  employee_id, email_address, first_name, last_name, employment_start_date, employment_end_date,
  status, separation_shift_policy, separation_started_at
) VALUES
  -- Working their notice: the old guard let them be assigned anything.
  ('00000000-0000-0000-0000-000000000011', 'notice@example.invalid', 'Nia', 'Notice', '2026-01-01', '2026-10-28', 'Started Separation', 'work_remaining', '2026-10-01 09:00:00+00'),
  ('00000000-0000-0000-0000-000000000012', 'former@example.invalid', 'Fen', 'Former', '2026-01-01', '2026-10-20', 'Former', NULL, NULL),
  ('00000000-0000-0000-0000-000000000013', 'current@example.invalid', 'Cal', 'Current', '2026-01-01', NULL, 'Active', NULL, NULL),
  -- On notice with no last working day recorded: nothing to compare with, so never refused.
  ('00000000-0000-0000-0000-000000000014', 'nodate@example.invalid', 'Noa', 'Date', '2026-01-01', NULL, 'Started Separation', 'work_remaining', '2026-10-01 09:00:00+00');

INSERT INTO public.rota_weeks(id, week_start, status) VALUES
  ('10000000-0000-0000-0000-000000000011', '2026-10-26', 'published');

INSERT INTO public.rota_shifts (
  id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name
) VALUES
  ('30000000-0000-0000-0000-000000000011', '10000000-0000-0000-0000-000000000011', NULL, '2026-10-30', '12:00', '17:00', 'bar', 'scheduled', true, 'Open after notice'),
  ('30000000-0000-0000-0000-000000000012', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '2026-10-27', '12:00', '17:00', 'bar', 'scheduled', false, 'Before last day'),
  ('30000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013', '2026-10-30', '12:00', '17:00', 'bar', 'scheduled', false, 'Current staff');

-- A sick day recorded after a Former person's last day before the guard existed (seven exist live).
ALTER TABLE public.rota_shifts DISABLE TRIGGER guard_shift_after_last_working_day;
INSERT INTO public.rota_shifts (
  id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name
) VALUES
  ('30000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '2026-10-29', '12:00', '17:00', 'bar', 'sick', false, 'Historic sick day');
ALTER TABLE public.rota_shifts ENABLE TRIGGER guard_shift_after_last_working_day;

SELECT fixture_expect_refusal($$
  INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
  VALUES ('30000000-0000-0000-0000-000000000021', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '2026-10-29', '12:00', '17:00', 'bar', 'scheduled', false, 'New after last day')
$$, 'someone working their notice cannot be put on a new shift the day after their last working day');

SELECT fixture_expect_refusal($$
  UPDATE public.rota_shifts
  SET employee_id = '00000000-0000-0000-0000-000000000011', is_open_shift = false
  WHERE id = '30000000-0000-0000-0000-000000000011'
$$, 'someone working their notice cannot take an open shift after their last working day');

SELECT fixture_expect_refusal($$
  UPDATE public.rota_shifts SET shift_date = '2026-10-29' WHERE id = '30000000-0000-0000-0000-000000000012'
$$, 'their shift cannot be moved to after their last working day');

SELECT fixture_expect_refusal($$
  INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
  VALUES ('30000000-0000-0000-0000-000000000022', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '2026-10-30', '12:00', '17:00', 'bar', 'sick', false, 'Former sick')
$$, 'someone already Former cannot be given a shift after their last working day, sick or not');

INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
VALUES ('30000000-0000-0000-0000-000000000023', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '2026-10-28', '12:00', '17:00', 'bar', 'scheduled', false, 'On last day');
SELECT fixture_assert(true, 'their last working day itself is still fine');

INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
VALUES ('30000000-0000-0000-0000-000000000024', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '2026-10-30', '12:00', '17:00', 'bar', 'cancelled', false, 'Cancelled after last day');
SELECT fixture_assert(true, 'a cancelled shift after their last working day is not refused');

INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
VALUES ('30000000-0000-0000-0000-000000000025', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000014', '2026-11-30', '12:00', '17:00', 'bar', 'scheduled', false, 'No last day recorded');
SELECT fixture_assert(true, 'someone on notice with no last working day recorded is not refused');

UPDATE public.rota_shifts SET shift_date = '2026-10-31' WHERE id = '30000000-0000-0000-0000-000000000013';
SELECT fixture_assert(true, 'current staff are never refused');

-- Rows already on the rota still save when only their hours, notes or status change, even when the
-- write names the same employee and date again (PostgREST sends every column it is given).
UPDATE public.rota_shifts
SET notes = 'Back pay checked', status = 'sick', employee_id = employee_id, shift_date = shift_date
WHERE id = '30000000-0000-0000-0000-000000000014';
SELECT fixture_assert(
  (SELECT notes = 'Back pay checked' FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000014'),
  'an edit to a historic row dated after a last working day still saves'
);

UPDATE public.rota_shifts SET employee_id = NULL, is_open_shift = true WHERE id = '30000000-0000-0000-0000-000000000012';
SELECT fixture_assert(true, 'a shift can still be taken off someone on notice');

-- The rota's snapshot restore upserts a whole published week. INSERT ... ON CONFLICT runs the guard
-- as an INSERT before the conflict is resolved, so a row already on the rota that keeps its employee
-- and date must count as an edit, or one historic row refuses the whole batch.
INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
VALUES
  ('30000000-0000-0000-0000-000000000014', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '2026-10-29', '12:00', '17:00', 'bar', 'sick', false, 'Historic sick day restored'),
  ('30000000-0000-0000-0000-000000000026', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000013', '2026-10-30', '18:00', '22:00', 'bar', 'scheduled', false, 'Restored current staff')
ON CONFLICT (id) DO UPDATE SET
  week_id = EXCLUDED.week_id, employee_id = EXCLUDED.employee_id, shift_date = EXCLUDED.shift_date,
  start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, department = EXCLUDED.department,
  status = EXCLUDED.status, is_open_shift = EXCLUDED.is_open_shift, name = EXCLUDED.name;
SELECT fixture_assert(
  (SELECT name = 'Historic sick day restored' FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000014')
  AND EXISTS (SELECT 1 FROM public.rota_shifts WHERE id = '30000000-0000-0000-0000-000000000026'),
  'restoring a published week saves, even with a row already on the rota after a last working day'
);

SELECT fixture_expect_refusal($$
  INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
  VALUES ('30000000-0000-0000-0000-000000000013', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000011', '2026-10-31', '12:00', '17:00', 'bar', 'scheduled', false, 'Current staff')
  ON CONFLICT (id) DO UPDATE SET employee_id = EXCLUDED.employee_id, shift_date = EXCLUDED.shift_date
$$, 'an upsert cannot hand an existing shift to someone after their last working day');

SELECT fixture_expect_refusal($$
  INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
  VALUES ('30000000-0000-0000-0000-000000000027', '10000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000012', '2026-10-31', '12:00', '17:00', 'bar', 'sick', false, 'New via upsert')
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status
$$, 'an upsert of a new row after a last working day is still refused');

SELECT fixture_assert(
  NOT has_function_privilege('anon', 'public.guard_shift_after_last_working_day()', 'EXECUTE')
  AND NOT has_function_privilege('authenticated', 'public.guard_shift_after_last_working_day()', 'EXECUTE'),
  'nobody can call the guard directly'
);

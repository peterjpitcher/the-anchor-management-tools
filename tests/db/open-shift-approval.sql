\set ON_ERROR_STOP on

-- approve_rota_open_shift_request: a manager approves one volunteer for an open shift. The shift
-- and its published copy go to that person, their request is approved, and every other pending
-- request for the same shift is declined. Anything that no longer matches comes back as 'stale'
-- and changes nothing.

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

-- One call, with the expected state taken from the live shift, as the server action does.
CREATE OR REPLACE FUNCTION fixture_approve(p_request uuid, p_shift uuid, p_employee uuid)
RETURNS TABLE (status text, shift_id uuid, week_start date, reason text)
LANGUAGE sql
AS $$
  SELECT a.status, a.shift_id, a.week_start, a.reason
  FROM public.rota_shifts s,
  LATERAL public.approve_rota_open_shift_request(
    p_request, p_shift, p_employee, '90000000-0000-0000-0000-000000000001',
    s.shift_date, s.start_time, s.end_time, s.unpaid_break_minutes, s.department, s.is_overnight, s.name
  ) a
  WHERE s.id = p_shift;
$$;

INSERT INTO auth.users (id) VALUES ('90000000-0000-0000-0000-000000000001');

INSERT INTO public.employees (employee_id, email_address, first_name, status) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'volunteer@example.test', 'Volunteer', 'Active'),
  ('a0000000-0000-0000-0000-000000000002', 'rival@example.test', 'Rival', 'Active'),
  ('a0000000-0000-0000-0000-000000000003', 'earlier@example.test', 'Earlier', 'Active'),
  ('a0000000-0000-0000-0000-000000000004', 'onleave@example.test', 'On leave', 'Active');

INSERT INTO public.rota_weeks (id, week_start, status) VALUES
  ('b0000000-0000-0000-0000-000000000001', '2026-11-23', 'published');

-- Shift 1 is the one that gets approved. Shift 2 is another open shift nobody should touch.
-- Shift 3 is wanted by somebody who is on approved leave that day.
INSERT INTO public.rota_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name) VALUES
  ('c0000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000001', NULL, '2026-11-27', '17:00', '22:00', 'bar', 'scheduled', true, 'Friday evening'),
  ('c0000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000001', NULL, '2026-11-28', '12:00', '17:00', 'bar', 'scheduled', true, 'Saturday lunch'),
  ('c0000000-0000-0000-0000-000000000003', 'b0000000-0000-0000-0000-000000000001', NULL, '2026-11-29', '12:00', '17:00', 'kitchen', 'scheduled', true, 'Sunday lunch');

INSERT INTO public.rota_published_shifts (id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name)
SELECT id, week_id, employee_id, shift_date, start_time, end_time, department, status, is_open_shift, name
FROM public.rota_shifts;

INSERT INTO public.rota_open_shift_requests (id, shift_id, employee_id, status, manager_note) VALUES
  ('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'pending', NULL),
  ('d0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002', 'pending', NULL),
  ('d0000000-0000-0000-0000-000000000003', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000003', 'declined', 'Declined last week'),
  ('d0000000-0000-0000-0000-000000000004', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002', 'pending', NULL),
  ('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004', 'pending', NULL);

INSERT INTO public.leave_requests (id, employee_id, start_date, end_date, status, holiday_year) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', '2026-11-29', '2026-11-29', 'approved', 2026);
INSERT INTO public.leave_days (request_id, employee_id, leave_date) VALUES
  ('e0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000004', '2026-11-29');

-- Unhappy path first: someone on approved leave is refused and nothing moves.
SELECT fixture_assert(
  (SELECT (status, shift_id, week_start, reason) IS NOT DISTINCT FROM
          ('stale'::text, 'c0000000-0000-0000-0000-000000000003'::uuid, '2026-11-23'::date, 'employee_on_leave'::text)
   FROM fixture_approve('d0000000-0000-0000-0000-000000000005', 'c0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004')),
  'a volunteer on approved leave is refused as stale, employee_on_leave'
);
SELECT fixture_assert(
  (SELECT is_open_shift AND employee_id IS NULL FROM public.rota_shifts WHERE id = 'c0000000-0000-0000-0000-000000000003')
  AND (SELECT status = 'pending' FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-000000000005'),
  'a refusal leaves the shift open and the request pending'
);

-- Happy path, with a rival request pending for the same shift. This is the call that raised
-- "column reference shift_id is ambiguous" in production.
SELECT fixture_assert(
  (SELECT (status, shift_id, week_start, reason) IS NOT DISTINCT FROM
          ('approved'::text, 'c0000000-0000-0000-0000-000000000001'::uuid, '2026-11-23'::date, NULL::text)
   FROM fixture_approve('d0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001')),
  'approving a pending request returns approved with the shift and its week'
);
SELECT fixture_assert(
  (SELECT employee_id = 'a0000000-0000-0000-0000-000000000001' AND NOT is_open_shift AND acceptance_status = 'accepted'
          AND reassigned_by = '90000000-0000-0000-0000-000000000001'
   FROM public.rota_shifts WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'the live shift goes to the volunteer, accepted'
);
SELECT fixture_assert(
  (SELECT employee_id = 'a0000000-0000-0000-0000-000000000001' AND NOT is_open_shift AND acceptance_status = 'accepted'
   FROM public.rota_published_shifts WHERE id = 'c0000000-0000-0000-0000-000000000001'),
  'the published shift goes to the volunteer, accepted'
);
SELECT fixture_assert(
  (SELECT status = 'approved' AND decided_by = '90000000-0000-0000-0000-000000000001' AND decided_at IS NOT NULL
   FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-000000000001'),
  'the volunteer''s request is approved'
);
SELECT fixture_assert(
  (SELECT status = 'declined' AND manager_note = 'Another request was approved for this shift' AND decided_at IS NOT NULL
   FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-000000000002'),
  'the rival pending request for the same shift is declined'
);
SELECT fixture_assert(
  (SELECT status = 'declined' AND manager_note = 'Declined last week' AND decided_at IS NULL
   FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-000000000003'),
  'a request already decided for that shift is left as it was'
);
SELECT fixture_assert(
  (SELECT status = 'pending' AND manager_note IS NULL
   FROM public.rota_open_shift_requests WHERE id = 'd0000000-0000-0000-0000-000000000004'),
  'the rival''s pending request for a different shift is left alone'
);
SELECT fixture_assert(
  (SELECT is_open_shift AND employee_id IS NULL FROM public.rota_shifts WHERE id = 'c0000000-0000-0000-0000-000000000002'),
  'the other open shift stays open'
);

-- A second press of the same button (the commonest retry) approves nothing twice.
SELECT fixture_assert(
  (SELECT (status, reason) IS NOT DISTINCT FROM ('stale'::text, 'request_changed'::text)
   FROM public.approve_rota_open_shift_request(
     'd0000000-0000-0000-0000-000000000001', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001',
     '90000000-0000-0000-0000-000000000001', '2026-11-27', '17:00', '22:00', 0::smallint, 'bar', false, 'Friday evening')),
  'approving the same request again is refused as stale, request_changed'
);

-- The rival, declined a moment ago, cannot be approved onto the shift that has now gone.
SELECT fixture_assert(
  (SELECT (status, reason) IS NOT DISTINCT FROM ('stale'::text, 'request_changed'::text)
   FROM public.approve_rota_open_shift_request(
     'd0000000-0000-0000-0000-000000000002', 'c0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002',
     '90000000-0000-0000-0000-000000000001', '2026-11-27', '17:00', '22:00', 0::smallint, 'bar', false, 'Friday evening')),
  'the declined rival cannot then be approved for the same shift'
);

-- A request that does not exist.
SELECT fixture_assert(
  (SELECT (status, reason) IS NOT DISTINCT FROM ('stale'::text, 'request_missing'::text)
   FROM public.approve_rota_open_shift_request(
     'd0000000-0000-0000-0000-0000000000ff', 'c0000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000002',
     '90000000-0000-0000-0000-000000000001', '2026-11-28', '12:00', '17:00', 0::smallint, 'bar', false, 'Saturday lunch')),
  'an unknown request is refused as stale, request_missing'
);

-- The fix must not change who may call the function or how it runs.
SELECT fixture_assert(
  (SELECT NOT p.prosecdef AND p.proconfig IS NULL
   FROM pg_proc p WHERE p.oid = 'public.approve_rota_open_shift_request(uuid,uuid,uuid,uuid,date,time,time,smallint,text,boolean,text)'::regprocedure),
  'the function is still SECURITY INVOKER with no settings of its own'
);

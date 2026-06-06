-- Business reliability event log and historical backfill.

CREATE TABLE IF NOT EXISTS public.employee_reliability_events (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id          UUID NOT NULL REFERENCES public.employees(employee_id) ON DELETE CASCADE,
  event_type           TEXT NOT NULL CHECK (
    event_type IN (
      'shift_accepted',
      'shift_auto_accepted',
      'shift_rejected',
      'late_shift_rejection_attempt',
      'couldnt_work',
      'holiday_requested',
      'holiday_approved',
      'late_holiday',
      'holiday_conflict'
    )
  ),
  event_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source               TEXT NOT NULL DEFAULT 'system',
  source_table         TEXT,
  source_id            UUID,
  idempotency_key      TEXT NOT NULL UNIQUE,
  shift_id             UUID,
  leave_request_id     UUID,
  week_id              UUID,
  shift_date           DATE,
  start_time           TIME,
  end_time             TIME,
  department           TEXT,
  shift_name           TEXT,
  leave_start_date     DATE,
  leave_end_date       DATE,
  leave_day_count      NUMERIC(6,2),
  published_at         TIMESTAMPTZ,
  notice_days          NUMERIC(6,2),
  impacted_shift_count INTEGER NOT NULL DEFAULT 0,
  score_eligible       BOOLEAN NOT NULL DEFAULT TRUE,
  note                 TEXT,
  metadata             JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_employee_reliability_employee_event_at
  ON public.employee_reliability_events(employee_id, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_reliability_event_type
  ON public.employee_reliability_events(event_type, event_at DESC);

CREATE INDEX IF NOT EXISTS idx_employee_reliability_shift
  ON public.employee_reliability_events(shift_id)
  WHERE shift_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_employee_reliability_leave
  ON public.employee_reliability_events(leave_request_id)
  WHERE leave_request_id IS NOT NULL;

ALTER TABLE public.employee_reliability_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users with employees view can read employee reliability events"
  ON public.employee_reliability_events;

CREATE POLICY "Users with employees view can read employee reliability events"
  ON public.employee_reliability_events FOR SELECT
  TO authenticated
  USING (public.user_has_permission(auth.uid(), 'employees', 'view'));

-- ---------------------------------------------------------------------------
-- Backfill shift acceptances and auto-acceptances from the published snapshot.
-- ---------------------------------------------------------------------------

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  shift_id,
  week_id,
  shift_date,
  start_time,
  end_time,
  department,
  shift_name,
  published_at,
  note,
  metadata
)
SELECT
  p.employee_id,
  CASE
    WHEN p.acceptance_status = 'auto_accepted' THEN 'shift_auto_accepted'
    ELSE 'shift_accepted'
  END,
  COALESCE(p.acceptance_decided_at, p.published_at, NOW()),
  'backfill',
  'rota_published_shifts',
  p.id,
  concat(
    CASE
      WHEN p.acceptance_status = 'auto_accepted' THEN 'shift_auto_accepted'
      ELSE 'shift_accepted'
    END,
    ':published:',
    p.id::text,
    ':',
    p.employee_id::text
  ),
  p.id,
  p.week_id,
  p.shift_date,
  p.start_time,
  p.end_time,
  p.department,
  p.name,
  p.published_at,
  p.acceptance_note,
  jsonb_build_object(
    'acceptance_status', p.acceptance_status,
    'auto_accept_reason', p.auto_accept_reason,
    'backfilled', true
  )
FROM public.rota_published_shifts p
WHERE p.employee_id IS NOT NULL
  AND p.status = 'scheduled'
  AND p.is_open_shift = FALSE
  AND p.acceptance_status IN ('accepted', 'auto_accepted')
ON CONFLICT (idempotency_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill rejections from the dedicated rejection history.
-- ---------------------------------------------------------------------------

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  shift_id,
  week_id,
  shift_date,
  start_time,
  end_time,
  department,
  shift_name,
  note,
  metadata
)
SELECT
  r.employee_id,
  'shift_rejected',
  COALESCE(r.rejected_at, r.created_at, NOW()),
  'backfill',
  'rota_shift_rejections',
  r.id,
  concat('shift_rejected:rejection:', r.id::text),
  r.shift_id,
  r.week_id,
  r.shift_date,
  r.start_time,
  r.end_time,
  r.department,
  r.name,
  r.rejection_note,
  jsonb_build_object('backfilled', true)
FROM public.rota_shift_rejections r
ON CONFLICT (idempotency_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill Couldn't Work markers from rota_shifts.
-- ---------------------------------------------------------------------------

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  shift_id,
  week_id,
  shift_date,
  start_time,
  end_time,
  department,
  shift_name,
  note,
  metadata
)
SELECT
  s.employee_id,
  'couldnt_work',
  COALESCE(s.created_at, s.updated_at, NOW()),
  'backfill',
  'rota_shifts',
  s.id,
  concat('couldnt_work:shift:', s.id::text),
  s.id,
  s.week_id,
  s.shift_date,
  s.start_time,
  s.end_time,
  s.department,
  s.name,
  s.sick_reason,
  jsonb_build_object('backfilled', true)
FROM public.rota_shifts s
WHERE s.status = 'sick'
  AND s.employee_id IS NOT NULL
ON CONFLICT (idempotency_key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Backfill holiday context and scoring events.
-- ---------------------------------------------------------------------------

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  leave_request_id,
  leave_start_date,
  leave_end_date,
  leave_day_count,
  notice_days,
  score_eligible,
  note,
  metadata
)
SELECT
  l.employee_id,
  'holiday_requested',
  COALESCE(l.created_at, NOW()),
  'backfill',
  'leave_requests',
  l.id,
  concat('holiday_requested:', l.id::text),
  l.id,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date + 1),
  (l.start_date - (COALESCE(l.created_at, NOW()) AT TIME ZONE 'Europe/London')::date),
  FALSE,
  l.note,
  jsonb_build_object('status', l.status, 'backfilled', true)
FROM public.leave_requests l
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  leave_request_id,
  leave_start_date,
  leave_end_date,
  leave_day_count,
  notice_days,
  score_eligible,
  note,
  metadata
)
SELECT
  l.employee_id,
  'holiday_approved',
  COALESCE(l.reviewed_at, l.created_at, NOW()),
  'backfill',
  'leave_requests',
  l.id,
  concat('holiday_approved:', l.id::text),
  l.id,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date + 1),
  (l.start_date - (COALESCE(l.created_at, NOW()) AT TIME ZONE 'Europe/London')::date),
  FALSE,
  COALESCE(l.manager_note, l.note),
  jsonb_build_object('status', l.status, 'backfilled', true)
FROM public.leave_requests l
WHERE l.status = 'approved'
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  leave_request_id,
  leave_start_date,
  leave_end_date,
  leave_day_count,
  notice_days,
  note,
  metadata
)
SELECT
  l.employee_id,
  'late_holiday',
  COALESCE(l.reviewed_at, l.created_at, NOW()),
  'backfill',
  'leave_requests',
  l.id,
  concat('late_holiday:', l.id::text, ':', l.start_date::text, ':', l.end_date::text),
  l.id,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date + 1),
  (l.start_date - (COALESCE(l.created_at, NOW()) AT TIME ZONE 'Europe/London')::date),
  COALESCE(l.manager_note, l.note),
  jsonb_build_object('status', l.status, 'backfilled', true)
FROM public.leave_requests l
WHERE l.status = 'approved'
  AND (l.start_date - (COALESCE(l.created_at, NOW()) AT TIME ZONE 'Europe/London')::date) <= 14
ON CONFLICT (idempotency_key) DO NOTHING;

INSERT INTO public.employee_reliability_events (
  employee_id,
  event_type,
  event_at,
  source,
  source_table,
  source_id,
  idempotency_key,
  leave_request_id,
  leave_start_date,
  leave_end_date,
  leave_day_count,
  notice_days,
  impacted_shift_count,
  note,
  metadata
)
SELECT
  l.employee_id,
  'holiday_conflict',
  COALESCE(l.reviewed_at, l.created_at, NOW()),
  'backfill',
  'leave_requests',
  l.id,
  concat('holiday_conflict:', l.id::text, ':', l.start_date::text, ':', l.end_date::text),
  l.id,
  l.start_date,
  l.end_date,
  (l.end_date - l.start_date + 1),
  (l.start_date - (COALESCE(l.created_at, NOW()) AT TIME ZONE 'Europe/London')::date),
  conflicts.conflict_count,
  COALESCE(l.manager_note, l.note),
  jsonb_build_object('status', l.status, 'backfilled', true)
FROM public.leave_requests l
JOIN LATERAL (
  SELECT COUNT(*)::integer AS conflict_count
  FROM public.rota_published_shifts p
  WHERE p.employee_id = l.employee_id
    AND p.status = 'scheduled'
    AND p.is_open_shift = FALSE
    AND p.shift_date BETWEEN l.start_date AND l.end_date
) conflicts ON conflicts.conflict_count > 0
WHERE l.status = 'approved'
ON CONFLICT (idempotency_key) DO NOTHING;

-- Backfill employee-scoped audit entries so historical reliability context is
-- visible from staff files. Dedupe through the event idempotency key stored in
-- additional_info.
INSERT INTO public.audit_logs (
  created_at,
  user_id,
  user_email,
  operation_type,
  resource_type,
  resource_id,
  operation_status,
  new_values,
  additional_info
)
SELECT
  e.event_at,
  NULL,
  NULL,
  'reliability_event',
  'employee',
  e.employee_id::text,
  'success',
  jsonb_build_object(
    'event_type', e.event_type,
    'shift_id', e.shift_id,
    'leave_request_id', e.leave_request_id
  ),
  jsonb_build_object(
    'action', e.event_type,
    'event_type', e.event_type,
    'source', 'backfill',
    'reliability_idempotency_key', e.idempotency_key,
    'shift_id', e.shift_id,
    'shift_date', e.shift_date,
    'start_time', e.start_time,
    'end_time', e.end_time,
    'department', e.department,
    'shift_name', e.shift_name,
    'leave_request_id', e.leave_request_id,
    'start_date', e.leave_start_date,
    'end_date', e.leave_end_date,
    'leave_day_count', e.leave_day_count,
    'notice_days', e.notice_days,
    'impacted_shift_count', e.impacted_shift_count,
    'note', e.note
  )
FROM public.employee_reliability_events e
WHERE e.source = 'backfill'
  AND NOT EXISTS (
    SELECT 1
    FROM public.audit_logs al
    WHERE al.resource_type = 'employee'
      AND al.resource_id = e.employee_id::text
      AND al.additional_info ->> 'reliability_idempotency_key' = e.idempotency_key
  );

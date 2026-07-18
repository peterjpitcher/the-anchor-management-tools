-- Checklists foundation: 10 tables, constraints, RLS (deny-all service-role only), RBAC.
-- Ships dark (every checklist_settings flag defaults false, no cron, no jobs, no UI).
-- See tasks/checklists-discovery/spec.md v4 sections 3 and 12.

-- 1. checklists
CREATE TABLE public.checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  description text,
  department  text NOT NULL REFERENCES public.departments(name),
  sort_order  int NOT NULL DEFAULT 0,
  is_active   boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  created_by  uuid,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- 2. checklist_task_templates
CREATE TABLE public.checklist_task_templates (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checklist_id         uuid NOT NULL REFERENCES public.checklists(id) ON DELETE RESTRICT,
  title                text NOT NULL,
  instruction          text,
  sort_order           int NOT NULL DEFAULT 0,
  department           text REFERENCES public.departments(name),
  schedule_kind        text NOT NULL CHECK (schedule_kind IN ('calendar','floating')),
  freq                 text CHECK (freq IN ('daily','weekly','monthly','quarterly','annual')),
  freq_interval        int NOT NULL DEFAULT 1 CHECK (freq_interval >= 1),
  anchor_date          date,
  by_weekday           int[],
  anchor               text NOT NULL DEFAULT 'open'
                         CHECK (anchor IN ('open','close','every','at_times','anytime')),
  at_times             time[],
  every_hours          numeric,
  first_offset_minutes int,
  not_before           time,
  lead_minutes         int NOT NULL DEFAULT 0 CHECK (lead_minutes >= 0),
  grace_minutes        int CHECK (grace_minutes IS NULL OR grace_minutes >= 0),
  interval_days        int,
  tolerance_days       int,
  first_due_on         date,
  season_start         text CHECK (season_start IS NULL OR season_start ~ '^[0-1][0-9]-[0-3][0-9]$'),
  season_end           text CHECK (season_end IS NULL OR season_end ~ '^[0-1][0-9]-[0-3][0-9]$'),
  requires_value       boolean NOT NULL DEFAULT false,
  value_unit           text,
  value_min            numeric(5,1),
  value_max            numeric(5,1),
  is_spot_checkable    boolean NOT NULL DEFAULT false,
  is_active            boolean NOT NULL DEFAULT true,
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  created_by           uuid,
  updated_at           timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT cl_tpl_calendar_shape CHECK (
    schedule_kind <> 'calendar' OR (
      freq IS NOT NULL AND interval_days IS NULL AND tolerance_days IS NULL AND first_due_on IS NULL
    )
  ),
  CONSTRAINT cl_tpl_floating_shape CHECK (
    schedule_kind <> 'floating' OR (
      interval_days IS NOT NULL AND interval_days >= 1
      AND tolerance_days IS NOT NULL AND tolerance_days >= 0
      AND first_due_on IS NOT NULL
      AND anchor = 'anytime' AND at_times IS NULL AND every_hours IS NULL
    )
  ),
  CONSTRAINT cl_tpl_every_shape CHECK (
    anchor <> 'every' OR (every_hours IS NOT NULL AND every_hours > 0)
  ),
  CONSTRAINT cl_tpl_at_times_shape CHECK (
    anchor <> 'at_times' OR (at_times IS NOT NULL AND array_length(at_times, 1) >= 1)
  ),
  CONSTRAINT cl_tpl_every_only CHECK (
    anchor = 'every' OR (every_hours IS NULL AND first_offset_minutes IS NULL AND not_before IS NULL)
  ),
  CONSTRAINT cl_tpl_anchor_date CHECK (
    NOT (freq_interval > 1 OR freq IN ('weekly','monthly','quarterly','annual')) OR anchor_date IS NOT NULL
  ),
  CONSTRAINT cl_tpl_value_bounds CHECK (value_min IS NULL OR value_max IS NULL OR value_min <= value_max),
  CONSTRAINT cl_tpl_value_required CHECK (
    NOT requires_value OR ((value_min IS NOT NULL OR value_max IS NOT NULL) AND value_unit IS NOT NULL)
  ),
  CONSTRAINT cl_tpl_season_pair CHECK ((season_start IS NULL) = (season_end IS NULL))
);
CREATE INDEX idx_cl_tpl_checklist ON public.checklist_task_templates(checklist_id);
CREATE INDEX idx_cl_tpl_active ON public.checklist_task_templates(is_active) WHERE is_active;

-- 3. checklist_generation_runs (declared before instances for the FK)
CREATE TABLE public.checklist_generation_runs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date       date NOT NULL,
  attempt             int NOT NULL DEFAULT 1,
  status              text NOT NULL CHECK (status IN ('running','complete','failed','skipped_closed')),
  window_json         jsonb,  -- resolved TradingWindow provenance ("window" is a reserved SQL keyword)
  instances_created   int,
  instances_updated   int,
  instances_retracted int,
  error_message       text,
  started_at          timestamptz NOT NULL DEFAULT now(),
  finished_at         timestamptz,
  UNIQUE (business_date, attempt)
);

-- 4. checklist_task_instances
CREATE TABLE public.checklist_task_instances (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id              uuid NOT NULL REFERENCES public.checklist_task_templates(id) ON DELETE RESTRICT,
  template_version         int NOT NULL,
  checklist_id             uuid NOT NULL REFERENCES public.checklists(id) ON DELETE RESTRICT,
  generation_run_id        uuid REFERENCES public.checklist_generation_runs(id),
  business_date            date NOT NULL,
  slot                     text NOT NULL,
  department               text NOT NULL,
  title_snapshot           text NOT NULL,
  instruction_snapshot     text,
  requires_value           boolean NOT NULL,
  value_unit               text,
  value_min                numeric(5,1),
  value_max                numeric(5,1),
  is_spot_checkable        boolean NOT NULL,
  window_start             timestamptz NOT NULL,
  due_at                   timestamptz NOT NULL,
  grace_until              timestamptz NOT NULL,
  state                    text NOT NULL DEFAULT 'pending'
                             CHECK (state IN ('pending','done','missed','skipped','not_applicable')),
  locked_at                timestamptz,
  accountable_employee_id  uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_by_employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_at             timestamptz,
  was_late                 boolean NOT NULL DEFAULT false,
  value_recorded           numeric(5,1),
  value_breach             boolean NOT NULL DEFAULT false,
  notes                    text,
  skip_reason              text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),

  UNIQUE (template_id, business_date, slot),
  CONSTRAINT cl_inst_time_order CHECK (window_start <= due_at AND due_at <= grace_until),
  CONSTRAINT cl_inst_done_fields CHECK (
    state <> 'done' OR (completed_by_employee_id IS NOT NULL AND completed_at IS NOT NULL)
  ),
  CONSTRAINT cl_inst_open_fields CHECK (
    state NOT IN ('missed','pending')
    OR (completed_by_employee_id IS NULL AND completed_at IS NULL AND value_recorded IS NULL)
  ),
  CONSTRAINT cl_inst_skip_reason CHECK (state <> 'skipped' OR skip_reason IS NOT NULL),
  CONSTRAINT cl_inst_value_present CHECK (
    NOT (requires_value AND state = 'done') OR value_recorded IS NOT NULL
  ),
  CONSTRAINT cl_inst_value_absent CHECK (requires_value OR value_recorded IS NULL)
);
CREATE INDEX idx_cl_inst_date_checklist ON public.checklist_task_instances(business_date, checklist_id);
CREATE INDEX idx_cl_inst_completer ON public.checklist_task_instances(completed_by_employee_id, business_date);
CREATE INDEX idx_cl_inst_pending ON public.checklist_task_instances(grace_until) WHERE state = 'pending';
CREATE INDEX idx_cl_inst_run ON public.checklist_task_instances(generation_run_id);

-- 5. checklist_spot_checks
CREATE TABLE public.checklist_spot_checks (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid NOT NULL REFERENCES public.checklist_task_instances(id),
  business_date       date NOT NULL,
  draw_number         int NOT NULL,
  checked_employee_id uuid NOT NULL REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  drawn_at            timestamptz NOT NULL DEFAULT now(),
  state               text NOT NULL DEFAULT 'drawn' CHECK (state IN ('drawn','recorded')),
  checked_by_user_id  uuid,
  result              text CHECK (result IN ('pass','fail')),
  note                text,
  recorded_at         timestamptz,
  UNIQUE (instance_id),
  UNIQUE (business_date, draw_number),
  CONSTRAINT cl_spot_recorded CHECK (
    state <> 'recorded'
    OR (result IS NOT NULL AND recorded_at IS NOT NULL AND checked_by_user_id IS NOT NULL)
  )
);
CREATE INDEX idx_cl_spot_date ON public.checklist_spot_checks(business_date);

-- 6. checklist_todos
CREATE TABLE public.checklist_todos (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title                    text NOT NULL,
  description              text,
  department               text REFERENCES public.departments(name),
  assigned_employee_id     uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  due_date                 date,
  state                    text NOT NULL DEFAULT 'open' CHECK (state IN ('open','done','cancelled')),
  completed_by_employee_id uuid REFERENCES public.employees(employee_id) ON DELETE RESTRICT,
  completed_at             timestamptz,
  notes                    text,
  created_at               timestamptz NOT NULL DEFAULT now(),
  created_by               uuid,
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_cl_todos_state_due ON public.checklist_todos(state, due_date);

-- 7. checklist_email_outbox
CREATE TABLE public.checklist_email_outbox (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_type      text NOT NULL CHECK (email_type IN ('weekly_summary','value_breach','system_alert')),
  source_type     text NOT NULL,
  source_id       text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  to_addresses    text[] NOT NULL,
  subject         text NOT NULL,
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','held','sent','failed')),
  attempts        int NOT NULL DEFAULT 0,
  next_attempt_at timestamptz,
  error_message   text,
  message_id      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz
);
CREATE INDEX idx_cl_outbox_status ON public.checklist_email_outbox(status, next_attempt_at);

-- 8. checklist_settings (singleton, all switches default false)
CREATE TABLE public.checklist_settings (
  id                             int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  autumn_winter_start            text NOT NULL DEFAULT '10-01',
  autumn_winter_end              text NOT NULL DEFAULT '03-31',
  spot_checks_per_day            int NOT NULL DEFAULT 2,
  default_grace_minutes          int NOT NULL DEFAULT 30,
  business_day_start_hour        int NOT NULL DEFAULT 6,
  open_lead_minutes              int NOT NULL DEFAULT 0,
  close_lead_minutes             int NOT NULL DEFAULT 60,
  mismatch_threshold_minutes     int NOT NULL DEFAULT 30,
  mismatch_early_threshold_minutes int NOT NULL DEFAULT 90,
  module_enabled                 boolean NOT NULL DEFAULT false,
  generation_enabled             boolean NOT NULL DEFAULT false,
  prompts_enabled                boolean NOT NULL DEFAULT false,
  emails_enabled                 boolean NOT NULL DEFAULT false,
  updated_at                     timestamptz NOT NULL DEFAULT now(),
  updated_by                     uuid
);
INSERT INTO public.checklist_settings (id) VALUES (1);

-- 9. checklist_hours_mismatches
CREATE TABLE public.checklist_hours_mismatches (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  business_date          date NOT NULL,
  kind                   text NOT NULL CHECK (kind IN ('no_cover_at_open','no_cover_at_close','rota_before_open')),
  expected_opens_at      timestamptz,
  expected_closes_at     timestamptz,
  rota_earliest_start_at timestamptz,
  rota_latest_end_at     timestamptz,
  mismatch_minutes       int NOT NULL,
  notified_at            timestamptz,
  created_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (business_date, kind)
);

-- 10. checklist_spot_check_expectations
CREATE TABLE public.checklist_spot_check_expectations (
  business_date date PRIMARY KEY,
  expected      int NOT NULL
);

-- RLS: all ten tables deny-all, service-role only.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'checklists','checklist_task_templates','checklist_generation_runs',
    'checklist_task_instances','checklist_spot_checks','checklist_todos',
    'checklist_email_outbox','checklist_settings','checklist_hours_mismatches',
    'checklist_spot_check_expectations'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true);',
      t || '_service_role', t
    );
  END LOOP;
END $$;

-- RBAC: the checklists module.
INSERT INTO public.permissions (module_name, action, description) VALUES
  ('checklists', 'view',   'View and complete checklist tasks'),
  ('checklists', 'manage', 'Set up checklists, view insights, run spot checks')
ON CONFLICT (module_name, action) DO UPDATE SET description = EXCLUDED.description;

-- super_admin + manager: view + manage.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name IN ('super_admin','manager') AND p.module_name = 'checklists'
ON CONFLICT DO NOTHING;

-- staff: view only.
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM public.roles r CROSS JOIN public.permissions p
WHERE r.name = 'staff' AND p.module_name = 'checklists' AND p.action = 'view'
ON CONFLICT DO NOTHING;
-- NOTE: foh_staff is deliberately NOT granted here. Its checklists:view grant ships in
-- Phase 2 in the same deploy as the FOH_MODULES widening in src/lib/foh/user-mode.ts
-- (spec sections 12 and 14), so the FOH iPad keeps chromeless kiosk mode.

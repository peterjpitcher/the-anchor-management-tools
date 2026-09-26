'use client';

import { useState, useTransition } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  Empty,
  Field,
  Fieldset,
  IconButton,
  Input,
  Modal,
  PageLayout,
  Section,
  Select,
  toast,
  Icon,
} from '@/ds';
import { formatTime12Hour } from '@/lib/dateUtils';
import {
  createShiftTemplate,
  updateShiftTemplate,
  deactivateShiftTemplate,
  type ShiftTemplate,
} from '@/app/actions/rota-templates';
import type { RotaEmployee } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';
import { displayName } from '@/lib/employees/display-name';
import { calculatePaidHours } from '@/lib/rota/pay-math';
import {
  SHIFT_TEMPLATE_COLOURS,
  getAutomaticShiftColour,
  getShiftColourLabel,
} from '@/lib/rota/shift-template-colours';
import { rotaDepartmentClasses } from '@/lib/rota/status-ui';
import type { RotaLayoutProps } from '../_shared/layout';
import { SHIFT_TEMPLATE_BADGE_TONE } from '../_shared/status-ui';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface ShiftTemplatesManagerProps {
  /** The page header, built once by page.tsx. */
  layout: RotaLayoutProps;
  /** Shown above the page body, such as the alert for a secondary load that failed. */
  notice?: React.ReactNode;
  canEdit: boolean;
  initialTemplates: ShiftTemplate[];
  employees: RotaEmployee[];
  departments: Department[];
}

/** Paid hours for a template row, formatted for display. The arithmetic itself
 *  lives in @/lib/rota/pay-math so every rota surface agrees. Templates carry no
 *  overnight flag, so an end time before the start is the only wrap rule. */
function formatPaidHours(start: string, end: string, breakMins: number): string {
  return `${calculatePaidHours(start, end, breakMins).toFixed(1)}h`;
}

function empName(emp: RotaEmployee): string {
  return displayName(emp, 'Unknown');
}

interface TemplateFormProps {
  initial?: ShiftTemplate;
  employees: RotaEmployee[];
  departments: Department[];
  onSave: (template: ShiftTemplate) => void;
  onCancel: () => void;
}

/** The template form, in a dialog for both a new template and an edit. */
function TemplateFormModal({ initial, employees, departments, onSave, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startTime, setStartTime] = useState(initial?.start_time ?? '');
  const [endTime, setEndTime] = useState(initial?.end_time ?? '');
  const [breakMins, setBreakMins] = useState(initial?.unpaid_break_minutes?.toString() ?? '0');
  const [department, setDepartment] = useState<string>(initial?.department ?? departments[0]?.name ?? 'bar');
  const initialAutomaticColour = getAutomaticShiftColour(
    initial?.department ?? departments[0]?.name ?? 'bar',
    initial?.start_time ?? '',
  );
  const [colourMode, setColourMode] = useState<'automatic' | 'manual'>(() => (
    !initial?.colour || initial.colour.toLowerCase() === initialAutomaticColour?.toLowerCase()
      ? 'automatic'
      : 'manual'
  ));
  const [manualColour, setManualColour] = useState(initial?.colour ?? SHIFT_TEMPLATE_COLOURS[0].value);
  const [dayOfWeek, setDayOfWeek] = useState<string>(
    initial?.day_of_week !== null && initial?.day_of_week !== undefined
      ? String(initial.day_of_week)
      : '',
  );
  const [employeeId, setEmployeeId] = useState<string>(initial?.employee_id ?? '');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const automaticColour = getAutomaticShiftColour(department, startTime);
  const selectedColour = colourMode === 'automatic' ? automaticColour : manualColour;

  const handleSubmit = () => {
    if (!name.trim()) { setError('Name is required'); return; }
    if (!startTime) { setError('Start time is required'); return; }
    if (!endTime) { setError('End time is required'); return; }
    const breakMinutes = parseInt(breakMins) || 0;
    setError('');

    const payload = {
      name: name.trim(),
      startTime,
      endTime,
      unpaidBreakMinutes: breakMinutes,
      department,
      colour: selectedColour,
      dayOfWeek: dayOfWeek !== '' ? parseInt(dayOfWeek) : null,
      employeeId: employeeId || null,
    };

    startTransition(async () => {
      if (initial) {
        const result = await updateShiftTemplate(initial.id, payload);
        if (!result.success) { toast.error(result.error); return; }
        toast.success('Template updated');
        onSave(result.data);
      } else {
        const result = await createShiftTemplate(payload);
        if (!result.success) { toast.error(result.error); return; }
        toast.success('Template created');
        onSave(result.data);
      }
    });
  };

  const swatchButton = (selected: boolean) =>
    `relative h-auto min-h-11 w-full justify-start gap-2 px-2.5 py-2 text-left font-normal ${
      selected ? 'border-primary bg-primary-soft hover:bg-primary-soft' : ''
    }`;

  return (
    <Modal
      open
      onClose={onCancel}
      title={initial ? 'Edit Shift Template' : 'New Shift Template'}
      width="xl"
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button type="button" variant="primary" onClick={handleSubmit} disabled={isPending}>
            {isPending ? 'Saving…' : initial ? 'Save Changes' : 'Create Template'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <Alert tone="danger">{error}</Alert>}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
          <div className="sm:col-span-2">
            <Field label="Template name" htmlFor="tmpl-name" required>
              <Input
                id="tmpl-name"
                placeholder='e.g. "Saturday Evening Bar"'
                value={name}
                onChange={e => setName(e.target.value)}
              />
            </Field>
          </div>

          <Field label="Department" htmlFor="tmpl-dept">
            <Select
              id="tmpl-dept"
              value={department}
              onChange={e => setDepartment(e.target.value)}
              options={departments.map(d => ({ value: d.name, label: d.label }))}
            />
          </Field>

          <Field label="Start time" htmlFor="tmpl-start" required>
            <Input
              id="tmpl-start"
              type="time"
              value={startTime}
              onChange={e => setStartTime(e.target.value)}
            />
          </Field>

          <Field label="End time" htmlFor="tmpl-end" required>
            <Input
              id="tmpl-end"
              type="time"
              value={endTime}
              onChange={e => setEndTime(e.target.value)}
            />
          </Field>

          <Field label="Unpaid break (mins)" htmlFor="tmpl-break">
            <Input
              id="tmpl-break"
              type="number"
              min="0"
              max="120"
              value={breakMins}
              onChange={e => setBreakMins(e.target.value)}
            />
          </Field>

          {startTime && endTime && (
            <div className="flex items-end pb-0.5">
              <p className="text-sm text-text-muted">
                Paid: <strong>{formatPaidHours(startTime, endTime, parseInt(breakMins) || 0)}</strong>
              </p>
            </div>
          )}
        </div>

        <Fieldset
          legend="Shift colour"
          hint="Automatic uses the department and start time. Pick a colour to override it."
          className="border-t border-border pt-4"
        >
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <Button
              id="tmpl-colour-auto"
              type="button"
              variant="secondary"
              aria-pressed={colourMode === 'automatic'}
              onClick={() => setColourMode('automatic')}
              className={swatchButton(colourMode === 'automatic')}
            >
              <span
                className="h-5 w-5 shrink-0 rounded-full border border-border-strong shadow-xs"
                style={{ backgroundColor: automaticColour ?? 'var(--color-border)' }}
              />
              <span className="min-w-0">
                <span className="block text-xs font-medium text-text-strong">Automatic</span>
                <span className="block truncate text-2xs text-text-soft">
                  {getShiftColourLabel(automaticColour) ?? 'No rule'}
                </span>
              </span>
              {colourMode === 'automatic' && <Icon name="check" size={14} className="ml-auto shrink-0 text-primary" />}
            </Button>

            {SHIFT_TEMPLATE_COLOURS.map(option => {
              const selected = colourMode === 'manual' && manualColour.toLowerCase() === option.value.toLowerCase();
              return (
                <Button
                  key={option.value}
                  type="button"
                  variant="secondary"
                  aria-pressed={selected}
                  onClick={() => { setManualColour(option.value); setColourMode('manual'); }}
                  className={swatchButton(selected)}
                >
                  {/* The swatch is the saved colour itself: data, not a token. */}
                  <span
                    className="h-5 w-5 shrink-0 rounded-full border border-border-strong shadow-xs"
                    style={{ backgroundColor: option.value }}
                  />
                  <span className="truncate text-xs font-medium text-text-strong">{option.label}</span>
                  {selected && <Icon name="check" size={14} className="ml-auto shrink-0 text-primary" />}
                </Button>
              );
            })}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Input
              id="tmpl-colour-custom"
              type="color"
              aria-label="Choose a custom shift colour"
              value={manualColour}
              onChange={e => { setManualColour(e.target.value); setColourMode('manual'); }}
              className="h-9 w-11 cursor-pointer p-0.5"
            />
            <span className="text-xs text-text-soft">Custom colour</span>
          </div>
        </Fieldset>

        <div className="grid grid-cols-1 gap-4 border-t border-border pt-4 sm:grid-cols-2">
          <Field
            label="Day of week (auto-schedule)"
            htmlFor="tmpl-day"
            hint="Auto-populates on this day when you click “Apply Templates” on the rota."
          >
            <Select
              id="tmpl-day"
              value={dayOfWeek}
              onChange={e => setDayOfWeek(e.target.value)}
              options={[
                { value: '', label: 'No scheduled day' },
                ...DAYS.map((d, i) => ({ value: String(i), label: d })),
              ]}
            />
          </Field>

          <Field
            label="Pre-assigned employee (optional)"
            htmlFor="tmpl-emp"
            hint="Creates an assigned shift instead of an open one."
          >
            <Select
              id="tmpl-emp"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              options={[
                { value: '', label: 'Open shift (no assignment)' },
                ...employees.map(e => ({ value: e.employee_id, label: empName(e) })),
              ]}
            />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function TemplateRow({ template, employees, departments, canEdit }: { template: ShiftTemplate; employees: RotaEmployee[]; departments: Department[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [confirmDeactivate, setConfirmDeactivate] = useState(false);
  const [current, setCurrent] = useState(template);

  const handleDeactivate = async () => {
    const result = await deactivateShiftTemplate(current.id);
    if (!result.success) { toast.error(result.error); return; }
    toast.success('Template deactivated');
  };

  const rowColour = current.colour ?? getAutomaticShiftColour(current.department, current.start_time);
  // The left edge is the template's saved colour: data, not a token.
  const colourStyle = rowColour ? { borderLeftColor: rowColour, borderLeftWidth: 4 } : {};
  const assignedEmp = current.employee_id
    ? employees.find(e => e.employee_id === current.employee_id)
    : null;

  return (
    <li
      className={`flex items-center justify-between px-pad-card py-3 ${rotaDepartmentClasses(current.department)} transition-colors`}
      style={colourStyle}
    >
      <div className="flex items-center gap-3 min-w-0">
        {rowColour && (
          <span
            className="h-4 w-4 shrink-0 rounded-full border border-border-strong shadow-xs"
            style={{ backgroundColor: rowColour }}
            title={getShiftColourLabel(rowColour) ?? rowColour}
          />
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium text-text-strong truncate">{current.name}</p>
          <p className="text-xs text-text-muted">
            {formatTime12Hour(current.start_time)} – {formatTime12Hour(current.end_time)}
            {current.unpaid_break_minutes > 0 && ` · ${current.unpaid_break_minutes} min break`}
            {' · '}
            {formatPaidHours(current.start_time, current.end_time, current.unpaid_break_minutes)} paid
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {current.day_of_week !== null && current.day_of_week !== undefined && (
              <Badge tone={SHIFT_TEMPLATE_BADGE_TONE.day} size="sm">
                {DAYS[current.day_of_week]}
              </Badge>
            )}
            {assignedEmp && (
              <Badge tone={SHIFT_TEMPLATE_BADGE_TONE.employee} size="sm">
                {empName(assignedEmp)}
              </Badge>
            )}
            {!assignedEmp && current.day_of_week !== null && (
              <Badge tone={SHIFT_TEMPLATE_BADGE_TONE.open_shift} size="sm">
                Open shift
              </Badge>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <Badge size="sm" className={rotaDepartmentClasses(current.department)}>{current.department}</Badge>
        {canEdit && (
          <>
            <IconButton
              type="button"
              size="sm"
              onClick={() => setEditing(true)}
              className="text-text-subtle hover:text-text"
              title="Edit template"
              label="Edit template"
              icon={<Icon name="edit" size={16} />}
            />
            <IconButton
              type="button"
              size="sm"
              onClick={() => setConfirmDeactivate(true)}
              className="text-text-subtle hover:bg-danger-soft hover:text-danger-fg"
              title="Deactivate template"
              label="Deactivate template"
              icon={<Icon name="trash" size={16} />}
            />
          </>
        )}
      </div>

      {editing && (
        <TemplateFormModal
          initial={current}
          employees={employees}
          departments={departments}
          onSave={saved => { setCurrent(saved); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      )}

      <ConfirmDialog
        open={confirmDeactivate}
        onClose={() => setConfirmDeactivate(false)}
        onConfirm={handleDeactivate}
        title="Deactivate Template?"
        message={`Deactivate "${current.name}"? It will no longer appear in the template palette.`}
        confirmLabel="Deactivate"
        tone="danger"
      />
    </li>
  );
}

export default function ShiftTemplatesManager({ layout, notice, canEdit, initialTemplates, employees, departments }: ShiftTemplatesManagerProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showNewForm, setShowNewForm] = useState(false);

  const activeTemplates = templates.filter(t => t.is_active);

  const onNewSaved = (t: ShiftTemplate) => {
    setTemplates(prev => [...prev, t]);
    setShowNewForm(false);
  };

  const byDayOfWeek = (a: ShiftTemplate, b: ShiftTemplate) => (a.day_of_week ?? 7) - (b.day_of_week ?? 7);

  // One group per department in the departments list, then anything whose department is not
  // in it, so no active template is ever hidden.
  const knownDepts = new Set(departments.map(d => d.name));
  const groups = [
    ...departments.map(dept => ({
      key: dept.name,
      label: dept.label,
      templates: activeTemplates.filter(t => t.department === dept.name).sort(byDayOfWeek),
    })),
    {
      key: '__other__',
      label: 'Other',
      templates: activeTemplates.filter(t => !knownDepts.has(t.department)).sort(byDayOfWeek),
    },
  ].filter(group => group.templates.length > 0);

  return (
    <PageLayout
      {...layout}
      headerActions={
        canEdit ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            icon={<Icon name="plus" size={16} />}
            onClick={() => setShowNewForm(true)}
          >
            New Template
          </Button>
        ) : undefined
      }
    >
      {notice}

      <Section
        title="Templates"
        description="Active templates appear in the drag-and-drop palette when building the weekly rota. Assign a day of the week to auto-populate shifts; assign an employee to pre-assign instead of creating an open shift."
      >
        {groups.length === 0 ? (
          <Card padding="none">
            <Empty
              size="sm"
              icon="calendar"
              title="No templates yet"
              description={canEdit ? 'Create your first template with New Template.' : undefined}
            />
          </Card>
        ) : (
          <div className="space-y-4">
            {groups.map(group => (
              <Card key={group.key}>
                <CardHeader title={group.label} />
                <ul className="divide-y divide-border">
                  {group.templates.map(t => (
                    <TemplateRow key={t.id} template={t} employees={employees} departments={departments} canEdit={canEdit} />
                  ))}
                </ul>
              </Card>
            ))}
          </div>
        )}
      </Section>

      {showNewForm && (
        <TemplateFormModal
          employees={employees}
          departments={departments}
          onSave={onNewSaved}
          onCancel={() => setShowNewForm(false)}
        />
      )}
    </PageLayout>
  );
}

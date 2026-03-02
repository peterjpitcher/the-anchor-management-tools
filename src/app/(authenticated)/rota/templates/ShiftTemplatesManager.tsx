'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, PencilIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Badge } from '@/components/ui-v2/display/Badge';
import { formatTime12Hour } from '@/lib/dateUtils';
import {
  createShiftTemplate,
  updateShiftTemplate,
  deactivateShiftTemplate,
  type ShiftTemplate,
} from '@/app/actions/rota-templates';
import type { RotaEmployee } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

interface ShiftTemplatesManagerProps {
  canEdit: boolean;
  initialTemplates: ShiftTemplate[];
  employees: RotaEmployee[];
  departments: Department[];
}

const DEPARTMENT_COLOURS: Record<string, string> = {
  bar: 'bg-blue-50 border-blue-200',
  kitchen: 'bg-orange-50 border-orange-200',
};

const DEPARTMENT_BADGE: Record<string, 'info' | 'warning'> = {
  bar: 'info',
  kitchen: 'warning',
};

function paidHours(start: string, end: string, breakMins: number): string {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (endM <= startM) endM += 24 * 60;
  const paid = Math.max(0, endM - startM - breakMins) / 60;
  return `${paid.toFixed(1)}h`;
}

function empName(emp: RotaEmployee): string {
  return [emp.first_name, emp.last_name].filter(Boolean).join(' ') || 'Unknown';
}

interface TemplateFormProps {
  initial?: ShiftTemplate;
  employees: RotaEmployee[];
  departments: Department[];
  onSave: (template: ShiftTemplate) => void;
  onCancel: () => void;
}

function TemplateForm({ initial, employees, departments, onSave, onCancel }: TemplateFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [startTime, setStartTime] = useState(initial?.start_time ?? '');
  const [endTime, setEndTime] = useState(initial?.end_time ?? '');
  const [breakMins, setBreakMins] = useState(initial?.unpaid_break_minutes?.toString() ?? '0');
  const [department, setDepartment] = useState<string>(initial?.department ?? departments[0]?.name ?? 'bar');
  const [colour, setColour] = useState(initial?.colour ?? '');
  const [dayOfWeek, setDayOfWeek] = useState<string>(
    initial?.day_of_week !== null && initial?.day_of_week !== undefined
      ? String(initial.day_of_week)
      : '',
  );
  const [employeeId, setEmployeeId] = useState<string>(initial?.employee_id ?? '');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

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
      colour: colour || undefined,
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

  return (
    <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
      <p className="text-sm font-medium text-gray-700">
        {initial ? 'Edit template' : 'New shift template'}
      </p>
      {error && <Alert variant="error">{error}</Alert>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="sm:col-span-2">
          <FormGroup label="Template name" htmlFor="tmpl-name" required>
            <Input
              id="tmpl-name"
              placeholder='e.g. "Saturday Evening Bar"'
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </FormGroup>
        </div>

        <FormGroup label="Department" htmlFor="tmpl-dept">
          <Select
            id="tmpl-dept"
            value={department}
            onChange={e => setDepartment(e.target.value)}
            options={departments.map(d => ({ value: d.name, label: d.label }))}
          />
        </FormGroup>

        <FormGroup label="Colour (optional)" htmlFor="tmpl-colour">
          <div className="flex gap-2 items-center">
            <Input
              id="tmpl-colour"
              type="color"
              value={colour || '#4f86c6'}
              onChange={e => setColour(e.target.value)}
              className="h-9 w-14 p-0.5 cursor-pointer"
            />
            <Button type="button" size="sm" variant="ghost" onClick={() => setColour('')}>Clear</Button>
          </div>
        </FormGroup>

        <FormGroup label="Start time" htmlFor="tmpl-start" required>
          <Input
            id="tmpl-start"
            type="time"
            value={startTime}
            onChange={e => setStartTime(e.target.value)}
          />
        </FormGroup>

        <FormGroup label="End time" htmlFor="tmpl-end" required>
          <Input
            id="tmpl-end"
            type="time"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
          />
        </FormGroup>

        <FormGroup label="Unpaid break (mins)" htmlFor="tmpl-break">
          <Input
            id="tmpl-break"
            type="number"
            min="0"
            max="120"
            value={breakMins}
            onChange={e => setBreakMins(e.target.value)}
          />
        </FormGroup>

        {startTime && endTime && (
          <div className="flex items-end pb-0.5">
            <p className="text-sm text-gray-600">
              Paid: <strong>{paidHours(startTime, endTime, parseInt(breakMins) || 0)}</strong>
            </p>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 border-t border-gray-200 pt-4">
        <div>
          <FormGroup label="Day of week (auto-schedule)" htmlFor="tmpl-day">
            <Select
              id="tmpl-day"
              value={dayOfWeek}
              onChange={e => setDayOfWeek(e.target.value)}
              options={[
                { value: '', label: 'No scheduled day' },
                ...DAYS.map((d, i) => ({ value: String(i), label: d })),
              ]}
            />
          </FormGroup>
          <p className="text-xs text-gray-400 mt-1">Auto-populates on this day when you click &ldquo;Apply templates&rdquo;.</p>
        </div>

        <div>
          <FormGroup label="Pre-assigned employee (optional)" htmlFor="tmpl-emp">
            <Select
              id="tmpl-emp"
              value={employeeId}
              onChange={e => setEmployeeId(e.target.value)}
              options={[
                { value: '', label: 'Open shift (no assignment)' },
                ...employees.map(e => ({ value: e.employee_id, label: empName(e) })),
              ]}
            />
          </FormGroup>
          <p className="text-xs text-gray-400 mt-1">Creates an assigned shift instead of an open one.</p>
        </div>
      </div>

      <div className="flex gap-2">
        <Button type="button" onClick={handleSubmit} disabled={isPending}>
          {isPending ? 'Saving…' : initial ? 'Save changes' : 'Create template'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  );
}

function TemplateRow({ template, employees, departments, canEdit }: { template: ShiftTemplate; employees: RotaEmployee[]; departments: Department[]; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [deactivating, startDeactivate] = useTransition();
  const [current, setCurrent] = useState(template);

  const handleDeactivate = () => {
    if (!confirm(`Deactivate "${current.name}"? It will no longer appear in the template palette.`)) return;
    startDeactivate(async () => {
      const result = await deactivateShiftTemplate(current.id);
      if (!result.success) { toast.error(result.error); return; }
      toast.success('Template deactivated');
    });
  };

  if (editing) {
    return (
      <TemplateForm
        initial={current}
        employees={employees}
        departments={departments}
        onSave={saved => { setCurrent(saved); setEditing(false); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const colourStyle = current.colour ? { borderLeftColor: current.colour, borderLeftWidth: 4 } : {};
  const assignedEmp = current.employee_id
    ? employees.find(e => e.employee_id === current.employee_id)
    : null;

  return (
    <div
      className={`flex items-center justify-between p-3 rounded-lg border ${DEPARTMENT_COLOURS[current.department]} transition-colors`}
      style={colourStyle}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className="min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{current.name}</p>
          <p className="text-xs text-gray-500">
            {formatTime12Hour(current.start_time)} – {formatTime12Hour(current.end_time)}
            {current.unpaid_break_minutes > 0 && ` · ${current.unpaid_break_minutes} min break`}
            {' · '}
            {paidHours(current.start_time, current.end_time, current.unpaid_break_minutes)} paid
          </p>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {current.day_of_week !== null && current.day_of_week !== undefined && (
              <span className="text-[10px] bg-violet-100 text-violet-700 px-1.5 py-0.5 rounded font-medium">
                {DAYS[current.day_of_week]}
              </span>
            )}
            {assignedEmp && (
              <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium">
                {empName(assignedEmp)}
              </span>
            )}
            {!assignedEmp && current.day_of_week !== null && (
              <span className="text-[10px] bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">
                Open shift
              </span>
            )}
          </div>
        </div>
      </div>
      <div className="flex items-center gap-2 ml-3 shrink-0">
        <Badge variant={DEPARTMENT_BADGE[current.department]} size="sm">{current.department}</Badge>
        {canEdit && (
          <>
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1 text-gray-400 hover:text-gray-700 rounded"
              title="Edit template"
            >
              <PencilIcon className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={handleDeactivate}
              disabled={deactivating}
              className="p-1 text-gray-400 hover:text-red-600 rounded disabled:opacity-50"
              title="Deactivate template"
            >
              <TrashIcon className="h-4 w-4" />
            </button>
          </>
        )}
      </div>
    </div>
  );
}

export default function ShiftTemplatesManager({ canEdit, initialTemplates, employees, departments }: ShiftTemplatesManagerProps) {
  const [templates, setTemplates] = useState(initialTemplates);
  const [showNewForm, setShowNewForm] = useState(false);

  const activeTemplates = templates.filter(t => t.is_active);

  const onNewSaved = (t: ShiftTemplate) => {
    setTemplates(prev => [...prev, t]);
    setShowNewForm(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Templates appear in the rota palette. Assign a day of the week so they auto-populate
          when you click &ldquo;Apply templates&rdquo; on the rota — open shifts unless an employee is pre-assigned.
        </p>
        {canEdit && (
          <Button
            type="button"
            size="sm"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setShowNewForm(v => !v)}
          >
            New template
          </Button>
        )}
      </div>

      {showNewForm && (
        <TemplateForm
          employees={employees}
          departments={departments}
          onSave={onNewSaved}
          onCancel={() => setShowNewForm(false)}
        />
      )}

      {activeTemplates.length === 0 && !showNewForm ? (
        <p className="text-sm text-gray-400 italic py-6 text-center">
          No templates yet. Create your first template above.
        </p>
      ) : (
        <div className="space-y-6">
          {departments.map(dept => {
            const deptTemplates = activeTemplates.filter(t => t.department === dept.name);
            if (deptTemplates.length === 0) return null;
            return (
              <div key={dept.name}>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{dept.label}</h3>
                <div className="space-y-2">
                  {deptTemplates.map(t => <TemplateRow key={t.id} template={t} employees={employees} departments={departments} canEdit={canEdit} />)}
                </div>
              </div>
            );
          })}
          {/* Templates for departments not in the departments list */}
          {(() => {
            const knownDepts = new Set(departments.map(d => d.name));
            const other = activeTemplates.filter(t => !knownDepts.has(t.department));
            if (other.length === 0) return null;
            return (
              <div>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Other</h3>
                <div className="space-y-2">
                  {other.map(t => <TemplateRow key={t.id} template={t} employees={employees} departments={departments} canEdit={canEdit} />)}
                </div>
              </div>
            );
          })()}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import {
  Alert,
  Button,
  Card,
  CardBody,
  CardFooter,
  ConfirmDialog,
  Empty,
  Field,
  FormFooter,
  Icon,
  IconButton,
  Input,
  PageLayout,
  Section,
  Segmented,
  toast,
} from '@/ds';
import { upsertDepartmentBudget, addDepartment, deleteDepartment, type DepartmentBudget, type Department } from '@/app/actions/budgets';
import { deriveBudgetTargets } from '@/lib/rota/budget-utils';

interface BudgetsManagerProps {
  canManage: boolean;
  initialBudgets: DepartmentBudget[];
  initialDepartments: Department[];
  currentYear: number;
  /** Set when the budgets or departments could not be loaded. */
  loadError?: string | null;
}

const layoutProps = {
  title: 'Department Budgets',
  subtitle: 'Annual payroll budgets per department',
  backButton: { label: 'Back to Settings', href: '/settings' },
};

function BudgetRow({
  department,
  label,
  budget,
  year,
  canManage,
  onDelete,
}: {
  department: string;
  label: string;
  budget: DepartmentBudget | undefined;
  year: number;
  canManage: boolean;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(budget?.annual_hours?.toString() ?? '');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();
  const [deletePending, startDelete] = useTransition();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const targets = budget ? deriveBudgetTargets(budget.annual_hours) : null;

  const handleSave = () => {
    const hours = parseFloat(value);
    if (!hours || hours <= 0) { setError('Enter a valid number of annual hours'); return; }
    setError('');

    startTransition(async () => {
      const result = await upsertDepartmentBudget({ department, budgetYear: year, annualHours: hours });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} budget saved`);
      setEditing(false);
    });
  };

  const handleDelete = () => {
    startDelete(async () => {
      const result = await deleteDepartment(department);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${label} department removed`);
      onDelete();
    });
  };

  return (
    <div className="py-5 sm:grid sm:grid-cols-4 sm:gap-4 sm:items-start">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="text-xs text-text-soft capitalize">{department} department</p>
        </div>
        {canManage && (
          <IconButton
            type="button"
            size="sm"
            onClick={() => setConfirmingDelete(true)}
            disabled={deletePending}
            label="Delete department"
            title="Delete department"
            icon={<Icon name="trash" size={16} />}
            className="shrink-0 text-text-subtle hover:text-danger"
          />
        )}
      </div>

      {editing ? (
        <div className="mt-2 sm:mt-0 sm:col-span-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Annual hours" htmlFor={`budget-${department}`} error={error || undefined} className="flex-1 max-w-xs">
              <Input
                id={`budget-${department}`}
                type="number"
                min="0"
                step="10"
                placeholder="e.g. 2000"
                value={value}
                onChange={e => setValue(e.target.value)}
              />
            </Field>
            <div className="flex gap-2 pb-0.5">
              <Button type="button" size="sm" variant="secondary" onClick={() => { setEditing(false); setError(''); }}>
                Cancel
              </Button>
              <Button type="button" size="sm" variant="primary" onClick={handleSave} disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <div className="mt-2 sm:mt-0 sm:col-span-3 flex flex-wrap items-start justify-between gap-4">
          {targets ? (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-text-muted">Annual</dt>
                <dd className="font-semibold text-text">{targets.annual.toFixed(0)}h</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Monthly target</dt>
                <dd className="font-medium text-text">{targets.monthly.toFixed(1)}h</dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Weekly target</dt>
                <dd className="font-medium text-text">{targets.weekly.toFixed(1)}h</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-text-soft italic">No budget set for {year}</p>
          )}
          {canManage && (
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditing(true)}>
              {budget ? 'Edit' : 'Set Budget'}
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onClose={() => setConfirmingDelete(false)}
        onConfirm={handleDelete}
        tone="danger"
        title="Delete Department"
        message={`Delete "${label}" department? This cannot be undone.`}
        confirmLabel="Delete"
      />
    </div>
  );
}

function AddDepartmentForm({
  onAdded,
  onCancel,
}: {
  onAdded: (dept: Department) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState('');
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleAdd = () => {
    const trimmed = label.trim();
    if (!trimmed) { setError('Enter a department name'); return; }
    const name = trimmed.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_-]/g, '');
    if (!name) { setError('Name must contain letters or numbers'); return; }
    setError('');

    startTransition(async () => {
      const result = await addDepartment({ name, label: trimmed });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${trimmed} department added`);
      setLabel('');
      onAdded(result.data);
    });
  };

  return (
    <div className="space-y-4">
      <Field
        label="New department name"
        htmlFor="new-dept"
        error={error || undefined}
        hint="The name will be used as-is in department dropdowns across the rota."
        className="max-w-xs"
      >
        <Input
          id="new-dept"
          placeholder='e.g. "Runner"'
          value={label}
          onChange={e => setLabel(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
        />
      </Field>
      <FormFooter>
        <Button type="button" variant="secondary" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="button" variant="primary" onClick={handleAdd} disabled={isPending} icon={<Icon name="plus" size={16} />}>
          {isPending ? 'Adding…' : 'Add Department'}
        </Button>
      </FormFooter>
    </div>
  );
}

export default function BudgetsManager({ canManage, initialBudgets, initialDepartments, currentYear, loadError = null }: BudgetsManagerProps) {
  const [year, setYear] = useState(currentYear);
  const [departments, setDepartments] = useState(initialDepartments);
  const [budgets, setBudgets] = useState(initialBudgets);
  const [showAddForm, setShowAddForm] = useState(false);

  const budgetsByDept = new Map(budgets.filter(b => b.budget_year === year).map(b => [b.department, b]));

  const years = Array.from(
    new Set([currentYear, currentYear + 1, ...budgets.map(b => b.budget_year)]),
  ).sort((a, b) => b - a);

  if (loadError) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Failed to load budgets">{loadError}</Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        <>
          <div role="group" aria-label="Budget year">
            <Segmented
              options={years.map(y => ({ id: String(y), label: String(y) }))}
              value={String(year)}
              onChange={id => setYear(Number(id))}
            />
          </div>
          {canManage && !showAddForm && (
            <Button
              type="button"
              variant="primary"
              size="sm"
              onClick={() => setShowAddForm(true)}
              icon={<Icon name="plus" size={16} />}
            >
              New Department
            </Button>
          )}
        </>
      }
    >
      <Section
        title="Annual Budgets"
        description="Set an annual payroll budget per department. Monthly and weekly targets are derived automatically."
      >
        <Card>
          {departments.length === 0 ? (
            <Empty size="sm" title="No departments yet" />
          ) : (
            <CardBody className="py-0">
              <div className="divide-y divide-border">
                {departments.map(({ name, label }) => (
                  <BudgetRow
                    key={name}
                    department={name}
                    label={label}
                    budget={budgetsByDept.get(name)}
                    year={year}
                    canManage={canManage}
                    onDelete={() => setDepartments(prev => prev.filter(d => d.name !== name))}
                  />
                ))}
              </div>
            </CardBody>
          )}

          {canManage && showAddForm && (
            <CardBody className="border-t border-border">
              <AddDepartmentForm
                onAdded={dept => {
                  setDepartments(prev => [...prev, dept]);
                  setShowAddForm(false);
                }}
                onCancel={() => setShowAddForm(false)}
              />
            </CardBody>
          )}

          <CardFooter>
            <p className="text-xs text-text-muted">
              Monthly target = annual ÷ 12. Weekly target = annual ÷ 52.
              These hour targets are used in the rota budget bar and the labour dashboard.
              Only hourly staff count toward scheduled hours; salaried staff are excluded.
            </p>
          </CardFooter>
        </Card>
      </Section>
    </PageLayout>
  );
}

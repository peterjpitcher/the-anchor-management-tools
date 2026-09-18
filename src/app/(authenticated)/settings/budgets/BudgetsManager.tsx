'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button, IconButton } from '@/ds';
import { cn } from '@/lib/utils';
import { Input } from '@/ds';
import { FormGroup } from '@/ds';
import { upsertDepartmentBudget, addDepartment, deleteDepartment, type DepartmentBudget, type Department } from '@/app/actions/budgets';
import { deriveBudgetTargets } from '@/lib/rota/budget-utils';

interface BudgetsManagerProps {
  canManage: boolean;
  initialBudgets: DepartmentBudget[];
  initialDepartments: Department[];
  currentYear: number;
}

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
    if (!confirm(`Delete "${label}" department? This cannot be undone.`)) return;
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
    <div className="py-5 sm:grid sm:grid-cols-4 sm:gap-4 sm:items-start border-b border-border last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-text">{label}</p>
          <p className="text-xs text-text-soft capitalize">{department} department</p>
        </div>
        {canManage && (
          <IconButton
            type="button"
            size="sm"
            onClick={handleDelete}
            disabled={deletePending}
            label="Delete department"
            title="Delete department"
            icon={<TrashIcon className="h-4 w-4" />}
            className="shrink-0 text-text-subtle hover:text-danger"
          />
        )}
      </div>

      {editing ? (
        <div className="mt-2 sm:mt-0 sm:col-span-3">
          {error && <p className="text-xs text-danger mb-2">{error}</p>}
          <div className="flex items-end gap-3">
            <FormGroup label="Annual hours" htmlFor={`budget-${department}`} className="flex-1 max-w-xs">
              <Input
                id={`budget-${department}`}
                type="number"
                min="0"
                step="10"
                placeholder="e.g. 2000"
                value={value}
                onChange={e => setValue(e.target.value)}
              />
            </FormGroup>
            <div className="flex gap-2 pb-0.5">
              <Button type="button" size="sm" onClick={handleSave} disabled={isPending}>
                {isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => { setEditing(false); setError(''); }}>
                Cancel
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
              {budget ? 'Edit' : 'Set budget'}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function AddDepartmentForm({ onAdded }: { onAdded: (dept: Department) => void }) {
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
    <div className="pt-4 border-t border-border">
      {error && <p className="text-xs text-danger mb-2">{error}</p>}
      <div className="flex items-end gap-3">
        <FormGroup label="New department name" htmlFor="new-dept" className="flex-1 max-w-xs">
          <Input
            id="new-dept"
            placeholder='e.g. "Runner"'
            value={label}
            onChange={e => setLabel(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') handleAdd(); }}
          />
        </FormGroup>
        <div className="pb-0.5">
          <Button type="button" size="sm" onClick={handleAdd} disabled={isPending} leftIcon={<PlusIcon className="h-4 w-4" />}>
            {isPending ? 'Adding…' : 'Add department'}
          </Button>
        </div>
      </div>
      <p className="text-xs text-text-soft mt-1">The name will be used as-is in department dropdowns across the rota.</p>
    </div>
  );
}

export default function BudgetsManager({ canManage, initialBudgets, initialDepartments, currentYear }: BudgetsManagerProps) {
  const [year, setYear] = useState(currentYear);
  const [departments, setDepartments] = useState(initialDepartments);
  const [budgets, setBudgets] = useState(initialBudgets);
  const [showAddForm, setShowAddForm] = useState(false);

  const budgetsByDept = new Map(budgets.filter(b => b.budget_year === year).map(b => [b.department, b]));

  const years = Array.from(
    new Set([currentYear, currentYear + 1, ...budgets.map(b => b.budget_year)]),
  ).sort((a, b) => b - a);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <p className="text-sm text-text-muted">Budget year:</p>
        <div className="flex gap-1">
          {years.map(y => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={cn(
                'px-3 py-1 rounded-sm text-sm font-medium transition-colors focus-visible:outline-hidden focus-visible:shadow-ring',
                y === year
                  ? 'bg-primary text-primary-fg'
                  : 'bg-surface-hover text-text hover:bg-border',
              )}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

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

      {canManage && (
        showAddForm ? (
          <AddDepartmentForm
            onAdded={dept => {
              setDepartments(prev => [...prev, dept]);
              setShowAddForm(false);
            }}
          />
        ) : (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowAddForm(true)}
            icon={<PlusIcon className="h-4 w-4" />}
            className="text-text-muted hover:text-text"
          >
            Add department
          </Button>
        )
      )}

      <div className="bg-surface-2 rounded-lg p-4">
        <p className="text-xs text-text-muted">
          Monthly target = annual ÷ 12. Weekly target = annual ÷ 52.
          These hour targets are used in the rota budget bar and the labour dashboard.
          Only hourly staff count toward scheduled hours — salaried staff are excluded.
        </p>
      </div>
    </div>
  );
}

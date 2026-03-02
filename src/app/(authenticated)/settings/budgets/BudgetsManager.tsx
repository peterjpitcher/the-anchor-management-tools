'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, TrashIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
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
    <div className="py-5 sm:grid sm:grid-cols-4 sm:gap-4 sm:items-start border-b border-gray-100 last:border-0">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-gray-900">{label}</p>
          <p className="text-xs text-gray-400 capitalize">{department} department</p>
        </div>
        {canManage && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={deletePending}
            className="p-1 text-gray-300 hover:text-red-500 rounded shrink-0"
            title="Delete department"
          >
            <TrashIcon className="h-4 w-4" />
          </button>
        )}
      </div>

      {editing ? (
        <div className="mt-2 sm:mt-0 sm:col-span-3">
          {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
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
        <div className="mt-2 sm:mt-0 sm:col-span-3 flex items-start justify-between gap-4">
          {targets ? (
            <dl className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <dt className="text-xs text-gray-500">Annual</dt>
                <dd className="font-semibold text-gray-900">{targets.annual.toFixed(0)}h</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Monthly target</dt>
                <dd className="font-medium text-gray-700">{targets.monthly.toFixed(1)}h</dd>
              </div>
              <div>
                <dt className="text-xs text-gray-500">Weekly target</dt>
                <dd className="font-medium text-gray-700">{targets.weekly.toFixed(1)}h</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-gray-400 italic">No budget set for {year}</p>
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
    <div className="pt-4 border-t border-gray-100">
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
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
      <p className="text-xs text-gray-400 mt-1">The name will be used as-is in department dropdowns across the rota.</p>
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
        <p className="text-sm text-gray-600">Budget year:</p>
        <div className="flex gap-1">
          {years.map(y => (
            <button
              key={y}
              type="button"
              onClick={() => setYear(y)}
              className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                y === year
                  ? 'bg-green-700 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-gray-100">
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
          <button
            type="button"
            onClick={() => setShowAddForm(true)}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
          >
            <PlusIcon className="h-4 w-4" />
            Add department
          </button>
        )
      )}

      <div className="bg-gray-50 rounded-lg p-4">
        <p className="text-xs text-gray-500">
          Monthly target = annual ÷ 12. Weekly target = annual ÷ 52.
          These hour targets are used in the rota budget bar and the labour dashboard.
          Only hourly staff count toward scheduled hours — salaried staff are excluded.
        </p>
      </div>
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Badge } from '@/components/ui-v2/display/Badge';
import {
  upsertEmployeePaySettings,
  addEmployeeRateOverride,
  type EmployeePaySettings,
  type EmployeeRateOverride,
} from '@/app/actions/pay-bands';

interface EmployeePayTabProps {
  employeeId: string;
  canEdit: boolean;
  initialPaySettings: EmployeePaySettings | null;
  initialOverrides: EmployeeRateOverride[];
  /** Current effective rate resolved by the pay calculator (for display). */
  currentRate: { rate: number; source: 'override' | 'age_band' } | null;
}

function formatRate(rate: number) {
  return `£${rate.toFixed(2)}/hr`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function EmployeePayTab({
  employeeId,
  canEdit,
  initialPaySettings,
  initialOverrides,
  currentRate,
}: EmployeePayTabProps) {
  // Pay settings state
  const [payType, setPayType] = useState<'hourly' | 'salaried'>(
    initialPaySettings?.pay_type ?? 'hourly',
  );
  const [maxHours, setMaxHours] = useState(
    initialPaySettings?.max_weekly_hours?.toString() ?? '',
  );
  const [settingsEditing, setSettingsEditing] = useState(false);
  const [settingsIsPending, startSettingsTransition] = useTransition();
  const [settingsError, setSettingsError] = useState('');

  // Override state
  const [showOverrideForm, setShowOverrideForm] = useState(false);
  const [overrideRate, setOverrideRate] = useState('');
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState('');
  const [overrideError, setOverrideError] = useState('');
  const [overrideIsPending, startOverrideTransition] = useTransition();

  const handleSaveSettings = () => {
    const maxH = maxHours ? parseFloat(maxHours) : null;
    if (maxH !== null && (isNaN(maxH) || maxH <= 0)) {
      setSettingsError('Enter a valid max weekly hours value');
      return;
    }
    setSettingsError('');

    startSettingsTransition(async () => {
      const result = await upsertEmployeePaySettings({
        employeeId,
        payType,
        maxWeeklyHours: maxH ?? undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Pay settings saved');
      setSettingsEditing(false);
    });
  };

  const handleAddOverride = () => {
    const rate = parseFloat(overrideRate);
    if (!rate || rate <= 0) { setOverrideError('Enter a valid hourly rate'); return; }
    if (!overrideEffectiveFrom) { setOverrideError('Choose an effective-from date'); return; }
    setOverrideError('');

    startOverrideTransition(async () => {
      const result = await addEmployeeRateOverride({
        employeeId,
        hourlyRate: rate,
        effectiveFrom: overrideEffectiveFrom,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Rate override added');
      setOverrideRate('');
      setOverrideEffectiveFrom('');
      setShowOverrideForm(false);
    });
  };

  return (
    <div className="space-y-6">
      {/* Pay settings header */}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-lg font-medium text-gray-900">Pay Settings</h3>
          <p className="mt-1 text-sm text-gray-600">
            Pay type, max weekly hours guideline, and individual rate overrides.
          </p>
        </div>
        {canEdit && !settingsEditing && (
          <Button type="button" size="sm" variant="secondary" onClick={() => setSettingsEditing(true)}>
            Edit
          </Button>
        )}
      </div>

      {/* Current rate banner */}
      {currentRate && (
        <div className="rounded-lg bg-green-50 border border-green-100 px-4 py-3 flex items-center justify-between">
          <div>
            <p className="text-xs text-green-700 font-medium uppercase tracking-wide">Current hourly rate</p>
            <p className="text-2xl font-bold text-green-800 mt-0.5">{formatRate(currentRate.rate)}</p>
          </div>
          <Badge variant="success" size="sm">
            {currentRate.source === 'override' ? 'Individual override' : 'Age band'}
          </Badge>
        </div>
      )}

      {payType === 'salaried' && !settingsEditing && (
        <div className="rounded-lg bg-gray-50 border border-gray-200 px-4 py-3">
          <p className="text-sm text-gray-600">
            This employee is <strong>salaried</strong>. They appear in the rota and timeclock but are excluded from hourly pay calculations and payroll exports.
          </p>
        </div>
      )}

      {/* Pay settings form / read view */}
      <dl className="sm:divide-y sm:divide-gray-200">
        <div className="py-3 sm:grid sm:grid-cols-4 sm:gap-4 sm:items-center">
          <dt className="text-sm font-medium text-gray-500">Pay type</dt>
          <dd className="mt-1 sm:mt-0 sm:col-span-3">
            {settingsEditing ? (
              <Select
                value={payType}
                onChange={e => setPayType(e.target.value as 'hourly' | 'salaried')}
                options={[
                  { value: 'hourly', label: 'Hourly' },
                  { value: 'salaried', label: 'Salaried' },
                ]}
                className="max-w-xs"
              />
            ) : (
              <span className="text-sm text-gray-900 capitalize">{payType}</span>
            )}
          </dd>
        </div>

        <div className="py-3 sm:grid sm:grid-cols-4 sm:gap-4 sm:items-center">
          <dt className="text-sm font-medium text-gray-500">Max weekly hours</dt>
          <dd className="mt-1 sm:mt-0 sm:col-span-3">
            {settingsEditing ? (
              <Input
                type="number"
                min="0"
                step="0.5"
                placeholder="e.g. 40"
                value={maxHours}
                onChange={e => setMaxHours(e.target.value)}
                className="max-w-xs"
              />
            ) : (
              <span className="text-sm text-gray-900">
                {initialPaySettings?.max_weekly_hours != null
                  ? `${initialPaySettings.max_weekly_hours} hrs/week`
                  : <span className="text-gray-400">Not set</span>}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {settingsEditing && (
        <div className="space-y-3">
          {settingsError && <Alert variant="error">{settingsError}</Alert>}
          <div className="flex gap-2">
            <Button type="button" onClick={handleSaveSettings} disabled={settingsIsPending}>
              {settingsIsPending ? 'Saving…' : 'Save settings'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                setSettingsEditing(false);
                setSettingsError('');
                setPayType(initialPaySettings?.pay_type ?? 'hourly');
                setMaxHours(initialPaySettings?.max_weekly_hours?.toString() ?? '');
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      {/* Rate overrides section (hourly only) */}
      {payType === 'hourly' && (
        <div className="pt-4 border-t border-gray-200">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h4 className="text-sm font-medium text-gray-900">Individual Rate Overrides</h4>
              <p className="text-xs text-gray-500 mt-0.5">
                Override the age-band rate for this employee. Append-only — historical rates are preserved.
              </p>
            </div>
            {canEdit && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                leftIcon={<PlusIcon className="h-3.5 w-3.5" />}
                onClick={() => setShowOverrideForm(v => !v)}
              >
                Add override
              </Button>
            )}
          </div>

          {showOverrideForm && canEdit && (
            <div className="mb-4 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
              <p className="text-xs font-medium text-gray-600">New effective-dated rate override</p>
              {overrideError && <p className="text-xs text-red-600">{overrideError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <FormGroup label="Hourly rate (£)" htmlFor="override-rate">
                  <Input
                    id="override-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 13.00"
                    value={overrideRate}
                    onChange={e => setOverrideRate(e.target.value)}
                  />
                </FormGroup>
                <FormGroup label="Effective from" htmlFor="override-eff">
                  <Input
                    id="override-eff"
                    type="date"
                    value={overrideEffectiveFrom}
                    onChange={e => setOverrideEffectiveFrom(e.target.value)}
                  />
                </FormGroup>
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={handleAddOverride} disabled={overrideIsPending}>
                  {overrideIsPending ? 'Saving…' : 'Save override'}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowOverrideForm(false)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {initialOverrides.length === 0 ? (
            <p className="text-sm text-gray-400 italic">No individual overrides set. Rate is calculated from age band.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-400 border-b border-gray-100">
                  <th className="text-left pb-1.5 font-medium">Rate</th>
                  <th className="text-left pb-1.5 font-medium">Effective from</th>
                  <th className="text-left pb-1.5 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {initialOverrides.map((ov) => {
                  const today = new Date().toISOString().slice(0, 10);
                  const isUpcoming = ov.effective_from > today;
                  const isCurrent = !isUpcoming && initialOverrides.find(o => o.effective_from <= today)?.id === ov.id;
                  return (
                    <tr key={ov.id} className="border-b border-gray-50">
                      <td className="py-2 font-medium text-gray-900">{formatRate(ov.hourly_rate)}</td>
                      <td className="py-2 text-gray-600">{formatDate(ov.effective_from)}</td>
                      <td className="py-2">
                        {isUpcoming
                          ? <Badge variant="warning" size="sm">Upcoming</Badge>
                          : isCurrent
                          ? <Badge variant="success" size="sm">Current</Badge>
                          : <span className="text-gray-400 text-xs">Historical</span>
                        }
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button } from '@/components/ui-v2/forms/Button';
import { Input } from '@/components/ui-v2/forms/Input';
import { Select } from '@/components/ui-v2/forms/Select';
import { FormGroup } from '@/components/ui-v2/forms/FormGroup';
import { Alert } from '@/components/ui-v2/feedback/Alert';
import { Badge } from '@/components/ui-v2/display/Badge';
import {
  createPayAgeBand,
  addPayBandRate,
  type PayAgeBand,
  type PayBandRate,
} from '@/app/actions/pay-bands';

interface PayBandsManagerProps {
  canManage: boolean;
  initialBands: PayAgeBand[];
  initialRates: Record<string, PayBandRate[]>; // keyed by band_id
}

function formatRate(rate: number) {
  return `£${rate.toFixed(2)}/hr`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

function RateHistory({ rates, bandId, canManage }: { rates: PayBandRate[]; bandId: string; canManage: boolean }) {
  const [showForm, setShowForm] = useState(false);
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState('');

  const handleAddRate = () => {
    const parsed = parseFloat(rate);
    if (!parsed || parsed <= 0) { setError('Enter a valid hourly rate'); return; }
    if (!effectiveFrom) { setError('Choose an effective-from date'); return; }
    setError('');

    startTransition(async () => {
      const result = await addPayBandRate({ bandId, hourlyRate: parsed, effectiveFrom });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Rate added');
      setRate('');
      setEffectiveFrom('');
      setShowForm(false);
    });
  };

  const today = new Date().toISOString().slice(0, 10);
  const current = rates.find(r => r.effective_from <= today) ?? null;

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">Rate History</p>
        {canManage && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            leftIcon={<PlusIcon className="h-3.5 w-3.5" />}
            onClick={() => setShowForm(v => !v)}
          >
            Add rate
          </Button>
        )}
      </div>

      {rates.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No rates set yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th className="text-left pb-1 font-medium">Rate</th>
              <th className="text-left pb-1 font-medium">Effective from</th>
              <th className="text-left pb-1 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {rates.map(r => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="py-1.5 font-medium text-gray-900">{formatRate(r.hourly_rate)}</td>
                <td className="py-1.5 text-gray-600">{formatDate(r.effective_from)}</td>
                <td className="py-1.5">
                  {r.effective_from > today ? (
                    <Badge variant="warning" size="sm">Upcoming</Badge>
                  ) : r.id === current?.id ? (
                    <Badge variant="success" size="sm">Current</Badge>
                  ) : (
                    <span className="text-gray-400 text-xs">Historical</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {showForm && canManage && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <p className="text-xs font-medium text-gray-600">Add new effective-dated rate</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="grid grid-cols-2 gap-3">
            <FormGroup label="Hourly rate (£)" htmlFor={`rate-${bandId}`}>
              <Input
                id={`rate-${bandId}`}
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 11.44"
                value={rate}
                onChange={e => setRate(e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Effective from" htmlFor={`eff-${bandId}`}>
              <Input
                id={`eff-${bandId}`}
                type="date"
                value={effectiveFrom}
                onChange={e => setEffectiveFrom(e.target.value)}
              />
            </FormGroup>
          </div>
          <div className="flex gap-2">
            <Button type="button" size="sm" onClick={handleAddRate} disabled={isPending}>
              {isPending ? 'Saving…' : 'Save rate'}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function BandCard({ band, rates, canManage }: { band: PayAgeBand; rates: PayBandRate[]; canManage: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const today = new Date().toISOString().slice(0, 10);
  const currentRate = rates.find(r => r.effective_from <= today) ?? null;

  return (
    <div className="border border-gray-200 rounded-lg bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {expanded
            ? <ChevronDownIcon className="h-4 w-4 text-gray-400" />
            : <ChevronRightIcon className="h-4 w-4 text-gray-400" />
          }
          <div>
            <p className="font-medium text-gray-900">{band.label}</p>
            <p className="text-xs text-gray-500">
              Age {band.min_age}{band.max_age != null ? `–${band.max_age}` : '+'}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {currentRate ? (
            <span className="text-sm font-semibold text-green-700">{formatRate(currentRate.hourly_rate)}</span>
          ) : (
            <span className="text-sm text-gray-400 italic">No rate set</span>
          )}
          {!band.is_active && <Badge variant="default" size="sm">Inactive</Badge>}
        </div>
      </button>

      {expanded && (
        <div className="px-4 pb-4">
          <RateHistory rates={rates} bandId={band.id} canManage={canManage} />
        </div>
      )}
    </div>
  );
}

export default function PayBandsManager({ canManage, initialBands, initialRates }: PayBandsManagerProps) {
  const [showNewBandForm, setShowNewBandForm] = useState(false);
  const [label, setLabel] = useState('');
  const [minAge, setMinAge] = useState('');
  const [maxAge, setMaxAge] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [formError, setFormError] = useState('');
  const [isPending, startTransition] = useTransition();

  const handleCreateBand = () => {
    if (!label.trim()) { setFormError('Band label is required'); return; }
    const min = parseInt(minAge);
    if (isNaN(min) || min < 0) { setFormError('Enter a valid minimum age'); return; }
    const max = maxAge ? parseInt(maxAge) : null;
    if (max !== null && max <= min) { setFormError('Maximum age must be greater than minimum age'); return; }
    setFormError('');

    startTransition(async () => {
      const result = await createPayAgeBand({
        label: label.trim(),
        minAge: min,
        maxAge: max ?? undefined,
        sortOrder: parseInt(sortOrder) || 0,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Age band created');
      setLabel('');
      setMinAge('');
      setMaxAge('');
      setSortOrder('0');
      setShowNewBandForm(false);
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-600">
          Define age bands aligned to national/living wage tiers. Add effective-dated rates as wages change each year.
          Rates are append-only — historical rates are preserved for payroll accuracy.
        </p>
        {canManage && (
          <Button
            type="button"
            size="sm"
            leftIcon={<PlusIcon className="h-4 w-4" />}
            onClick={() => setShowNewBandForm(v => !v)}
          >
            New band
          </Button>
        )}
      </div>

      {showNewBandForm && canManage && (
        <div className="p-4 bg-gray-50 rounded-lg border border-gray-200 space-y-4">
          <p className="text-sm font-medium text-gray-700">New age band</p>
          {formError && <Alert variant="error">{formError}</Alert>}
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div className="sm:col-span-2">
              <FormGroup label="Band label" htmlFor="band-label" required>
                <Input
                  id="band-label"
                  placeholder='e.g. "Under 18" or "23+"'
                  value={label}
                  onChange={e => setLabel(e.target.value)}
                />
              </FormGroup>
            </div>
            <FormGroup label="Min age" htmlFor="band-min">
              <Input
                id="band-min"
                type="number"
                min="0"
                max="100"
                placeholder="e.g. 0"
                value={minAge}
                onChange={e => setMinAge(e.target.value)}
              />
            </FormGroup>
            <FormGroup label="Max age (blank = no limit)" htmlFor="band-max">
              <Input
                id="band-max"
                type="number"
                min="1"
                max="100"
                placeholder="e.g. 17"
                value={maxAge}
                onChange={e => setMaxAge(e.target.value)}
              />
            </FormGroup>
          </div>
          <div className="flex gap-2">
            <Button type="button" onClick={handleCreateBand} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create band'}
            </Button>
            <Button type="button" variant="ghost" onClick={() => { setShowNewBandForm(false); setFormError(''); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {initialBands.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          No age bands configured yet. Create your first band above.
        </p>
      ) : (
        <div className="space-y-2">
          {initialBands.map(band => (
            <BandCard
              key={band.id}
              band={band}
              rates={initialRates[band.id] ?? []}
              canManage={canManage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

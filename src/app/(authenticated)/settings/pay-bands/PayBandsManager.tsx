'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { PlusIcon, ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/24/outline';
import { Button } from '@/ds';
import { Input } from '@/ds';
import { Select } from '@/ds';
import { FormGroup } from '@/ds';
import { Alert } from '@/ds';
import { Badge } from '@/ds';
import {
  createPayAgeBand,
  addPayBandRate,
  updatePayAgeBand,
  updatePayBandRate,
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

function RateHistory({
  rates,
  bandId,
  canManage,
  onRateUpdated,
}: {
  rates: PayBandRate[];
  bandId: string;
  canManage: boolean;
  onRateUpdated: (rate: PayBandRate) => void;
}) {
  const [showForm, setShowForm] = useState(false);
  const [rate, setRate] = useState('');
  const [effectiveFrom, setEffectiveFrom] = useState('');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [editRate, setEditRate] = useState('');
  const [editEffectiveFrom, setEditEffectiveFrom] = useState('');
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
      onRateUpdated(result.data);
      setRate('');
      setEffectiveFrom('');
      setShowForm(false);
    });
  };

  const startEditRate = (rateRow: PayBandRate) => {
    setEditingRateId(rateRow.id);
    setEditRate(String(rateRow.hourly_rate));
    setEditEffectiveFrom(rateRow.effective_from);
    setError('');
  };

  const handleUpdateRate = () => {
    if (!editingRateId) return;
    const parsed = parseFloat(editRate);
    if (!parsed || parsed <= 0) { setError('Enter a valid hourly rate'); return; }
    if (!editEffectiveFrom) { setError('Choose an effective-from date'); return; }
    setError('');

    startTransition(async () => {
      const result = await updatePayBandRate({
        id: editingRateId,
        hourlyRate: parsed,
        effectiveFrom: editEffectiveFrom,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Rate updated');
      onRateUpdated(result.data);
      setEditingRateId(null);
      setEditRate('');
      setEditEffectiveFrom('');
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
        <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-400 border-b border-gray-100">
              <th scope="col" className="text-left pb-1 font-medium">Rate</th>
              <th scope="col" className="text-left pb-1 font-medium">Effective from</th>
              <th scope="col" className="text-left pb-1 font-medium">Status</th>
              {canManage && <th scope="col" className="text-right pb-1 font-medium">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {rates.map(r => (
              <tr key={r.id} className="border-b border-gray-50">
                <td className="py-1.5 font-medium text-gray-900">
                  {editingRateId === r.id ? (
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={editRate}
                      onChange={e => setEditRate(e.target.value)}
                    />
                  ) : formatRate(r.hourly_rate)}
                </td>
                <td className="py-1.5 text-gray-600">
                  {editingRateId === r.id ? (
                    <Input
                      type="date"
                      value={editEffectiveFrom}
                      onChange={e => setEditEffectiveFrom(e.target.value)}
                    />
                  ) : formatDate(r.effective_from)}
                </td>
                <td className="py-1.5">
                  {r.effective_from > today ? (
                    <Badge variant="warning" size="sm">Upcoming</Badge>
                  ) : r.id === current?.id ? (
                    <Badge variant="success" size="sm">Current</Badge>
                  ) : (
                    <span className="text-gray-400 text-xs">Historical</span>
                  )}
                </td>
                {canManage && (
                  <td className="py-1.5 text-right">
                    {editingRateId === r.id ? (
                      <div className="flex justify-end gap-2">
                        <Button type="button" size="sm" onClick={handleUpdateRate} disabled={isPending}>
                          Save
                        </Button>
                        <Button type="button" size="sm" variant="ghost" onClick={() => setEditingRateId(null)}>
                          Cancel
                        </Button>
                      </div>
                    ) : r.effective_from > today ? (
                      <Button type="button" size="sm" variant="ghost" onClick={() => startEditRate(r)}>
                        Edit
                      </Button>
                    ) : null}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      )}

      {showForm && canManage && (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200 space-y-3">
          <p className="text-xs font-medium text-gray-600">Add new effective-dated rate</p>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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

function BandCard({
  band,
  rates,
  canManage,
  onBandUpdated,
  onRateUpdated,
}: {
  band: PayAgeBand;
  rates: PayBandRate[];
  canManage: boolean;
  onBandUpdated: (band: PayAgeBand) => void;
  onRateUpdated: (bandId: string, rate: PayBandRate) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editingBand, setEditingBand] = useState(false);
  const [editLabel, setEditLabel] = useState(band.label);
  const [editMinAge, setEditMinAge] = useState(String(band.min_age));
  const [editMaxAge, setEditMaxAge] = useState(band.max_age == null ? '' : String(band.max_age));
  const [editSortOrder, setEditSortOrder] = useState(String(band.sort_order));
  const [editError, setEditError] = useState('');
  const [isPending, startTransition] = useTransition();
  const today = new Date().toISOString().slice(0, 10);
  const currentRate = rates.find(r => r.effective_from <= today) ?? null;

  const saveBand = (isActive = band.is_active) => {
    if (!editLabel.trim()) { setEditError('Band label is required'); return; }
    const min = parseInt(editMinAge);
    if (isNaN(min) || min < 0) { setEditError('Enter a valid minimum age'); return; }
    const max = editMaxAge ? parseInt(editMaxAge) : null;
    if (max !== null && max <= min) { setEditError('Maximum age must be greater than minimum age'); return; }
    setEditError('');

    startTransition(async () => {
      const result = await updatePayAgeBand({
        id: band.id,
        label: editLabel.trim(),
        minAge: min,
        maxAge: max ?? undefined,
        sortOrder: parseInt(editSortOrder) || 0,
        isActive,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(isActive ? 'Band updated' : 'Band deactivated');
      onBandUpdated(result.data);
      setEditingBand(false);
    });
  };

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
          {canManage && (
            <div className="mb-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
              {editingBand ? (
                <div className="space-y-3">
                  {editError && <p className="text-xs text-red-600">{editError}</p>}
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                    <Input label="Label" value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                    <Input label="Min age" type="number" min="0" max="100" value={editMinAge} onChange={e => setEditMinAge(e.target.value)} />
                    <Input label="Max age" type="number" min="1" max="100" value={editMaxAge} onChange={e => setEditMaxAge(e.target.value)} />
                    <Input label="Sort" type="number" min="0" value={editSortOrder} onChange={e => setEditSortOrder(e.target.value)} />
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" onClick={() => saveBand()} disabled={isPending}>
                      Save band
                    </Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setEditingBand(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" variant="secondary" onClick={() => setEditingBand(true)}>
                    Edit band
                  </Button>
                  {band.is_active ? (
                    <Button type="button" size="sm" variant="ghost" onClick={() => saveBand(false)} disabled={isPending}>
                      Deactivate
                    </Button>
                  ) : (
                    <Button type="button" size="sm" variant="ghost" onClick={() => saveBand(true)} disabled={isPending}>
                      Reactivate
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
          <RateHistory
            rates={rates}
            bandId={band.id}
            canManage={canManage}
            onRateUpdated={(rate) => onRateUpdated(band.id, rate)}
          />
        </div>
      )}
    </div>
  );
}

export default function PayBandsManager({ canManage, initialBands, initialRates }: PayBandsManagerProps) {
  const [bands, setBands] = useState(initialBands);
  const [ratesByBand, setRatesByBand] = useState(initialRates);
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
      setBands(prev => [...prev, result.data].sort((a, b) => (a.sort_order - b.sort_order) || (a.min_age - b.min_age)));
      setLabel('');
      setMinAge('');
      setMaxAge('');
      setSortOrder('0');
      setShowNewBandForm(false);
    });
  };

  const handleBandUpdated = (updatedBand: PayAgeBand) => {
    setBands(prev =>
      prev
        .map(band => band.id === updatedBand.id ? updatedBand : band)
        .sort((a, b) => (a.sort_order - b.sort_order) || (a.min_age - b.min_age))
    );
  };

  const handleRateUpdated = (bandId: string, updatedRate: PayBandRate) => {
    setRatesByBand(prev => {
      const existing = prev[bandId] ?? [];
      const next = existing.some(rate => rate.id === updatedRate.id)
        ? existing.map(rate => rate.id === updatedRate.id ? updatedRate : rate)
        : [updatedRate, ...existing];
      return {
        ...prev,
        [bandId]: next.sort((a, b) => b.effective_from.localeCompare(a.effective_from)),
      };
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
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

      {bands.length === 0 ? (
        <p className="text-sm text-gray-400 italic py-4 text-center">
          No age bands configured yet. Create your first band above.
        </p>
      ) : (
        <div className="space-y-2">
          {bands.map(band => (
            <BandCard
              key={band.id}
              band={band}
              rates={ratesByBand[band.id] ?? []}
              canManage={canManage}
              onBandUpdated={handleBandUpdated}
              onRateUpdated={handleRateUpdated}
            />
          ))}
        </div>
      )}
    </div>
  );
}

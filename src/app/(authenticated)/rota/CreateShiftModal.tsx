'use client';

import { useState, useTransition } from 'react';
import toast from 'react-hot-toast';
import { XMarkIcon } from '@heroicons/react/24/outline';
import { Button } from '@/ds';
import { Input } from '@/ds';
import { Select } from '@/ds';
import { FormGroup } from '@/ds';
import { Alert } from '@/ds';
import { createShift } from '@/app/actions/rota';
import type { RotaShift } from '@/app/actions/rota';
import type { Department } from '@/app/actions/budgets';

interface CreateShiftModalProps {
  weekId: string;
  employeeId: string;
  employeeName: string;
  shiftDate: string;
  departments: Department[];
  onClose: () => void;
  onCreated: (shift: RotaShift) => void;
}

function paidHoursNum(start: string, end: string, breakMins: number, overnight: boolean): number {
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const startM = sh * 60 + sm;
  let endM = eh * 60 + em;
  if (overnight || endM <= startM) endM += 24 * 60;
  return Math.max(0, endM - startM - breakMins) / 60;
}

function formatDate(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long',
  });
}

export default function CreateShiftModal({
  weekId,
  employeeId,
  employeeName,
  shiftDate,
  departments,
  onClose,
  onCreated,
}: CreateShiftModalProps) {
  const [name, setName] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [breakMins, setBreakMins] = useState('0');
  const [department, setDepartment] = useState<string>(departments[0]?.name ?? 'bar');
  const [overnight, setOvernight] = useState(false);
  const [notes, setNotes] = useState('');
  const premium = usePremiumControl();
  const [error, setError] = useState('');
  const [isPending, startTransition] = useTransition();

  const isOpenShift = employeeId === '__open__';

  const handleSubmit = () => {
    if (!startTime || !endTime) { setError('Start and end time are required'); return; }
    const premiumFields = premium.toFields();
    if (!premiumFields.ok) { setError(premiumFields.error); return; }
    setError('');
    startTransition(async () => {
      const result = await createShift(
        isOpenShift
          ? { weekId, isOpenShift: true, name: name || null, shiftDate, startTime, endTime, unpaidBreakMinutes: parseInt(breakMins) || 0, department, isOvernight: overnight, notes: notes || null, ...premiumFields.values }
          : { weekId, isOpenShift: false, employeeId, name: name || null, shiftDate, startTime, endTime, unpaidBreakMinutes: parseInt(breakMins) || 0, department, isOvernight: overnight, notes: notes || null, ...premiumFields.values },
      );
      if (!result.success) { toast.error(result.error); return; }
      onCreated(result.data);
    });
  };
  // usePremiumControl + PremiumControl are defined at the bottom of this file
  // (kept co-located here and mirrored in ShiftDetailModal to respect the
  // rota write-path ownership boundary — no shared component file added).

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50" onClick={onClose}>
      <div
        className="bg-white rounded-xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between p-5 border-b border-gray-200">
          <div>
            <p className="text-sm text-gray-500">{formatDate(shiftDate)}</p>
            <p className="text-lg font-semibold text-gray-900 mt-0.5">{employeeName}</p>
          </div>
          <button type="button" onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600 rounded">
            <XMarkIcon className="h-5 w-5" />
          </button>
        </div>

        <div className="p-5 space-y-3">
          {error && <Alert variant="error">{error}</Alert>}

          <FormGroup label="Shift name (optional)" htmlFor="cs-name">
            <Input
              id="cs-name"
              placeholder='e.g. "Evening Bar"'
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </FormGroup>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <FormGroup label="Start time" htmlFor="cs-start" required>
              <Input id="cs-start" type="time" value={startTime} onChange={e => setStartTime(e.target.value)} />
            </FormGroup>
            <FormGroup label="End time" htmlFor="cs-end" required>
              <Input id="cs-end" type="time" value={endTime} onChange={e => setEndTime(e.target.value)} />
            </FormGroup>
            <FormGroup label="Break (mins)" htmlFor="cs-break">
              <Input id="cs-break" type="number" min="0" max="120" value={breakMins} onChange={e => setBreakMins(e.target.value)} />
            </FormGroup>
            <FormGroup label="Department" htmlFor="cs-dept">
              <Select
                id="cs-dept"
                value={department}
                onChange={e => setDepartment(e.target.value)}
                options={departments.map(d => ({ value: d.name, label: d.label }))}
              />
            </FormGroup>
          </div>

          <div className="flex items-center gap-2 text-sm">
            <input
              id="cs-overnight"
              type="checkbox"
              checked={overnight}
              onChange={e => setOvernight(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <label htmlFor="cs-overnight" className="text-gray-700">Overnight shift</label>
          </div>

          <PremiumControl state={premium} idPrefix="cs" />

          <FormGroup label="Notes (optional)" htmlFor="cs-notes">
            <Input
              id="cs-notes"
              placeholder="Optional notes"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </FormGroup>

          {startTime && endTime && (
            <p className="text-sm text-gray-600">
              Paid: <strong>{paidHoursNum(startTime, endTime, parseInt(breakMins) || 0, overnight).toFixed(1)}h</strong>
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <Button type="button" onClick={handleSubmit} disabled={isPending}>
              {isPending ? 'Creating…' : 'Create shift'}
            </Button>
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Premium-rate control (shared with ShiftDetailModal)
//
// Kept co-located here rather than in a separate component file so the rota
// write-path change stays inside its ownership boundary. ShiftDetailModal holds
// a byte-identical copy; keep the two in sync.
// ---------------------------------------------------------------------------

export interface PremiumFieldValues {
  rateMultiplier: number | null;
  rateOverride: number | null;
  premiumReason: string | null;
  premiumStartTime: string | null;
  premiumEndTime: string | null;
}

export type PremiumMode = 'none' | '1.5' | '2' | 'custom';

export interface PremiumControlState {
  mode: PremiumMode;
  setMode: (mode: PremiumMode) => void;
  customRate: string;
  setCustomRate: (value: string) => void;
  reason: string;
  setReason: (value: string) => void;
  useWindow: boolean;
  setUseWindow: (value: boolean) => void;
  windowStart: string;
  setWindowStart: (value: string) => void;
  windowEnd: string;
  setWindowEnd: (value: string) => void;
  toFields: () => PremiumToFieldsResult;
}

export type PremiumToFieldsResult =
  | { ok: true; values: PremiumFieldValues; error?: undefined }
  | { ok: false; values?: undefined; error: string };

const RATE_OPTIONS: Array<{ value: PremiumMode; label: string }> = [
  { value: 'none', label: 'Standard rate' },
  { value: '1.5', label: 'Time and a half (×1.5)' },
  { value: '2', label: 'Double time (×2.0)' },
  { value: 'custom', label: 'Custom rate…' },
];

export function initialPremiumMode(rateMultiplier: number | null, rateOverride: number | null): PremiumMode {
  if (rateOverride != null) return 'custom';
  if (rateMultiplier == null) return 'none';
  // `numeric` DB columns arrive as STRINGS, so "1.50" === 1.5 is false. Coerce
  // before comparing so a ×1.5 / ×2 shift seeds the matching preset instead of
  // mis-opening as 'Custom' with a blank rate.
  const multiplier = Number(rateMultiplier);
  if (multiplier === 1.5) return '1.5';
  if (multiplier === 2) return '2';
  return 'custom';
}

export function usePremiumControl(initial?: Partial<PremiumFieldValues>): PremiumControlState {
  const startMultiplier = initial?.rateMultiplier ?? null;
  const startOverride = initial?.rateOverride ?? null;
  const [mode, setMode] = useState<PremiumMode>(initialPremiumMode(startMultiplier, startOverride));
  // `startOverride` may arrive as a numeric STRING from the DB; coerce through
  // Number so the custom-rate box shows a clean value (e.g. "18.5", not "18.500").
  const [customRate, setCustomRate] = useState<string>(startOverride != null ? String(Number(startOverride)) : '');
  const [reason, setReason] = useState<string>(initial?.premiumReason ?? '');
  const [useWindow, setUseWindow] = useState<boolean>(Boolean(initial?.premiumStartTime || initial?.premiumEndTime));
  const [windowStart, setWindowStart] = useState<string>((initial?.premiumStartTime ?? '').slice(0, 5));
  const [windowEnd, setWindowEnd] = useState<string>((initial?.premiumEndTime ?? '').slice(0, 5));

  const toFields: PremiumControlState['toFields'] = () => {
    if (mode === 'none') {
      return { ok: true, values: { rateMultiplier: null, rateOverride: null, premiumReason: null, premiumStartTime: null, premiumEndTime: null } };
    }

    let rateMultiplier: number | null = null;
    let rateOverride: number | null = null;
    if (mode === '1.5') rateMultiplier = 1.5;
    else if (mode === '2') rateMultiplier = 2;
    else {
      const parsed = Number(customRate);
      if (!customRate.trim() || Number.isNaN(parsed) || parsed <= 0) {
        return { ok: false, error: 'Enter a custom rate greater than £0' };
      }
      rateOverride = Math.round(parsed * 100) / 100;
    }

    let premiumStartTime: string | null = null;
    let premiumEndTime: string | null = null;
    if (useWindow) {
      if (!windowStart || !windowEnd) {
        return { ok: false, error: 'Enter both a premium start and end time, or turn the window off' };
      }
      premiumStartTime = windowStart;
      premiumEndTime = windowEnd;
    }

    return {
      ok: true,
      values: { rateMultiplier, rateOverride, premiumReason: reason.trim() || null, premiumStartTime, premiumEndTime },
    };
  };

  return {
    mode, setMode,
    customRate, setCustomRate,
    reason, setReason,
    useWindow, setUseWindow,
    windowStart, setWindowStart,
    windowEnd, setWindowEnd,
    toFields,
  };
}

interface PremiumControlProps {
  state: PremiumControlState;
  idPrefix: string;
}

/**
 * A calm, subtle premium-rate control: a rate select, a custom £/hr input when
 * "Custom" is chosen, an optional reason, and an optional "applies from–to"
 * window (default = whole shift). No warning blocks — house style.
 */
export function PremiumControl({ state, idPrefix }: PremiumControlProps) {
  const showPremiumDetail = state.mode !== 'none';

  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-3">
      <FormGroup label="Pay rate" htmlFor={`${idPrefix}-rate`}>
        <Select
          id={`${idPrefix}-rate`}
          value={state.mode}
          onChange={e => state.setMode(e.target.value as PremiumMode)}
          options={RATE_OPTIONS}
        />
      </FormGroup>

      {state.mode === 'custom' && (
        <FormGroup label="Custom rate (£/hr)" htmlFor={`${idPrefix}-custom`}>
          <Input
            id={`${idPrefix}-custom`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            placeholder="e.g. 18.50"
            value={state.customRate}
            onChange={e => state.setCustomRate(e.target.value)}
          />
        </FormGroup>
      )}

      {showPremiumDetail && (
        <>
          <FormGroup label="Reason (optional)" htmlFor={`${idPrefix}-reason`}>
            <Input
              id={`${idPrefix}-reason`}
              placeholder='e.g. "Bank holiday"'
              value={state.reason}
              onChange={e => state.setReason(e.target.value)}
            />
          </FormGroup>

          <div className="flex items-center gap-2 text-sm">
            <input
              id={`${idPrefix}-window`}
              type="checkbox"
              checked={state.useWindow}
              onChange={e => state.setUseWindow(e.target.checked)}
              className="rounded border-gray-300 text-blue-600"
            />
            <label htmlFor={`${idPrefix}-window`} className="text-gray-700">Applies to part of the shift only</label>
          </div>

          {state.useWindow && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <FormGroup label="From" htmlFor={`${idPrefix}-win-start`}>
                <Input id={`${idPrefix}-win-start`} type="time" value={state.windowStart} onChange={e => state.setWindowStart(e.target.value)} />
              </FormGroup>
              <FormGroup label="To" htmlFor={`${idPrefix}-win-end`}>
                <Input id={`${idPrefix}-win-end`} type="time" value={state.windowEnd} onChange={e => state.setWindowEnd(e.target.value)} />
              </FormGroup>
            </div>
          )}
        </>
      )}
    </div>
  );
}

'use client';

import { useMemo, useRef, useState } from 'react';
import { Alert, Button, Checkbox, FormGroup, Input, Select } from '@/ds';
import { saveOnboardingTimeOff } from '@/app/actions/employeeInvite';
import {
  getTimeOffDateBounds,
  MAX_BLOCKS,
  MAX_NOTE_LENGTH,
  type TimeOffAnswer,
} from '@/lib/leave/onboarding-time-off';

type BlockRow = {
  key: string;
  startDate: string;
  endDate: string;
  leaveType: string;
  note: string;
};

interface TimeOffStepProps {
  token: string;
  initialAnswer: TimeOffAnswer | null;
  initialBlocks: Array<{ startDate: string; endDate: string; leaveType: string; note: string }>;
  initialSubmissionVersion: number;
  onSuccess: () => void;
}

const LEAVE_TYPE_OPTIONS = [
  { value: 'holiday', label: 'Holiday' },
  { value: 'unavailable', label: 'Cannot work (not holiday)' },
];

let rowCounter = 0;
function emptyRow(): BlockRow {
  rowCounter += 1;
  return { key: `row-${rowCounter}`, startDate: '', endDate: '', leaveType: 'holiday', note: '' };
}

export default function TimeOffStep({
  token,
  initialAnswer,
  initialBlocks,
  initialSubmissionVersion,
  onSuccess,
}: TimeOffStepProps) {
  const { minDate, maxDate } = useMemo(() => getTimeOffDateBounds(), []);

  const [nothingBooked, setNothingBooked] = useState(initialAnswer === 'none');
  const [rows, setRows] = useState<BlockRow[]>(
    initialBlocks.length > 0
      ? initialBlocks.map(block => ({ ...emptyRow(), ...block }))
      : [emptyRow()],
  );
  const [error, setError] = useState('');
  const [errorRow, setErrorRow] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);
  const errorRef = useRef<HTMLDivElement | null>(null);

  const updateRow = (index: number, patch: Partial<BlockRow>) => {
    setRows(prev => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const addRow = () => setRows(prev => (prev.length >= MAX_BLOCKS ? prev : [...prev, emptyRow()]));
  const removeRow = (index: number) =>
    setRows(prev => (prev.length === 1 ? [emptyRow()] : prev.filter((_, i) => i !== index)));

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setErrorRow(null);

    const answer: TimeOffAnswer = nothingBooked ? 'none' : 'has_dates';
    const filled = rows.filter(row => row.startDate || row.endDate);

    if (answer === 'has_dates' && filled.length === 0) {
      setError('Add at least one set of dates, or tick "I have nothing booked".');
      errorRef.current?.focus();
      return;
    }

    setLoading(true);
    try {
      const result = await saveOnboardingTimeOff(
        token,
        answer,
        filled.map(row => ({
          startDate: row.startDate,
          endDate: row.endDate,
          leaveType: row.leaveType,
          note: row.note || null,
        })),
        // A changed answer is a new version. Re-sending the same one is treated as a retry.
        initialSubmissionVersion + 1,
      );

      if (result.success) {
        onSuccess();
      } else {
        setError(result.error);
        setErrorRow(typeof result.blockIndex === 'number' ? result.blockIndex : null);
        errorRef.current?.focus();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Could not save these dates. Please try again.');
      errorRef.current?.focus();
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <p className="text-sm text-text-muted">
        If you have already booked a holiday, or there are dates you know you cannot work, tell us now
        and we will put them straight into the rota. It is much easier to plan around them now than
        later.
      </p>

      {/* Focusable so validation can move the user straight to the problem. */}
      <div ref={errorRef} tabIndex={-1} aria-live="polite">
        {error && <Alert variant="error">{error}</Alert>}
      </div>

      <Checkbox
        checked={nothingBooked}
        onChange={setNothingBooked}
        label="I have nothing booked"
      />

      {/* Rows keep their values while disabled, so unticking restores what was typed. */}
      <div className={nothingBooked ? 'pointer-events-none opacity-50' : undefined}>
        <div className="space-y-4">
          {rows.map((row, index) => (
            <fieldset
              key={row.key}
              disabled={nothingBooked}
              className={`rounded-lg border p-4 ${errorRow === index ? 'border-danger' : 'border-border'}`}
            >
              <legend className="px-1 text-sm font-medium text-text-strong">
                Dates {index + 1}
              </legend>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormGroup label="First day" htmlFor={`${row.key}-start`} required>
                  <Input
                    id={`${row.key}-start`}
                    type="date"
                    min={minDate}
                    max={maxDate}
                    value={row.startDate}
                    onChange={e => updateRow(index, { startDate: e.target.value })}
                  />
                </FormGroup>
                <FormGroup label="Last day" htmlFor={`${row.key}-end`} required>
                  <Input
                    id={`${row.key}-end`}
                    type="date"
                    min={row.startDate || minDate}
                    max={maxDate}
                    value={row.endDate}
                    onChange={e => updateRow(index, { endDate: e.target.value })}
                  />
                </FormGroup>
                <FormGroup label="What is it?" htmlFor={`${row.key}-type`}>
                  <Select
                    id={`${row.key}-type`}
                    value={row.leaveType}
                    onChange={e => updateRow(index, { leaveType: e.target.value })}
                    options={LEAVE_TYPE_OPTIONS}
                  />
                </FormGroup>
                <FormGroup
                  label="Note (optional)"
                  htmlFor={`${row.key}-note`}
                  help="Please do not include medical details."
                >
                  <Input
                    id={`${row.key}-note`}
                    maxLength={MAX_NOTE_LENGTH}
                    placeholder="e.g. Wedding"
                    value={row.note}
                    onChange={e => updateRow(index, { note: e.target.value })}
                  />
                </FormGroup>
              </div>

              {rows.length > 1 && (
                <div className="mt-3">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeRow(index)}>
                    Remove these dates
                  </Button>
                </div>
              )}
            </fieldset>
          ))}
        </div>

        {rows.length < MAX_BLOCKS && (
          <div className="mt-3">
            <Button type="button" variant="secondary" size="sm" onClick={addRow} disabled={nothingBooked}>
              Add more dates
            </Button>
          </div>
        )}
      </div>

      <Button type="submit" variant="primary" className="w-full" loading={loading}>
        Save and continue
      </Button>
    </form>
  );
}

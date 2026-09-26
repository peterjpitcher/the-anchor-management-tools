'use client';

import { useState, useTransition } from 'react';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  DescriptionList,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  Select,
  Stat,
  SubHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds';
import { RATE_OVERRIDE_TONES, type RateOverrideState } from '@/app/(authenticated)/employees/_shared/status-ui';
import {
  upsertEmployeePaySettings,
  addEmployeeRateOverride,
  updateEmployeeRateOverride,
  type EmployeePaySettings,
  type EmployeeRateOverride,
} from '@/app/actions/pay-bands';
import { formatDateInLondon, getTodayIsoDate } from '@/lib/dateUtils';

interface EmployeePayTabProps {
  employeeId: string;
  canEdit: boolean;
  initialPaySettings: EmployeePaySettings | null;
  initialOverrides: EmployeeRateOverride[];
  /** Current effective rate resolved by the pay calculator (for display). */
  currentRate: { rate: number; source: 'override' | 'age_band' } | null;
  /** Why the pay settings or rate overrides could not be loaded. The tab then says so. */
  loadError?: string | null;
}

function formatRate(rate: number) {
  return `£${rate.toFixed(2)}/hr`;
}

function formatDate(iso: string) {
  return formatDateInLondon(iso, { day: 'numeric', month: 'short', year: 'numeric' });
}

const RATE_OVERRIDE_LABELS: Record<RateOverrideState, string> = {
  upcoming: 'Upcoming',
  current: 'Current',
  historical: 'Historical',
};

export default function EmployeePayTab({
  employeeId,
  canEdit,
  initialPaySettings,
  initialOverrides,
  currentRate,
  loadError,
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
  const [overrides, setOverrides] = useState(initialOverrides);
  const [overrideRate, setOverrideRate] = useState('');
  const [overrideEffectiveFrom, setOverrideEffectiveFrom] = useState('');
  const [editingOverrideId, setEditingOverrideId] = useState<string | null>(null);
  const [editOverrideRate, setEditOverrideRate] = useState('');
  const [editOverrideEffectiveFrom, setEditOverrideEffectiveFrom] = useState('');
  const [overrideError, setOverrideError] = useState('');
  // A row being edited in the table has its own message, so it never shows beside the add form.
  const [editOverrideError, setEditOverrideError] = useState('');
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
      setOverrides(prev => [result.data, ...prev].sort((a, b) => b.effective_from.localeCompare(a.effective_from)));
      setOverrideRate('');
      setOverrideEffectiveFrom('');
      setShowOverrideForm(false);
    });
  };

  const startEditOverride = (override: EmployeeRateOverride) => {
    setEditingOverrideId(override.id);
    setEditOverrideRate(String(override.hourly_rate));
    setEditOverrideEffectiveFrom(override.effective_from);
    setEditOverrideError('');
  };

  const handleUpdateOverride = () => {
    if (!editingOverrideId) return;
    const rate = parseFloat(editOverrideRate);
    if (!rate || rate <= 0) { setEditOverrideError('Enter a valid hourly rate'); return; }
    if (!editOverrideEffectiveFrom) { setEditOverrideError('Choose an effective-from date'); return; }
    setEditOverrideError('');

    startOverrideTransition(async () => {
      const result = await updateEmployeeRateOverride({
        id: editingOverrideId,
        hourlyRate: rate,
        effectiveFrom: editOverrideEffectiveFrom,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success('Rate override updated');
      setOverrides(prev =>
        prev
          .map(override => override.id === result.data.id ? result.data : override)
          .sort((a, b) => b.effective_from.localeCompare(a.effective_from))
      );
      setEditingOverrideId(null);
    });
  };

  const cancelSettings = () => {
    setSettingsEditing(false);
    setSettingsError('');
    setPayType(initialPaySettings?.pay_type ?? 'hourly');
    setMaxHours(initialPaySettings?.max_weekly_hours?.toString() ?? '');
  };

  // A failed load says so rather than showing default settings and no overrides, which would
  // invite an edit that overwrites the real ones.
  if (loadError) {
    return (
      <Card>
        <CardHeader title="Pay Settings" />
        <CardBody>
          <Alert tone="danger" title="Could not load pay details">{loadError}</Alert>
        </CardBody>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Pay Settings"
          subtitle="Pay type, max weekly hours guideline, and individual rate overrides"
          action={canEdit && !settingsEditing ? (
            <Button type="button" size="sm" variant="secondary" onClick={() => setSettingsEditing(true)}>
              Edit
            </Button>
          ) : undefined}
        />
        <CardBody className="space-y-4">
          {currentRate && (
            <div className="flex items-center justify-between gap-4">
              {/* Green, as it was before the page contract: the rate in force today. */}
              <Stat label="Current hourly rate" value={formatRate(currentRate.rate)} tone="success" />
              <Badge size="sm">
                {currentRate.source === 'override' ? 'Individual override' : 'Age band'}
              </Badge>
            </div>
          )}

          {payType === 'salaried' && !settingsEditing && (
            <Alert tone="info" size="sm">
              This employee is <strong>salaried</strong>. They appear in the rota and timeclock but are excluded from hourly pay calculations and payroll exports.
            </Alert>
          )}

          {settingsEditing ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <Select
                  label="Pay type"
                  value={payType}
                  onChange={e => setPayType(e.target.value as 'hourly' | 'salaried')}
                  options={[
                    { value: 'hourly', label: 'Hourly' },
                    { value: 'salaried', label: 'Salaried' },
                  ]}
                />
                <Input
                  label="Max weekly hours"
                  type="number"
                  min="0"
                  step="0.5"
                  placeholder="e.g. 40"
                  value={maxHours}
                  onChange={e => setMaxHours(e.target.value)}
                />
              </div>
              {settingsError && <Alert tone="danger" size="sm">{settingsError}</Alert>}
              <FormFooter>
                <Button type="button" variant="secondary" onClick={cancelSettings}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={handleSaveSettings} disabled={settingsIsPending}>
                  {settingsIsPending ? 'Saving…' : 'Save Settings'}
                </Button>
              </FormFooter>
            </>
          ) : (
            <DescriptionList
              items={[
                { key: 'pay-type', label: 'Pay type', value: <span className="capitalize">{payType}</span> },
                {
                  key: 'max-weekly-hours',
                  label: 'Max weekly hours',
                  value: initialPaySettings?.max_weekly_hours != null
                    ? `${initialPaySettings.max_weekly_hours} hrs/week`
                    : <span className="text-text-soft">Not set</span>,
                },
              ]}
            />
          )}
        </CardBody>
      </Card>

      {/* Rate overrides (hourly only) */}
      {payType === 'hourly' && (
        <Card>
          <CardHeader
            title="Individual Rate Overrides"
            subtitle="Override the age-band rate for this employee; historical rates are preserved"
            action={canEdit ? (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                icon={<Icon name="plus" size={14} />}
                onClick={() => setShowOverrideForm(v => !v)}
              >
                Add Override
              </Button>
            ) : undefined}
          />

          {showOverrideForm && canEdit && (
            <CardBody className="space-y-4 border-b border-border">
              <SubHeading>New Rate Override</SubHeading>
              {overrideError && <Alert tone="danger" size="sm">{overrideError}</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Hourly rate (£)">
                  <Input
                    id="override-rate"
                    type="number"
                    step="0.01"
                    min="0"
                    placeholder="e.g. 13.00"
                    value={overrideRate}
                    onChange={e => setOverrideRate(e.target.value)}
                  />
                </Field>
                <Field label="Effective from">
                  <Input
                    id="override-eff"
                    type="date"
                    value={overrideEffectiveFrom}
                    onChange={e => setOverrideEffectiveFrom(e.target.value)}
                  />
                </Field>
              </div>
              <FormFooter>
                <Button type="button" variant="secondary" onClick={() => { setShowOverrideForm(false); setOverrideError(''); }}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={handleAddOverride} disabled={overrideIsPending}>
                  {overrideIsPending ? 'Saving…' : 'Save Override'}
                </Button>
              </FormFooter>
            </CardBody>
          )}

          {/* A row being edited in the table says why it cannot be saved, above the table. */}
          {editingOverrideId && editOverrideError && (
            <CardBody>
              <Alert tone="danger" size="sm">{editOverrideError}</Alert>
            </CardBody>
          )}

          {overrides.length === 0 ? (
            <Empty
              size="sm"
              title="No individual overrides set"
              description="Rate is calculated from age band."
            />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Rate</TableHead>
                  <TableHead>Effective from</TableHead>
                  <TableHead>Status</TableHead>
                  {canEdit && <TableHead align="right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((ov) => {
                  const today = getTodayIsoDate();
                  const isUpcoming = ov.effective_from > today;
                  const isCurrent = !isUpcoming && overrides.find(o => o.effective_from <= today)?.id === ov.id;
                  const overrideState: RateOverrideState = isUpcoming ? 'upcoming' : isCurrent ? 'current' : 'historical';
                  return (
                    <TableRow key={ov.id}>
                      <TableCell className="font-medium">
                        {editingOverrideId === ov.id ? (
                          <Input
                            type="number"
                            step="0.01"
                            min="0"
                            aria-label="Hourly rate (£)"
                            value={editOverrideRate}
                            onChange={e => setEditOverrideRate(e.target.value)}
                          />
                        ) : formatRate(ov.hourly_rate)}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {editingOverrideId === ov.id ? (
                          <Input
                            type="date"
                            aria-label="Effective from"
                            value={editOverrideEffectiveFrom}
                            onChange={e => setEditOverrideEffectiveFrom(e.target.value)}
                          />
                        ) : formatDate(ov.effective_from)}
                      </TableCell>
                      <TableCell>
                        <Badge tone={RATE_OVERRIDE_TONES[overrideState]} size="sm">
                          {RATE_OVERRIDE_LABELS[overrideState]}
                        </Badge>
                      </TableCell>
                      {canEdit && (
                        <TableCell align="right">
                          {editingOverrideId === ov.id ? (
                            <div className="flex justify-end gap-2">
                              <Button type="button" size="sm" variant="ghost" onClick={() => { setEditingOverrideId(null); setEditOverrideError(''); }}>
                                Cancel
                              </Button>
                              <Button type="button" size="sm" variant="primary" onClick={handleUpdateOverride} disabled={overrideIsPending}>
                                Save
                              </Button>
                            </div>
                          ) : isUpcoming ? (
                            <Button type="button" size="sm" variant="ghost" onClick={() => startEditOverride(ov)}>
                              Edit
                            </Button>
                          ) : null}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

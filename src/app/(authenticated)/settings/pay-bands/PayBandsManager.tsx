'use client';

import { useState, useTransition } from 'react';
import {
  Accordion,
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Empty,
  Field,
  FormFooter,
  Icon,
  Input,
  PageLayout,
  Section,
  SubHeading,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  toast,
} from '@/ds';
import { activeStateTone, PAY_RATE_STATUS_BADGE, type PayRateStatus } from '../_shared/status-ui';
import {
  createPayAgeBand,
  addPayBandRate,
  updatePayAgeBand,
  updatePayBandRate,
  type PayAgeBand,
  type PayBandRate,
} from '@/app/actions/pay-bands';
import { getTodayIsoDate } from '@/lib/dateUtils';

interface PayBandsManagerProps {
  canManage: boolean;
  initialBands: PayAgeBand[];
  initialRates: Record<string, PayBandRate[]>; // keyed by band_id
  /** Set when the bands could not be loaded. The page keeps its header and shows the error. */
  loadError?: string | null;
  /** Set when the rates for one or more bands could not be loaded. */
  ratesLoadError?: string | null;
  /** The bands whose rates could not be loaded: they show that, never "no rates". */
  ratesFailedBandIds?: string[];
}

const NO_FAILED_BANDS: string[] = [];

const layoutProps = {
  title: 'Pay Bands',
  subtitle: 'Age-based pay band definitions and effective-dated hourly rates',
  backButton: { label: 'Back to Settings', href: '/settings' },
};

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
  ratesFailed,
  onRateUpdated,
}: {
  rates: PayBandRate[];
  bandId: string;
  canManage: boolean;
  /** The rates could not be loaded, so the empty list is not the truth. */
  ratesFailed: boolean;
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

  const today = getTodayIsoDate();
  const current = rates.find(r => r.effective_from <= today) ?? null;

  const rateStatus = (r: PayBandRate): PayRateStatus =>
    r.effective_from > today ? 'upcoming' : r.id === current?.id ? 'current' : 'historical';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <SubHeading as="h3">Rate History</SubHeading>
        {canManage && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            icon={<Icon name="plus" size={14} />}
            onClick={() => setShowForm(v => !v)}
          >
            Add Rate
          </Button>
        )}
      </div>

      {rates.length === 0 ? (
        ratesFailed ? (
          <Alert tone="danger" size="sm">The rates for this band could not be loaded.</Alert>
        ) : (
          // The same frame the rates table sits in once there is a rate.
          <Card padding="none">
            <Empty size="sm" title="No rates set yet" />
          </Card>
        )
      ) : (
        <Card padding="none">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Rate</TableHead>
                <TableHead>Effective from</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead align="right">Actions</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rates.map(r => {
                const badge = PAY_RATE_STATUS_BADGE[rateStatus(r)];
                return (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">
                      {editingRateId === r.id ? (
                        <Input
                          type="number"
                          step="0.01"
                          min="0"
                          aria-label="Hourly rate"
                          value={editRate}
                          onChange={e => setEditRate(e.target.value)}
                        />
                      ) : formatRate(r.hourly_rate)}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {editingRateId === r.id ? (
                        <Input
                          type="date"
                          aria-label="Effective from"
                          value={editEffectiveFrom}
                          onChange={e => setEditEffectiveFrom(e.target.value)}
                        />
                      ) : formatDate(r.effective_from)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={badge.tone} size="sm">{badge.label}</Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell align="right">
                        {editingRateId === r.id ? (
                          <div className="flex justify-end gap-2">
                            <Button type="button" size="sm" variant="secondary" onClick={() => setEditingRateId(null)}>
                              Cancel
                            </Button>
                            <Button type="button" size="sm" variant="primary" onClick={handleUpdateRate} loading={isPending}>
                              Save Changes
                            </Button>
                          </div>
                        ) : r.effective_from > today ? (
                          <Button type="button" size="sm" variant="ghost" onClick={() => startEditRate(r)}>
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
        </Card>
      )}

      {editingRateId && error && <Alert tone="danger">{error}</Alert>}

      {showForm && canManage && (
        <Card>
          <CardHeader title="Add Rate" subtitle="A new effective-dated rate for this band" />
          <CardBody className="space-y-4">
            {error && <Alert tone="danger">{error}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Hourly rate (£)" htmlFor={`rate-${bandId}`}>
                <Input
                  id={`rate-${bandId}`}
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 11.44"
                  value={rate}
                  onChange={e => setRate(e.target.value)}
                />
              </Field>
              <Field label="Effective from" htmlFor={`eff-${bandId}`}>
                <Input
                  id={`eff-${bandId}`}
                  type="date"
                  value={effectiveFrom}
                  onChange={e => setEffectiveFrom(e.target.value)}
                />
              </Field>
            </div>
            <FormFooter>
              <Button type="button" variant="secondary" onClick={() => setShowForm(false)}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleAddRate} loading={isPending}>
                Add Rate
              </Button>
            </FormFooter>
          </CardBody>
        </Card>
      )}
    </div>
  );
}

/** The current rate for a band: the latest one already in force. */
function currentRateFor(rates: PayBandRate[]): PayBandRate | null {
  const today = getTodayIsoDate();
  return rates.find(r => r.effective_from <= today) ?? null;
}

/** The body of one band's accordion panel: band edits and the rate history. */
function BandDetails({
  band,
  rates,
  canManage,
  ratesFailed,
  onBandUpdated,
  onRateUpdated,
}: {
  band: PayAgeBand;
  rates: PayBandRate[];
  canManage: boolean;
  ratesFailed: boolean;
  onBandUpdated: (band: PayAgeBand) => void;
  onRateUpdated: (bandId: string, rate: PayBandRate) => void;
}) {
  const [editingBand, setEditingBand] = useState(false);
  const [editLabel, setEditLabel] = useState(band.label);
  const [editMinAge, setEditMinAge] = useState(String(band.min_age));
  const [editMaxAge, setEditMaxAge] = useState(band.max_age == null ? '' : String(band.max_age));
  const [editSortOrder, setEditSortOrder] = useState(String(band.sort_order));
  const [editError, setEditError] = useState('');
  const [isPending, startTransition] = useTransition();

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
    <div className="space-y-4">
      {canManage && (
        editingBand ? (
          <Card>
            <CardHeader title="Edit Band" />
            <CardBody className="space-y-4">
              {editError && <Alert tone="danger">{editError}</Alert>}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
                <Input label="Label" value={editLabel} onChange={e => setEditLabel(e.target.value)} />
                <Input label="Min age" type="number" min="0" max="100" value={editMinAge} onChange={e => setEditMinAge(e.target.value)} />
                <Input label="Max age" type="number" min="1" max="100" value={editMaxAge} onChange={e => setEditMaxAge(e.target.value)} />
                <Input label="Sort" type="number" min="0" value={editSortOrder} onChange={e => setEditSortOrder(e.target.value)} />
              </div>
              <FormFooter>
                <Button type="button" variant="secondary" onClick={() => setEditingBand(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="primary" onClick={() => saveBand()} loading={isPending}>
                  Save Changes
                </Button>
              </FormFooter>
            </CardBody>
          </Card>
        ) : (
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="secondary" onClick={() => setEditingBand(true)}>
              Edit Band
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
        )
      )}
      <RateHistory
        rates={rates}
        bandId={band.id}
        canManage={canManage}
        ratesFailed={ratesFailed}
        onRateUpdated={(rate) => onRateUpdated(band.id, rate)}
      />
    </div>
  );
}

export default function PayBandsManager({
  canManage,
  initialBands,
  initialRates,
  loadError = null,
  ratesLoadError = null,
  ratesFailedBandIds = NO_FAILED_BANDS,
}: PayBandsManagerProps) {
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

  if (loadError) {
    return (
      <PageLayout {...layoutProps}>
        <Alert tone="danger" title="Failed to load pay bands">{loadError}</Alert>
      </PageLayout>
    );
  }

  return (
    <PageLayout
      {...layoutProps}
      headerActions={
        canManage ? (
          <Button
            type="button"
            size="sm"
            variant="primary"
            icon={<Icon name="plus" size={16} />}
            onClick={() => setShowNewBandForm(v => !v)}
          >
            New Band
          </Button>
        ) : undefined
      }
    >
      {ratesLoadError && (
        <Alert tone="danger" title="Some rates could not be loaded">{ratesLoadError}</Alert>
      )}

      {showNewBandForm && canManage && (
        <Card>
          <CardHeader title="New Band" />
          <CardBody className="space-y-4">
            {formError && <Alert tone="danger">{formError}</Alert>}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="sm:col-span-2">
                <Field label="Band label" htmlFor="band-label" required>
                  <Input
                    id="band-label"
                    placeholder='e.g. "Under 18" or "23+"'
                    value={label}
                    onChange={e => setLabel(e.target.value)}
                  />
                </Field>
              </div>
              <Field label="Min age" htmlFor="band-min">
                <Input
                  id="band-min"
                  type="number"
                  min="0"
                  max="100"
                  placeholder="e.g. 0"
                  value={minAge}
                  onChange={e => setMinAge(e.target.value)}
                />
              </Field>
              <Field label="Max age (blank = no limit)" htmlFor="band-max">
                <Input
                  id="band-max"
                  type="number"
                  min="1"
                  max="100"
                  placeholder="e.g. 17"
                  value={maxAge}
                  onChange={e => setMaxAge(e.target.value)}
                />
              </Field>
            </div>
            <FormFooter>
              <Button type="button" variant="secondary" onClick={() => { setShowNewBandForm(false); setFormError(''); }}>
                Cancel
              </Button>
              <Button type="button" variant="primary" onClick={handleCreateBand} loading={isPending}>
                Create Band
              </Button>
            </FormFooter>
          </CardBody>
        </Card>
      )}

      <Section
        title="Age Bands & Rates"
        description="Rates are append-only. Adding a new rate does not change historical payroll calculations."
      >
        <div className="space-y-4">
          <p className="text-sm text-text-muted">
            Define age bands aligned to national/living wage tiers. Add effective-dated rates as wages change each year.
            Historical rates are preserved for payroll accuracy.
          </p>

          {bands.length === 0 ? (
            <Card>
              <Empty
                size="sm"
                title="No bands yet"
                description={canManage ? 'Create your first band with New Band.' : undefined}
              />
            </Card>
          ) : (
            <Accordion
              variant="separated"
              multiple
              items={bands.map(band => {
                const rates = ratesByBand[band.id] ?? [];
                const currentRate = currentRateFor(rates);
                // Only while nothing has been added since: a rate saved here is real, whatever failed.
                const ratesFailed = rates.length === 0 && ratesFailedBandIds.includes(band.id);
                return {
                  key: band.id,
                  title: (
                    <span className="block">
                      <span className="block font-medium text-text">{band.label}</span>
                      <span className="block text-xs font-normal text-text-muted">
                        Age {band.min_age}{band.max_age != null ? `–${band.max_age}` : '+'}
                      </span>
                    </span>
                  ),
                  extra: (
                    <>
                      {currentRate ? (
                        <span className="text-sm font-semibold text-text">{formatRate(currentRate.hourly_rate)}</span>
                      ) : (
                        <span className="text-sm text-text-soft italic">{ratesFailed ? 'Rates not loaded' : 'No rate set'}</span>
                      )}
                      {!band.is_active && <Badge tone={activeStateTone(false)} size="sm">Inactive</Badge>}
                    </>
                  ),
                  content: (
                    <BandDetails
                      band={band}
                      rates={rates}
                      canManage={canManage}
                      ratesFailed={ratesFailed}
                      onBandUpdated={handleBandUpdated}
                      onRateUpdated={handleRateUpdated}
                    />
                  ),
                };
              })}
            />
          )}
        </div>
      </Section>
    </PageLayout>
  );
}

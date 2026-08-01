'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Badge, Button, Card, Input, Section, Select, Textarea } from '@/ds'
import {
  DEPOSIT_BASES,
  MENU_COURSES,
  PERIOD_KINDS,
  PERIOD_KIND_LABELS,
  describeDeposit,
  formatGbp,
  mapBookingPeriodRow,
  type BookingPeriod,
  type BookingPeriodRow,
  type DepositBasis,
  type MenuCourse,
  type PeriodKind,
} from '@/lib/table-bookings/periods'
import { resolveTableBookingDeposit } from '@/lib/table-bookings/period-deposit'

/**
 * Seasonal booking periods: Christmas dinner, Mother's Day, Easter, Father's Day.
 *
 * A period carries its own dates, its own question to the guest, its own deposit and its own
 * pre-order requirement. Three rules are worth knowing while reading this screen:
 *
 *   * A period is born switched OFF and is completely inert until someone switches it on. Nothing
 *     about an inactive period reaches a guest.
 *   * Two active periods may never cover the same date. The database refuses it, so the guest is
 *     never asked two questions.
 *   * Editing a period never changes a booking already taken. The terms are copied onto the booking
 *     when it is made, so a payment dispute can be settled from the booking alone.
 *
 * Validation is duplicated deliberately: the same rules run in the database, which is the only
 * place that can be authoritative. What is here is for a fast, readable error, not for safety.
 */

type SettingsBag = Record<string, { value: unknown } | undefined>

type PeriodDraft = {
  id?: string
  code: string
  period_kind: PeriodKind
  name: string
  starts_on: string
  ends_on: string
  guest_question: string
  guest_blurb: string
  requires_preorder: boolean
  preorder_cutoff_days: string
  deposit_basis: DepositBasis
  deposit_amount: string
  refund_cutoff_days: string
  min_party_size: string
  max_party_size: string
  min_notice_hours: string
}

type MenuDraft = {
  period_id: string
  course: MenuCourse
  name: string
  description: string
  price_gbp: string
  allergens: string
}

const EMPTY_PERIOD: PeriodDraft = {
  code: '',
  period_kind: 'other',
  name: '',
  starts_on: '',
  ends_on: '',
  guest_question: '',
  guest_blurb: '',
  requires_preorder: false,
  preorder_cutoff_days: '7',
  deposit_basis: 'none',
  deposit_amount: '0',
  refund_cutoff_days: '7',
  min_party_size: '',
  max_party_size: '',
  min_notice_hours: '0',
}

const KIND_OPTIONS = PERIOD_KINDS.map((kind) => ({ value: kind, label: PERIOD_KIND_LABELS[kind] }))

const BASIS_OPTIONS: { value: DepositBasis; label: string }[] = [
  { value: 'none', label: 'No deposit' },
  { value: 'per_head', label: 'Per guest' },
  { value: 'per_booking', label: 'Per booking' },
]

const COURSE_OPTIONS = MENU_COURSES.map((course) => ({
  value: course,
  label: course.charAt(0).toUpperCase() + course.slice(1),
}))

function toDraft(period: BookingPeriod): PeriodDraft {
  return {
    id: period.id,
    code: period.code,
    period_kind: period.periodKind,
    name: period.name,
    starts_on: period.startsOn,
    ends_on: period.endsOn,
    guest_question: period.guestQuestion,
    guest_blurb: period.guestBlurb ?? '',
    requires_preorder: period.requiresPreorder,
    preorder_cutoff_days: String(period.preorderCutoffDays),
    deposit_basis: period.depositBasis,
    deposit_amount: String(period.depositAmount),
    refund_cutoff_days: String(period.refundCutoffDays),
    min_party_size: period.minPartySize === null ? '' : String(period.minPartySize),
    max_party_size: period.maxPartySize === null ? '' : String(period.maxPartySize),
    min_notice_hours: String(period.minNoticeHours),
  }
}

/** The first thing wrong with the draft, in plain words, or null when it looks fine. */
function firstComplaint(draft: PeriodDraft): string | null {
  if (draft.name.trim().length < 2) return 'Give the period a name'
  if (!draft.starts_on || !draft.ends_on) return 'Give the period a start and an end date'
  if (draft.ends_on < draft.starts_on) return 'The end date cannot be before the start date'
  if (draft.guest_question.trim().length < 5) return 'Write the question the guest is asked'
  if (!draft.id && !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(draft.code.trim())) {
    return 'The code must be lowercase words joined by hyphens, for example christmas-2027'
  }
  if (draft.deposit_basis !== 'none' && Number(draft.deposit_amount) <= 0) {
    return 'A deposit needs an amount above zero, or set it to no deposit'
  }
  if (
    draft.min_party_size !== '' &&
    draft.max_party_size !== '' &&
    Number(draft.max_party_size) < Number(draft.min_party_size)
  ) {
    return 'The largest party cannot be smaller than the smallest party'
  }
  return null
}

function statusOf(period: BookingPeriod): { label: string; tone: 'success' | 'neutral' | 'warning' } {
  if (period.archivedAt) return { label: 'Archived', tone: 'neutral' }
  if (!period.isActive) return { label: 'Switched off', tone: 'neutral' }
  if (period.requiresPreorder && !period.menuReady) return { label: 'Live, menu missing', tone: 'warning' }
  return { label: 'Live', tone: 'success' }
}

export function SeasonalPeriods() {
  const [periods, setPeriods] = useState<BookingPeriod[]>([])
  const [settings, setSettings] = useState<SettingsBag>({})
  const [revisions, setRevisions] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [draft, setDraft] = useState<PeriodDraft | null>(null)
  const [menuDraft, setMenuDraft] = useState<MenuDraft | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [periodsRes, settingsRes] = await Promise.all([
        fetch('/api/settings/table-bookings/periods'),
        fetch('/api/settings/table-bookings/allocation'),
      ])
      const periodsJson = await periodsRes.json()
      if (!periodsRes.ok) throw new Error(periodsJson.error || 'Failed to load periods')
      const settingsJson = await settingsRes.json()

      const rows = (periodsJson.data || []) as BookingPeriodRow[]
      setPeriods(rows.map(mapBookingPeriodRow))
      setSettings(settingsJson.data?.settings || {})
      setRevisions(settingsJson.data?.revisions || {})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load seasonal periods')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const depositsEnabled = useMemo(() => {
    const raw = settings['booking_period_deposits_enabled']?.value
    return typeof raw === 'boolean' ? raw : true
  }, [settings])

  async function post(url: string, method: string, body: unknown, successMessage: string): Promise<boolean> {
    setBusy(true)
    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Could not save')
      toast.success(successMessage)
      await load()
      return true
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function savePeriod(): Promise<void> {
    if (!draft) return

    // A fast, readable error. The database runs the same rules and is the authority.
    const complaint = firstComplaint(draft)
    if (complaint) {
      toast.error(complaint)
      return
    }

    const payload = {
      ...(draft.id ? { id: draft.id } : { code: draft.code.trim().toLowerCase(), period_kind: draft.period_kind }),
      name: draft.name.trim(),
      starts_on: draft.starts_on,
      ends_on: draft.ends_on,
      guest_question: draft.guest_question.trim(),
      guest_blurb: draft.guest_blurb.trim() || null,
      requires_preorder: draft.requires_preorder,
      preorder_cutoff_days: Number(draft.preorder_cutoff_days) || 0,
      deposit_basis: draft.deposit_basis,
      deposit_amount: draft.deposit_basis === 'none' ? 0 : Number(draft.deposit_amount) || 0,
      refund_cutoff_days: Number(draft.refund_cutoff_days) || 0,
      min_party_size: draft.min_party_size === '' ? null : Number(draft.min_party_size),
      max_party_size: draft.max_party_size === '' ? null : Number(draft.max_party_size),
      min_notice_hours: Number(draft.min_notice_hours) || 0,
    }

    const saved = await post(
      '/api/settings/table-bookings/periods',
      'POST',
      payload,
      draft.id ? 'Period updated' : 'Period created, switched off until you turn it on',
    )
    if (saved) setDraft(null)
  }

  async function saveDepositSwitch(next: boolean) {
    setBusy(true)
    try {
      const res = await fetch('/api/settings/table-bookings/allocation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section: 'deposits',
          payload: { booking_period_deposits_enabled: { value: next } },
          expected_revision: revisions['deposits'] ?? 1,
        }),
      })
      const json = await res.json()
      if (res.status === 409) {
        toast.error('Someone else changed this while the page was open. Reloading the latest.')
        await load()
        return
      }
      if (!res.ok) throw new Error(json.error || 'Could not save')
      toast.success(next ? 'Deposits are being collected' : 'Deposit collection is switched off')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setBusy(false)
    }
  }

  if (loading) {
    return (
      <Section title="Seasonal periods">
        <p className="text-sm text-gray-600">Loading…</p>
      </Section>
    )
  }

  return (
    <div className="space-y-6">
      <Section
        title="Seasonal periods"
        description="Named windows with their own guest question, deposit and pre-order rules. A period does nothing at all until you switch it on."
      >
        <Card>
          {periods.length === 0 ? (
            <p className="text-sm text-gray-600">No seasonal periods yet.</p>
          ) : (
            <div className="space-y-4">
              {periods.map((period) => {
                const status = statusOf(period)
                const isOpen = expandedId === period.id
                return (
                  <div key={period.id} className="rounded-md border border-gray-200 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-semibold text-gray-900">{period.name}</h4>
                          <Badge tone={status.tone}>{status.label}</Badge>
                          <Badge tone="neutral">{PERIOD_KIND_LABELS[period.periodKind]}</Badge>
                        </div>
                        <p className="mt-1 text-sm text-gray-700">
                          {period.startsOn} to {period.endsOn} &middot;{' '}
                          {describeDeposit(period.depositBasis, period.depositAmount)}
                          {period.requiresPreorder ? ' · pre-order required' : ''}
                        </p>
                        <p className="mt-1 text-xs text-gray-500">
                          Code {period.code} &middot; {period.bookingCount} booking
                          {period.bookingCount === 1 ? '' : 's'} taken
                          {period.minPartySize !== null || period.maxPartySize !== null
                            ? ` · ${period.minPartySize ?? 1} to ${period.maxPartySize ?? 'any'} guests`
                            : ''}
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <Button
                          variant="secondary"
                          onClick={() => setExpandedId(isOpen ? null : period.id)}
                        >
                          {isOpen ? 'Hide menu' : `Menu (${period.menuItems.length})`}
                        </Button>
                        <Button variant="secondary" onClick={() => setDraft(toDraft(period))} disabled={busy}>
                          Edit
                        </Button>
                        {!period.archivedAt && (
                          <Button
                            variant={period.isActive ? 'secondary' : 'primary'}
                            disabled={busy}
                            onClick={() =>
                              void post(
                                '/api/settings/table-bookings/periods',
                                'PATCH',
                                { id: period.id, is_active: !period.isActive },
                                period.isActive ? 'Period switched off' : 'Period is now live',
                              )
                            }
                          >
                            {period.isActive ? 'Switch off' : 'Switch on'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {period.requiresPreorder && !period.menuReady && (
                      <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                        This period needs a pre-order and has no menu yet, so it cannot be booked. Add the
                        courses below, then switch it on.
                      </p>
                    )}

                    {period.bookingCount > 0 && (
                      <p className="mt-3 text-xs text-gray-500">
                        Editing this period does not change the {period.bookingCount} booking
                        {period.bookingCount === 1 ? '' : 's'} already taken. Each one keeps the deposit and
                        the terms it was made under.
                      </p>
                    )}

                    {isOpen && (
                      <div className="mt-4 border-t border-gray-200 pt-4">
                        <h5 className="text-sm font-medium text-gray-900">Pre-order menu</h5>
                        {period.menuItems.length === 0 ? (
                          <p className="mt-1 text-sm text-gray-600">
                            No dishes yet. Add them when the menu is published.
                          </p>
                        ) : (
                          <ul className="mt-2 space-y-2">
                            {period.menuItems.map((item) => (
                              <li
                                key={item.id}
                                className="flex flex-wrap items-start justify-between gap-2 rounded border border-gray-200 p-2 text-sm"
                              >
                                <div className="min-w-0">
                                  <span className="font-medium text-gray-900">{item.name}</span>{' '}
                                  <span className="text-xs uppercase text-gray-500">{item.course}</span>
                                  {item.priceGbp !== null && (
                                    <span className="text-gray-700"> &middot; {formatGbp(item.priceGbp)}</span>
                                  )}
                                  {item.description && (
                                    <p className="text-xs text-gray-600">{item.description}</p>
                                  )}
                                </div>
                                <Button
                                  variant="secondary"
                                  disabled={busy}
                                  onClick={() =>
                                    void post(
                                      '/api/settings/table-bookings/periods/menu',
                                      'DELETE',
                                      { id: item.id },
                                      'Menu item removed',
                                    )
                                  }
                                >
                                  Remove
                                </Button>
                              </li>
                            ))}
                          </ul>
                        )}

                        {menuDraft?.period_id === period.id ? (
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <Input
                              label="Dish name"
                              value={menuDraft.name}
                              onChange={(e) => setMenuDraft({ ...menuDraft, name: e.target.value })}
                            />
                            <Select
                              label="Course"
                              options={COURSE_OPTIONS}
                              value={menuDraft.course}
                              onChange={(e) =>
                                setMenuDraft({ ...menuDraft, course: e.target.value as MenuCourse })
                              }
                            />
                            <Input
                              label="Price (GBP, optional)"
                              type="number"
                              step="0.01"
                              value={menuDraft.price_gbp}
                              onChange={(e) => setMenuDraft({ ...menuDraft, price_gbp: e.target.value })}
                            />
                            <Input
                              label="Allergens (optional)"
                              value={menuDraft.allergens}
                              onChange={(e) => setMenuDraft({ ...menuDraft, allergens: e.target.value })}
                            />
                            <div className="sm:col-span-2">
                              <Textarea
                                label="Description (optional)"
                                rows={2}
                                value={menuDraft.description}
                                onChange={(e) =>
                                  setMenuDraft({ ...menuDraft, description: e.target.value })
                                }
                              />
                            </div>
                            <div className="flex gap-2 sm:col-span-2">
                              <Button
                                disabled={busy}
                                onClick={async () => {
                                  if (menuDraft.name.trim().length === 0) {
                                    toast.error('Give the dish a name')
                                    return
                                  }
                                  const ok = await post(
                                    '/api/settings/table-bookings/periods/menu',
                                    'POST',
                                    {
                                      period_id: menuDraft.period_id,
                                      course: menuDraft.course,
                                      name: menuDraft.name.trim(),
                                      description: menuDraft.description.trim() || null,
                                      price_gbp:
                                        menuDraft.price_gbp === '' ? null : Number(menuDraft.price_gbp),
                                      allergens: menuDraft.allergens.trim() || null,
                                    },
                                    'Menu item added',
                                  )
                                  if (ok) setMenuDraft(null)
                                }}
                              >
                                Add dish
                              </Button>
                              <Button variant="secondary" onClick={() => setMenuDraft(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <Button
                            variant="secondary"
                            className="mt-3"
                            onClick={() =>
                              setMenuDraft({
                                period_id: period.id,
                                course: 'main',
                                name: '',
                                description: '',
                                price_gbp: '',
                                allergens: '',
                              })
                            }
                          >
                            Add a dish
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {!draft && (
            <Button className="mt-4" onClick={() => setDraft({ ...EMPTY_PERIOD })}>
              Add a period
            </Button>
          )}
        </Card>
      </Section>

      {draft && (
        <PeriodEditor
          draft={draft}
          setDraft={setDraft}
          onSave={savePeriod}
          busy={busy}
          collectPeriodDeposits={depositsEnabled}
        />
      )}

      <Section
        title="Deposit collection"
        description="The kill switch for seasonal deposits. Leave it on unless something is going wrong with payments."
      >
        <Card>
          <div className="flex items-start gap-3">
            <input
              id="booking_period_deposits_enabled"
              type="checkbox"
              checked={depositsEnabled}
              disabled={busy}
              onChange={(e) => void saveDepositSwitch(e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <div>
              <label htmlFor="booking_period_deposits_enabled" className="text-sm font-medium text-gray-900">
                Collect seasonal deposits
              </label>
              <p className="text-xs text-gray-500">
                Off means a deposit is still worked out and shown to staff, but no money is asked for. The
                deposit for a party of 10 or more is unaffected.
              </p>
            </div>
          </div>
        </Card>
      </Section>
    </div>
  )
}

type PeriodEditorProps = {
  draft: PeriodDraft
  setDraft: (draft: PeriodDraft | null) => void
  onSave: () => void | Promise<void>
  busy: boolean
  collectPeriodDeposits: boolean
}

function PeriodEditor({ draft, setDraft, onSave, busy, collectPeriodDeposits }: PeriodEditorProps) {
  const set = <K extends keyof PeriodDraft>(key: K, value: PeriodDraft[K]) =>
    setDraft({ ...draft, [key]: value })

  // The live preview is the only place the larger-wins rule needs explaining, so it is worked out
  // by resolveTableBookingDeposit rather than written out again in prose.
  //
  // That function is the TypeScript mirror of resolve_table_booking_deposit, which
  // create_table_booking_core_v06 now calls to price every booking. The two are kept in step by
  // create-path-deposit.test.ts, which reads both migrations and fails if the create path stops
  // delegating or if the group threshold and rate drift apart. This claim used to be made in a
  // comment and was simply untrue: the booking path ran a hardcoded rule and this preview described
  // a deposit nobody was ever charged.
  //
  // The kill switch is fed in, so the preview says "nothing will be charged" when nothing will be.
  const preview = useMemo(() => {
    const amount = Number(draft.deposit_amount) || 0
    if (draft.deposit_basis === 'none' || amount <= 0) return null

    const period: BookingPeriod = {
      id: draft.id ?? 'preview',
      code: draft.code || 'preview',
      periodKind: draft.period_kind,
      name: draft.name || 'This period',
      startsOn: draft.starts_on || '1970-01-01',
      endsOn: draft.ends_on || '2999-12-31',
      guestQuestion: draft.guest_question,
      guestBlurb: draft.guest_blurb || null,
      requiresPreorder: false,
      preorderCutoffDays: Number(draft.preorder_cutoff_days) || 0,
      depositBasis: draft.deposit_basis,
      depositAmount: amount,
      refundCutoffDays: Number(draft.refund_cutoff_days) || 0,
      minPartySize: null,
      maxPartySize: null,
      minNoticeHours: 0,
      legacyBookingType: null,
      isActive: true,
      archivedAt: null,
      menuReady: true,
      bookingCount: 0,
      menuItems: [],
    }
    const date = draft.starts_on || '2000-01-01'

    return [2, 6, 12].map((partySize) => {
      const result = resolveTableBookingDeposit({
        partySize,
        bookingDate: date,
        period,
        periodAccepted: true,
        collectPeriodDeposits,
      })
      if (!result.ok) return { partySize, text: result.message }
      return {
        partySize,
        text:
          result.deposit.amount === 0
            ? collectPeriodDeposits
              ? 'no deposit'
              : 'no deposit, collection is switched off below'
            : `${formatGbp(result.deposit.amount)} (${
                result.deposit.rule === 'group' ? 'the 10-plus group rule is larger' : 'this period'
              })`,
      }
    })
  }, [draft, collectPeriodDeposits])

  return (
    <Section title={draft.id ? `Edit ${draft.name || 'period'}` : 'New period'}>
      <Card>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Name shown to guests" value={draft.name} onChange={(e) => set('name', e.target.value)} />
          {draft.id ? (
            <div>
              <span className="block text-[13px] font-medium text-gray-900">Kind and code</span>
              <p className="mt-1 text-sm text-gray-700">
                {PERIOD_KIND_LABELS[draft.period_kind]} &middot; {draft.code}
              </p>
              <p className="mt-1 text-xs text-gray-500">
                Fixed after creation. Rules and bookings already refer to them, so renaming the period is
                safe but changing these would not be.
              </p>
            </div>
          ) : (
            <>
              <Select
                label="Kind"
                options={KIND_OPTIONS}
                value={draft.period_kind}
                onChange={(e) => set('period_kind', e.target.value as PeriodKind)}
                hint="Fixed after creation. This is what the system matches on, not the name."
              />
              <Input
                label="Short code"
                value={draft.code}
                onChange={(e) => set('code', e.target.value)}
                hint="Lowercase words joined by hyphens, for example christmas-2027. Fixed after creation."
              />
            </>
          )}

          <Input
            label="First date"
            type="date"
            value={draft.starts_on}
            onChange={(e) => set('starts_on', e.target.value)}
          />
          <Input
            label="Last date (included)"
            type="date"
            value={draft.ends_on}
            onChange={(e) => set('ends_on', e.target.value)}
          />

          <div className="sm:col-span-2">
            <Input
              label="Question the guest is asked"
              value={draft.guest_question}
              onChange={(e) => set('guest_question', e.target.value)}
              hint="For example: Is this a Christmas dinner booking? Answering no books an ordinary table at ordinary terms."
            />
          </div>
          <div className="sm:col-span-2">
            <Textarea
              label="Sentence under the question (optional)"
              rows={2}
              value={draft.guest_blurb}
              onChange={(e) => set('guest_blurb', e.target.value)}
            />
          </div>

          <Select
            label="Deposit"
            options={BASIS_OPTIONS}
            value={draft.deposit_basis}
            onChange={(e) => set('deposit_basis', e.target.value as DepositBasis)}
          />
          <Input
            label="Deposit amount (GBP)"
            type="number"
            step="0.01"
            value={draft.deposit_amount}
            disabled={draft.deposit_basis === 'none'}
            onChange={(e) => set('deposit_amount', e.target.value)}
          />
          <Input
            label="Full refund up to (days before)"
            type="number"
            value={draft.refund_cutoff_days}
            onChange={(e) => set('refund_cutoff_days', e.target.value)}
            hint="Inside this many days the deposit is not refunded, though a manager may still waive it."
          />
          <Input
            label="Least notice (hours)"
            type="number"
            value={draft.min_notice_hours}
            onChange={(e) => set('min_notice_hours', e.target.value)}
          />
          <Input
            label="Smallest party (optional)"
            type="number"
            value={draft.min_party_size}
            onChange={(e) => set('min_party_size', e.target.value)}
          />
          <Input
            label="Largest party (optional)"
            type="number"
            value={draft.max_party_size}
            onChange={(e) => set('max_party_size', e.target.value)}
          />

          <div className="sm:col-span-2 flex items-start gap-3">
            <input
              id="requires_preorder"
              type="checkbox"
              checked={draft.requires_preorder}
              onChange={(e) => set('requires_preorder', e.target.checked)}
              className="mt-1 h-4 w-4"
            />
            <div>
              <label htmlFor="requires_preorder" className="text-sm font-medium text-gray-900">
                Guests must choose their food when they book
              </label>
              <p className="text-xs text-gray-500">
                The period cannot go live until at least one dish is on its menu, and guests are told the
                menu is not ready rather than being shown an empty list.
              </p>
            </div>
          </div>

          {draft.requires_preorder && (
            <Input
              label="Food choices needed by (days before)"
              type="number"
              value={draft.preorder_cutoff_days}
              onChange={(e) => set('preorder_cutoff_days', e.target.value)}
            />
          )}
        </div>

        {preview && (
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="font-medium text-gray-900">What guests would pay</p>
            <ul className="mt-1 space-y-1 text-gray-700">
              {preview.map((line) => (
                <li key={line.partySize}>
                  A party of {line.partySize} pays {line.text}.
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-gray-500">
              Where the deposit for parties of 10 or more is larger, that one applies instead. The two are
              never added together.
            </p>
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <Button onClick={() => void onSave()} loading={busy}>
            {draft.id ? 'Save changes' : 'Create, switched off'}
          </Button>
          <Button variant="secondary" onClick={() => setDraft(null)}>
            Cancel
          </Button>
        </div>
      </Card>
    </Section>
  )
}

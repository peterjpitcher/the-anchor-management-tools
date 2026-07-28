'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { Button, Card, Input, Section } from '@/ds'

/**
 * Everything that decides how tables are handed out.
 *
 * Before this existed, the seating order of the pub was alphabetical by table name, and changing a
 * turn time or a hold needed a developer. Each section saves on its own, carrying a revision so a
 * stale tab loses cleanly instead of overwriting half of someone else's change.
 *
 * Validation is duplicated deliberately: the same rules run in the database, which is the only
 * place that can be authoritative. What is here is for a fast, readable error, not for safety.
 */

type SettingsBag = Record<string, { value: unknown } | undefined>
type Revisions = Record<string, number>

type SectionKey =
  | 'turn_times' | 'kitchen_pacing' | 'outside'
  | 'drinks' | 'party_limits' | 'holds' | 'messages'

const PUBLIC_REASONS = [
  { key: 'tables_full',  label: 'No table fits', hint: 'Also used when a private booking or maintenance blocks a table. The customer is never told which.' },
  { key: 'kitchen_full', label: 'Kitchen at capacity' },
  { key: 'outside_full', label: 'Outside full' },
  { key: 'closed',       label: 'Closed' },
  { key: 'too_late',     label: 'Too close to closing' },
  { key: 'too_large',    label: 'Party too large for online' },
  { key: 'unknown',      label: 'Cannot check right now' },
] as const

function numberOf(bag: SettingsBag, key: string, fallback: number): number {
  const raw = bag[key]?.value
  const n = typeof raw === 'number' ? raw : Number(raw)
  return Number.isFinite(n) ? n : fallback
}

function boolOf(bag: SettingsBag, key: string, fallback: boolean): boolean {
  const raw = bag[key]?.value
  return typeof raw === 'boolean' ? raw : fallback
}

function textOf(bag: SettingsBag, key: string, fallback = ''): string {
  const raw = bag[key]?.value
  return typeof raw === 'string' ? raw : fallback
}

export function AllocationSettings() {
  const [bag, setBag] = useState<SettingsBag>({})
  const [revisions, setRevisions] = useState<Revisions>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<SectionKey | null>(null)
  const [draft, setDraft] = useState<Record<string, string | boolean>>({})

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/settings/table-bookings/allocation')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Failed to load')
      setBag(json.data?.settings || {})
      setRevisions(json.data?.revisions || {})
      setDraft({})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not load allocation settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const valueFor = (key: string, fallback: string | boolean): string | boolean =>
    draft[key] !== undefined ? draft[key] : fallback

  const set = (key: string, value: string | boolean) =>
    setDraft((d) => ({ ...d, [key]: value }))

  async function save(section: SectionKey, keys: string[]) {
    const payload: Record<string, { value: unknown }> = {}
    for (const key of keys) {
      if (draft[key] === undefined) continue
      const raw = draft[key]
      payload[key] =
        typeof raw === 'boolean'
          ? { value: raw }
          : key.startsWith('booking_message_')
            ? { value: raw }
            : { value: Number(raw) }
    }

    if (Object.keys(payload).length === 0) {
      toast('Nothing to save in this section')
      return
    }

    setSaving(section)
    try {
      const res = await fetch('/api/settings/table-bookings/allocation', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          section,
          payload,
          expected_revision: revisions[section] ?? 1,
        }),
      })
      const json = await res.json()

      if (res.status === 409) {
        // Somebody else saved while this page was open. Reloading is the honest fix:
        // silently overwriting their change is how settings quietly drift.
        toast.error('These settings were changed by someone else. Reloading the latest.')
        await load()
        return
      }
      if (!res.ok) throw new Error(json.error || 'Could not save')

      toast.success('Saved')
      await load()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save')
    } finally {
      setSaving(null)
    }
  }

  if (loading) {
    return <Section title="Table allocation"><p className="text-sm text-gray-600">Loading…</p></Section>
  }

  const paceRegular = Number(valueFor('kitchen_pace_covers_regular', String(numberOf(bag, 'kitchen_pace_covers_regular', 25))))
  const reserveRegular = Number(valueFor('kitchen_walk_in_reserve_regular', String(numberOf(bag, 'kitchen_walk_in_reserve_regular', 6))))
  const paceSunday = Number(valueFor('kitchen_pace_covers_sunday', String(numberOf(bag, 'kitchen_pace_covers_sunday', 20))))
  const reserveSunday = Number(valueFor('kitchen_walk_in_reserve_sunday', String(numberOf(bag, 'kitchen_walk_in_reserve_sunday', 6))))
  const outsideCount = Number(valueFor('outside_table_count', String(numberOf(bag, 'outside_table_count', 5))))
  const outsideCapacity = Number(valueFor('outside_table_capacity', String(numberOf(bag, 'outside_table_capacity', 8))))
  const sundayUplift = Number(valueFor('turn_time_sunday_uplift_minutes', String(numberOf(bag, 'turn_time_sunday_uplift_minutes', 15))))

  const numberField = (key: string, label: string, fallback: number, hint?: string) => (
    <div>
      <label htmlFor={key} className="block text-sm font-medium text-gray-900">{label}</label>
      <Input
        id={key}
        type="number"
        value={String(valueFor(key, String(numberOf(bag, key, fallback))))}
        onChange={(e) => set(key, e.target.value)}
        className="mt-1"
      />
      {hint && <p className="mt-1 text-xs text-gray-500">{hint}</p>}
    </div>
  )

  const toggleField = (key: string, label: string, fallback: boolean, hint?: string) => (
    <div className="flex items-start gap-3">
      <input
        id={key}
        type="checkbox"
        checked={Boolean(valueFor(key, boolOf(bag, key, fallback)))}
        onChange={(e) => set(key, e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <div>
        <label htmlFor={key} className="text-sm font-medium text-gray-900">{label}</label>
        {hint && <p className="text-xs text-gray-500">{hint}</p>}
      </div>
    </div>
  )

  const saveButton = (section: SectionKey, keys: string[]) => (
    <Button onClick={() => void save(section, keys)} loading={saving === section} className="mt-4">
      Save
    </Button>
  )

  return (
    <div className="space-y-6">
      {/* ---------------------------------------------------------------- */}
      <Section
        title="How long a table is held"
        description="How long each party keeps their table, and how long it stays unsellable afterwards."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('turn_time_minutes_1_2', 'Party of 1 to 2 (minutes)', 90)}
            {numberField('turn_time_minutes_3_4', 'Party of 3 to 4 (minutes)', 105)}
            {numberField('turn_time_minutes_5_6', 'Party of 5 to 6 (minutes)', 120)}
            {numberField('turn_time_minutes_7_plus', 'Party of 7 or more (minutes)', 150)}
            {numberField('turn_time_sunday_uplift_minutes', 'Added on Sundays (minutes)', 15,
              `Sundays become ${90 + sundayUplift}, ${105 + sundayUplift}, ${120 + sundayUplift} and ${150 + sundayUplift} minutes.`)}
            {numberField('turnaround_gap_minutes', 'Turnaround gap (minutes)', 15,
              'Added to the table, never to the time quoted to the guest. Fifteen minutes is the trade norm.')}
          </div>
          <div className="mt-4">
            {toggleField('turn_times_enabled', 'Use these turn times', false,
              'Off means the old flat 2 hours for food and 90 minutes for drinks.')}
          </div>
          {saveButton('turn_times', [
            'turn_time_minutes_1_2','turn_time_minutes_3_4','turn_time_minutes_5_6',
            'turn_time_minutes_7_plus','turn_time_sunday_uplift_minutes','turnaround_gap_minutes',
            'turn_times_enabled',
          ])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Kitchen pacing (arrivals)"
        description="A cap on how many covers ARRIVE in each window. It limits orders hitting the pass, not people still eating."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('kitchen_pace_covers_regular', 'Weekday covers per window', 25)}
            {numberField('kitchen_walk_in_reserve_regular', 'Weekday held back for walk-ins', 6)}
            {numberField('kitchen_pace_covers_sunday', 'Sunday covers per window', 20)}
            {numberField('kitchen_walk_in_reserve_sunday', 'Sunday held back for walk-ins', 6)}
            {numberField('kitchen_pacing_window_minutes', 'Window (minutes)', 30)}
          </div>

          {/* The two numbers on their own are easy to confuse. Showing the result they
              produce is the difference between a setting and a guess. */}
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm">
            <p className="font-medium text-gray-900">Bookable online per window</p>
            <p className="mt-1 text-gray-700">
              Weekdays: <strong>{Math.max(0, paceRegular - reserveRegular)}</strong> covers.{' '}
              Sundays: <strong>{Math.max(0, paceSunday - reserveSunday)}</strong> covers.
            </p>
            {(paceRegular - reserveRegular <= 0 || paceSunday - reserveSunday <= 0) && (
              <p className="mt-1 text-red-700">
                That closes online booking completely. The reserve must be smaller than the pace.
              </p>
            )}
          </div>

          <div className="mt-4">
            {toggleField('kitchen_pacing_enabled', 'Cap kitchen arrivals', true)}
          </div>
          {saveButton('kitchen_pacing', [
            'kitchen_pace_covers_regular','kitchen_walk_in_reserve_regular',
            'kitchen_pace_covers_sunday','kitchen_walk_in_reserve_sunday',
            'kitchen_pacing_window_minutes','kitchen_pacing_enabled',
          ])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Outside seating"
        description="Garden tables are capped but never individually assigned."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('outside_table_count', 'Number of outside tables', 5)}
            {numberField('outside_table_capacity', 'Seats per outside table', 8)}
          </div>
          <div className="mt-4 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700">
            <strong>{outsideCount * outsideCapacity}</strong> outside seats in total.
          </div>
          <p className="mt-3 text-xs text-gray-500">
            Reducing the seats per table is refused here, because bookings already taken were
            costed at the old size and reducing it would quietly oversell the garden. Ask for the
            re-costing step when you are ready to change it.
          </p>
          {saveButton('outside', ['outside_table_count','outside_table_capacity'])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Drinks bookings"
        description="Drinks fill the bar first and overflow into the dining room only when the bar is full."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('drinks_arrivals_ceiling', 'Drinks covers arriving per window', 40)}
            {numberField('drinks_bump_protection_minutes', 'Never move a booking within (minutes)', 60,
              'A guest about to walk in is never moved, even if it means refusing a food booking.')}
          </div>
          <div className="mt-4">
            {toggleField('drinks_bump_enabled', 'Let a food booking move a drinks booking', false,
              'Only ever to a table that suits it. If there is nowhere to move it, the food booking is refused instead.')}
          </div>
          {saveButton('drinks', ['drinks_arrivals_ceiling','drinks_bump_protection_minutes','drinks_bump_enabled'])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section title="Party size limits" description="Above the online limit, customers are sent to a private booking.">
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('table_booking_max_party_online', 'Largest party the website takes', 20)}
            {numberField('table_booking_max_party_staff', 'Largest party staff can take', 40,
              'A typo guard, not a physical limit: the dining room joins to 26, and above that staff use tables that are not next to each other.')}
          </div>
          {saveButton('party_limits', ['table_booking_max_party_online','table_booking_max_party_staff'])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="Holds"
        description="Tables held back from online booking, and the minimum party sizes, both lapse close to the sitting."
      >
        <Card>
          <div className="grid gap-4 sm:grid-cols-2">
            {numberField('hold_release_lead_hours', 'Release this many hours before', 24,
              'So a couple is never turned away on the night to protect a large party who is not coming.')}
          </div>
          <div className="mt-4">
            {toggleField('table_holds_enabled', 'Honour held and blocked tables', false)}
          </div>
          {saveButton('holds', ['hold_release_lead_hours','table_holds_enabled'])}
        </Card>
      </Section>

      {/* ---------------------------------------------------------------- */}
      <Section
        title="What the customer is told"
        description="Shown on the website when a time is unavailable. Plain text, 200 characters."
      >
        <Card>
          <div className="space-y-4">
            {PUBLIC_REASONS.map((reason) => (
              <div key={reason.key}>
                <label htmlFor={`booking_message_${reason.key}`} className="block text-sm font-medium text-gray-900">
                  {reason.label}
                </label>
                <textarea
                  id={`booking_message_${reason.key}`}
                  rows={2}
                  maxLength={200}
                  value={String(valueFor(`booking_message_${reason.key}`, textOf(bag, `booking_message_${reason.key}`)))}
                  onChange={(e) => set(`booking_message_${reason.key}`, e.target.value)}
                  className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                />
                {'hint' in reason && reason.hint && (
                  <p className="mt-1 text-xs text-gray-500">{reason.hint}</p>
                )}
              </div>
            ))}
          </div>
          {saveButton('messages', PUBLIC_REASONS.map((r) => `booking_message_${r.key}`))}
        </Card>
      </Section>
    </div>
  )
}

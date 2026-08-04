'use client'

/**
 * Taking a seasonal pre-order on the booking detail page.
 *
 * This is the path that matters most in year one: staff are already on the telephone to these
 * guests, so the screen is laid out to be typed into while somebody talks. One block per seat, the
 * main first because it is the only required answer, and a single save for the whole table rather
 * than a save per seat, because a table's order arrives in one conversation.
 *
 * Staff-only. Nothing here is ever rendered on a public route, and the dietary note in particular
 * is for staff and the kitchen alone: never emailed, never logged, never in a manager digest.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Alert, Badge, Button, Input, Select, Textarea } from '@/ds'
import {
  saveSeasonalPreorderCovers,
  syncSeasonalPreorderCovers,
  type StaffPreorderCoverInput,
} from './actions'
import { describePreorderGaps, getPreorderCompleteness } from '@/lib/table-bookings/preorder'
import { formatGbp } from '@/lib/table-bookings/ui'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  type PreorderCourse,
  type PreorderCover,
  type PreorderOrder,
} from '@/types/preorders'

const DIETARY_NOTE_MAX_LENGTH = 200
const GUEST_NAME_MAX_LENGTH = 100

export type PreorderMenuOption = {
  id: string
  course: PreorderCourse
  name: string
  priceGbp: number | null
}

interface SeasonalPreorderSectionProps {
  order: PreorderOrder
  /** Active dishes for the booking's period, already filtered to the three pre-order courses. */
  menu: PreorderMenuOption[]
  canEdit: boolean
  /** The master switch. Off means the section is history only. */
  preorderEnabled: boolean
  /** True once the cutoff has passed. Computed on the server: a browser clock is not evidence. */
  closed: boolean
  closesAtIso: string | null
}

type DraftCover = {
  guestName: string
  dietaryNote: string
  choices: Record<PreorderCourse, string>
}

type Draft = Record<string, DraftCover>

function toDraftCover(cover: PreorderCover): DraftCover {
  const choices = { starter: '', main: '', dessert: '' } as Record<PreorderCourse, string>
  for (const selection of cover.selections) {
    choices[selection.course] = selection.menuItemId
  }
  return {
    guestName: cover.guestName ?? '',
    dietaryNote: cover.dietaryNote ?? '',
    choices,
  }
}

function toDraft(covers: PreorderCover[]): Draft {
  return Object.fromEntries(covers.map((cover) => [cover.id, toDraftCover(cover)]))
}

function isCoverDirty(cover: PreorderCover, draft: DraftCover): boolean {
  const saved = toDraftCover(cover)
  return (
    saved.guestName.trim() !== draft.guestName.trim() ||
    saved.dietaryNote.trim() !== draft.dietaryNote.trim() ||
    PREORDER_COURSES.some((course) => saved.choices[course] !== draft.choices[course])
  )
}

export default function SeasonalPreorderSection({
  order,
  menu,
  canEdit,
  preorderEnabled,
  closed,
  closesAtIso,
}: SeasonalPreorderSectionProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // A save refreshes the route, so the covers come back as new props. What was on screen has just
  // been written, so adopting the fresh copy is right. Reset during render rather than in an
  // effect, keyed on the rows themselves, so a re-render for any other reason cannot throw away
  // half-typed work.
  const coversSignature = order.covers.map((cover) => `${cover.id}:${cover.updatedAt}`).join('|')
  const [draftState, setDraftState] = useState(() => ({
    signature: coversSignature,
    draft: toDraft(order.covers),
  }))
  if (draftState.signature !== coversSignature) {
    setDraftState({ signature: coversSignature, draft: toDraft(order.covers) })
  }
  const draft = draftState.draft

  function setDraft(update: (current: Draft) => Draft) {
    setDraftState((current) => ({ ...current, draft: update(current.draft) }))
  }

  const editable = canEdit && preorderEnabled && !closed
  const completeness = useMemo(() => getPreorderCompleteness(order), [order])
  const seatsMismatched = order.covers.length !== order.partySize

  const optionsByCourse = useMemo(() => {
    const grouped = { starter: [], main: [], dessert: [] } as Record<PreorderCourse, PreorderMenuOption[]>
    for (const item of menu) grouped[item.course].push(item)
    return grouped
  }, [menu])

  const dirtyCoverIds = useMemo(
    () => order.covers.filter((cover) => draft[cover.id] && isCoverDirty(cover, draft[cover.id])).map((c) => c.id),
    [order.covers, draft],
  )

  function updateCover(coverId: string, patch: Partial<DraftCover>) {
    setDraft((current) => ({ ...current, [coverId]: { ...current[coverId], ...patch } }))
  }

  function updateChoice(coverId: string, course: PreorderCourse, menuItemId: string) {
    setDraft((current) => ({
      ...current,
      [coverId]: { ...current[coverId], choices: { ...current[coverId].choices, [course]: menuItemId } },
    }))
  }

  async function handleSave() {
    if (dirtyCoverIds.length === 0) return
    setSaving(true)
    try {
      const payload: StaffPreorderCoverInput[] = dirtyCoverIds.map((coverId) => ({
        coverId,
        guestName: draft[coverId].guestName.trim() || null,
        dietaryNote: draft[coverId].dietaryNote.trim() || null,
        selections: PREORDER_COURSES.map((course) => ({
          course,
          menuItemId: draft[coverId].choices[course] || null,
        })),
      }))

      const result = await saveSeasonalPreorderCovers(order.tableBookingId, payload)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(
        dirtyCoverIds.length === 1 ? 'Seat saved' : `${dirtyCoverIds.length} seats saved`,
      )
      router.refresh()
    } finally {
      setSaving(false)
    }
  }

  async function handleSync() {
    setSyncing(true)
    try {
      const result = await syncSeasonalPreorderCovers(order.tableBookingId)
      if (result.error) {
        toast.error(result.error)
        return
      }
      toast.success(result.message ?? 'Seats updated')
      router.refresh()
    } finally {
      setSyncing(false)
    }
  }

  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold text-gray-900">
            Seasonal Pre-Order{order.periodName ? ` · ${order.periodName}` : ''}
          </h2>
          <p className="mt-0.5 text-xs text-gray-500">
            Every guest needs a main. A starter and a dessert are optional.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={completeness.complete ? 'success' : 'warning'}>
            {completeness.complete ? 'Complete' : 'Not complete'}
          </Badge>
          {editable && (
            <Button
              size="sm"
              onClick={handleSave}
              loading={saving}
              disabled={saving || dirtyCoverIds.length === 0}
            >
              {dirtyCoverIds.length > 0 ? `Save ${dirtyCoverIds.length} seat${dirtyCoverIds.length === 1 ? '' : 's'}` : 'Saved'}
            </Button>
          )}
        </div>
      </div>

      <div className="space-y-4 p-4">
        <p className="text-sm text-gray-700">{describePreorderGaps(completeness)}</p>

        {order.bookingAllergies.length > 0 && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Allergies recorded on the booking
            </p>
            <p className="mt-1 text-sm text-gray-900">{order.bookingAllergies.join(', ')}</p>
          </div>
        )}

        {closed && (
          <Alert tone="warning" title="Pre-orders have closed for this booking">
            {closesAtIso
              ? `Choices closed at noon on ${formatDateInLondon(closesAtIso, { weekday: 'long', day: 'numeric', month: 'long' })}. `
              : ''}
            The kitchen has already ordered to these numbers, so ring the pub to change anything now.
          </Alert>
        )}

        {!preorderEnabled && !closed && (
          <Alert tone="info" title="Pre-orders are switched off">
            The festive menu is not live yet, so this is read-only. Take the order on paper for now.
          </Alert>
        )}

        {completeness.ordinalsWithWithdrawnChoice.length > 0 && (
          <Alert tone="danger" title="A chosen dish has been taken off the menu">
            Seat {completeness.ordinalsWithWithdrawnChoice.join(', ')} needs a new choice. Ring the
            guest and pick again.
          </Alert>
        )}

        {seatsMismatched && (
          <Alert tone="warning" title="Seats do not match the party size">
            <div className="space-y-2">
              <p>
                This booking is for {order.partySize} but has {order.covers.length} pre-order seat
                {order.covers.length === 1 ? '' : 's'}.
              </p>
              {editable && (
                <Button size="sm" variant="secondary" onClick={handleSync} loading={syncing} disabled={syncing}>
                  {order.covers.length === 0 ? 'Start the pre-order' : 'Put the seats right'}
                </Button>
              )}
            </div>
          </Alert>
        )}

        {order.covers.length === 0 ? (
          <p className="text-sm text-gray-500">No seats set up yet, so nothing has been chosen.</p>
        ) : (
          <div className="space-y-3">
            {order.covers.map((cover) => {
              const coverDraft = draft[cover.id]
              if (!coverDraft) return null
              const missingMain = !coverDraft.choices.main
              const withdrawn = cover.selections.filter((selection) => selection.itemWithdrawn)

              return (
                <div
                  key={cover.id}
                  className={`rounded-md border p-3 ${missingMain ? 'border-amber-300 bg-amber-50' : 'border-gray-200 bg-white'}`}
                >
                  <div className="mb-3 flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                      Seat {cover.ordinal}
                    </span>
                    {missingMain && <Badge tone="warning">Needs a main</Badge>}
                    {withdrawn.length > 0 && (
                      <Badge tone="danger">
                        {withdrawn.map((selection) => selection.itemName).join(', ')} withdrawn
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <Input
                      label="Guest name (optional)"
                      value={coverDraft.guestName}
                      maxLength={GUEST_NAME_MAX_LENGTH}
                      disabled={!editable}
                      autoComplete="off"
                      onChange={(event) => updateCover(cover.id, { guestName: event.target.value })}
                    />
                    {PREORDER_COURSES.map((course) => (
                      <CourseSelect
                        key={course}
                        course={course}
                        value={coverDraft.choices[course]}
                        options={optionsByCourse[course]}
                        selectedName={
                          cover.selections.find((selection) => selection.course === course)?.itemName ?? null
                        }
                        disabled={!editable}
                        onChange={(menuItemId) => updateChoice(cover.id, course, menuItemId)}
                      />
                    ))}
                  </div>

                  <div className="mt-3">
                    <Textarea
                      label="Dietary requirement (optional)"
                      rows={2}
                      value={coverDraft.dietaryNote}
                      maxLength={DIETARY_NOTE_MAX_LENGTH}
                      disabled={!editable}
                      hint={`What we need to do for this guest, in ${DIETARY_NOTE_MAX_LENGTH} characters. Anyone with a serious allergy should ring the pub so we can talk it through. Staff and kitchen only.`}
                      onChange={(event) => updateCover(cover.id, { dietaryNote: event.target.value })}
                    />
                    <p className="mt-1 text-right text-xs text-gray-500">
                      {coverDraft.dietaryNote.length}/{DIETARY_NOTE_MAX_LENGTH}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </section>
  )
}

/**
 * One course for one seat. A dish withdrawn from the menu is still shown, disabled, so the screen
 * says what the guest actually chose instead of silently reading as an empty answer.
 */
function CourseSelect({
  course,
  value,
  options,
  selectedName,
  disabled,
  onChange,
}: {
  course: PreorderCourse
  value: string
  options: PreorderMenuOption[]
  selectedName: string | null
  disabled: boolean
  onChange: (menuItemId: string) => void
}) {
  const withdrawn = Boolean(value) && !options.some((option) => option.id === value)

  return (
    <Select
      label={course === 'main' ? 'Main (required)' : `${PREORDER_COURSE_LABELS[course]} (optional)`}
      value={value}
      disabled={disabled}
      error={course === 'main' && !value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{course === 'main' ? 'Not chosen yet' : 'Not having one'}</option>
      {withdrawn && (
        <option value={value} disabled>
          {selectedName ?? 'Previous choice'} (no longer on the menu)
        </option>
      )}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
          {option.priceGbp != null ? ` · ${formatGbp(option.priceGbp)}` : ''}
        </option>
      ))}
    </Select>
  )
}

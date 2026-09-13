'use client'

/**
 * Taking a seasonal pre-order on the booking detail page.
 *
 * This is the path that matters most in year one: staff are already on the telephone to these
 * guests, so the screen is laid out to be typed into while somebody talks. One block per seat, the
 * main first because it is the only required answer, and a single save for the whole table rather
 * than a save per seat, because a table's order arrives in one conversation.
 *
 * ADD-ONS are the tick-boxes under each seat's courses. They are extras a guest has ON TOP of their
 * meal, so they are multi-select, they never count towards completeness, and the money against them
 * is charged on the guest's bill at the pub rather than taken online. That last point is why the
 * per-seat and per-booking totals are here at all: whoever prints the bill has to know what to add.
 *
 * Staff-only. Nothing here is ever rendered on a public route, and the dietary note in particular
 * is for staff and the kitchen alone: never emailed, never logged, never in a manager digest.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { Alert, Badge, Button, Checkbox, Input, Select, Textarea } from '@/ds'
import {
  saveSeasonalPreorderCovers,
  syncSeasonalPreorderCovers,
  type StaffPreorderCoverInput,
} from './actions'
import {
  describePreorderGaps,
  formatPreorderAddonPrice,
  formatPreorderMoney,
  getCoverAddons,
  getPreorderCompleteness,
  isPreorderCourse,
} from '@/lib/table-bookings/preorder'
import { formatGbp } from '@/lib/table-bookings/ui'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  PREORDER_ADDON_STAFF_NOTE,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderCourse,
  type PreorderCover,
  type PreorderOrder,
  type PreorderSelectionCourse,
} from '@/types/preorders'

const DIETARY_NOTE_MAX_LENGTH = 200
const GUEST_NAME_MAX_LENGTH = 100

export type PreorderMenuOption = {
  id: string
  /** Widened for add-ons. The three single-choice courses fill the dropdowns; 'addon' fills the tick-boxes. */
  course: PreorderSelectionCourse
  name: string
  priceGbp: number | null
}

/**
 * What this screen sends per seat.
 *
 * `addonMenuItemIds` is not on `StaffPreorderCoverInput` in ./actions.ts, which this change does not
 * own. The action hands the object straight to `savePreorderCover`, which does accept the field, so
 * naming it here is what makes the tick-boxes save at all. Fold it into `StaffPreorderCoverInput`
 * when that file is next opened and this alias can go.
 */
type StaffPreorderCoverPayload = StaffPreorderCoverInput & { addonMenuItemIds?: string[] }

interface SeasonalPreorderSectionProps {
  order: PreorderOrder
  /** Active dishes for the booking's period: the three pre-order courses and the add-ons. */
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
  /**
   * The COMPLETE set of add-ons this seat wants. Whole-set rather than a list of changes, because
   * that is what the save expects: anything missing from it is unticked. A patch shape could add an
   * add-on but never take one off, which is how a guest ends up charged for something they dropped.
   */
  addonMenuItemIds: string[]
}

type Draft = Record<string, DraftCover>

/** One tick-box: a menu add-on, or one the seat still holds after it left the menu. */
type AddonRow = {
  menuItemId: string
  itemName: string
  priceGbp: number | null
  withdrawn: boolean
}

type AddonSummary = {
  count: number
  totalGbp: number
  /** True when a ticked add-on carries no price, so the total is not the whole of it. */
  hasUnpriced: boolean
}

/**
 * Money is added in whole pence and converted back once at the end.
 *
 * Adding pounds as floating point makes 8.10 + 4.20 come out at 12.299999999999999, and a bill total
 * a penny out is exactly what a guest notices at the till. Same rule as in preorder.ts, applied here
 * because this screen totals the DRAFT rather than what is saved.
 */
function toPence(value: number | null): number {
  if (value === null || !Number.isFinite(value)) return 0
  return Math.round(value * 100)
}

function toDraftCover(cover: PreorderCover): DraftCover {
  const choices = { starter: '', main: '', dessert: '' } as Record<PreorderCourse, string>
  const addonMenuItemIds: string[] = []
  for (const selection of cover.selections) {
    // Add-ons collect into a list; a course overwrites, because a seat holds only one of each.
    if (isPreorderCourse(selection.course)) choices[selection.course] = selection.menuItemId
    else addonMenuItemIds.push(selection.menuItemId)
  }
  return {
    guestName: cover.guestName ?? '',
    dietaryNote: cover.dietaryNote ?? '',
    choices,
    addonMenuItemIds,
  }
}

function toDraft(covers: PreorderCover[]): Draft {
  return Object.fromEntries(covers.map((cover) => [cover.id, toDraftCover(cover)]))
}

function sameIds(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false
  const a = [...left].sort()
  const b = [...right].sort()
  return a.every((id, index) => id === b[index])
}

/**
 * What changed on this seat, split three ways.
 *
 * Split rather than one dirty flag on purpose. A save re-snapshots the price of every course it is
 * told about, so sending the courses because somebody ticked a cheeseboard would quietly re-quote
 * the whole meal at today's menu price. Each part is sent only when that part actually moved.
 */
function diffCover(cover: PreorderCover, draft: DraftCover) {
  const saved = toDraftCover(cover)
  return {
    detailsDirty:
      saved.guestName.trim() !== draft.guestName.trim() ||
      saved.dietaryNote.trim() !== draft.dietaryNote.trim(),
    coursesDirty: PREORDER_COURSES.some((course) => saved.choices[course] !== draft.choices[course]),
    addonsDirty: !sameIds(saved.addonMenuItemIds, draft.addonMenuItemIds),
  }
}

/**
 * The tick-boxes to show for one seat: every add-on on the menu, plus any this seat already holds
 * that has since been taken off it.
 *
 * An add-on the seat already holds shows its SNAPSHOT name and price, not today's menu, because that
 * is the pair the guest was quoted and the pair the save keeps: `saveCoverAddons` leaves an untouched
 * row alone, so showing today's price would tell staff to charge money nobody agreed to.
 */
function buildAddonRows(cover: PreorderCover, options: PreorderMenuOption[]): AddonRow[] {
  const saved = new Map(getCoverAddons(cover).map((selection) => [selection.menuItemId, selection]))

  const rows: AddonRow[] = options.map((option) => {
    const snapshot = saved.get(option.id)
    return {
      menuItemId: option.id,
      itemName: snapshot?.itemName ?? option.name,
      priceGbp: snapshot ? snapshot.priceGbp : option.priceGbp,
      withdrawn: false,
    }
  })

  for (const [menuItemId, snapshot] of saved) {
    if (options.some((option) => option.id === menuItemId)) continue
    // Still shown, so staff can see what the guest is having and take it off. Rendered last because
    // it is no longer something anyone can order.
    rows.push({
      menuItemId,
      itemName: snapshot.itemName,
      priceGbp: snapshot.priceGbp,
      withdrawn: true,
    })
  }

  return rows
}

function summariseAddons(rows: AddonRow[], ticked: string[]): AddonSummary {
  const chosen = rows.filter((row) => ticked.includes(row.menuItemId))
  return {
    count: chosen.length,
    totalGbp: chosen.reduce((running, row) => running + toPence(row.priceGbp), 0) / 100,
    hasUnpriced: chosen.some((row) => row.priceGbp === null),
  }
}

/**
 * The seat's add-on line. Every Christmas item is unpriced today, so "priced on the day" is the
 * normal reading rather than an edge case, and a bare £0.00 would understate the bill.
 */
function describeSeatAddons(summary: AddonSummary): string {
  if (summary.count === 0) return 'None ticked'
  if (summary.hasUnpriced && summary.totalGbp === 0) return `${summary.count} ticked · priced on the day`
  const money = formatPreorderMoney(summary.totalGbp)
  return summary.hasUnpriced
    ? `${summary.count} ticked · ${money} plus items priced on the day`
    : `${summary.count} ticked · ${money}`
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

  const { optionsByCourse, addonOptions } = useMemo(() => {
    const grouped = { starter: [], main: [], dessert: [] } as Record<PreorderCourse, PreorderMenuOption[]>
    const addons: PreorderMenuOption[] = []
    for (const item of menu) {
      if (isPreorderCourse(item.course)) grouped[item.course].push(item)
      else addons.push(item)
    }
    return { optionsByCourse: grouped, addonOptions: addons }
  }, [menu])

  // Rows and money per seat, computed from the DRAFT so the total on screen is what a save would
  // actually put on the bill, not what was on it before staff started typing.
  const addonsByCover = useMemo(() => {
    const map = new Map<string, { rows: AddonRow[]; summary: AddonSummary }>()
    for (const cover of order.covers) {
      const rows = buildAddonRows(cover, addonOptions)
      map.set(cover.id, {
        rows,
        summary: summariseAddons(rows, draft[cover.id]?.addonMenuItemIds ?? []),
      })
    }
    return map
  }, [order.covers, addonOptions, draft])

  const bookingAddons = useMemo(() => {
    let pence = 0
    let count = 0
    let hasUnpriced = false
    let seatsWithAddons = 0
    for (const { summary } of addonsByCover.values()) {
      pence += toPence(summary.totalGbp)
      count += summary.count
      hasUnpriced = hasUnpriced || summary.hasUnpriced
      if (summary.count > 0) seatsWithAddons += 1
    }
    return { count, totalGbp: pence / 100, hasUnpriced, seatsWithAddons }
  }, [addonsByCover])

  const dirtyCoverIds = useMemo(
    () =>
      order.covers
        .filter((cover) => {
          const coverDraft = draft[cover.id]
          if (!coverDraft) return false
          const changed = diffCover(cover, coverDraft)
          return changed.detailsDirty || changed.coursesDirty || changed.addonsDirty
        })
        .map((cover) => cover.id),
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

  function toggleAddon(coverId: string, menuItemId: string, ticked: boolean) {
    setDraft((current) => {
      const coverDraft = current[coverId]
      if (!coverDraft) return current
      const next = ticked
        ? Array.from(new Set([...coverDraft.addonMenuItemIds, menuItemId]))
        : coverDraft.addonMenuItemIds.filter((id) => id !== menuItemId)
      return { ...current, [coverId]: { ...coverDraft, addonMenuItemIds: next } }
    })
  }

  async function handleSave() {
    if (dirtyCoverIds.length === 0) return
    setSaving(true)
    try {
      const payload: StaffPreorderCoverPayload[] = dirtyCoverIds.map((coverId) => {
        const cover = order.covers.find((entry) => entry.id === coverId)
        const coverDraft = draft[coverId]
        const changed = cover
          ? diffCover(cover, coverDraft)
          : { detailsDirty: true, coursesDirty: true, addonsDirty: true }

        return {
          coverId,
          guestName: coverDraft.guestName.trim() || null,
          dietaryNote: coverDraft.dietaryNote.trim() || null,
          // Sent only when they moved. Naming a course rewrites its price snapshot, and naming the
          // add-ons rewrites theirs, so an untouched part is left out rather than re-quoted.
          ...(changed.coursesDirty
            ? {
                selections: PREORDER_COURSES.map((course) => ({
                  course,
                  menuItemId: coverDraft.choices[course] || null,
                })),
              }
            : {}),
          ...(changed.addonsDirty ? { addonMenuItemIds: coverDraft.addonMenuItemIds } : {}),
        }
      })

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
            Every guest needs a main. A starter and a dessert are optional, and add-ons are extras
            that never make an order complete.
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
              if (cover.courseCount === 1) return <p key={cover.id} className="text-sm">Seat {cover.ordinal}: 1 course, no pre-order required.</p>
              const coverDraft = draft[cover.id]
              if (!coverDraft) return null
              const missingMain = !coverDraft.choices.main
              const withdrawn = cover.selections.filter((selection) => selection.itemWithdrawn)
              const addons = addonsByCover.get(cover.id)

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
                        {withdrawn
                          .map(
                            (selection) =>
                              `${PREORDER_SELECTION_COURSE_LABELS[selection.course]}: ${selection.itemName}`,
                          )
                          .join(', ')}{' '}
                        withdrawn
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

                  {addons && addons.rows.length > 0 && (
                    <div className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Add-ons (extras, on top of the meal)
                        </p>
                        <p className="text-xs text-gray-700">{describeSeatAddons(addons.summary)}</p>
                      </div>
                      <div className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
                        {addons.rows.map((row) => {
                          const ticked = coverDraft.addonMenuItemIds.includes(row.menuItemId)
                          return (
                            <Checkbox
                              key={row.menuItemId}
                              className="py-1.5"
                              checked={ticked}
                              // A withdrawn add-on can be taken off but not put back on: the save
                              // would refuse it, and there is no point offering staff a tick that
                              // fails.
                              disabled={!editable || (row.withdrawn && !ticked)}
                              label={`${row.itemName} · ${formatPreorderAddonPrice(row.priceGbp)}${row.withdrawn ? ' (no longer on the menu)' : ''}`}
                              onChange={(next) => toggleAddon(cover.id, row.menuItemId, next)}
                            />
                          )
                        })}
                      </div>
                    </div>
                  )}

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

        {(addonOptions.length > 0 || bookingAddons.count > 0) && order.covers.length > 0 && (
          <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
              Add-ons to put on the bill
            </p>
            <p className="mt-1 text-sm font-semibold text-gray-900">
              {bookingAddons.count === 0
                ? 'Nothing ticked yet.'
                : `${bookingAddons.count} add-on${bookingAddons.count === 1 ? '' : 's'} across ${bookingAddons.seatsWithAddons} seat${bookingAddons.seatsWithAddons === 1 ? '' : 's'}: ${
                    bookingAddons.hasUnpriced && bookingAddons.totalGbp === 0
                      ? 'priced on the day'
                      : formatPreorderMoney(bookingAddons.totalGbp)
                  }`}
              {bookingAddons.count > 0 && bookingAddons.hasUnpriced && bookingAddons.totalGbp > 0
                ? ', plus items priced on the day'
                : ''}
            </p>
            {bookingAddons.count > 0 && (
              <ul className="mt-1 space-y-0.5 text-xs text-gray-700">
                {order.covers.map((cover) => {
              if (cover.courseCount === 1) return <p key={cover.id} className="text-sm">Seat {cover.ordinal}: 1 course, no pre-order required.</p>
                  const summary = addonsByCover.get(cover.id)?.summary
                  if (!summary || summary.count === 0) return null
                  return (
                    <li key={cover.id}>
                      Seat {cover.ordinal}
                      {cover.guestName ? ` (${cover.guestName})` : ''}: {describeSeatAddons(summary)}
                    </li>
                  )
                })}
              </ul>
            )}
            <p className="mt-1 text-xs text-gray-600">{PREORDER_ADDON_STAFF_NOTE}</p>
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

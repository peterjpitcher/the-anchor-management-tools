'use client'

/**
 * Taking a seasonal pre-order on the booking detail page.
 *
 * This is the path that matters most in year one: staff are already on the telephone to these
 * guests, so the screen is laid out to be typed into while somebody talks. One block per seat and a
 * single save for the whole table rather than a save per seat, because a table's order arrives in one
 * conversation.
 *
 * A Christmas seat (a booking with a course list, owner decision D4 of 6 November 2026) needs a name,
 * an answer to the allergy question, a number of courses and the dishes for it: a main on 1 course,
 * a main plus a starter or a dessert on 2, all three on 3. Kids mains are 1 course only (A1). Staff
 * set every one of those here, the number of courses included, and a staff save carries the staff
 * override, so a manager can still change a seat after the cutoff (D8). Each seat says where it
 * stands: complete, what it still needs, chosen by the guest through their own link, or invited.
 *
 * A booking with no course list keeps its old rule: a main, the rest optional.
 *
 * ADD-ONS are the tick-boxes under each seat's courses. They are extras a guest has ON TOP of their
 * meal, so they are multi-select, they never count towards completeness, and the money against them
 * is charged on the guest's bill at the pub rather than taken online. That last point is why the
 * per-seat and per-booking totals are here at all: whoever prints the bill has to know what to add.
 *
 * Staff-only. Nothing here is ever rendered on a public route, and the dietary note and allergies in
 * particular are for staff and the kitchen alone: never emailed, never logged, never in a manager digest.
 */

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardBody,
  CardFooter,
  CardHeader,
  Checkbox,
  Empty,
  Fieldset,
  Input,
  Radio,
  Select,
  SubHeading,
  Textarea,
  toast,
} from '@/ds'
import { PREORDER_COMPLETENESS_TONE } from './status-ui'
import { FoodLinkActions } from './FoodLinkActions'
import {
  saveSeasonalPreorderCovers,
  syncSeasonalPreorderCovers,
  type StaffPreorderCoverInput,
} from './actions'
import {
  describeCourseCount,
  describeCoverMissingCourses,
  describePreorderGaps,
  formatPreorderAddonPrice,
  formatPreorderMoney,
  getCoverAddons,
  getPreorderCompleteness,
  getSeatCourseCount,
  isPreorderCourse,
} from '@/lib/table-bookings/preorder'
import { formatGbp } from '@/lib/table-bookings/ui'
import { formatDateInLondon } from '@/lib/dateUtils'
import {
  PREORDER_ADDON_STAFF_NOTE,
  PREORDER_ALLERGY_DETAIL_MAX_LENGTH,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderCourse,
  type PreorderSeatCourseCount,
  type PreorderCover,
  type PreorderOrder,
  type PreorderSelectionCourse,
} from '@/types/preorders'

const DIETARY_NOTE_MAX_LENGTH = 200
const GUEST_NAME_MAX_LENGTH = 100

const SEAT_COURSE_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '0', label: 'Not chosen yet' },
  { value: '1', label: '1 course' },
  { value: '2', label: '2 courses' },
  { value: '3', label: '3 courses' },
]

export type PreorderMenuOption = {
  id: string
  /** Widened for add-ons. The three single-choice courses fill the dropdowns; 'addon' fills the tick-boxes. */
  course: PreorderSelectionCourse
  name: string
  priceGbp: number | null
}

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
  /**
   * A manager may still record a change after the cutoff (owner decision D21). The server action
   * checks the same permission again; this only decides whether the form is offered.
   */
  canRecordLate?: boolean
  /** The booking is confirmed, so the organiser can be sent their food link. */
  bookingConfirmed?: boolean
}

export type DraftCover = {
  guestName: string
  dietaryNote: string
  /** The seat's tier, 0 to 3; null on a booking with no course list. */
  courseCount: PreorderSeatCourseCount | null
  /** Null until the allergy question is answered. */
  hasAllergies: boolean | null
  allergyDetail: string
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
    courseCount: cover.courseCount ?? null,
    hasAllergies: cover.hasAllergies ?? null,
    allergyDetail: cover.allergyDetail ?? '',
    choices,
    addonMenuItemIds,
  }
}

/**
 * A seat moving to another number of courses, applied to what is on screen so it matches what the
 * database will keep. 0 or 1 course has no starter or dessert, so both are cleared. A kids main is
 * 1 course only (A1), so it is cleared on 2 or 3. A seat going to 2 courses with a starter AND a
 * dessert keeps both on screen, marked, because only staff know which one the guest wants.
 */
export function applySeatTierChange(
  draft: DraftCover,
  next: PreorderSeatCourseCount,
  childOptionIds: ReadonlySet<string>,
): DraftCover {
  const choices = { ...draft.choices }
  if (next === 0 || next === 1) {
    choices.starter = ''
    choices.dessert = ''
  }
  if ((next === 2 || next === 3) && choices.main && childOptionIds.has(choices.main)) {
    choices.main = ''
  }
  return { ...draft, courseCount: next, choices }
}

/** A 2 course seat holding a starter and a dessert: the save would be refused, so it is caught first. */
function hasTooManyOthers(draft: DraftCover): boolean {
  return draft.courseCount === 2 && Boolean(draft.choices.starter) && Boolean(draft.choices.dessert)
}

/**
 * What the seat still needs, judged on what is typed rather than what is saved, so the badge moves as
 * staff pick. Null when the seat has everything its tier pays for.
 */
function draftMissingCourses(draft: DraftCover): string | null {
  const selections = PREORDER_COURSES.filter((course) => Boolean(draft.choices[course])).map((course) => ({ course }))
  return describeCoverMissingCourses({
    selections,
    courseCount: draft.courseCount,
    guestName: draft.guestName,
    hasAllergies: draft.hasAllergies,
    allergyDetail: draft.allergyDetail,
  })
}

/**
 * Where a seat stands, beside the badge for what it still needs. A seat the guest filled in through
 * their own link says so, so staff do not overwrite it without knowing; a seat whose guest has been
 * sent a link and has not saved yet is "Invited".
 */
function seatSourceBadge(cover: PreorderCover): { tone: 'info' | 'neutral'; label: string } | null {
  if (cover.lastSavedBy === 'guest') return { tone: 'info', label: 'Chosen by guest' }
  if (cover.inviteSentAt) return { tone: 'neutral', label: 'Invited' }
  return null
}

/** The card's subtitle: the tier rule when the booking recorded tiers, the old rule when it did not. */
function describeSectionRule(order: PreorderOrder): string {
  return order.courseCounts
    ? 'Every guest needs a name, their allergies, their number of courses and their dishes: a main on 1 course, a main plus a starter or a dessert on 2, and all three on 3. Kids mains are 1 course only. Extras never make a seat complete.'
    : 'Every guest needs a main. A starter and a dessert are optional, and add-ons are extras that never make an order complete.'
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
 * What changed on this seat, part by part.
 *
 * Split rather than one dirty flag on purpose. A save re-snapshots the price of every course it is
 * told about, so sending the courses because somebody ticked a cheeseboard would quietly re-quote
 * the whole meal at today's menu price. Each part, and each course, is sent only when it moved.
 */
function diffCover(cover: PreorderCover, draft: DraftCover) {
  const saved = toDraftCover(cover)
  return {
    detailsDirty:
      saved.guestName.trim() !== draft.guestName.trim() ||
      saved.dietaryNote.trim() !== draft.dietaryNote.trim() ||
      saved.hasAllergies !== draft.hasAllergies ||
      (draft.hasAllergies === true && saved.allergyDetail.trim() !== draft.allergyDetail.trim()),
    tierDirty: saved.courseCount !== draft.courseCount,
    changedCourses: PREORDER_COURSES.filter((course) => saved.choices[course] !== draft.choices[course]),
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
  canRecordLate = false,
  bookingConfirmed = true,
}: SeasonalPreorderSectionProps) {
  const router = useRouter()
  const [saving, setSaving] = useState(false)
  const [syncing, setSyncing] = useState(false)

  // A save refreshes the route, so the covers come back as new props. What was on screen has just
  // been written, so adopting the fresh copy is right. Reset during render rather than in an
  // effect, keyed on the rows themselves, so a re-render for any other reason cannot throw away
  // half-typed work.
  // The tier and the last save are part of it: a tier lives on the booking, so changing only that
  // need not move the seat's own updated_at.
  const coversSignature = order.covers
    .map((cover) => `${cover.id}:${cover.updatedAt}:${cover.courseCount ?? ''}:${cover.lastSavedAt ?? ''}`)
    .join('|')
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

  const editable = canEdit && preorderEnabled && (!closed || canRecordLate)
  const recordingLate = editable && closed
  const completeness = useMemo(() => getPreorderCompleteness(order), [order])
  const seatsMismatched = order.covers.length !== order.partySize
  /** A Christmas booking on the food link: every seat has a tier, a name and an allergy answer. */
  const tiered = Array.isArray(order.courseCounts)
  // Kids mains, which are 1 course only (A1). From the period's menu facts, withdrawn dishes included.
  const childOptionIds = useMemo(
    () => new Set((order.menuItems ?? []).filter((item) => item.isChildOption).map((item) => item.id)),
    [order.menuItems],
  )

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
          return (
            changed.detailsDirty || changed.tierDirty || changed.changedCourses.length > 0 || changed.addonsDirty
          )
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

  function changeTier(coverId: string, next: PreorderSeatCourseCount) {
    setDraft((current) => {
      const coverDraft = current[coverId]
      if (!coverDraft) return current
      return { ...current, [coverId]: applySeatTierChange(coverDraft, next, childOptionIds) }
    })
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

  function renderGuestNameInput(coverId: string, coverDraft: DraftCover) {
    return (
      <Input
        label={tiered ? 'Guest name' : 'Guest name (optional)'}
        value={coverDraft.guestName}
        maxLength={GUEST_NAME_MAX_LENGTH}
        disabled={!editable}
        autoComplete="off"
        onChange={(event) => updateCover(coverId, { guestName: event.target.value })}
      />
    )
  }

  function renderDietaryNote(coverId: string, coverDraft: DraftCover) {
    return (
      <div>
        <Textarea
          label={tiered ? 'Other dietary needs (optional)' : 'Dietary requirement (optional)'}
          rows={2}
          value={coverDraft.dietaryNote}
          maxLength={DIETARY_NOTE_MAX_LENGTH}
          disabled={!editable}
          hint={`What we need to do for this guest, in ${DIETARY_NOTE_MAX_LENGTH} characters. Anyone with a serious allergy should ring the pub so we can talk it through. Staff and kitchen only.`}
          onChange={(event) => updateCover(coverId, { dietaryNote: event.target.value })}
        />
        <p className="mt-1 text-right text-xs text-text-muted">
          {coverDraft.dietaryNote.length}/{DIETARY_NOTE_MAX_LENGTH}
        </p>
      </div>
    )
  }

  /** "No allergies" or "Has allergies" with the details. Staff and kitchen only, never logged. */
  function renderAllergies(coverId: string, ordinal: number, coverDraft: DraftCover) {
    const detailMissing = coverDraft.hasAllergies === true && coverDraft.allergyDetail.trim() === ''
    return (
      <Fieldset legend="Allergies" required>
        <div className="flex flex-wrap gap-x-6">
          <Radio
            name={`seat-${ordinal}-allergies`}
            value="none"
            label="No allergies"
            checked={coverDraft.hasAllergies === false}
            disabled={!editable}
            onChange={() => updateCover(coverId, { hasAllergies: false })}
          />
          <Radio
            name={`seat-${ordinal}-allergies`}
            value="some"
            label="Has allergies"
            checked={coverDraft.hasAllergies === true}
            disabled={!editable}
            onChange={() => updateCover(coverId, { hasAllergies: true })}
          />
        </div>
        {coverDraft.hasAllergies === true && (
          <Textarea
            label="Their allergies"
            rows={2}
            value={coverDraft.allergyDetail}
            maxLength={PREORDER_ALLERGY_DETAIL_MAX_LENGTH}
            disabled={!editable}
            error={detailMissing ? 'Say what they are allergic to.' : undefined}
            onChange={(event) => updateCover(coverId, { allergyDetail: event.target.value })}
          />
        )}
      </Fieldset>
    )
  }

  async function handleSave() {
    if (dirtyCoverIds.length === 0) return
    setSaving(true)
    try {
      // A 2 course seat with a starter AND a dessert would be refused, so say which seat now.
      const overfull = order.covers.filter((cover) => dirtyCoverIds.includes(cover.id) && hasTooManyOthers(draft[cover.id]))
      if (overfull.length > 0) {
        toast.error(
          `Seat ${overfull.map((cover) => cover.ordinal).join(', ')} is on 2 courses: keep a starter or a dessert, not both.`,
        )
        return
      }

      const payload: StaffPreorderCoverInput[] = dirtyCoverIds.map((coverId) => {
        const cover = order.covers.find((entry) => entry.id === coverId)
        const coverDraft = draft[coverId]
        const changed = cover
          ? diffCover(cover, coverDraft)
          : { detailsDirty: true, tierDirty: true, changedCourses: [...PREORDER_COURSES], addonsDirty: true }

        return {
          coverId,
          guestName: coverDraft.guestName.trim() || null,
          dietaryNote: coverDraft.dietaryNote.trim() || null,
          ...(tiered
            ? {
                hasAllergies: coverDraft.hasAllergies,
                allergyDetail: coverDraft.hasAllergies === true ? coverDraft.allergyDetail.trim() || null : null,
              }
            : {}),
          // The tier goes first in the save, so a seat moved to 3 courses can take its starter in
          // the same save. Sent only when it moved.
          ...(tiered && changed.tierDirty && coverDraft.courseCount !== null ? { courseCount: coverDraft.courseCount } : {}),
          // Only the courses that moved. Naming a course rewrites its price snapshot, and naming the
          // add-ons rewrites theirs, so an untouched part is left out rather than re-quoted.
          ...(changed.changedCourses.length > 0
            ? {
                selections: changed.changedCourses.map((course) => ({
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

  // CardHeader wraps its subtitle, so the full sentence staff need to read sits under the title.
  return (
    <Card>
      <CardHeader
        title={`Seasonal Pre-Order${order.periodName ? ` · ${order.periodName}` : ''}`}
        subtitle={describeSectionRule(order)}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={PREORDER_COMPLETENESS_TONE[completeness.complete ? 'complete' : 'incomplete']}>
              {completeness.complete ? 'Complete' : 'Not complete'}
            </Badge>
            {editable && (
              <Button
                size="sm"
                onClick={handleSave}
                loading={saving}
                disabled={saving || dirtyCoverIds.length === 0}
              >
                {dirtyCoverIds.length > 0
                  ? `Save ${dirtyCoverIds.length} Seat${dirtyCoverIds.length === 1 ? '' : 's'}${recordingLate ? ' as Late' : ''}`
                  : 'Saved'}
              </Button>
            )}
          </div>
        }
      />

      <CardBody className="space-y-4">
        <p className="text-sm text-text">{describePreorderGaps(completeness)}</p>

        {order.bookingAllergies.length > 0 && (
          <Alert tone="info" role="status" title="Allergies recorded on the booking">
            {order.bookingAllergies.join(', ')}
          </Alert>
        )}

        {closed && (
          <Alert tone="warning" title="Pre-orders have closed for this booking">
            {closesAtIso
              ? `Choices closed at noon on ${formatDateInLondon(closesAtIso, { weekday: 'long', day: 'numeric', month: 'long' })}. `
              : ''}
            {recordingLate
              ? 'The organiser and their guests can no longer change anything. As a manager you can still change any seat, its number of courses included: it is marked as changed after the cutoff on the booking sheet and the kitchen totals.'
              : 'The kitchen has already ordered to these numbers, so a manager has to record any change now.'}
          </Alert>
        )}

        {canEdit && preorderEnabled && (
          <FoodLinkActions tableBookingId={order.tableBookingId} closed={closed} bookingConfirmed={bookingConfirmed} />
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
            This booking is for {order.partySize} but has {order.covers.length} pre-order seat
            {order.covers.length === 1 ? '' : 's'}.
            {editable && (
              <div className="mt-3">
                <Button size="sm" variant="secondary" onClick={handleSync} loading={syncing} disabled={syncing}>
                  {order.covers.length === 0
                    ? order.requiresPreorder
                      ? 'Start the Pre-Order'
                      : 'Add Seats for Guest Names'
                    : 'Put the Seats Right'}
                </Button>
              </div>
            )}
          </Alert>
        )}

        {order.covers.length === 0 ? (
          <Empty size="sm" title="No seats set up yet" description="Nothing has been chosen for this booking." />
        ) : (
          <ul className="divide-y divide-border">
            {order.covers.map((cover) => {
              const coverDraft = draft[cover.id]
              if (!coverDraft) return null
              // A Christmas seat's tier is the one on screen, so the badge and the course boxes
              // follow the courses select as staff change it. An older booking keeps its own.
              const courseCount = tiered ? coverDraft.courseCount : getSeatCourseCount(order, cover.ordinal)
              const missing = draftMissingCourses({ ...coverDraft, courseCount })
              const tooManyOthers = hasTooManyOthers({ ...coverDraft, courseCount })
              const source = tiered ? seatSourceBadge(cover) : null
              const withdrawn = cover.selections.filter((selection) => selection.itemWithdrawn)
              const addons = addonsByCover.get(cover.id)
              // On 0 or 1 course a seat has a main only. A booking with no list keeps all three.
              const courses = tiered
                ? PREORDER_COURSES.filter((course) => course === 'main' || courseCount === 2 || courseCount === 3)
                : PREORDER_COURSES

              return (
                <li key={cover.id} className="space-y-3 py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <SubHeading>
                      Seat {cover.ordinal}
                      {courseCount ? ` · ${describeCourseCount(courseCount)}` : ''}
                    </SubHeading>
                    {missing ? (
                      <Badge tone="warning">Needs {missing}</Badge>
                    ) : (
                      tiered && <Badge tone="success">Complete</Badge>
                    )}
                    {source && <Badge tone={source.tone}>{source.label}</Badge>}
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
                    {renderGuestNameInput(cover.id, coverDraft)}
                    {tiered && (
                      <Select
                        label="Courses"
                        value={String(courseCount ?? 0)}
                        options={SEAT_COURSE_OPTIONS}
                        disabled={!editable}
                        error={courseCount === 0}
                        onChange={(event) =>
                          changeTier(cover.id, Number(event.target.value) as PreorderSeatCourseCount)
                        }
                      />
                    )}
                    {courses.map((course) => (
                      <CourseSelect
                        key={course}
                        course={course}
                        courseCount={courseCount}
                        tooManyOthers={tooManyOthers}
                        value={coverDraft.choices[course]}
                        options={
                          // Kids mains are 1 course only, so they are not offered on 2 or 3.
                          course === 'main' && (courseCount === 2 || courseCount === 3)
                            ? optionsByCourse.main.filter((option) => !childOptionIds.has(option.id))
                            : optionsByCourse[course]
                        }
                        childOptionIds={childOptionIds}
                        selectedName={
                          cover.selections.find((selection) => selection.course === course)?.itemName ?? null
                        }
                        disabled={!editable}
                        onChange={(menuItemId) => updateChoice(cover.id, course, menuItemId)}
                      />
                    ))}
                  </div>

                  {tiered && renderAllergies(cover.id, cover.ordinal, coverDraft)}

                  {renderDietaryNote(cover.id, coverDraft)}

                  {addons && addons.rows.length > 0 && (
                    <Fieldset legend={tiered ? 'Extras (on top of the meal)' : 'Add-ons (extras, on top of the meal)'}>
                      <p className="text-xs text-text">{describeSeatAddons(addons.summary)}</p>
                      <div className="mt-0.5 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2 xl:grid-cols-3">
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
                    </Fieldset>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardBody>

      {(addonOptions.length > 0 || bookingAddons.count > 0) && order.covers.length > 0 && (
        <CardFooter>
          <SubHeading>Add-ons to Put on the Bill</SubHeading>
          <p className="mt-1 text-sm font-semibold text-text">
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
            <ul className="mt-1 space-y-0.5 text-xs text-text">
              {order.covers.map((cover) => {
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
          <p className="mt-1 text-xs text-text-muted">{PREORDER_ADDON_STAFF_NOTE}</p>
        </CardFooter>
      )}
    </Card>
  )
}

/**
 * The label for one course on a seat of this tier. 3 courses needs all three; 2 courses needs a main
 * and one of the other two; a seat with no tier keeps the old rule of a main with the rest optional.
 */
function courseSelectLabel(course: PreorderCourse, courseCount: PreorderSeatCourseCount | null): string {
  if (course === 'main' || courseCount === 3) return `${PREORDER_COURSE_LABELS[course]} (required)`
  if (courseCount === 2) return course === 'starter' ? 'Starter (or a dessert)' : 'Dessert (or a starter)'
  return `${PREORDER_COURSE_LABELS[course]} (optional)`
}

/**
 * One course for one seat. A dish withdrawn from the menu is still shown, disabled, so the screen
 * says what the guest actually chose instead of silently reading as an empty answer.
 */
function CourseSelect({
  course,
  courseCount,
  tooManyOthers,
  value,
  options,
  childOptionIds,
  selectedName,
  disabled,
  onChange,
}: {
  course: PreorderCourse
  courseCount: PreorderSeatCourseCount | null
  /** A 2 course seat holding a starter and a dessert: both are marked, because one must go. */
  tooManyOthers: boolean
  value: string
  options: PreorderMenuOption[]
  /** Kids mains, labelled as 1 course only. */
  childOptionIds: ReadonlySet<string>
  selectedName: string | null
  disabled: boolean
  onChange: (menuItemId: string) => void
}) {
  const withdrawn = Boolean(value) && !options.some((option) => option.id === value)
  const unavailableNote = childOptionIds.has(value) ? 'kids main, 1 course only' : 'no longer on the menu'
  const required = course === 'main' || courseCount === 3

  return (
    <Select
      label={courseSelectLabel(course, courseCount)}
      value={value}
      disabled={disabled}
      error={(required && !value) || (tooManyOthers && course !== 'main')}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{required ? 'Not chosen yet' : 'Not having one'}</option>
      {withdrawn && (
        <option value={value} disabled>
          {selectedName ?? 'Previous choice'} ({unavailableNote})
        </option>
      )}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
          {childOptionIds.has(option.id) ? ' (kids, 1 course only)' : ''}
          {option.priceGbp != null ? ` · ${formatGbp(option.priceGbp)}` : ''}
        </option>
      ))}
    </Select>
  )
}

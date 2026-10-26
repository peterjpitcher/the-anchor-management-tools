'use client'

import { useEffect, useId, useState } from 'react'
import { Alert, Checkbox, Fieldset, Select } from '@/ds'

const COURSE_OPTIONS = [
  { value: '0', label: 'Choose courses' },
  { value: '1', label: '1 course' },
  { value: '2', label: '2 courses' },
  { value: '3', label: '3 courses' },
]

const COURSES_HELP =
  'Guests on one course have nothing to pre-order. Two or three courses need food choices by the pre-order deadline.'

const LATE_HELP =
  'The pre-order deadline has passed, so this is saved as a late change. Guests can leave, or join on 1 course, but nobody can move up to more courses.'

const LATE_MANAGER_ONLY =
  'The pre-order deadline has passed, so only a manager can change the numbers or courses on this booking now.'

/** What the party-size routes need for a Christmas booking: every guest's tier, and who is leaving. */
export type ChristmasPartyChange = {
  courseCounts: number[]
  /** Seat numbers, as numbered now, of the guests who are not coming. */
  removedSeats: number[]
}

interface ChristmasCourseFieldsProps {
  bookingId: string
  partySize: number
  onChange: (change: ChristmasPartyChange | undefined) => void
  /**
   * `foh` keeps the look these fields had before the design-system pass (a plain heading and one
   * compact "Guest N" row per seat), for the FOH kiosk's party-size dialog, which the owner keeps
   * exactly as it is. Every other caller leaves this at `default`, the DS look.
   */
  appearance?: 'default' | 'foh'
}

const FIRST_TIME_HELP =
  'No courses are recorded for this Christmas booking yet. Choose them for every guest to record them; leave them blank to change only the party size.'

type Loaded = {
  /** The tiers on the booking now. Empty when none are recorded yet. */
  recorded: number[]
  firstTime: boolean
  seatNames: Array<string | null>
  deadline: 'open' | 'closed' | 'none'
  canChangeLate: boolean
}

function courseWord(count: number): string {
  return count === 1 ? '1 course' : `${count} courses`
}

/**
 * Bookings with tiers show one control per guest. A Christmas booking with none recorded (taken by
 * staff before BK-057) shows the same controls once, so its tiers can be set; nothing is sent until
 * every guest has one, so a plain party-size change still works. Any other booking shows nothing.
 *
 * Making a party smaller asks who is not coming (BK-054), so that guest's own seat and dishes go
 * rather than the last guest's: courses and dishes are matched by seat number. Nothing is sent until
 * exactly that many guests are ticked. After the pre-order deadline (D21) a guest can only stay on
 * their tier or move down, and anyone joining is on 1 course.
 */
export function ChristmasCourseFields({ bookingId, partySize, onChange, appearance = 'default' }: ChristmasCourseFieldsProps) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [failed, setFailed] = useState(false)
  const [seatTiers, setSeatTiers] = useState<number[]>([])
  const [addedTiers, setAddedTiers] = useState<number[]>([])
  const [leaving, setLeaving] = useState<number[]>([])
  const idBase = useId()
  useEffect(() => {
    const controller = new AbortController()
    setLoaded(null)
    setFailed(false)
    setSeatTiers([])
    setAddedTiers([])
    setLeaving([])
    onChange(undefined)
    void fetch(`/api/foh/bookings/${bookingId}/christmas-courses`, { signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error('Could not load courses')
        const data = await response.json()
        if (controller.signal.aborted) return
        const deadline = data.deadline === 'closed' || data.deadline === 'open' ? data.deadline : 'none'
        const common = {
          seatNames: Array.isArray(data.seat_names) ? data.seat_names : [],
          deadline,
          canChangeLate: data.can_change_late === true,
        } as const
        if (data.course_counts) {
          setLoaded({ recorded: data.course_counts, firstTime: false, ...common })
          setSeatTiers(data.course_counts)
        } else if (data.can_set === true) {
          setLoaded({ recorded: [], firstTime: true, ...common })
        }
      }).catch(() => { if (!controller.signal.aborted) setFailed(true) })
    return () => controller.abort()
  }, [bookingId, onChange])

  const size = Math.min(20, Math.max(0, partySize || 0))
  const late = loaded?.deadline === 'closed'
  const recordedCount = loaded?.recorded.length ?? 0
  const shrinking = Boolean(loaded) && !loaded?.firstTime && size < recordedCount
  const needLeaving = shrinking ? recordedCount - size : 0
  const addedCount = loaded ? (loaded.firstTime ? size : Math.max(0, size - recordedCount)) : 0
  const newSeatTier = (index: number) => addedTiers[index] ?? (late ? 1 : 0)

  useEffect(() => {
    if (!loaded) return
    const added = Array.from({ length: addedCount }, (_, index) => newSeatTier(index))
    // Recording tiers for the first time is all or nothing: half a list would be refused.
    if (loaded.firstTime) {
      onChange(added.some((count) => count < 1 || count > 3) ? undefined : { courseCounts: added, removedSeats: [] })
      return
    }
    if (shrinking) {
      if (leaving.length !== needLeaving) {
        onChange(undefined)
        return
      }
      const removed = new Set(leaving)
      onChange({
        courseCounts: seatTiers.filter((_, index) => !removed.has(index + 1)),
        removedSeats: [...leaving].sort((a, b) => a - b),
      })
      return
    }
    onChange({ courseCounts: [...seatTiers, ...added], removedSeats: [] })
    // newSeatTier reads addedTiers and late, both listed.
  }, [loaded, seatTiers, addedTiers, leaving, shrinking, needLeaving, addedCount, late, onChange])

  const isFoh = appearance === 'foh'

  if (failed) {
    return isFoh ? (
      <p role="alert" className="text-sm text-danger">
        Course choices could not be loaded. Refresh before changing a Christmas booking.
      </p>
    ) : (
      <Alert tone="danger">
        Course choices could not be loaded. Refresh before changing a Christmas booking.
      </Alert>
    )
  }
  if (!loaded) return null

  const guestLabel = (seat: number) => {
    const name = loaded.seatNames[seat - 1]
    return name ? `Guest ${seat} (${name})` : `Guest ${seat}`
  }
  // After the deadline a guest who stays can keep their tier or move down; a new guest is on 1 course.
  const optionsUpTo = (max: number) => COURSE_OPTIONS.filter((option) => Number(option.value) >= 1 && Number(option.value) <= max)
  const keptOptions = (seat: number) => (late ? optionsUpTo(loaded.recorded[seat - 1] ?? 1) : COURSE_OPTIONS)
  const newOptions = late ? optionsUpTo(1) : COURSE_OPTIONS
  const help = loaded.firstTime
    ? FIRST_TIME_HELP
    : late
      ? (loaded.canChangeLate ? LATE_HELP : LATE_MANAGER_ONLY)
      : COURSES_HELP

  const toggleLeaving = (seat: number, isLeaving: boolean) =>
    setLeaving((current) => (isLeaving ? [...current.filter((value) => value !== seat), seat] : current.filter((value) => value !== seat)))
  const setKeptTier = (seat: number, value: string) =>
    setSeatTiers((current) => current.map((tier, index) => (index === seat - 1 ? Number(value) : tier)))
  const setNewTier = (index: number, value: string) =>
    setAddedTiers(Array.from({ length: Math.max(addedCount, index + 1) }, (_, position) => (position === index ? Number(value) : newSeatTier(position))))

  // Rows in seat order: the guests on the booking now (unless ticked as not coming), then anyone new.
  const rows: Array<{ key: string; label: string; value: number; options: typeof COURSE_OPTIONS; onSelect: (value: string) => void }> = []
  if (!loaded.firstTime) {
    loaded.recorded.forEach((_, index) => {
      const seat = index + 1
      if (leaving.includes(seat)) return
      rows.push({ key: `kept-${seat}`, label: guestLabel(seat), value: seatTiers[index] ?? 0, options: keptOptions(seat), onSelect: (value) => setKeptTier(seat, value) })
    })
  }
  for (let index = 0; index < addedCount; index += 1) {
    const seat = (loaded.firstTime ? 0 : recordedCount) + index + 1
    rows.push({ key: `new-${seat}`, label: `Guest ${seat}`, value: newSeatTier(index), options: newOptions, onSelect: (value) => setNewTier(index, value) })
  }

  const leavingPrompt = `Who is not coming? Tick ${needLeaving === 1 ? '1 guest' : `${needLeaving} guests`}.`
  const leavingBoxes = shrinking
    ? loaded.recorded.map((tier, index) => {
        const seat = index + 1
        return (
          <Checkbox
            key={seat}
            label={`${guestLabel(seat)}, ${courseWord(tier)}`}
            checked={leaving.includes(seat)}
            onChange={(checked) => toggleLeaving(seat, checked)}
          />
        )
      })
    : null

  if (isFoh) {
    // The pre-branch FOH markup, rebuilt from DS parts: the old raw <label> and <select> are not
    // allowed in staff code any more (tests/guards/page-contract.test.ts). Each row keeps the
    // "Guest N" text beside a compact select, and the text names the select.
    return (
      <div className="space-y-3">
        {shrinking && (
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium">{leavingPrompt}</legend>
            {leavingBoxes}
          </fieldset>
        )}
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Christmas courses for each guest</legend>
          <p className="text-sm">{help}</p>
          {rows.map((row) => {
            const labelId = `${idBase}-${row.key}`
            return (
              <div key={row.key} className="flex items-center gap-3 text-sm">
                <span id={labelId}>{row.label}</span>
                <Select
                  aria-labelledby={labelId}
                  value={String(row.value)}
                  options={row.options}
                  className="h-auto w-auto min-h-touch rounded-sm border-border-strong"
                  onChange={(event) => row.onSelect(event.target.value)}
                />
              </div>
            )
          })}
        </fieldset>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {shrinking && (
        <Fieldset legend={leavingPrompt}>
          <div className="space-y-1">{leavingBoxes}</div>
        </Fieldset>
      )}
      <Fieldset legend="Christmas courses for each guest">
        <div className="space-y-3">
          <p className="text-sm text-text">{help}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <Select
                key={row.key}
                label={row.label}
                value={String(row.value)}
                options={row.options}
                onChange={(event) => row.onSelect(event.target.value)}
              />
            ))}
          </div>
        </div>
      </Fieldset>
    </div>
  )
}

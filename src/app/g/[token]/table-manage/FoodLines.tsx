'use client'

/**
 * The guest lines on the Christmas food page, and the one line on a guest's own link.
 *
 * Every guest, on 1, 2 or 3 courses, needs a name, their allergies, their number of courses and
 * their dishes (owner decision D4, 6 November 2026): 1 course is a main; 2 courses a main plus a
 * starter or a dessert, which the guest picks; 3 courses all three. Kids mains are 1 course only
 * (A1), so they are not offered on 2 or 3 and a kids main is dropped when the tier moves up.
 *
 * Each line saves on its own, so an organiser can fill in the guests they know and come back. The
 * page posts the whole line as JSON and shows what the server saved, so "Saved" always means saved.
 * Once the cutoff passes every line is read only (D8).
 *
 * Imports the guest primitives file by file, never through the barrel, so the guest webfonts stay
 * out of the client bundle (see src/components/features/guest/index.ts).
 */

import { useMemo, useState } from 'react'
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestBadge } from '@/components/features/guest/GuestBadge'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestChoice } from '@/components/features/guest/GuestChoice'
import { GuestInput, GuestSelect, GuestTextarea } from '@/components/features/guest/GuestControls'
import { GuestField } from '@/components/features/guest/GuestField'
import { GUEST_BODY_CLASS, GUEST_MUTED_CLASS, GUEST_NOTE_CLASS, GUEST_SUNK_BOX_CLASS } from '@/components/features/guest/styles'
import { cn } from '@/lib/utils'
import type { PreorderSeatCourseCount } from '@/types/preorders'
import type { FoodActionResult, FoodDish, FoodMenu, FoodSeatView } from './food-types'
import { PREORDER_SEAT_BLOCK_CLASS } from './formStyles'

export type FoodLinesProps = {
  mode: 'organiser' | 'guest'
  /** Where a line posts: the organiser's `/food` route or the guest's `/save` route. */
  endpoint: string
  seats: FoodSeatView[]
  menu: FoodMenu
  /** True once the cutoff has passed: every line is shown as a record, with `closedMessage`. */
  locked: boolean
  closedMessage: string
  /** "noon on Friday 4 December 2026", or null when the booking has no cutoff. */
  deadlineLabel: string | null
  /** Organiser only: show "Email me a copy" (the `table_preorder_choices_copy` switch). */
  copyEnabled?: boolean
  /** The phone number, for the failure lines. */
  phoneDisplay: string
}

const SEAT_TITLE_CLASS = 'font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'
const ALLERGY_BOX_CLASS = 'rounded-guest-field border border-guest-danger-border bg-guest-danger-soft p-3'

function displayName(seat: Pick<FoodSeatView, 'guestName' | 'ordinal'>): string {
  return seat.guestName?.trim().split(/\s+/)[0] || `guest ${seat.ordinal}`
}

function lineTitle(seat: Pick<FoodSeatView, 'guestName' | 'ordinal'>, mode: FoodLinesProps['mode']): string {
  if (mode === 'guest') return 'Your choices'
  const name = seat.guestName?.trim()
  return name ? `Guest ${seat.ordinal}: ${name}` : `Guest ${seat.ordinal}`
}

function coursesLabel(count: PreorderSeatCourseCount): string {
  if (count === 0) return 'Not chosen yet'
  return count === 1 ? '1 course' : `${count} courses`
}

function dishLabel(dish: FoodDish): string {
  return dish.isChildOption ? `${dish.name} (kids, 1 course only)` : dish.name
}

function addonLabel(dish: FoodDish): string {
  if (dish.priceGbp === null) return `${dish.name}, price on the day`
  const price = Number.isInteger(dish.priceGbp) ? `£${dish.priceGbp}` : `£${dish.priceGbp.toFixed(2)}`
  return `${dish.name}, ${price}`
}

type Draft = {
  guestName: string
  hasAllergies: boolean | null
  allergyDetail: string
  dietaryNote: string
  courseCount: PreorderSeatCourseCount
  starterId: string
  mainId: string
  dessertId: string
  /** On 2 courses, which of the two the guest is having. */
  other: 'starter' | 'dessert' | null
  addonIds: string[]
}

function toDraft(seat: FoodSeatView): Draft {
  return {
    guestName: seat.guestName ?? '',
    hasAllergies: seat.hasAllergies,
    allergyDetail: seat.allergyDetail ?? '',
    dietaryNote: seat.dietaryNote ?? '',
    courseCount: seat.courseCount,
    starterId: seat.starterId ?? '',
    mainId: seat.mainId ?? '',
    dessertId: seat.dessertId ?? '',
    other: seat.starterId ? 'starter' : seat.dessertId ? 'dessert' : null,
    addonIds: seat.addonIds,
  }
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'busy' }
  | { kind: 'saved'; text: string }
  | { kind: 'error'; text: string }

async function postJson(endpoint: string, body: unknown, phoneDisplay: string): Promise<FoodActionResult | { success: true; message: string }> {
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await response.json().catch(() => null)) as FoodActionResult | { success: true; message: string } | null
    if (json && typeof json === 'object' && 'success' in json) return json
    return { success: false, error: `We couldn't save that. Please try again, or call us on ${phoneDisplay}.` }
  } catch {
    return { success: false, error: "We couldn't save that just now. Check your connection and try again." }
  }
}

/** The read-only record of one line, after the cutoff. */
function LockedLine({ seat, menu, mode }: { seat: FoodSeatView; menu: FoodMenu; mode: FoodLinesProps['mode'] }) {
  const byId = new Map([...menu.starter, ...menu.main, ...menu.dessert, ...menu.addons].map((dish) => [dish.id, dish.name]))
  const chosen = [
    seat.starterId ? `Starter: ${byId.get(seat.starterId) ?? 'chosen'}` : null,
    seat.mainId ? `Main: ${byId.get(seat.mainId) ?? 'chosen'}` : null,
    seat.dessertId ? `Dessert: ${byId.get(seat.dessertId) ?? 'chosen'}` : null,
    ...seat.withdrawn.map((line) => `${line} (no longer on the menu)`),
  ].filter((line): line is string => Boolean(line))
  const extras = seat.addonIds.map((id) => byId.get(id)).filter((name): name is string => Boolean(name))

  return (
    <li className={cn(PREORDER_SEAT_BLOCK_CLASS, GUEST_BODY_CLASS)}>
      <p className={SEAT_TITLE_CLASS}>
        {lineTitle(seat, mode)}, {coursesLabel(seat.courseCount).toLowerCase()}
      </p>
      {seat.hasAllergies ? (
        <p className={cn('mt-1', ALLERGY_BOX_CLASS)}>Allergies: {seat.allergyDetail || 'details not given'}</p>
      ) : seat.hasAllergies === false ? (
        <p className="mt-1">No allergies</p>
      ) : null}
      {chosen.length > 0 ? (
        <ul className="mt-1">
          {chosen.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="mt-1">Nothing chosen.</p>
      )}
      {extras.length > 0 && <p className="mt-1">Extras: {extras.join(', ')}</p>}
      {seat.dietaryNote && <p className="mt-1">Other dietary needs: {seat.dietaryNote}</p>}
      {seat.missing && <p className={cn('mt-1', GUEST_MUTED_CLASS)}>Still needed: {seat.missing}.</p>}
    </li>
  )
}

/** "Send them a link to choose", "Waiting for Sam" or "Chosen by Sam". Organiser page only. */
function InviteControls({
  seat,
  endpoint,
  phoneDisplay,
  onSeat,
}: {
  seat: FoodSeatView
  endpoint: string
  phoneDisplay: string
  onSeat: (seat: FoodSeatView) => void
}) {
  const [open, setOpen] = useState(false)
  const [email, setEmail] = useState(seat.inviteEmail ?? '')
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const name = displayName(seat)
  const id = `seat-${seat.ordinal}-invite`

  // "Chosen by Sam" is in the line's status row; nothing more to send once they have.
  if (seat.lastSavedBy === 'guest') return null

  async function send() {
    const trimmed = email.trim()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(trimmed)) {
      setState({ kind: 'error', text: "That email address doesn't look right. Check it and try again." })
      return
    }
    setState({ kind: 'busy' })
    const result = await postJson(endpoint, { action: 'invite', ordinal: seat.ordinal, coverId: seat.coverId, email: trimmed }, phoneDisplay)
    if (!result.success) {
      setState({ kind: 'error', text: result.error })
      return
    }
    if ('seat' in result) onSeat(result.seat)
    setOpen(false)
    setState({ kind: 'saved', text: `Link sent to ${trimmed}.` })
  }

  const sent = Boolean(seat.inviteSentAt)

  return (
    <div className="flex flex-col gap-guest-xs">
      {sent && seat.missing && (
        <p className={GUEST_NOTE_CLASS}>
          <GuestBadge tone="outstanding">Waiting for {name}</GuestBadge>
        </p>
      )}
      {state.kind === 'saved' && (
        <p role="status" className={GUEST_NOTE_CLASS}>
          {state.text}
        </p>
      )}
      {!open && (!sent || seat.canResendInvite) && (
        <div>
          <GuestButton variant="link" onClick={() => setOpen(true)} aria-expanded={false} aria-controls={id}>
            {sent ? 'Resend their link' : 'Send them a link to choose'}
          </GuestButton>
        </div>
      )}
      {open && (
        <div id={id} className={cn(GUEST_SUNK_BOX_CLASS, 'flex flex-col gap-guest-sm')}>
          <GuestField
            id={`${id}-email`}
            label={`${seat.guestName?.trim() ? `${name}'s` : 'Their'} email address`}
            hint="We'll email them a link to choose their own food, and one reminder if they haven't. We won't use it for anything else."
            error={state.kind === 'error' ? state.text : undefined}
          >
            <GuestInput
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="off"
              maxLength={254}
              value={email}
              invalid={state.kind === 'error'}
              aria-invalid={state.kind === 'error' || undefined}
              aria-describedby={[`${id}-email-hint`, state.kind === 'error' ? `${id}-email-error` : null].filter(Boolean).join(' ')}
              onChange={(event) => setEmail(event.target.value)}
            />
          </GuestField>
          <div className="flex flex-wrap gap-guest-sm">
            <GuestButton size="sm" onClick={send} loading={state.kind === 'busy'} loadingText="Sending...">
              Send link
            </GuestButton>
            <GuestButton
              size="sm"
              variant="ghost"
              onClick={() => {
                setOpen(false)
                setState({ kind: 'idle' })
              }}
            >
              Cancel
            </GuestButton>
          </div>
        </div>
      )}
    </div>
  )
}

function FoodLine({
  seat,
  menu,
  mode,
  endpoint,
  phoneDisplay,
  deadlineLabel,
  onSeat,
}: {
  seat: FoodSeatView
  menu: FoodMenu
  mode: FoodLinesProps['mode']
  endpoint: string
  phoneDisplay: string
  deadlineLabel: string | null
  onSeat: (seat: FoodSeatView) => void
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(seat))
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  const prefix = `seat-${seat.ordinal}`
  const tier = draft.courseCount

  function update(patch: Partial<Draft>) {
    setDraft((current) => ({ ...current, ...patch }))
    if (state.kind !== 'busy') setState({ kind: 'idle' })
  }

  function chooseTier(next: PreorderSeatCourseCount) {
    setDraft((current) => {
      const main = menu.main.find((dish) => dish.id === current.mainId)
      return {
        ...current,
        courseCount: next,
        // Kids mains are 1 course only, so one does not survive a move to 2 or 3.
        mainId: next >= 2 && main?.isChildOption ? '' : current.mainId,
        other: next === 2 ? current.other ?? (current.starterId ? 'starter' : current.dessertId ? 'dessert' : null) : current.other,
      }
    })
    if (state.kind !== 'busy') setState({ kind: 'idle' })
  }

  const mains = tier >= 2 ? menu.main.filter((dish) => !dish.isChildOption) : menu.main
  const showStarter = tier === 3 || (tier === 2 && draft.other === 'starter')
  const showDessert = tier === 3 || (tier === 2 && draft.other === 'dessert')
  const allergyMissing = draft.hasAllergies === true && draft.allergyDetail.trim() === ''

  async function save() {
    setState({ kind: 'busy' })
    const payload = {
      ordinal: seat.ordinal,
      coverId: seat.coverId,
      guestName: draft.guestName,
      hasAllergies: draft.hasAllergies,
      allergyDetail: draft.hasAllergies ? draft.allergyDetail : null,
      dietaryNote: draft.dietaryNote,
      courseCount: draft.courseCount,
      starterId: showStarter && draft.starterId ? draft.starterId : null,
      mainId: tier >= 1 && draft.mainId ? draft.mainId : null,
      dessertId: showDessert && draft.dessertId ? draft.dessertId : null,
      ...(menu.addons.length > 0 ? { addonIds: draft.addonIds } : {}),
    }
    const result = await postJson(endpoint, mode === 'organiser' ? { action: 'save', seat: payload } : { seat: payload }, phoneDisplay)
    // The saved record updates the status either way; the form only takes it on a successful save,
    // so a refused save keeps what the person typed for them to correct.
    if ('seat' in result && result.seat) onSeat(result.seat)
    if (result.success && 'seat' in result && result.seat) setDraft(toDraft(result.seat))
    if (!result.success) {
      setState({ kind: 'error', text: result.error })
      return
    }
    const saved = 'seat' in result ? result.seat : null
    if (mode === 'guest') {
      setState({
        kind: 'saved',
        text: saved?.missing
          ? `Saved. You still need to add ${saved.missing}.`
          : `Thank you, your choices are saved.${deadlineLabel ? ` You can still change them until ${deadlineLabel}.` : ''}`,
      })
    } else {
      setState({ kind: 'saved', text: saved?.missing ? `Saved. Still needs ${saved.missing}.` : 'Saved. This guest is done.' })
    }
  }

  return (
    <li>
      <fieldset className={PREORDER_SEAT_BLOCK_CLASS} aria-describedby={`${prefix}-status`}>
        <legend className={cn('px-1', SEAT_TITLE_CLASS)}>{lineTitle(seat, mode)}</legend>

        <div className="flex flex-col gap-guest-md">
          <div id={`${prefix}-status`} className="flex flex-wrap items-center gap-guest-xs">
            {seat.missing ? (
              <GuestBadge tone="outstanding">Still needs {seat.missing}</GuestBadge>
            ) : (
              <GuestBadge tone="success">Done</GuestBadge>
            )}
            {seat.hasAllergies && <GuestBadge tone="danger">Allergies</GuestBadge>}
            {mode === 'organiser' && seat.lastSavedBy === 'guest' && <GuestBadge tone="success">Chosen by {displayName(seat)}</GuestBadge>}
          </div>

          {seat.withdrawn.length > 0 && (
            <GuestAlert tone="notice">{seat.withdrawn.join(' and ')} is no longer on the menu. Please choose again.</GuestAlert>
          )}

          <GuestField id={`${prefix}-name`} label={mode === 'guest' ? 'Your name' : 'Name'} required>
            <GuestInput
              id={`${prefix}-name`}
              type="text"
              maxLength={100}
              autoComplete={mode === 'guest' ? 'name' : 'off'}
              value={draft.guestName}
              onChange={(event) => update({ guestName: event.target.value })}
            />
          </GuestField>

          <fieldset className={cn('flex flex-col gap-guest-xs', draft.hasAllergies && ALLERGY_BOX_CLASS)}>
            <legend className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
              Allergies <span aria-hidden="true">*</span>
            </legend>
            <div className="flex flex-wrap gap-x-guest-lg">
              <GuestChoice
                type="radio"
                id={`${prefix}-allergies-no`}
                name={`${prefix}-allergies`}
                checked={draft.hasAllergies === false}
                onChange={() => update({ hasAllergies: false })}
                label="No allergies"
              />
              <GuestChoice
                type="radio"
                id={`${prefix}-allergies-yes`}
                name={`${prefix}-allergies`}
                checked={draft.hasAllergies === true}
                onChange={() => update({ hasAllergies: true })}
                label="Has allergies"
              />
            </div>
            {draft.hasAllergies && (
              <GuestField
                id={`${prefix}-allergy-detail`}
                label="What are they allergic to?"
                required
                hint={`Our kitchen and floor team will see this. For a serious allergy, please ring us on ${phoneDisplay} as well.`}
                error={allergyMissing ? 'Tell us the allergies so the kitchen can plan for them.' : undefined}
              >
                <GuestTextarea
                  id={`${prefix}-allergy-detail`}
                  rows={2}
                  maxLength={300}
                  required
                  value={draft.allergyDetail}
                  invalid={allergyMissing}
                  aria-invalid={allergyMissing || undefined}
                  aria-describedby={[`${prefix}-allergy-detail-hint`, allergyMissing ? `${prefix}-allergy-detail-error` : null].filter(Boolean).join(' ')}
                  onChange={(event) => update({ allergyDetail: event.target.value })}
                />
              </GuestField>
            )}
          </fieldset>

          <fieldset className="flex flex-col gap-guest-xs">
            <legend className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
              Number of courses <span aria-hidden="true">*</span>
            </legend>
            <div className="flex flex-wrap gap-x-guest-lg">
              {([1, 2, 3] as const).map((count) => (
                <GuestChoice
                  key={count}
                  type="radio"
                  id={`${prefix}-courses-${count}`}
                  name={`${prefix}-courses`}
                  checked={tier === count}
                  onChange={() => chooseTier(count)}
                  label={count === 1 ? '1 course' : `${count} courses`}
                />
              ))}
            </div>
            <p className={GUEST_NOTE_CLASS}>
              {tier === 0 && 'Choose the number of courses to see the dishes.'}
              {tier === 1 && '1 course: a main.'}
              {tier === 2 && '2 courses: a main, plus a starter or a dessert.'}
              {tier === 3 && '3 courses: a starter, a main and a dessert.'}
            </p>
          </fieldset>

          {tier === 2 && (
            <fieldset className="flex flex-col gap-guest-xs">
              <legend className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
                Starter or dessert?
              </legend>
              <div className="flex flex-wrap gap-x-guest-lg">
                <GuestChoice
                  type="radio"
                  id={`${prefix}-other-starter`}
                  name={`${prefix}-other`}
                  checked={draft.other === 'starter'}
                  onChange={() => update({ other: 'starter' })}
                  label="A starter"
                />
                <GuestChoice
                  type="radio"
                  id={`${prefix}-other-dessert`}
                  name={`${prefix}-other`}
                  checked={draft.other === 'dessert'}
                  onChange={() => update({ other: 'dessert' })}
                  label="A dessert"
                />
              </div>
            </fieldset>
          )}

          {tier > 0 && (
            <div className="grid grid-cols-1 gap-guest-md sm:grid-cols-2">
              {showStarter && (
                <GuestField id={`${prefix}-starter`} label="Starter">
                  <GuestSelect id={`${prefix}-starter`} value={draft.starterId} onChange={(event) => update({ starterId: event.target.value })}>
                    <option value="">Please choose</option>
                    {menu.starter.map((dish) => (
                      <option key={dish.id} value={dish.id}>
                        {dishLabel(dish)}
                      </option>
                    ))}
                  </GuestSelect>
                </GuestField>
              )}
              <GuestField id={`${prefix}-main`} label="Main">
                <GuestSelect id={`${prefix}-main`} value={draft.mainId} onChange={(event) => update({ mainId: event.target.value })}>
                  <option value="">Please choose</option>
                  {mains.map((dish) => (
                    <option key={dish.id} value={dish.id}>
                      {dishLabel(dish)}
                    </option>
                  ))}
                </GuestSelect>
              </GuestField>
              {showDessert && (
                <GuestField id={`${prefix}-dessert`} label="Dessert">
                  <GuestSelect id={`${prefix}-dessert`} value={draft.dessertId} onChange={(event) => update({ dessertId: event.target.value })}>
                    <option value="">Please choose</option>
                    {menu.dessert.map((dish) => (
                      <option key={dish.id} value={dish.id}>
                        {dishLabel(dish)}
                      </option>
                    ))}
                  </GuestSelect>
                </GuestField>
              )}
            </div>
          )}

          <GuestField id={`${prefix}-note`} label="Other dietary needs (optional)">
            <GuestInput
              id={`${prefix}-note`}
              type="text"
              maxLength={200}
              autoComplete="off"
              placeholder="For example, no dairy"
              value={draft.dietaryNote}
              onChange={(event) => update({ dietaryNote: event.target.value })}
            />
          </GuestField>

          {menu.addons.length > 0 && (
            <fieldset className="flex flex-col gap-guest-xs">
              <legend className="font-anchor-body text-guest-body font-semibold leading-guest-snug text-guest-text">
                Extras (optional)
              </legend>
              <p className={GUEST_NOTE_CLASS}>Extras go on the bill at the pub on the day, not now.</p>
              <ul>
                {menu.addons.map((dish) => (
                  <li key={dish.id}>
                    <GuestChoice
                      type="checkbox"
                      id={`${prefix}-addon-${dish.id}`}
                      checked={draft.addonIds.includes(dish.id)}
                      onChange={(event) =>
                        update({
                          addonIds: event.target.checked
                            ? [...draft.addonIds, dish.id]
                            : draft.addonIds.filter((id) => id !== dish.id),
                        })
                      }
                      label={addonLabel(dish)}
                    />
                  </li>
                ))}
              </ul>
            </fieldset>
          )}

          <div className="flex flex-col gap-guest-xs">
            <div>
              <GuestButton onClick={save} loading={state.kind === 'busy'} loadingText="Saving..." fullWidth="mobile">
                {mode === 'guest' ? 'Save my choices' : 'Save this guest'}
              </GuestButton>
            </div>
            <div aria-live="polite">
              {state.kind === 'saved' && (
                <GuestAlert tone="success" role="status">
                  {state.text}
                </GuestAlert>
              )}
              {state.kind === 'error' && (
                <GuestAlert tone="problem" role="alert">
                  {state.text}
                </GuestAlert>
              )}
            </div>
          </div>

          {mode === 'organiser' && seat.coverId && (
            <InviteControls seat={seat} endpoint={endpoint} phoneDisplay={phoneDisplay} onSeat={onSeat} />
          )}
        </div>
      </fieldset>
    </li>
  )
}

function EmailCopy({ endpoint, phoneDisplay }: { endpoint: string; phoneDisplay: string }) {
  const [state, setState] = useState<SaveState>({ kind: 'idle' })
  async function send() {
    setState({ kind: 'busy' })
    const result = await postJson(endpoint, { action: 'copy' }, phoneDisplay)
    setState(
      result.success
        ? { kind: 'saved', text: 'message' in result && result.message ? result.message : "Done. We've emailed you a copy." }
        : { kind: 'error', text: result.error },
    )
  }
  return (
    <div className="flex flex-col gap-guest-xs">
      <div>
        <GuestButton variant="outline" onClick={send} loading={state.kind === 'busy'} loadingText="Sending...">
          Email me a copy
        </GuestButton>
      </div>
      <div aria-live="polite">
        {state.kind === 'saved' && <GuestAlert tone="success">{state.text}</GuestAlert>}
        {state.kind === 'error' && (
          <GuestAlert tone="problem" role="alert">
            {state.text}
          </GuestAlert>
        )}
      </div>
    </div>
  )
}

export function FoodLines({ mode, endpoint, seats: initialSeats, menu, locked, closedMessage, deadlineLabel, copyEnabled = false, phoneDisplay }: FoodLinesProps) {
  const [seats, setSeats] = useState(initialSeats)
  const done = useMemo(() => seats.filter((seat) => !seat.missing).length, [seats])

  function replaceSeat(next: FoodSeatView) {
    setSeats((current) => current.map((seat) => (seat.ordinal === next.ordinal ? next : seat)))
  }

  return (
    <div className="flex flex-col gap-guest-md">
      {mode === 'organiser' && (
        <p className={cn(GUEST_BODY_CLASS, 'font-semibold')} aria-live="polite">
          {done} of {seats.length} guests done
        </p>
      )}

      {locked && (
        <GuestAlert tone="notice" role="status">
          {closedMessage}
        </GuestAlert>
      )}

      <ul className="flex flex-col gap-guest-md">
        {seats.map((seat) =>
          locked ? (
            <LockedLine key={seat.ordinal} seat={seat} menu={menu} mode={mode} />
          ) : (
            <FoodLine
              key={seat.ordinal}
              seat={seat}
              menu={menu}
              mode={mode}
              endpoint={endpoint}
              phoneDisplay={phoneDisplay}
              deadlineLabel={deadlineLabel}
              onSeat={replaceSeat}
            />
          ),
        )}
      </ul>

      {mode === 'organiser' && copyEnabled && <EmailCopy endpoint={endpoint} phoneDisplay={phoneDisplay} />}
    </div>
  )
}

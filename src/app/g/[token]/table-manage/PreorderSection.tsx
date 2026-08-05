import {
  GuestAlert,
  GuestField,
  guestFieldControlProps,
  GUEST_CHOICE_ROW_CLASS,
  GUEST_INPUT_CLASS,
  GUEST_INPUT_INVALID_CLASS,
  GUEST_SUNK_BOX_CLASS,
} from '@/components/features/guest'
import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { GUEST_CONTACT } from '@/lib/guest-contact'
import {
  formatPreorderAddonPrice,
  formatPreorderMoney,
  getCoverAddons,
  getCoverCourse,
  getPreorderCompleteness,
  summariseCoverAddons,
  summariseOrderAddons,
} from '@/lib/table-bookings/preorder'
import { cn } from '@/lib/utils'
import {
  PREORDER_ADDON_GUEST_NOTE,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderAddonSummary,
  type PreorderCourse,
  type PreorderCover,
} from '@/types/preorders'
import { GUEST_SUBMIT_PRIMARY_CLASS, PREORDER_SEAT_BLOCK_CLASS } from './formStyles'
import type { BookerPreorderView } from './preorder-data'

/**
 * The booker's food choices, on the manage-booking page they already have a link to.
 *
 * One block per seat: an optional name, a main, an optional starter, an optional dessert, any
 * add-ons, and an optional dietary requirement. Only the main is required for the order to count as
 * complete, so nothing here is marked `required`: a booker who knows two of six choices must be able
 * to save what they have and come back. The page tells them what is still outstanding instead.
 *
 * ADD-ONS ARE TICK-BOXES, not a fourth dropdown. A seat may have several, and the farmhouse
 * cheeseboard exists to be had ALONGSIDE a pudding rather than instead of one, which is what a
 * dropdown would force. They never count towards completeness, so nothing here chases a guest for
 * declining an extra.
 *
 * THE MONEY IS NOT TAKEN NOW. An add-on price is a quote, charged on the bill at the pub on the day.
 * `PREORDER_ADDON_GUEST_NOTE` says so verbatim, in the one place all four screens share, because
 * four separate wordings eventually produce one that implies the guest has already paid and that
 * argument then happens at the till.
 *
 * Plain server-rendered HTML posting to the route next door, matching the rest of this page. No
 * client JavaScript is needed to fill it in, which matters on a phone signal in a car park. The
 * add-on totals below are therefore what is SAVED rather than what is ticked this second, and the
 * copy says so; they sit in a polite live region so an assistive technology reads the new figure
 * after a save rather than letting the number change unremarked.
 */

type PreorderSectionProps = BookerPreorderView & {
  actionUrl: string
  /** Seat whose save failed, so its inputs can be marked invalid and pointed at the reason. */
  errorSeat: number | null
}

/** The id of the one verbatim add-on note, pointed at by every seat's add-on group. */
const ADDON_NOTE_ID = 'preorder-addon-note'

function seatLabel(cover: PreorderCover | undefined, ordinal: number): string {
  const name = cover?.guestName?.trim()
  return name ? `Seat ${ordinal}: ${name}` : `Seat ${ordinal}`
}

function withdrawnChoices(cover: PreorderCover | undefined): string[] {
  return (cover?.selections ?? [])
    .filter((selection) => selection.itemWithdrawn)
    .map((selection) => `${PREORDER_SELECTION_COURSE_LABELS[selection.course]}: ${selection.itemName}`)
}

/**
 * A seat, with anything withdrawn from the menu stripped out.
 *
 * Used for the add-on tick-boxes and their totals. A withdrawn add-on has no tick-box to appear in,
 * so counting its price would show a guest money against a box they cannot see and will not be
 * charged for. It is flagged separately by the "no longer on the menu" note above.
 */
function liveOnly(cover: PreorderCover): PreorderCover {
  return { ...cover, selections: cover.selections.filter((selection) => !selection.itemWithdrawn) }
}

/**
 * The money half of an add-on total, in words a guest can act on.
 *
 * Every dish on the Christmas menu is unpriced today, so "no price yet" is the ordinary case and not
 * an edge one. A bare £0.00 would read as free, so an unpriced add-on is said out loud instead.
 */
function addonMoneyPhrase(summary: PreorderAddonSummary): string {
  if (summary.hasUnpricedAddon) {
    return summary.totalGbp > 0
      ? `${formatPreorderMoney(summary.totalGbp)} so far, plus anything priced on the day`
      : 'priced on the day'
  }
  return formatPreorderMoney(summary.totalGbp)
}

function addonCountPhrase(count: number): string {
  return count === 1 ? '1 add-on' : `${count} add-ons`
}

/** Seat title, shared by the editable fieldset legend and the read-only row. */
const SEAT_TITLE_CLASS =
  'font-anchor-body text-[14px] font-bold leading-[1.4] text-guest-text-strong'

/** Small print inside a seat block: the read-only choices and dietary lines. */
const SEAT_TEXT_CLASS = 'font-anchor-body text-[14px] leading-[1.6] text-guest-text'

export function PreorderSection({
  order,
  menuByCourse,
  addons,
  cutoff,
  actionUrl,
  errorSeat,
}: PreorderSectionProps) {
  const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
  const seats = Array.from({ length: Math.max(1, order.partySize) }, (_, index) => index + 1)
  const completeness = getPreorderCompleteness(order)
  const menuName = order.periodName || 'seasonal'
  const contactPhone = GUEST_CONTACT.phoneDisplay
  const hasAddons = addons.length > 0

  // The whole booking's add-on bill. Withdrawn items are left out on the editable form for the same
  // reason as above; the read-only view below totals what is on the record instead.
  const orderAddons = summariseOrderAddons({ covers: order.covers.map(liveOnly) })
  const savedOrderAddons = summariseOrderAddons(order)

  return (
    <section
      aria-labelledby="preorder-heading"
      className="flex flex-col gap-[14px] border-t border-guest-border-strong pt-5"
    >
      <div className="flex flex-col gap-2">
        <h2
          id="preorder-heading"
          className="font-anchor-display text-[22px] font-normal leading-[1.25] text-guest-text-strong"
        >
          Your food choices
        </h2>
        <p className="font-anchor-body text-[14px] leading-[1.6] text-guest-text-muted">
          Everyone eating from the {menuName} menu chooses their main course in advance so the kitchen can
          prepare it. A starter and a pudding are optional.
        </p>
      </div>

      {hasAddons && (
        <p
          id={ADDON_NOTE_ID}
          className="rounded-guest-card border border-anchor-gold/[0.35] bg-anchor-gold/[0.07] px-[15px] py-[13px] font-anchor-body text-[13px] leading-[1.6] text-guest-text"
        >
          {PREORDER_ADDON_GUEST_NOTE}
        </p>
      )}

      {cutoff.editable ? (
        <>
          {cutoff.at && (
            <p className="font-anchor-body text-[13px] leading-[1.55] text-guest-text-muted">
              You can change these until {formatDateTime12Hour(cutoff.at)}.
            </p>
          )}

          {!completeness.complete && (
            <GuestAlert tone="notice">
              {completeness.ordinalsMissingMain.length > 0 || completeness.coverCount < completeness.partySize
                ? 'Still to choose: a main course for every seat below.'
                : 'Please finish choosing below.'}
            </GuestAlert>
          )}

          <form method="post" action={actionUrl} className="flex flex-col gap-5">
            <input type="hidden" name="action" value="preorder" />

            {seats.map((ordinal) => {
              const cover = coversByOrdinal.get(ordinal)
              const withdrawn = withdrawnChoices(cover)
              const hasError = errorSeat === ordinal
              const noteIds = [
                withdrawn.length > 0 ? `seat-${ordinal}-withdrawn` : null,
                hasError ? `seat-${ordinal}-error` : null,
              ].filter(Boolean) as string[]
              const describedBy = noteIds.length > 0 ? noteIds.join(' ') : undefined

              const seatAddons = cover
                ? summariseCoverAddons(liveOnly(cover))
                : { count: 0, totalGbp: 0, hasUnpricedAddon: false }
              const tickedAddonIds = new Set(
                cover ? getCoverAddons(liveOnly(cover)).map((addon) => addon.menuItemId) : [],
              )

              return (
                <fieldset key={ordinal} className={PREORDER_SEAT_BLOCK_CLASS}>
                  <legend className={cn('px-1', SEAT_TITLE_CLASS)}>{seatLabel(cover, ordinal)}</legend>

                  <div className="flex flex-col gap-[14px]">
                    {/*
                      `GuestAlert` carries no id of its own, so the id each seat's controls point
                      `aria-describedby` at lives on this wrapper. The described text is the same
                      either way, and the alert keeps its own role.
                    */}
                    {withdrawn.length > 0 && (
                      <div id={`seat-${ordinal}-withdrawn`}>
                        <GuestAlert tone="notice">
                          {withdrawn.join(' and ')} is no longer on the menu. Please choose again.
                        </GuestAlert>
                      </div>
                    )}

                    {hasError && (
                      <div id={`seat-${ordinal}-error`}>
                        <GuestAlert tone="problem">
                          We could not save this seat. The dish you chose may have come off the menu. Please
                          choose again, or call us on {contactPhone}.
                        </GuestAlert>
                      </div>
                    )}

                    <div className="grid grid-cols-1 gap-[14px] sm:grid-cols-2">
                      <GuestField id={`seat-${ordinal}-name`} label="Name (optional)">
                        <input
                          {...guestFieldControlProps({ id: `seat-${ordinal}-name` })}
                          name={`seat_${ordinal}_name`}
                          type="text"
                          maxLength={100}
                          autoComplete="off"
                          defaultValue={cover?.guestName ?? ''}
                          className={GUEST_INPUT_CLASS}
                        />
                      </GuestField>

                      {PREORDER_COURSES.map((course: PreorderCourse) => {
                        const items = menuByCourse[course]
                        if (items.length === 0) return null
                        const selected = cover ? getCoverCourse(cover, course) : null
                        const chosenId = selected && !selected.itemWithdrawn ? selected.menuItemId : ''
                        const courseId = `seat-${ordinal}-${course}`

                        return (
                          <GuestField
                            key={course}
                            id={courseId}
                            label={`${PREORDER_COURSE_LABELS[course]}${course === 'main' ? '' : ' (optional)'}`}
                          >
                            <select
                              {...guestFieldControlProps({ id: courseId })}
                              name={`seat_${ordinal}_${course}`}
                              defaultValue={chosenId}
                              aria-invalid={hasError || undefined}
                              aria-describedby={describedBy}
                              className={cn(GUEST_INPUT_CLASS, hasError && GUEST_INPUT_INVALID_CLASS)}
                            >
                              <option value="">
                                {course === 'main' ? 'Please choose' : 'None, thank you'}
                              </option>
                              {items.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {item.name}
                                </option>
                              ))}
                            </select>
                          </GuestField>
                        )
                      })}

                      {hasAddons && (
                        <fieldset
                          className="rounded-guest-field border border-guest-border bg-guest-sunk px-[14px] py-3 sm:col-span-2"
                          aria-describedby={ADDON_NOTE_ID}
                        >
                          <legend className="px-1 font-anchor-body text-[13px] font-semibold leading-[1.4] text-guest-text">
                            Add-ons for seat {ordinal} (optional)
                          </legend>

                          {/*
                            An unticked box sends nothing at all, so "everything unticked" and "this form
                            had no add-on block" arrive identically. This marker is what tells them apart,
                            and without it a guest could tick an add-on but never remove one.
                          */}
                          <input type="hidden" name={`seat_${ordinal}_addons_present`} value="1" />

                          <ul>
                            {addons.map((addon) => {
                              const inputId = `seat-${ordinal}-addon-${addon.id}`
                              return (
                                <li key={addon.id}>
                                  {/*
                                    No size utility on the box: `.guest-theme` sizes every tick and
                                    radio at 20px, and the row carries the 44px target.
                                  */}
                                  <label htmlFor={inputId} className={GUEST_CHOICE_ROW_CLASS}>
                                    <input
                                      id={inputId}
                                      name={`seat_${ordinal}_addon`}
                                      type="checkbox"
                                      value={addon.id}
                                      defaultChecked={tickedAddonIds.has(addon.id)}
                                      aria-invalid={hasError || undefined}
                                      aria-describedby={describedBy}
                                    />
                                    <span>
                                      {addon.name}, {formatPreorderAddonPrice(addon.priceGbp)}
                                    </span>
                                  </label>
                                </li>
                              )
                            })}
                          </ul>

                          <p
                            aria-live="polite"
                            className="mt-2 font-anchor-body text-[13px] leading-[1.55] text-guest-text-muted"
                          >
                            {seatAddons.count === 0
                              ? 'No add-ons saved for this seat yet.'
                              : `Saved for this seat: ${addonCountPhrase(seatAddons.count)}, ${addonMoneyPhrase(seatAddons)}.`}{' '}
                            This updates when you save.
                          </p>
                        </fieldset>
                      )}

                      <GuestField
                        id={`seat-${ordinal}-note`}
                        label="Dietary requirement (optional)"
                        className="sm:col-span-2"
                      >
                        <input
                          {...guestFieldControlProps({ id: `seat-${ordinal}-note` })}
                          name={`seat_${ordinal}_note`}
                          type="text"
                          maxLength={200}
                          autoComplete="off"
                          defaultValue={cover?.dietaryNote ?? ''}
                          placeholder="For example, no dairy"
                          className={GUEST_INPUT_CLASS}
                        />
                      </GuestField>
                    </div>
                  </div>
                </fieldset>
              )
            })}

            <div className={GUEST_SUNK_BOX_CLASS}>
              {hasAddons && (
                <p aria-live="polite">
                  <span className="font-semibold">Add-ons across this booking:</span>{' '}
                  {orderAddons.count === 0
                    ? 'none saved yet.'
                    : `${addonCountPhrase(orderAddons.count)}, ${addonMoneyPhrase(orderAddons)}.`}{' '}
                  This goes on your bill at the pub on the day, and updates when you save.
                </p>
              )}

              <p className={hasAddons ? 'mt-2' : undefined}>
                If anyone has a serious allergy, please ring us on {contactPhone} so we can talk it through.
                A text box is not a safe way to handle one.
              </p>
            </div>

            <div>
              <GuestSubmitButton className={GUEST_SUBMIT_PRIMARY_CLASS} loadingText="Saving...">
                Save food choices
              </GuestSubmitButton>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className={GUEST_SUNK_BOX_CLASS}>
            Food choices are now closed for this booking. Please ring us on {contactPhone} if anything
            needs to change.
          </p>

          <ul className="flex flex-col gap-[14px]">
            {seats.map((ordinal) => {
              const cover = coversByOrdinal.get(ordinal)
              const chosen = PREORDER_COURSES.map((course) => {
                const selection = cover ? getCoverCourse(cover, course) : null
                return selection ? `${PREORDER_COURSE_LABELS[course]}: ${selection.itemName}` : null
              }).filter(Boolean) as string[]

              // Read-only, so this is the record rather than a form: withdrawn items are left in,
              // because what is on the booking is what staff will be looking at on the day.
              const seatAddons = cover
                ? summariseCoverAddons(cover)
                : { count: 0, totalGbp: 0, hasUnpricedAddon: false, items: [] }

              return (
                <li key={ordinal} className={cn(PREORDER_SEAT_BLOCK_CLASS, SEAT_TEXT_CLASS)}>
                  <p className={SEAT_TITLE_CLASS}>{seatLabel(cover, ordinal)}</p>
                  {chosen.length > 0 ? (
                    <ul className="mt-1">
                      {chosen.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1">Nothing chosen. Please ring us.</p>
                  )}
                  {seatAddons.count > 0 && (
                    <>
                      <ul className="mt-1">
                        {seatAddons.items.map((item) => (
                          <li key={item.menuItemId}>
                            {PREORDER_SELECTION_COURSE_LABELS.addon}: {item.itemName},{' '}
                            {formatPreorderAddonPrice(item.priceGbp)}
                          </li>
                        ))}
                      </ul>
                      <p className="mt-1">
                        Add-ons for this seat: {addonCountPhrase(seatAddons.count)},{' '}
                        {addonMoneyPhrase(seatAddons)}.
                      </p>
                    </>
                  )}
                  {cover?.dietaryNote && <p className="mt-1">Dietary requirement: {cover.dietaryNote}</p>}
                </li>
              )
            })}
          </ul>

          {savedOrderAddons.count > 0 && (
            <p className={GUEST_SUNK_BOX_CLASS}>
              <span className="font-semibold">Add-ons across this booking:</span>{' '}
              {addonCountPhrase(savedOrderAddons.count)}, {addonMoneyPhrase(savedOrderAddons)}. This goes on
              your bill at the pub on the day.
            </p>
          )}
        </>
      )}
    </section>
  )
}

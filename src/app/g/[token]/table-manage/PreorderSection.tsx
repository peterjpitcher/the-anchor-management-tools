import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import {
  formatPreorderAddonPrice,
  formatPreorderMoney,
  getCoverAddons,
  getCoverCourse,
  getPreorderCompleteness,
  summariseCoverAddons,
  summariseOrderAddons,
} from '@/lib/table-bookings/preorder'
import {
  PREORDER_ADDON_GUEST_NOTE,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderAddonSummary,
  type PreorderCourse,
  type PreorderCover,
} from '@/types/preorders'
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

const FIELD_CLASS =
  'mt-1 block w-full min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 sm:text-sm'
const LABEL_CLASS = 'block text-sm font-medium text-gray-900'

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
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'
  const hasAddons = addons.length > 0

  // The whole booking's add-on bill. Withdrawn items are left out on the editable form for the same
  // reason as above; the read-only view below totals what is on the record instead.
  const orderAddons = summariseOrderAddons({ covers: order.covers.map(liveOnly) })
  const savedOrderAddons = summariseOrderAddons(order)

  return (
    <section aria-labelledby="preorder-heading" className="mt-8 border-t border-gray-200 pt-6">
      <h2 id="preorder-heading" className="text-lg font-semibold text-gray-900">
        Your food choices
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Everyone eating from the {menuName} menu chooses their main course in advance so the kitchen can
        prepare it. A starter and a pudding are optional.
      </p>

      {hasAddons && (
        <p
          id={ADDON_NOTE_ID}
          className="mt-2 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700"
        >
          {PREORDER_ADDON_GUEST_NOTE}
        </p>
      )}

      {cutoff.editable ? (
        <>
          {cutoff.at && (
            <p className="mt-2 text-sm text-gray-600">
              You can change these until {formatDateTime12Hour(cutoff.at)}.
            </p>
          )}

          {!completeness.complete && (
            <p className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {completeness.ordinalsMissingMain.length > 0 || completeness.coverCount < completeness.partySize
                ? 'Still to choose: a main course for every seat below.'
                : 'Please finish choosing below.'}
            </p>
          )}

          <form method="post" action={actionUrl} className="mt-4 space-y-6">
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
                <fieldset key={ordinal} className="rounded-md border border-gray-200 p-4">
                  <legend className="px-1 text-sm font-semibold text-gray-900">
                    {seatLabel(cover, ordinal)}
                  </legend>

                  {withdrawn.length > 0 && (
                    <p
                      id={`seat-${ordinal}-withdrawn`}
                      className="mb-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
                    >
                      {withdrawn.join(' and ')} is no longer on the menu. Please choose again.
                    </p>
                  )}

                  {hasError && (
                    <p
                      id={`seat-${ordinal}-error`}
                      role="alert"
                      className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
                    >
                      We could not save this seat. The dish you chose may have come off the menu. Please
                      choose again, or call us on {contactPhone}.
                    </p>
                  )}

                  <div className="space-y-4">
                    <div>
                      <label htmlFor={`seat-${ordinal}-name`} className={LABEL_CLASS}>
                        Name (optional)
                      </label>
                      <input
                        id={`seat-${ordinal}-name`}
                        name={`seat_${ordinal}_name`}
                        type="text"
                        maxLength={100}
                        autoComplete="off"
                        defaultValue={cover?.guestName ?? ''}
                        className={FIELD_CLASS}
                      />
                    </div>

                    {PREORDER_COURSES.map((course: PreorderCourse) => {
                      const items = menuByCourse[course]
                      if (items.length === 0) return null
                      const selected = cover ? getCoverCourse(cover, course) : null
                      const chosenId = selected && !selected.itemWithdrawn ? selected.menuItemId : ''

                      return (
                        <div key={course}>
                          <label htmlFor={`seat-${ordinal}-${course}`} className={LABEL_CLASS}>
                            {PREORDER_COURSE_LABELS[course]}
                            {course === 'main' ? '' : ' (optional)'}
                          </label>
                          <select
                            id={`seat-${ordinal}-${course}`}
                            name={`seat_${ordinal}_${course}`}
                            defaultValue={chosenId}
                            aria-invalid={hasError || undefined}
                            aria-describedby={describedBy}
                            className={FIELD_CLASS}
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
                        </div>
                      )
                    })}

                    {hasAddons && (
                      <fieldset
                        className="rounded-md border border-gray-200 bg-gray-50 p-3"
                        aria-describedby={ADDON_NOTE_ID}
                      >
                        <legend className="px-1 text-sm font-medium text-gray-900">
                          Add-ons for seat {ordinal} (optional)
                        </legend>

                        {/*
                          An unticked box sends nothing at all, so "everything unticked" and "this form
                          had no add-on block" arrive identically. This marker is what tells them apart,
                          and without it a guest could tick an add-on but never remove one.
                        */}
                        <input type="hidden" name={`seat_${ordinal}_addons_present`} value="1" />

                        <ul className="mt-1 space-y-1">
                          {addons.map((addon) => {
                            const inputId = `seat-${ordinal}-addon-${addon.id}`
                            return (
                              <li key={addon.id}>
                                <label
                                  htmlFor={inputId}
                                  className="flex min-h-11 cursor-pointer items-center gap-3 text-sm text-gray-900"
                                >
                                  <input
                                    id={inputId}
                                    name={`seat_${ordinal}_addon`}
                                    type="checkbox"
                                    value={addon.id}
                                    defaultChecked={tickedAddonIds.has(addon.id)}
                                    aria-invalid={hasError || undefined}
                                    aria-describedby={describedBy}
                                    className="h-5 w-5 shrink-0 rounded border-gray-300 text-green-600"
                                  />
                                  <span>
                                    {addon.name}, {formatPreorderAddonPrice(addon.priceGbp)}
                                  </span>
                                </label>
                              </li>
                            )
                          })}
                        </ul>

                        <p aria-live="polite" className="mt-2 text-sm text-gray-700">
                          {seatAddons.count === 0
                            ? 'No add-ons saved for this seat yet.'
                            : `Saved for this seat: ${addonCountPhrase(seatAddons.count)}, ${addonMoneyPhrase(seatAddons)}.`}{' '}
                          This updates when you save.
                        </p>
                      </fieldset>
                    )}

                    <div>
                      <label htmlFor={`seat-${ordinal}-note`} className={LABEL_CLASS}>
                        Dietary requirement (optional)
                      </label>
                      <input
                        id={`seat-${ordinal}-note`}
                        name={`seat_${ordinal}_note`}
                        type="text"
                        maxLength={200}
                        autoComplete="off"
                        defaultValue={cover?.dietaryNote ?? ''}
                        placeholder="For example, no dairy"
                        className={FIELD_CLASS}
                      />
                    </div>
                  </div>
                </fieldset>
              )
            })}

            {hasAddons && (
              <p
                aria-live="polite"
                className="rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800"
              >
                <span className="font-medium">Add-ons across this booking:</span>{' '}
                {orderAddons.count === 0
                  ? 'none saved yet.'
                  : `${addonCountPhrase(orderAddons.count)}, ${addonMoneyPhrase(orderAddons)}.`}{' '}
                This goes on your bill at the pub on the day, and updates when you save.
              </p>
            )}

            <p className="text-sm text-gray-600">
              If anyone has a serious allergy, please ring us on {contactPhone} so we can talk it through.
              A text box is not a safe way to handle one.
            </p>

            <GuestSubmitButton
              className="inline-flex w-full min-h-11 items-center justify-center rounded-md bg-green-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50 sm:w-auto"
              loadingText="Saving..."
            >
              Save food choices
            </GuestSubmitButton>
          </form>
        </>
      ) : (
        <>
          <p className="mt-3 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
            Food choices are now closed for this booking. Please ring us on {contactPhone} if anything
            needs to change.
          </p>

          <ul className="mt-4 space-y-3">
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
                <li key={ordinal} className="rounded-md border border-gray-200 p-4 text-sm text-gray-700">
                  <p className="font-medium text-gray-900">{seatLabel(cover, ordinal)}</p>
                  {chosen.length > 0 ? (
                    <ul className="mt-1 space-y-0.5">
                      {chosen.map((line) => (
                        <li key={line}>{line}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-1">Nothing chosen. Please ring us.</p>
                  )}
                  {seatAddons.count > 0 && (
                    <>
                      <ul className="mt-1 space-y-0.5">
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
            <p className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-800">
              <span className="font-medium">Add-ons across this booking:</span>{' '}
              {addonCountPhrase(savedOrderAddons.count)}, {addonMoneyPhrase(savedOrderAddons)}. This goes on
              your bill at the pub on the day.
            </p>
          )}
        </>
      )}
    </section>
  )
}

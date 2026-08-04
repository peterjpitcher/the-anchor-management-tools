import { GuestSubmitButton } from '@/components/features/shared/GuestSubmitButton'
import { formatDateTime12Hour } from '@/lib/dateUtils'
import { getCoverCourse, getPreorderCompleteness } from '@/lib/table-bookings/preorder'
import { PREORDER_COURSES, PREORDER_COURSE_LABELS, type PreorderCourse, type PreorderCover } from '@/types/preorders'
import type { BookerPreorderView } from './preorder-data'

/**
 * The booker's food choices, on the manage-booking page they already have a link to.
 *
 * One block per seat: an optional name, a main, an optional starter, an optional dessert and an
 * optional dietary requirement. Only the main is required for the order to count as complete, so
 * nothing here is marked `required`: a booker who knows two of six choices must be able to save what
 * they have and come back. The page tells them what is still outstanding instead.
 *
 * Plain server-rendered HTML posting to the route next door, matching the rest of this page. No
 * client JavaScript is needed to fill it in, which matters on a phone signal in a car park.
 */

type PreorderSectionProps = BookerPreorderView & {
  actionUrl: string
  /** Seat whose save failed, so its inputs can be marked invalid and pointed at the reason. */
  errorSeat: number | null
}

function seatLabel(cover: PreorderCover | undefined, ordinal: number): string {
  const name = cover?.guestName?.trim()
  return name ? `Seat ${ordinal}: ${name}` : `Seat ${ordinal}`
}

function withdrawnChoices(cover: PreorderCover | undefined): string[] {
  return (cover?.selections ?? [])
    .filter((selection) => selection.itemWithdrawn)
    .map((selection) => `${PREORDER_COURSE_LABELS[selection.course]}: ${selection.itemName}`)
}

const FIELD_CLASS =
  'mt-1 block w-full min-h-11 rounded-md border border-gray-300 bg-white px-3 py-2.5 text-base text-gray-900 sm:text-sm'
const LABEL_CLASS = 'block text-sm font-medium text-gray-900'

export function PreorderSection({ order, menuByCourse, cutoff, actionUrl, errorSeat }: PreorderSectionProps) {
  const coversByOrdinal = new Map(order.covers.map((cover) => [cover.ordinal, cover]))
  const seats = Array.from({ length: Math.max(1, order.partySize) }, (_, index) => index + 1)
  const completeness = getPreorderCompleteness(order)
  const menuName = order.periodName || 'seasonal'
  const contactPhone = process.env.NEXT_PUBLIC_CONTACT_PHONE_NUMBER || '01753 682707'

  return (
    <section aria-labelledby="preorder-heading" className="mt-8 border-t border-gray-200 pt-6">
      <h2 id="preorder-heading" className="text-lg font-semibold text-gray-900">
        Your food choices
      </h2>
      <p className="mt-2 text-sm text-gray-600">
        Everyone eating from the {menuName} menu chooses their main course in advance so the kitchen can
        prepare it. A starter and a pudding are optional.
      </p>

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
                  {cover?.dietaryNote && <p className="mt-1">Dietary requirement: {cover.dietaryNote}</p>}
                </li>
              )
            })}
          </ul>
        </>
      )}
    </section>
  )
}

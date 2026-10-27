import {
  GuestAlert,
  GuestChoice,
  GuestField,
  GuestInput,
  GuestSection,
  GuestSelect,
  guestFieldControlProps,
  GUEST_BODY_CLASS,
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
  getSeatCourseCount,
  summariseCoverAddons,
  summariseOrderAddons,
} from '@/lib/table-bookings/preorder'
import { cn } from '@/lib/utils'
import type { BookingPeriodMenuItem } from '@/lib/table-bookings/periods'
import {
  PREORDER_ADDON_GUEST_NOTE,
  PREORDER_ALLERGEN_FALLBACK,
  PREORDER_COURSES,
  PREORDER_COURSE_LABELS,
  PREORDER_SELECTION_COURSE_LABELS,
  type PreorderAddonSummary,
  type PreorderCourse,
  type PreorderCourseCount,
  type PreorderCover,
} from '@/types/preorders'
import { PREORDER_SEAT_BLOCK_CLASS } from './formStyles'
import type { BookerPreorderView } from './preorder-data'

/**
 * The booker's food choices, on the manage-booking page they already have a link to.
 *
 * One block per seat: an optional name, the courses that seat's Christmas tier pays for, any
 * add-ons, and an optional dietary requirement. Each seat says its tier: 3 courses is a starter, a
 * main and a dessert; 2 courses is a main plus a starter or a dessert; 1 course has nothing to choose
 * in advance. A booking with no tiers recorded keeps its old rule, a main with the rest optional.
 * Nothing here is marked `required`: a booker who knows two of six choices must be able to save what
 * they have and come back. The page tells them, seat by seat, what is still outstanding instead.
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
  /**
   * Why that seat failed, when it is known. `courses` means the seat chose more courses than its
   * tier pays for; anything else is the general "could not save" reason.
   */
  errorReason?: 'courses' | null
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

/**
 * What a seat on this tier chooses, shown under the seat's title. Null for a seat with no tier
 * recorded, which keeps the booking's old wording.
 */
function tierInstruction(courseCount: PreorderCourseCount | null): string | null {
  if (courseCount === 3) return '3 courses: choose a starter, a main and a dessert.'
  if (courseCount === 2) return '2 courses: choose a main, plus a starter or a dessert.'
  return null
}

/** The label above one course's dropdown. Only an untiered seat calls a course optional. */
function courseLabel(course: PreorderCourse, courseCount: PreorderCourseCount | null): string {
  if (courseCount !== null || course === 'main') return PREORDER_COURSE_LABELS[course]
  return `${PREORDER_COURSE_LABELS[course]} (optional)`
}

/**
 * The empty first option. A 3 course seat must choose every course, and a main is always needed; a
 * 2 course seat leaves one of the starter and the dessert empty, so "None, thank you" is the right
 * answer for that one.
 */
function emptyOptionLabel(course: PreorderCourse, courseCount: PreorderCourseCount | null): string {
  if (course === 'main' || courseCount === 3) return 'Please choose'
  return 'None, thank you'
}

/** A dish in a choice list: its name, and its allergens when the menu records them (BK-060). */
function dishOptionLabel(item: BookingPeriodMenuItem): string {
  const allergens = item.allergens?.trim()
  return allergens ? `${item.name} (allergens: ${allergens})` : item.name
}

/**
 * Every dish on the menu with its allergens, so a guest can check before choosing (BK-060). A dish
 * with none recorded says the SSOT wording, never "no allergens": missing data means unknown. A
 * <details> block, so it needs no JavaScript and stays out of the way once read.
 */
function MenuAllergens({ dishes }: { dishes: BookingPeriodMenuItem[] }) {
  if (dishes.length === 0) return null
  return (
    <details className={GUEST_SUNK_BOX_CLASS}>
      <summary className="cursor-pointer font-semibold">Allergens on this menu</summary>
      <ul className="mt-2 flex flex-col gap-guest-xs">
        {dishes.map((item) => (
          <li key={item.id}>
            <span className="font-semibold">{item.name}:</span> {item.allergens?.trim() || PREORDER_ALLERGEN_FALLBACK}
          </li>
        ))}
      </ul>
    </details>
  )
}

/**
 * A 1 course guest's seat (BK-148, owner decision D23): nothing to choose in advance, but a name
 * and a dietary note, both optional, so the kitchen can tie a need to a guest on a big table.
 */
function OneCourseSeatFields({ ordinal, cover }: { ordinal: number; cover: PreorderCover | undefined }) {
  return (
    <fieldset className={PREORDER_SEAT_BLOCK_CLASS}>
      <legend className={cn('px-1', SEAT_TITLE_CLASS)}>{seatLabel(cover, ordinal)}</legend>
      <div className="flex flex-col gap-guest-md">
        <p className={GUEST_BODY_CLASS}>1 course, chosen on the day, so there&apos;s nothing to pre-order.</p>
        <div className="grid grid-cols-1 gap-guest-md sm:grid-cols-2">
          <GuestField id={`seat-${ordinal}-name`} label="Name (optional)">
            <GuestInput
              {...guestFieldControlProps({ id: `seat-${ordinal}-name` })}
              name={`seat_${ordinal}_name`}
              type="text"
              maxLength={100}
              autoComplete="off"
              defaultValue={cover?.guestName ?? ''}
            />
          </GuestField>
          <GuestField id={`seat-${ordinal}-note`} label="Dietary requirement (optional)">
            <GuestInput
              {...guestFieldControlProps({ id: `seat-${ordinal}-note` })}
              name={`seat_${ordinal}_note`}
              type="text"
              maxLength={200}
              autoComplete="off"
              defaultValue={cover?.dietaryNote ?? ''}
              placeholder="For example, no dairy"
            />
          </GuestField>
        </div>
      </div>
    </fieldset>
  )
}

/** "Seat 2 needs a dessert. Seat 4 needs a starter or a dessert." for the alert above the form. */
function describeOutstanding(gaps: Array<{ ordinal: number; missing: string }>): string {
  return gaps.map((gap) => `Seat ${gap.ordinal} needs ${gap.missing}.`).join(' ')
}

/** Seat title, shared by the editable fieldset legend and the read-only row. */
const SEAT_TITLE_CLASS =
  'font-anchor-body text-guest-body font-bold leading-guest-snug text-guest-text-strong'

/** Secondary lines under a control: the cut-off time and the saved add-on total. */
const SMALL_MUTED_CLASS = 'font-anchor-body text-guest-small text-guest-text-muted'

export function PreorderSection({
  order,
  menuByCourse,
  addons,
  cutoff,
  actionUrl,
  errorSeat,
  errorReason = null,
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
  // A Christmas party all on 1 course has nothing to choose, only a name and a note per guest.
  const nothingToChoose = !order.requiresPreorder
  const allDishes = [...PREORDER_COURSES.flatMap((course) => menuByCourse[course]), ...addons]

  return (
    <GuestSection
      title={nothingToChoose ? 'Your guests' : 'Your food choices'}
      titleId="preorder-heading"
      description={
        nothingToChoose
          ? "Everyone is on 1 course, chosen on the day, so there's nothing to pre-order. You can add each guest's name and any dietary needs so the kitchen knows who's who."
          : order.covers.some(cover => cover.courseCount != null)
            ? `Guests having two or three courses from the ${menuName} menu choose their dishes in advance. Guests on one course have nothing to pre-order.`
            : `Everyone eating from the ${menuName} menu chooses their main course in advance so the kitchen can prepare it. A starter and a pudding are optional.`
      }
    >
      {hasAddons && (
        <GuestAlert id={ADDON_NOTE_ID} tone="notice">
          {PREORDER_ADDON_GUEST_NOTE}
        </GuestAlert>
      )}

      {cutoff.editable ? (
        <>
          {cutoff.at && (
            <p className={SMALL_MUTED_CLASS}>
              You can change these until {formatDateTime12Hour(cutoff.at)}.
            </p>
          )}

          {!completeness.complete && (
            <GuestAlert tone="notice">
              {completeness.seatsIncomplete.length > 0
                ? `Still to choose: ${describeOutstanding(completeness.seatsIncomplete)}`
                : 'Please finish choosing below.'}
            </GuestAlert>
          )}

          {!nothingToChoose && <MenuAllergens dishes={allDishes} />}

          <form method="post" action={actionUrl} className="flex flex-col gap-guest-lg">
            <input type="hidden" name="action" value="preorder" />

            {seats.map((ordinal) => {
              const cover = coversByOrdinal.get(ordinal)
              const courseCount = getSeatCourseCount(order, ordinal)
              if (courseCount === 1) return <OneCourseSeatFields key={ordinal} ordinal={ordinal} cover={cover} />
              const instruction = tierInstruction(courseCount)
              const withdrawn = withdrawnChoices(cover)
              const hasError = errorSeat === ordinal
              const noteIds = [
                instruction ? `seat-${ordinal}-courses` : null,
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

                  <div className="flex flex-col gap-guest-md">
                    {/* Each seat's controls point `aria-describedby` at these alerts by id. */}
                    {withdrawn.length > 0 && (
                      <GuestAlert id={`seat-${ordinal}-withdrawn`} tone="notice">
                        {withdrawn.join(' and ')} is no longer on the menu. Please choose again.
                      </GuestAlert>
                    )}

                    {instruction && (
                      <p id={`seat-${ordinal}-courses`} className={GUEST_BODY_CLASS}>
                        {instruction}
                      </p>
                    )}

                    {hasError && (
                      <GuestAlert id={`seat-${ordinal}-error`} tone="problem">
                        {errorReason === 'courses' && courseCount === 2
                          ? `We could not save this seat. It is on 2 courses, so choose a main, plus a starter or a dessert, not both.`
                          : `We could not save this seat. The dish you chose may have come off the menu. Please choose again, or call us on ${contactPhone}.`}
                      </GuestAlert>
                    )}

                    <div className="grid grid-cols-1 gap-guest-md sm:grid-cols-2">
                      <GuestField id={`seat-${ordinal}-name`} label="Name (optional)">
                        <GuestInput
                          {...guestFieldControlProps({ id: `seat-${ordinal}-name` })}
                          name={`seat_${ordinal}_name`}
                          type="text"
                          maxLength={100}
                          autoComplete="off"
                          defaultValue={cover?.guestName ?? ''}
                        />
                      </GuestField>

                      {PREORDER_COURSES.map((course: PreorderCourse) => {
                        const items = menuByCourse[course]
                        if (items.length === 0) return null
                        const selected = cover ? getCoverCourse(cover, course) : null
                        const chosenId = selected && !selected.itemWithdrawn ? selected.menuItemId : ''
                        const courseId = `seat-${ordinal}-${course}`

                        return (
                          <GuestField key={course} id={courseId} label={courseLabel(course, courseCount)}>
                            <GuestSelect
                              {...guestFieldControlProps({ id: courseId })}
                              name={`seat_${ordinal}_${course}`}
                              defaultValue={chosenId}
                              aria-invalid={hasError || undefined}
                              aria-describedby={describedBy}
                              invalid={hasError}
                            >
                              <option value="">{emptyOptionLabel(course, courseCount)}</option>
                              {items.map((item) => (
                                <option key={item.id} value={item.id}>
                                  {dishOptionLabel(item)}
                                </option>
                              ))}
                            </GuestSelect>
                          </GuestField>
                        )
                      })}

                      {hasAddons && (
                        <fieldset
                          className="rounded-guest-field border border-guest-border bg-guest-sunk px-guest-md py-3 sm:col-span-2"
                          aria-describedby={ADDON_NOTE_ID}
                        >
                          <legend className="px-1 font-anchor-body text-guest-small font-semibold leading-guest-snug text-guest-text">
                            Add-ons for seat {ordinal} (optional)
                          </legend>

                          {/*
                            An unticked box sends nothing at all, so "everything unticked" and "this form
                            had no add-on block" arrive identically. This marker is what tells them apart,
                            and without it a guest could tick an add-on but never remove one.
                          */}
                          <input type="hidden" name={`seat_${ordinal}_addons_present`} value="1" />

                          <ul>
                            {addons.map((addon) => (
                              <li key={addon.id}>
                                <GuestChoice
                                  type="checkbox"
                                  id={`seat-${ordinal}-addon-${addon.id}`}
                                  name={`seat_${ordinal}_addon`}
                                  value={addon.id}
                                  defaultChecked={tickedAddonIds.has(addon.id)}
                                  aria-invalid={hasError || undefined}
                                  aria-describedby={describedBy}
                                  label={`${dishOptionLabel(addon)}, ${formatPreorderAddonPrice(addon.priceGbp)}`}
                                />
                              </li>
                            ))}
                          </ul>

                          <p aria-live="polite" className={cn('mt-2', SMALL_MUTED_CLASS)}>
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
                        <GuestInput
                          {...guestFieldControlProps({ id: `seat-${ordinal}-note` })}
                          name={`seat_${ordinal}_note`}
                          type="text"
                          maxLength={200}
                          autoComplete="off"
                          defaultValue={cover?.dietaryNote ?? ''}
                          placeholder="For example, no dairy"
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
              <GuestSubmitButton loadingText="Saving...">{nothingToChoose ? 'Save guest details' : 'Save food choices'}</GuestSubmitButton>
            </div>
          </form>
        </>
      ) : (
        <>
          <p className={GUEST_SUNK_BOX_CLASS}>
            {nothingToChoose ? 'Guest details are' : 'Food choices are'} now closed for this booking. Please ring us on {contactPhone} if anything
            needs to change.
          </p>

          <ul className="flex flex-col gap-guest-md">
            {seats.map((ordinal) => {
              const cover = coversByOrdinal.get(ordinal)
              const courseCount = getSeatCourseCount(order, ordinal)
              if (courseCount === 1) {
                return (
                  <li key={ordinal} className={cn(PREORDER_SEAT_BLOCK_CLASS, GUEST_BODY_CLASS)}>
                    <p className={SEAT_TITLE_CLASS}>{seatLabel(cover, ordinal)}, 1 course</p>
                    <p className="mt-1">Chosen on the day, nothing to pre-order.</p>
                    {cover?.dietaryNote && <p className="mt-1">Dietary requirement: {cover.dietaryNote}</p>}
                  </li>
                )
              }
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
                <li key={ordinal} className={cn(PREORDER_SEAT_BLOCK_CLASS, GUEST_BODY_CLASS)}>
                  <p className={SEAT_TITLE_CLASS}>
                    {seatLabel(cover, ordinal)}
                    {courseCount ? `, ${courseCount} courses` : ''}
                  </p>
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
    </GuestSection>
  )
}

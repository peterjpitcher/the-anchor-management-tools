import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FoodLines, type FoodLinesProps } from '@/app/g/[token]/table-manage/FoodLines'
import { FoodMenuPanel, ALLERGEN_UNKNOWN } from '@/app/g/[token]/table-manage/FoodMenuPanel'
import { ChristmasFoodSection } from '@/app/g/[token]/table-manage/ChristmasFoodSection'
import type { FoodMenu, FoodSeatView, FoodTierPrices } from '@/app/g/[token]/table-manage/food-types'

/**
 * The Christmas food page's guest lines (owner decision D4, 6 November 2026): a name, allergies, a
 * number of courses and the dishes that tier has; kids mains on 1 course only (A1); each line saved
 * on its own; read only after the cutoff (D8). Fixture data only.
 */

const IDS = {
  starter: '11111111-1111-4111-8111-111111111111',
  turkey: '22222222-2222-4222-8222-222222222222',
  kidsTurkey: '33333333-3333-4333-8333-333333333333',
  pudding: '44444444-4444-4444-8444-444444444444',
  cheese: '55555555-5555-4555-8555-555555555555',
  cover1: '66666666-6666-4666-8666-666666666666',
  cover2: '77777777-7777-4777-8777-777777777777',
}

const MENU: FoodMenu = {
  starter: [{ id: IDS.starter, name: 'Fixture soup', description: 'A fixture starter.', allergens: 'Celery', isChildOption: false, priceGbp: null }],
  main: [
    { id: IDS.turkey, name: 'Fixture turkey', description: 'A fixture main.', allergens: null, isChildOption: false, priceGbp: null },
    { id: IDS.kidsTurkey, name: 'Fixture kids turkey', description: null, allergens: null, isChildOption: true, priceGbp: null },
  ],
  dessert: [{ id: IDS.pudding, name: 'Fixture pudding', description: null, allergens: null, isChildOption: false, priceGbp: null }],
  addons: [{ id: IDS.cheese, name: 'Fixture cheeseboard', description: null, allergens: null, isChildOption: false, priceGbp: 7.95 }],
}

function seat(over: Partial<FoodSeatView> = {}): FoodSeatView {
  return {
    ordinal: 1,
    coverId: IDS.cover1,
    guestName: null,
    hasAllergies: null,
    allergyDetail: null,
    dietaryNote: null,
    courseCount: 0,
    starterId: null,
    mainId: null,
    dessertId: null,
    addonIds: [],
    withdrawn: [],
    missing: 'a name, their allergies and their number of courses',
    lastSavedBy: null,
    inviteEmail: null,
    inviteSentAt: null,
    canResendInvite: false,
    ...over,
  }
}

const COMPLETE = seat({
  ordinal: 2,
  coverId: IDS.cover2,
  guestName: 'Fixture Sam',
  hasAllergies: false,
  courseCount: 3,
  starterId: IDS.starter,
  mainId: IDS.turkey,
  dessertId: IDS.pudding,
  missing: null,
})

function props(over: Partial<FoodLinesProps> = {}): FoodLinesProps {
  return {
    mode: 'organiser',
    endpoint: '/g/raw-token/table-manage/food',
    seats: [seat(), COMPLETE],
    menu: MENU,
    locked: false,
    closedMessage: 'Choices closed at noon on Friday 4 December 2026. Call 01753 682707 if something needs to change.',
    deadlineLabel: 'noon on Friday 4 December 2026',
    copyEnabled: true,
    phoneDisplay: '01753 682707',
    ...over,
  }
}

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function line(name: RegExp | string) {
  return screen.getByRole('group', { name })
}

describe('Christmas food lines', () => {
  it('shows progress, and what each line still needs', () => {
    render(<FoodLines {...props()} />)

    expect(screen.getByText('1 of 2 guests done')).toBeInTheDocument()
    expect(within(line('Guest 1')).getByText('Still needs a name, their allergies and their number of courses')).toBeInTheDocument()
    expect(within(line('Guest 2: Fixture Sam')).getByText('Done')).toBeInTheDocument()
  })

  it('hides every dish until a number of courses is chosen, then shows that tier only', () => {
    render(<FoodLines {...props()} />)
    const first = line('Guest 1')

    expect(within(first).queryByLabelText('Main')).not.toBeInTheDocument()
    expect(within(first).getByText('Choose the number of courses to see the dishes.')).toBeInTheDocument()

    fireEvent.click(within(first).getByLabelText('1 course'))
    expect(within(first).getByLabelText('Main')).toBeInTheDocument()
    expect(within(first).queryByLabelText('Starter')).not.toBeInTheDocument()
    expect(within(first).queryByLabelText('Dessert')).not.toBeInTheDocument()

    fireEvent.click(within(first).getByLabelText('2 courses'))
    // On 2 courses the guest picks which of the two first.
    expect(within(first).queryByLabelText('Starter')).not.toBeInTheDocument()
    fireEvent.click(within(first).getByLabelText('A dessert'))
    expect(within(first).getByLabelText('Dessert')).toBeInTheDocument()
    expect(within(first).queryByLabelText('Starter')).not.toBeInTheDocument()
    fireEvent.click(within(first).getByLabelText('A starter'))
    expect(within(first).getByLabelText('Starter')).toBeInTheDocument()
    expect(within(first).queryByLabelText('Dessert')).not.toBeInTheDocument()

    fireEvent.click(within(first).getByLabelText('3 courses'))
    expect(within(first).getByLabelText('Starter')).toBeInTheDocument()
    expect(within(first).getByLabelText('Main')).toBeInTheDocument()
    expect(within(first).getByLabelText('Dessert')).toBeInTheDocument()
  })

  it('offers kids mains on 1 course only, and drops one when the tier moves up', () => {
    render(<FoodLines {...props({ seats: [seat({ courseCount: 1, mainId: IDS.kidsTurkey })] })} />)
    const first = line('Guest 1')

    const main = within(first).getByLabelText('Main') as HTMLSelectElement
    expect(within(main).getByRole('option', { name: 'Fixture kids turkey (kids, 1 course only)' })).toBeInTheDocument()
    expect(main.value).toBe(IDS.kidsTurkey)

    fireEvent.click(within(first).getByLabelText('3 courses'))
    const mainAfter = within(first).getByLabelText('Main') as HTMLSelectElement
    expect(within(mainAfter).queryByRole('option', { name: /kids/ })).not.toBeInTheDocument()
    expect(mainAfter.value).toBe('')
  })

  it('red-flags allergies and asks for the details', () => {
    render(<FoodLines {...props()} />)
    const first = line('Guest 1')

    expect(within(first).queryByLabelText(/What are they allergic to/)).not.toBeInTheDocument()
    fireEvent.click(within(first).getByLabelText('Has allergies'))
    const detail = within(first).getByLabelText(/What are they allergic to/)
    expect(detail).toBeRequired()
    expect(detail).toHaveAttribute('aria-invalid', 'true')
    expect(detail.closest('fieldset')?.className).toContain('border-guest-danger-border')
  })

  it('saves the whole line, clearing courses the tier does not have, and shows what was saved', async () => {
    const saved = seat({ guestName: 'Fixture Alex', hasAllergies: false, courseCount: 2, mainId: IDS.turkey, dessertId: IDS.pudding, missing: null, lastSavedBy: 'organiser' })
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, seat: saved }) })
    render(<FoodLines {...props()} />)
    const first = line('Guest 1')

    fireEvent.change(within(first).getByLabelText(/^Name/), { target: { value: 'Fixture Alex' } })
    fireEvent.click(within(first).getByLabelText('No allergies'))
    fireEvent.click(within(first).getByLabelText('2 courses'))
    fireEvent.click(within(first).getByLabelText('A dessert'))
    fireEvent.change(within(first).getByLabelText('Main'), { target: { value: IDS.turkey } })
    fireEvent.change(within(first).getByLabelText('Dessert'), { target: { value: IDS.pudding } })
    fireEvent.click(within(first).getByRole('button', { name: 'Save this guest' }))

    await waitFor(() => expect(screen.getByText('Saved. This guest is done.')).toBeInTheDocument())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('/g/raw-token/table-manage/food')
    expect(JSON.parse(init.body)).toEqual({
      action: 'save',
      seat: {
        ordinal: 1,
        coverId: IDS.cover1,
        guestName: 'Fixture Alex',
        hasAllergies: false,
        allergyDetail: null,
        dietaryNote: '',
        courseCount: 2,
        starterId: null,
        mainId: IDS.turkey,
        dessertId: IDS.pudding,
        addonIds: [],
      },
    })
    expect(screen.getByText('2 of 2 guests done')).toBeInTheDocument()
  })

  it('says so when a line does not save, and keeps what was typed', async () => {
    // The route sends the saved record back with a refusal; the typed values must survive it.
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, error: 'Fixture failure, call 01753 682707.', seat: seat() }) })
    render(<FoodLines {...props()} />)
    const first = line('Guest 1')

    fireEvent.change(within(first).getByLabelText(/^Name/), { target: { value: 'Fixture Alex' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Save this guest' }))

    expect(await within(first).findByRole('alert')).toHaveTextContent('Fixture failure, call 01753 682707.')
    expect(within(first).getByLabelText(/^Name/)).toHaveValue('Fixture Alex')
  })

  it('shows "Waiting for" after an invite, and "Chosen by" once the guest has saved', () => {
    render(
      <FoodLines
        {...props({
          seats: [
            seat({ guestName: 'Fixture Jo', inviteSentAt: '2026-11-20T10:00:00.000Z', inviteEmail: 'jo@example.test', canResendInvite: true }),
            { ...COMPLETE, lastSavedBy: 'guest' },
          ],
        })}
      />,
    )

    expect(within(line('Guest 1: Fixture Jo')).getByText('Waiting for Fixture')).toBeInTheDocument()
    expect(within(line('Guest 1: Fixture Jo')).getByRole('button', { name: 'Resend their link' })).toBeInTheDocument()
    expect(within(line('Guest 2: Fixture Sam')).getByText('Chosen by Fixture')).toBeInTheDocument()
    expect(within(line('Guest 2: Fixture Sam')).queryByRole('button', { name: /link/ })).not.toBeInTheDocument()
  })

  it('checks an invite address before sending, and shows a failed send', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: false, error: "We couldn't send that email just now, so nothing has changed." }) })
    render(<FoodLines {...props()} />)
    const first = line('Guest 1')

    fireEvent.click(within(first).getByRole('button', { name: 'Send them a link to choose' }))
    const email = within(first).getByLabelText('Their email address')
    fireEvent.change(email, { target: { value: 'not-an-email' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Send link' }))
    expect(await within(first).findByText("That email address doesn't look right. Check it and try again.")).toBeInTheDocument()
    expect(fetchMock).not.toHaveBeenCalled()

    fireEvent.change(email, { target: { value: 'guest@example.test' } })
    fireEvent.click(within(first).getByRole('button', { name: 'Send link' }))
    expect(await within(first).findByText("We couldn't send that email just now, so nothing has changed.")).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'invite', ordinal: 1, coverId: IDS.cover1, email: 'guest@example.test' })
    expect(within(first).queryByText(/Waiting for/)).not.toBeInTheDocument()
  })

  it('is read only after the cutoff, with the closed line', () => {
    render(<FoodLines {...props({ locked: true })} />)

    expect(screen.getByText(/Choices closed at noon on Friday 4 December 2026/)).toHaveTextContent('01753 682707')
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Save/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link/ })).not.toBeInTheDocument()
    expect(screen.getByText('Main: Fixture turkey')).toBeInTheDocument()
  })

  it("on a guest's own link shows one line, no invite controls and a thank-you after saving", async () => {
    const saved = { ...COMPLETE, ordinal: 1, coverId: IDS.cover1, lastSavedBy: 'guest' as const }
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, seat: saved }) })
    render(<FoodLines {...props({ mode: 'guest', endpoint: '/g/guest-token/christmas-choice/save', seats: [seat()], copyEnabled: true })} />)

    expect(screen.getByRole('group', { name: 'Your choices' })).toBeInTheDocument()
    expect(screen.queryByText(/guests done/)).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /link/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Email me a copy' })).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Save my choices' }))
    expect(await screen.findByText('Thank you, your choices are saved. You can still change them until noon on Friday 4 December 2026.')).toBeInTheDocument()
    expect(Object.keys(JSON.parse(fetchMock.mock.calls[0][1].body))).toEqual(['seat'])
  })

  it('emails the organiser a copy on request, and hides the button while the switch is off', async () => {
    fetchMock.mockResolvedValue({ json: async () => ({ success: true, message: "Done. We've emailed you a copy." }) })
    const { unmount } = render(<FoodLines {...props()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Email me a copy' }))
    expect(await screen.findByText("Done. We've emailed you a copy.")).toBeInTheDocument()
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ action: 'copy' })
    unmount()

    render(<FoodLines {...props({ copyEnabled: false })} />)
    expect(screen.queryByRole('button', { name: 'Email me a copy' })).not.toBeInTheDocument()
  })
})

describe('Christmas menu panel', () => {
  const PRICES: FoodTierPrices = {
    dayLabel: 'Friday 11 December',
    oneCourse: [
      { name: 'Fixture adult main', priceGbp: 23, isKids: false },
      { name: 'Fixture kids main', priceGbp: 18, isKids: true },
    ],
    twoCourse: { priceGbp: 36.95, description: 'Fixture two course description.' },
    threeCourse: { priceGbp: 39.95, description: null },
  }

  it("shows each tier's price for the day, what it includes, and every dish with allergens", () => {
    render(<FoodMenuPanel prices={PRICES} menu={MENU} phoneDisplay="01753 682707" />)

    expect(screen.getByRole('heading', { name: 'The menu, prices for Friday 11 December' })).toBeInTheDocument()
    expect(screen.getByText('A main, plus a starter or a dessert.')).toBeInTheDocument()
    expect(screen.getByText('2 courses').closest('li')).toHaveTextContent('2 courses: £36.95 each')
    expect(screen.getByText('3 courses').closest('li')).toHaveTextContent('3 courses: £39.95 each')
    expect(screen.getByText('1 course').closest('li')).toHaveTextContent('1 course: Fixture adult main £23')
    expect(screen.getByText('Kids: Fixture kids main £18')).toBeInTheDocument()
    expect(screen.getByText('A fixture starter.')).toBeInTheDocument()
    expect(screen.getByText('Allergens: Celery')).toBeInTheDocument()
    // A dish with nothing recorded never reads as allergen-free.
    expect(screen.getAllByText(ALLERGEN_UNKNOWN).length).toBe(4)
    expect(document.body.textContent).not.toMatch(/undefined|NaN|£0\b/)
  })

  it('gives the phone number when the prices could not be read, rather than inventing any', () => {
    render(<FoodMenuPanel prices={null} menu={MENU} phoneDisplay="01753 682707" />)
    expect(screen.getByText(/We couldn't load the prices just now. Please ask us on 01753 682707/)).toBeInTheDocument()
    // No tier price at all, only the add-on's own recorded price in the dish list.
    expect(document.body.textContent).not.toMatch(/each|£23|£36/)
  })
})

describe('Christmas food section', () => {
  it('leads with the deadline and the menu, then the lines', () => {
    render(
      <ChristmasFoodSection
        seats={[seat(), COMPLETE]}
        menu={MENU}
        prices={null}
        cutoff={{ at: new Date('2026-12-04T12:00:00.000Z'), editable: true }}
        endpoint="/g/raw-token/table-manage/food"
        copyEnabled={false}
      />,
    )

    expect(screen.getByRole('heading', { name: "Choose everyone's food" })).toBeInTheDocument()
    expect(screen.getByText('noon on Friday 4 December 2026')).toBeInTheDocument()
    expect(screen.getByText('1 of 2 guests done')).toBeInTheDocument()
    expect(screen.queryByText(/chosen on the day/)).not.toBeInTheDocument()
  })

  it('locks after the cutoff with the closed line', () => {
    render(
      <ChristmasFoodSection
        seats={[COMPLETE]}
        menu={MENU}
        prices={null}
        cutoff={{ at: new Date('2026-12-04T12:00:00.000Z'), editable: false }}
        endpoint="/g/raw-token/table-manage/food"
        copyEnabled={false}
      />,
    )
    expect(screen.getByText('Choices closed at noon on Friday 4 December 2026. Call 01753 682707 if something needs to change.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save this guest' })).not.toBeInTheDocument()
  })
})

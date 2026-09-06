import { describe, expect, it } from 'vitest'

import { formatDateInLondon } from '@/lib/dateUtils'
import {
  DEFAULT_EVENT_VENUE,
  MAX_EVENT_NAME_LENGTH,
  MAX_PROMPT_CHARACTERS,
  PROMPT_VERSION,
  buildAdaptationPrompt,
  buildEventCopySnapshot,
  formatEventCopyLines,
  validateEventCopy,
  type EventCopy,
  type ReservedArea,
} from '@/lib/events/artwork/prompt'

const ISO_DATE = '2026-09-12'

/** U+2014, written by code point because a repo hook blocks the literal character. */
const EM_DASH = String.fromCharCode(0x2014)

function makeCopy(overrides: Partial<EventCopy> = {}): EventCopy {
  return {
    name: 'Quiz Night',
    date: ISO_DATE,
    startTime: '19:00',
    doorsTime: null,
    endTime: null,
    lastEntryTime: null,
    isFree: false,
    price: 5,
    venue: DEFAULT_EVENT_VENUE,
    ...overrides,
  }
}

function makePrompt(
  copy: EventCopy,
  overrides: Partial<Parameters<typeof buildAdaptationPrompt>[0]> = {}
): string {
  return buildAdaptationPrompt({
    copy,
    variant: 'story',
    targetWidth: 1080,
    targetHeight: 1920,
    reservedLogoRect: null,
    reservedQrBand: null,
    ...overrides,
  })
}

const LOGO_RECT: ReservedArea = { x: 620, y: 60, width: 410, height: 615 }
const QR_BAND: ReservedArea = { x: 0, y: 1632, width: 1080, height: 288 }

describe('PROMPT_VERSION', () => {
  it('is a non-empty string, so a run can record which wording it was generated under', () => {
    expect(typeof PROMPT_VERSION).toBe('string')
    expect(PROMPT_VERSION.trim().length).toBeGreaterThan(0)
  })
})

describe('buildEventCopySnapshot', () => {
  it('takes the copy off an event row', () => {
    expect(
      buildEventCopySnapshot({
        name: '  Quiz Night  ',
        date: ISO_DATE,
        time: '19:00:00',
        doors_time: '18:30:00',
        end_time: '23:00:00',
        last_entry_time: '21:00:00',
        is_free: false,
        price: 5,
      })
    ).toEqual({
      name: 'Quiz Night',
      date: ISO_DATE,
      startTime: '19:00',
      doorsTime: '18:30',
      endTime: '23:00',
      lastEntryTime: '21:00',
      isFree: false,
      price: 5,
      venue: DEFAULT_EVENT_VENUE,
    })
  })

  it('normalises times so a harmless format difference does not read as a copy change', () => {
    const withSeconds = buildEventCopySnapshot({ name: 'Quiz', date: ISO_DATE, time: '19:00:00' })
    const withoutSeconds = buildEventCopySnapshot({ name: 'Quiz', date: ISO_DATE, time: '19:00' })
    expect(withSeconds).toEqual(withoutSeconds)
  })

  it('keeps absent optional fields null rather than inventing them', () => {
    const snapshot = buildEventCopySnapshot({ name: 'Quiz', date: ISO_DATE })
    expect(snapshot.startTime).toBeNull()
    expect(snapshot.doorsTime).toBeNull()
    expect(snapshot.endTime).toBeNull()
    expect(snapshot.lastEntryTime).toBeNull()
    expect(snapshot.isFree).toBeNull()
    expect(snapshot.price).toBeNull()
  })

  it('accepts an explicit venue and otherwise falls back to the pub', () => {
    expect(
      buildEventCopySnapshot({ name: 'Quiz', date: ISO_DATE, venue: 'The Anchor Garden' }).venue
    ).toBe('The Anchor Garden')
    expect(buildEventCopySnapshot({ name: 'Quiz', date: ISO_DATE }).venue).toBe(DEFAULT_EVENT_VENUE)
  })
})

describe('the price rule', () => {
  it('renders "Free" when the event is flagged free', () => {
    const copy = makeCopy({ isFree: true, price: null })
    expect(formatEventCopyLines(copy)).toContain('Price: Free')
    expect(makePrompt(copy)).toContain('Price: Free')
  })

  it('renders a numeric price as British currency', () => {
    expect(formatEventCopyLines(makeCopy({ isFree: false, price: 5 }))).toContain('Price: £5')
    expect(formatEventCopyLines(makeCopy({ isFree: false, price: 7.5 }))).toContain('Price: £7.50')
    expect(makePrompt(makeCopy({ isFree: false, price: 7.5 }))).toContain('Price: £7.50')
  })

  it('renders nothing at all when the event is not free but has no price', () => {
    const copy = makeCopy({ isFree: false, price: null })
    const lines = formatEventCopyLines(copy)
    const prompt = makePrompt(copy)

    // An unknown price must never be asserted as free, or as zero.
    expect(lines.some((line) => line.startsWith('Price'))).toBe(false)
    expect(prompt).not.toContain('Price')
    expect(prompt).not.toContain('Free')
    expect(prompt).not.toContain('£0')
    // The prompt carries pixel sizes and percentages, so a bare "0" cannot be
    // asserted against the whole string. No currency at all is the stronger check.
    expect(prompt).not.toContain('£')
  })

  it('renders nothing when the free flag is unknown and there is no price', () => {
    const prompt = makePrompt(makeCopy({ isFree: null, price: null }))
    expect(prompt).not.toContain('Free')
    expect(prompt).not.toContain('£')
  })

  it('renders nothing for a zero price that is not flagged free, rather than promising free entry', () => {
    const prompt = makePrompt(makeCopy({ isFree: false, price: 0 }))
    expect(prompt).not.toContain('Free')
    expect(prompt).not.toContain('£0')
  })
})

describe('buildAdaptationPrompt', () => {
  it('quotes the event name exactly', () => {
    const prompt = makePrompt(makeCopy({ name: 'Gameshow House Party' }))
    expect(prompt).toContain('Event name: "Gameshow House Party"')
  })

  it('renders the date in London long format, not as a raw ISO string', () => {
    const prompt = makePrompt(makeCopy())
    const expected = formatDateInLondon(ISO_DATE, {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })

    expect(prompt).toContain(`Date: ${expected}`)
    // Pinned literally so a swap to toISOString().slice(0, 10), or to a host-local
    // date, fails here rather than reaching a poster.
    expect(prompt).toContain('Saturday')
    expect(prompt).toContain('September 2026')
    expect(prompt).not.toContain(ISO_DATE)
  })

  it('omits optional times when they are not set', () => {
    const prompt = makePrompt(makeCopy())
    expect(prompt).toContain('Start time: 7pm')
    expect(prompt).not.toContain('Doors:')
    expect(prompt).not.toContain('Last entry:')
    expect(prompt).not.toContain('Ends:')
  })

  it('includes optional times when they are set', () => {
    const prompt = makePrompt(
      makeCopy({ doorsTime: '18:30', lastEntryTime: '21:00', endTime: '23:00' })
    )
    expect(prompt).toContain('Doors: 6:30pm')
    expect(prompt).toContain('Start time: 7pm')
    expect(prompt).toContain('Last entry: 9pm')
    expect(prompt).toContain('Ends: 11pm')
  })

  it('names the venue', () => {
    expect(makePrompt(makeCopy())).toContain(`Venue: ${DEFAULT_EVENT_VENUE}`)
  })

  it('describes the target shape in words as well as pixels', () => {
    const prompt = makePrompt(makeCopy())
    expect(prompt).toContain('a tall 9:16 portrait for an Instagram story')
    expect(prompt).toContain('1080 by 1920 pixels')
  })

  it('describes a poster in its own words and size', () => {
    const prompt = makePrompt(makeCopy(), {
      variant: 'print_poster',
      targetWidth: 2480,
      targetHeight: 3508,
    })
    expect(prompt).toContain('a tall A4 portrait poster for print')
    expect(prompt).toContain('2480 by 3508 pixels')
  })

  it('asks for a re-composition rather than a crop or a stretch', () => {
    const prompt = makePrompt(makeCopy())
    expect(prompt).toContain('Re-compose')
    expect(prompt).toContain('Do not crop the original, do not stretch it')
    expect(prompt).toContain('same artwork, palette, typography and mood')
  })

  it('tells the model the copy is the authority, not the text in the source image', () => {
    const prompt = makePrompt(makeCopy())
    expect(prompt).toContain('It is the authority, not the text in the attached image.')
  })

  it('describes a reserved logo rectangle as proportions of the frame', () => {
    const prompt = makePrompt(makeCopy(), { reservedLogoRect: LOGO_RECT })
    expect(prompt).toContain(
      'Leave the top right of the image clear, about 38% of the width and about 32% of the height, for the venue logo to be added afterwards.'
    )
  })

  it('describes a reserved QR band as a full-width band', () => {
    const prompt = makePrompt(makeCopy(), { reservedQrBand: QR_BAND })
    expect(prompt).toContain(
      'Leave the bottom band of the image clear, the full width and about 15% of the height, for a QR code and booking details to be added afterwards.'
    )
  })

  it('says nothing about reserved areas when none are passed', () => {
    const prompt = makePrompt(makeCopy())
    expect(prompt).not.toContain('Leave the')
    expect(prompt).not.toContain('venue logo')
    expect(prompt).not.toContain('QR code')
  })

  it('stays well under the provider prompt limit', () => {
    const prompt = makePrompt(
      makeCopy({
        name: 'x'.repeat(MAX_EVENT_NAME_LENGTH),
        doorsTime: '18:30',
        lastEntryTime: '21:00',
        endTime: '23:00',
      }),
      { reservedLogoRect: LOGO_RECT, reservedQrBand: QR_BAND }
    )
    expect(prompt.length).toBeLessThan(MAX_PROMPT_CHARACTERS)
  })

  it('contains no em dash', () => {
    const prompt = makePrompt(makeCopy(), {
      reservedLogoRect: LOGO_RECT,
      reservedQrBand: QR_BAND,
    })
    expect(prompt).not.toContain(EM_DASH)
  })
})

describe('validateEventCopy', () => {
  it('passes complete copy', () => {
    expect(validateEventCopy(makeCopy())).toEqual({ ok: true })
  })

  it('returns every problem at once, not just the first', () => {
    const result = validateEventCopy(makeCopy({ name: '  ', date: '', startTime: null }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the copy to be rejected')
    expect(result.problems).toHaveLength(3)
    expect(result.problems.some((problem) => problem.includes('name'))).toBe(true)
    expect(result.problems.some((problem) => problem.includes('date'))).toBe(true)
    expect(result.problems.some((problem) => problem.includes('start time'))).toBe(true)
  })

  it('flags a name one character over the limit', () => {
    const result = validateEventCopy(makeCopy({ name: 'a'.repeat(MAX_EVENT_NAME_LENGTH + 1) }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the copy to be rejected')
    expect(result.problems).toHaveLength(1)
    expect(result.problems[0]).toContain('61 characters')
  })

  it('accepts a name exactly on the limit', () => {
    expect(validateEventCopy(makeCopy({ name: 'a'.repeat(MAX_EVENT_NAME_LENGTH) }))).toEqual({
      ok: true,
    })
  })

  it('flags a date that is not a real date', () => {
    const result = validateEventCopy(makeCopy({ date: '2026-02-30' }))
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('expected the copy to be rejected')
    expect(result.problems[0]).toContain('not a valid date')
  })
})

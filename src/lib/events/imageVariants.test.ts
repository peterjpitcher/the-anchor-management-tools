import { describe, expect, it } from 'vitest'
import {
  buildEventImageDownloadFileName,
  buildEventImageDownloadUrl,
  eventImageFileExtension,
} from './imageVariants'

const IMAGE_URL =
  'https://project.supabase.co/storage/v1/object/public/event-images/events/event-1/square/123_Cash%20Bingo.png'

describe('event image downloads', () => {
  it('adds the Supabase download parameter with the requested file name', () => {
    const result = new URL(buildEventImageDownloadUrl(IMAGE_URL, 'cash-bingo-square.png'))

    expect(result.searchParams.get('download')).toBe('cash-bingo-square.png')
  })

  it('keeps existing query parameters', () => {
    const result = new URL(buildEventImageDownloadUrl(`${IMAGE_URL}?cache=2`, 'poster.png'))

    expect(result.searchParams.get('cache')).toBe('2')
    expect(result.searchParams.get('download')).toBe('poster.png')
  })

  it('uses the stored file name when no custom name is supplied', () => {
    const result = new URL(buildEventImageDownloadUrl(IMAGE_URL))

    expect(result.searchParams.get('download')).toBe('123_Cash Bingo.png')
  })

  it('builds a useful Marketing-tab file name', () => {
    expect(buildEventImageDownloadFileName('End of Summer Cash Bingo!', 'print_poster', IMAGE_URL))
      .toBe('end-of-summer-cash-bingo-print-poster.png')
  })

  it('reads a PDF extension before query parameters', () => {
    expect(eventImageFileExtension('https://example.com/poster.pdf?version=2')).toBe('pdf')
  })
})

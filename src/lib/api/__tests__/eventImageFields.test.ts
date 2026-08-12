import { describe, expect, it } from 'vitest'
import { buildEventImageFields, buildEventImageList } from '../eventImageFields'

const SQUARE = 'https://cdn/event-images/events/e1/square/1_sq.png'
const LANDSCAPE = 'https://cdn/event-images/events/e1/landscape/1_wide.png'
const SOCIAL = 'https://cdn/event-images/events/e1/social/1_fb.png'

/** Every event in production today: one square copied into all three columns. */
const legacyEvent = {
  hero_image_url: SQUARE,
  thumbnail_image_url: SQUARE,
  poster_image_url: SQUARE,
  landscape_image_url: null,
  social_image_url: null,
  gallery_image_urls: [],
}

const fullyKittedEvent = {
  ...legacyEvent,
  landscape_image_url: LANDSCAPE,
  social_image_url: SOCIAL,
}

describe('buildEventImageList', () => {
  it('publishes one URL for a square-only event, not the same one three times', () => {
    // hero, thumbnail and poster are identical on all 51 events with artwork.
    expect(buildEventImageList(legacyEvent)).toEqual([SQUARE])
  })

  it('publishes three distinct ratios when all three web variants exist', () => {
    expect(buildEventImageList(fullyKittedEvent)).toEqual([SQUARE, LANDSCAPE, SOCIAL])
  })

  it('keeps the square first', () => {
    // the-anchor.pub reads image[0] ahead of every named field and drops it into
    // aspect-square slots. Landscape first would crop designed artwork live.
    expect(buildEventImageList(fullyKittedEvent)[0]).toBe(SQUARE)
  })

  it('still leads with the landscape only when there is no square', () => {
    const noSquare = { ...fullyKittedEvent, hero_image_url: null }
    expect(buildEventImageList(noSquare)).toEqual([LANDSCAPE, SOCIAL])
  })

  it('returns an empty list when the event has no artwork', () => {
    expect(
      buildEventImageList({
        hero_image_url: null,
        landscape_image_url: null,
        social_image_url: null,
        gallery_image_urls: [],
      })
    ).toEqual([])
  })

  it('drops nulls, blanks and non-strings', () => {
    expect(
      buildEventImageList({
        hero_image_url: SQUARE,
        landscape_image_url: '   ',
        social_image_url: null,
        gallery_image_urls: [null, '', 42, SOCIAL],
      })
    ).toEqual([SQUARE, SOCIAL])
  })

  it('de-duplicates a gallery entry that repeats a variant', () => {
    expect(
      buildEventImageList({ ...fullyKittedEvent, gallery_image_urls: [SQUARE, LANDSCAPE] })
    ).toEqual([SQUARE, LANDSCAPE, SOCIAL])
  })

  it('tolerates a non-array gallery value', () => {
    expect(
      buildEventImageList({ ...legacyEvent, gallery_image_urls: 'not-an-array' })
    ).toEqual([SQUARE])
  })

  it('never carries story or print poster URLs', () => {
    const withInternal = {
      ...fullyKittedEvent,
      story_image_url: 'https://cdn/event-images/events/e1/story/1_story.png',
      print_poster_url: 'https://cdn/event-images/events/e1/print_poster/1_a4.pdf',
    }
    const list = buildEventImageList(withInternal)
    expect(list.some((url) => url.includes('story'))).toBe(false)
    expect(list.some((url) => url.includes('print_poster'))).toBe(false)
  })
})

describe('buildEventImageFields', () => {
  it('returns exactly what a legacy event returns today', () => {
    expect(buildEventImageFields(legacyEvent)).toEqual({
      heroImageUrl: SQUARE,
      thumbnailImageUrl: SQUARE,
      posterImageUrl: SQUARE,
      squareImageUrl: SQUARE,
      landscapeImageUrl: null,
      socialImageUrl: null,
    })
  })

  it('falls back to hero for thumbnail and poster, as the detail route always has', () => {
    expect(
      buildEventImageFields({
        hero_image_url: SQUARE,
        thumbnail_image_url: null,
        poster_image_url: null,
      })
    ).toMatchObject({ thumbnailImageUrl: SQUARE, posterImageUrl: SQUARE })
  })

  it('never puts a print poster on posterImageUrl', () => {
    // the-anchor.pub prefers posterImageUrl over hero, so a print file here
    // would be downloaded and resized on every social crawl.
    const fields = buildEventImageFields({
      ...fullyKittedEvent,
      print_poster_url: 'https://cdn/event-images/events/e1/print_poster/1_a4.pdf',
    } as Parameters<typeof buildEventImageFields>[0])
    expect(fields.posterImageUrl).toBe(SQUARE)
  })

  it('emits no story or print poster field at all', () => {
    const fields = buildEventImageFields(fullyKittedEvent)
    expect(Object.keys(fields).sort()).toEqual([
      'heroImageUrl',
      'landscapeImageUrl',
      'posterImageUrl',
      'socialImageUrl',
      'squareImageUrl',
      'thumbnailImageUrl',
    ])
  })

  it('returns nulls throughout for an event with no artwork', () => {
    expect(buildEventImageFields({})).toEqual({
      heroImageUrl: null,
      thumbnailImageUrl: null,
      posterImageUrl: null,
      squareImageUrl: null,
      landscapeImageUrl: null,
      socialImageUrl: null,
    })
  })
})

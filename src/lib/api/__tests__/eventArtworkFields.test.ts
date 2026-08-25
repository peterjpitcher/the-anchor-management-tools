import { describe, expect, it } from 'vitest'
import { buildEventArtworkPayload } from '../eventArtworkFields'

const SQUARE = 'https://cdn/event-images/events/e1/square/1_sq.png'
const STORY = 'https://cdn/event-images/events/e1/story/1_story.png'
const LANDSCAPE = 'https://cdn/event-images/events/e1/landscape/1_wide.png'

const event = {
  id: 'e1',
  slug: 'karaoke-night',
  hero_image_url: SQUARE,
  story_image_url: STORY,
  landscape_image_url: LANDSCAPE,
}

const rows = [
  { image_type: 'square', mime_type: 'image/png', file_size_bytes: 111, updated_at: '2026-08-24T10:00:00Z' },
  { image_type: 'story', mime_type: 'image/png', file_size_bytes: 222, updated_at: '2026-08-24T18:16:46.387Z' },
  { image_type: 'landscape', mime_type: 'image/png', file_size_bytes: 333, updated_at: '2026-08-24T09:00:00Z' },
]

describe('buildEventArtworkPayload', () => {
  it('emits all three variant keys even when the event has no artwork at all', () => {
    // The consumer distinguishes "no artwork" from "artwork unavailable" purely
    // by this shape, so the keys have to be present with explicit nulls.
    const payload = buildEventArtworkPayload({ id: 'e2', slug: null }, [])
    expect(Object.keys(payload.variants).sort()).toEqual(['landscape', 'square', 'story'])
    expect(payload.variants).toEqual({ square: null, story: null, landscape: null })
    expect(payload.kitUpdatedAt).toBeNull()
  })

  it('carries url, metadata and revision for an owned variant', () => {
    const payload = buildEventArtworkPayload(event, rows)
    expect(payload.variants.story).toEqual({
      url: STORY,
      mimeType: 'image/png',
      sizeBytes: 222,
      updatedAt: '2026-08-24T18:16:46.387Z',
      inherited: false,
    })
  })

  it('reports kitUpdatedAt as the newest variant, not the first', () => {
    expect(buildEventArtworkPayload(event, rows).kitUpdatedAt).toBe('2026-08-24T18:16:46.387Z')
  })

  it('marks a variant inherited when the URL exists but no event_images row does', () => {
    // New events copy event_categories.default_image_url verbatim, so the square
    // is frequently a category stock image this event does not own.
    const payload = buildEventArtworkPayload(event, [rows[1]])
    expect(payload.variants.square).toMatchObject({ url: SQUARE, inherited: true, mimeType: null, sizeBytes: null, updatedAt: null })
    expect(payload.variants.story?.inherited).toBe(false)
  })

  it('ignores a metadata row whose URL column is empty', () => {
    const payload = buildEventArtworkPayload({ ...event, landscape_image_url: '   ' }, rows)
    expect(payload.variants.landscape).toBeNull()
  })

  it('never emits print poster or social, whatever the row set contains', () => {
    const payload = buildEventArtworkPayload(
      { ...event, print_poster_url: 'https://cdn/a4.pdf', social_image_url: 'https://cdn/fb.png' } as never,
      [...rows, { image_type: 'print_poster', mime_type: 'application/pdf', file_size_bytes: 9 }]
    )
    expect(JSON.stringify(payload)).not.toContain('a4.pdf')
    expect(JSON.stringify(payload)).not.toContain('fb.png')
  })

  it('falls back to created_at when a row has never been updated', () => {
    const payload = buildEventArtworkPayload(event, [
      { image_type: 'square', created_at: '2026-01-02T03:04:05Z' },
    ])
    expect(payload.variants.square?.updatedAt).toBe('2026-01-02T03:04:05.000Z')
  })

  it('drops an unparseable timestamp rather than emitting it', () => {
    const payload = buildEventArtworkPayload(event, [{ image_type: 'square', updated_at: 'not-a-date' }])
    expect(payload.variants.square?.updatedAt).toBeNull()
    expect(payload.kitUpdatedAt).toBeNull()
  })
})

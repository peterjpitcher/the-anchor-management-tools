import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeSupabase, type FakeSupabase } from '../helpers/fakeSupabase'

/** Repeating event pictures: only these actions write the image columns, and only inside the event's folder. */

const state = vi.hoisted(() => ({
  db: null as unknown,
  allowed: true,
  removed: [] as string[][],
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => {
    const db = state.db as FakeSupabase & { storage?: unknown }
    db.storage = {
      from: () => ({
        createSignedUploadUrl: async (path: string) => ({ data: { path, token: 'tok' }, error: null }),
        getPublicUrl: (path: string) => ({ data: { publicUrl: `https://x.supabase.co/storage/v1/object/public/event-images/${path}` } }),
        remove: async (paths: string[]) => {
          state.removed.push(paths)
          return { error: null }
        },
      }),
    }
    return db
  },
}))
vi.mock('@/lib/supabase/current-user', () => ({ getCurrentUser: async () => ({ user: { id: 'u1', email: null }, error: null }) }))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn(async () => state.allowed) }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

import {
  confirmEventSeriesImageUpload,
  deleteEventSeriesImage,
  requestEventSeriesImageUpload,
} from '@/app/actions/event-series-images'

const SERIES = '6b1c2b8e-1d5a-4a4f-9c1e-2f3a4b5c6d7e'
const OLD = `https://x.supabase.co/storage/v1/object/public/event-images/event-series/${SERIES}/square/1_old.jpg`

function seed(square: string | null = null) {
  state.db = createFakeSupabase({ event_series: [{ id: SERIES, square_image_url: square }] })
  return state.db as FakeSupabase
}

beforeEach(() => {
  state.allowed = true
  state.removed = []
})

describe('repeating event pictures', () => {
  it('signs an upload inside the event folder after checking the shape', async () => {
    seed()
    const wrong = await requestEventSeriesImageUpload({ seriesId: SERIES, variant: 'square', fileName: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 1000, width: 1920, height: 1080 })
    expect('error' in wrong && wrong.error).toMatch(/expects a 1:1 image/)
    const ok = await requestEventSeriesImageUpload({ seriesId: SERIES, variant: 'square', fileName: 'My poster.jpg', mimeType: 'image/jpeg', sizeBytes: 1000, width: 1080, height: 1080 })
    expect('path' in ok && ok.path).toMatch(new RegExp(`^event-series/${SERIES}/square/\\d+_My_poster\\.jpg$`))
  })

  it('refuses a confirmed path outside the event folder', async () => {
    const db = seed()
    const result = await confirmEventSeriesImageUpload({ seriesId: SERIES, variant: 'square', storagePath: `events/other/square/1_x.jpg` })
    expect(result.error).toBe('That upload does not belong to this repeating event.')
    expect(db.tables.event_series[0].square_image_url).toBeNull()
  })

  it('records the new picture and removes the one it replaced', async () => {
    const db = seed(OLD)
    const path = `event-series/${SERIES}/square/2_new.jpg`
    const result = await confirmEventSeriesImageUpload({ seriesId: SERIES, variant: 'square', storagePath: path })
    expect(result.success).toBe(true)
    expect(db.tables.event_series[0].square_image_url).toContain(path)
    expect(state.removed).toEqual([[`event-series/${SERIES}/square/1_old.jpg`]])
  })

  it('removes a picture, and never deletes a file outside the event folder', async () => {
    const db = seed('https://elsewhere.example/poster.jpg')
    expect((await deleteEventSeriesImage({ seriesId: SERIES, variant: 'square' })).success).toBe(true)
    expect(db.tables.event_series[0].square_image_url).toBeNull()
    expect(state.removed).toEqual([])
  })

  it('needs events:edit', async () => {
    seed()
    state.allowed = false
    expect((await deleteEventSeriesImage({ seriesId: SERIES, variant: 'square' })).error).toMatch(/permission/)
  })
})

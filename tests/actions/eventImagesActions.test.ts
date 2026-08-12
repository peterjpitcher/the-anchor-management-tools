import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { logAuditEvent } from '@/app/actions/audit'
import { deleteEventImage, updateImageMetadata } from '@/app/actions/event-images'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

const BUCKET_URL = 'https://cdn.example.com/storage/v1/object/public/event-images/'

describe('deleteEventImage rollback safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('still succeeds when the storage object cannot be removed', async () => {
    // The event reference is cleared before storage is touched, so a storage
    // failure only ever leaves an unreachable file. Reporting that as a failed
    // delete would send the user round again against an already-cleared event.
    const imageUrl = `${BUCKET_URL}events/event-1/hero/123_image-1.jpg`

    const metadataDeleteEq2 = vi.fn().mockResolvedValue({ error: null })
    const metadataDeleteEq1 = vi.fn().mockReturnValue({ eq: metadataDeleteEq2 })
    const storageRemove = vi.fn().mockResolvedValue({ error: { message: 'storage unavailable' } })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'event_images') {
          return { delete: vi.fn().mockReturnValue({ eq: metadataDeleteEq1 }) }
        }

        if (table === 'events') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null }),
                }),
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: imageUrl } }),
          remove: storageRemove,
        }),
      },
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    }

    mockedCreateClient.mockResolvedValue(client)
    mockedCreateAdminClient.mockReturnValue(client)

    const result = await deleteEventImage(imageUrl, 'event-1')

    expect(result).toEqual({ success: true })
    expect(storageRemove).toHaveBeenCalledWith(['events/event-1/hero/123_image-1.jpg'])
  })

  it('leaves a category-owned object in place', async () => {
    // 16 live events point at a category object, one of them shared by 8 events.
    // Removing the file here would blank the image on all of them.
    const imageUrl = `${BUCKET_URL}categories/cat-1/hero/1_shared.png`

    const metadataDelete = vi.fn()
    const storageRemove = vi.fn()

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'event_images') {
          return { delete: metadataDelete }
        }

        if (table === 'events') {
          return {
            update: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({
                select: vi.fn().mockReturnValue({
                  maybeSingle: vi.fn().mockResolvedValue({ data: { id: 'event-1' }, error: null }),
                }),
              }),
            }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: imageUrl } }),
          remove: storageRemove,
        }),
      },
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    }

    mockedCreateClient.mockResolvedValue(client)
    mockedCreateAdminClient.mockReturnValue(client)

    const result = await deleteEventImage(imageUrl, 'event-1')

    expect(result).toEqual({ success: true })
    expect(storageRemove).not.toHaveBeenCalled()
    expect(metadataDelete).not.toHaveBeenCalled()
  })

  it('returns event-not-found when image clear update affects no event rows', async () => {
    const selectEq = vi.fn().mockResolvedValue({ data: [], error: null })
    const updateMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const updateSelect = vi.fn().mockReturnValue({ maybeSingle: updateMaybeSingle })
    const updateEq = vi.fn().mockReturnValue({ select: updateSelect })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'event_images') {
          return {
            select: vi.fn().mockReturnValue({ eq: selectEq }),
          }
        }

        if (table === 'events') {
          return {
            update: vi.fn().mockReturnValue({ eq: updateEq }),
          }
        }

        throw new Error(`Unexpected table: ${table}`)
      }),
      storage: {
        from: vi.fn().mockReturnValue({
          getPublicUrl: vi.fn().mockReturnValue({ data: { publicUrl: 'https://cdn.example.com/noop.jpg' } }),
          remove: vi.fn(),
        }),
      },
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: null }, error: null }),
      },
    }

    mockedCreateClient.mockResolvedValue(client)
    mockedCreateAdminClient.mockReturnValue(client)

    const result = await deleteEventImage('https://cdn.example.com/noop.jpg', 'event-missing')

    expect(result).toEqual({ error: 'Event not found.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns image-not-found when metadata update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    const client = {
      from: vi.fn((table: string) => {
        if (table !== 'event_images') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    }

    mockedCreateAdminClient.mockReturnValue(client)

    const result = await updateImageMetadata('img-404', { alt_text: 'Updated alt text' })

    expect(result).toEqual({ error: 'Image not found.' })
  })
})

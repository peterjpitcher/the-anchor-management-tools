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

import { checkUserPermission } from '@/app/actions/rbac'
import { createClient } from '@/lib/supabase/server'
import { logAuditEvent } from '@/app/actions/audit'
import { deleteEventImage, updateImageMetadata } from '@/app/actions/event-images'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedLogAuditEvent = logAuditEvent as unknown as Mock

describe('deleteEventImage rollback safety', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
  })

  it('re-inserts metadata and fails when storage deletion fails', async () => {
    const imageUrl = 'https://cdn.example.com/events/image-1.jpg'
    const imageRow = {
      id: 'img-1',
      event_id: 'event-1',
      storage_path: 'events/event-1/hero/123_image-1.jpg',
      file_name: 'image-1.jpg',
      mime_type: 'image/jpeg',
      file_size_bytes: 1024,
      image_type: 'hero',
      alt_text: null,
      caption: null,
      display_order: 0,
      uploaded_by: 'user-1',
      created_at: '2026-02-14T00:00:00.000Z',
      updated_at: '2026-02-14T00:00:00.000Z',
    }

    const selectEq = vi.fn().mockResolvedValue({ data: [imageRow], error: null })
    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: imageRow, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })
    const insert = vi.fn().mockResolvedValue({ error: null })

    const storageRemove = vi.fn().mockResolvedValue({ error: { message: 'storage unavailable' } })

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'event_images') {
          return {
            select: vi.fn().mockReturnValue({ eq: selectEq }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
            insert,
          }
        }

        if (table === 'events') {
          return {
            update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ error: null }) }),
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

    const result = await deleteEventImage(imageUrl, 'event-1')

    expect(result).toEqual({ error: 'Failed to remove image from storage.' })
    expect(insert).toHaveBeenCalledWith({
      id: imageRow.id,
      event_id: imageRow.event_id,
      storage_path: imageRow.storage_path,
      file_name: imageRow.file_name,
      mime_type: imageRow.mime_type,
      file_size_bytes: imageRow.file_size_bytes,
      image_type: imageRow.image_type,
      alt_text: imageRow.alt_text,
      caption: imageRow.caption,
      display_order: imageRow.display_order,
      uploaded_by: imageRow.uploaded_by,
      created_at: imageRow.created_at,
      updated_at: imageRow.updated_at,
    })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns image-not-found when metadata delete affects no rows', async () => {
    const imageUrl = 'https://cdn.example.com/events/image-missing.jpg'
    const imageRow = {
      id: 'img-missing',
      event_id: 'event-1',
      storage_path: 'events/event-1/hero/missing.jpg',
    }

    const selectEq = vi.fn().mockResolvedValue({ data: [imageRow], error: null })
    const deleteMaybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const deleteSelect = vi.fn().mockReturnValue({ maybeSingle: deleteMaybeSingle })
    const deleteEq = vi.fn().mockReturnValue({ select: deleteSelect })
    const storageRemove = vi.fn()

    const client = {
      from: vi.fn((table: string) => {
        if (table === 'event_images') {
          return {
            select: vi.fn().mockReturnValue({ eq: selectEq }),
            delete: vi.fn().mockReturnValue({ eq: deleteEq }),
          }
        }

        if (table === 'events') {
          return {
            update: vi.fn(),
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

    const result = await deleteEventImage(imageUrl, 'event-1')

    expect(result).toEqual({ error: 'Image not found.' })
    expect(storageRemove).not.toHaveBeenCalled()
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

    const result = await deleteEventImage('https://cdn.example.com/noop.jpg', 'event-missing')

    expect(result).toEqual({ error: 'Event not found.' })
    expect(mockedLogAuditEvent).not.toHaveBeenCalled()
  })

  it('returns image-not-found when metadata update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'event_images') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    const result = await updateImageMetadata('img-404', { alt_text: 'Updated alt text' })

    expect(result).toEqual({ error: 'Image not found.' })
  })
})

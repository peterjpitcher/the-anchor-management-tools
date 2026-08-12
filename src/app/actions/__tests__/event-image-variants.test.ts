import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const permission = { granted: true }

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(async () => permission.granted),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'staff@example.com' } },
      }),
    },
  }),
}))

const state = {
  eventExists: true,
  signedUpload: { data: { path: 'signed/path', token: 'tok' }, error: null } as {
    data: { path: string; token: string } | null
    error: unknown
  },
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  removed: [] as string[][],
  removeError: null as unknown,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: state.eventExists ? { id: 'e1' } : null,
            error: null,
          }),
        }),
        // getEventImageVariants awaits the eq() directly for event_images.
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
      }),
    }),
    rpc: async (fn: string, args: Record<string, unknown>) => {
      state.rpcCalls.push({ fn, args })
      return state.rpcResults[fn] ?? { data: null, error: null }
    },
    storage: {
      from: () => ({
        createSignedUploadUrl: async () => state.signedUpload,
        getPublicUrl: (path: string) => ({
          data: { publicUrl: `https://p.supabase.co/storage/v1/object/public/event-images/${path}` },
        }),
        remove: async (paths: string[]) => {
          state.removed.push(paths)
          return { error: state.removeError }
        },
      }),
    },
  })),
}))

import {
  confirmEventImageUpload,
  deleteEventImageVariant,
  requestEventImageUpload,
} from '../event-image-variants'

const EVENT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  permission.granted = true
  state.eventExists = true
  state.signedUpload = { data: { path: 'signed/path', token: 'tok' }, error: null }
  state.rpcResults = {}
  state.rpcCalls = []
  state.removed = []
  state.removeError = null
})

// ---------------------------------------------------------------------------
// requestEventImageUpload
// ---------------------------------------------------------------------------

describe('requestEventImageUpload', () => {
  const base = {
    eventId: EVENT_ID,
    variant: 'square' as const,
    fileName: 'art.png',
    mimeType: 'image/png',
    sizeBytes: 1000,
    width: 1080,
    height: 1080,
  }

  it('issues a signed URL for a valid file', async () => {
    const result = await requestEventImageUpload(base)
    expect(result).toEqual({ path: 'signed/path', token: 'tok' })
  })

  it('refuses without the events edit permission', async () => {
    permission.granted = false
    const result = await requestEventImageUpload(base)
    expect(result).toEqual({ error: 'You do not have permission to upload event images.' })
  })

  it('refuses a PDF for a web variant', async () => {
    const result = await requestEventImageUpload({
      ...base,
      mimeType: 'application/pdf',
      fileName: 'a4.pdf',
    })
    expect(result).toHaveProperty('error')
    expect((result as { error: string }).error).toContain('Square accepts')
  })

  it('accepts a PDF for the print poster', async () => {
    const result = await requestEventImageUpload({
      ...base,
      variant: 'print_poster',
      mimeType: 'application/pdf',
      fileName: 'a4.pdf',
      width: 0,
      height: 0,
    })
    expect(result).toEqual({ path: 'signed/path', token: 'tok' })
  })

  it('refuses a file over the variant cap', async () => {
    const result = await requestEventImageUpload({ ...base, sizeBytes: 11 * 1024 * 1024 })
    expect((result as { error: string }).error).toContain('must be under')
  })

  it('allows the print poster the larger cap that a web variant refuses', async () => {
    const twentyMb = 20 * 1024 * 1024
    expect(await requestEventImageUpload({ ...base, sizeBytes: twentyMb })).toHaveProperty('error')
    expect(
      await requestEventImageUpload({
        ...base,
        variant: 'print_poster',
        sizeBytes: twentyMb,
        width: 2480,
        height: 3508,
      })
    ).toEqual({ path: 'signed/path', token: 'tok' })
  })

  it('refuses a file whose shape belongs in a different tile', async () => {
    const result = await requestEventImageUpload({
      ...base,
      variant: 'landscape',
      width: 1080,
      height: 1080,
    })
    expect((result as { error: string }).error).toContain('Landscape expects a 16:9 image')
  })

  it('does not ratio-check a PDF', async () => {
    const result = await requestEventImageUpload({
      ...base,
      variant: 'print_poster',
      mimeType: 'application/pdf',
      fileName: 'a4.pdf',
      width: 3000,
      height: 100,
    })
    expect(result).toEqual({ path: 'signed/path', token: 'tok' })
  })

  it('refuses an unknown event', async () => {
    state.eventExists = false
    expect(await requestEventImageUpload(base)).toEqual({ error: 'Event not found.' })
  })
})

// ---------------------------------------------------------------------------
// confirmEventImageUpload
// ---------------------------------------------------------------------------

describe('confirmEventImageUpload', () => {
  const base = {
    eventId: EVENT_ID,
    variant: 'landscape' as const,
    storagePath: `events/${EVENT_ID}/landscape/1_a.png`,
    fileName: 'a.png',
    mimeType: 'image/png',
    sizeBytes: 1000,
  }

  it('records the upload and returns the public URL', async () => {
    const result = await confirmEventImageUpload(base)
    expect(result.success).toBe(true)
    expect(result.publicUrl).toContain(base.storagePath)
    expect(state.rpcCalls[0].fn).toBe('upsert_event_image_variant')
    expect(state.rpcCalls[0].args.p_public_url).toContain('/storage/v1/object/public/')
    // The cache column holds the public URL, not the bucket path.
    expect(state.rpcCalls[0].args.p_storage_path).toBe(base.storagePath)
  })

  it('refuses a path that belongs to another event', async () => {
    const result = await confirmEventImageUpload({
      ...base,
      storagePath: 'events/22222222-2222-2222-2222-222222222222/landscape/1_a.png',
    })
    expect(result.error).toBe('That upload does not belong to this event.')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('refuses a path pointing at category-owned artwork', async () => {
    const result = await confirmEventImageUpload({
      ...base,
      storagePath: 'categories/cat-1/hero/1_shared.png',
    })
    expect(result.error).toBe('That upload does not belong to this event.')
  })

  it('refuses a path in the wrong variant folder', async () => {
    const result = await confirmEventImageUpload({
      ...base,
      storagePath: `events/${EVENT_ID}/square/1_a.png`,
    })
    expect(result.error).toBe('That upload does not belong to this event.')
  })

  it('takes the new object back out when the database write fails', async () => {
    // Nothing references it, so removing it can only ever create an orphan.
    state.rpcResults.upsert_event_image_variant = { data: null, error: { message: 'boom' } }
    const result = await confirmEventImageUpload(base)
    expect(result.error).toBe('Could not save the image.')
    expect(state.removed).toEqual([[base.storagePath]])
  })

  it('removes the object it replaced, after the write commits', async () => {
    const previous = `events/${EVENT_ID}/landscape/0_old.png`
    state.rpcResults.upsert_event_image_variant = { data: previous, error: null }
    const result = await confirmEventImageUpload(base)
    expect(result.success).toBe(true)
    expect(state.removed).toEqual([[previous]])
  })

  it('never removes a replaced object the event does not own', async () => {
    state.rpcResults.upsert_event_image_variant = {
      data: 'categories/cat-1/hero/1_shared.png',
      error: null,
    }
    const result = await confirmEventImageUpload(base)
    expect(result.success).toBe(true)
    expect(state.removed).toEqual([])
  })

  it('still reports success when cleaning up the old object fails', async () => {
    // The replacement is live and correct. Reporting a failure here would send
    // the user round again and create a second orphan.
    state.rpcResults.upsert_event_image_variant = {
      data: `events/${EVENT_ID}/landscape/0_old.png`,
      error: null,
    }
    state.removeError = { message: 'storage down' }
    expect((await confirmEventImageUpload(base)).success).toBe(true)
  })

  it('refuses without permission', async () => {
    permission.granted = false
    expect((await confirmEventImageUpload(base)).error).toContain('permission')
  })
})

// ---------------------------------------------------------------------------
// deleteEventImageVariant
// ---------------------------------------------------------------------------

describe('deleteEventImageVariant', () => {
  it('removes the object the event owns', async () => {
    const path = `events/${EVENT_ID}/story/1_a.png`
    state.rpcResults.delete_event_image_variant = { data: path, error: null }
    const result = await deleteEventImageVariant(EVENT_ID, 'story')
    expect(result.success).toBe(true)
    expect(state.removed).toEqual([[path]])
  })

  it('removes nothing when the artwork is inherited from the category', async () => {
    // The RPC returns null because the event owns no row for that variant.
    state.rpcResults.delete_event_image_variant = { data: null, error: null }
    const result = await deleteEventImageVariant(EVENT_ID, 'square')
    expect(result.success).toBe(true)
    expect(state.removed).toEqual([])
  })

  it('refuses to remove an object outside the event folder', async () => {
    state.rpcResults.delete_event_image_variant = {
      data: 'categories/cat-1/hero/1_shared.png',
      error: null,
    }
    await deleteEventImageVariant(EVENT_ID, 'square')
    expect(state.removed).toEqual([])
  })

  it('touches no storage when the database call fails', async () => {
    state.rpcResults.delete_event_image_variant = { data: null, error: { message: 'boom' } }
    const result = await deleteEventImageVariant(EVENT_ID, 'square')
    expect(result.error).toBe('Could not remove the image.')
    expect(state.removed).toEqual([])
  })

  it('still reports success when the file cannot be removed', async () => {
    // The reference is already gone, so the delete has succeeded. An orphaned
    // file is the safe failure mode; a broken live image is not.
    state.rpcResults.delete_event_image_variant = {
      data: `events/${EVENT_ID}/story/1_a.png`,
      error: null,
    }
    state.removeError = { message: 'storage down' }
    expect((await deleteEventImageVariant(EVENT_ID, 'story')).success).toBe(true)
  })

  it('rejects an unknown variant', async () => {
    const result = await deleteEventImageVariant(EVENT_ID, 'hero' as never)
    expect(result.error).toBe('Invalid delete request.')
    expect(state.rpcCalls).toHaveLength(0)
  })

  it('refuses without permission', async () => {
    permission.granted = false
    expect((await deleteEventImageVariant(EVENT_ID, 'square')).error).toContain('permission')
  })
})

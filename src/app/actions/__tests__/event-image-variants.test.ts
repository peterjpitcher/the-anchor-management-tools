import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

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
  eventRow: { id: 'e1' } as Record<string, unknown>,
  imageRows: [] as Record<string, unknown>[],
  imageRowsError: null as unknown,
  signedUpload: { data: { path: 'signed/path', token: 'tok' }, error: null } as {
    data: { path: string; token: string } | null
    error: unknown
  },
  rpcResults: {} as Record<string, { data: unknown; error: unknown }>,
  rpcCalls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  removed: [] as string[][],
  removeError: null as unknown,
  // The branding row read back by clearBrandingForFreshUpload, plus a record of
  // every update it issues, so the clear-on-replace behaviour can be asserted.
  brandingRow: null as Record<string, unknown> | null,
  brandingReadError: null as unknown,
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  updateError: null as unknown,
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      select: () => ({
        // `events` is read with maybeSingle; `event_images` is a list the caller
        // awaits straight off eq(), so the same object answers both.
        eq: () => {
          const result =
            table === 'event_images'
              ? { data: state.imageRows, error: state.imageRowsError }
              : { data: state.eventExists ? state.eventRow : null, error: null }
          return {
            maybeSingle: async () => result,
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
            // A second eq narrows event_images to one variant, which is how the
            // branding clear-down reads the row it is about to wipe.
            eq: () => ({
              maybeSingle: async () => ({
                data: state.brandingRow,
                error: state.brandingReadError,
              }),
            }),
          }
        },
      }),
      update: (values: Record<string, unknown>) => {
        state.updates.push({ table, values })
        const result = { data: null, error: state.updateError }
        return {
          eq: () => ({
            eq: () => Promise.resolve(result),
            then: (resolve: (v: unknown) => unknown) => Promise.resolve(result).then(resolve),
          }),
        }
      },
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
  getEventImageVariants,
  requestEventImageUpload,
} from '../event-image-variants'

const EVENT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(() => {
  permission.granted = true
  state.eventExists = true
  state.eventRow = { id: 'e1' }
  state.imageRows = []
  state.imageRowsError = null
  state.brandingRow = null
  state.brandingReadError = null
  state.updates = []
  state.updateError = null
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

// ---------------------------------------------------------------------------
// getEventImageVariants, reading branding back
// ---------------------------------------------------------------------------

const SQUARE_PATH = `events/${EVENT_ID}/square/1_a.png`
const SQUARE_URL = `https://p.supabase.co/storage/v1/object/public/event-images/${SQUARE_PATH}`

/** An event_images row with every branding column empty, to override piecemeal. */
function imageRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    image_type: 'square',
    storage_path: SQUARE_PATH,
    file_name: 'a.png',
    file_size_bytes: 1000,
    mime_type: 'image/png',
    updated_at: '2026-09-06T10:00:00Z',
    original_storage_path: null,
    logo_corner: null,
    logo_centre_x_frac: null,
    logo_centre_y_frac: null,
    logo_colour: null,
    logo_width_frac: null,
    qr_centre_x_frac: null,
    qr_centre_y_frac: null,
    qr_width_frac: null,
    qr_short_link_id: null,
    ...overrides,
  }
}

async function readSquare() {
  const result = await getEventImageVariants(EVENT_ID)
  const square = result.data?.find((entry) => entry.variant === 'square')
  if (!square) throw new Error('the square variant was not returned')
  return square
}

describe('getEventImageVariants branding', () => {
  let warn: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    state.eventRow = { hero_image_url: SQUARE_URL, category: null }
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('reads a corner placement back as a corner placement', async () => {
    state.imageRows = [
      imageRow({
        original_storage_path: `events/${EVENT_ID}/square/0_original.png`,
        logo_corner: 'top_left',
        logo_colour: 'black',
        logo_width_frac: 0.3,
      }),
    ]

    const square = await readSquare()

    expect(square.branding).toEqual({
      originalStoragePath: `events/${EVENT_ID}/square/0_original.png`,
      logo: {
        placement: { mode: 'corner', corner: 'top_left', widthFrac: 0.3 },
        colour: 'black',
      },
      qr: null,
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('reads centre fractions back as a free placement', async () => {
    state.imageRows = [
      imageRow({
        original_storage_path: `events/${EVENT_ID}/square/0_original.png`,
        logo_centre_x_frac: 0.25,
        logo_centre_y_frac: 0.6,
        logo_colour: 'white',
        logo_width_frac: 0.18,
      }),
    ]

    const square = await readSquare()

    expect(square.branding?.logo).toEqual({
      placement: { mode: 'free', centreXFrac: 0.25, centreYFrac: 0.6, widthFrac: 0.18 },
      colour: 'white',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('reports no branding at all as null', async () => {
    state.imageRows = [imageRow()]

    const square = await readSquare()

    expect(square.branding).toBeNull()
    expect(square.url).toBe(SQUARE_URL)
  })

  it('distinguishes branded with no logo from never branded', async () => {
    // A deliberate "no logo" still went through the editor, so the original is
    // kept. Reporting this as null would reopen the editor at the defaults and
    // put a logo back on a poster somebody chose to leave clean.
    state.imageRows = [
      imageRow({ original_storage_path: `events/${EVENT_ID}/square/0_original.png` }),
    ]

    const square = await readSquare()

    expect(square.branding).not.toBeNull()
    expect(square.branding?.logo).toBeNull()
    expect(square.branding?.originalStoragePath).toBe(`events/${EVENT_ID}/square/0_original.png`)
  })

  it('refuses to guess when a row holds both a corner and centre fractions', async () => {
    state.imageRows = [
      imageRow({
        original_storage_path: `events/${EVENT_ID}/square/0_original.png`,
        logo_corner: 'bottom_right',
        logo_centre_x_frac: 0.4,
        logo_centre_y_frac: 0.4,
        logo_colour: 'white',
        logo_width_frac: 0.22,
      }),
    ]

    const square = await readSquare()

    expect(square.branding).not.toBeNull()
    expect(square.branding?.logo).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treating the logo as unplaced'),
      expect.objectContaining({ eventId: EVENT_ID, variant: 'square' })
    )
  })

  it('refuses to guess when only half a centre pair is set', async () => {
    state.imageRows = [
      imageRow({
        original_storage_path: `events/${EVENT_ID}/square/0_original.png`,
        logo_centre_x_frac: 0.4,
        logo_colour: 'white',
        logo_width_frac: 0.22,
      }),
    ]

    const square = await readSquare()

    expect(square.branding?.logo).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('treats a placement with no colour or width as unplaced', async () => {
    state.imageRows = [imageRow({ logo_corner: 'top_right' })]

    const square = await readSquare()

    expect(square.branding?.logo).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('reads the QR centre, width and short link id back', async () => {
    state.imageRows = [
      imageRow({
        image_type: 'print_poster',
        storage_path: `events/${EVENT_ID}/print_poster/1_a.png`,
        qr_centre_x_frac: 0.5,
        qr_centre_y_frac: 0.82,
        qr_width_frac: 0.24,
        qr_short_link_id: '99999999-9999-4999-8999-999999999999',
      }),
    ]
    state.eventRow = { print_poster_url: SQUARE_URL, category: null }

    const result = await getEventImageVariants(EVENT_ID)
    const poster = result.data?.find((entry) => entry.variant === 'print_poster')

    expect(poster?.branding?.qr).toEqual({
      centreXFrac: 0.5,
      centreYFrac: 0.82,
      widthFrac: 0.24,
      shortLinkId: '99999999-9999-4999-8999-999999999999',
    })
    expect(warn).not.toHaveBeenCalled()
  })

  it('drops a half-written QR placement rather than printing a guess', async () => {
    state.imageRows = [imageRow({ qr_centre_x_frac: 0.5, qr_width_frac: 0.24 })]

    const square = await readSquare()

    expect(square.branding?.qr).toBeNull()
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('treating the code as unplaced'),
      expect.objectContaining({ eventId: EVENT_ID, variant: 'square' })
    )
  })

  it('leaves every unbranded variant null', async () => {
    state.imageRows = [
      imageRow({ logo_corner: 'top_left', logo_colour: 'white', logo_width_frac: 0.2 }),
    ]

    const result = await getEventImageVariants(EVENT_ID)

    expect(result.data?.filter((entry) => entry.branding !== null)).toHaveLength(1)
  })

  it('refuses without permission', async () => {
    permission.granted = false
    expect((await getEventImageVariants(EVENT_ID)).error).toContain('permission')
  })
})

describe('confirmEventImageUpload clears branding when a file is replaced', () => {
  const BRANDED_ROW = {
    original_storage_path: `events/${EVENT_ID}/print_poster/original-1.png`,
    logo_corner: 'top_left',
    logo_colour: 'white',
    logo_width_frac: 0.22,
  }

  function confirm() {
    return confirmEventImageUpload({
      eventId: EVENT_ID,
      variant: 'print_poster',
      storagePath: `events/${EVENT_ID}/print_poster/999_new.png`,
      fileName: 'new.png',
      mimeType: 'image/png',
      sizeBytes: 1000,
    })
  }

  it('nulls every branding column, so a fresh upload is not shown as branded', async () => {
    state.brandingRow = { ...BRANDED_ROW }
    const result = await confirm()
    expect(result.success).toBe(true)

    const update = state.updates.find((u) => u.table === 'event_images')
    expect(update).toBeDefined()
    // All ten, not just the ones the UI happens to read today.
    for (const column of [
      'original_storage_path',
      'logo_corner',
      'logo_centre_x_frac',
      'logo_centre_y_frac',
      'logo_colour',
      'logo_width_frac',
      'qr_centre_x_frac',
      'qr_centre_y_frac',
      'qr_width_frac',
      'qr_short_link_id',
    ]) {
      expect(update?.values, `${column} should be cleared`).toHaveProperty(column, null)
    }
  })

  it('removes the superseded original, which nothing else deletes', async () => {
    state.brandingRow = { ...BRANDED_ROW }
    await confirm()
    expect(state.removed.flat()).toContain(BRANDED_ROW.original_storage_path)
  })

  it('never removes an original the event does not own', async () => {
    state.brandingRow = {
      ...BRANDED_ROW,
      original_storage_path: 'categories/other/original-1.png',
    }
    await confirm()
    expect(state.removed.flat()).not.toContain('categories/other/original-1.png')
  })

  it('does nothing when the previous file carried no branding', async () => {
    state.brandingRow = { original_storage_path: null }
    await confirm()
    expect(state.removed.flat()).not.toContain(null as never)
  })

  it('still reports success when the branding clear-down fails', async () => {
    // The upload has already committed and the new image is live, so a failure
    // here is cosmetic and must never surface as a failed upload.
    state.brandingRow = { ...BRANDED_ROW }
    state.updateError = new Error('column does not exist')
    const result = await confirm()
    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    // And the original is NOT deleted, since the row still references it.
    expect(state.removed.flat()).not.toContain(BRANDED_ROW.original_storage_path)
  })

  it('still reports success when the branding read fails', async () => {
    state.brandingReadError = new Error('unreachable')
    const result = await confirm()
    expect(result.success).toBe(true)
  })
})

// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

const EVENT_ID = '3f1d9e2c-7b4a-4c8e-9a11-2d5f6b7c8d90'
const PUBLIC_PREFIX = 'https://cdn.test/storage/v1/object/public/event-images/'
const BRANDED_PATH = `events/${EVENT_ID}/table_talker/branded/1788881610832-table_talker.png`

const state = {
  permission: { ok: true } as { ok: true } | { ok: false; status: number },
  permissionAsked: [] as Array<[string, string]>,
  event: null as Record<string, unknown> | null,
  eventError: null as unknown,
  file: null as Buffer | null,
  downloadError: null as unknown,
  downloaded: [] as string[],
}

const fakeClient = {
  from: (table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => {
          if (table !== 'events') throw new Error(`unexpected table ${table}`)
          return { data: state.event, error: state.eventError }
        },
      }),
    }),
  }),
  storage: {
    from: (bucket: string) => ({
      download: async (path: string) => {
        if (bucket !== 'event-images') throw new Error(`unexpected bucket ${bucket}`)
        state.downloaded.push(path)
        if (state.downloadError || !state.file) return { data: null, error: state.downloadError ?? { message: 'Object not found' } }
        const bytes = state.file
        return { data: { arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }, error: null }
      },
    }),
  },
}

vi.mock('@/lib/api/permissions', () => ({
  requireModulePermission: vi.fn(async (moduleName: string, action: string) => {
    state.permissionAsked.push([moduleName, action])
    return state.permission.ok
      ? { ok: true, userId: 'user-1', supabase: fakeClient }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: state.permission.status }) }
  }),
}))

import { GET } from './route'

async function png(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 30, g: 60, b: 90 } } }).png().toBuffer()
}

function call(id = EVENT_ID): Promise<Response> {
  return GET(new Request(`https://app.test/api/events/${id}/artwork/table-talker-sheet`) as never, {
    params: Promise.resolve({ id }),
  })
}

beforeEach(async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  state.permission = { ok: true }
  state.permissionAsked = []
  state.event = { id: EVENT_ID, name: 'Quiz Night: Autumn Kick-off', table_talker_url: `${PUBLIC_PREFIX}${BRANDED_PATH}` }
  state.eventError = null
  state.file = await png(1169, 2480)
  state.downloadError = null
  state.downloaded = []
})

describe('GET /api/events/[id]/artwork/table-talker-sheet', () => {
  it('returns the branded table talker three to an A4 sheet', async () => {
    const response = await call()

    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe('application/pdf')
    expect(response.headers.get('Content-Disposition')).toBe(
      'attachment; filename="quiz-night-autumn-kick-off-table-talkers-a4.pdf"'
    )
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')

    const pdf = await PDFDocument.load(new Uint8Array(await response.arrayBuffer()), { updateMetadata: false })
    expect(pdf.getPageCount()).toBe(1)
    expect(pdf.getTitle()).toBe('Table talkers: Quiz Night: Autumn Kick-off')
    expect(state.downloaded).toEqual([BRANDED_PATH])
  })

  it('checks the events view permission before touching anything', async () => {
    state.permission = { ok: false, status: 403 }

    const response = await call()

    expect(response.status).toBe(403)
    expect(state.permissionAsked).toEqual([['events', 'view']])
    expect(state.downloaded).toHaveLength(0)
  })

  it('refuses a malformed id without asking the database', async () => {
    const response = await call('not-a-uuid')
    expect(response.status).toBe(400)
    expect(state.permissionAsked).toHaveLength(0)
  })

  it('says so when the event does not exist', async () => {
    state.event = null
    const response = await call()
    expect(response.status).toBe(404)
  })

  it('says there is nothing to print when no table talker has been uploaded', async () => {
    state.event = { id: EVENT_ID, name: 'Quiz Night', table_talker_url: null }

    const response = await call()

    expect(response.status).toBe(409)
    expect((await response.json()).code).toBe('table_talker_missing')
  })

  it('will not print a table talker that has not been branded', async () => {
    // A staff upload sits directly in the variant folder, never in branded/.
    state.event = {
      id: EVENT_ID,
      name: 'Quiz Night',
      table_talker_url: `${PUBLIC_PREFIX}events/${EVENT_ID}/table_talker/1788881600000_talker.png`,
    }

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.code).toBe('table_talker_unbranded')
    expect(body.error).toMatch(/^Brand the table talker before printing it/)
    expect(state.downloaded).toHaveLength(0)
  })

  it('will not print a branded file that belongs to another event or another size', async () => {
    for (const path of [
      `events/aa11bb22-cc33-4d44-8e55-ff6677889900/table_talker/branded/1-table_talker.png`,
      `events/${EVENT_ID}/print_poster/branded/1-print_poster.png`,
    ]) {
      state.event = { id: EVENT_ID, name: 'Quiz Night', table_talker_url: `${PUBLIC_PREFIX}${path}` }
      const response = await call()
      expect(response.status).toBe(409)
    }
    expect(state.downloaded).toHaveLength(0)
  })

  it('refuses a panel that would print soft, and says what size to upload', async () => {
    state.file = await png(500, 1061)

    const response = await call()
    const body = await response.json()

    expect(response.status).toBe(422)
    expect(body.code).toBe('resolution_too_low')
    expect(body.error).toContain('at least 546 px wide')
  })

  it('reports a storage failure as ours, not as a problem with the artwork', async () => {
    state.downloadError = { message: 'upstream timeout' }

    const response = await call()

    expect(response.status).toBe(502)
    expect((await response.json()).error).toBe('Could not read the table talker from storage. Try again in a moment.')
  })

  it('refuses a stored file that is not a PNG or a JPEG', async () => {
    state.file = await sharp({ create: { width: 1169, height: 2480, channels: 3, background: '#fff' } }).webp().toBuffer()
    const response = await call()
    expect(response.status).toBe(422)
    expect((await response.json()).code).toBe('image_unsupported')
  })

  it('answers a database failure with a 500 and a retry, never a half sheet', async () => {
    state.eventError = { message: 'connection reset' }
    const response = await call()
    expect(response.status).toBe(500)
    expect(state.downloaded).toHaveLength(0)
  })
})

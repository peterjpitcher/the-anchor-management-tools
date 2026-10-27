import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * FOH staff change a booking's notes and allergies from the floor (BK-052). The audit row says
 * which fields changed, never what they say: it is health information.
 */

const mocks = vi.hoisted(() => ({
  permission: vi.fn(),
  update: vi.fn(),
  result: { data: null as unknown, error: null as { message: string } | null },
  audit: vi.fn(),
}))

vi.mock('@/lib/foh/api-auth', () => ({ requireFohPermission: mocks.permission }))
vi.mock('@/app/actions/audit', () => ({ logAuditEvent: mocks.audit }))
vi.mock('@/lib/logger', () => ({ logger: { error: vi.fn(), warn: vi.fn() } }))

import { POST } from '@/app/api/foh/bookings/[id]/notes/route'

const ID = '11111111-1111-4111-8111-111111111111'

function send(body: unknown, id = ID) {
  return POST(
    new NextRequest(`http://localhost/api/foh/bookings/${id}/notes`, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id }) },
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.result = { data: { id: ID, special_requirements: 'Window', allergies: ['Peanuts'] }, error: null }
  mocks.audit.mockResolvedValue(undefined)
  mocks.permission.mockResolvedValue({
    ok: true,
    userId: 'user-1',
    supabase: {
      from: () => ({
        update: (payload: unknown) => {
          mocks.update(payload)
          return { eq: () => ({ select: () => ({ maybeSingle: async () => mocks.result }) }) }
        },
      }),
    },
  })
})

describe('POST /api/foh/bookings/[id]/notes', () => {
  it('saves the notes and the allergy list, and audits without the contents', async () => {
    const response = await send({ notes: ' Window ', allergies: ['Peanuts'] })

    expect(response.status).toBe(200)
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ special_requirements: 'Window', allergies: ['Peanuts'] }))
    const audit = mocks.audit.mock.calls[0][0]
    expect(audit).toMatchObject({ user_id: 'user-1', resource_id: ID, additional_info: { allergy_count: 1, has_notes: true } })
    expect(JSON.stringify(audit)).not.toContain('Peanuts')
    expect(JSON.stringify(audit)).not.toContain('Window')
  })

  it('clears empty notes rather than saving a blank', async () => {
    await send({ notes: '   ', allergies: [] })
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ special_requirements: null, allergies: [] }))
  })

  it('refuses a bad body or id without writing', async () => {
    expect((await send({ notes: 'x' })).status).toBe(400)
    expect((await send({ notes: null, allergies: [''] })).status).toBe(400)
    expect((await send({ notes: null, allergies: [] }, 'not-an-id')).status).toBe(400)
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('says so when the save fails', async () => {
    mocks.result = { data: null, error: { message: 'database down' } }
    const response = await send({ notes: null, allergies: ['Milk'] })
    expect(response.status).toBe(500)
    expect((await response.json()).error).toBe('The notes could not be saved. Please try again.')
  })

  it('needs FOH edit permission', async () => {
    mocks.permission.mockResolvedValue({ ok: false, response: new Response(null, { status: 403 }) })
    expect((await send({ notes: null, allergies: [] })).status).toBe(403)
  })
})

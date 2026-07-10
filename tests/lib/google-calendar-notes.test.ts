import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

const {
  eventsUpdate,
  eventsInsert,
  eventsDelete,
  getOAuth2ClientMock,
  warn,
} = vi.hoisted(() => ({
  eventsUpdate: vi.fn(),
  eventsInsert: vi.fn(),
  eventsDelete: vi.fn(),
  getOAuth2ClientMock: vi.fn(),
  warn: vi.fn(),
}))

vi.mock('googleapis', () => ({
  google: {
    calendar: vi.fn(() => ({
      events: {
        update: eventsUpdate,
        insert: eventsInsert,
        delete: eventsDelete,
      },
    })),
  },
}))

vi.mock('@/lib/google-calendar', () => ({
  getOAuth2Client: getOAuth2ClientMock,
}))

vi.mock('@/lib/logger', () => ({
  logger: {
    warn,
    error: vi.fn(),
    info: vi.fn(),
  },
}))

import {
  PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
  buildPubOpsCalendarNoteEntry,
  deletePubOpsCalendarNoteEntryById,
  generatePubOpsCalendarNoteEventId,
  isPubOpsCalendarNoteSyncQueueAvailable,
  processPubOpsCalendarNoteQueueItem,
  syncPubOpsCalendarNoteById,
  type PubOpsCalendarNoteQueueItem,
  type PubOpsCalendarNoteRow,
} from '@/lib/google-calendar-notes'

const originalGoogleServiceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY
const originalGoogleClientId = process.env.GOOGLE_CLIENT_ID
const originalGoogleClientSecret = process.env.GOOGLE_CLIENT_SECRET
const originalGoogleRefreshToken = process.env.GOOGLE_REFRESH_TOKEN
const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name]
  } else {
    process.env[name] = value
  }
}

const baseNote: PubOpsCalendarNoteRow = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  note_date: '2026-06-15',
  end_date: '2026-06-15',
  title: 'Father’s Day planning',
  notes: 'Check staffing and stock levels.',
  source: 'manual',
  start_time: null,
  end_time: null,
}

const now = new Date('2026-06-10T12:00:00.000Z')

function makeSupabaseMock(input: {
  note?: PubOpsCalendarNoteRow | null
  error?: { message: string } | null
}) {
  return {
    from: vi.fn((table: string) => {
      if (table !== 'calendar_notes') {
        throw new Error(`Unexpected table: ${table}`)
      }

      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({
              data: input.note ?? null,
              error: input.error ?? null,
            }),
          }),
        }),
      }
    }),
  }
}

function makeQueuedSupabaseMock(input: {
  note?: PubOpsCalendarNoteRow | null
  queueItem: PubOpsCalendarNoteQueueItem
  finalized?: boolean
}) {
  const claimedItem = {
    ...input.queueItem,
    processing_token: 'claim-token-1',
  }
  const rpc = vi.fn((fn: string) => {
    if (fn === 'claim_calendar_note_google_sync') {
      return Promise.resolve({ data: [claimedItem], error: null })
    }
    if (fn === 'requeue_calendar_note_google_sync') {
      claimedItem.generation += 1
      claimedItem.attempts = 0
      return Promise.resolve({ data: claimedItem.generation, error: null })
    }
    throw new Error(`Unexpected RPC: ${fn}`)
  })

  const finalizeMaybeSingle = vi.fn().mockResolvedValue({
    data: input.finalized === false ? null : { note_id: input.queueItem.note_id },
    error: null,
  })
  const finalizeSelect = vi.fn().mockReturnValue({ maybeSingle: finalizeMaybeSingle })
  const finalizeReplay = vi.fn().mockReturnValue({ select: finalizeSelect })
  const finalizeToken = vi.fn().mockReturnValue({ eq: finalizeReplay })
  const finalizeGeneration = vi.fn().mockReturnValue({ eq: finalizeToken })
  const finalizeNoteId = vi.fn().mockReturnValue({ eq: finalizeGeneration })

  const releaseToken = vi.fn().mockResolvedValue({ error: null })
  const releaseNoteId = vi.fn().mockReturnValue({ eq: releaseToken })

  const queueUpdate = vi.fn((payload: Record<string, unknown>) => {
    if ('status' in payload) {
      return { eq: finalizeNoteId }
    }
    return { eq: releaseNoteId }
  })

  const supabase = {
    rpc,
    from: vi.fn((table: string) => {
      if (table === 'calendar_notes') {
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: input.note ?? null,
                error: null,
              }),
            }),
          }),
        }
      }

      if (table === 'calendar_note_google_sync_queue') {
        return {
          update: queueUpdate,
        }
      }

      throw new Error(`Unexpected table: ${table}`)
    }),
  }

  return {
    supabase,
    rpc,
    queueUpdate,
    finalizeGeneration,
    finalizeNoteId,
    finalizeToken,
    finalizeReplay,
    releaseToken,
  }
}

describe('Pub Ops calendar note sync', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY = '{"type":"service_account"}'
    process.env.NEXT_PUBLIC_APP_URL = 'https://app.the-anchor.pub'
    getOAuth2ClientMock.mockResolvedValue({ auth: true })
    eventsUpdate.mockResolvedValue({ data: { id: 'updated-note-id' } })
    eventsInsert.mockResolvedValue({ data: { id: 'created-note-id' } })
    eventsDelete.mockResolvedValue({ data: {} })
  })

  afterEach(() => {
    restoreEnv('GOOGLE_SERVICE_ACCOUNT_KEY', originalGoogleServiceAccountKey)
    restoreEnv('GOOGLE_CLIENT_ID', originalGoogleClientId)
    restoreEnv('GOOGLE_CLIENT_SECRET', originalGoogleClientSecret)
    restoreEnv('GOOGLE_REFRESH_TOKEN', originalGoogleRefreshToken)
    restoreEnv('NEXT_PUBLIC_APP_URL', originalAppUrl)
  })

  it('generates a stable Google-safe event id for each note', () => {
    const first = generatePubOpsCalendarNoteEventId(baseNote.id)
    const second = generatePubOpsCalendarNoteEventId(baseNote.id)
    const other = generatePubOpsCalendarNoteEventId('550e8400-e29b-41d4-a716-446655440002')

    expect(first).toBe(second)
    expect(first).not.toBe(other)
    expect(first).toMatch(/^[a-v0-9]{5,1024}$/)
  })

  it('requires both the durable queue table and claim function before allowing deletes', async () => {
    const supabase = {
      from: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue({ data: [], error: null }),
        }),
      }),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    }

    await expect(isPubOpsCalendarNoteSyncQueueAvailable(supabase as any)).resolves.toBe(true)
    expect(supabase.rpc).toHaveBeenCalledWith('claim_calendar_note_google_sync', {
      p_note_id: '00000000-0000-0000-0000-000000000000',
      p_expected_generation: null,
      p_lease_seconds: 600,
    })
  })

  it('maps the inclusive app date range to an exclusive Google all-day end date', () => {
    const entry = buildPubOpsCalendarNoteEntry({
      note: { ...baseNote, end_date: '2026-06-17', source: 'ai' },
      appBaseUrl: 'https://app.the-anchor.pub',
      now,
    })

    expect(entry.requestBody).toMatchObject({
      id: generatePubOpsCalendarNoteEventId(baseNote.id),
      summary: 'Father’s Day planning',
      start: { date: '2026-06-15' },
      end: { date: '2026-06-18' },
      transparency: 'transparent',
      reminders: { useDefault: false },
    })
    expect(entry.requestBody.description).toContain('Check staffing and stock levels.')
    expect(entry.requestBody.description).toContain('Source: AI-generated calendar note')
    expect(entry.requestBody.description).toContain('Manage notes: https://app.the-anchor.pub/settings/calendar-notes')
    expect(entry.requestBody.extendedProperties.private).toEqual({
      source: 'anchor_calendar_note',
      anchorCalendarNoteId: baseNote.id,
    })
    expect(entry.requestBody).not.toHaveProperty('colorId')
  })

  it('keeps all-day end dates correct across the UK daylight-saving change', () => {
    const entry = buildPubOpsCalendarNoteEntry({
      note: {
        ...baseNote,
        note_date: '2026-03-29',
        end_date: '2026-03-29',
      },
      now,
    })

    expect(entry.requestBody.start).toEqual({ date: '2026-03-29' })
    expect(entry.requestBody.end).toEqual({ date: '2026-03-30' })
  })

  it('uses Europe/London time and the supplied end time for a timed note', () => {
    const entry = buildPubOpsCalendarNoteEntry({
      note: {
        ...baseNote,
        start_time: '19:00',
        end_time: '21:30',
      },
      now,
    })

    expect(entry.requestBody.start).toEqual({
      dateTime: '2026-06-15T18:00:00.000Z',
      timeZone: 'Europe/London',
    })
    expect(entry.requestBody.end).toEqual({
      dateTime: '2026-06-15T20:30:00.000Z',
      timeZone: 'Europe/London',
    })
  })

  it('defaults a timed note to one hour when its end is missing or invalid', () => {
    const missingEnd = buildPubOpsCalendarNoteEntry({
      note: { ...baseNote, start_time: '19:00' },
      now,
    })
    const invalidEnd = buildPubOpsCalendarNoteEntry({
      note: { ...baseNote, start_time: '19:00', end_time: '18:00' },
      now,
    })

    expect(missingEnd.requestBody.end).toEqual({
      dateTime: '2026-06-15T19:00:00.000Z',
      timeZone: 'Europe/London',
    })
    expect(invalidEnd.requestBody.end).toEqual(missingEnd.requestBody.end)
  })

  it('updates an existing note on the shared Pub Ops calendar', async () => {
    const supabase = makeSupabaseMock({ note: baseNote })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result.state).toBe('updated')
    expect(eventsUpdate).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: generatePubOpsCalendarNoteEventId(baseNote.id),
      requestBody: expect.objectContaining({ summary: baseNote.title }),
    }))
    expect(eventsInsert).not.toHaveBeenCalled()
  })

  it('creates the deterministic event when update returns not found', async () => {
    eventsUpdate.mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
    const supabase = makeSupabaseMock({ note: baseNote })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result.state).toBe('created')
    expect(eventsInsert).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      requestBody: expect.objectContaining({
        id: generatePubOpsCalendarNoteEventId(baseNote.id),
      }),
    }))
  })

  it('retries update when a create races with another sync', async () => {
    eventsUpdate
      .mockRejectedValueOnce(Object.assign(new Error('not found'), { status: 404 }))
      .mockResolvedValueOnce({ data: { id: 'raced-note-id' } })
    eventsInsert.mockRejectedValueOnce(Object.assign(new Error('conflict'), { status: 409 }))
    const supabase = makeSupabaseMock({ note: baseNote })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result).toMatchObject({ state: 'updated', googleEventId: 'raced-note-id' })
    expect(eventsUpdate).toHaveBeenCalledTimes(2)
  })

  it('deletes the deterministic Google event when the database note is missing', async () => {
    const supabase = makeSupabaseMock({ note: null })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result.state).toBe('deleted')
    expect(eventsDelete).toHaveBeenCalledWith(expect.objectContaining({
      calendarId: PUB_OPS_EVENT_BOOKINGS_CALENDAR_ID,
      eventId: generatePubOpsCalendarNoteEventId(baseNote.id),
    }))
  })

  it('treats an already missing Google event as a successful delete', async () => {
    eventsDelete.mockRejectedValueOnce(Object.assign(new Error('gone'), { status: 410 }))

    const result = await deletePubOpsCalendarNoteEntryById(baseNote.id)

    expect(result).toMatchObject({ state: 'skipped', reason: 'already_missing' })
  })

  it('skips without calling Google when calendar auth is not configured', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN
    const supabase = makeSupabaseMock({ note: baseNote })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result).toMatchObject({
      state: 'skipped',
      reason: 'calendar_not_configured',
    })
    expect(getOAuth2ClientMock).not.toHaveBeenCalled()
    expect(eventsUpdate).not.toHaveBeenCalled()
  })

  it('returns a failure instead of throwing when Google auth fails', async () => {
    getOAuth2ClientMock.mockRejectedValueOnce(new Error('auth failed'))
    const supabase = makeSupabaseMock({ note: baseNote })

    const result = await syncPubOpsCalendarNoteById(supabase as any, baseNote.id)

    expect(result).toMatchObject({ state: 'failed', reason: 'auth failed' })
    expect(warn).toHaveBeenCalled()
  })

  it('acknowledges only the durable queue generation which was synced', async () => {
    const queueItem: PubOpsCalendarNoteQueueItem = {
      note_id: baseNote.id,
      operation: 'upsert',
      generation: 7,
      attempts: 0,
    }
    const queued = makeQueuedSupabaseMock({ note: baseNote, queueItem })

    const result = await processPubOpsCalendarNoteQueueItem(
      queued.supabase as any,
      baseNote.id,
      { expectedGeneration: queueItem.generation }
    )

    expect(result.state).toBe('updated')
    expect(queued.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'synced',
      attempts: 0,
      last_error: null,
    }))
    expect(queued.finalizeNoteId).toHaveBeenCalledWith('note_id', baseNote.id)
    expect(queued.finalizeGeneration).toHaveBeenCalledWith('generation', 7)
    expect(queued.finalizeToken).toHaveBeenCalledWith('processing_token', 'claim-token-1')
    expect(queued.finalizeReplay).toHaveBeenCalledWith('replay_requested', false)
  })

  it('keeps failed work queued with backoff so later items are not starved', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN
    const queueItem: PubOpsCalendarNoteQueueItem = {
      note_id: baseNote.id,
      operation: 'upsert',
      generation: 4,
      attempts: 2,
    }
    const queued = makeQueuedSupabaseMock({ note: baseNote, queueItem })

    const result = await processPubOpsCalendarNoteQueueItem(
      queued.supabase as any,
      baseNote.id,
      { expectedGeneration: queueItem.generation }
    )

    expect(result).toMatchObject({ state: 'skipped', reason: 'calendar_not_configured' })
    expect(queued.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      attempts: 3,
      last_error: 'calendar_not_configured',
      available_at: expect.any(String),
    }))
    expect(queued.finalizeNoteId).toHaveBeenCalledWith('note_id', baseNote.id)
    expect(queued.finalizeGeneration).toHaveBeenCalledWith('generation', 4)
    expect(queued.finalizeToken).toHaveBeenCalledWith('processing_token', 'claim-token-1')
  })

  it('returns a failed targeted retry to pending status for the cron to recover', async () => {
    delete process.env.GOOGLE_SERVICE_ACCOUNT_KEY
    delete process.env.GOOGLE_CLIENT_ID
    delete process.env.GOOGLE_CLIENT_SECRET
    delete process.env.GOOGLE_REFRESH_TOKEN
    const queueItem: PubOpsCalendarNoteQueueItem = {
      note_id: baseNote.id,
      operation: 'upsert',
      generation: 10,
      attempts: 4,
    }
    const queued = makeQueuedSupabaseMock({ note: baseNote, queueItem })

    const result = await processPubOpsCalendarNoteQueueItem(
      queued.supabase as any,
      baseNote.id,
      { force: true }
    )

    expect(result).toMatchObject({ state: 'skipped', reason: 'calendar_not_configured' })
    expect(queued.rpc).toHaveBeenCalledWith('requeue_calendar_note_google_sync', {
      p_note_id: baseNote.id,
      p_processing_token: null,
    })
    expect(queued.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'pending',
      attempts: 1,
      last_error: 'calendar_not_configured',
    }))
    expect(queued.finalizeGeneration).toHaveBeenCalledWith('generation', 11)
  })

  it('processes a durable delete tombstone after the note row is gone', async () => {
    const queueItem: PubOpsCalendarNoteQueueItem = {
      note_id: baseNote.id,
      operation: 'delete',
      generation: 9,
      attempts: 0,
    }
    const queued = makeQueuedSupabaseMock({ note: null, queueItem })

    const result = await processPubOpsCalendarNoteQueueItem(
      queued.supabase as any,
      baseNote.id,
      { expectedGeneration: queueItem.generation }
    )

    expect(result.state).toBe('deleted')
    expect(eventsDelete).toHaveBeenCalledWith(expect.objectContaining({
      eventId: generatePubOpsCalendarNoteEventId(baseNote.id),
    }))
    expect(queued.queueUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: 'synced',
    }))
    expect(queued.finalizeGeneration).toHaveBeenCalledWith('generation', 9)
  })

  it('replays the newest generation after an edit arrives during a Google update', async () => {
    const oldNote = { ...baseNote, title: 'Old planning title' }
    const latestNote = { ...baseNote, title: 'Latest planning title' }
    const claims = [
      {
        note_id: baseNote.id,
        operation: 'upsert',
        generation: 1,
        attempts: 0,
        processing_token: 'claim-token-old',
      },
      {
        note_id: baseNote.id,
        operation: 'upsert',
        generation: 3,
        attempts: 0,
        processing_token: 'claim-token-latest',
      },
    ]
    const rpc = vi.fn((fn: string) => {
      if (fn === 'claim_calendar_note_google_sync') {
        return Promise.resolve({ data: claims.length > 0 ? [claims.shift()] : [], error: null })
      }
      if (fn === 'requeue_calendar_note_google_sync') {
        return Promise.resolve({ data: 3, error: null })
      }
      throw new Error(`Unexpected RPC: ${fn}`)
    })
    const noteMaybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: oldNote, error: null })
      .mockResolvedValueOnce({ data: latestNote, error: null })

    const finalizeMaybeSingle = vi.fn()
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: { note_id: baseNote.id }, error: null })
    const finalizeSelect = vi.fn().mockReturnValue({ maybeSingle: finalizeMaybeSingle })
    const finalizeReplay = vi.fn().mockReturnValue({ select: finalizeSelect })
    const finalizeToken = vi.fn().mockReturnValue({ eq: finalizeReplay })
    const finalizeGeneration = vi.fn().mockReturnValue({ eq: finalizeToken })
    const finalizeNoteId = vi.fn().mockReturnValue({ eq: finalizeGeneration })
    const releaseToken = vi.fn().mockResolvedValue({ error: null })
    const releaseNoteId = vi.fn().mockReturnValue({ eq: releaseToken })
    const queueUpdate = vi.fn((payload: Record<string, unknown>) =>
      'status' in payload ? { eq: finalizeNoteId } : { eq: releaseNoteId }
    )

    const supabase = {
      rpc,
      from: vi.fn((table: string) => {
        if (table === 'calendar_notes') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockReturnValue({ maybeSingle: noteMaybeSingle }),
            }),
          }
        }
        if (table === 'calendar_note_google_sync_queue') {
          return { update: queueUpdate }
        }
        throw new Error(`Unexpected table: ${table}`)
      }),
    }

    const result = await processPubOpsCalendarNoteQueueItem(
      supabase as any,
      baseNote.id,
      { expectedGeneration: 1 }
    )

    expect(result.state).toBe('updated')
    expect(eventsUpdate).toHaveBeenCalledTimes(2)
    expect(eventsUpdate.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
      requestBody: expect.objectContaining({ summary: 'Old planning title' }),
    }))
    expect(eventsUpdate.mock.calls[1]?.[0]).toEqual(expect.objectContaining({
      requestBody: expect.objectContaining({ summary: 'Latest planning title' }),
    }))
    expect(rpc).toHaveBeenCalledWith('requeue_calendar_note_google_sync', {
      p_note_id: baseNote.id,
      p_processing_token: 'claim-token-old',
    })
    expect(finalizeToken).toHaveBeenLastCalledWith('processing_token', 'claim-token-latest')
    expect(finalizeReplay).toHaveBeenLastCalledWith('replay_requested', false)
  })

  it('does not overlap a note sync while another generation holds the lease', async () => {
    const supabase = {
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
      from: vi.fn((table: string) => {
        if (table !== 'calendar_note_google_sync_queue') {
          throw new Error(`Unexpected table: ${table}`)
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({
                data: {
                  note_id: baseNote.id,
                  operation: 'upsert',
                  status: 'pending',
                  generation: 2,
                  attempts: 0,
                  processing_token: 'active-token',
                  lease_expires_at: '2026-06-10T12:10:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        }
      }),
    }

    const result = await processPubOpsCalendarNoteQueueItem(
      supabase as any,
      baseNote.id,
      { expectedGeneration: 1 }
    )

    expect(result).toMatchObject({ state: 'skipped', reason: 'sync_in_progress' })
    expect(eventsUpdate).not.toHaveBeenCalled()
    expect(eventsInsert).not.toHaveBeenCalled()
    expect(eventsDelete).not.toHaveBeenCalled()
  })
})

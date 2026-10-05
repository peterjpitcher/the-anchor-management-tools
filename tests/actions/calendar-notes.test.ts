import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/openai/config', () => ({
  getOpenAIConfig: vi.fn(),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/google-calendar-notes', () => ({
  isPubOpsCalendarNoteSyncQueueAvailable: vi.fn().mockResolvedValue(true),
  processPubOpsCalendarNoteQueueItem: vi.fn().mockResolvedValue({
    state: 'failed',
    noteId: '550e8400-e29b-41d4-a716-446655440001',
    googleEventId: 'google-note-id',
    reason: 'temporary Google error',
  }),
}))

import { checkUserPermission } from '@/app/actions/rbac'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'
import {
  isPubOpsCalendarNoteSyncQueueAvailable,
  processPubOpsCalendarNoteQueueItem,
} from '@/lib/google-calendar-notes'
import {
  createCalendarNote,
  deleteCalendarNote,
  updateCalendarNote,
} from '@/app/actions/calendar-notes'
import { DEFAULT_CALENDAR_NOTE_COLOUR } from '@/lib/rota/shift-template-colours'

const mockedPermission = checkUserPermission as unknown as Mock
const mockedCreateAdminClient = createAdminClient as unknown as Mock
const mockedCreateClient = createClient as unknown as Mock
const mockedProcessSync = processPubOpsCalendarNoteQueueItem as unknown as Mock
const mockedQueueReady = isPubOpsCalendarNoteSyncQueueAvailable as unknown as Mock

const noteId = '550e8400-e29b-41d4-a716-446655440001'
const baseRow = {
  id: noteId,
  note_date: '2026-06-15',
  end_date: '2026-06-15',
  title: 'Father’s Day planning',
  notes: 'Check staffing and stock levels.',
  source: 'manual',
  start_time: null,
  end_time: null,
  color: '#0EA5E9',
  created_at: '2026-06-01T09:00:00.000Z',
  updated_at: '2026-06-01T09:00:00.000Z',
}

function selectOne(result: { data: unknown; error: unknown }) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue(result),
      }),
    }),
  }
}

describe('calendar note Google sync hooks', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedQueueReady.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'staff@example.com' } },
          error: null,
        }),
      },
    })
    mockedProcessSync.mockResolvedValue({
      state: 'failed',
      noteId,
      googleEventId: 'google-note-id',
      reason: 'temporary Google error',
    })
  })

  it('syncs a newly created note without failing the database write when Google fails', async () => {
    const admin = {
      from: vi.fn().mockReturnValue({
        insert: vi.fn().mockReturnValue({
          select: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: baseRow, error: null }),
          }),
        }),
      }),
    }
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await createCalendarNote({
      note_date: baseRow.note_date,
      title: baseRow.title,
      notes: baseRow.notes,
    })

    expect(result.data).toMatchObject({ id: noteId, title: baseRow.title })
    expect(mockedProcessSync).toHaveBeenCalledWith(admin, noteId, {
      operation: 'upsert',
      context: { context: 'calendar_note_created' },
    })
  })

  it('re-syncs a successfully updated note', async () => {
    const updatedRow = {
      ...baseRow,
      title: 'Updated planning note',
      updated_at: '2026-06-02T09:00:00.000Z',
    }
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(selectOne({ data: baseRow, error: null }))
        .mockReturnValueOnce({
          update: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: updatedRow, error: null }),
              }),
            }),
          }),
        }),
    }
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await updateCalendarNote(noteId, {
      title: updatedRow.title,
    })

    expect(result.data).toMatchObject({ id: noteId, title: updatedRow.title })
    expect(mockedProcessSync).toHaveBeenCalledWith(admin, noteId, {
      operation: 'upsert',
      context: { context: 'calendar_note_updated' },
    })
  })

  it('removes the Google event after a note is deleted', async () => {
    const admin = {
      from: vi.fn()
        .mockReturnValueOnce(selectOne({ data: baseRow, error: null }))
        .mockReturnValueOnce({
          delete: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              select: vi.fn().mockReturnValue({
                maybeSingle: vi.fn().mockResolvedValue({ data: { id: noteId }, error: null }),
              }),
            }),
          }),
        }),
    }
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await deleteCalendarNote(noteId)

    expect(result).toEqual({ success: true })
    expect(mockedProcessSync).toHaveBeenCalledWith(admin, noteId, {
      operation: 'delete',
      context: { context: 'calendar_note_deleted' },
    })
  })

  it('keeps the note when the durable delete queue is unavailable', async () => {
    mockedQueueReady.mockResolvedValue(false)
    const admin = {
      from: vi.fn().mockReturnValueOnce(selectOne({ data: baseRow, error: null })),
    }
    mockedCreateAdminClient.mockReturnValue(admin)

    const result = await deleteCalendarNote(noteId)

    expect(result).toEqual({
      error: 'Calendar sync is not ready. The note was not deleted.',
    })
    expect(admin.from).toHaveBeenCalledTimes(1)
    expect(mockedProcessSync).not.toHaveBeenCalled()
  })
})

describe('calendar note colour', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedQueueReady.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'staff@example.com' } },
          error: null,
        }),
      },
    })
  })

  it('gives a new note with no colour the first palette colour, the default every calendar screen uses', async () => {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: baseRow, error: null }),
      }),
    })
    mockedCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) })

    await createCalendarNote({ note_date: baseRow.note_date, title: baseRow.title })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ color: DEFAULT_CALENDAR_NOTE_COLOUR }))
    expect(DEFAULT_CALENDAR_NOTE_COLOUR).toBe('#7DD3FC')
  })
})

describe('calendar note "Show to staff"', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockedPermission.mockResolvedValue(true)
    mockedQueueReady.mockResolvedValue(true)
    mockedCreateClient.mockResolvedValue({
      auth: {
        getUser: vi.fn().mockResolvedValue({
          data: { user: { id: 'user-1', email: 'staff@example.com' } },
          error: null,
        }),
      },
    })
    mockedProcessSync.mockResolvedValue({ state: 'created', noteId, googleEventId: 'google-note-id' })
  })

  function insertReturning(row: Record<string, unknown>) {
    const insert = vi.fn().mockReturnValue({
      select: vi.fn().mockReturnValue({
        maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
      }),
    })
    mockedCreateAdminClient.mockReturnValue({ from: vi.fn().mockReturnValue({ insert }) })
    return insert
  }

  function updateReturning(existing: Record<string, unknown>, updated: Record<string, unknown>) {
    const update = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        select: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: updated, error: null }),
        }),
      }),
    })
    mockedCreateAdminClient.mockReturnValue({
      from: vi
        .fn()
        .mockReturnValueOnce(selectOne({ data: existing, error: null }))
        .mockReturnValueOnce({ update }),
    })
    return update
  }

  it('shows a new note to staff unless the tick is cleared', async () => {
    const insert = insertReturning({ ...baseRow, show_to_staff: true })

    const result = await createCalendarNote({ note_date: baseRow.note_date, title: baseRow.title })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ show_to_staff: true }))
    expect(result.data?.show_to_staff).toBe(true)
  })

  it('saves a new note as managers-only when the tick is cleared, and still syncs it to Google', async () => {
    const insert = insertReturning({ ...baseRow, show_to_staff: false })

    const result = await createCalendarNote({
      note_date: baseRow.note_date,
      title: baseRow.title,
      show_to_staff: false,
    })

    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ show_to_staff: false }))
    expect(result.data?.show_to_staff).toBe(false)
    // Hiding a note from staff must never stop it reaching the Google calendar.
    expect(mockedProcessSync).toHaveBeenCalledWith(
      expect.anything(),
      noteId,
      expect.objectContaining({ operation: 'upsert' }),
    )
  })

  it('keeps a managers-only note hidden when an edit does not mention the tick', async () => {
    const hidden = { ...baseRow, show_to_staff: false }
    const update = updateReturning(hidden, { ...hidden, title: 'Renamed' })

    const result = await updateCalendarNote(noteId, { title: 'Renamed' })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Renamed', show_to_staff: false }))
    expect(result.data?.show_to_staff).toBe(false)
  })

  it('shows a hidden note to staff once it is ticked, and re-syncs it to Google as any edit does', async () => {
    const hidden = { ...baseRow, show_to_staff: false }
    const update = updateReturning(hidden, { ...hidden, show_to_staff: true })

    const result = await updateCalendarNote(noteId, { show_to_staff: true })

    expect(update).toHaveBeenCalledWith(expect.objectContaining({ show_to_staff: true }))
    expect(result.data?.show_to_staff).toBe(true)
    expect(mockedProcessSync).toHaveBeenCalledTimes(1)
  })

  it('reads the tick back with every note it returns', async () => {
    const select = vi.fn().mockReturnValue({
      maybeSingle: vi.fn().mockResolvedValue({ data: { ...baseRow, show_to_staff: false }, error: null }),
    })
    mockedCreateAdminClient.mockReturnValue({
      from: vi.fn().mockReturnValue({ insert: vi.fn().mockReturnValue({ select }) }),
    })

    await createCalendarNote({ note_date: baseRow.note_date, title: baseRow.title, show_to_staff: false })

    expect(select).toHaveBeenCalledWith(expect.stringContaining('show_to_staff'))
  })
})

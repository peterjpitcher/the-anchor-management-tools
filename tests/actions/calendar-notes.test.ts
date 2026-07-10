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

import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Which permission each calendar-note action checks.
 *
 * Kept in its own file: tests/actions/calendar-notes.test.ts mocks the
 * permission check to return true for everything, so it cannot see a gate change
 * at all. That blanket mock is why the gates were never pinned, and why reads
 * could sit on settings:manage (super_admin only) unnoticed.
 */

const checkUserPermission = vi.fn<(module: string, action: string) => Promise<boolean>>()

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: (module: string, action: string) => checkUserPermission(module, action),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'u1', email: 'staff@example.com' } } }) },
  }),
}))

const adminFrom = vi.fn()
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({ from: adminFrom }),
}))

vi.mock('@/app/actions/audit', () => ({ logAuditEvent: vi.fn(async () => undefined) }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }))
vi.mock('@/lib/google-calendar-notes', () => ({
  isPubOpsCalendarNoteSyncQueueAvailable: vi.fn(async () => true),
  processPubOpsCalendarNoteQueueItem: vi.fn(async () => ({ state: 'completed' })),
}))

/** Grants exactly the module/action pairs given, refuses everything else. */
function grant(...pairs: Array<[string, string]>) {
  checkUserPermission.mockImplementation(async (module, action) =>
    pairs.some(([m, a]) => m === module && a === action),
  )
}

const MANAGER: Array<[string, string]> = [
  ['events', 'view'],
  ['events', 'manage'],
]
const STAFF: Array<[string, string]> = [['events', 'view']]
const SUPER: Array<[string, string]> = [['settings', 'manage']]

describe('calendar note permission gates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminFrom.mockReturnValue({
      select: () => ({
        order: () => ({
          order: () => ({
            order: () => ({ order: () => ({ limit: async () => ({ data: [], error: null }) }) }),
          }),
        }),
      }),
    })
  })

  it('lets a manager read notes', async () => {
    grant(...MANAGER)
    const { listCalendarNotes } = await import('@/app/actions/calendar-notes')
    const result = await listCalendarNotes()
    expect(result.error).toBeUndefined()
  })

  it('lets staff read notes, because the table policy has always allowed events:view', async () => {
    grant(...STAFF)
    const { listCalendarNotes } = await import('@/app/actions/calendar-notes')
    const result = await listCalendarNotes()
    expect(result.error).toBeUndefined()
  })

  it('keeps the settings:manage fallback for reading', async () => {
    grant(...SUPER)
    const { listCalendarNotes } = await import('@/app/actions/calendar-notes')
    const result = await listCalendarNotes()
    expect(result.error).toBeUndefined()
  })

  it('refuses a read to someone with neither permission', async () => {
    grant()
    const { listCalendarNotes } = await import('@/app/actions/calendar-notes')
    const result = await listCalendarNotes()
    expect(result.error).toMatch(/permission/i)
  })

  it('refuses staff every write', async () => {
    grant(...STAFF)
    const { createCalendarNote, updateCalendarNote, deleteCalendarNote } = await import(
      '@/app/actions/calendar-notes'
    )
    const noteId = '11111111-1111-4111-8111-111111111111'
    expect((await createCalendarNote({ note_date: '2026-09-10', title: 'x' })).error).toMatch(/permission/i)
    expect((await updateCalendarNote(noteId, { title: 'x' })).error).toMatch(/permission/i)
    expect((await deleteCalendarNote(noteId)).error).toMatch(/permission/i)
  })

  it('refuses a manager AI generation, which keeps the higher bar', async () => {
    grant(...MANAGER)
    const { generateCalendarNotesWithAI } = await import('@/app/actions/calendar-notes')
    const result = await generateCalendarNotesWithAI({
      start_date: '2026-09-01',
      end_date: '2026-09-30',
      guidance: null,
    })
    expect(result.error).toMatch(/permission/i)
  })

  it('checks events:manage for writes, not settings:manage alone', async () => {
    grant(...MANAGER)
    const { createCalendarNote } = await import('@/app/actions/calendar-notes')
    await createCalendarNote({ note_date: '2026-09-10', title: 'x' }).catch(() => undefined)
    expect(checkUserPermission).toHaveBeenCalledWith('events', 'manage')
  })
})

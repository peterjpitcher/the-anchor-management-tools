import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * What editing a short link does to `short_links.expires_at`.
 *
 * The edit form sends the id, name, destination and type only, and the update wrote
 * `expires_at: input.expires_at ?? null`, so saving an edit removed any expiry the link had. The
 * redirect route and the table-booking fallback both refuse an expired link, so a link that was
 * meant to stop working would quietly keep working. It is now only written when the caller sends
 * it, and an explicit null still clears it. Nothing here sets an expiry: guest links must keep
 * `expires_at` NULL.
 */

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
  revalidateTag: vi.fn(),
}))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: { getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }) },
  })),
}))

import { createAdminClient } from '@/lib/supabase/admin'
import { updateShortLink } from '@/app/actions/short-links'
import { ShortLinkService } from '@/services/short-links'
import { called, createRecordingSupabase, firstArgsOf } from '../mocks/recordingSupabase'

const LINK_ID = '6f2f6b3a-6d3a-4f1f-9a6e-2f5c9d9f4b21'
const DESTINATION = 'https://www.the-anchor.pub/whats-on'
const STORED_EXPIRY = '2026-12-31T23:59:00.000Z'

/** A database holding one short link that expires, applying any update to it. */
function buildDatabase() {
  const row: Record<string, unknown> = {
    id: LINK_ID,
    short_code: 'whatson',
    name: 'What is on',
    destination_url: DESTINATION,
    link_type: 'custom',
    expires_at: STORED_EXPIRY,
    parent_link_id: null,
    created_by: 'user-1',
    created_at: '2026-09-01T10:00:00.000Z',
  }

  const db = createRecordingSupabase({
    tables: {
      short_links: (query) => {
        if (called(query, 'update')) {
          Object.assign(row, firstArgsOf(query, 'update')?.[0])
        }
        // Also answers the protected-slug check and the duplicate-destination lookup, which
        // finds this same link and so is not a conflict.
        return { data: { ...row }, error: null }
      },
    },
  })
  vi.mocked(createAdminClient).mockReturnValue(db.client as never)
  return { db, row }
}

function updatePayload(db: ReturnType<typeof buildDatabase>['db']): Record<string, unknown> {
  const write = db.queries.find((query) => query.table === 'short_links' && called(query, 'update'))
  return firstArgsOf(write!, 'update')![0] as Record<string, unknown>
}

describe('short link expiry on an edit', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps the stored expiry when the edit form does not send one', async () => {
    const { db, row } = buildDatabase()

    // Exactly what ShortLinkFormModal sends when a link is edited.
    const result = await updateShortLink({
      id: LINK_ID,
      name: 'What is on this week',
      destination_url: DESTINATION,
      link_type: 'custom',
    })

    expect(result).toMatchObject({ success: true })
    expect(row.expires_at).toBe(STORED_EXPIRY)
    expect(row.name).toBe('What is on this week')
    expect(updatePayload(db)).not.toHaveProperty('expires_at')
  })

  it('clears the expiry when the caller sends null', async () => {
    const { row } = buildDatabase()

    const updated = await ShortLinkService.updateShortLink({
      id: LINK_ID,
      name: 'What is on',
      destination_url: DESTINATION,
      link_type: 'custom',
      expires_at: null,
    })

    expect(updated).toBeTruthy()
    expect(row.expires_at).toBeNull()
  })

  it('sets a new expiry when the caller sends one', async () => {
    const { row } = buildDatabase()

    await ShortLinkService.updateShortLink({
      id: LINK_ID,
      name: 'What is on',
      destination_url: DESTINATION,
      link_type: 'custom',
      expires_at: '2027-01-31T23:59:00.000Z',
    })

    expect(row.expires_at).toBe('2027-01-31T23:59:00.000Z')
  })
})

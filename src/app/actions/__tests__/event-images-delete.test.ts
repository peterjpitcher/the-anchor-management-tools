import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: vi.fn().mockResolvedValue(true),
}))

vi.mock('@/app/actions/audit', () => ({
  logAuditEvent: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn().mockResolvedValue({
    auth: {
      getUser: vi.fn().mockResolvedValue({
        data: { user: { id: 'user-1', email: 'staff@example.com' } },
      }),
    },
  }),
}))

const adminState = {
  eventUpdate: { data: { id: 'event-1' }, error: null } as { data: unknown; error: unknown },
  categoryUpdate: { data: { id: 'cat-1' }, error: null } as { data: unknown; error: unknown },
  referencingEventCount: { count: 0, error: null } as { count: number | null; error: unknown },
  removedPaths: [] as string[][],
  order: [] as string[],
}

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(() => ({
    from: (table: string) => ({
      update: () => chain(table, () => {
        adminState.order.push(`${table}.update`)
        return table === 'events' ? adminState.eventUpdate : adminState.categoryUpdate
      }),
      delete: () => chain(table, () => {
        adminState.order.push(`${table}.delete`)
        return { data: null, error: null }
      }),
      select: () => chain(table, () => {
        adminState.order.push(`${table}.select`)
        return adminState.referencingEventCount
      }),
    }),
    storage: {
      from: () => ({
        remove: async (paths: string[]) => {
          adminState.order.push('storage.remove')
          adminState.removedPaths.push(paths)
          return { error: null }
        },
      }),
    },
  })),
}))

/**
 * Supabase query builders are chainable and awaitable. This stands in for both,
 * resolving to `result()` whether the caller awaits the chain directly or ends it
 * with `.maybeSingle()`.
 */
function chain(_table: string, result: () => unknown) {
  const link: Record<string, unknown> = {}
  const self = () => link
  link.eq = self
  link.or = self
  link.select = self
  link.maybeSingle = async () => result()
  link.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result()).then(resolve, reject)
  return link
}

const SUPABASE_PUBLIC = 'https://project.supabase.co/storage/v1/object/public/event-images'
const EVENT_OWNED = `${SUPABASE_PUBLIC}/events/event-1/hero/1700000000000_poster.png`
const CATEGORY_OWNED = `${SUPABASE_PUBLIC}/categories/cat-1/hero/1700000000000_Cash_Bingo.png`

import { deleteEventImage, deleteCategoryImage } from '../event-images'

beforeEach(() => {
  adminState.eventUpdate = { data: { id: 'event-1' }, error: null }
  adminState.categoryUpdate = { data: { id: 'cat-1' }, error: null }
  adminState.referencingEventCount = { count: 0, error: null }
  adminState.removedPaths = []
  adminState.order = []
})

// ---------------------------------------------------------------------------
// Event images
// ---------------------------------------------------------------------------

describe('deleteEventImage', () => {
  it('does not remove a storage object the event inherited from its category', async () => {
    // Production has 16 events pointing at category-owned objects, one of them
    // shared by 8 events. Removing the file here would blank all of them.
    const result = await deleteEventImage(CATEGORY_OWNED, 'event-1')

    expect(result).toEqual({ success: true })
    expect(adminState.removedPaths).toEqual([])
    expect(adminState.order).toContain('events.update')
  })

  it('removes a storage object the event owns', async () => {
    const result = await deleteEventImage(EVENT_OWNED, 'event-1')

    expect(result).toEqual({ success: true })
    expect(adminState.removedPaths).toEqual([
      ['events/event-1/hero/1700000000000_poster.png'],
    ])
  })

  it('does not remove an object owned by a different event', async () => {
    await deleteEventImage(EVENT_OWNED, 'event-2')

    expect(adminState.removedPaths).toEqual([])
  })

  it('clears the event reference before touching storage', async () => {
    // The reverse order can leave the live website holding a URL to a file that
    // has already been deleted.
    await deleteEventImage(EVENT_OWNED, 'event-1')

    expect(adminState.order.indexOf('events.update')).toBeLessThan(
      adminState.order.indexOf('storage.remove')
    )
  })

  it('never touches storage when clearing the reference fails', async () => {
    adminState.eventUpdate = { data: null, error: { message: 'boom' } }

    const result = await deleteEventImage(EVENT_OWNED, 'event-1')

    expect(result).toEqual({ error: 'Failed to remove image from event.' })
    expect(adminState.removedPaths).toEqual([])
  })

  it('reports the event as missing rather than deleting anything', async () => {
    adminState.eventUpdate = { data: null, error: null }

    const result = await deleteEventImage(EVENT_OWNED, 'event-1')

    expect(result).toEqual({ error: 'Event not found.' })
    expect(adminState.removedPaths).toEqual([])
  })

  it('ignores a URL that does not belong to the event-images bucket', async () => {
    await deleteEventImage('https://example.com/somewhere-else.png', 'event-1')

    expect(adminState.removedPaths).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// Category images
// ---------------------------------------------------------------------------

describe('deleteCategoryImage', () => {
  it('removes the object once no event still references it', async () => {
    adminState.referencingEventCount = { count: 0, error: null }

    const result = await deleteCategoryImage(CATEGORY_OWNED, 'cat-1')

    expect(result).toEqual({ success: true })
    expect(adminState.removedPaths).toEqual([
      ['categories/cat-1/hero/1700000000000_Cash_Bingo.png'],
    ])
  })

  it('keeps the object while events still inherit it', async () => {
    adminState.referencingEventCount = { count: 8, error: null }

    const result = await deleteCategoryImage(CATEGORY_OWNED, 'cat-1')

    expect(result).toEqual({ success: true })
    expect(adminState.removedPaths).toEqual([])
  })

  it('keeps the object when the reference count cannot be established', async () => {
    adminState.referencingEventCount = { count: null, error: { message: 'boom' } }

    await deleteCategoryImage(CATEGORY_OWNED, 'cat-1')

    expect(adminState.removedPaths).toEqual([])
  })

  it('reports the category as missing rather than deleting anything', async () => {
    adminState.categoryUpdate = { data: null, error: null }

    const result = await deleteCategoryImage(CATEGORY_OWNED, 'cat-1')

    expect(result).toEqual({ error: 'Category not found.' })
    expect(adminState.removedPaths).toEqual([])
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The old page asked checkUserPermission once per action. These fakes model what that answers
// (a super admin gets everything, otherwise only the role's permission rows) and what
// getCurrentUserModuleActions answers (the rows only), so the new page can be held to the old answers.
type FakeUser = { rows: string[]; superAdmin: boolean; lookupFails?: boolean }
let currentUser: FakeUser = { rows: [], superAdmin: false }

const checkUserPermissionMock = vi.hoisted(() => vi.fn())
const getCurrentUserModuleActionsMock = vi.hoisted(() => vi.fn())
const redirectMock = vi.hoisted(() =>
  vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  })
)
const clientPropsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({ redirect: redirectMock }))

vi.mock('@/app/actions/rbac', () => ({
  checkUserPermission: checkUserPermissionMock,
  getCurrentUserModuleActions: getCurrentUserModuleActionsMock,
}))

vi.mock('@/app/actions/invoices', () => ({
  getInvoiceListPage: vi.fn().mockResolvedValue({ invoices: [], total: 0 }),
  getInvoiceSummary: vi.fn().mockResolvedValue({
    summary: { total_outstanding: 0, total_overdue: 0, total_this_month: 0, count_draft: 0 },
  }),
}))

vi.mock('@/app/(authenticated)/invoices/_components/InvoicesClient', () => ({
  default: (props: unknown) => {
    clientPropsMock(props)
    return null
  },
}))

import InvoicesPage from '@/app/(authenticated)/invoices/page'
import { getInvoiceListPage } from '@/app/actions/invoices'

const PAGE_ACTIONS = ['create', 'edit', 'delete', 'export', 'manage'] as const

function oldAnswer(user: FakeUser, action: string): boolean {
  if (user.superAdmin) return true
  if (user.lookupFails) return false
  return user.rows.includes(action)
}

// Live role permission rows for the invoices module (production, 18 November 2026).
const MANAGER_ROWS = ['create', 'edit', 'export', 'manage', 'record_payments', 'send', 'view']
const STAFF_ROWS = ['view']
const SUPER_ADMIN_ROWS = [
  'create', 'delete', 'edit', 'export', 'manage', 'manage_recurring', 'manage_vendors',
  'record_payments', 'send', 'view',
]

async function renderPage() {
  const element = await InvoicesPage({ searchParams: Promise.resolve({}) })
  // Render the returned element's component so the mocked client records its props.
  const { type, props } = element as unknown as { type: (p: unknown) => unknown; props: unknown }
  type(props)
  return clientPropsMock.mock.calls.at(-1)?.[0] as { permissions: Record<string, boolean> }
}

describe('invoices page permissions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    checkUserPermissionMock.mockImplementation(async (_module: string, action: string) =>
      oldAnswer(currentUser, action)
    )
    getCurrentUserModuleActionsMock.mockImplementation(async () =>
      currentUser.lookupFails
        ? { error: 'Could not check permissions' }
        : { success: true, actions: currentUser.rows }
    )
  })

  const expectSameAsOldPage = (props: { permissions: Record<string, boolean> }) => {
    expect(props.permissions).toEqual({
      canCreate: oldAnswer(currentUser, 'create'),
      canEdit: oldAnswer(currentUser, 'edit'),
      canDelete: oldAnswer(currentUser, 'delete'),
      canExport: oldAnswer(currentUser, 'export'),
      canManageCatalog: oldAnswer(currentUser, 'manage'),
    })
  }

  it('gives a manager every action but delete, with one extra check', async () => {
    currentUser = { rows: MANAGER_ROWS, superAdmin: false }
    const props = await renderPage()
    expectSameAsOldPage(props)
    expect(props.permissions.canDelete).toBe(false)
    expect(props.permissions.canManageCatalog).toBe(true)
    expect(getCurrentUserModuleActionsMock).toHaveBeenCalledTimes(1)
    expect(checkUserPermissionMock).toHaveBeenCalledTimes(1)
    expect(checkUserPermissionMock).toHaveBeenCalledWith('invoices', 'delete')
  })

  it('gives a staff user view only, with one extra check', async () => {
    currentUser = { rows: STAFF_ROWS, superAdmin: false }
    const props = await renderPage()
    expectSameAsOldPage(props)
    for (const action of PAGE_ACTIONS) {
      expect(oldAnswer(currentUser, action)).toBe(false)
    }
    expect(checkUserPermissionMock).toHaveBeenCalledTimes(1)
  })

  it('gives a super admin everything with no extra checks', async () => {
    currentUser = { rows: SUPER_ADMIN_ROWS, superAdmin: true }
    const props = await renderPage()
    expectSameAsOldPage(props)
    expect(Object.values(props.permissions).every(Boolean)).toBe(true)
    expect(checkUserPermissionMock).not.toHaveBeenCalled()
  })

  it('still gives a super admin everything when the role holds no invoice rows', async () => {
    currentUser = { rows: [], superAdmin: true }
    const props = await renderPage()
    expectSameAsOldPage(props)
    expect(Object.values(props.permissions).every(Boolean)).toBe(true)
  })

  it('redirects to unauthorized without view, before loading any invoices', async () => {
    currentUser = { rows: [], superAdmin: false }
    await expect(InvoicesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/unauthorized'
    )
    expect(getInvoiceListPage).not.toHaveBeenCalled()
  })

  it('redirects to unauthorized when the permission lookup fails', async () => {
    currentUser = { rows: STAFF_ROWS, superAdmin: false, lookupFails: true }
    await expect(InvoicesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT:/unauthorized'
    )
    expect(getInvoiceListPage).not.toHaveBeenCalled()
  })

  it('loads the list through the slim list action', async () => {
    currentUser = { rows: STAFF_ROWS, superAdmin: false }
    await renderPage()
    expect(getInvoiceListPage).toHaveBeenCalledWith('unpaid', 1, 20, '', '', '', '')
  })
})

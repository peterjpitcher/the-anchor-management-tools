// The Menu Overview server page reads dishes and menus itself and passes them down, so the browser
// does not fetch them after the page appears. A user without menu view access is sent away before
// anything is read.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isValidElement, type ReactElement } from 'react'

const state = vi.hoisted(() => ({ canView: true }))
const { listMenuDishes, listMenusWithCategories, checkUserPermission } = vi.hoisted(() => ({
  listMenuDishes: vi.fn(),
  listMenusWithCategories: vi.fn(),
  checkUserPermission: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`NEXT_REDIRECT ${path}`)
  }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/menu-management',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission }))
vi.mock('@/app/actions/menu-management', () => ({
  listMenuDishes,
  listMenusWithCategories,
  listMenuIngredients: vi.fn(),
  toggleDishActive: vi.fn(),
}))

import MenuManagementPage from '@/app/(authenticated)/menu-management/page'

const menus = [{ id: 'menu-1', code: 'website_food', name: 'Website', categories: [] }]

describe('Menu Overview server page', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    state.canView = true
    checkUserPermission.mockImplementation(async (module: string, action: string) =>
      state.canView && module === 'menu_management' && action === 'view')
    listMenuDishes.mockResolvedValue({ data: [{ id: 'dish-1', name: 'Fish and Chips' }], target_gp_pct: 0.68 })
    listMenusWithCategories.mockResolvedValue({ data: menus })
  })

  it('sends a user without view access to /unauthorized and reads nothing', async () => {
    state.canView = false

    await expect(MenuManagementPage()).rejects.toThrow('NEXT_REDIRECT /unauthorized')
    expect(listMenuDishes).not.toHaveBeenCalled()
    expect(listMenusWithCategories).not.toHaveBeenCalled()
  })

  it('reads dishes and menus once each and passes them to the client', async () => {
    const element = (await MenuManagementPage()) as ReactElement<Record<string, unknown>>

    expect(isValidElement(element)).toBe(true)
    expect(listMenuDishes).toHaveBeenCalledTimes(1)
    expect(listMenuDishes).toHaveBeenCalledWith()
    expect(listMenusWithCategories).toHaveBeenCalledTimes(1)
    expect(element.props.initialDishes).toEqual({
      data: [{ id: 'dish-1', name: 'Fish and Chips' }],
      target_gp_pct: 0.68,
      error: null,
    })
    expect(element.props.initialMenus).toEqual(menus)
  })

  it('passes a failed dishes read down as an error, not an empty menu', async () => {
    listMenuDishes.mockResolvedValue({ error: 'Database unavailable' })
    listMenusWithCategories.mockResolvedValue({ error: 'Menus unavailable' })
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const element = (await MenuManagementPage()) as ReactElement<Record<string, unknown>>

    expect(element.props.initialDishes).toEqual({ data: null, target_gp_pct: null, error: 'Database unavailable' })
    expect(element.props.initialMenus).toEqual([])
  })
})

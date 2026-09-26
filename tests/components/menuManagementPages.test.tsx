import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'

/**
 * The four Menu tabs follow the page contract: one title ("Menu") with the tab named in the
 * subtitle, the MENU_NAV tab row, no back button (the tabs are the section's top level), header
 * actions in the header, and a failed load shown as an error rather than an empty list.
 */

const pathnameMock = vi.hoisted(() => ({ current: '/menu-management' }))
const listMenuDishesMock = vi.hoisted(() => vi.fn())
const listMenuIngredientsMock = vi.hoisted(() => vi.fn())
const listMenuRecipesMock = vi.hoisted(() => vi.fn())
const getMenuIngredientPricesMock = vi.hoisted(() => vi.fn())

// Stable, as Next's router is: the Overview re-runs its load effect when the router changes.
const router = vi.hoisted(() => ({ replace: vi.fn(), push: vi.fn(), refresh: vi.fn() }))
vi.mock('next/navigation', () => ({
  useRouter: () => router,
  usePathname: () => pathnameMock.current,
  useSearchParams: () => new URLSearchParams(),
}))

// A stable permissions object, as the real context provides: the pages re-run their load
// effect when hasPermission changes identity.
const permissions = vi.hoisted(() => ({ hasPermission: () => true, loading: false }))
vi.mock('@/contexts/PermissionContext', () => ({
  usePermissions: () => permissions,
}))

vi.mock('@/app/actions/menu-management', () => ({
  listMenuDishes: listMenuDishesMock,
  listMenuIngredients: listMenuIngredientsMock,
  listMenuRecipes: listMenuRecipesMock,
  toggleDishActive: vi.fn(),
  updateDishPrice: vi.fn(),
  deleteMenuDish: vi.fn(),
  createMenuDish: vi.fn(),
  updateMenuDish: vi.fn(),
  getMenuDishDetail: vi.fn(),
  verifyDishAllergens: vi.fn(),
  deleteMenuIngredient: vi.fn(),
  updateIngredientPackCost: vi.fn(),
  toggleIngredientActive: vi.fn(),
  toggleIngredientDietaryFlag: vi.fn(),
  getMenuIngredientPrices: getMenuIngredientPricesMock,
  createMenuIngredient: vi.fn(),
  updateMenuIngredient: vi.fn(),
  createMenuRecipe: vi.fn(),
  updateMenuRecipe: vi.fn(),
  deleteMenuRecipe: vi.fn(),
}))

vi.mock('@/app/actions/ai-menu-parsing', () => ({
  reviewIngredientWithAI: vi.fn(),
}))

import MenuManagementClient from '@/app/(authenticated)/menu-management/_components/MenuManagementClient'
import MenuDishesPage from '@/app/(authenticated)/menu-management/dishes/page'
import MenuIngredientsPage from '@/app/(authenticated)/menu-management/ingredients/page'
import MenuRecipesPage from '@/app/(authenticated)/menu-management/recipes/page'

const dish = {
  id: 'dish-1',
  name: 'Fish and Chips',
  description: 'Beer battered cod',
  selling_price: 16,
  portion_cost: 4,
  gp_pct: 0.75,
  target_gp_pct: 0.7,
  is_gp_alert: false,
  is_active: true,
  is_sunday_lunch: false,
  dietary_flags: [],
  allergen_flags: ['fish'],
  assignments: [{ menu_code: 'website_food', menu_name: 'Website', category_code: 'mains', category_name: 'Mains', sort_order: 0 }],
  ingredients: [],
  recipes: [],
}

const ingredient = {
  id: 'ing-1',
  name: 'Cod fillet',
  default_unit: 'portion',
  storage_type: 'frozen',
  purchase_department: 'kitchen',
  pack_cost: 20,
  portions_per_pack: 10,
  wastage_pct: 0,
  allergens: ['fish'],
  dietary_flags: [],
  is_active: true,
  dishes: [],
}

const recipe = {
  id: 'rec-1',
  name: 'Tartare sauce',
  yield_quantity: 10,
  yield_unit: 'portion',
  portion_cost: 0.2,
  allergen_flags: ['eggs'],
  dietary_flags: [],
  is_active: true,
  ingredients: [],
  usage: [],
}

function expectMenuChrome(subtitle: RegExp): void {
  expect(screen.getAllByRole('heading', { level: 1, name: 'Menu' }).length).toBeGreaterThan(0)
  expect(screen.getAllByText(subtitle).length).toBeGreaterThan(0)
  for (const tab of ['Overview', 'Dishes', 'Recipes', 'Ingredients']) {
    expect(screen.getAllByRole('tab', { name: tab }).length).toBeGreaterThan(0)
  }
  expect(screen.queryByRole('button', { name: /back to/i })).not.toBeInTheDocument()
  expect(screen.queryByRole('navigation', { name: /breadcrumbs/i })).not.toBeInTheDocument()
}

beforeEach(() => {
  listMenuDishesMock.mockResolvedValue({ data: [dish], target_gp_pct: 0.7 })
  listMenuIngredientsMock.mockResolvedValue({ data: [ingredient] })
  listMenuRecipesMock.mockResolvedValue({ data: [recipe] })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, json: async () => ({ data: [] }) })),
  )
  // Desktop width: the drawers ask SHELL_MEDIA_QUERY whether they are on a phone.
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    })),
  )
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('Menu tabs follow the page contract', () => {
  it('Overview: one Menu title, tab row, header actions and the figures grid', async () => {
    pathnameMock.current = '/menu-management'
    render(<MenuManagementClient />)

    expect(await screen.findAllByText('Fish and Chips')).not.toHaveLength(0)
    expectMenuChrome(/^Overview: /)
    expect(screen.getAllByRole('button', { name: /export menu/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Refresh' }).length).toBeGreaterThan(0)
    expect(screen.getByText('Total Dishes')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Active status' })).toBeInTheDocument()
  })

  it('Overview: a failed first load is an error with a retry, never an empty menu', async () => {
    pathnameMock.current = '/menu-management'
    listMenuDishesMock.mockResolvedValue({ error: 'Database unavailable' })
    render(<MenuManagementClient />)

    expect(await screen.findByText('Database unavailable')).toBeInTheDocument()
    expectMenuChrome(/^Overview: /)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(screen.queryByText('Total Dishes')).not.toBeInTheDocument()
  })

  it('Dishes: filters above the table, the allergen report as a header action', async () => {
    pathnameMock.current = '/menu-management/dishes'
    render(<MenuDishesPage />)

    expect(await screen.findAllByText('Fish and Chips')).not.toHaveLength(0)
    expectMenuChrome(/^Dishes: /)
    expect(screen.getByPlaceholderText('Search dishes, menus, or ingredients...')).toBeInTheDocument()
    expect(screen.getByLabelText('Menu')).toBeInTheDocument()
    expect(screen.getByLabelText('Status')).toBeInTheDocument()
    expect(screen.queryByLabelText('Allergen report category')).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /download allergens/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByRole('button', { name: 'Add Dish' }).length).toBeGreaterThan(0)
  })

  it('Dishes: the allergen report menu downloads the chosen PDF', async () => {
    pathnameMock.current = '/menu-management/dishes'
    const clicked: string[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.href)
      })
    render(<MenuDishesPage />)

    expect(await screen.findAllByText('Fish and Chips')).not.toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: /download allergens/i })[0])
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Food' }))
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toContain('/api/menu-management/dishes/allergens/pdf?download=1&category=food')
    clickSpy.mockRestore()
  })

  it('Ingredients: the allergen report menu downloads one department', async () => {
    pathnameMock.current = '/menu-management/ingredients'
    const clicked: string[] = []
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        clicked.push(this.href)
      })
    render(<MenuIngredientsPage />)

    expect(await screen.findAllByText('Cod fillet')).not.toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: /download allergens/i })[0])
    fireEvent.click(await screen.findByRole('menuitem', { name: 'Bar' }))
    expect(clicked).toHaveLength(1)
    expect(clicked[0]).toContain('/api/menu-management/ingredients/allergens/pdf?download=1&department=bar')
    clickSpy.mockRestore()
  })

  it('Ingredients: opening the price history loads it once', async () => {
    pathnameMock.current = '/menu-management/ingredients'
    getMenuIngredientPricesMock.mockResolvedValue({
      data: [{ id: 'p1', pack_cost: 18.5, effective_from: '2026-09-01', created_at: '2026-09-01T09:00:00Z' }],
    })
    render(<MenuIngredientsPage />)

    expect(await screen.findAllByText('Cod fillet')).not.toHaveLength(0)
    fireEvent.click(screen.getAllByRole('button', { name: 'Prices' })[0])
    expect(await screen.findByText('£18.50 per pack')).toBeInTheDocument()
    expect(getMenuIngredientPricesMock).toHaveBeenCalledTimes(1)
    expect(getMenuIngredientPricesMock).toHaveBeenCalledWith('ing-1')
  })

  it('Ingredients: a failed price history load says so and retries on the next opening', async () => {
    pathnameMock.current = '/menu-management/ingredients'
    getMenuIngredientPricesMock
      .mockResolvedValueOnce({ error: 'Prices unavailable' })
      .mockResolvedValueOnce({
        data: [{ id: 'p1', pack_cost: 18.5, effective_from: '2026-09-01', created_at: '2026-09-01T09:00:00Z' }],
      })
    render(<MenuIngredientsPage />)

    expect(await screen.findAllByText('Cod fillet')).not.toHaveLength(0)
    const prices = screen.getAllByRole('button', { name: 'Prices' })[0]
    fireEvent.click(prices)
    expect(await screen.findByText('Prices unavailable')).toBeInTheDocument()
    expect(screen.queryByText('No price history recorded yet')).not.toBeInTheDocument()

    fireEvent.click(prices)
    await waitFor(() => expect(screen.queryByText('Prices unavailable')).not.toBeInTheDocument())
    fireEvent.click(prices)
    expect(await screen.findByText('£18.50 per pack')).toBeInTheDocument()
    expect(getMenuIngredientPricesMock).toHaveBeenCalledTimes(2)
  })

  it('Dishes: the search box filters the list', async () => {
    pathnameMock.current = '/menu-management/dishes'
    render(<MenuDishesPage />)

    expect(await screen.findAllByText('Fish and Chips')).not.toHaveLength(0)
    fireEvent.change(screen.getByPlaceholderText('Search dishes, menus, or ingredients...'), {
      target: { value: 'lasagne' },
    })
    expect(screen.queryByText('Fish and Chips')).not.toBeInTheDocument()
    expect(screen.getByText('No dishes match your filters')).toBeInTheDocument()
  })

  it('Ingredients: allergen and dietary filters are real choices, not free text', async () => {
    pathnameMock.current = '/menu-management/ingredients'
    render(<MenuIngredientsPage />)

    expect(await screen.findAllByText('Cod fillet')).not.toHaveLength(0)
    expectMenuChrome(/^Ingredients: /)
    const allergens = screen.getByLabelText('Allergens') as HTMLSelectElement
    expect(allergens.tagName).toBe('SELECT')
    fireEvent.change(allergens, { target: { value: 'milk' } })
    expect(screen.queryByText('Cod fillet')).not.toBeInTheDocument()
    fireEvent.change(allergens, { target: { value: 'fish' } })
    expect(screen.getAllByText('Cod fillet').length).toBeGreaterThan(0)
  })

  it('Recipes: small header actions, primary last', async () => {
    pathnameMock.current = '/menu-management/recipes'
    render(<MenuRecipesPage />)

    expect(await screen.findAllByText('Tartare sauce')).not.toHaveLength(0)
    expectMenuChrome(/^Recipes: /)
    const addRecipe = screen.getAllByRole('button', { name: 'Add Recipe' })[0]
    expect(addRecipe.className).toContain('h-btn-h-sm')
  })

  it('Dishes: the dish drawer opens on its Overview tab with DS form blocks', async () => {
    pathnameMock.current = '/menu-management/dishes'
    render(<MenuDishesPage />)

    fireEvent.click((await screen.findAllByRole('button', { name: 'Add Dish' }))[0])
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('tab', { name: 'Overview' })).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('heading', { name: 'Dish Details' })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Create Dish' })).toBeInTheDocument()
  })
})

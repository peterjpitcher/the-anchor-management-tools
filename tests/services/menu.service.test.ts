import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Mock } from 'vitest'

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(),
}))

vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'
import { MenuService } from '@/services/menu'
import { MenuSettingsService } from '@/services/menu-settings'

const mockedCreateClient = createClient as unknown as Mock

function buildDeleteClient(table: string) {
  const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
  const select = vi.fn().mockReturnValue({ maybeSingle })
  const eq = vi.fn().mockReturnValue({ select })
  const deleteFn = vi.fn().mockReturnValue({ eq })

  const client = {
    from: vi.fn((requestedTable: string) => {
      if (requestedTable === table) {
        return {
          delete: deleteFn,
        }
      }

      throw new Error(`Unexpected table: ${requestedTable}`)
    }),
  }

  return { client, deleteFn, eq, select, maybeSingle }
}

describe('MenuService delete guards', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.clearAllMocks()
  })

  it('returns not-found for missing ingredient deletes instead of false success', async () => {
    const { client } = buildDeleteClient('menu_ingredients')
    mockedCreateClient.mockResolvedValue(client)

    await expect(MenuService.deleteIngredient('ingredient-1')).rejects.toThrow('Ingredient not found')
  })

  it('returns not-found for missing recipe deletes instead of false success', async () => {
    const { client } = buildDeleteClient('menu_recipes')
    mockedCreateClient.mockResolvedValue(client)

    await expect(MenuService.deleteRecipe('recipe-1')).rejects.toThrow('Recipe not found')
  })

  it('returns not-found for missing dish deletes instead of false success', async () => {
    const { client } = buildDeleteClient('menu_dishes')
    mockedCreateClient.mockResolvedValue(client)

    await expect(MenuService.deleteDish('dish-1')).rejects.toThrow('Dish not found')
  })

  // Updated: updateRecipe now uses supabase.rpc('update_recipe_transaction')
  // instead of direct table operations. A null return from the RPC means no recipe found.
  it('returns error when recipe update RPC fails', async () => {
    mockedCreateClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Recipe not found' },
      }),
    })

    await expect(
      MenuService.updateRecipe('recipe-1', {
        name: 'Updated Recipe',
        yield_quantity: 1,
        yield_unit: 'portion',
        is_active: true,
      })
    ).rejects.toThrow('Failed to update recipe')
  })

  // Updated: updateDish now uses supabase.rpc('update_dish_transaction')
  // instead of direct table operations. An RPC error indicates failure.
  it('returns error when dish update RPC fails', async () => {
    vi.spyOn(MenuSettingsService, 'getMenuTargetGp').mockResolvedValue(70)
    vi.spyOn(MenuService, 'getMenuAndCategoryIds').mockResolvedValue({
      menuMap: new Map([['main', 'menu-1']]),
      categoryMap: new Map([['food', 'cat-1']]),
    })

    mockedCreateClient.mockResolvedValue({
      rpc: vi.fn().mockResolvedValue({
        data: null,
        error: { message: 'Dish not found' },
      }),
    })

    await expect(
      MenuService.updateDish('dish-1', {
        name: 'Updated Dish',
        selling_price: 14.5,
        is_active: true,
        is_sunday_lunch: false,
        assignments: [{ menu_code: 'main', category_code: 'food', sort_order: 0 }],
      })
    ).rejects.toThrow('Failed to update dish')
  })
})

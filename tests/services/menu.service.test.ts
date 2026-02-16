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

  it('returns not-found when recipe update affects no rows', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'menu_recipes') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
      }),
    })

    await expect(
      MenuService.updateRecipe('recipe-1', {
        name: 'Updated Recipe',
        yield_quantity: 1,
        yield_unit: 'portion',
        is_active: true,
      })
    ).rejects.toThrow('Recipe not found')
  })

  it('returns not-found when dish update affects no rows', async () => {
    vi.spyOn(MenuSettingsService, 'getMenuTargetGp').mockResolvedValue(70)
    vi.spyOn(MenuService, 'getMenuAndCategoryIds').mockResolvedValue({
      menuMap: new Map([['main', 'menu-1']]),
      categoryMap: new Map([['food', 'cat-1']]),
    })

    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const select = vi.fn().mockReturnValue({ maybeSingle })
    const eq = vi.fn().mockReturnValue({ select })

    mockedCreateClient.mockResolvedValue({
      from: vi.fn((table: string) => {
        if (table !== 'menu_dishes') {
          throw new Error(`Unexpected table: ${table}`)
        }

        return {
          update: vi.fn().mockReturnValue({ eq }),
        }
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
    ).rejects.toThrow('Dish not found')
  })
})

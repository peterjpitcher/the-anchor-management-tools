import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const serviceSource = readFileSync(resolve(process.cwd(), 'src/services/menu.ts'), 'utf8')
const migrationSource = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/20260708000021_menu_ingredient_price_atomicity.sql'),
  'utf8'
)
const rollbackSource = readFileSync(
  resolve(process.cwd(), 'supabase/rollbacks/20260708000021_menu_ingredient_price_atomicity.sql'),
  'utf8'
)

function functionBody(name: string) {
  const start = serviceSource.indexOf(`static async ${name}`)
  const next = serviceSource.indexOf('\n  static async ', start + 1)
  return serviceSource.slice(start, next === -1 ? undefined : next)
}

describe('menu ingredient price atomicity wiring', () => {
  it('routes ingredient pack-cost writes through transaction RPCs', () => {
    expect(functionBody('createIngredient')).toContain("rpc('menu_create_ingredient_with_price'")
    expect(functionBody('updateIngredient')).toContain("rpc('menu_update_ingredient_with_price'")
    expect(functionBody('updateIngredientPackCost')).toContain("rpc('menu_update_ingredient_pack_cost'")

    expect(functionBody('createIngredient')).not.toContain("from('menu_ingredient_prices').insert")
    expect(functionBody('updateIngredient')).not.toContain("from('menu_ingredient_prices').insert")
    expect(functionBody('updateIngredientPackCost')).not.toContain("from('menu_ingredient_prices').insert")
  })

  it('ships migration and rollback SQL', () => {
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.menu_create_ingredient_with_price')
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.menu_update_ingredient_with_price')
    expect(migrationSource).toContain('CREATE OR REPLACE FUNCTION public.menu_update_ingredient_pack_cost')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.menu_create_ingredient_with_price')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.menu_update_ingredient_with_price')
    expect(rollbackSource).toContain('DROP FUNCTION IF EXISTS public.menu_update_ingredient_pack_cost')
  })
})

#!/usr/bin/env tsx

/**
 * Sunday lunch menu diagnostics (read-only).
 *
 * Safety note:
 * - This script MUST NOT write to the database.
 * - It fails closed on any query error and blocks --confirm.
 */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import { assertScriptQuerySucceeded } from '@/lib/script-mutation-safety'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

function assertReadOnlyScript(argv: string[] = process.argv.slice(2)): void {
  if (argv.includes('--confirm')) {
    throw new Error('test-sunday-lunch-menu is read-only and does not support --confirm.')
  }
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

function formatMoney(value: unknown): string {
  const numeric = toNumber(value)
  if (numeric === null) {
    return 'N/A'
  }
  return numeric.toFixed(2)
}

async function run(): Promise<void> {
  assertReadOnlyScript()

  console.log('Sunday lunch menu diagnostics (read-only)\n')

  const supabase = createAdminClient()

  console.log('1) Fetching active menu items...')
  const { data: menuItems, error: menuError } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id, name, description, price, category, display_order, is_active')
    .eq('is_active', true)
    .order('category')
    .order('display_order')
    .order('name')

  const items =
    assertScriptQuerySucceeded({
      operation: 'select sunday_lunch_menu_items (active)',
      error: menuError,
      data: menuItems,
      allowMissing: true,
    }) ?? []

  console.log(`Found ${items.length} active item(s).\n`)
  if (items.length === 0) {
    throw new Error('No active sunday_lunch_menu_items found.')
  }

  const mains = items.filter((item) => item.category === 'main')
  const sides = items.filter((item) => item.category === 'side')

  console.log('2) Menu structure:')
  console.log(`- Main courses: ${mains.length}`)
  console.log(`- Sides: ${sides.length}\n`)

  console.log('3) Main courses:')
  for (const main of mains) {
    console.log(`- ${main.name} (GBP ${formatMoney(main.price)})`)
    if (main.description) {
      console.log(`  ${main.description}`)
    }
  }
  console.log('')

  console.log('4) Sides:')
  const includedSides = sides.filter((side) => toNumber(side.price) === 0)
  const extraSides = sides.filter((side) => {
    const price = toNumber(side.price)
    return typeof price === 'number' && price > 0
  })

  console.log('Included with main course:')
  for (const side of includedSides) {
    console.log(`- ${side.name}`)
    if (side.description) {
      console.log(`  ${side.description}`)
    }
  }

  if (extraSides.length > 0) {
    console.log('\nOptional extras:')
    for (const side of extraSides) {
      console.log(`- ${side.name} (+GBP ${formatMoney(side.price)})`)
      if (side.description) {
        console.log(`  ${side.description}`)
      }
    }
  }
  console.log('')

  console.log('5) Checking for unexpected active categories...')
  const { data: legacyRows, error: legacyError } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id, category')
    .eq('is_active', true)
    .not('category', 'in', '("main","side")')
    .limit(50)

  const legacyItems =
    assertScriptQuerySucceeded({
      operation: 'select sunday_lunch_menu_items (unexpected categories)',
      error: legacyError,
      data: legacyRows,
      allowMissing: true,
    }) ?? []

  if (legacyItems.length > 0) {
    throw new Error(
      `Found ${legacyItems.length} active menu item(s) with unexpected categories (expected only \"main\" or \"side\").`
    )
  }

  console.log('✅ No unexpected active categories found.')
  console.log('\n✅ Read-only Sunday lunch menu diagnostics completed.')
}

run().catch((error) => {
  console.error('Fatal error:', error)
  process.exitCode = 1
})

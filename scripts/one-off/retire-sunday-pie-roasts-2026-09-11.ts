/**
 * Takes the two pie roasts off the Sunday menu (owner-confirmed 11 September 2026).
 *
 * "Beef & Ale Pie Roast" and "Chicken & Wild Mushroom Pie Roast" are switched off in both menu
 * tables, because they drift independently: menu_dishes feeds the website's /sunday-roast page and
 * sunday_lunch_menu_items feeds the booking system. The weekday pies ("Beef & Ale Pie",
 * "Chicken & Wild Mushroom Pie") are different rows and are not touched.
 *
 * Switched off, never deleted: older bookings hold foreign keys into these rows.
 *
 * Dry run by default. RUN_RETIRE_SUNDAY_PIE_ROASTS=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const NAMES = ['Beef & Ale Pie Roast', 'Chicken & Wild Mushroom Pie Roast']
const TABLES = [
  { table: 'menu_dishes', resourceType: 'menu_dish' },
  { table: 'sunday_lunch_menu_items', resourceType: 'sunday_lunch_menu_item' },
] as const

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const work: Array<{ table: string; resourceType: string; id: string; name: string }> = []

  for (const { table, resourceType } of TABLES) {
    const { data, error } = await supabase.from(table).select('id,name,is_active').in('name', NAMES)
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const row of data ?? []) {
      if (row.is_active) work.push({ table, resourceType, id: String(row.id), name: String(row.name) })
    }
  }

  console.warn(`${work.length} live row(s) to switch off:`)
  for (const item of work) console.warn(`  ${item.table.padEnd(24)} ${item.name}`)
  if (work.length > 4) throw new Error('More rows than the four expected; stopping.')

  assertScriptMutationAllowed({ scriptName: 'retire-sunday-pie-roasts-2026-09-11', envVar: 'RUN_RETIRE_SUNDAY_PIE_ROASTS' })

  for (const item of work) {
    const { data, error } = await supabase
      .from(item.table)
      .update({ is_active: false })
      .eq('id', item.id)
      .eq('is_active', true)
      .select('id')
    if (error) throw new Error(`${item.table} ${item.name}: ${error.message}`)
    if (!data?.length) throw new Error(`${item.table} ${item.name}: changed under us, stopped.`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: item.resourceType,
      resource_id: item.id,
      operation_status: 'success',
      old_values: { is_active: true },
      new_values: { is_active: false },
      additional_info: { reason: 'Pie roasts off the Sunday menu, owner-confirmed 2026-09-11.', script: 'retire-sunday-pie-roasts-2026-09-11' },
    })
  }

  // Read back rather than trusting the writes.
  let stillLive = 0
  for (const { table } of TABLES) {
    const { count } = await supabase.from(table).select('id', { count: 'exact', head: true }).in('name', NAMES).eq('is_active', true)
    stillLive += count ?? 0
  }
  console.warn(`\nVerified from the database: ${stillLive} pie roast row(s) still live.`)
  if (stillLive > 0) throw new Error('Some rows did not take the change.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

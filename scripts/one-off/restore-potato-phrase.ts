/**
 * Restores the approved potato phrase in every live roast description.
 *
 * SSOT §4: "The correct phrase is 'triple-cooked, herb-and-garlic crusted'." Eight active rows
 * across both menu tables say "triple-cooked herb-crusted" instead: the garlic has gone. It is
 * a named phrase with a rule attached, and it publishes straight to the website and into the
 * booking system.
 *
 * DELIBERATELY NARROW. This swaps that one phrase and touches nothing else, including the
 * "Indulge in", "Savour" and "Delight in" openers the SSOT's voice rules now ban. Rewriting the
 * menu's voice is the owner's call and a separate pass; this is a factual phrase restored.
 *
 * Both tables, because they drift independently (SSOT §15): menu_dishes feeds the website,
 * sunday_lunch_menu_items feeds the booking system.
 *
 * Dry run by default. RUN_RESTORE_POTATO_PHRASE=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const WRONG = 'triple-cooked herb-crusted'
const RIGHT = 'triple-cooked, herb-and-garlic crusted'
const TABLES = ['menu_dishes', 'sunday_lunch_menu_items'] as const

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const work: Array<{ table: (typeof TABLES)[number]; id: string; name: string; before: string; after: string }> = []

  for (const table of TABLES) {
    const { data, error } = await supabase
      .from(table)
      .select('id,name,description')
      .eq('is_active', true)
      .ilike('description', `%${WRONG}%`)
    if (error) throw new Error(`${table}: ${error.message}`)
    for (const row of data ?? []) {
      const before = String(row.description)
      // Case-preserving swap of the one phrase; nothing else in the text moves.
      const after = before.replace(new RegExp(WRONG, 'gi'), RIGHT)
      if (after === before) continue
      work.push({ table, id: String(row.id), name: String(row.name), before, after })
    }
  }

  console.warn(`${work.length} row(s) to correct:`)
  for (const item of work) console.warn(`  ${item.table.padEnd(24)} ${item.name}`)

  assertScriptMutationAllowed({ scriptName: 'restore-potato-phrase', envVar: 'RUN_RESTORE_POTATO_PHRASE' })

  for (const item of work) {
    const { error } = await supabase.from(item.table).update({ description: item.after }).eq('id', item.id)
    if (error) throw new Error(`${item.table} ${item.name}: ${error.message}`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: item.table === 'menu_dishes' ? 'menu_dish' : 'sunday_lunch_menu_item',
      resource_id: item.id,
      operation_status: 'success',
      old_values: { description: item.before },
      new_values: { description: item.after },
      additional_info: { reason: 'Restored the SSOT §4 potato phrase: triple-cooked, herb-and-garlic crusted.', script: 'restore-potato-phrase' },
    })
  }

  // Read back rather than trusting the writes.
  let remaining = 0
  for (const table of TABLES) {
    const { count } = await supabase
      .from(table).select('id', { count: 'exact', head: true })
      .eq('is_active', true).ilike('description', `%${WRONG}%`)
    remaining += count ?? 0
  }
  console.warn(`\nVerified from the database: ${remaining} live row(s) still say "${WRONG}".`)
  if (remaining > 0) throw new Error('Some rows did not take the change.')
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

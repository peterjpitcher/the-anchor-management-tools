/**
 * The menu voice pass of 10 September 2026: descriptions rewritten to the voice in the website
 * SSOT §1 (say what the dish is and why it's good, short sentences, no "Indulge in"). The owner
 * approved 81 on 11 September 2026; the four for the Sunday pie roasts were dropped the same day,
 * because those dishes were retired, which leaves 77.
 *
 * The rewrites are in `menu-voice-pass-2026-09-10.json`, one row per description, each holding the
 * text it replaces. They were reviewed by the owner as one list before this was run. Names, prices,
 * allergens, dietary flags and the NGCI wording are not touched.
 *
 * GUARDED BY THE OLD TEXT. A row is only updated if its live description still matches the text the
 * owner reviewed, so a dish edited in the app since then is skipped and reported, never overwritten.
 * Both menu tables, because they drift independently: menu_dishes feeds the website,
 * sunday_lunch_menu_items feeds the booking system.
 *
 * Dry run by default. RUN_MENU_VOICE_PASS=true applies it.
 */
import { config } from 'dotenv'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

config({ path: '.env.local' })

import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { houseStyleErrors } from '@/lib/copy/house-style'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const TABLES = ['menu_dishes', 'sunday_lunch_menu_items'] as const

type Row = { table: (typeof TABLES)[number]; id: string; name: string; current: string; proposed: string }

async function main(): Promise<void> {
  const rows = JSON.parse(readFileSync(join(__dirname, 'menu-voice-pass-2026-09-10.json'), 'utf8')) as Row[]
  const supabase = createAdminClient()

  // A rewrite that breaks a banned-claim rule never ships, whatever the review said.
  for (const row of rows) {
    if (!TABLES.includes(row.table)) throw new Error(`Unknown table ${row.table}`)
    const errors = houseStyleErrors(`${row.name}. ${row.proposed}`)
    if (errors.length) throw new Error(`${row.name}: ${errors.map((e) => e.rule).join(', ')}`)
  }

  const ready: Row[] = []
  const skipped: Array<{ row: Row; why: string }> = []
  for (const table of TABLES) {
    const ids = rows.filter((r) => r.table === table).map((r) => r.id)
    if (!ids.length) continue
    const { data, error } = await supabase.from(table).select('id,name,description').in('id', ids)
    if (error) throw new Error(`${table}: ${error.message}`)
    const live = new Map((data ?? []).map((d) => [String(d.id), d]))
    for (const row of rows.filter((r) => r.table === table)) {
      const found = live.get(row.id)
      if (!found) skipped.push({ row, why: 'row not found' })
      else if (String(found.description ?? '') === row.proposed) skipped.push({ row, why: 'already done' })
      else if (String(found.description ?? '') !== row.current) skipped.push({ row, why: 'edited since the review' })
      else ready.push(row)
    }
  }

  console.warn(`${ready.length} description(s) to rewrite, ${skipped.length} skipped.`)
  for (const { row, why } of skipped) console.warn(`  skip  ${row.table.padEnd(24)} ${row.name}: ${why}`)

  assertScriptMutationAllowed({ scriptName: 'menu-voice-pass-2026-09-10', envVar: 'RUN_MENU_VOICE_PASS' })

  for (const row of ready) {
    const { data, error } = await supabase
      .from(row.table)
      .update({ description: row.proposed })
      .eq('id', row.id)
      .eq('description', row.current)
      .select('id')
    if (error) throw new Error(`${row.table} ${row.name}: ${error.message}`)
    if (!data?.length) throw new Error(`${row.table} ${row.name}: changed under us, stopped.`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: row.table === 'menu_dishes' ? 'menu_dish' : 'sunday_lunch_menu_item',
      resource_id: row.id,
      operation_status: 'success',
      old_values: { description: row.current },
      new_values: { description: row.proposed },
      additional_info: { reason: 'Menu voice pass, SSOT §1, owner-approved 2026-09-11.', script: 'menu-voice-pass-2026-09-10' },
    })
  }

  // Read back rather than trusting the writes.
  let wrong = 0
  for (const table of TABLES) {
    const wanted = rows.filter((r) => r.table === table)
    if (!wanted.length) continue
    const { data } = await supabase.from(table).select('id,description').in('id', wanted.map((r) => r.id))
    const live = new Map((data ?? []).map((d) => [String(d.id), String(d.description ?? '')]))
    for (const row of wanted) if (live.get(row.id) !== row.proposed) wrong++
  }
  console.warn(`\nVerified from the database: ${rows.length - wrong} of ${rows.length} descriptions now read as reviewed.`)
  if (wrong > 0) throw new Error(`${wrong} description(s) do not match the reviewed text.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

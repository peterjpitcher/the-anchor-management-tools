/**
 * READ-ONLY. Dumps every active menu description from both menu tables, with the
 * menus and categories each dish sits in and its house-style findings, so a voice
 * pass can be drafted and reviewed as one list. Writes nothing to the database.
 *
 * Run: npx tsx scripts/one-off/dump-menu-descriptions.ts <out.json>
 */
import { config } from 'dotenv'
import { writeFileSync } from 'node:fs'

config({ path: '.env.local' })

async function main(): Promise<void> {
  const out = process.argv[2]
  if (!out) throw new Error('Pass an output path')
  const { createAdminClient } = await import('../../src/lib/supabase/admin')
  const { checkHouseStyle } = await import('../../src/lib/copy/house-style')
  const supabase = createAdminClient()

  const { data: dishes, error: dishError } = await supabase
    .from('menu_dishes')
    .select('id,name,description,dietary_flags,is_sunday_lunch,menu_dish_menu_assignments(menu_menus(code),menu_categories(name))')
    .eq('is_active', true)
    .order('name')
  if (dishError) throw dishError

  const { data: sunday, error: sundayError } = await supabase
    .from('sunday_lunch_menu_items')
    .select('id,name,description,category,dietary_info')
    .eq('is_active', true)
    .order('display_order')
  if (sundayError) throw sundayError

  type Assignment = { menu_menus: { code: string } | null; menu_categories: { name: string } | null }
  const rows = [
    ...(dishes ?? []).map((d) => ({
      table: 'menu_dishes',
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      flags: d.dietary_flags,
      placement: [...new Set(((d.menu_dish_menu_assignments ?? []) as unknown as Assignment[])
        .map((a) => `${a.menu_menus?.code ?? '?'}/${a.menu_categories?.name ?? '?'}`))],
      findings: checkHouseStyle(`${d.name}. ${d.description ?? ''}`).map((f) => `${f.severity} ${f.rule}: ${f.matched}`),
    })),
    ...(sunday ?? []).map((d) => ({
      table: 'sunday_lunch_menu_items',
      id: d.id,
      name: d.name,
      description: d.description ?? '',
      flags: d.dietary_info ?? [],
      placement: [`sunday/${d.category}`],
      findings: checkHouseStyle(`${d.name}. ${d.description ?? ''}`).map((f) => `${f.severity} ${f.rule}: ${f.matched}`),
    })),
  ]

  writeFileSync(out, JSON.stringify(rows, null, 2))
  console.log(`${rows.length} active rows written; ${rows.filter((r) => r.findings.length).length} have findings.`)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

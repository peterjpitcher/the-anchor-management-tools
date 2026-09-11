/**
 * Runs the house style over everything in this database that reaches a guest.
 *
 * READ-ONLY. It changes nothing and takes no flags. Run it whenever you like, and certainly
 * before a menu change goes out.
 *
 * The point is reach rather than cleverness. The SSOT's rules have always said "never say X in
 * copy", and the things that reached guests were rows: a Yorkshire pudding on a vegan dish, a
 * retired lamb shank with a gravy we do not serve, a premium tasting priced at nothing. None
 * of those is copy in the sense the rules meant, and all of them published straight to the
 * website. So this reads the tables the website reads.
 *
 * Two menus exist and both are checked, because they drift independently:
 *   sunday_lunch_menu_items  the booking and pre-order system
 *   menu_dishes              the website's Sunday roast page
 *
 * Run: npx tsx scripts/audit-house-style.ts [--all]
 * By default only active or upcoming records are checked; --all includes retired ones.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { checkHouseStyle, type HouseStyleFinding } from '@/lib/copy/house-style'
import { marketingContentSchema } from '@/lib/email/marketing/registry'
import { renderCampaignText } from '@/lib/email/marketing/render'
import { createAdminClient } from '@/lib/supabase/admin'

const includeRetired = process.argv.includes('--all')

interface Row {
  source: string
  label: string
  text: string
  live: boolean
}

function report(rows: Row[]): { errors: number; warnings: number } {
  let errors = 0
  let warnings = 0

  for (const row of rows) {
    const findings: HouseStyleFinding[] = checkHouseStyle(row.text)
    if (findings.length === 0) continue

    const worst = findings.some((f) => f.severity === 'error') ? 'ERROR' : 'warn '
    console.log(`\n${worst} ${row.live ? '[live]    ' : '[not live]'} ${row.source}: ${row.label}`)
    const seen = new Set<string>()
    for (const finding of findings) {
      const key = `${finding.rule}:${finding.matched}`
      if (seen.has(key)) continue
      seen.add(key)
      console.log(`   ${finding.severity === 'error' ? 'E' : 'w'} ${finding.rule}: "${finding.matched}"`)
      finding.severity === 'error' ? (errors += 1) : (warnings += 1)
    }
  }

  return { errors, warnings }
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const rows: Row[] = []

  const { data: dishes } = await supabase
    .from('menu_dishes').select('name,description,is_active')
  for (const d of dishes ?? []) {
    if (!includeRetired && !d.is_active) continue
    rows.push({ source: 'menu_dishes', label: String(d.name), text: `${d.name}. ${d.description ?? ''}`, live: Boolean(d.is_active) })
  }

  const { data: sunday } = await supabase
    .from('sunday_lunch_menu_items').select('name,description,is_active')
  for (const d of sunday ?? []) {
    if (!includeRetired && !d.is_active) continue
    rows.push({ source: 'sunday_lunch_menu_items', label: String(d.name), text: `${d.name}. ${d.description ?? ''}`, live: Boolean(d.is_active) })
  }

  const today = new Date().toISOString().slice(0, 10)
  const { data: events } = await supabase
    .from('events').select('name,date,short_description,long_description,accessibility_notes')
    .gte('date', includeRetired ? '2000-01-01' : today).order('date')
  for (const e of events ?? []) {
    rows.push({
      source: 'events',
      label: `${e.date} ${e.name}`,
      // Access notes publish to the event page too, and they are where "the garden has steps" hid.
      text: `${e.name}. ${e.short_description ?? ''} ${e.long_description ?? ''} ${e.accessibility_notes ?? ''}`,
      live: String(e.date) >= today,
    })
  }

  const { data: campaigns } = await supabase
    .from('marketing_campaigns').select('name,status,content')
  for (const c of campaigns ?? []) {
    if (!includeRetired && c.status === 'completed') continue
    const parsed = marketingContentSchema.safeParse(c.content)
    if (!parsed.success) continue
    let text: string
    try { text = renderCampaignText(parsed.data) } catch { continue }
    rows.push({ source: 'marketing_campaigns', label: String(c.name), text, live: c.status !== 'completed' })
  }

  console.log(`Checking ${rows.length} records${includeRetired ? ' including retired ones' : ' (active and upcoming only)'}.`)
  const { errors, warnings } = report(rows)

  console.log(`\n${'='.repeat(70)}`)
  console.log(`${errors} error(s), ${warnings} warning(s) across ${rows.length} records.`)
  console.log('Errors are claims the SSOT bans outright. Warnings are voice.')
  process.exit(errors > 0 ? 1 : 0)
}

main().catch((error) => {
  console.error(error)
  process.exit(2)
})

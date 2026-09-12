/**
 * Brings the upcoming event listings and the scheduled marketing emails onto the voice in
 * SSOT §1 (owner-confirmed 11 September 2026, emoji rule added 12 September).
 *
 * These are the last 30 warnings the house-style audit raised, and they are surgical: a long
 * sentence split in two, a command opener replaced, an em dash removed, exclamation marks cut
 * to one. Every fact, price, time and name is left exactly as it was, which is why the edits
 * are stored as whole before-and-after strings in the JSON beside this file rather than as
 * regular expressions.
 *
 * Three campaign strings are shared. The B2B consent footer sits in five business campaigns,
 * the Snowball projection caveat in two cash bingo emails and the quiz description in one, so
 * they are replaced wherever they appear in a draft or scheduled campaign's content rather
 * than row by row.
 *
 * Refuses to write if the stored text has changed since the plan was built, if a replacement
 * does not appear the expected number of times, or if the new text still raises a house-style
 * finding.
 *
 * Dry run by default, and the owner sees the whole before-and-after list before it is applied.
 * RUN_EVENT_VOICE_PASS=true applies it.
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { checkHouseStyle } from '@/lib/copy/house-style'
import { marketingContentSchema } from '@/lib/email/marketing/registry'
import { renderCampaignText } from '@/lib/email/marketing/render'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const REASON = 'Event and email voice pass onto SSOT §1, 2026-09-12.'
const SCRIPT = 'event-voice-pass-2026-09-12'

interface EventEdit {
  id: string
  label: string
  field: string
  old: string
  new: string
}

interface CampaignReplacement {
  reason: string
  from: string
  to: string
  expected_rows: number
}

const plan = JSON.parse(readFileSync(join(__dirname, 'event-voice-pass-2026-09-12.json'), 'utf8')) as {
  events: EventEdit[]
  campaigns: CampaignReplacement[]
}

/** Replaces `from` with `to` in every string inside a JSON value, counting the hits. */
function replaceDeep(value: unknown, from: string, to: string, counter: { hits: number }): unknown {
  if (typeof value === 'string') {
    if (!value.includes(from)) return value
    counter.hits += value.split(from).length - 1
    return value.split(from).join(to)
  }
  if (Array.isArray(value)) return value.map((entry) => replaceDeep(entry, from, to, counter))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, replaceDeep(entry, from, to, counter)])
    )
  }
  return value
}

function highlightIndex(field: string): number | null {
  const match = /^highlights\[(\d+)\]$/.exec(field)
  return match ? Number(match[1]) : null
}

async function main(): Promise<void> {
  const supabase = createAdminClient()

  // ---- Events -------------------------------------------------------------------------
  const eventWrites: Array<{ edit: EventEdit; payload: Record<string, unknown>; oldValue: unknown }> = []

  for (const edit of plan.events) {
    const index = highlightIndex(edit.field)
    const column = index === null ? edit.field : 'highlights'
    const { data, error } = await supabase.from('events').select(`id,${column}`).eq('id', edit.id).single()
    if (error) throw new Error(`${edit.label} ${edit.field}: ${error.message}`)

    const stored = (data as Record<string, unknown>)[column]
    if (index === null) {
      if (stored !== edit.old) throw new Error(`${edit.label} ${edit.field}: text has changed since the plan was built.`)
      eventWrites.push({ edit, payload: { [column]: edit.new }, oldValue: stored })
    } else {
      if (!Array.isArray(stored)) throw new Error(`${edit.label}: highlights is not an array.`)
      if (stored[index] !== edit.old) throw new Error(`${edit.label} ${edit.field}: text has changed since the plan was built.`)
      const next = [...stored]
      next[index] = edit.new
      eventWrites.push({ edit, payload: { highlights: next }, oldValue: stored })
    }

    const findings = checkHouseStyle(edit.new, { proseChecks: index === null })
    if (findings.length) {
      throw new Error(`${edit.label} ${edit.field}: the rewrite still fails the house style: ${findings.map((f) => f.rule).join(', ')}`)
    }

    console.warn(`\n${edit.label}  [${edit.field}]`)
    console.warn(`  was: ${edit.old.replace(/\s+/g, ' ').slice(0, 150)}`)
    console.warn(`  now: ${edit.new.replace(/\s+/g, ' ').slice(0, 150)}`)
  }

  // ---- Campaigns ----------------------------------------------------------------------
  const { data: campaigns, error: campaignsError } = await supabase
    .from('marketing_campaigns')
    .select('id,name,audience,content,status,scheduled_for')
    .in('status', ['draft', 'scheduled'])
  if (campaignsError) throw new Error(campaignsError.message)

  const campaignWrites: Array<{ id: string; name: string; content: unknown; oldContent: unknown; applied: string[] }> = []

  for (const campaign of campaigns ?? []) {
    let content: unknown = campaign.content
    const applied: string[] = []
    for (const replacement of plan.campaigns) {
      const counter = { hits: 0 }
      const next = replaceDeep(content, replacement.from, replacement.to, counter)
      if (counter.hits > 0) {
        content = next
        applied.push(`${replacement.reason} (${counter.hits})`)
      }
    }
    if (!applied.length) continue

    const parsed = marketingContentSchema.safeParse(content)
    if (!parsed.success) throw new Error(`${campaign.name}: the rewritten content no longer parses.`)
    const findings = checkHouseStyle(renderCampaignText(parsed.data)).filter((f) => f.rule === 'long-sentence')
    if (findings.length) {
      throw new Error(`${campaign.name}: still has a long sentence: ${findings.map((f) => f.matched).join(' | ')}`)
    }

    campaignWrites.push({ id: campaign.id, name: campaign.name, content, oldContent: campaign.content, applied })
    console.warn(`\n${campaign.name} [${campaign.status}]`)
    for (const line of applied) console.warn(`  ${line}`)
  }

  for (const replacement of plan.campaigns) {
    const rows = (campaigns ?? []).filter((campaign) => JSON.stringify(campaign.content).includes(JSON.stringify(replacement.from).slice(1, -1))).length
    if (rows !== replacement.expected_rows) {
      throw new Error(`Expected ${replacement.expected_rows} campaign(s) with "${replacement.from.slice(0, 50)}...", found ${rows}.`)
    }
  }

  console.warn(`\n${eventWrites.length} event field(s) and ${campaignWrites.length} campaign(s) to update.`)

  assertScriptMutationAllowed({ scriptName: SCRIPT, envVar: 'RUN_EVENT_VOICE_PASS' })

  for (const write of eventWrites) {
    const { data, error } = await supabase.from('events').update(write.payload).eq('id', write.edit.id).select('id')
    if (error) throw new Error(`${write.edit.label} ${write.edit.field}: ${error.message}`)
    if (!data?.length) throw new Error(`${write.edit.label} ${write.edit.field}: no row updated, stopped.`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: 'event',
      resource_id: write.edit.id,
      operation_status: 'success',
      old_values: { [write.edit.field]: write.oldValue },
      new_values: write.payload,
      additional_info: { reason: REASON, script: SCRIPT },
    })
  }

  for (const write of campaignWrites) {
    const { data, error } = await supabase.from('marketing_campaigns').update({ content: write.content }).eq('id', write.id).select('id')
    if (error) throw new Error(`${write.name}: ${error.message}`)
    if (!data?.length) throw new Error(`${write.name}: no row updated, stopped.`)
    await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: write.id,
      operation_status: 'success',
      old_values: { content: 'see the campaign history; replaced three long sentences' },
      new_values: { applied: write.applied },
      additional_info: { reason: REASON, script: SCRIPT },
    })
  }

  // ---- Read back rather than trusting the writes ---------------------------------------
  let wrong = 0
  for (const write of eventWrites) {
    const index = highlightIndex(write.edit.field)
    const column = index === null ? write.edit.field : 'highlights'
    const { data } = await supabase.from('events').select(column).eq('id', write.edit.id).single()
    const stored = (data as Record<string, unknown> | null)?.[column]
    const value = index === null ? stored : Array.isArray(stored) ? stored[index] : undefined
    if (value !== write.edit.new) {
      wrong += 1
      console.error(`  MISMATCH ${write.edit.label} ${write.edit.field}`)
    }
  }
  console.warn(`\nVerified from the database: ${eventWrites.length - wrong}/${eventWrites.length} event field(s) hold the new text.`)
  if (wrong > 0) throw new Error('Some rows did not take the change.')

  const { data: after } = await supabase
    .from('marketing_campaigns')
    .select('id,name,content')
    .in('id', campaignWrites.map((write) => write.id))
  let stale = 0
  for (const row of after ?? []) {
    const text = JSON.stringify(row.content)
    for (const replacement of plan.campaigns) {
      if (text.includes(JSON.stringify(replacement.from).slice(1, -1))) {
        stale += 1
        console.error(`  MISMATCH ${row.name} still holds the old sentence.`)
      }
    }
  }
  console.warn(`Verified from the database: ${campaignWrites.length - stale}/${campaignWrites.length} campaign(s) updated.`)
  if (stale > 0) throw new Error('Some campaigns did not take the change.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

/**
 * Brings the stored event wording and the scheduled cash bingo emails onto the house rule for
 * children (owner decision, 4 November 2026): children are welcome with a supervising adult, and
 * every guest under 18 leaves by 9pm. Until now these listings said children were welcome with no
 * time limit, and every one of these nights runs past 9pm.
 *
 * Each edit is a phrase that must appear exactly once in the stored value, so the script refuses
 * to write if the text has changed since the plan was built. Highlights and a category's FAQs are
 * JSON, and are searched string by string. The two scheduled campaigns get the same sentence
 * swapped and their content hash recomputed, because the hash is what proves the bytes that go
 * out are the ones a human approved.
 *
 * Dry run by default. RUN_CHILDREN_9PM_PASS=true applies it.
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
import { computeContentHash } from '@/services/marketing-campaigns'

const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const REASON = 'Children welcome with an adult, every guest under 18 leaves by 9pm (owner decision 2026-11-04).'
const SCRIPT = 'children-9pm-pass-2026-11-04'

type Table = 'events' | 'event_categories' | 'event_faqs'

interface FieldEdit {
  table: Table
  id: string
  label: string
  field: string
  from: string
  to: string
}

interface CampaignReplacement {
  reason: string
  from: string
  to: string
  expected_rows: number
}

const RESOURCE_TYPE: Record<Table, string> = {
  events: 'event',
  event_categories: 'event_category',
  event_faqs: 'event_faq',
}

const plan = JSON.parse(readFileSync(join(__dirname, 'children-9pm-pass-2026-11-04.json'), 'utf8')) as {
  fields: FieldEdit[]
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

/** House-style findings the new text raises that the old text did not. */
function newFindings(before: string, after: string, proseChecks: boolean): string[] {
  const key = (finding: { rule: string; matched: string }) => `${finding.rule}: ${finding.matched}`
  const old = new Set(checkHouseStyle(before, { proseChecks }).map(key))
  return checkHouseStyle(after, { proseChecks }).map(key).filter((finding) => !old.has(finding))
}

async function main(): Promise<void> {
  const supabase = createAdminClient()

  // ---- Event, category and FAQ fields --------------------------------------------------
  // Edits to one field are applied in plan order, each against the result of the last.
  const groups = new Map<string, FieldEdit[]>()
  for (const edit of plan.fields) {
    const key = `${edit.table}:${edit.id}:${edit.field}`
    groups.set(key, [...(groups.get(key) ?? []), edit])
  }

  const fieldWrites: Array<{ table: Table; id: string; label: string; field: string; oldValue: unknown; newValue: unknown }> = []

  for (const edits of groups.values()) {
    const { table, id, label, field } = edits[0]
    const { data, error } = await supabase.from(table).select(`id,${field}`).eq('id', id).single()
    if (error) throw new Error(`${label} ${field}: ${error.message}`)

    const stored = (data as unknown as Record<string, unknown>)[field]
    let next: unknown = stored
    for (const edit of edits) {
      const counter = { hits: 0 }
      next = replaceDeep(next, edit.from, edit.to, counter)
      if (counter.hits !== 1) {
        throw new Error(`${label} ${field}: expected "${edit.from}" once, found it ${counter.hits} time(s). Stopped.`)
      }
      console.warn(`\n${label}  [${field}]`)
      console.warn(`  was: ${edit.from}`)
      console.warn(`  now: ${edit.to}`)
    }

    const proseChecks = typeof stored === 'string'
    const before = typeof stored === 'string' ? stored : JSON.stringify(stored)
    const after = typeof next === 'string' ? next : JSON.stringify(next)
    const findings = newFindings(before, after, proseChecks)
    if (findings.length) throw new Error(`${label} ${field}: the rewrite fails the house style: ${findings.join(' | ')}`)

    fieldWrites.push({ table, id, label, field, oldValue: stored, newValue: next })
  }

  // ---- Campaigns ----------------------------------------------------------------------
  const { data: campaigns, error: campaignsError } = await supabase
    .from('marketing_campaigns')
    .select('id,name,content,status,scheduled_for')
    .in('status', ['draft', 'scheduled'])
  if (campaignsError) throw new Error(campaignsError.message)

  for (const replacement of plan.campaigns) {
    const rows = (campaigns ?? []).filter((campaign) => JSON.stringify(campaign.content).includes(JSON.stringify(replacement.from).slice(1, -1))).length
    if (rows !== replacement.expected_rows) {
      throw new Error(`Expected ${replacement.expected_rows} campaign(s) with "${replacement.from}", found ${rows}. Stopped.`)
    }
  }

  const campaignWrites: Array<{ id: string; name: string; content: unknown; contentHash: string; applied: string[] }> = []

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
    const findings = checkHouseStyle(renderCampaignText(parsed.data)).filter((finding) => finding.rule === 'long-sentence')
    if (findings.length) {
      throw new Error(`${campaign.name}: now has a long sentence: ${findings.map((finding) => finding.matched).join(' | ')}`)
    }

    campaignWrites.push({ id: campaign.id, name: campaign.name, content, contentHash: computeContentHash(parsed.data), applied })
    console.warn(`\n${campaign.name} [${campaign.status}, ${campaign.scheduled_for}]`)
    for (const line of applied) console.warn(`  ${line}`)
  }

  console.warn(`\n${fieldWrites.length} field(s) and ${campaignWrites.length} campaign(s) to update.`)

  assertScriptMutationAllowed({ scriptName: SCRIPT, envVar: 'RUN_CHILDREN_9PM_PASS' })

  for (const write of fieldWrites) {
    const payload: Record<string, unknown> = { [write.field]: write.newValue }
    if (write.table === 'event_categories') payload.updated_at = new Date().toISOString()
    const { data, error } = await supabase.from(write.table).update(payload).eq('id', write.id).select('id')
    if (error) throw new Error(`${write.label} ${write.field}: ${error.message}`)
    if (!data?.length) throw new Error(`${write.label} ${write.field}: no row updated, stopped.`)
    const { error: auditError } = await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: RESOURCE_TYPE[write.table],
      resource_id: write.id,
      operation_status: 'success',
      old_values: { [write.field]: write.oldValue },
      new_values: { [write.field]: write.newValue },
      additional_info: { reason: REASON, script: SCRIPT },
    })
    if (auditError) console.error(`  audit log not written for ${write.label} ${write.field}: ${auditError.message}`)
  }

  for (const write of campaignWrites) {
    const { data, error } = await supabase
      .from('marketing_campaigns')
      .update({ content: write.content, content_hash: write.contentHash })
      .eq('id', write.id)
      .in('status', ['draft', 'scheduled'])
      .select('id')
    if (error) throw new Error(`${write.name}: ${error.message}`)
    if (!data?.length) throw new Error(`${write.name}: no row updated (sent or cancelled meanwhile?), stopped.`)
    const { error: auditError } = await supabase.from('audit_logs').insert({
      user_id: OWNER_USER_ID,
      operation_type: 'update',
      resource_type: 'marketing_campaign',
      resource_id: write.id,
      operation_status: 'success',
      old_values: { content: 'see the plan file; one sentence replaced' },
      new_values: { applied: write.applied, content_hash: write.contentHash },
      additional_info: { reason: REASON, script: SCRIPT },
    })
    if (auditError) console.error(`  audit log not written for ${write.name}: ${auditError.message}`)
  }

  // ---- Read back rather than trusting the writes ---------------------------------------
  let wrong = 0
  for (const write of fieldWrites) {
    const { data } = await supabase.from(write.table).select(write.field).eq('id', write.id).single()
    const stored = (data as unknown as Record<string, unknown> | null)?.[write.field]
    if (JSON.stringify(stored) !== JSON.stringify(write.newValue)) {
      wrong += 1
      console.error(`  MISMATCH ${write.label} ${write.field}`)
    }
  }
  console.warn(`\nVerified from the database: ${fieldWrites.length - wrong}/${fieldWrites.length} field(s) hold the new text.`)

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
  if (wrong > 0 || stale > 0) throw new Error('Some rows did not take the change.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

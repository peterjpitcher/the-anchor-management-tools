/**
 * Brings the guest event emails into line with the seating rule the owner set on 2026-09-08
 * (cash bingo and music bingo communal, quiz nights table seating, all at capacity 60), then
 * schedules the eight autumn and winter campaigns that were sitting as drafts.
 *
 * The event rows and the category defaults were changed separately in SQL. This only touches
 * the campaigns, because scheduling freezes content: a scheduled campaign has to go back to
 * draft, be edited and be scheduled again, which re-runs every check.
 *
 * Campaigns are looked up by utm_campaign rather than by name, because names carry punctuation
 * that is awkward to reproduce exactly and the utm value is the stable identifier.
 *
 * Dry run by default. RUN_SEATING_RULE_MUTATION=true applies it.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { config } from 'dotenv'

config({ path: '.env.local' })

import { marketingContentSchema, validateMarketingContent } from '@/lib/email/marketing/registry'
import { assertScriptMutationAllowed } from '@/lib/script-mutation-safety'
import { createAdminClient } from '@/lib/supabase/admin'
import { scheduleCampaign, updateCampaign } from '@/services/marketing-campaigns'

const CAMPAIGN_DIR = path.join(process.cwd(), 'src/lib/email/marketing/campaigns')
const OWNER_USER_ID = 'b44dd268-7c66-4163-8ff3-cc962b2d528c'
const QUIZ_SEATING = 'Book your team in together and we will seat you together'

/** Campaigns whose copy changed, keyed by utm_campaign, with the file holding the new content. */
const CONTENT_FROM_FILE: Record<string, string> = {
  'hint-of-halloween-quiz-night-2026-10-07': 'hint-of-halloween-quiz-night-2026-guests.json',
  'sparks-and-sparklers-quiz-night-2026-11-04': 'sparks-and-sparklers-quiz-night-2026-guests.json',
  'tinsel-and-trivia-quiz-night-2026-12-02': 'tinsel-and-trivia-quiz-night-2026-guests.json',
  'sequins-and-showstoppers-music-bingo-2026-11-13': 'sequins-and-showstoppers-music-bingo-2026-guests.json',
  'sleigh-my-name-festive-music-bingo-2026-12-11': 'sleigh-my-name-festive-music-bingo-2026-guests.json',
}

/**
 * The Autumn Kick-Off email is edited in place from the row itself rather than from a file:
 * the repo copy belongs to another session's uncommitted work and is a different draft
 * entirely, so the database is the only trustworthy source for what actually goes out.
 */
const PATCH_IN_PLACE = 'autumn-kick-off-quiz-night-2026-09-16'

/** Drafts to schedule, keyed by utm_campaign, as London wall-clock times with explicit offsets. */
const SCHEDULE: Record<string, string> = {
  'screams-and-soundtracks-music-bingo-2026-10-16': '2026-10-09T12:00:00+01:00',
  'house-of-horrors-halloween-party-2026-10-31': '2026-10-24T12:00:00+01:00',
  'sparks-and-sparklers-quiz-night-2026-11-04': '2026-10-28T09:00:00+00:00',
  'sequins-and-showstoppers-music-bingo-2026-11-13': '2026-11-06T12:00:00+00:00',
  'snowball-showdown-cash-bingo-2026-11-18': '2026-11-11T09:00:00+00:00',
  'tinsel-and-trivia-quiz-night-2026-12-02': '2026-11-25T09:00:00+00:00',
  'sleigh-my-name-festive-music-bingo-2026-12-11': '2026-12-04T12:00:00+00:00',
  'christmas-jackpot-cash-bingo-2026-12-16': '2026-12-09T09:00:00+00:00',
}

interface Row {
  id: string
  name: string
  status: string
  scheduled_for: string | null
  utm_campaign: string | null
  content: unknown
}

function replaceSeatingRow(content: unknown, value: string): { content: unknown; changed: boolean } {
  const clone = JSON.parse(JSON.stringify(content)) as {
    blocks: Array<{ type: string; data: { rows?: Array<{ label: string; value: string }> } }>
  }
  let changed = false
  for (const block of clone.blocks) {
    if (block.type !== 'fact_strip' || !block.data.rows) continue
    for (const row of block.data.rows) {
      if (row.label === 'Seating' && row.value !== value) {
        row.value = value
        changed = true
      }
    }
  }
  return { content: clone, changed }
}

function loadFile(file: string): unknown {
  const content = marketingContentSchema.parse(JSON.parse(readFileSync(path.join(CAMPAIGN_DIR, file), 'utf8')))
  const issues = validateMarketingContent(content)
  if (issues.length > 0) throw new Error(`${file} invalid: ${issues.map((i) => i.message).join('; ')}`)
  return content
}

/** Puts a scheduled campaign back to draft so its content can be edited, as the runbook requires. */
async function unschedule(id: string): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .update({ status: 'draft', scheduled_for: null, approved_recipient_count: null })
    .eq('id', id)
    .eq('status', 'scheduled')
    .select('id')
    .maybeSingle()

  if (error) throw new Error(error.message)
  if (!data) throw new Error(`Campaign ${id} was not scheduled when we tried to unschedule it`)
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const { data, error } = await supabase
    .from('marketing_campaigns')
    .select('id, name, status, scheduled_for, utm_campaign, content')
    .eq('audience_type', 'customer')
    .in('status', ['draft', 'scheduled'])

  if (error) throw new Error(error.message)
  const rows = (data ?? []) as Row[]
  const byUtm = new Map(rows.filter((row) => row.utm_campaign).map((row) => [row.utm_campaign as string, row]))

  const plan: Array<{ row: Row; content: unknown; reschedule: string | null }> = []

  for (const [utm, file] of Object.entries(CONTENT_FROM_FILE)) {
    const row = byUtm.get(utm)
    if (!row) throw new Error(`No campaign with utm_campaign "${utm}"`)
    plan.push({ row, content: loadFile(file), reschedule: row.status === 'scheduled' ? row.scheduled_for : null })
  }

  const kickOff = byUtm.get(PATCH_IN_PLACE)
  if (!kickOff) throw new Error(`No campaign with utm_campaign "${PATCH_IN_PLACE}"`)
  const patched = replaceSeatingRow(kickOff.content, QUIZ_SEATING)
  if (patched.changed) {
    plan.push({ row: kickOff, content: patched.content, reschedule: kickOff.scheduled_for })
  } else {
    console.warn(`no seating change needed for ${kickOff.name}`)
  }

  for (const entry of plan) {
    console.warn(
      `edit  ${entry.row.name} [${entry.row.status}]${entry.reschedule ? `, back to ${entry.reschedule}` : ''}`,
    )
  }
  for (const [utm, when] of Object.entries(SCHEDULE)) {
    const row = byUtm.get(utm)
    if (!row) throw new Error(`No campaign with utm_campaign "${utm}"`)
    if (row.status !== 'draft') throw new Error(`${row.name} is ${row.status}, expected draft`)
    console.warn(`sched ${row.name} ${when}`)
  }

  assertScriptMutationAllowed({
    scriptName: 'apply-event-seating-rule-2026',
    envVar: 'RUN_SEATING_RULE_MUTATION',
  })

  for (const entry of plan) {
    if (entry.reschedule) await unschedule(entry.row.id)
    await updateCampaign(entry.row.id, { content: entry.content as never }, OWNER_USER_ID)
    if (entry.reschedule) {
      const result = await scheduleCampaign(entry.row.id, entry.reschedule, OWNER_USER_ID)
      console.warn(`edited and rescheduled ${entry.row.name} for ${result.campaign.scheduledFor}`)
    } else {
      console.warn(`edited ${entry.row.name}`)
    }
  }

  for (const [utm, when] of Object.entries(SCHEDULE)) {
    const row = byUtm.get(utm)
    if (!row) continue
    const result = await scheduleCampaign(row.id, when, OWNER_USER_ID)
    console.warn(`scheduled ${row.name} for ${result.campaign.scheduledFor}, ${result.approvedRecipientCount} recipients`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})

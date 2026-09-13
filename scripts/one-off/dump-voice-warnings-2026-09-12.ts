/**
 * READ-ONLY. Dumps the exact text behind every voice warning on the events and the marketing
 * campaigns, so the rewrite works from the real strings rather than from the audit's summary.
 *
 * It also re-measures sentence length with a line-aware splitter. The house-style checker
 * splits on `[.!?]` followed by space, which is right for a paragraph and wrong for an email:
 * a masthead line and a bare URL end without punctuation, so the checker reads a heading, a
 * link and the paragraph after them as one 108-word sentence. This prints both numbers so the
 * difference between a real long sentence and a joined line is visible.
 *
 * Run: npx tsx scripts/one-off/dump-voice-warnings-2026-09-12.ts > out.json
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { checkHouseStyle, SENTENCE_REVIEW_LENGTH } from '@/lib/copy/house-style'
import { marketingContentSchema } from '@/lib/email/marketing/registry'
import { renderCampaignText } from '@/lib/email/marketing/render'
import { createAdminClient } from '@/lib/supabase/admin'

interface Unit {
  words: number
  text: string
}

/** Sentence split that also treats a line break as an end, because in an email it is one. */
function lineAwareLongSentences(text: string): Unit[] {
  const out: Unit[] = []
  for (const line of text.split(/\n+/)) {
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      const words = sentence.trim().split(/\s+/).filter(Boolean)
      if (words.length > SENTENCE_REVIEW_LENGTH) out.push({ words: words.length, text: sentence.trim() })
    }
  }
  return out
}

function checkerLongSentences(text: string): Unit[] {
  const out: Unit[] = []
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const words = sentence.trim().split(/\s+/).filter(Boolean)
    if (words.length > SENTENCE_REVIEW_LENGTH) out.push({ words: words.length, text: sentence.trim() })
  }
  return out
}

async function main(): Promise<void> {
  const supabase = createAdminClient()
  const today = new Date().toISOString().slice(0, 10)
  const records: Array<Record<string, unknown>> = []

  const { data: events, error: eventsError } = await supabase
    .from('events')
    .select('id,name,date,short_description,long_description,highlights,meta_description')
    .gte('date', today)
    .order('date')
  if (eventsError) throw new Error(eventsError.message)

  for (const event of events ?? []) {
    for (const field of ['short_description', 'long_description', 'meta_description'] as const) {
      const text = (event as Record<string, unknown>)[field]
      if (typeof text !== 'string' || !text.trim()) continue
      const findings = checkHouseStyle(text)
      if (!findings.length) continue
      records.push({
        table: 'events',
        id: event.id,
        label: `${event.date} ${event.name}`,
        field,
        text,
        rules: [...new Set(findings.map((f) => f.rule))],
        checkerLong: checkerLongSentences(text),
        realLong: lineAwareLongSentences(text),
      })
    }
    const highlights = (event as { highlights?: unknown }).highlights
    if (Array.isArray(highlights)) {
      highlights.forEach((line, index) => {
        if (typeof line !== 'string' || !line.trim()) return
        const findings = checkHouseStyle(line)
        if (!findings.length) return
        records.push({
          table: 'events',
          id: event.id,
          label: `${event.date} ${event.name}`,
          field: `highlights[${index}]`,
          text: line,
          rules: [...new Set(findings.map((f) => f.rule))],
          checkerLong: checkerLongSentences(line),
          realLong: lineAwareLongSentences(line),
        })
      })
    }
  }

  const { data: campaigns, error: campaignsError } = await supabase
    .from('marketing_campaigns')
    .select('id,name,audience,subject,preheader,content,status,scheduled_for')
    .in('status', ['draft', 'scheduled'])
    .order('scheduled_for')
  if (campaignsError) throw new Error(campaignsError.message)

  for (const campaign of campaigns ?? []) {
    const parsed = marketingContentSchema.safeParse(campaign.content)
    if (!parsed.success) continue
    const text = renderCampaignText(parsed.data)
    const findings = checkHouseStyle(text)
    const subjectFindings = checkHouseStyle(String(campaign.subject ?? ''), { proseChecks: false })
    if (!findings.length && !subjectFindings.length) continue
    records.push({
      table: 'marketing_campaigns',
      id: campaign.id,
      label: `${campaign.name} (${campaign.audience}) ${campaign.scheduled_for ?? 'unscheduled'} [${campaign.status}]`,
      field: 'content',
      subject: campaign.subject,
      subjectRules: [...new Set(subjectFindings.map((f) => f.rule))],
      rules: [...new Set(findings.map((f) => f.rule))],
      checkerLong: checkerLongSentences(text),
      realLong: lineAwareLongSentences(text),
      text,
    })
  }

  console.log(JSON.stringify(records, null, 2))
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

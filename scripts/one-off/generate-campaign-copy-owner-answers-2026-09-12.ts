/**
 * Generates the guarded SQL for the owner's answers of 12 September 2026, and changes nothing.
 *
 * The owner confirmed there is no fire anywhere in the pub, that New Year's Eve closes at 1am (the
 * 31 December special-hours row was corrected to 01:00 on 11 September), that the 3 October
 * Halloween save the date should be dropped because the round-up two days earlier makes the same
 * ask, and that the gap between guest campaigns should go from 2 days to 4.
 *
 * Four scheduled round-ups carry a fire claim and both December round-ups tell each list that New
 * Year's Eve closes at 10pm. Marketing sends the copy stored on the campaign row, so the fix is a
 * data change, not a repo change.
 *
 * Read only. It reads each row, proves it can reproduce the stored content_hash from the stored
 * content (so the fingerprint still means what it says), applies the exact replacements, recomputes
 * the hash, and writes a migration file plus a human-readable diff. Applying is a separate step and
 * needs the owner's go-ahead.
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/one-off/generate-campaign-copy-owner-answers-2026-09-12.ts
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { createHash } from 'crypto'
import { writeFileSync } from 'fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeContentHash } from '@/services/marketing-campaigns'

const OUT_DIR = process.env.COPY_FIX_OUT_DIR ?? '.'

/** One replacement, with the campaigns it applies to and why it is being made. */
type Replacement = {
  id: string
  from: string
  to: string
  campaigns: string[]
  reason: string
}

const REPLACEMENTS: Replacement[] = [
  {
    id: 'oct-fire-body',
    from: 'The lights go on, the fire gets going, and suddenly a Wednesday feels like an occasion.',
    to: "The lights go on, it's warm inside, and suddenly a Wednesday feels like an occasion.",
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
    reason: 'No fire anywhere in the pub (owner-confirmed 12 September 2026).',
  },
  {
    id: 'oct-fire-pint',
    from: 'a quiet pint by the fire',
    to: 'a quiet pint somewhere warm',
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
    reason: 'No fire anywhere in the pub (owner-confirmed 12 September 2026).',
  },
  {
    id: 'nov-fire-preheader',
    from: 'Fires lit, three cracking nights out, and Christmas tables up for grabs.',
    to: 'A warm pub, three cracking nights out, and Christmas tables up for grabs.',
    campaigns: ['november-2026-roundup-guests', 'november-2026-roundup-business'],
    reason: 'No fire anywhere in the pub (owner-confirmed 12 September 2026).',
  },
  {
    id: 'nov-fire-justify',
    from: 'cold enough to justify the fire',
    to: 'cold enough to stay put',
    campaigns: ['november-2026-roundup-guests', 'november-2026-roundup-business'],
    reason: 'No fire anywhere in the pub (owner-confirmed 12 September 2026).',
  },
  {
    id: 'dec-nye-hours',
    from: '12pm to 10pm',
    to: '12pm to 1am',
    campaigns: ['december-2026-roundup-guests', 'december-2026-roundup-business'],
    reason:
      "New Year's Eve closes at 1am (owner-confirmed; special_hours corrected 11 September 2026). Only the New Year's Eve row is touched: see the guard below.",
  },
]

/** The New Year's Eve replacement must not touch any other date's hours row. */
const NYE_ROW_MARKER = 'Thu 31 Dec'

function sqlLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

async function main(): Promise<void> {
  const db = createAdminClient()
  const utms = [
    'october-2026-roundup-guests',
    'october-2026-roundup-business',
    'november-2026-roundup-guests',
    'november-2026-roundup-business',
    'december-2026-roundup-guests',
    'december-2026-roundup-business',
  ]

  const { data: rows, error } = await db
    .from('marketing_campaigns')
    .select('id, name, utm_campaign, status, scheduled_for, subject, preheader, content, content_hash')
    .in('utm_campaign', utms)

  if (error) throw new Error(`Could not read the campaigns: ${error.message}`)
  if (!rows || rows.length !== utms.length) {
    throw new Error(`Expected ${utms.length} campaigns, read ${rows?.length ?? 0}`)
  }

  const statements: string[] = []
  const rollbackStatements: string[] = []
  const report: string[] = []
  let changedCampaigns = 0

  for (const utm of utms) {
    const row = rows.find((r) => r.utm_campaign === utm)!
    if (row.status !== 'scheduled') {
      throw new Error(`${utm} is ${row.status}, not scheduled: stop and re-check before changing it`)
    }

    // The fingerprint has to mean what it says before it is replaced.
    const reproduced = computeContentHash(row.content as never)
    if (reproduced !== row.content_hash) {
      throw new Error(
        `${utm}: stored content does not reproduce its stored hash (stored ${row.content_hash}, computed ${reproduced}). Stop.`,
      )
    }

    let text = JSON.stringify(row.content)
    const applied: string[] = []

    for (const replacement of REPLACEMENTS) {
      if (!replacement.campaigns.includes(utm)) continue
      const needle = JSON.stringify(replacement.from).slice(1, -1)
      const swap = JSON.stringify(replacement.to).slice(1, -1)

      if (replacement.id === 'dec-nye-hours') {
        // Both December round-ups list several festive dates, and more than one closes at 10pm.
        // Only the row whose date is Thu 31 Dec may change, so the match is anchored to that row.
        const rowPattern = new RegExp(
          `(${JSON.stringify(NYE_ROW_MARKER).slice(1, -1)}[\\s\\S]{0,200}?)${needle}`,
          'g',
        )
        const before = text
        text = text.replace(rowPattern, (_m, prefix) => `${prefix}${swap}`)
        const hits = before === text ? 0 : 1
        if (hits === 0) throw new Error(`${utm}: could not find the New Year's Eve hours row to correct`)
        applied.push(`${replacement.id} (anchored to "${NYE_ROW_MARKER}")`)
        if (text.includes(`${JSON.stringify(NYE_ROW_MARKER).slice(1, -1)}`) && !text.includes('12pm to 1am')) {
          throw new Error(`${utm}: the New Year's Eve correction did not take`)
        }
        continue
      }

      const occurrences = text.split(needle).length - 1
      if (occurrences === 0) {
        throw new Error(`${utm}: expected text not found, so the stored copy has moved on: "${replacement.from}"`)
      }
      text = text.split(needle).join(swap)
      applied.push(`${replacement.id} (${occurrences} occurrence${occurrences === 1 ? '' : 's'})`)
    }

    const nextContent = JSON.parse(text)
    const nextHash = computeContentHash(nextContent)

    // The row keeps its own subject and preheader columns beside the content, and the send reads
    // those. The November preheader carries a fire claim, so the same replacements run over both
    // columns: a first draft changed only the content and the end-state check caught it.
    let nextSubject = row.subject as string | null
    let nextPreheader = row.preheader as string | null
    for (const replacement of REPLACEMENTS) {
      if (!replacement.campaigns.includes(utm)) continue
      if (replacement.id === 'dec-nye-hours') continue // hours live in the content only
      if (nextSubject) nextSubject = nextSubject.split(replacement.from).join(replacement.to)
      if (nextPreheader) nextPreheader = nextPreheader.split(replacement.from).join(replacement.to)
    }
    const subjectChanged = nextSubject !== row.subject
    const preheaderChanged = nextPreheader !== row.preheader

    if (nextHash === row.content_hash && !subjectChanged && !preheaderChanged) {
      report.push(`${utm}: nothing to change`)
      continue
    }

    changedCampaigns += 1
    const nextJson = JSON.stringify(nextContent)
    if (subjectChanged) applied.push('subject column')
    if (preheaderChanged) applied.push('preheader column')

    // Guarded: matched on the campaign's own utm_campaign and the hash the review saw, so a
    // campaign someone else has edited since is left alone and the apply fails loudly instead.
    statements.push(
      [
        `-- ${row.name}: ${applied.join('; ')}`,
        `update public.marketing_campaigns`,
        `set content = ${sqlLiteral(nextJson)}::jsonb,`,
        `    content_hash = ${sqlLiteral(nextHash)},`,
        ...(subjectChanged ? [`    subject = ${sqlLiteral(nextSubject ?? '')},`] : []),
        ...(preheaderChanged ? [`    preheader = ${sqlLiteral(nextPreheader ?? '')},`] : []),
        `    updated_at = now()`,
        `where utm_campaign = ${sqlLiteral(utm)}`,
        `  and status = 'scheduled'`,
        `  and content_hash = ${sqlLiteral(row.content_hash)};`,
        `if not found then`,
        `  raise exception 'Campaign % did not match its reviewed hash %, so nothing was changed', ${sqlLiteral(utm)}, ${sqlLiteral(row.content_hash)};`,
        `end if;`,
      ].join('\n'),
    )

    // The exact way back: the content, hash and columns this review read, matched on the hash the
    // change put there, so a rollback cannot undo someone else's later edit.
    rollbackStatements.push(
      [
        `-- ${row.name}: back to the copy of 12 September 2026`,
        `update public.marketing_campaigns`,
        `set content = ${sqlLiteral(JSON.stringify(row.content))}::jsonb,`,
        `    content_hash = ${sqlLiteral(row.content_hash as string)},`,
        ...(subjectChanged ? [`    subject = ${sqlLiteral((row.subject as string) ?? '')},`] : []),
        ...(preheaderChanged ? [`    preheader = ${sqlLiteral((row.preheader as string) ?? '')},`] : []),
        `    updated_at = now()`,
        `where utm_campaign = ${sqlLiteral(utm)}`,
        `  and content_hash = ${sqlLiteral(nextHash)};`,
        `if not found then`,
        `  raise exception 'Campaign % is not on the hash this rollback undoes (%), so it was left alone', ${sqlLiteral(utm)}, ${sqlLiteral(nextHash)};`,
        `end if;`,
      ].join('\n'),
    )

    report.push(
      [
        `## ${row.name} (${utm})`,
        `sends: ${row.scheduled_for}`,
        `applied: ${applied.join('; ')}`,
        `hash: ${row.content_hash} -> ${nextHash}`,
        ...REPLACEMENTS.filter((r) => r.campaigns.includes(utm)).map(
          (r) => `  "${r.from}"\n    becomes "${r.to}"\n    because ${r.reason}`,
        ),
      ].join('\n'),
    )
  }

  const migration = [
    `-- The owner's answers of 12 September 2026, from the guest email review.`,
    `--`,
    `-- 1. There is no fire anywhere in the pub, so four fire claims come out of the October and`,
    `--    November 2026 round-ups (guests and business). The website SSOT records the ban.`,
    `-- 2. New Year's Eve closes at 1am, so both December round-ups stop telling their list 10pm.`,
    `--    The 31 December special-hours row was corrected to 01:00 on 11 September 2026.`,
    `-- 3. The 3 October Halloween save the date is cancelled: the round-up on 1 October makes the`,
    `--    same ask 48 hours earlier.`,
    `-- 4. The minimum gap between guest campaigns goes from 2 days to 4. Unsubscribes ran at 7.1%`,
    `--    on the first campaign and 0.8% to 3.5% since, against a norm well under 0.5%.`,
    `--`,
    `-- Every campaign edit is matched on the content_hash this review read, so a campaign someone`,
    `-- else has changed since is left untouched and the whole statement raises instead. Nothing`,
    `-- here sends an email or changes a send time.`,
    ``,
    `do $$`,
    `begin`,
    `  if current_setting('request.jwt.claims', true) is null and current_database() not in ('postgres') then`,
    `    raise notice 'Not the expected production database; statements still run guarded.';`,
    `  end if;`,
    ``,
    ...statements.map((s) => s.split('\n').map((line) => `  ${line}`).join('\n')),
    ``,
    `  -- The save the date: cancelled, not deleted, so the record of what was approved survives.`,
    `  update public.marketing_campaigns`,
    `  set status = 'cancelled',`,
    `      cancelled_at = now(),`,
    `      updated_at = now()`,
    `  where utm_campaign = 'house-of-horrors-halloween-party-save-the-date-2026-10-03'`,
    `    and status = 'scheduled';`,
    `  if not found then`,
    `    raise exception 'The Halloween save the date was not scheduled, so nothing was cancelled';`,
    `  end if;`,
    ``,
    `  -- The gap between guest campaigns.`,
    `  update public.marketing_settings`,
    `  set frequency_cap_days = 4,`,
    `      updated_at = now()`,
    `  where frequency_cap_days = 2;`,
    `  if not found then`,
    `    raise exception 'The frequency cap was not 2 days, so it was left alone';`,
    `  end if;`,
    ``,
    `  -- End state, asserted in the same statement that made it.`,
    `  if exists (`,
    `    select 1 from public.marketing_campaigns`,
    `    where status = 'scheduled'`,
    `      and (content::text like '%the fire%' or content::text like '%Fires lit%' or preheader like '%Fires lit%')`,
    `  ) then`,
    `    raise exception 'A scheduled campaign still carries a fire claim';`,
    `  end if;`,
    ``,
    `  if exists (`,
    `    select 1 from public.marketing_campaigns`,
    `    where status = 'scheduled' and utm_campaign like 'december-2026-roundup-%'`,
    `      and content::text not like '%12pm to 1am%'`,
    `  ) then`,
    `    raise exception 'A December round-up does not carry the 1am New Year''s Eve close';`,
    `  end if;`,
    `end $$;`,
    ``,
  ].join('\n')

  const rollback = [
    `-- Undoes 20260912180000_campaign_copy_owner_answers.sql.`,
    `--`,
    `-- Puts back the copy, hashes, subject and preheader columns this review read on 12 September`,
    `-- 2026, re-schedules the Halloween save the date and returns the campaign gap to 2 days. Each`,
    `-- campaign is matched on the hash the change put there, so a campaign edited since is left`,
    `-- alone and the statement raises instead of quietly reverting someone else's work.`,
    ``,
    `do $$`,
    `begin`,
    ...rollbackStatements.map((s) => s.split('\n').map((line) => `  ${line}`).join('\n')),
    ``,
    `  update public.marketing_campaigns`,
    `  set status = 'scheduled',`,
    `      cancelled_at = null,`,
    `      updated_at = now()`,
    `  where utm_campaign = 'house-of-horrors-halloween-party-save-the-date-2026-10-03'`,
    `    and status = 'cancelled';`,
    `  if not found then`,
    `    raise exception 'The Halloween save the date was not cancelled, so it was left alone';`,
    `  end if;`,
    ``,
    `  update public.marketing_settings`,
    `  set frequency_cap_days = 2,`,
    `      updated_at = now()`,
    `  where frequency_cap_days = 4;`,
    `  if not found then`,
    `    raise exception 'The frequency cap was not 4 days, so it was left alone';`,
    `  end if;`,
    `end $$;`,
    ``,
  ].join('\n')

  writeFileSync(`${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.sql`, migration)
  writeFileSync(`${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.rollback.sql`, rollback)
  writeFileSync(
    `${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.report.md`,
    [`# What this changes`, ``, ...report, ``, `Campaigns changed: ${changedCampaigns} of ${utms.length}.`].join('\n') + '\n',
  )

  console.log(`Campaigns read: ${rows.length}. Every stored hash reproduced from its stored content.`)
  console.log(`Campaigns to change: ${changedCampaigns}.`)
  console.log(`SQL: ${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.sql`)
  console.log(`Report: ${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.report.md`)
  console.log('Nothing was written to the database.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

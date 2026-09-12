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
 * The SQL it writes is surgical: one `jsonb_set` per string, at the exact path that string sits on,
 * guarded on the value found there now, on the campaign's content_hash and on its status. Pasting
 * whole rewritten documents would have meant a 43 KB migration nobody could read, and the same
 * pattern the Christmas minimum used (edit in place, assert the result) is both smaller and easier
 * to check. The new content_hash is computed here, from the edited content, and verified against the
 * stored row after the apply by `--verify`.
 *
 * Read only. Applying is a separate step and needs the owner's go-ahead.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-campaign-copy-owner-answers-2026-09-12.ts
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-campaign-copy-owner-answers-2026-09-12.ts --verify
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeContentHash } from '@/services/marketing-campaigns'

const OUT_DIR = process.env.COPY_FIX_OUT_DIR ?? '.'
const VERIFY = process.argv.includes('--verify')

type Replacement = { id: string; from: string; to: string; campaigns: string[] }

const REPLACEMENTS: Replacement[] = [
  {
    id: 'oct-fire-body',
    from: 'The lights go on, the fire gets going, and suddenly a Wednesday feels like an occasion.',
    to: "The lights go on, it's warm inside, and suddenly a Wednesday feels like an occasion.",
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
  },
  {
    id: 'oct-fire-pint',
    from: 'a quiet pint by the fire',
    to: 'a quiet pint somewhere warm',
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
  },
  {
    id: 'nov-fire-preheader',
    from: 'Fires lit, three cracking nights out, and Christmas tables up for grabs.',
    to: 'A warm pub, three cracking nights out, and Christmas tables up for grabs.',
    campaigns: ['november-2026-roundup-guests', 'november-2026-roundup-business'],
  },
  {
    id: 'nov-fire-justify',
    from: 'cold enough to justify the fire',
    to: 'cold enough to stay put',
    campaigns: ['november-2026-roundup-guests', 'november-2026-roundup-business'],
  },
]

/** The New Year's Eve hours row: found by its own date, never by matching "12pm to 10pm". */
const NYE = {
  campaigns: ['december-2026-roundup-guests', 'december-2026-roundup-business'],
  dateLabel: 'Thu 31 Dec',
  fromHours: '12pm to 10pm',
  toHours: '12pm to 1am',
}

const UTMS = [
  'october-2026-roundup-guests',
  'october-2026-roundup-business',
  'november-2026-roundup-guests',
  'november-2026-roundup-business',
  'december-2026-roundup-guests',
  'december-2026-roundup-business',
]

const SAVE_THE_DATE = 'house-of-horrors-halloween-party-save-the-date-2026-10-03'

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
/** A jsonb path literal, as Postgres wants it: '{blocks,3,data,body,0}'. */
const pathLit = (path: (string | number)[]) => lit(`{${path.join(',')}}`)

/** Every string in the document, with the path it sits on. */
function walkStrings(node: unknown, path: (string | number)[] = []): { path: (string | number)[]; value: string }[] {
  if (typeof node === 'string') return [{ path, value: node }]
  if (Array.isArray(node)) return node.flatMap((child, i) => walkStrings(child, [...path, i]))
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([key, child]) => walkStrings(child, [...path, key]))
  }
  return []
}

function setAtPath(root: unknown, path: (string | number)[], value: string): void {
  let node: any = root
  for (const key of path.slice(0, -1)) node = node[key]
  node[path[path.length - 1] as never] = value
}

async function main(): Promise<void> {
  const db = createAdminClient()
  const { data: rows, error } = await db
    .from('marketing_campaigns')
    .select('id, name, utm_campaign, status, scheduled_for, subject, preheader, content, content_hash')
    .in('utm_campaign', UTMS)

  if (error) throw new Error(`Could not read the campaigns: ${error.message}`)
  if (!rows || rows.length !== UTMS.length) throw new Error(`Expected ${UTMS.length} campaigns, read ${rows?.length ?? 0}`)

  if (VERIFY) {
    // After the apply: every stored hash must be reproducible from its stored content, no fire
    // claim may survive, and both December round-ups must carry the 1am close.
    let problems = 0
    for (const row of rows) {
      const reproduced = computeContentHash(row.content as never)
      const text = JSON.stringify(row.content)
      const fire = /the fire|Fires lit/i.test(text) || /Fires lit/i.test(row.preheader ?? '')
      const nyeOk = !row.utm_campaign!.startsWith('december') || text.includes(NYE.toHours)
      const hashOk = reproduced === row.content_hash
      if (!hashOk || fire || !nyeOk) problems += 1
      console.log(
        `${row.utm_campaign}: hash ${hashOk ? 'reproduces' : `MISMATCH (stored ${row.content_hash}, computed ${reproduced})`}` +
          `, fire claim ${fire ? 'STILL PRESENT' : 'gone'}${row.utm_campaign!.startsWith('december') ? `, 1am ${nyeOk ? 'present' : 'MISSING'}` : ''}`,
      )
    }
    const { data: std } = await db.from('marketing_campaigns').select('status').eq('utm_campaign', SAVE_THE_DATE).maybeSingle()
    const { data: settings } = await db.from('marketing_settings').select('frequency_cap_days').maybeSingle()
    console.log(`save the date: ${std?.status}`)
    console.log(`campaign gap: ${settings?.frequency_cap_days} days`)
    if (std?.status !== 'cancelled') problems += 1
    if (settings?.frequency_cap_days !== 4) problems += 1
    console.log(problems === 0 ? 'ALL CHECKS PASS' : `${problems} CHECK(S) FAILED`)
    process.exit(problems === 0 ? 0 : 1)
  }

  const forward: string[] = []
  const back: string[] = []
  const report: string[] = []

  for (const utm of UTMS) {
    const row = rows.find((r) => r.utm_campaign === utm)!
    if (row.status !== 'scheduled') throw new Error(`${utm} is ${row.status}, not scheduled: stop`)

    const reproduced = computeContentHash(row.content as never)
    if (reproduced !== row.content_hash) {
      throw new Error(`${utm}: stored content does not reproduce its stored hash. Stop.`)
    }

    const edited = JSON.parse(JSON.stringify(row.content))
    const sets: string[] = []
    const guards: string[] = []
    const unsets: string[] = []
    const applied: string[] = []

    for (const replacement of REPLACEMENTS) {
      if (!replacement.campaigns.includes(utm)) continue
      const hits = walkStrings(edited).filter((s) => s.value.includes(replacement.from))
      if (hits.length === 0) throw new Error(`${utm}: "${replacement.from}" is no longer in the stored copy`)
      for (const hit of hits) {
        const next = hit.value.split(replacement.from).join(replacement.to)
        guards.push(`content #>> ${pathLit(hit.path)} = ${lit(hit.value)}`)
        sets.push([pathLit(hit.path), lit(next)])
        unsets.push([pathLit(hit.path), lit(hit.value)])
        setAtPath(edited, hit.path, next)
        applied.push(`${replacement.id} at ${hit.path.join('.')}`)
      }
    }

    if (NYE.campaigns.includes(utm)) {
      // Find the hours row whose date is Thu 31 Dec, and change that row's hours alone.
      const dateHit = walkStrings(edited).find((s) => s.value === NYE.dateLabel)
      if (!dateHit) throw new Error(`${utm}: no "${NYE.dateLabel}" row in the stored copy`)
      const hoursPath = [...dateHit.path.slice(0, -1), 'hours']
      let node: any = edited
      for (const key of hoursPath.slice(0, -1)) node = node[key]
      const current = node.hours
      if (current !== NYE.fromHours) throw new Error(`${utm}: the New Year's Eve row says "${current}", not "${NYE.fromHours}"`)
      guards.push(`content #>> ${pathLit(dateHit.path)} = ${lit(NYE.dateLabel)}`)
      guards.push(`content #>> ${pathLit(hoursPath)} = ${lit(NYE.fromHours)}`)
      sets.push([pathLit(hoursPath), lit(NYE.toHours)])
      unsets.push([pathLit(hoursPath), lit(NYE.fromHours)])
      setAtPath(edited, hoursPath, NYE.toHours)
      applied.push(`New Year's Eve hours at ${hoursPath.join('.')}`)
    }

    const nextHash = computeContentHash(edited)

    // The subject and preheader columns sit beside the content and the send reads them, so the
    // same replacements run over both. The November preheader carries a fire claim; a first draft
    // changed only the content and the end-state assertion caught it.
    let nextPreheader = row.preheader as string | null
    for (const replacement of REPLACEMENTS) {
      if (!replacement.campaigns.includes(utm) || !nextPreheader) continue
      nextPreheader = nextPreheader.split(replacement.from).join(replacement.to)
    }
    const preheaderChanged = nextPreheader !== row.preheader

    const buildUpdate = (
      pairs: [string, string][],
      hashFrom: string,
      hashTo: string,
      preheaderFrom: string | null,
      preheaderTo: string | null,
      label: string,
    ) => {
      const expr = pairs.reduce((acc, [p, v]) => `jsonb_set(${acc}, ${p}, to_jsonb(${v}::text))`, 'content')
      return [
        `  -- ${row.name}: ${label}`,
        `  update public.marketing_campaigns set`,
        `    content = ${expr},`,
        `    content_hash = ${lit(hashTo)},`,
        ...(preheaderChanged ? [`    preheader = ${lit(preheaderTo ?? '')},`] : []),
        `    updated_at = now()`,
        `  where utm_campaign = ${lit(utm)}`,
        `    and status = 'scheduled'`,
        `    and content_hash = ${lit(hashFrom)}`,
        ...(preheaderChanged ? [`    and preheader = ${lit(preheaderFrom ?? '')}`] : []),
        ...guards.map((g) => `    and ${g}`),
        `  ;`,
        `  if not found then`,
        `    raise exception '% is not in the state this change was reviewed against, so nothing was changed', ${lit(utm)};`,
        `  end if;`,
      ].join('\n')
    }

    forward.push(
      buildUpdate(sets as [string, string][], row.content_hash as string, nextHash, row.preheader as string, nextPreheader, applied.join('; ')),
    )
    // The way back guards on the state the change leaves behind, so it cannot undo a later edit.
    const backGuards = sets.map(([p, v]) => `content #>> ${p} = ${v}`)
    const backUpdate = [
      `  -- ${row.name}: back to the copy of 12 September 2026`,
      `  update public.marketing_campaigns set`,
      `    content = ${(unsets as [string, string][]).reduce((acc, [p, v]) => `jsonb_set(${acc}, ${p}, to_jsonb(${v}::text))`, 'content')},`,
      `    content_hash = ${lit(row.content_hash as string)},`,
      ...(preheaderChanged ? [`    preheader = ${lit((row.preheader as string) ?? '')},`] : []),
      `    updated_at = now()`,
      `  where utm_campaign = ${lit(utm)}`,
      `    and content_hash = ${lit(nextHash)}`,
      ...backGuards.map((g) => `    and ${g}`),
      `  ;`,
      `  if not found then`,
      `    raise exception '% is not on the copy this rollback undoes, so it was left alone', ${lit(utm)};`,
      `  end if;`,
    ].join('\n')
    back.push(backUpdate)

    report.push(`${utm}: ${applied.join('; ')} | hash ${row.content_hash} -> ${nextHash}${preheaderChanged ? ' | preheader column too' : ''}`)
  }

  const header = [
    `-- The owner's answers of 12 September 2026, from the guest email review.`,
    `--`,
    `-- 1. There is no fire anywhere in the pub, so four fire claims come out of the October and`,
    `--    November 2026 round-ups (guests and business). The website SSOT records the ban.`,
    `-- 2. New Year's Eve closes at 1am, so both December round-ups stop telling their list 10pm.`,
    `--    The 31 December special-hours row was corrected to 01:00 on 11 September 2026.`,
    `-- 3. The 3 October Halloween save the date is cancelled: the round-up on 1 October makes the`,
    `--    same ask 48 hours earlier. Cancelled, not deleted, so the record survives.`,
    `-- 4. The minimum gap between guest campaigns goes from 2 days to 4. Unsubscribes ran at 7.1%`,
    `--    on the first campaign and 0.8% to 3.5% since, against a norm well under 0.5%.`,
    `--`,
    `-- Each string is changed at the exact path it sits on, guarded on the value found there now,`,
    `-- on the campaign's reviewed content_hash and on its status, so a campaign anyone has edited`,
    `-- since is left alone and the whole statement raises. Nothing here sends an email or moves a`,
    `-- send time. The new content_hash values were computed from the edited content by`,
    `-- scripts/one-off/generate-campaign-copy-owner-answers-2026-09-12.ts, whose --verify pass`,
    `-- re-reads every row afterwards and reproduces each hash from the stored content.`,
    ``,
  ]

  const tail = [
    ``,
    `  update public.marketing_campaigns set`,
    `    status = 'cancelled',`,
    `    cancelled_at = now(),`,
    `    updated_at = now()`,
    `  where utm_campaign = ${lit(SAVE_THE_DATE)}`,
    `    and status = 'scheduled';`,
    `  if not found then`,
    `    raise exception 'The Halloween save the date was not scheduled, so nothing was cancelled';`,
    `  end if;`,
    ``,
    `  update public.marketing_settings set`,
    `    frequency_cap_days = 4,`,
    `    updated_at = now()`,
    `  where frequency_cap_days = 2;`,
    `  if not found then`,
    `    raise exception 'The frequency cap was not 2 days, so it was left alone';`,
    `  end if;`,
    ``,
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
    `      and content::text not like ${lit(`%${NYE.toHours}%`)}`,
    `  ) then`,
    `    raise exception 'A December round-up does not carry the 1am New Year''s Eve close';`,
    `  end if;`,
  ]

  writeFileSync(
    `${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.sql`,
    [...header, `do $$`, `begin`, ...forward, ...tail, `end $$;`, ``].join('\n'),
  )
  writeFileSync(
    `${OUT_DIR}/campaign-copy-owner-answers-2026-09-12.rollback.sql`,
    [
      `-- Undoes 20260912180000_campaign_copy_owner_answers.sql: the copy, hashes and preheader`,
      `-- columns of 12 September 2026, the save the date back to scheduled, the gap back to 2 days.`,
      `-- Each campaign is guarded on the copy the change left, so a later edit is never reverted.`,
      ``,
      `do $$`,
      `begin`,
      ...back,
      ``,
      `  update public.marketing_campaigns set`,
      `    status = 'scheduled',`,
      `    cancelled_at = null,`,
      `    updated_at = now()`,
      `  where utm_campaign = ${lit(SAVE_THE_DATE)}`,
      `    and status = 'cancelled';`,
      `  if not found then`,
      `    raise exception 'The Halloween save the date was not cancelled, so it was left alone';`,
      `  end if;`,
      ``,
      `  update public.marketing_settings set`,
      `    frequency_cap_days = 2,`,
      `    updated_at = now()`,
      `  where frequency_cap_days = 4;`,
      `  if not found then`,
      `    raise exception 'The frequency cap was not 4 days, so it was left alone';`,
      `  end if;`,
      `end $$;`,
      ``,
    ].join('\n'),
  )

  console.log(report.join('\n'))
  console.log('Nothing was written to the database.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

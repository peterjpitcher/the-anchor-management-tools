/**
 * The second round of scheduled campaign copy fixes from the 11 September email review, and the
 * only one that adds anything: the tasting night the November round-ups leave out.
 *
 * Everything here is either a claim nothing supports, a sentence that reads as something untrue, or
 * a fact that contradicts the event record. Owner-approved on 12 September as part of "fix
 * everything". Read only: it writes a migration and a rollback and changes no data.
 *
 * Each edit is made at the exact path the string sits on and guarded on the value there now, and
 * every edited campaign is run back through the app's own content validation, so a campaign that
 * would be refused at send time fails here instead.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-campaign-copy-round-two-2026-09-12.ts
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-campaign-copy-round-two-2026-09-12.ts --verify
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeContentHash, parseCampaignContent } from '@/services/marketing-campaigns'

const OUT_DIR = process.env.COPY_FIX_OUT_DIR ?? '.'
const VERIFY = process.argv.includes('--verify')

type Edit = { id: string; campaigns: string[]; find: string; replace: string; why: string }

const EDITS: Edit[] = [
  {
    id: 'dec-booked-preheader',
    campaigns: ['december-2026-roundup-guests', 'december-2026-roundup-business'],
    find: 'The lights are up, the festive nights are booked, and everyone is welcome.',
    replace: "The lights are up, three festive nights are in the diary, and everyone's welcome.",
    why: '"the festive nights are booked" reads as sold out.',
  },
  {
    id: 'dec-usual-hours',
    campaigns: ['december-2026-roundup-guests', 'december-2026-roundup-business'],
    find: 'Any date not listed runs our usual hours above. The kitchen is back to normal on Tuesday 12 January.',
    replace:
      'Any date not listed keeps our usual bar hours above, and the kitchen stays closed until Tuesday 12 January.',
    why: 'The old line made the kitchen look open from 2 to 10 January, when it is closed.',
  },
  {
    id: 'nov-snowball-figure',
    campaigns: ['snowball-showdown-cash-bingo-2026-11-18'],
    find:
      'The Game 9 Snowball is projected at £180 for a full house within 58 numbers. That projection depends on it staying unclaimed at the earlier Cash Bingo nights, and if it is won the amount and the number target are updated before this one.',
    replace:
      'The Game 9 Snowball grows by £20 and two numbers every night nobody wins it, so ask at the bar for the night’s prize.',
    why: 'The stored copy freezes at approval, so a figure decided by an earlier night cannot be right on the day.',
  },
  {
    id: 'dec-snowball-figure',
    campaigns: ['christmas-jackpot-cash-bingo-2026-12-16'],
    find:
      'The Game 9 Snowball is projected at £200 for a full house within 60 numbers. That projection depends on it staying unclaimed at the earlier Cash Bingo nights, and if it is won the amount and the number target are updated before this one.',
    replace:
      'The Game 9 Snowball grows by £20 and two numbers every night nobody wins it, so ask at the bar for the night’s prize.',
    why: 'Two cash bingo nights fall between approval and this send, and the stored copy cannot update.',
  },
  {
    id: 'dec-snowball-played-at',
    campaigns: ['christmas-jackpot-cash-bingo-2026-12-16', 'snowball-showdown-cash-bingo-2026-11-18'],
    find: 'you need to have attended one of the previous three Cash Bingo nights',
    replace: 'you need to have played at one of the previous three Cash Bingo nights',
    why: 'SSOT section 10 says played at, not attended.',
  },
  {
    id: 'sep-snowball-figure',
    campaigns: ['autumn-jackpot-cash-bingo-2026-guests'],
    find:
      'The poster shows a projected £160 Snowball for a full house within 56 numbers. This depends on it remaining unclaimed at earlier Cash Bingo nights.',
    replace:
      'Game 9 is the Snowball, and it grows every night nobody wins it, so ask at the bar for the night’s prize.',
    why: 'Images are usually blocked, so the copy hung a figure on a poster the reader cannot see.',
  },
  {
    id: 'snowball-played-at',
    campaigns: [
      'autumn-jackpot-cash-bingo-2026-guests',
      'snowball-showdown-cash-bingo-2026-11-18',
      'christmas-jackpot-cash-bingo-2026-12-16',
    ],
    find: 'you must have attended at least one of the previous three Cash Bingo nights',
    replace: 'you need to have played at one of the previous three Cash Bingo nights',
    why: 'SSOT section 10 says played at, not attended: watching does not qualify.',
  },
  {
    id: 'dabbers-cash-only',
    campaigns: ['snowball-showdown-cash-bingo-2026-11-18', 'christmas-jackpot-cash-bingo-2026-12-16'],
    find: 'Dabbers are available to buy at the bar.',
    replace: 'Dabbers are £1, cash only, from the bar.',
    why: 'SSOT section 10: £1 and cash only, which the guest needs to know before arriving.',
  },
  {
    id: 'dabbers-cash-only-sep',
    campaigns: ['autumn-jackpot-cash-bingo-2026-guests'],
    find: 'Dabbers are available for £1 cash.',
    replace: 'Dabbers are £1, cash only, from the bar.',
    why: 'Same wording on every cash bingo email.',
  },
  {
    id: 'oct-preheader-count',
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
    find: 'Dark evenings, three brilliant nights out, and Halloween done properly.',
    replace: 'Dark evenings, a spooky quiz, horror music bingo and Halloween done properly.',
    why: 'Halloween is one of the three, so the old line reads as four nights.',
  },
  {
    id: 'oct-singalong',
    campaigns: ['october-2026-roundup-guests', 'october-2026-roundup-business'],
    find: 'a horror singalong',
    replace: 'horror soundtrack bingo',
    why: 'It is music bingo, not a singalong.',
  },
  {
    id: 'business-filling-fast',
    campaigns: ['christmas-local-business-food-offer-2026-10-01', 'christmas-local-business-food-offer-2026-10-26'],
    find: 'Our festive diary is filling fast.',
    replace: 'The sooner you tell us your date, the more choice you will have.',
    why: 'Nothing supports the scarcity claim (SSOT section 1, rule 5).',
  },
  // "Come early for dinner, served from 4pm to 9pm" is deliberately left alone. The review
  // flagged it as hours typed into copy, but 4pm to 9pm is the dinner sitting the round-ups'
  // own hours tables render from the app's schedule, so the sentence is accurate, and ten
  // scheduled campaigns carry the same figures. Churning them all for a style point would risk
  // more than it fixes.
  {
    id: 'contraction-seat-you',
    campaigns: [],
    find: 'and we will seat you together',
    replace: "and we'll seat you together",
    why: 'SSOT section 1: use contractions.',
  },
  {
    id: 'contraction-see-whats-on',
    campaigns: [],
    find: 'See what is on',
    replace: "See what's on",
    why: 'SSOT section 1: use contractions.',
  },
  {
    id: 'contraction-let-us-know',
    campaigns: [],
    find: 'Let us know you are coming',
    replace: "Let us know you're coming",
    why: 'SSOT section 1: use contractions.',
  },
]

/** The tasting night, from its event record. The only event with no email of its own. */
const TASTING_NIGHT = {
  date: 'Fri 20 Nov',
  name: 'Tinsel & Tipples Christmas Tasting Night',
  detail: 'Expert-led festive tasting, £45 a person, or £5 less booked online. Just 25 places.',
  image: {
    src: 'https://tfcasgxopxegwrabvwat.supabase.co/storage/v1/object/public/event-images/events/5bd854ce-48e7-4ca8-8e7c-c52cc7ec1e65/square/branded/1789049534326-square.png',
    alt: 'A fun Tasting Night at The Anchor featuring festive drinks and food.',
    width: 180,
    height: 180,
  },
  cta_label: 'Book your place →',
  url: 'https://www.the-anchor.pub/events/christmas-night-out-tasting-night-2026-11-20',
}

const NOVEMBER = ['november-2026-roundup-guests', 'november-2026-roundup-business']

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const pathLit = (path: (string | number)[]) => lit(`{${path.join(',')}}`)

function walkStrings(node: unknown, path: (string | number)[] = []): { path: (string | number)[]; value: string }[] {
  if (typeof node === 'string') return [{ path, value: node }]
  if (Array.isArray(node)) return node.flatMap((child, i) => walkStrings(child, [...path, i]))
  if (node && typeof node === 'object') {
    return Object.entries(node as Record<string, unknown>).flatMap(([k, c]) => walkStrings(c, [...path, k]))
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
    .select('id, name, utm_campaign, status, subject, preheader, content, content_hash')
    .eq('status', 'scheduled')

  if (error) throw new Error(`Could not read the campaigns: ${error.message}`)
  if (!rows?.length) throw new Error('No scheduled campaigns')

  if (VERIFY) {
    let problems = 0
    for (const row of rows) {
      const text = JSON.stringify(row.content)
      const hashOk = computeContentHash(row.content as never) === row.content_hash
      const stale = EDITS.filter((e) => text.includes(e.find)).map((e) => e.id)
      if (!hashOk || stale.length) problems += 1
      if (!hashOk || stale.length) console.log(`${row.utm_campaign}: ${hashOk ? '' : 'HASH MISMATCH '}${stale.length ? `still says: ${stale.join(', ')}` : ''}`)
    }
    const nov = rows.filter((r) => NOVEMBER.includes(r.utm_campaign!))
    for (const row of nov) {
      const has = JSON.stringify(row.content).includes(TASTING_NIGHT.name)
      const heading = JSON.stringify(row.content).includes('Four nights in November')
      if (!has || !heading) problems += 1
      console.log(`${row.utm_campaign}: tasting night ${has ? 'listed' : 'MISSING'}, heading ${heading ? 'says four' : 'NOT UPDATED'}`)
    }
    console.log(problems === 0 ? 'ALL CHECKS PASS' : `${problems} CHECK(S) FAILED`)
    process.exit(problems === 0 ? 0 : 1)
  }

  if (process.argv.includes('--fixture')) {
    // A throwaway-database copy of exactly what production holds now, so the migration is replayed
    // against the real copy rather than a hand-written approximation.
    const stmts = [
      'create table public.marketing_campaigns (',
      '  id uuid primary key, name text not null, utm_campaign text, status text not null,',
      '  scheduled_for timestamptz, locked_at timestamptz, cancelled_at timestamptz, subject text,',
      '  preheader text, content jsonb, content_hash text, updated_at timestamptz',
      ');',
      'create table public.marketing_settings (id uuid primary key, frequency_cap_days integer not null, updated_at timestamptz);',
      `insert into public.marketing_settings values ('00000000-0000-0000-0000-000000000001', 4, now());`,
    ]
    for (const row of rows) {
      stmts.push(
        `insert into public.marketing_campaigns (id, name, utm_campaign, status, scheduled_for, locked_at, subject, preheader, content, content_hash, updated_at) values (`,
        `  ${lit(row.id as string)}, ${lit(row.name as string)}, ${lit(row.utm_campaign as string)}, 'scheduled', now(), now(), ${lit((row.subject as string) ?? '')}, ${lit((row.preheader as string) ?? '')},`,
        `  ${lit(JSON.stringify(row.content))}::jsonb, ${lit(row.content_hash as string)}, now());`,
      )
    }
    writeFileSync(`${OUT_DIR}/fixture-round-two.sql`, stmts.join('\n') + '\n')
    console.log(`fixture written with ${rows.length} scheduled campaigns`)
    return
  }

  const forward: string[] = []
  const back: string[] = []
  const report: string[] = []

  for (const row of rows) {
    const utm = row.utm_campaign!
    if (computeContentHash(row.content as never) !== row.content_hash) {
      throw new Error(`${utm}: stored content does not reproduce its stored hash. Stop.`)
    }

    const edited = JSON.parse(JSON.stringify(row.content))
    const sets: [string, string][] = []
    const unsets: [string, string][] = []
    const guards: string[] = []
    const applied: string[] = []

    for (const edit of EDITS) {
      const applies = edit.campaigns.length === 0 || edit.campaigns.includes(utm)
      if (!applies) continue
      for (const hit of walkStrings(edited).filter((s) => s.value.includes(edit.find))) {
        const next = hit.value.split(edit.find).join(edit.replace)
        guards.push(`content #>> ${pathLit(hit.path)} = ${lit(hit.value)}`)
        sets.push([pathLit(hit.path), lit(next)])
        unsets.push([pathLit(hit.path), lit(hit.value)])
        setAtPath(edited, hit.path, next)
        applied.push(`${edit.id} at ${hit.path.join('.')}`)
      }
    }

    // The tasting night: appended to the November list, in date order, and the heading counts up.
    let insert: { path: (string | number)[]; length: number } | null = null
    if (NOVEMBER.includes(utm)) {
      const blockIndex = (edited.blocks as any[]).findIndex((b) => b.type === 'whats_on_media')
      if (blockIndex < 0) throw new Error(`${utm}: no whats_on_media block to add the tasting night to`)
      const events = edited.blocks[blockIndex].data.events as any[]
      if (events.some((e) => e.name === TASTING_NIGHT.name)) throw new Error(`${utm}: the tasting night is already listed`)
      const path = ['blocks', blockIndex, 'data', 'events', events.length]
      insert = { path, length: events.length }
      events.push(TASTING_NIGHT)

      const heading = walkStrings(edited).find((s) => s.value === 'Three nights in November')
      if (!heading) throw new Error(`${utm}: expected the heading "Three nights in November"`)
      guards.push(`content #>> ${pathLit(heading.path)} = ${lit(heading.value)}`)
      sets.push([pathLit(heading.path), lit('Four nights in November')])
      unsets.push([pathLit(heading.path), lit(heading.value)])
      setAtPath(edited, heading.path, 'Four nights in November')
      applied.push(`tasting night added, heading counts four`)

      for (const hit of walkStrings(edited).filter((s) => s.value.includes('three cracking nights out'))) {
        const next = hit.value.split('three cracking nights out').join('four cracking nights out')
        guards.push(`content #>> ${pathLit(hit.path)} = ${lit(hit.value)}`)
        sets.push([pathLit(hit.path), lit(next)])
        unsets.push([pathLit(hit.path), lit(hit.value)])
        setAtPath(edited, hit.path, next)
        applied.push(`preheader counts four at ${hit.path.join('.')}`)
      }
    }

    if (!applied.length) continue

    // The app's own validation, so nothing here could be refused at send time.
    parseCampaignContent(edited)

    const nextHash = computeContentHash(edited)

    let nextPreheader = row.preheader as string | null
    for (const edit of EDITS) {
      const applies = edit.campaigns.length === 0 || edit.campaigns.includes(utm)
      if (applies && nextPreheader) nextPreheader = nextPreheader.split(edit.find).join(edit.replace)
    }
    if (NOVEMBER.includes(utm) && nextPreheader) {
      nextPreheader = nextPreheader.split('three cracking nights out').join('four cracking nights out')
    }
    const preheaderChanged = nextPreheader !== row.preheader

    const expr = sets.reduce((acc, [p, v]) => `jsonb_set(${acc}, ${p}, to_jsonb(${v}::text))`, 'content')
    const withInsert = insert
      ? `jsonb_insert(${expr}, ${pathLit(insert.path)}, ${lit(JSON.stringify(TASTING_NIGHT))}::jsonb)`
      : expr

    forward.push(
      [
        `  -- ${row.name}: ${applied.join('; ')}`,
        `  update public.marketing_campaigns set`,
        `    content = ${withInsert},`,
        `    content_hash = ${lit(nextHash)},`,
        ...(preheaderChanged ? [`    preheader = ${lit(nextPreheader ?? '')},`] : []),
        `    updated_at = now()`,
        `  where utm_campaign = ${lit(utm)}`,
        `    and status = 'scheduled'`,
        `    and content_hash = ${lit(row.content_hash as string)}`,
        ...(insert ? [`    and jsonb_array_length(content #> ${pathLit(insert.path.slice(0, -1))}) = ${insert.length}`] : []),
        ...guards.map((g) => `    and ${g}`),
        `  ;`,
        `  if not found then`,
        `    raise exception '% is not in the state this change was reviewed against, so nothing was changed', ${lit(utm)};`,
        `  end if;`,
      ].join('\n'),
    )

    const backExpr = unsets.reduce((acc, [p, v]) => `jsonb_set(${acc}, ${p}, to_jsonb(${v}::text))`, 'content')
    back.push(
      [
        `  -- ${row.name}: back to the copy of 12 September 2026`,
        `  update public.marketing_campaigns set`,
        `    content = ${insert ? `(${backExpr}) #- ${pathLit(insert.path)}` : backExpr},`,
        `    content_hash = ${lit(row.content_hash as string)},`,
        ...(preheaderChanged ? [`    preheader = ${lit((row.preheader as string) ?? '')},`] : []),
        `    updated_at = now()`,
        `  where utm_campaign = ${lit(utm)}`,
        `    and content_hash = ${lit(nextHash)}`,
        `  ;`,
        `  if not found then`,
        `    raise exception '% is not on the copy this rollback undoes, so it was left alone', ${lit(utm)};`,
        `  end if;`,
      ].join('\n'),
    )

    report.push(`${utm}: ${applied.join('; ')} | hash ${row.content_hash} -> ${nextHash}${preheaderChanged ? ' | preheader column too' : ''}`)
  }

  const head = [
    `-- Round two of the scheduled campaign copy fixes from the guest email review.`,
    `-- Owner-approved 12 September 2026. Each string is changed at the path it sits on, guarded on`,
    `-- the value there now and on the campaign's content_hash, and every edited campaign was run`,
    `-- back through parseCampaignContent, so none can be refused at send time.`,
    `--`,
    ...EDITS.map((e) => `-- ${e.id}: ${e.why}`),
    `-- tasting-night: the 20 November tasting night, the only event with no email, is added to the`,
    `--   November round-ups from its own event record, and the heading and preview line count four.`,
    ``,
    `do $$`,
    `begin`,
  ]

  writeFileSync(`${OUT_DIR}/campaign-copy-round-two-2026-09-12.sql`, [...head, ...forward, `end $$;`, ``].join('\n'))
  writeFileSync(
    `${OUT_DIR}/campaign-copy-round-two-2026-09-12.rollback.sql`,
    [`-- Undoes the round-two campaign copy fixes of 12 September 2026.`, ``, `do $$`, `begin`, ...back, `end $$;`, ``].join('\n'),
  )

  console.log(report.join('\n'))
  console.log(`\nCampaigns changed: ${report.length}. Nothing was written to the database.`)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

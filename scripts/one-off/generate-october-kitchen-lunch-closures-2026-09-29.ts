/**
 * Generates the guarded SQL for the October 2026 kitchen lunch closures, and changes nothing.
 *
 * The owner asked on 29 September 2026 for the kitchen to close 12pm to 3pm on Tuesday 20,
 * Friday 23, Tuesday 27 and Friday 30 October, with dinner 4pm to 9pm going ahead as normal on
 * each of those days. The bar is not affected. Two things change together, in one statement, so
 * the email can never claim hours the booking system does not hold:
 *
 * 1. Four `special_hours` rows: bar 12pm to 10pm (today's regular Tuesday and Friday hours, and
 *    the SQL refuses to run if those have moved), kitchen 4pm to 9pm, one Dinner service.
 *    Exactly what the settings screen would save, followed by the slot regeneration it runs.
 * 2. Both scheduled "Welcome to October" round-ups (guests and businesses, 1 October 09:00)
 *    list the four dates in their "dates that differ" block, which today names Halloween alone
 *    and says it is the only different date. Marketing sends the copy stored on the row, and
 *    only drafts are editable in the app, so this follows the pattern of
 *    20260912175751_campaign_copy_owner_answers.sql: one `jsonb_set` at the block's exact path,
 *    guarded on the block's current value, the campaign's content_hash and its status, with the
 *    new content_hash computed here from the edited content.
 *
 * Every edited email is validated against the block registry, rendered to HTML and plain text,
 * and run through the brand rules and the closure-claim guard before any SQL is written.
 *
 * Read only. Applying is a separate step.
 *
 * Usage:
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-october-kitchen-lunch-closures-2026-09-29.ts
 *   npx tsx --tsconfig tsconfig.json scripts/one-off/generate-october-kitchen-lunch-closures-2026-09-29.ts --verify
 */
import { config } from 'dotenv'

config({ path: '.env.local' })

import { writeFileSync } from 'fs'
import { houseStyleErrors, checkHouseStyle } from '@/lib/copy/house-style'
import { lintMarketingContent, validateMarketingContent } from '@/lib/email/marketing/registry'
import { renderCampaignHtml, renderCampaignText } from '@/lib/email/marketing/render'
import { findVenueClosureClaims } from '@/lib/email/marketing/venueClosureClaims'
import { createAdminClient } from '@/lib/supabase/admin'
import { computeContentHash, parseCampaignContent } from '@/services/marketing-campaigns'

/** Drafted under this label; applied to production as 20260929120715_october_kitchen_lunch_closures. */
const MIGRATION = '20260929130207_october_kitchen_lunch_closures'
const PREVIEW_DIR = process.env.COPY_FIX_OUT_DIR ?? '.'
const VERIFY = process.argv.includes('--verify')

const UTMS = ['october-2026-roundup-guests', 'october-2026-roundup-business']

/** Weekdays checked on 29 September 2026: 20 and 27 are Tuesdays, 23 and 30 are Fridays. */
const CLOSURES = [
  { date: '2026-10-20', label: 'Tue 20 Oct' },
  { date: '2026-10-23', label: 'Fri 23 Oct' },
  { date: '2026-10-27', label: 'Tue 27 Oct' },
  { date: '2026-10-30', label: 'Fri 30 Oct' },
]

const SPECIAL_HOURS = {
  opens: '12:00',
  closes: '22:00',
  kitchen_opens: '16:00',
  kitchen_closes: '21:00',
  note: 'Kitchen closed for lunch. Bar open 12pm to 10pm as usual, food 4pm to 9pm.',
  schedule_config: [{ name: 'Dinner', ends_at: '21:00', capacity: 50, starts_at: '16:00', booking_type: 'regular' }],
}

/** The block as it stands on both campaigns now. The SQL refuses to touch anything else. */
const HALLOWEEN_ROW = {
  date: 'Sat 31 Oct',
  note: 'Full menu 12pm to 6pm, kitchen shut 6pm to 9pm, then pizza only',
  hours: '12pm to midnight',
}
const CURRENT_BLOCK = {
  rows: [HALLOWEEN_ROW],
  heading: 'One date is different',
  footnote:
    'Halloween is the only date in October that differs from the week above. Pizza from 9pm is available to eat in or to take away.',
}

const NEXT_BLOCK = {
  rows: [
    ...CLOSURES.map((c) => ({
      date: c.label,
      hours: '12pm to 10pm',
      note: 'Kitchen closed for lunch, dinner 4pm to 9pm as usual',
    })),
    HALLOWEEN_ROW,
  ],
  heading: 'Five dates are different',
  footnote:
    'The bar opens at 12pm as normal on those four days, and food starts at 4pm. On Halloween, pizza from 9pm is available to eat in or to take away.',
}

/**
 * The business round-up's stored hash is stale, and this is the whole reason.
 *
 * scripts/one-off/event-voice-pass-2026-09-12.ts rewrote the business consent footer on 12
 * September 2026 and updated `content` alone, so the stored hash is still the one taken over the
 * old footer. The generator proves that is the ONLY difference (put the old footer back and the
 * stored hash reproduces) before it accepts the row; anything else stops it. The update then
 * writes a hash taken over the full current content, which puts the fingerprint right again.
 */
const STALE_FOOTER = {
  utm: 'october-2026-roundup-business',
  now: 'You’re getting this because you enquired about a booking or an event, said we could get in touch, or are just down the road. We thought it would be useful. It may have been a while ago now, and it’s good to still be in touch.',
  before:
    'You are receiving this because you enquired about a booking or an event with us, because you said we could get in touch, or because you are just down the road and we thought this would be useful. It may have been a while ago now, and it is good to still be in touch.',
}

/** True when the stored hash reproduces, or is stale for the known footer reason only. */
function storedHashExplained(utm: string, content: unknown, storedHash: string): 'reproduces' | 'stale-footer' | false {
  if (computeContentHash(content as never) === storedHash) return 'reproduces'
  if (utm !== STALE_FOOTER.utm) return false
  const probe = JSON.parse(JSON.stringify(content)) as { blocks: { type: string; data: Record<string, unknown> }[] }
  const footer = probe.blocks.find((b) => b.type === 'footer')
  if (!footer || footer.data.reason_for_contact !== STALE_FOOTER.now) return false
  footer.data.reason_for_contact = STALE_FOOTER.before
  return computeContentHash(probe as never) === storedHash ? 'stale-footer' : false
}

const lit = (v: string) => `'${v.replace(/'/g, "''")}'`
const jsonLit = (v: unknown) => `${lit(JSON.stringify(v))}::jsonb`

/** Deep equality through a canonical key order, the same way the content hash sees data. */
function sameJson(a: unknown, b: unknown): boolean {
  const canon = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(canon)
    if (v && typeof v === 'object') {
      const src = v as Record<string, unknown>
      return Object.fromEntries(Object.keys(src).sort().map((k) => [k, canon(src[k])]))
    }
    return v
  }
  return JSON.stringify(canon(a)) === JSON.stringify(canon(b))
}

function blockIndex(content: { blocks: { type: string }[] }): number {
  const indexes = content.blocks.flatMap((b, i) => (b.type === 'opening_hours_dates' ? [i] : []))
  if (indexes.length !== 1) throw new Error(`Expected one opening_hours_dates block, found ${indexes.length}`)
  return indexes[0]
}

async function verify(db: ReturnType<typeof createAdminClient>): Promise<void> {
  let problems = 0

  const { data: rows, error } = await db
    .from('marketing_campaigns')
    .select('utm_campaign, status, content, content_hash')
    .in('utm_campaign', UTMS)
  if (error || !rows) throw new Error(`Could not read the campaigns: ${error?.message}`)

  for (const row of rows) {
    const hashOk = computeContentHash(row.content as never) === row.content_hash
    const content = row.content as { blocks: { type: string; data: unknown }[] }
    const blockOk = sameJson(content.blocks[blockIndex(content)].data, NEXT_BLOCK)
    if (!hashOk || !blockOk || row.status !== 'scheduled') problems += 1
    console.log(
      `${row.utm_campaign}: ${row.status}, hash ${hashOk ? 'reproduces' : 'MISMATCH'}, dates block ${blockOk ? 'as approved' : 'WRONG'}`,
    )
  }

  const { data: hours, error: hoursError } = await db
    .from('special_hours')
    .select('date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, note, schedule_config')
    .in('date', CLOSURES.map((c) => c.date))
    .order('date')
  if (hoursError) throw new Error(`Could not read special hours: ${hoursError.message}`)

  for (const c of CLOSURES) {
    const h = (hours ?? []).find((r) => r.date === c.date)
    const ok =
      !!h &&
      h.opens === '12:00:00' &&
      h.closes === '22:00:00' &&
      h.kitchen_opens === '16:00:00' &&
      h.kitchen_closes === '21:00:00' &&
      h.is_closed === false &&
      h.is_kitchen_closed === false &&
      h.note === SPECIAL_HOURS.note &&
      sameJson(h.schedule_config, SPECIAL_HOURS.schedule_config)
    if (!ok) problems += 1
    console.log(`special hours ${c.date}: ${ok ? 'as approved' : `WRONG (${JSON.stringify(h)})`}`)
  }

  console.log(problems === 0 ? 'ALL CHECKS PASS' : `${problems} CHECK(S) FAILED`)
  process.exit(problems === 0 ? 0 : 1)
}

async function main(): Promise<void> {
  const db = createAdminClient()
  if (VERIFY) return verify(db)

  // The special-hours note is shown to guests on the website, so it gets the brand rules too.
  const noteErrors = houseStyleErrors(SPECIAL_HOURS.note)
  if (noteErrors.length > 0) throw new Error(`Special hours note breaks a brand rule: ${noteErrors[0].message}`)

  const { data: rows, error } = await db
    .from('marketing_campaigns')
    .select('id, name, utm_campaign, status, scheduled_for, content, content_hash')
    .in('utm_campaign', UTMS)
  if (error) throw new Error(`Could not read the campaigns: ${error.message}`)
  if (!rows || rows.length !== UTMS.length) throw new Error(`Expected ${UTMS.length} campaigns, read ${rows?.length ?? 0}`)

  const forward: string[] = []
  const back: string[] = []

  for (const utm of UTMS) {
    const row = rows.find((r) => r.utm_campaign === utm)!
    if (row.status !== 'scheduled') throw new Error(`${utm} is ${row.status}, not scheduled: stop`)
    const hashState = storedHashExplained(utm, row.content, row.content_hash as string)
    if (!hashState) {
      throw new Error(`${utm}: stored content does not reproduce its stored hash. Stop.`)
    }

    const content = row.content as { blocks: { type: string; data: unknown }[] }
    const index = blockIndex(content)
    if (!sameJson(content.blocks[index].data, CURRENT_BLOCK)) {
      throw new Error(`${utm}: the dates block is not the copy this change was written against`)
    }

    const edited = JSON.parse(JSON.stringify(row.content))
    edited.blocks[index].data = NEXT_BLOCK

    // The same checks the app runs on save and at schedule time, plus a render of both parts.
    const parsed = parseCampaignContent(edited)
    const issues = validateMarketingContent(parsed)
    if (issues.length > 0) throw new Error(`${utm}: ${issues.map((i) => i.message).join('; ')}`)
    const html = renderCampaignHtml(parsed)
    const text = renderCampaignText(parsed)
    for (const bad of ['undefined', 'Invalid Date', 'NaN']) {
      if (html.includes(bad) || text.includes(bad)) throw new Error(`${utm}: rendered email contains "${bad}"`)
    }
    for (const c of CLOSURES) {
      if (!html.includes(c.label) || !text.includes(c.label)) throw new Error(`${utm}: ${c.label} missing from the render`)
    }
    const banned = houseStyleErrors(text)
    if (banned.length > 0) throw new Error(`${utm}: banned claim "${banned[0].matched}": ${banned[0].message}`)
    const closure = findVenueClosureClaims(text, new Set([0, 1, 2, 3, 4, 5, 6]))
    if (closure.length > 0) throw new Error(`${utm}: closure claim: ${closure[0].message}`)
    const lint = lintMarketingContent(parsed)
    // One call per string: joined together they read as one run-on sentence and trip the length rule.
    const voice = [NEXT_BLOCK.heading, NEXT_BLOCK.footnote, ...NEXT_BLOCK.rows.map((r) => r.note ?? '')].flatMap((s) =>
      checkHouseStyle(s),
    )

    writeFileSync(`${PREVIEW_DIR}/${utm}.html`, html)
    writeFileSync(`${PREVIEW_DIR}/${utm}.txt`, text)

    const nextHash = computeContentHash(edited)
    const path = lit(`{blocks,${index},data}`)
    const typePath = lit(`{blocks,${index},type}`)

    forward.push(
      [
        `  -- ${row.name}: dates block at blocks.${index}`,
        ...(hashState === 'stale-footer'
          ? [
              `  -- Its stored hash predates the 12 September consent-footer rewrite, which changed content`,
              `  -- only; the new hash is taken over the full current content, so it is correct again.`,
            ]
          : []),
        `  update public.marketing_campaigns set`,
        `    content = jsonb_set(content, ${path}, ${jsonLit(NEXT_BLOCK)}),`,
        `    content_hash = ${lit(nextHash)},`,
        `    updated_at = now()`,
        `  where utm_campaign = ${lit(utm)}`,
        `    and status = 'scheduled'`,
        `    and content_hash = ${lit(row.content_hash as string)}`,
        `    and content #>> ${typePath} = 'opening_hours_dates'`,
        `    and content #> ${path} = ${jsonLit(CURRENT_BLOCK)};`,
        `  if not found then`,
        `    raise exception '% is not in the state this change was reviewed against, so nothing was changed', ${lit(utm)};`,
        `  end if;`,
        `  insert into public.audit_logs (user_id, operation_type, resource_type, resource_id, operation_status, old_values, new_values, additional_info)`,
        `  values (null, 'update', 'marketing_campaign', ${lit(row.id as string)}, 'success',`,
        `    jsonb_build_object('content_hash', ${lit(row.content_hash as string)}),`,
        `    jsonb_build_object('content_hash', ${lit(nextHash)}),`,
        `    jsonb_build_object('migration', ${lit(MIGRATION)}, 'reason', 'October 2026 kitchen lunch closures added to the dates block'));`,
      ].join('\n'),
    )

    back.push(
      [
        `  -- ${row.name}: back to the Halloween-only dates block`,
        `  update public.marketing_campaigns set`,
        `    content = jsonb_set(content, ${path}, ${jsonLit(CURRENT_BLOCK)}),`,
        `    content_hash = ${lit(row.content_hash as string)},`,
        `    updated_at = now()`,
        `  where utm_campaign = ${lit(utm)}`,
        `    and status = 'scheduled'`,
        `    and content_hash = ${lit(nextHash)}`,
        `    and content #> ${path} = ${jsonLit(NEXT_BLOCK)};`,
        `  if not found then`,
        `    raise exception '% is not on the copy this rollback undoes, so it was left alone', ${lit(utm)};`,
        `  end if;`,
      ].join('\n'),
    )

    console.log(`${utm}: blocks.${index} | hash ${row.content_hash} -> ${nextHash}`)
    console.log(`  rendered ${html.length} bytes html, ${text.length} bytes text; lint ${lint.length === 0 ? 'clean' : lint.join(' | ')}`)
    console.log(`  voice ${voice.length === 0 ? 'clean' : voice.map((v) => `${v.severity}: ${v.message}`).join(' | ')}`)
  }

  const dateList = CLOSURES.map((c) => `${lit(c.date)}::date`).join(', ')
  const hoursRows = CLOSURES.map(
    (c) =>
      `    (${lit(c.date)}, ${lit(SPECIAL_HOURS.opens)}, ${lit(SPECIAL_HOURS.closes)}, ${lit(SPECIAL_HOURS.kitchen_opens)}, ` +
      `${lit(SPECIAL_HOURS.kitchen_closes)}, false, false, ${lit(SPECIAL_HOURS.note)}, ${jsonLit(SPECIAL_HOURS.schedule_config)})`,
  ).join(',\n')

  const sql = [
    `-- October 2026 kitchen lunch closures, requested by the owner on 29 September 2026.`,
    `--`,
    `-- The kitchen is closed 12pm to 3pm on Tue 20, Fri 23, Tue 27 and Fri 30 October 2026. Dinner`,
    `-- runs 4pm to 9pm as normal on each of those days and the bar keeps its regular 12pm to 10pm.`,
    `-- No table bookings, private bookings or events existed on any of the four dates when this`,
    `-- was written, so nobody holds a lunch booking that this refuses.`,
    `--`,
    `-- 1. Four special_hours rows, exactly as the settings screen would save them, then the legacy`,
    `--    slot regeneration that screen runs. Refuses to run if any of the dates already has a`,
    `--    special_hours row, or if the regular hours for those dates are no longer 12pm to 10pm`,
    `--    with the kitchen 12pm to 9pm, because the bar hours below were copied from them.`,
    `-- 2. Both scheduled "Welcome to October" round-ups (1 October 2026, 09:00 London) get the four`,
    `--    dates in their dates block, which named Halloween alone and called it the only date that`,
    `--    differs. Guarded on the block's current value, the reviewed content_hash and the status,`,
    `--    so a campaign anyone has edited since is left alone and the whole statement raises. The`,
    `--    new content_hash values were computed from the edited content by`,
    `--    scripts/one-off/generate-october-kitchen-lunch-closures-2026-09-29.ts, whose --verify`,
    `--    pass reproduces each hash from the stored content afterwards.`,
    `--`,
    `-- Nothing here sends an email or moves a send time. Rollback: supabase/rollbacks/${MIGRATION}.sql`,
    ``,
    `do $$`,
    `declare`,
    `  v_slots jsonb;`,
    `begin`,
    `  if exists (select 1 from public.special_hours where date in (${dateList})) then`,
    `    raise exception 'A special_hours row already exists for one of the October closure dates, so nothing was changed';`,
    `  end if;`,
    ``,
    `  if exists (`,
    `    select 1`,
    `    from unnest(array[${dateList}]) as d(day)`,
    `    where not exists (`,
    `      select 1 from public.business_hours_for_date(d.day) bh`,
    `      where bh.opens = '12:00' and bh.closes = '22:00'`,
    `        and bh.kitchen_opens = '12:00' and bh.kitchen_closes = '21:00'`,
    `        and not coalesce(bh.is_closed, false) and not coalesce(bh.is_kitchen_closed, false)`,
    `    )`,
    `  ) then`,
    `    raise exception 'The regular hours for an October closure date are no longer the ones this was written against';`,
    `  end if;`,
    ``,
    `  insert into public.special_hours (date, opens, closes, kitchen_opens, kitchen_closes, is_closed, is_kitchen_closed, note, schedule_config)`,
    `  values`,
    `${hoursRows};`,
    ``,
    `  insert into public.audit_logs (user_id, operation_type, resource_type, resource_id, operation_status, new_values, additional_info)`,
    `  values (null, 'create', 'settings', 'special_hours', 'success',`,
    `    jsonb_build_object('created_dates', jsonb_build_array(${CLOSURES.map((c) => lit(c.date)).join(', ')})),`,
    `    jsonb_build_object('migration', ${lit(MIGRATION)}, 'reason', 'Kitchen closed 12pm to 3pm, dinner 4pm to 9pm as normal'));`,
    ``,
    `  -- The settings screen runs this after every hours write and treats a failure as non-fatal;`,
    `  -- service_slots is legacy and not used to validate bookings.`,
    `  begin`,
    `    v_slots := public.auto_generate_weekly_slots();`,
    `  exception when others then`,
    `    raise warning 'auto_generate_weekly_slots failed (non-fatal): %', sqlerrm;`,
    `  end;`,
    ``,
    ...forward,
    ``,
    `  if exists (`,
    `    select 1 from public.marketing_campaigns`,
    `    where status = 'scheduled' and utm_campaign in (${UTMS.map(lit).join(', ')})`,
    `      and (content::text like '%only date in October%' or content::text not like '%Tue 20 Oct%' or content::text not like '%Fri 30 Oct%')`,
    `  ) then`,
    `    raise exception 'An October round-up does not carry the lunch closures';`,
    `  end if;`,
    `end $$;`,
    ``,
  ].join('\n')

  const rollback = [
    `-- Rollback for ${MIGRATION}.sql.`,
    `-- Removes the four special_hours rows only if they are still exactly as that migration left`,
    `-- them, and puts both October round-ups back to the Halloween-only dates block, guarded on the`,
    `-- copy the change left, so a later edit is never reverted. Do not run after 1 October 2026`,
    `-- 09:00 London: the round-ups will have sent and the email half no longer matters.`,
    ``,
    `do $$`,
    `begin`,
    `  delete from public.special_hours`,
    `  where date in (${dateList})`,
    `    and opens = '12:00' and closes = '22:00' and kitchen_opens = '16:00' and kitchen_closes = '21:00'`,
    `    and note = ${lit(SPECIAL_HOURS.note)};`,
    `  if (select count(*) from public.special_hours where date in (${dateList})) > 0 then`,
    `    raise exception 'A closure date has been edited since the migration, so the hours were left alone';`,
    `  end if;`,
    ``,
    ...back,
    `end $$;`,
    ``,
  ].join('\n')

  writeFileSync(`supabase/migrations/${MIGRATION}.sql`, sql)
  writeFileSync(`supabase/rollbacks/${MIGRATION}.sql`, rollback)
  console.log(`Wrote supabase/migrations/${MIGRATION}.sql and supabase/rollbacks/${MIGRATION}.sql`)
  console.log(`Previews in ${PREVIEW_DIR}`)
  console.log('Nothing was written to the database.')
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exit(1)
})

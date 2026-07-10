#!/usr/bin/env tsx
/* eslint-disable no-console */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '../../src/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptMutationSucceeded,
  assertScriptQuerySucceeded,
} from '../../src/lib/script-mutation-safety'

const SCRIPT_NAME = 'update-upcoming-event-menu-copy'
const RUN_MUTATION_ENV = 'RUN_UPDATE_EVENT_MENU_COPY_MUTATION'
const ALLOW_MUTATION_ENV = 'ALLOW_UPDATE_EVENT_MENU_COPY_MUTATION_SCRIPT'
const HARD_CAP = 4

const EVENT_CHANGES = [
  {
    id: '27e85126-e3cd-40ae-81c3-e1bf804664b5',
    name: 'Music Bingo',
    date: '2026-07-17',
    fields: {
      brief: [
        {
          from: 'Food is served from **4:00pm to 9:00pm**, including our stone-baked pizzas, perfect for sharing before the bingo madness begins.',
          to: 'Our full menu is available from **4:00pm to 9:00pm**, so come early, order some food and settle in before the bingo madness begins.',
        },
      ],
      long_description: [
        {
          from: 'Our kitchen will be serving up delicious stone-baked pizzas from 4pm to 9pm. So, grab a slice and a drink, and soak up the buzzing atmosphere before the bingo madness kicks off.',
          to: 'Our full menu will be available from 4pm to 9pm. Grab some food and a drink, then soak up the buzzing atmosphere before the bingo madness kicks off.',
        },
      ],
    },
    highlight: {
      from: 'delicious stone-baked pizzas available',
      to: 'full menu available until 9pm',
    },
  },
  {
    id: '39881f94-d652-407b-8075-ae371a295c6f',
    name: 'Quiz Night',
    date: '2026-07-22',
    fields: {
      brief: [
        {
          from: 'The kitchen is open from **4:00pm to 9:00pm**, so you can come early, grab food, get a drink, settle in and be ready for the quiz to kick off.',
          to: 'Our full menu is available from **4:00pm to 9:00pm**, so you can come early, order food, get a drink, settle in and be ready for the quiz to kick off.',
        },
      ],
      long_description: [
        {
          from: 'The kitchen is serving pizza from 4:00pm to 9:00pm, so you can enjoy some tasty food while you get ready to quiz.',
          to: 'Our full menu is available from 4:00pm to 9:00pm, so you can enjoy some food while you get ready to quiz.',
        },
      ],
    },
  },
  {
    id: '50997319-dae7-45f1-ad0f-8ad55002d5af',
    name: 'Cash Bingo',
    date: '2026-07-29',
    fields: {
      brief: [
        {
          from: 'Kitchen open **4:00pm to 9:00pm**.',
          to: 'Our full menu is available from **4:00pm to 9:00pm**.',
        },
        {
          from: 'Don’t miss our freshly stone-baked authentic Italian pizzas. There’s a wide range to choose from, seriously good ingredients, and if you can’t finish it, you can take the rest home.',
          to: 'Come early, order some food and get settled before the games begin.',
        },
      ],
      long_description: [
        {
          from: 'Our kitchen serves up delicious stone-baked pizzas until 9:00pm, perfect for a bite while you play.',
          to: 'Our full menu is available until 9:00pm, perfect for ordering a bite while you play.',
        },
      ],
    },
    highlight: {
      from: 'delicious stone-baked pizzas',
      to: 'full menu available until 9pm',
    },
  },
] as const

const FAQ_CHANGE = {
  id: 'bd9b8d6f-f4a6-401a-ac5a-a1febab0958d',
  from: 'The kitchen serves pizza from 4:00pm to 9:00pm on quiz nights, and there are plenty of drinks available at the bar.',
  to: 'Our full menu is available from 4:00pm to 9:00pm on quiz nights, with drinks available from the bar throughout the event.',
} as const

type EventRow = {
  id: string
  name: string
  date: string
  brief: string | null
  long_description: string | null
  highlights: unknown
}

type EventUpdate = {
  brief?: string
  long_description?: string
  highlights?: string[]
}

const TRUTHY = new Set(['1', 'true', 'yes', 'on'])

function isTruthy(value: string | undefined): boolean {
  return value ? TRUTHY.has(value.trim().toLowerCase()) : false
}

function readLimit(argv: string[]): number | null {
  const index = argv.indexOf('--limit')
  const raw = index >= 0 ? argv[index + 1] : null
  if (!raw || !/^[1-9]\d*$/.test(raw)) return null
  return Number(raw)
}

function replaceExact(
  current: string,
  replacement: { from: string; to: string },
  label: string,
): { value: string; changed: boolean } {
  if (current.includes(replacement.from)) {
    return {
      value: current.replace(replacement.from, replacement.to),
      changed: true,
    }
  }
  if (current.includes(replacement.to)) {
    return { value: current, changed: false }
  }
  throw new Error(`[${SCRIPT_NAME}] Expected copy not found in ${label}`)
}

function buildEventUpdate(
  row: EventRow,
  change: (typeof EVENT_CHANGES)[number],
): EventUpdate {
  if (row.name !== change.name || row.date !== change.date) {
    throw new Error(
      `[${SCRIPT_NAME}] Event identity mismatch for ${change.id}: expected ${change.name} on ${change.date}, found ${row.name} on ${row.date}`,
    )
  }

  const update: EventUpdate = {}
  for (const field of ['brief', 'long_description'] as const) {
    const replacements = change.fields[field]
    if (!replacements) continue

    const current = row[field]
    if (!current) {
      throw new Error(`[${SCRIPT_NAME}] ${change.name} has no ${field}`)
    }

    let next = current
    let changed = false
    for (const replacement of replacements) {
      const result = replaceExact(next, replacement, `${change.name}.${field}`)
      next = result.value
      changed ||= result.changed
    }
    if (changed) update[field] = next
  }

  if ('highlight' in change) {
    if (!Array.isArray(row.highlights) || !row.highlights.every((item) => typeof item === 'string')) {
      throw new Error(`[${SCRIPT_NAME}] ${change.name} highlights are not a string array`)
    }
    const currentHighlights = row.highlights as string[]
    if (currentHighlights.includes(change.highlight.from)) {
      update.highlights = currentHighlights.map((item) =>
        item === change.highlight.from ? change.highlight.to : item
      )
    } else if (!currentHighlights.includes(change.highlight.to)) {
      throw new Error(`[${SCRIPT_NAME}] Expected highlight not found for ${change.name}`)
    }
  }

  return update
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const confirm = process.argv.includes('--confirm')
  const dryRun = !confirm || process.argv.includes('--dry-run')
  const limit = readLimit(process.argv)
  const supabase = createAdminClient()
  const ids = EVENT_CHANGES.map((change) => change.id)

  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('id, name, date, brief, long_description, highlights')
    .in('id', ids)

  const events = (assertScriptQuerySucceeded({
    operation: 'Load target events',
    error: eventError,
    data: (eventData ?? []) as EventRow[],
  }) ?? []) as EventRow[]

  assertScriptExpectedRowCount({
    operation: 'Load target events',
    expected: EVENT_CHANGES.length,
    actual: events.length,
  })

  const eventById = new Map(events.map((event) => [event.id, event]))
  const eventPlans = EVENT_CHANGES.map((change) => {
    const row = eventById.get(change.id)
    if (!row) throw new Error(`[${SCRIPT_NAME}] Missing target event ${change.id}`)
    return { id: change.id, name: change.name, update: buildEventUpdate(row, change) }
  }).filter((plan) => Object.keys(plan.update).length > 0)

  const { data: faqData, error: faqError } = await supabase
    .from('event_faqs')
    .select('id, answer')
    .eq('id', FAQ_CHANGE.id)
    .maybeSingle()

  const faq = assertScriptQuerySucceeded({
    operation: 'Load target event FAQ',
    error: faqError,
    data: faqData,
  }) as { id: string; answer: string }
  const faqResult = replaceExact(faq.answer, FAQ_CHANGE, 'Quiz Night FAQ')
  const plannedOperations = eventPlans.length + (faqResult.changed ? 1 : 0)

  console.log(`[${SCRIPT_NAME}] ${dryRun ? 'DRY RUN' : 'MUTATION'}`)
  console.log(`[${SCRIPT_NAME}] event updates=${eventPlans.length}; FAQ updates=${faqResult.changed ? 1 : 0}`)
  for (const plan of eventPlans) {
    console.log(`[${SCRIPT_NAME}] ${plan.name}: ${Object.keys(plan.update).join(', ')}`)
  }

  if (dryRun) {
    console.log(`[${SCRIPT_NAME}] No database changes made.`)
    return
  }

  if (!isTruthy(process.env[RUN_MUTATION_ENV])) {
    throw new Error(`[${SCRIPT_NAME}] Set ${RUN_MUTATION_ENV}=true to allow updates`)
  }
  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: ALLOW_MUTATION_ENV })
  if (limit === null || limit > HARD_CAP || plannedOperations > limit) {
    throw new Error(
      `[${SCRIPT_NAME}] Use --limit ${HARD_CAP}; planned operations=${plannedOperations}, hard cap=${HARD_CAP}`,
    )
  }

  for (const plan of eventPlans) {
    const { data, error } = await supabase
      .from('events')
      .update(plan.update)
      .eq('id', plan.id)
      .select('id')
    const { updatedCount } = assertScriptMutationSucceeded({
      operation: `Update ${plan.name}`,
      error,
      updatedRows: data,
    })
    assertScriptExpectedRowCount({
      operation: `Update ${plan.name}`,
      expected: 1,
      actual: updatedCount,
    })
  }

  if (faqResult.changed) {
    const { data, error } = await supabase
      .from('event_faqs')
      .update({ answer: faqResult.value })
      .eq('id', FAQ_CHANGE.id)
      .select('id')
    const { updatedCount } = assertScriptMutationSucceeded({
      operation: 'Update Quiz Night FAQ',
      error,
      updatedRows: data,
    })
    assertScriptExpectedRowCount({
      operation: 'Update Quiz Night FAQ',
      expected: 1,
      actual: updatedCount,
    })
  }

  const { data: verifiedEvents, error: verifyEventError } = await supabase
    .from('events')
    .select('id, brief, long_description, highlights')
    .in('id', ids)
  const verified = assertScriptQuerySucceeded({
    operation: 'Verify updated events',
    error: verifyEventError,
    data: verifiedEvents ?? [],
  }) as Array<{ id: string; brief: string | null; long_description: string | null; highlights: unknown }>

  for (const row of verified) {
    const text = [
      row.brief ?? '',
      row.long_description ?? '',
      ...(Array.isArray(row.highlights) ? row.highlights.map(String) : []),
    ].join(' ')
    if (/pizzas?/i.test(text) || !/full menu/i.test(text)) {
      throw new Error(`[${SCRIPT_NAME}] Verification failed for event ${row.id}`)
    }
  }

  const { data: verifiedFaq, error: verifyFaqError } = await supabase
    .from('event_faqs')
    .select('answer')
    .eq('id', FAQ_CHANGE.id)
    .single()
  const checkedFaq = assertScriptQuerySucceeded({
    operation: 'Verify updated FAQ',
    error: verifyFaqError,
    data: verifiedFaq,
  }) as { answer: string }
  if (/pizzas?/i.test(checkedFaq.answer) || !/full menu/i.test(checkedFaq.answer)) {
    throw new Error(`[${SCRIPT_NAME}] FAQ verification failed`)
  }

  console.log(`[${SCRIPT_NAME}] Update and verification complete.`)
}

void main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

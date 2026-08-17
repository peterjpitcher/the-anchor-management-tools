#!/usr/bin/env tsx
/* eslint-disable no-console */

import dotenv from 'dotenv'
import path from 'path'
import { createAdminClient } from '@/lib/supabase/admin'
import {
  assertScriptExpectedRowCount,
  assertScriptMutationAllowed,
  assertScriptQuerySucceeded,
} from '@/lib/script-mutation-safety'

const SCRIPT_NAME = 'update-post-september-event-hours'
const CONFIRM_ENV = 'CONFIRM_POST_SEPTEMBER_EVENT_HOURS_UPDATE'
const START_DATE = '2026-09-01'

type Replacement = {
  from: string
  to: string
}

const DINNER_LONG: Replacement = {
  from: 'Our full main menu is served from 4pm to 9pm.',
  to: 'The pub is open from 12pm. Our full dinner menu is served from 4pm to 9pm.',
}

const DINNER_BRIEF: Replacement = {
  from: 'Our **full main menu is available from 4:00pm to 9:00pm**.',
  to: 'The pub is open from **12pm**. Our **full dinner menu is available from 4:00pm to 9:00pm**.',
}

const MUSIC_BRIEF: Replacement = {
  from: 'Our **full main menu is available from 4pm until 9pm**',
  to: 'The pub is open from **12pm**. Our **full dinner menu is available from 4pm until 9pm**',
}

const QUIZ_BRIEF: Replacement = {
  from: 'Our **full main menu is available from 4:00pm to 9:00pm**',
  to: 'The pub is open from **12pm**. Our **full dinner menu is available from 4:00pm to 9:00pm**',
}

const targets = [
  {
    id: '15269bd7-037c-4634-8520-48bf8ac44906',
    date: '2026-09-02',
    name: 'End of Summer Cash Bingo',
    fields: { long_description: DINNER_LONG, brief: DINNER_BRIEF },
  },
  {
    id: '5cdadf74-97c1-4ec0-b495-d369a7304494',
    date: '2026-09-11',
    name: 'Detention Disco: Back to School Music Bingo',
    fields: {
      short_description: {
        from: 'our full menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: {
        from: 'Our full menu is available from 4pm until 9pm',
        to: 'The pub is open from 12pm, and our full dinner menu is available from 4pm until 9pm',
      },
      brief: MUSIC_BRIEF,
    },
  },
  {
    id: '9b78f364-7712-4c92-9b09-ffa9132e37e5',
    date: '2026-09-16',
    name: 'Autumn Kick-Off Quiz Night',
    fields: {
      short_description: {
        from: 'tasty food from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: {
        from: 'our full menu is available from 4pm to 9pm',
        to: 'the pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm',
      },
      brief: QUIZ_BRIEF,
    },
  },
  {
    id: 'e9e84ee8-c59b-4f93-80f6-7e7961a03240',
    date: '2026-09-25',
    name: 'Lovely Jubbly: Only Fools and Horses Charity Quiz Night',
    fields: {
      long_description: {
        from: 'Our full menu is available from 4pm to 9pm',
        to: 'The pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm',
      },
      brief: {
        from: 'Our **full menu is available from 4pm to 9pm**',
        to: 'The pub is open from **12pm**. Our **full dinner menu is available from 4pm to 9pm**',
      },
    },
  },
  {
    id: 'd81512e7-5e99-48fd-a153-3400c2f6f009',
    date: '2026-09-30',
    name: 'Autumn Jackpot Cash Bingo',
    fields: { long_description: DINNER_LONG, brief: DINNER_BRIEF },
  },
  {
    id: '76ec328b-48f8-47c0-b041-cc405e085deb',
    date: '2026-10-07',
    name: 'A Hint of Halloween Quiz Night',
    fields: {
      short_description: {
        from: 'our full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: DINNER_LONG,
      meta_description: {
        from: 'a full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      brief: QUIZ_BRIEF,
    },
  },
  {
    id: 'c3ac7e18-e562-4ef8-bea7-cae29f6e96ac',
    date: '2026-10-16',
    name: 'Screams & Soundtracks: Classic Horror Music Bingo',
    fields: {
      short_description: {
        from: 'our full menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: DINNER_LONG,
      meta_description: {
        from: 'food from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      brief: MUSIC_BRIEF,
    },
  },
  {
    id: '8acfe965-ade6-4a9f-a666-e90ecdea2b7b',
    date: '2026-11-04',
    name: 'Sparks & Sparklers Quiz Night',
    fields: {
      short_description: {
        from: 'our full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: DINNER_LONG,
      meta_description: {
        from: 'a full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      brief: QUIZ_BRIEF,
    },
  },
  {
    id: 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735',
    date: '2026-11-13',
    name: 'Sequins & Showstoppers: Strictly-Season Music Bingo',
    fields: {
      short_description: {
        from: 'our full menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: {
        from: 'The bar will be open, and our full menu is available from 4pm until 9pm',
        to: 'The pub is open from 12pm, the bar remains open throughout the evening, and our full dinner menu is available from 4pm until 9pm',
      },
      brief: MUSIC_BRIEF,
    },
  },
  {
    id: '6e761f65-8b17-4bc9-8a01-d032b77f6a66',
    date: '2026-11-18',
    name: 'Snowball Showdown Cash Bingo',
    fields: { long_description: DINNER_LONG, brief: DINNER_BRIEF },
  },
  {
    id: 'ccbe8b82-15b0-4261-b58e-2ac4d7210e25',
    date: '2026-12-02',
    name: 'Tinsel & Trivia Quiz Night',
    fields: {
      short_description: {
        from: 'our full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      long_description: DINNER_LONG,
      meta_description: {
        from: 'a full main menu from 4pm to 9pm',
        to: 'dinner served from 4pm to 9pm',
      },
      brief: QUIZ_BRIEF,
    },
  },
  {
    id: '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a',
    date: '2026-12-11',
    name: 'Sleigh My Name: Festive Music Bingo',
    fields: {
      long_description: {
        from: 'The full menu will be available from 4pm until 9pm',
        to: 'The pub is open from 12pm, and the full dinner menu will be available from 4pm until 9pm',
      },
      brief: MUSIC_BRIEF,
    },
  },
  {
    id: 'b9334958-76b4-4504-a64a-0d47145bd75e',
    date: '2026-12-16',
    name: 'Christmas Jackpot Cash Bingo',
    fields: { long_description: DINNER_LONG, brief: DINNER_BRIEF },
  },
] as const

const faqTargets = [
  {
    id: '00e385fd-be25-41ee-bc9c-88f5625c6d57',
    eventId: '5cdadf74-97c1-4ec0-b495-d369a7304494',
    from: 'Yes, our full menu is available from 4pm until 9pm, so arrive early to enjoy a meal before the games start.',
    to: 'Yes. The pub is open from 12pm, and our full dinner menu is available from 4pm until 9pm, so arrive early to enjoy a meal before the games start.',
  },
  {
    id: '6dc40209-b1f6-4751-8c69-4ad2d1247705',
    eventId: '9b78f364-7712-4c92-9b09-ffa9132e37e5',
    from: 'Yes, our full menu is available from 4:00pm to 9:00pm, so you can enjoy a meal before or during the quiz.',
    to: 'Yes. The pub is open from 12pm, and our full dinner menu is available from 4:00pm to 9:00pm, so you can enjoy a meal before or during the quiz.',
  },
  {
    id: '98be8f98-9fb2-4d6c-8573-fde157d1c7e5',
    eventId: 'e9e84ee8-c59b-4f93-80f6-7e7961a03240',
    from: 'Our full menu is available from 4pm to 9pm. Come early and order before the 7pm start where possible so you do not miss a question.',
    to: 'The pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm. Come early and order before the 7pm start where possible so you do not miss a question.',
  },
  {
    id: 'aead6a34-9245-4206-b1f1-2f37a2e26a37',
    eventId: 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735',
    from: 'Yes, our full menu is available from 4pm to 9pm, so come early to enjoy a meal before the fun starts.',
    to: 'Yes. The pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm, so come early to enjoy a meal before the fun starts.',
  },
  {
    id: '89d8fdb8-83cd-4c37-a31c-8331d294a10c',
    eventId: '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a',
    from: 'Yes, our full menu is available from 4pm until 9pm, so you can grab a bite before the fun starts.',
    to: 'Yes. The pub is open from 12pm, and our full dinner menu is available from 4pm until 9pm, so you can grab a bite before the fun starts.',
  },
] as const

const highlightTargets = [
  {
    eventId: 'c3e9fbbd-df4a-41f2-a1c6-8194a5979735',
    from: 'full menu available from 4pm to 9pm for a pre-bingo bite',
    to: 'dinner served from 4pm to 9pm for a pre-bingo bite',
  },
  {
    eventId: '9b8f85f8-c5cc-4956-ad1f-72f569e7fc4a',
    from: 'full menu available from 4pm to 9pm',
    to: 'dinner served from 4pm to 9pm',
  },
] as const

type EventRow = {
  id: string
  date: string
  name: string
  short_description: string | null
  long_description: string | null
  meta_description: string | null
  brief: string | null
  highlights: unknown
}

type EventUpdate = Partial<Pick<
  EventRow,
  'short_description' | 'long_description' | 'meta_description' | 'brief' | 'highlights'
>>

function applyReplacement(value: string, replacement: Replacement, label: string): string {
  if (value.includes(replacement.to)) return value
  if (!value.includes(replacement.from)) {
    throw new Error(`[${SCRIPT_NAME}] Expected copy not found in ${label}`)
  }
  return value.replace(replacement.from, replacement.to)
}

function buildUpdate(
  row: EventRow,
  target: (typeof targets)[number],
): EventUpdate {
  if (row.name !== target.name || row.date !== target.date) {
    throw new Error(
      `[${SCRIPT_NAME}] Event identity mismatch for ${target.id}: expected ${target.name} on ${target.date}, found ${row.name} on ${row.date}`,
    )
  }

  const update: EventUpdate = {}
  for (const [field, replacement] of Object.entries(target.fields) as Array<
    [keyof EventUpdate, Replacement]
  >) {
    const current = row[field]
    if (!current) throw new Error(`[${SCRIPT_NAME}] ${target.name}.${field} is empty`)
    const next = applyReplacement(current, replacement, `${target.name}.${field}`)
    if (next !== current) update[field] = next
  }

  const highlightTarget = highlightTargets.find((item) => item.eventId === target.id)
  if (highlightTarget) {
    if (!Array.isArray(row.highlights) || !row.highlights.every((item) => typeof item === 'string')) {
      throw new Error(`[${SCRIPT_NAME}] ${target.name}.highlights is not a string array`)
    }
    if (row.highlights.includes(highlightTarget.to)) return update
    if (!row.highlights.includes(highlightTarget.from)) {
      throw new Error(`[${SCRIPT_NAME}] Expected highlight copy not found for ${target.name}`)
    }
    update.highlights = row.highlights.map((item) =>
      item === highlightTarget.from ? highlightTarget.to : item
    )
  }
  return update
}

async function main(): Promise<void> {
  dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

  const confirm = process.argv.includes('--confirm')
  const supabase = createAdminClient()
  const eventIds = targets.map((target) => target.id)
  const faqIds = faqTargets.map((target) => target.id)

  const [{ data: eventData, error: eventError }, { data: faqData, error: faqError }] =
    await Promise.all([
      supabase
        .from('events')
        .select('id, date, name, short_description, long_description, meta_description, brief, highlights')
        .in('id', eventIds),
      supabase
        .from('event_faqs')
        .select('id, event_id, answer')
        .in('id', faqIds),
    ])

  const events = assertScriptQuerySucceeded({
    operation: 'Load target events',
    error: eventError,
    data: (eventData ?? []) as EventRow[],
  }) as EventRow[]
  const faqs = assertScriptQuerySucceeded({
    operation: 'Load target FAQs',
    error: faqError,
    data: faqData ?? [],
  }) as Array<{ id: string; event_id: string; answer: string }>

  assertScriptExpectedRowCount({
    operation: 'Load target events',
    expected: targets.length,
    actual: events.length,
  })
  assertScriptExpectedRowCount({
    operation: 'Load target FAQs',
    expected: faqTargets.length,
    actual: faqs.length,
  })

  const eventById = new Map(events.map((event) => [event.id, event]))
  const eventPlans = targets.map((target) => {
    const row = eventById.get(target.id)
    if (!row) throw new Error(`[${SCRIPT_NAME}] Missing event ${target.id}`)
    return { target, update: buildUpdate(row, target) }
  }).filter((plan) => Object.keys(plan.update).length > 0)

  const faqById = new Map(faqs.map((faq) => [faq.id, faq]))
  const faqPlans = faqTargets.map((target) => {
    const row = faqById.get(target.id)
    if (!row || row.event_id !== target.eventId) {
      throw new Error(`[${SCRIPT_NAME}] FAQ identity mismatch for ${target.id}`)
    }
    const answer = applyReplacement(row.answer, target, `FAQ ${target.id}`)
    return { target, answer, changed: answer !== row.answer }
  }).filter((plan) => plan.changed)

  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION' : 'DRY RUN'}`)
  console.log(`[${SCRIPT_NAME}] event updates=${eventPlans.length}; FAQ updates=${faqPlans.length}`)
  for (const plan of eventPlans) {
    console.log(`[${SCRIPT_NAME}] ${plan.target.date} ${plan.target.name}: ${Object.keys(plan.update).join(', ')}`)
  }

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] No database changes made.`)
    return
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: CONFIRM_ENV })

  for (const plan of eventPlans) {
    const { data, error } = await supabase
      .from('events')
      .update(plan.update)
      .eq('id', plan.target.id)
      .eq('date', plan.target.date)
      .select('id')
    if (error) throw new Error(`Update ${plan.target.name} failed: ${error.message}`)
    assertScriptExpectedRowCount({
      operation: `Update ${plan.target.name}`,
      expected: 1,
      actual: data?.length ?? 0,
    })
  }

  for (const plan of faqPlans) {
    const { data, error } = await supabase
      .from('event_faqs')
      .update({ answer: plan.answer })
      .eq('id', plan.target.id)
      .eq('event_id', plan.target.eventId)
      .select('id')
    if (error) throw new Error(`Update FAQ ${plan.target.id} failed: ${error.message}`)
    assertScriptExpectedRowCount({
      operation: `Update FAQ ${plan.target.id}`,
      expected: 1,
      actual: data?.length ?? 0,
    })
  }

  const [{ data: verifiedEvents, error: verifiedEventError }, { data: verifiedFaqs, error: verifiedFaqError }] =
    await Promise.all([
      supabase
        .from('events')
        .select('id, date, name, short_description, long_description, meta_description, brief, highlights')
        .in('id', eventIds),
      supabase
        .from('event_faqs')
        .select('id, event_id, answer')
        .in('id', faqIds),
    ])
  if (verifiedEventError) throw new Error(`Verify events failed: ${verifiedEventError.message}`)
  if (verifiedFaqError) throw new Error(`Verify FAQs failed: ${verifiedFaqError.message}`)

  const verifiedEventById = new Map((verifiedEvents ?? []).map((event) => [event.id, event]))
  for (const target of targets) {
    const row = verifiedEventById.get(target.id) as Record<string, unknown> | undefined
    if (!row) throw new Error(`[${SCRIPT_NAME}] Missing verified event ${target.id}`)
    for (const [field, replacement] of Object.entries(target.fields)) {
      const value = row[field]
      if (typeof value !== 'string' || !value.includes(replacement.to)) {
        throw new Error(`[${SCRIPT_NAME}] Verification failed for ${target.name}.${field}`)
      }
    }
  }

  const verifiedFaqById = new Map((verifiedFaqs ?? []).map((faq) => [faq.id, faq]))
  for (const target of faqTargets) {
    const faq = verifiedFaqById.get(target.id)
    if (!faq || faq.event_id !== target.eventId || faq.answer !== target.to) {
      throw new Error(`[${SCRIPT_NAME}] Verification failed for FAQ ${target.id}`)
    }
  }

  for (const target of highlightTargets) {
    const row = verifiedEventById.get(target.eventId)
    if (!row || !Array.isArray(row.highlights) || !row.highlights.includes(target.to)) {
      throw new Error(`[${SCRIPT_NAME}] Verification failed for highlights on ${target.eventId}`)
    }
  }

  const { data: futureEvents, error: futureEventError } = await supabase
    .from('events')
    .select('id, date, name, short_description, long_description, meta_description, brief, highlights')
    .gte('date', START_DATE)
  if (futureEventError) throw new Error(`Future event audit failed: ${futureEventError.message}`)

  const ambiguous = (futureEvents ?? []).flatMap((event) =>
    [
      ...['short_description', 'long_description', 'meta_description', 'brief'].map((field) => ({
        field,
        value: event[field as keyof typeof event],
      })),
      ...(Array.isArray(event.highlights)
        ? event.highlights.map((value, index) => ({ field: `highlights[${index}]`, value }))
        : []),
    ].flatMap(({ field, value }) => {
      if (typeof value !== 'string') return []
      const hasFourPm = /4(?::00)?pm/i.test(value)
      const hasAmbiguousFood = /(?:full(?: main)? menu|tasty food|\bfood)\s+(?:is\s+)?(?:available|served)?\s*from\s+4(?::00)?pm/i.test(value)
      const hasFourPmOpening = /(?:pub|bar|we|the anchor)\s+(?:is\s+)?open(?:s|ing)?\s+(?:from|at)\s+4(?::00)?pm/i.test(value)
      if (!hasFourPm || (!hasAmbiguousFood && !hasFourPmOpening)) return []
      return [`${event.date} ${event.name}.${field}`]
    }),
  )
  if (ambiguous.length > 0) {
    throw new Error(`[${SCRIPT_NAME}] Ambiguous 4pm copy remains: ${ambiguous.join(', ')}`)
  }

  console.log(`[${SCRIPT_NAME}] Update and verification complete.`)
}

void main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

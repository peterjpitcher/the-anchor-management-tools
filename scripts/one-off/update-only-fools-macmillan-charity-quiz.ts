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
import { validateGeneratedContent } from '@/lib/seo-validation'

const SCRIPT_NAME = 'update-only-fools-macmillan-charity-quiz'
const CONFIRM_ENV = 'CONFIRM_ONLY_FOOLS_MACMILLAN_UPDATE'
const EVENT_ID = 'e9e84ee8-c59b-4f93-80f6-7e7961a03240'
const EVENT_DATE = '2026-09-25'
const EVENT_NAME = 'Lovely Jubbly: Only Fools and Horses Charity Quiz Night'

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') })

const shortDescription =
  'Join The Anchor in partnership with the Stanwell Moor Community Wellbeing Garden for an Only Fools and Horses charity quiz in aid of Macmillan Cancer Support. Entry is £3 cash per person, and every entry fee will be donated.'

const longDescription = `The Anchor is partnering with the Stanwell Moor Community Wellbeing Garden for a special Only Fools and Horses charity quiz night in aid of Macmillan Cancer Support. Join us on Friday 25 September from 7pm to 9.30pm for classic quotes, themed questions, plenty of laughs and a good cause at the heart of the night. Every penny from the £3 quiz entry fee will be donated to Macmillan Cancer Support.

Expect four themed rounds with ten questions in each, covering iconic moments, favourite characters, classic catchphrases and deeper cuts for proper fans. There will also be a quick interactive game using one phone per team. Quizmaster Peter Pitcher will keep the questions moving and the atmosphere lively, whether you know every episode or simply fancy a fun Friday night with friends.

Arrive from 6.45pm, be seated by 6.55pm and get ready for a 7pm sharp start. The pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm, so come early, order some food and settle in before the first round. Food and drinks are ordered at the bar.

Teams can have up to six players. Entry is £3 per person, paid in cash on arrival, while the bar takes card as usual. Booking is strongly recommended because this event is expected to be busy. Walk-ins are welcome where space allows, and we will do our best to help solo players and pairs join a team.

The winning team will receive a £25 bar voucher, second-to-last place will receive a bottle of wine, and there will be spot prizes and free drinks during the night. All prizes are provided separately, so no quiz entry fees will be used to pay for them.

The Anchor is in Stanwell Moor, close to Staines and Heathrow, with free on-site parking. Dress-up is welcome but not required. The pub is dog-friendly, and the ground floor has step-free access and an accessible toilet.

This is an independently organised fundraising event in aid of Macmillan Cancer Support and is not organised by Macmillan. It is a themed fan quiz and is not an official Only Fools and Horses event. Macmillan Cancer Support is a registered charity in England and Wales (261017), Scotland (SC039907) and the Isle of Man (604).`

const brief = `# Lovely Jubbly: Only Fools and Horses Charity Quiz Night

## In aid of Macmillan Cancer Support

**Friday 25 September 2026 | 7pm-9.30pm**
**The Anchor, Horton Road, Stanwell Moor Village, TW19 6AQ**

The Anchor is partnering with the **Stanwell Moor Community Wellbeing Garden** for a special Only Fools and Horses charity quiz night in aid of **Macmillan Cancer Support**.

He who dares, quizzes. Get your team together for a feel-good Friday night packed with classic quotes, memorable characters, themed questions, laughs and prizes.

Most importantly, **every penny from the £3 quiz entry fee will be donated to Macmillan Cancer Support**. All prizes are provided separately, so none of the entry fees will be used to cover them.

## Key information

- Arrive from: **6.45pm**
- Please be seated by: **6.55pm**
- Quiz starts: **7pm sharp**
- Ends: around **9.30pm**
- Teams: **up to 6 people**
- Entry: **£3 per person, cash only**
- Donation: **100% of quiz entry fees to Macmillan Cancer Support**
- The bar takes card as usual

**Booking is strongly recommended.** Walk-ins are welcome where space allows, but booking ahead is the best way to guarantee your table.

Coming on your own or as a pair? Arrive early and let the bar team know. We will do our best to help you join a team on the night.

## Come early and eat with us

The pub is open from **12pm**. Our **full dinner menu is available from 4pm to 9pm**, so come early, order some food and settle in before the quiz. We recommend ordering before the 7pm start wherever possible. Food and drinks are ordered at the bar.

## What to expect

- Four Only Fools and Horses themed rounds with 10 questions per round
- A quick interactive middle game using one phone per team
- A mix of easy wins, classic moments, quotes, characters and trickier questions for proper fans
- A relaxed, lively atmosphere where the aim is to have a laugh, not sit an exam
- Dress-up is encouraged but not required

## Quiz rounds

### Lovely Jubbly

Characters, storylines, iconic moments and unforgettable scenes.

### Peckham to Margate

Nelson Mandela House, the Nag's Head, markets, holidays, schemes and trips that went sideways.

### He Who Dares: Quotes and Catchphrases

The famous lines and moments people still repeat decades later.

### The Nag's Head Files

Dodgy deals, side characters, festive specials, family history and deeper details for dedicated fans.

## Prizes

- **1st place:** £25 bar voucher, valid on food or drink at The Anchor for one month
- **Second-to-last place:** bottle of wine
- Spot prizes and free drinks during the night

All prizes are provided separately. **Every quiz entry fee will be donated to Macmillan Cancer Support.**

## House rules

- No cheating or Googling
- Phones away during quiz rounds, except for the interactive game
- The quizmaster's decision is final on close calls and tie-breaks
- Keep it friendly and fair

## Good to know

The Anchor has free on-site parking, is dog-friendly and offers step-free access across the ground floor with an accessible toilet.

This is an independently organised fundraising event in aid of Macmillan Cancer Support and is not organised by Macmillan. It is a themed fan quiz and is not an official Only Fools and Horses event.

Macmillan Cancer Support is a registered charity in England and Wales (261017), Scotland (SC039907) and the Isle of Man (604).

## Book your table

Book online at **the-anchor.pub/book-table** and add **"ONLY FOOLS QUIZ"** in the notes, or call **01753 682707**.

Spaces are limited, so get your team together and book early. You know it makes sense.`

const facebookDescription =
  'The Anchor is partnering with the Stanwell Moor Community Wellbeing Garden for an Only Fools and Horses charity quiz in aid of Macmillan Cancer Support. Join us on Friday 25 September, 7pm-9.30pm. Entry is £3 cash per person, and every quiz entry fee will be donated. Teams of up to six. Booking is strongly recommended.'

const googleDescription =
  'Only Fools and Horses charity quiz in aid of Macmillan Cancer Support, run by The Anchor in partnership with the Stanwell Moor Community Wellbeing Garden. Friday 25 September, 7pm-9.30pm. Entry is £3 cash per person and every quiz entry fee will be donated. Teams of up to six; booking recommended.'

const openTableDescription =
  'Book a table for our Only Fools and Horses charity quiz, run by The Anchor in partnership with the Stanwell Moor Community Wellbeing Garden in aid of Macmillan Cancer Support. Friday 25 September, 7pm-9.30pm. Teams of up to six. Entry is £3 cash per person on arrival, and every quiz entry fee will be donated.'

const primaryKeywords = [
  'Only Fools and Horses quiz',
  'charity quiz',
  'Macmillan fundraiser',
]

const secondaryKeywords = [
  'Only Fools charity quiz',
  'themed pub quiz',
  'fundraising quiz night',
  'Friday quiz night',
]

const localSeoKeywords = [
  'Stanwell Moor charity event',
  'Stanwell Moor Community Wellbeing Garden',
  'quiz near Staines',
]

const eventUpdate = {
  name: EVENT_NAME,
  short_description: shortDescription,
  long_description: longDescription,
  brief,
  highlights: [
    'In aid of Macmillan Cancer Support',
    'Every £3 quiz entry fee donated',
    'In partnership with Stanwell Moor Community Wellbeing Garden',
    'Teams of up to 6 players',
    'Prizes provided separately',
  ],
  meta_title: 'Only Fools and Horses Charity Quiz',
  meta_description:
    'Only Fools and Horses charity quiz in aid of Macmillan Cancer Support, in partnership with Stanwell Moor Community Wellbeing Garden. Book for 25 September.',
  keywords: [...primaryKeywords, ...secondaryKeywords, ...localSeoKeywords],
  primary_keywords: primaryKeywords,
  secondary_keywords: secondaryKeywords,
  local_seo_keywords: localSeoKeywords,
  image_alt_text:
    'Only Fools and Horses charity quiz artwork for The Anchor and Stanwell Moor Community Wellbeing Garden, in aid of Macmillan Cancer Support',
  social_copy_whatsapp:
    'Lovely Jubbly! Join our Only Fools and Horses charity quiz on Friday 25 September, 7pm, in partnership with the Stanwell Moor Community Wellbeing Garden in aid of Macmillan Cancer Support. £3 cash per person and every entry fee is donated. Teams of up to 6. Book: the-anchor.pub/book-table',
  attendance_note:
    '£3 cash per person. Every quiz entry fee will be donated to Macmillan Cancer Support. Teams of up to 6. Arrive from 6:45pm and be seated by 6:55pm.',
  cancellation_policy:
    'There is no cancellation charge. If you can no longer attend, please cancel your table so it can be offered to another team. Entry is paid in cash on arrival, so there are no advance entry fees to refund.',
  facebook_event_name: EVENT_NAME,
  facebook_event_description: facebookDescription,
  gbp_event_title: 'Only Fools Charity Quiz for Macmillan',
  gbp_event_description: googleDescription,
  opentable_experience_title: 'Only Fools Charity Quiz for Macmillan',
  opentable_experience_description: openTableDescription,
}

const faqs = [
  {
    question: 'What time does the quiz start?',
    answer: 'The quiz starts at 7pm sharp. Please arrive from 6.45pm and be seated by 6.55pm so your team is ready for the first round.',
  },
  {
    question: 'How much is entry and where does the money go?',
    answer: 'Entry is £3 per person, paid in cash on arrival. Every quiz entry fee will be donated to Macmillan Cancer Support, and prizes are provided separately.',
  },
  {
    question: 'Can I book a table for the quiz?',
    answer: 'Yes. Booking is strongly recommended. Book online and add "ONLY FOOLS QUIZ" in the notes, or call The Anchor on 01753 682707.',
  },
  {
    question: 'What food is available during the quiz?',
    answer: 'The pub is open from 12pm, and our full dinner menu is available from 4pm to 9pm. Come early and order before the 7pm start where possible so you do not miss a question.',
  },
  {
    question: 'Is the venue accessible?',
    answer: 'Yes. The Anchor has step-free access throughout the ground floor and an accessible toilet. Call 01753 682707 if you have specific requirements.',
  },
] as const

type EventIdentity = {
  id: string
  name: string
  date: string
}

type EventFaq = {
  id: string
  question: string
  answer: string
  sort_order: number
}

function changedFields(current: Record<string, unknown>): string[] {
  return Object.entries(eventUpdate)
    .filter(([key, value]) => JSON.stringify(current[key]) !== JSON.stringify(value))
    .map(([key]) => key)
}

async function main(): Promise<void> {
  const confirm = process.argv.includes('--confirm')
  const supabase = createAdminClient()

  const { data: eventData, error: eventError } = await supabase
    .from('events')
    .select('*')
    .eq('id', EVENT_ID)
    .maybeSingle()

  const event = assertScriptQuerySucceeded({
    operation: 'Load Only Fools quiz',
    error: eventError,
    data: eventData,
  }) as EventIdentity & Record<string, unknown>

  const allowedNames = new Set([
    'Lovely Jubbly: Only Fools and Horses Quiz Night',
    EVENT_NAME,
  ])
  if (event.date !== EVENT_DATE || !allowedNames.has(event.name)) {
    throw new Error(`Unexpected target event: ${event.name} on ${event.date}`)
  }

  const { data: faqData, error: faqError } = await supabase
    .from('event_faqs')
    .select('id, question, answer, sort_order')
    .eq('event_id', EVENT_ID)
    .order('sort_order')

  const existingFaqs = (assertScriptQuerySucceeded({
    operation: 'Load event FAQs',
    error: faqError,
    data: faqData ?? [],
  }) ?? []) as EventFaq[]

  if (existingFaqs.length !== 5) {
    throw new Error(`Expected 5 event FAQs, found ${existingFaqs.length}`)
  }

  const fields = changedFields(event)
  const faqChanges = faqs.filter((faq, index) => {
    const current = existingFaqs.find((row) => row.sort_order === index)
    return !current || current.question !== faq.question || current.answer !== faq.answer
  })
  const seoValidation = validateGeneratedContent(
    {
      metaTitle: eventUpdate.meta_title,
      metaDescription: eventUpdate.meta_description,
      shortDescription: eventUpdate.short_description,
      longDescription: eventUpdate.long_description,
      highlights: eventUpdate.highlights,
      keywords: eventUpdate.keywords,
      slug: event.slug,
      imageAltText: eventUpdate.image_alt_text,
      faqs,
    },
    {
      facts: {
        name: EVENT_NAME,
        date: EVENT_DATE,
        primaryKeywords,
        secondaryKeywords,
        localSeoKeywords,
      },
      requireKeywords: true,
      mode: 'final',
    },
  )
  if (!seoValidation.passed) {
    const blockingIssues = seoValidation.issues
      .filter((issue) => issue.severity !== 'warning')
      .map((issue) => issue.message)
    throw new Error(`SEO validation failed: ${blockingIssues.join(' | ')}`)
  }

  console.log(`[${SCRIPT_NAME}] ${confirm ? 'MUTATION' : 'DRY RUN'}`)
  console.log(`[${SCRIPT_NAME}] event fields to update: ${fields.join(', ') || 'none'}`)
  console.log(`[${SCRIPT_NAME}] FAQs to update or insert: ${faqChanges.length}`)
  console.log(`[${SCRIPT_NAME}] SEO validation passed.`)

  if (!confirm) {
    console.log(`[${SCRIPT_NAME}] No database changes made.`)
    return
  }

  assertScriptMutationAllowed({ scriptName: SCRIPT_NAME, envVar: CONFIRM_ENV })

  if (fields.length > 0) {
    const { data, error } = await supabase
      .from('events')
      .update(eventUpdate)
      .eq('id', EVENT_ID)
      .eq('date', EVENT_DATE)
      .select('id')

    if (error) throw new Error(`Update event failed: ${error.message}`)
    assertScriptExpectedRowCount({
      operation: 'Update Only Fools charity quiz',
      expected: 1,
      actual: data?.length ?? 0,
    })
  }

  for (const [sortOrder, faq] of faqs.entries()) {
    const existing = existingFaqs.find((row) => row.sort_order === sortOrder)
    if (existing) {
      if (existing.question === faq.question && existing.answer === faq.answer) continue
      const { data, error } = await supabase
        .from('event_faqs')
        .update({ question: faq.question, answer: faq.answer })
        .eq('id', existing.id)
        .eq('event_id', EVENT_ID)
        .select('id')
      if (error) throw new Error(`Update FAQ ${sortOrder} failed: ${error.message}`)
      assertScriptExpectedRowCount({
        operation: `Update FAQ ${sortOrder}`,
        expected: 1,
        actual: data?.length ?? 0,
      })
    } else {
      const { data, error } = await supabase
        .from('event_faqs')
        .insert({
          event_id: EVENT_ID,
          question: faq.question,
          answer: faq.answer,
          sort_order: sortOrder,
        })
        .select('id')
      if (error) throw new Error(`Insert FAQ ${sortOrder} failed: ${error.message}`)
      assertScriptExpectedRowCount({
        operation: `Insert FAQ ${sortOrder}`,
        expected: 1,
        actual: data?.length ?? 0,
      })
    }
  }

  const [{ data: verifiedEvent, error: verifiedEventError }, { data: verifiedFaqs, error: verifiedFaqError }] =
    await Promise.all([
      supabase.from('events').select('*').eq('id', EVENT_ID).single(),
      supabase
        .from('event_faqs')
        .select('question, answer, sort_order')
        .eq('event_id', EVENT_ID)
        .order('sort_order'),
    ])

  if (verifiedEventError) throw new Error(`Verify event failed: ${verifiedEventError.message}`)
  if (verifiedFaqError) throw new Error(`Verify FAQs failed: ${verifiedFaqError.message}`)

  const remainingFields = changedFields(verifiedEvent as Record<string, unknown>)
  if (remainingFields.length > 0) {
    throw new Error(`Event verification failed for: ${remainingFields.join(', ')}`)
  }
  const verifiedListingText = JSON.stringify({ event: verifiedEvent, faqs: verifiedFaqs })
  if (/village hall/i.test(verifiedListingText)) {
    throw new Error('Event verification failed: Village Hall wording remains')
  }
  if (!verifiedListingText.includes('Stanwell Moor Community Wellbeing Garden')) {
    throw new Error('Event verification failed: Community Wellbeing Garden partnership is missing')
  }
  assertScriptExpectedRowCount({
    operation: 'Verify event FAQs',
    expected: faqs.length,
    actual: verifiedFaqs?.length ?? 0,
  })
  for (const [index, faq] of faqs.entries()) {
    const verified = verifiedFaqs?.[index]
    if (
      !verified ||
      verified.sort_order !== index ||
      verified.question !== faq.question ||
      verified.answer !== faq.answer
    ) {
      throw new Error(`FAQ verification failed at sort order ${index}`)
    }
  }

  console.log(`[${SCRIPT_NAME}] Update and verification complete.`)
}

void main().catch((error) => {
  console.error(`[${SCRIPT_NAME}] Failed`, error)
  process.exitCode = 1
})

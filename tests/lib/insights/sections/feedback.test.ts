import { describe, expect, it } from 'vitest'
import { buildInsightsReport } from '@/lib/insights/engine'
import { buildFeedbackSection, feedbackSection } from '@/lib/insights/sections/feedback'
import { scoreSignal } from '@/lib/insights/signals'
import { EMAIL_BUDGET, FEEDBACK } from '@/lib/insights/thresholds'
import type { InsightSignal, SectionBuildResult } from '@/lib/insights/types'
import { FakeDb } from '../helpers/fake-db'
import { makeContext, TEST_APP_URL } from '../helpers/context'

// makeContext: Friday 25 Sep 2026 06:00 London (05:00 UTC). Today 2026-09-25, this week
// 18 to 24 Sep, the 4-week theme window 28 Aug to 24 Sep. London is on BST (UTC+1), so a
// London midnight is 23:00Z the day before.

type Row = Record<string, unknown>

const INBOX = `${TEST_APP_URL}/feedback-inbox`
const NAME = 'Jane Testperson'

let sequence = 0

function feedback(overrides: Row = {}): Row {
  sequence += 1
  return {
    id: `fb-${String(sequence).padStart(3, '0')}`,
    rating: 4,
    comments: 'Nice evening overall.',
    customer_name: null,
    customer_email: null,
    customer_phone: null,
    contact_consent: false,
    status: 'resolved',
    created_at: '2026-09-20T12:00:00.000Z',
    ...overrides,
  }
}

async function build(rows: Row[], now?: Date): Promise<SectionBuildResult> {
  return buildFeedbackSection(makeContext(new FakeDb({ review_feedback: rows }), now))
}

function byKey(result: SectionBuildResult, prefix: string): InsightSignal[] {
  return result.signals.filter((signal) => signal.key.startsWith(prefix))
}

/** Every piece of the result that can reach the email or the printed copy. */
function emailText(result: SectionBuildResult): string {
  return JSON.stringify({
    headline: result.headline,
    metrics: result.metrics,
    notes: result.notes,
    signals: result.signals.filter((signal) => signal.emailSafe).map((signal) => signal.text),
    actions: result.signals.map((signal) => signal.action),
  })
}

function expectNoBrokenValues(result: SectionBuildResult): void {
  const text = JSON.stringify(result)
  expect(text).not.toMatch(/undefined|NaN|Invalid Date|null/)
}

describe('feedback section', () => {
  it('is registered under the feedback key with the inbox as its page', () => {
    expect(feedbackSection).toMatchObject({ key: 'feedback', title: 'Customer feedback', path: '/feedback-inbox' })
  })

  it('reads review_feedback only, through paged selects', async () => {
    const fake = new FakeDb({ review_feedback: [] })
    await buildFeedbackSection(makeContext(fake))
    expect(fake.calls.length).toBeGreaterThan(0)
    expect(fake.calls.every((call) => call.table === 'review_feedback' && call.kind === 'select')).toBe(true)
  })

  it('shows a green all-clear when there is nothing new or outstanding', async () => {
    const result = await build([])
    expect(result.headline).toBe('No new or outstanding feedback.')
    expect(result.signals).toEqual([
      { key: 'feedback.all_clear', rag: 'green', kind: 'info', text: 'No new or outstanding feedback.', emailSafe: true },
    ])
    expect(result.metrics).toEqual([
      { label: 'Outstanding', value: '0' },
      { label: 'Needing action now', value: '0' },
      { label: 'New this week', value: '0' },
      { label: 'Received in the last 4 weeks', value: '0' },
    ])
    expect(result.lists).toEqual([
      { title: 'New this week', emptyText: 'No new feedback this week.', items: [] },
      { title: 'Outstanding, oldest first', emptyText: 'Nothing outstanding.', items: [] },
    ])
    expect(result.notes).toEqual([])
    expect(result.upcoming).toBeUndefined()
    expectNoBrokenValues(result)
  })

  it('says new items were dealt with when this week had feedback but none is open', async () => {
    const one = await build([feedback({ status: 'resolved', created_at: '2026-09-22T10:00:00.000Z' })])
    expect(one.headline).toBe('No outstanding feedback: the one new item this week has been dealt with.')
    expect(one.signals).toHaveLength(1)
    expect(one.signals[0]).toMatchObject({ key: 'feedback.all_clear', rag: 'green', kind: 'info' })

    const two = await build([
      feedback({ status: 'resolved', created_at: '2026-09-22T10:00:00.000Z', rating: 2 }),
      feedback({ status: 'dismissed', created_at: '2026-09-23T10:00:00.000Z', rating: 5 }),
    ])
    expect(two.headline).toBe('No outstanding feedback: all 2 new items this week have been dealt with.')
    expect(two.metrics[2]).toEqual({ label: 'New this week', value: '2', comparison: 'average 3.5 stars' })
  })

  describe('signal table', () => {
    it('makes an unresolved item rated 2 or below red, with a follow-up action on the inbox', async () => {
      const row = feedback({ status: 'new', rating: 2, comments: 'Nice enough.', created_at: '2026-09-23T18:00:00.000Z' })
      const result = await build([row])
      expect(result.signals).toEqual([{
        key: `feedback.low_rating.${row.id}`,
        entity: `feedback:${row.id}`,
        rag: 'red',
        kind: 'issue',
        text: '2-star feedback from Wed 23 Sep, not yet picked up, open 2 days: "Nice enough."',
        emailSafe: true,
        action: {
          text: 'Follow up the 2-star feedback from Wed 23 Sep',
          href: INBOX,
          target: 'list',
          // Red from the day it arrived, so it is due that day.
          dueDate: '2026-09-23',
          impact: 'customer',
        },
      }])
      expect(result.headline).toBe('1 feedback item outstanding, 1 needing action now; 1 new this week.')
    })

    it('makes an unresolved item tagged safety red, whatever its rating, with safety impact', async () => {
      const row = feedback({ status: 'in_progress', rating: 5, comments: 'Lovely staff but my son had an ALLERGIC reaction.', created_at: '2026-09-24T12:00:00.000Z' })
      const result = await build([row])
      const [signal] = byKey(result, 'feedback.safety.')
      expect(signal).toMatchObject({ rag: 'red', kind: 'issue', entity: `feedback:${row.id}`, emailSafe: true })
      expect(signal.text).toContain('tagged staff and safety')
      expect(signal.action).toMatchObject({
        text: 'Check the safety concern in the 5-star feedback from Thu 24 Sep',
        href: INBOX,
        target: 'list',
        dueDate: '2026-09-24',
        impact: 'safety',
      })
      expect(result.notes).toContain('Themes come from keywords in the comment, so check the wording before acting on a tag.')
    })

    it('makes an unresolved item older than 14 days red, and one exactly 14 days old amber', async () => {
      const old = feedback({ status: 'in_progress', rating: 3, comments: null, created_at: '2026-09-10T12:00:00.000Z' })
      const edge = feedback({ status: 'new', rating: 4, comments: null, created_at: '2026-09-11T12:00:00.000Z' })
      const result = await build([old, edge])
      const [red] = byKey(result, 'feedback.old_unresolved.')
      expect(red).toMatchObject({
        key: `feedback.old_unresolved.${old.id}`,
        rag: 'red',
        text: '3-star feedback from Thu 10 Sep, in progress, open 15 days, with no comment.',
      })
      expect(red.action).toMatchObject({ text: 'Resolve or close the 3-star feedback from Thu 10 Sep, open 15 days', dueDate: '2026-09-24' })
      const [amber] = byKey(result, 'feedback.unresolved.')
      expect(amber).toMatchObject({ key: `feedback.unresolved.${edge.id}`, rag: 'amber' })
      expect(amber.action?.text).toBe('Review the 4-star feedback from Fri 11 Sep')
    })

    it('ranks a new safety or low-rated item at least as high as stale open feedback', async () => {
      const safety = feedback({ status: 'new', rating: 1, comments: 'My son had an allergic reaction.', created_at: '2026-09-24T12:00:00.000Z' })
      const low = feedback({ status: 'new', rating: 2, comments: 'Poor evening.', created_at: '2026-09-24T13:00:00.000Z' })
      const stale = feedback({ status: 'new', rating: 4, comments: 'Fine.', created_at: '2026-08-01T12:00:00.000Z' })
      const result = await build([safety, low, stale])
      const today = '2026-09-25'
      const [safetySignal] = byKey(result, `feedback.safety.${safety.id}`)
      const [lowSignal] = byKey(result, `feedback.low_rating.${low.id}`)
      const [staleSignal] = byKey(result, `feedback.old_unresolved.${stale.id}`)
      expect(safetySignal.action?.dueDate).toBe('2026-09-24')
      expect(lowSignal.action?.dueDate).toBe('2026-09-24')
      expect(staleSignal.action?.dueDate).toBe('2026-08-15')
      // Red, due now and customer or safety impact: the top of the scale for a red.
      expect(scoreSignal(safetySignal, today)).toBe(390)
      expect(scoreSignal(safetySignal, today)).toBeGreaterThanOrEqual(scoreSignal(staleSignal, today))
      expect(scoreSignal(lowSignal, today)).toBeGreaterThanOrEqual(scoreSignal(staleSignal, today))

      // Through the engine the safety concern is the biggest concern, not the stale item.
      const report = await buildInsightsReport({
        createDb: () => new FakeDb({ review_feedback: [safety, low, stale] }).asDb(),
        now: new Date('2026-09-25T05:00:00Z'),
        appUrl: TEST_APP_URL,
        sections: [feedbackSection],
        logFailure: () => undefined,
      })
      expect(report.summary.biggestConcern?.text).toContain('allergic reaction')
      expect(report.actions.map((action) => action.signalKey)).toEqual(expect.arrayContaining([
        `feedback.safety.${safety.id}`,
        `feedback.low_rating.${low.id}`,
        `feedback.old_unresolved.${stale.id}`,
      ]))
    })

    it('keeps an amber item due when it would turn red, 14 days after it arrived', async () => {
      const row = feedback({ status: 'new', rating: 4, comments: 'Could be better.', created_at: '2026-09-24T12:00:00.000Z' })
      const [signal] = (await build([row])).signals
      expect(signal).toMatchObject({ key: `feedback.unresolved.${row.id}`, rag: 'amber' })
      expect(signal.action?.dueDate).toBe('2026-10-08')
    })

    it('makes any other unresolved item amber', async () => {
      const row = feedback({ status: 'new', rating: 4, comments: 'Could be better.', created_at: '2026-09-21T12:00:00.000Z' })
      const result = await build([row])
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0]).toMatchObject({ key: `feedback.unresolved.${row.id}`, rag: 'amber', kind: 'issue' })
      expect(result.headline).toBe('1 feedback item outstanding; 1 new this week.')
      expect(result.metrics[1]).toEqual({ label: 'Needing action now', value: '0' })
    })

    it('raises an amber theme when the same tag is on 2 or more items in 4 weeks, whatever their status', async () => {
      const result = await build([
        feedback({ status: 'resolved', comments: 'The roast was cold.', created_at: '2026-09-02T12:00:00.000Z' }),
        feedback({ status: 'resolved', comments: 'Tiny portion for the price.', created_at: '2026-09-15T12:00:00.000Z' }),
        feedback({ status: 'resolved', comments: 'We waited an hour.', created_at: '2026-09-16T12:00:00.000Z' }),
      ])
      const themes = byKey(result, 'feedback.repeat_theme.')
      expect(themes).toEqual([{
        key: 'feedback.repeat_theme.food',
        rag: 'amber',
        kind: 'issue',
        text: 'Food came up in 2 feedback items in the last 4 weeks.',
        emailSafe: true,
        action: { text: 'Look into the repeated food feedback: 2 items in 4 weeks', href: INBOX, target: 'list', impact: 'customer' },
      }])
      expect(result.notes).toContain('Themes come from keywords in the comment, so check the wording before acting on a tag.')
      // No open items, so the green line still shows beside the theme.
      expect(byKey(result, 'feedback.all_clear')).toHaveLength(1)
    })

    it('counts the theme window as 28 Aug to 24 Sep and leaves out dismissed items', async () => {
      const outside = await build([
        feedback({ comments: 'Rude barman.', created_at: '2026-08-27T22:59:59.000Z' }),
        feedback({ comments: 'Staff were slow to notice us.', created_at: '2026-09-20T12:00:00.000Z' }),
        feedback({ comments: 'Unfriendly attitude.', status: 'dismissed', created_at: '2026-09-21T12:00:00.000Z' }),
        feedback({ comments: 'Rude waiter.', status: 'new', created_at: '2026-09-25T00:30:00.000Z' }),
      ])
      expect(byKey(outside, 'feedback.repeat_theme.staff')).toEqual([])

      const inside = await build([
        feedback({ comments: 'Rude barman.', created_at: '2026-08-27T23:00:00.000Z' }),
        feedback({ comments: 'Staff were slow to notice us.', created_at: '2026-09-20T12:00:00.000Z' }),
      ])
      expect(byKey(inside, 'feedback.repeat_theme.staff')).toHaveLength(1)
      expect(inside.metrics[3]).toEqual({ label: 'Received in the last 4 weeks', value: '2' })
    })

    it('raises a safety theme with safety impact, as amber', async () => {
      const result = await build([
        feedback({ comments: 'Broken glass on the patio.', created_at: '2026-09-01T12:00:00.000Z' }),
        feedback({ comments: 'Nobody told us about the allergens.', created_at: '2026-09-03T12:00:00.000Z' }),
        feedback({ comments: 'The floor by the bar was slippery.', created_at: '2026-09-05T12:00:00.000Z' }),
      ])
      const [safety] = byKey(result, 'feedback.repeat_theme.safety')
      expect(safety).toMatchObject({ rag: 'amber', text: 'Safety came up in 3 feedback items in the last 4 weeks.' })
      expect(safety.action?.impact).toBe('safety')
    })
  })

  describe('tagging', () => {
    async function tagsOf(comment: string): Promise<string> {
      const result = await build([feedback({ status: 'new', rating: 4, comments: comment, created_at: '2026-09-24T12:00:00.000Z' })])
      return result.signals[0].text
    }

    it('matches whole words and phrases, ignoring case and line breaks', async () => {
      expect(await tagsOf('Sat by the border, very CLEANER than last time')).not.toContain('tagged')
      expect(await tagsOf('A lovely glass of wine by the log fire')).not.toContain('tagged')
      expect(await tagsOf('The service fell short')).toContain('tagged service')
      expect(await tagsOf('The service fell short')).not.toContain('safety')
      expect(await tagsOf('I think it was FOOD\npoisoning')).toContain('tagged food and safety')
      expect(await tagsOf("The staff's attitude")).toContain('tagged staff')
    })

    async function ruleOf(comment: string): Promise<string> {
      const result = await build([feedback({ status: 'new', rating: 4, comments: comment, created_at: '2026-09-23T12:00:00.000Z' })])
      return result.signals[0].key.split('.')[1]
    }

    it('tags every configured safety keyword, so each one makes a 4-star item red', async () => {
      for (const keyword of FEEDBACK.themes.safety) {
        expect({ keyword, rule: await ruleOf(`We noticed ${keyword} near the bar.`) }).toEqual({ keyword, rule: 'safety' })
      }
    })

    it('tags common wording for falls, glass, trips, allergens, burns, cuts and fire as safety', async () => {
      const concerns = [
        'My mum fell on the stairs by the toilets.',
        'My dad fell off the bar stool.',
        'A tile fell from the ceiling.',
        'My nan had a fall in the car park.',
        'There was glass in my pint.',
        'Found a shard in the salad.',
        'I got a chipped glass and cut my lip.',
        'I tripped on the loose carpet, dangerous.',
        'The step by the door is a trip hazard.',
        'The cable across the floor is a hazard.',
        'Gave my coeliac daughter gluten.',
        'The gluten free bun had gluten in it.',
        'Told them about his nut allergy and the dessert contained nuts.',
        'The burger wasn’t gluten free after all.',
        'My friend choked on a bone.',
        'I burned myself on the plate.',
        'I cut myself on the menu holder.',
        'The fire exit was blocked with kegs.',
        'The smoke alarm went off and nobody moved.',
      ]
      for (const comment of concerns) {
        expect({ comment, rule: await ruleOf(comment) }).toEqual({ comment, rule: 'safety' })
      }
    })

    it('does not tag everyday wording as safety', async () => {
      const everyday = [
        'A lovely glass of wine by the log fire.',
        'The service fell short.',
        'Worth the trip, great gluten free menu.',
        'We enjoyed a glass in the garden.',
        'Our complaint fell on deaf ears.',
        'Loved the smoked salmon.',
        'A day trip with the family.',
        'The brownie with nuts was lovely.',
        'We fell in love with the place.',
      ]
      for (const comment of everyday) {
        expect({ comment, rule: await ruleOf(comment) }).toEqual({ comment, rule: 'unresolved' })
      }
    })

    it('keeps several open safety concerns visible as a red safety line in the email', async () => {
      const rows = [
        'My mum fell on the stairs by the toilets.',
        'There was glass in my pint.',
        'I tripped on the loose carpet, dangerous.',
        'Gave my coeliac daughter gluten.',
      ].map((comments) => feedback({ status: 'new', rating: 4, comments, created_at: '2026-09-23T12:00:00.000Z' }))
      const result = await build(rows)
      expect(result.signals.map((signal) => signal.key)).toEqual(['feedback.safety.merged', 'feedback.repeat_theme.safety'])
      expect(result.signals[0]).toMatchObject({
        rag: 'red',
        emailSafe: true,
        text: '4 unresolved feedback items mention safety.',
        action: { text: 'Check the safety concerns in 4 feedback items', impact: 'safety', dueDate: '2026-09-23' },
      })
      expect(result.signals[0].action?.members).toHaveLength(4)
      expect(result.signals[1]).toMatchObject({ rag: 'amber', text: 'Safety came up in 4 feedback items in the last 4 weeks.' })
    })
  })

  describe('lists and names', () => {
    it('lists every outstanding item of any age, oldest first, with its age in days', async () => {
      const result = await build([
        feedback({ id: 'b', status: 'new', rating: 4, comments: 'Second.', created_at: '2026-08-23T16:50:45.000Z' }),
        feedback({ id: 'a', status: 'in_progress', rating: 3, comments: 'First.', created_at: '2026-01-10T12:00:00.000Z' }),
        feedback({ id: 'c', status: 'new', rating: 4, comments: 'Third.', created_at: '2026-09-25T04:30:00.000Z' }),
        feedback({ id: 'd', status: 'resolved', rating: 1, comments: 'Done.', created_at: '2026-09-01T12:00:00.000Z' }),
      ])
      const outstanding = result.lists.find((list) => list.title === 'Outstanding, oldest first')
      expect(outstanding?.items.map((item) => item.text)).toEqual([
        'Sat 10 Jan, open 258 days: 3-star, in progress: "First."',
        'Sun 23 Aug, open 33 days: 4-star, not yet picked up: "Second."',
        'Fri 25 Sep, received today: 4-star, not yet picked up: "Third."',
      ])
      expect(outstanding?.items.map((item) => item.rag)).toEqual(['red', 'red', 'amber'])
      expect(outstanding?.items.every((item) => item.href === INBOX)).toBe(true)
      expect(result.metrics[0]).toEqual({ label: 'Outstanding', value: '3', comparison: '2 not yet picked up, oldest 258 days' })
      expect(result.metrics[1]).toEqual({ label: 'Needing action now', value: '2' })
      // Received today is outstanding but not part of "this week", which ends yesterday.
      expect(result.headline).toBe('3 feedback items outstanding, 2 needing action now; no new feedback this week.')
    })

    it('lists new this week by London date, with rating, status and comment', async () => {
      const result = await build([
        feedback({ status: 'resolved', rating: 2, comments: 'Cold chips.', created_at: '2026-09-17T23:30:00.000Z' }),
        feedback({ status: 'new', rating: 3, comments: null, created_at: '2026-09-24T22:59:59.000Z' }),
        feedback({ status: 'new', rating: 5, comments: 'Late one.', created_at: '2026-09-24T23:30:00.000Z' }),
        feedback({ status: 'resolved', rating: 1, comments: 'Too early.', created_at: '2026-09-17T22:59:59.000Z' }),
      ])
      const fresh = result.lists.find((list) => list.title === 'New this week')
      expect(fresh?.items).toEqual([
        { text: 'Fri 18 Sep: 2-star, resolved, tagged food: "Cold chips."', href: INBOX },
        { text: 'Thu 24 Sep: 3-star, not yet picked up, with no comment.', href: INBOX, rag: 'amber' },
      ])
      expect(result.metrics[2]).toEqual({ label: 'New this week', value: '2', comparison: 'average 2.5 stars' })
    })

    it('shows the contact name on the page only, and only with consent', async () => {
      const consented = feedback({ status: 'new', rating: 1, comments: 'Please call me back.', contact_consent: true, customer_name: NAME, customer_email: 'jane@example.test', created_at: '2026-09-22T12:00:00.000Z' })
      const refused = feedback({ status: 'new', rating: 2, comments: 'No thanks.', contact_consent: false, customer_name: 'Hidden Person', created_at: '2026-09-23T12:00:00.000Z' })
      const result = await build([consented, refused])
      const pageText = JSON.stringify(result.lists)
      expect(pageText).toContain(`1-star from ${NAME}, not yet picked up`)
      expect(pageText).not.toContain('Hidden Person')
      expect(pageText).not.toContain('jane@example.test')
      expect(emailText(result)).not.toContain(NAME)
      expect(emailText(result)).not.toContain('Hidden Person')
      expect(result.signals.every((signal) => signal.emailSafe)).toBe(true)
      const [first] = byKey(result, `feedback.low_rating.${consented.id}`)
      expect(first.text).toBe('1-star feedback from Tue 22 Sep (the guest agreed to be contacted), not yet picked up, open 3 days: "Please call me back."')
      expect(first.action?.text).not.toContain(NAME)
    })

    it('clips long comments to the email budget', async () => {
      const long = `${'The food was cold and '.repeat(30)}end`
      const result = await build([feedback({ status: 'new', rating: 2, comments: long, created_at: '2026-09-22T12:00:00.000Z' })])
      const text = result.signals[0].text
      const quoted = text.slice(text.indexOf('"') + 1, -1)
      expect(quoted.endsWith('...')).toBe(true)
      expect(quoted.length).toBeLessThanOrEqual(EMAIL_BUDGET.commentChars + 3)
      expect(text).not.toContain('end"')
      expect(JSON.stringify(result.lists)).not.toContain('end"')
    })
  })

  describe('merging', () => {
    it('keeps up to 3 like items as their own actions', async () => {
      const rows = [1, 2, 3].map((day) => feedback({ status: 'new', rating: 3, comments: null, created_at: `2026-08-0${day}T12:00:00.000Z` }))
      const result = await build(rows)
      expect(byKey(result, 'feedback.old_unresolved.')).toHaveLength(3)
      expect(result.signals.every((signal) => signal.entity?.startsWith('feedback:'))).toBe(true)
    })

    it('merges more than 3 like items into one list action with every item as a member', async () => {
      const rows = [1, 2, 3, 4].map((day) => feedback({ status: 'new', rating: 3, comments: null, created_at: `2026-08-0${day}T12:00:00.000Z` }))
      const amber = feedback({ status: 'new', rating: 4, comments: null, created_at: '2026-09-22T12:00:00.000Z' })
      const result = await build([...rows, amber])
      const merged = byKey(result, 'feedback.old_unresolved.')
      expect(merged).toHaveLength(1)
      expect(merged[0]).toMatchObject({
        key: 'feedback.old_unresolved.merged',
        rag: 'red',
        kind: 'issue',
        emailSafe: true,
        text: '4 feedback items have been open more than 14 days.',
      })
      expect(merged[0].action).toMatchObject({
        text: 'Resolve or close 4 feedback items open more than 14 days',
        href: INBOX,
        target: 'list',
        impact: 'customer',
        dueDate: '2026-08-15',
      })
      expect(merged[0].action?.members).toEqual([
        'Resolve or close the 3-star feedback from Sat 1 Aug, open 55 days',
        'Resolve or close the 3-star feedback from Sun 2 Aug, open 54 days',
        'Resolve or close the 3-star feedback from Mon 3 Aug, open 53 days',
        'Resolve or close the 3-star feedback from Tue 4 Aug, open 52 days',
      ])
      // Other rules keep their own items.
      expect(byKey(result, `feedback.unresolved.${amber.id}`)).toHaveLength(1)
      // The page list still shows every item.
      expect(result.lists[1].items).toHaveLength(5)
      expect(result.headline).toBe('5 feedback items outstanding, 4 needing action now; 1 new this week.')
    })

    it('merges amber items as amber, keeping the earliest due date', async () => {
      const rows = [18, 19, 20, 21].map((day) => feedback({ status: 'new', rating: 4, comments: 'Fine.', created_at: `2026-09-${day}T12:00:00.000Z` }))
      const result = await build(rows)
      expect(result.signals).toHaveLength(1)
      expect(result.signals[0]).toMatchObject({
        key: 'feedback.unresolved.merged',
        rag: 'amber',
        text: '4 feedback items are open, all within 14 days.',
        action: { text: 'Review 4 open feedback items', target: 'list', href: INBOX, dueDate: '2026-10-02' },
      })
      expect(result.signals[0].action?.members).toHaveLength(4)
    })
  })

  describe('history', () => {
    it('notes when the theme window starts before feedback collection began, and still counts real repeats', async () => {
      // Monday 20 Jul 2026 06:00 London: the 4-week window starts 22 Jun, before 5 Jul.
      const result = await build([
        feedback({ comments: 'Dirty toilets.', created_at: '2026-07-06T12:00:00.000Z' }),
        feedback({ comments: 'Toilet was a mess.', created_at: '2026-07-12T12:00:00.000Z' }),
      ], new Date('2026-07-20T05:00:00Z'))
      expect(result.notes).toContain('Feedback collection began on 5 Jul 2026, so the theme check covers less than 4 weeks so far.')
      expect(byKey(result, 'feedback.repeat_theme.cleanliness')).toHaveLength(1)
    })

    it('adds no history note once 4 weeks have been collected', async () => {
      const result = await build([])
      expect(result.notes.some((note) => note.includes('collection began'))).toBe(false)
    })
  })

  it('fails loudly when the table cannot be read, so the section is not checked', async () => {
    const fake = new FakeDb({ review_feedback: [] }).fail('review_feedback', 'permission denied')
    await expect(buildFeedbackSection(makeContext(fake))).rejects.toThrow(/permission denied/)
  })

  it('produces a red section with one action per record through the engine', async () => {
    const low = feedback({ status: 'new', rating: 1, comments: 'Cold food and broken glass by the door.', created_at: '2026-09-23T12:00:00.000Z' })
    const fake = new FakeDb({ review_feedback: [low] })
    const report = await buildInsightsReport({
      createDb: () => fake.asDb(),
      now: new Date('2026-09-25T05:00:00Z'),
      appUrl: TEST_APP_URL,
      sections: [feedbackSection],
      logFailure: () => undefined,
    })
    const [section] = report.sections
    expect(section.status).toBe('red')
    expect(section.signals.filter((signal) => signal.action)).toHaveLength(1)
    expect(section.signals[0].key).toBe(`feedback.safety.${low.id}`)
    expect(report.actions[0]).toMatchObject({ sectionKey: 'feedback', target: 'list', href: INBOX, impact: 'safety' })
    expectNoBrokenValues({ headline: section.headline, metrics: section.metrics, lists: section.lists, signals: section.signals, notes: section.notes })
  })
})

import { describe, expect, it } from 'vitest'

import {
  describeReturnVisitFilter,
  describeSendDays,
  lifecycleContentProblems,
  parseLifecycleSettings,
} from '../lifecycle'
import type { MarketingContent } from '../registry'
import type { ReturnVisitFilter } from '@/types/marketing'

const TOUCH_1: ReturnVisitFilter = {
  rule: 'table_return_visit',
  touch: 1,
  days_since_anchor_min: 45,
  days_since_anchor_max: 180,
  include_no_shows: true,
  voucher_type_id: 'return-10',
  voucher_valid_days: 30,
}

function content(blocks: unknown[]): MarketingContent {
  return { title: 'Come back', preheader: 'Inside', blocks } as unknown as MarketingContent
}

const CARD = {
  type: 'voucher_card',
  data: { number: '{{voucher_number}}', expiry_date: '{{voucher_expires_on}}', first_name: '{{first_name|}}' },
}

describe('parseLifecycleSettings', () => {
  it('accepts the touch 1 settings and tidies the send days', () => {
    const parsed = parseLifecycleSettings({
      customerFilter: TOUCH_1,
      cooldownDays: 365,
      sendDays: [4, 4],
      promoteAtLocal: '16:00',
      holdoutPercent: 20,
    })
    expect(parsed.sendDays).toEqual([4])
  })

  it.each([
    ['a holdout above half', { holdoutPercent: 60 }],
    ['no send days', { sendDays: [] }],
    ['a 12-hour time', { promoteAtLocal: '4pm' }],
    ['a window the wrong way round', { customerFilter: { ...TOUCH_1, days_since_anchor_min: 200 } }],
    ['touch 2 without touch 1', { customerFilter: { ...TOUCH_1, touch: 2, days_since_previous_touch_min: 45 } }],
  ])('refuses %s', (_label, override) => {
    expect(() =>
      parseLifecycleSettings({
        customerFilter: TOUCH_1,
        cooldownDays: 365,
        sendDays: [4],
        promoteAtLocal: '16:00',
        holdoutPercent: 20,
        ...override,
      }),
    ).toThrow(/return-visit settings are invalid/)
  })
})

describe('lifecycleContentProblems', () => {
  it('passes copy with one voucher card carrying the number and date', () => {
    expect(lifecycleContentProblems(content([CARD]), TOUCH_1)).toEqual([])
  })

  it('refuses a token nobody fills', () => {
    const problems = lifecycleContentProblems(content([CARD, { type: 'text_block', data: { text: 'Hi {{surname}}' } }]), TOUCH_1)
    expect(problems.join(' ')).toContain('{{surname}}')
  })

  it('refuses a voucher email with no voucher card, or two', () => {
    expect(lifecycleContentProblems(content([]), TOUCH_1)).toContain('A voucher email needs exactly one voucher card')
    expect(lifecycleContentProblems(content([CARD, CARD]), TOUCH_1)).toContain('A voucher email needs exactly one voucher card')
  })

  it('refuses a card without the per-guest number', () => {
    const card = { type: 'voucher_card', data: { number: 'AN-2611-0042', expiry_date: '{{voucher_expires_on}}' } }
    expect(lifecycleContentProblems(content([card]), TOUCH_1)).toContain('The voucher card must show {{voucher_number}}')
  })
})

describe('descriptions', () => {
  it('names the send days in order', () => {
    expect(describeSendDays([4])).toBe('Thursday')
    expect(describeSendDays([3, 4, 6])).toBe('Wednesday, Thursday and Saturday')
    expect(describeSendDays(null)).toBe('No send days')
  })

  it('says who touch 1 picks', () => {
    expect(describeReturnVisitFilter(TOUCH_1)).toBe(
      'Guests whose last table visit was 45 to 180 days ago and who have not booked since, no-shows included. They get a 30-day return-10 voucher.',
    )
  })
})

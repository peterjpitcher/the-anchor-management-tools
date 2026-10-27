import { describe, expect, it } from 'vitest'
import { isUkMobile } from '@/lib/phone/uk-mobile'

describe('isUkMobile (BK-162)', () => {
  it.each([
    ['+447123456789', 'E.164 UK mobile'],
    ['07123 456789', 'national format'],
    ['+447624312345', 'Isle of Man mobile, texted like a UK one'],
    ['+447781123456', 'Guernsey mobile'],
  ])('accepts %s (%s)', (phone: string, _why: string) => {
    expect(isUkMobile(phone)).toBe(true)
  })

  it.each([
    ['+441753682707', 'a landline'],
    ['01753 682707', 'a landline in national format'],
    ['+447000123456', 'a 070 personal number, the range walk-in placeholders use'],
    ['+12025550123', 'a North American number'],
    ['+353861234567', 'an Irish mobile, outside the UK'],
    ['+447700900123', "Ofcom's drama range, never a real phone"],
    ['', 'nothing'],
    [null, 'null'],
  ])('refuses %s (%s)', (phone: string | null, _why: string) => {
    expect(isUkMobile(phone)).toBe(false)
  })
})

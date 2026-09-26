import { describe, expect, it } from 'vitest'
import { leaveSubtitle } from '@/app/(authenticated)/rota/_shared/layout'

// Every rota tab's subtitle starts with the tab's label ("Timeclock: ...", "Payroll: ...").
describe('leaveSubtitle', () => {
  it('starts with the Leave tab label', () => {
    expect(leaveSubtitle(0)).toBe('Leave: holiday requests')
    expect(leaveSubtitle(1)).toBe('Leave: 1 request pending approval')
    expect(leaveSubtitle(3)).toBe('Leave: 3 requests pending approval')
  })
})

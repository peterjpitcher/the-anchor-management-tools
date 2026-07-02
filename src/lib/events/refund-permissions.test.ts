import { describe, expect, it } from 'vitest'
import { canIssueEventRefund, SHARED_MANAGER_EMAIL } from './refund-permissions'

describe('canIssueEventRefund', () => {
  it('allows a manager', () => {
    expect(canIssueEventRefund({ email: 'sam@the-anchor.pub', roleNames: ['manager'] })).toBe(true)
  })

  it('allows a super_admin', () => {
    expect(canIssueEventRefund({ email: 'boss@the-anchor.pub', roleNames: ['super_admin'] })).toBe(true)
  })

  it('blocks the shared manager@the-anchor.pub account even with the manager role', () => {
    expect(canIssueEventRefund({ email: SHARED_MANAGER_EMAIL, roleNames: ['manager'] })).toBe(false)
    // case-insensitive
    expect(canIssueEventRefund({ email: 'Manager@The-Anchor.PUB', roleNames: ['super_admin'] })).toBe(false)
  })

  it('blocks non-manager staff', () => {
    expect(canIssueEventRefund({ email: 'staff@the-anchor.pub', roleNames: ['staff'] })).toBe(false)
    expect(canIssueEventRefund({ email: 'staff@the-anchor.pub', roleNames: [] })).toBe(false)
  })

  it('blocks a missing email', () => {
    expect(canIssueEventRefund({ email: null, roleNames: ['manager'] })).toBe(false)
    expect(canIssueEventRefund({ email: '  ', roleNames: ['manager'] })).toBe(false)
  })
})

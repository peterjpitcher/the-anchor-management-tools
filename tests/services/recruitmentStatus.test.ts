import { describe, expect, it } from 'vitest'
import { isRecruitmentTransitionAllowed, normalizeRecruitmentName } from '@/services/recruitment'

describe('recruitment candidate names', () => {
  it('normalises capitalisation and whitespace', () => {
    expect(normalizeRecruitmentName('  PAUL  ')).toBe('Paul')
    expect(normalizeRecruitmentName('coelho')).toBe('Coelho')
    expect(normalizeRecruitmentName("ANNE-MARIE O'NEILL")).toBe("Anne-Marie O'Neill")
    expect(normalizeRecruitmentName('  mary   jane  ')).toBe('Mary Jane')
  })

  it('keeps missing names empty', () => {
    expect(normalizeRecruitmentName(null)).toBeNull()
    expect(normalizeRecruitmentName('   ')).toBeNull()
  })
})

describe('recruitment status transitions', () => {
  it('allows normal forward transitions', () => {
    expect(isRecruitmentTransitionAllowed('new', 'ai_screened')).toBe(true)
    expect(isRecruitmentTransitionAllowed('ai_screened', 'shortlisted')).toBe(true)
    expect(isRecruitmentTransitionAllowed('interview_invited', 'interview_scheduled')).toBe(true)
    expect(isRecruitmentTransitionAllowed('trial_scheduled', 'trial_completed')).toBe(true)
    expect(isRecruitmentTransitionAllowed('offered', 'hired')).toBe(true)
  })

  it('blocks backwards and terminal transitions unless forced in the RPC', () => {
    expect(isRecruitmentTransitionAllowed('hired', 'rejected')).toBe(false)
    expect(isRecruitmentTransitionAllowed('rejected', 'shortlisted')).toBe(false)
    expect(isRecruitmentTransitionAllowed('interview_scheduled', 'new')).toBe(false)
  })
})

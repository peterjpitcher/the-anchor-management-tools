import { describe, it, expect } from 'vitest'
import { finalizeRecruitmentEmailBody } from '../communications'
import { RECRUITMENT_EMAIL_SIGNATURE } from '../contact'

const sigCount = (body: string) => (body.match(/Peter Pitcher/g) || []).length

describe('finalizeRecruitmentEmailBody signature de-duplication', () => {
  it('keeps a single signature when the body already ends with one (LF)', () => {
    const body = `Hi Jane,\n\nThanks for applying. Best of luck.\n\n${RECRUITMENT_EMAIL_SIGNATURE}`
    expect(sigCount(finalizeRecruitmentEmailBody(body))).toBe(1)
  })

  it('keeps a single signature when the body uses CRLF line endings (the reported bug)', () => {
    const crlfSignature = RECRUITMENT_EMAIL_SIGNATURE.replace(/\n/g, '\r\n')
    const body = `Hi Jane,\r\n\r\nThanks for applying. Best of luck.\r\n\r\n${crlfSignature}`
    expect(sigCount(finalizeRecruitmentEmailBody(body))).toBe(1)
  })

  it('appends a signature when the body has none', () => {
    const out = finalizeRecruitmentEmailBody('Hi Jane,\n\nWe will not be moving forward this time.')
    expect(sigCount(out)).toBe(1)
    expect(out).toContain('Peter Pitcher')
  })
})

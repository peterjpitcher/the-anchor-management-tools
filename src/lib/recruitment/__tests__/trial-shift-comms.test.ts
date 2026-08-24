import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { RECRUITMENT_TRIAL_DRESS_CODE } from '@/lib/recruitment/contact'
import { generateRecruitmentTrialBriefHtml } from '@/lib/recruitment/trial-brief-template'

const root = join(__dirname, '..', '..', '..', '..')
const read = (relative: string) => readFileSync(join(root, relative), 'utf8')

describe('trial shift dress code', () => {
  it('states the clothes a candidate can actually turn up in', () => {
    expect(RECRUITMENT_TRIAL_DRESS_CODE).toContain('chino shorts, chinos or jeans')
    expect(RECRUITMENT_TRIAL_DRESS_CODE).toContain('block-coloured shirt or t-shirt, no logos')
    expect(RECRUITMENT_TRIAL_DRESS_CODE).toContain('no hats')
    expect(RECRUITMENT_TRIAL_DRESS_CODE).toContain('closed-toe shoes')
  })

  it('injects the dress code into trial confirmations and trial reminders', () => {
    const source = read('src/lib/recruitment/communications.ts')
    // A candidate owns no Anchor kit, so this cannot be left to whoever last
    // edited the stored template.
    expect(source).toContain("const isTrialShiftEmail = type === 'trial_confirmation'")
    expect(source).toContain("|| (type === 'reminder' && appointment?.type === 'trial_shift')")
    expect(source).toContain('preparedBody = ensureTrialDressCode(ensureTrialShiftDetails(preparedBody))')
  })

  it('does not offer the candidate a choice of trial times anywhere in the drawer', () => {
    // Trials are assigned by staff around the rota. Nothing should mint a
    // pick-your-slot link or draft an email asking them to choose.
    const drawer = read('src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx')
    expect(drawer).not.toContain('Send trial booking link')
    expect(drawer).not.toContain('Resend trial booking link')
    expect(drawer).toContain("['interview_invite', 'concerns_follow_up', 'rejection', 'already_considered', 'offer']")
  })
})

describe('recruitment printables', () => {
  const application = {
    ai_score: 78,
    ai_strengths: ['Bar experience'],
    ai_concerns: ['Gap since 2018'],
    candidate: { first_name: 'Rowan', last_name: 'Blake' },
    job_posting: { title: 'Bar Staff' },
  }

  it('renders the trial brief at A4, not US Letter', () => {
    const html = generateRecruitmentTrialBriefHtml({
      application,
      appointment: { scheduled_start: '2026-09-04T17:00:00.000Z', location: 'The Anchor' },
      logoUrl: 'https://example.test/logo.png',
    })
    expect(html).toContain('@page { size: A4; margin: 0; }')
    expect(html).not.toMatch(/size:\s*letter/i)
  })

  it('puts the dress code on the trial brief so the supervisor can check it', () => {
    const html = generateRecruitmentTrialBriefHtml({
      application,
      appointment: null,
      logoUrl: 'https://example.test/logo.png',
    })
    expect(html).toContain('block-coloured shirt or t-shirt, no logos')
    expect(html).toContain('Right to work')
  })

  it('renders the interview kit at A4 and asks the route for A4 too', () => {
    // US Letter is 6mm wider than A4, so a Letter page printed on UK paper is
    // either scaled down or clipped on the right.
    const template = read('src/lib/recruitment/interview-kit-template.ts')
    expect(template).toContain('@page { size: A4; margin: 0; }')
    expect(template).not.toMatch(/size:\s*letter/i)
    expect(template).not.toContain('8.5in')

    const route = read('src/app/api/recruitment/applications/[id]/interview-kit/route.ts')
    expect(route).toContain("format: 'A4'")
    expect(route).not.toContain("format: 'Letter'")
  })

  it('serves the trial brief as a PDF route rather than a pop-up text dump', () => {
    const drawer = read('src/app/(authenticated)/recruitment/_components/RecruitmentDashboardClient.tsx')
    expect(drawer).toContain("const path = kind === 'interview' ? 'interview-kit' : 'trial-brief'")
    expect(drawer).not.toContain('plainPrintableHtml')
    expect(drawer).not.toContain('printableText')
  })
})

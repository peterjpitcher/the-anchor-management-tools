import { describe, it, expect } from 'vitest'
import { computeExperienceSignals } from '@/lib/hiring/signals'
import { buildBarExperienceEvidence } from '@/lib/hiring/screening'

describe('bar experience evidence', () => {
  it('treats Sammie-style role progression as bar experience', () => {
    const timeline = [
      {
        employer: 'No1 Kitchen',
        titles: ['Assistant Manager', 'Bartender', 'Bar-supervisor'],
        start_date: 'Sep 2021',
        end_date: 'Present',
        is_bar_role: true,
        evidence_quotes: [
          {
            quote: 'Assistant Manager | No1 Kitchen | Sep 2021 - Present',
            anchor: 'Page 1, lines 10-12',
          },
          {
            quote: 'Previous roles worked within the company include: potwash, waiter, Bartender and Bar-supervisor',
            anchor: 'Page 1, lines 13-15',
          },
        ],
      },
    ]

    const signals = computeExperienceSignals(timeline as any)
    const evidence = buildBarExperienceEvidence({
      rubricItem: {
        key: 'bar_experience',
        label: '1+ year behind a bar',
        essential: true,
        weight: 2,
      },
      signals,
    })

    expect(evidence?.status).toBe('yes')
    expect(evidence?.contradiction).toBe(false)
  })
})

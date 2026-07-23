import { describe, expect, it } from 'vitest'
import { buildValueBreachEmail } from '@/lib/checklists/value-breach-email'

describe('buildValueBreachEmail', () => {
  it('explains an above-range reading in the subject and body', () => {
    const email = buildValueBreachEmail({
      title: 'Back bar fridge temperature',
      instruction: 'Check the digital display',
      department: 'bar',
      recordedValue: 9,
      valueUnit: '°C',
      valueMin: 1,
      valueMax: 5,
      completedByName: 'Alex Smith',
      completedAt: '2026-07-22T15:40:00.000Z',
      notes: 'Door was left open',
    })

    expect(email.subject).toBe(
      'Checklist alert: Back bar fridge temperature is above the limit (9°C)',
    )
    expect(email.bodyHtml).toContain('The recorded value of 9°C is above the maximum of 5°C.')
    expect(email.bodyHtml).toContain('1°C to 5°C')
    expect(email.bodyHtml).toContain('Alex Smith')
    expect(email.bodyHtml).toContain('Wednesday, 22 July 2026 at 4:40 pm')
    expect(email.bodyHtml).toContain('Door was left open')
  })

  it('escapes task and note text before adding it to the email HTML', () => {
    const email = buildValueBreachEmail({
      title: '<Freezer & cellar>',
      instruction: null,
      department: 'kitchen',
      recordedValue: -5,
      valueUnit: '°C',
      valueMin: -2,
      valueMax: null,
      completedByName: 'Sam Jones',
      completedAt: '2026-07-22T15:40:00.000Z',
      notes: '<script>alert(1)</script>',
    })

    expect(email.bodyHtml).toContain('&lt;Freezer &amp; cellar&gt;')
    expect(email.bodyHtml).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
    expect(email.bodyHtml).not.toContain('<script>')
  })
})

import { describe, expect, it } from 'vitest'
import { buildEventChecklist, EVENT_CHECKLIST_DEFINITIONS } from './event-checklist'

describe('event checklist definitions', () => {
  it('uses the consolidated, title-style event todo labels', () => {
    expect(EVENT_CHECKLIST_DEFINITIONS.map(({ label }) => label)).toEqual([
      'Write Event Brief',
      'Design Printed Materials',
      'Create Facebook Event',
      'Add GBP Event Post',
      'Schedule Social Posts',
      'Scheduled Stories',
      'Set Up Paid Advertising',
      'Whatsapp Reminder (Day of)'
    ])
  })

  it('keeps existing table-talker completion against the consolidated print todo', () => {
    const checklist = buildEventChecklist(
      { id: 'event-1', name: 'Test Event', date: '2026-08-20' },
      [{ event_id: 'event-1', task_key: 'design_table_talkers', completed_at: '2026-07-01T10:00:00Z' }],
      '2026-07-09'
    )

    expect(checklist).toHaveLength(8)
    expect(checklist.find(({ label }) => label === 'Design Printed Materials')).toMatchObject({
      completed: true,
      completedAt: '2026-07-01T10:00:00Z'
    })
  })
})

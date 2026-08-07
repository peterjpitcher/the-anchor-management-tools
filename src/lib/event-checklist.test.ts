import { describe, expect, it } from 'vitest'
import { buildEventChecklist, EVENT_CHECKLIST_DEFINITIONS } from './event-checklist'

describe('event checklist definitions', () => {
  it('uses the consolidated, title-style event todo labels', () => {
    expect(EVENT_CHECKLIST_DEFINITIONS.map(({ label }) => label)).toEqual([
      'Update All Event Details and Publish',
      'Design Printed Materials',
      'Create Facebook Event',
      'Add GBP Event Post',
      'Schedule Social Posts',
      'Scheduled Stories',
      'Set Up Paid Advertising',
      'Whatsapp Reminder (Day of)'
    ])
  })

  it('starts all launch tasks 56 days before the event', () => {
    expect(EVENT_CHECKLIST_DEFINITIONS.map(({ offsetDays }) => offsetDays)).toEqual([
      -56,
      -56,
      -56,
      -56,
      -56,
      -56,
      -56,
      0
    ])

    const checklist = buildEventChecklist(
      { id: 'event-1', name: 'Test Event', date: '2026-10-01' },
      [],
      '2026-08-06'
    )

    expect(checklist[0]).toMatchObject({
      label: 'Update All Event Details and Publish',
      dueDate: '2026-08-06',
      status: 'due_today'
    })
    expect(checklist[7]).toMatchObject({
      label: 'Whatsapp Reminder (Day of)',
      dueDate: '2026-10-01',
      status: 'upcoming'
    })
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

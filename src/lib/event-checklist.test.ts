import { describe, expect, it } from 'vitest'
import { buildEventChecklist, EVENT_CHECKLIST_DEFINITIONS } from './event-checklist'

describe('event checklist definitions', () => {
  it('uses the consolidated, title-style event todo labels', () => {
    expect(EVENT_CHECKLIST_DEFINITIONS.map(({ label }) => label)).toEqual([
      'Update All Event Details and Publish',
      'Create Facebook Event',
      'Add GBP Event Post',
      'Schedule Social Posts',
      'Schedule Event Email',
      'Scheduled Stories',
      'WhatsApp Reminder (3 Days Before)'
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
      -3
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
    expect(checklist.find(({ key }) => key === 'schedule_event_email')?.dueDate).toBe(
      checklist.find(({ key }) => key === 'schedule_social_content')?.dueDate
    )
    expect(checklist[6]).toMatchObject({
      label: 'WhatsApp Reminder (3 Days Before)',
      dueDate: '2026-09-28',
      status: 'upcoming'
    })
  })

  it('drops printed materials and ignores old print rows', () => {
    const checklist = buildEventChecklist(
      { id: 'event-1', name: 'Test Event', date: '2026-08-20' },
      [{ event_id: 'event-1', task_key: 'design_table_talkers', completed_at: '2026-07-01T10:00:00Z' }],
      '2026-07-09'
    )

    expect(checklist).toHaveLength(7)
    expect(checklist.some(({ key }) => key === 'design_table_talkers')).toBe(false)
    expect(checklist.every(({ completed }) => !completed)).toBe(true)
  })
})

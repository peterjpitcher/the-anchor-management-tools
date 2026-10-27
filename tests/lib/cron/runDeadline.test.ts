import { describe, expect, it } from 'vitest'
import { createRunDeadline } from '@/lib/cron/run-deadline'

describe('createRunDeadline (BK-212)', () => {
  it('is never up before the deadline, and summarises nothing', () => {
    let now = 1_000
    const deadline = createRunDeadline(5_000, () => now)
    const counter = { calls: 0 }

    expect(deadline.timeIsUp('deposit_reminders', () => ++counter.calls)).toBe(false)
    now = 4_999
    expect(deadline.timeIsUp('deposit_reminders', 3)).toBe(false)
    expect(deadline.reached).toBe(false)
    expect(deadline.summary()).toBeNull()
    // The count is only worked out once time is up.
    expect(counter.calls).toBe(0)
  })

  it('records where the run stopped and what each stage had left', () => {
    let now = 1_000
    const deadline = createRunDeadline(5_000, () => now)
    expect(deadline.timeIsUp('deposit_reminders', 4)).toBe(false)

    now = 5_000
    expect(deadline.timeIsUp('deposit_reminders', () => 3)).toBe(true)
    expect(deadline.timeIsUp('deposit_reminders', 2)).toBe(true)
    expect(deadline.timeIsUp('balance_reminders', 7.6)).toBe(true)
    expect(deadline.timeIsUp('outcome_emails')).toBe(true)

    expect(deadline.reached).toBe(true)
    expect(deadline.summary()).toEqual({
      stoppedIn: 'deposit_reminders',
      skipped: [
        { stage: 'deposit_reminders', items: 3 },
        { stage: 'balance_reminders', items: 7 },
        { stage: 'outcome_emails', items: null },
      ],
    })
  })

  it('stays up once reached, even if the clock reads earlier', () => {
    let now = 6_000
    const deadline = createRunDeadline(5_000, () => now)
    expect(deadline.timeIsUp('a', 1)).toBe(true)
    now = 0
    expect(deadline.timeIsUp('b', 1)).toBe(true)
  })
})

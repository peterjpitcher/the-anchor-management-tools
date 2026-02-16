import { describe, expect, it } from 'vitest'
import {
  assertCompletePastEventChecklistsEventLimit,
  assertCompletePastEventChecklistsMutationAllowed,
  isCompletePastEventChecklistsMutationEnabled,
  readCompletePastEventChecklistsCutoffDate,
  readCompletePastEventChecklistsEventLimit,
  readCompletePastEventChecklistsOffset
} from '@/lib/complete-past-event-checklists-script-safety'

describe('complete past event checklists script safety', () => {
  it('requires explicit confirm + RUN env to enable mutations', () => {
    expect(isCompletePastEventChecklistsMutationEnabled(['node', 'script'], {})).toBe(false)
    expect(
      isCompletePastEventChecklistsMutationEnabled(['node', 'script', '--confirm'], {})
    ).toBe(false)
    expect(
      isCompletePastEventChecklistsMutationEnabled(
        ['node', 'script', '--confirm'],
        { RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION: 'true' }
      )
    ).toBe(true)
    expect(
      isCompletePastEventChecklistsMutationEnabled(
        ['node', 'script', '--confirm', '--dry-run'],
        { RUN_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION: 'true' }
      )
    ).toBe(false)
  })

  it('blocks mutations unless ALLOW env var is enabled', () => {
    const previous = process.env.ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT
    delete process.env.ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT

    expect(() => assertCompletePastEventChecklistsMutationAllowed()).toThrow(
      'complete-past-event-checklists blocked by safety guard. Set ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT=true to run this mutation script.'
    )

    process.env.ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT = 'true'
    expect(() => assertCompletePastEventChecklistsMutationAllowed()).not.toThrow()

    if (previous === undefined) {
      delete process.env.ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT
    } else {
      process.env.ALLOW_COMPLETE_PAST_EVENT_CHECKLISTS_MUTATION_SCRIPT = previous
    }
  })

  it('reads event limit and offset from argv/env', () => {
    expect(readCompletePastEventChecklistsEventLimit(['node', 'script', '--event-limit', '12'], {})).toBe(12)
    expect(readCompletePastEventChecklistsEventLimit(['node', 'script', '--event-limit=9'], {})).toBe(9)
    expect(readCompletePastEventChecklistsEventLimit(['node', 'script'], { COMPLETE_PAST_EVENT_CHECKLISTS_EVENT_LIMIT: '7' })).toBe(7)
    expect(readCompletePastEventChecklistsOffset(['node', 'script', '--offset', '3'], {})).toBe(3)
    expect(readCompletePastEventChecklistsOffset(['node', 'script', '--offset=5'], {})).toBe(5)
    expect(readCompletePastEventChecklistsOffset(['node', 'script'], { COMPLETE_PAST_EVENT_CHECKLISTS_OFFSET: '11' })).toBe(11)
  })

  it('enforces hard caps for event limit', () => {
    expect(() => assertCompletePastEventChecklistsEventLimit(null, 200)).toThrow('--event-limit is required')
    expect(() => assertCompletePastEventChecklistsEventLimit(0, 200)).toThrow('--event-limit must be a positive integer')
    expect(() => assertCompletePastEventChecklistsEventLimit(201, 200)).toThrow('exceeds hard cap')
    expect(assertCompletePastEventChecklistsEventLimit(50, 200)).toBe(50)
  })

  it('defaults cutoff date but allows overrides', () => {
    expect(readCompletePastEventChecklistsCutoffDate(['node', 'script'], {})).toBe('2025-10-17')
    expect(
      readCompletePastEventChecklistsCutoffDate(['node', 'script', '--cutoff-date', '2024-01-01'], {})
    ).toBe('2024-01-01')
    expect(
      readCompletePastEventChecklistsCutoffDate(['node', 'script'], {
        COMPLETE_PAST_EVENT_CHECKLISTS_CUTOFF_DATE: '2023-12-31'
      })
    ).toBe('2023-12-31')
  })
})


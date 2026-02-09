import { describe, expect, it } from 'vitest'
import { eventSchema, getPublishValidationIssues } from '@/services/events'

const baseEventInput = {
  name: 'Test Event',
  date: '2026-06-15',
  time: '20:00',
  capacity: null,
}

describe('eventSchema time normalization', () => {
  it('preserves midnight values as 00:00', () => {
    const result = eventSchema.parse({
      ...baseEventInput,
      time: '00:00',
      end_time: '00:00',
      doors_time: '00:00',
      last_entry_time: '00:00',
    })

    expect(result.time).toBe('00:00')
    expect(result.end_time).toBe('00:00')
    expect(result.doors_time).toBe('00:00')
    expect(result.last_entry_time).toBe('00:00')
  })

  it('normalizes 24:00 values to 00:00', () => {
    const result = eventSchema.parse({
      ...baseEventInput,
      time: '24:00',
      end_time: '24:00',
      doors_time: '24:00',
      last_entry_time: '24:00',
    })

    expect(result.time).toBe('00:00')
    expect(result.end_time).toBe('00:00')
    expect(result.doors_time).toBe('00:00')
    expect(result.last_entry_time).toBe('00:00')
  })

  it('keeps valid FAQ payloads so event actions can persist them', () => {
    const result = eventSchema.parse({
      ...baseEventInput,
      faqs: [
        {
          question: 'When do doors open?',
          answer: 'Doors open at 19:30.',
          sort_order: 1,
        },
      ],
    })

    expect(result.faqs).toEqual([
      {
        question: 'When do doors open?',
        answer: 'Doors open at 19:30.',
        sort_order: 1,
      },
    ])
  })
})

describe('getPublishValidationIssues', () => {
  it('does not require publish fields for draft events', () => {
    const issues = getPublishValidationIssues({
      status: 'draft',
      name: '',
      date: '',
      time: '',
      slug: '',
      short_description: '',
      hero_image_url: '',
      is_free: false,
      price: 0,
    })

    expect(issues).toEqual([])
  })

  it('requires key publish fields for non-draft events', () => {
    const issues = getPublishValidationIssues({
      status: 'scheduled',
      name: 'Quiz Night',
      date: '2026-06-15',
      time: '20:00',
      slug: '',
      short_description: '',
      hero_image_url: '',
      is_free: false,
      price: 0,
    })

    expect(issues).toContain('URL slug')
    expect(issues).toContain('short description')
    expect(issues).toContain('event image')
    expect(issues).toContain('ticket price (or mark event as free)')
  })

  it('passes with complete publish-ready content', () => {
    const issues = getPublishValidationIssues({
      status: 'scheduled',
      name: 'Quiz Night',
      date: '2026-06-15',
      time: '20:00',
      slug: 'quiz-night-2026-06-15',
      short_description: 'Weekly pub quiz with prizes.',
      hero_image_url: 'https://example.com/quiz.jpg',
      is_free: true,
      price: 0,
    })

    expect(issues).toEqual([])
  })
})

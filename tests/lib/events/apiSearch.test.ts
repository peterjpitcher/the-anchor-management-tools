import { describe, expect, it } from 'vitest'

import { buildEventSearchOrFilter, normalizeEventSearch } from '@/lib/events/api-search'

describe('events api search helpers', () => {
  it('normalizes search input and returns null for empty values', () => {
    expect(normalizeEventSearch(null)).toBeNull()
    expect(normalizeEventSearch('   ')).toBeNull()
    expect(normalizeEventSearch('\nQuiz   Night\t')).toBe('Quiz Night')
  })

  it('builds an or filter across searchable event fields', () => {
    const filter = buildEventSearchOrFilter('Quiz Night')
    expect(filter).toContain('name.ilike.*Quiz Night*')
    expect(filter).toContain('short_description.ilike.*Quiz Night*')
    expect(filter).toContain('performer_name.ilike.*Quiz Night*')
  })

  it('sanitizes control and wildcard characters', () => {
    const filter = buildEventSearchOrFilter('foo%bar,baz*')
    expect(filter).toContain('name.ilike.*foo bar baz*')
    expect(filter).not.toContain('%')
    expect(filter).not.toContain('foo%bar')
    expect(filter).not.toContain('foo%bar,baz*')
  })
})

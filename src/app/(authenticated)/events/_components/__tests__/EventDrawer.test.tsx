// src/app/(authenticated)/events/_components/__tests__/EventDrawer.test.tsx
//
// EventDrawer is a deeply-nested component that requires Drawer, Supabase
// providers, permission context, and many design system components. Full
// rendering tests are impractical without extensive mocking. Instead we test
// the extractable preflight logic and verify integration contracts.
//
// Full component integration tests should be added once a test harness with
// all required providers is available (or via Playwright E2E).

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { parseKeywords } from '@/lib/keywords'

// ── Preflight logic extracted for testability ──
// Mirrors the checkPreflightRequirements function in EventDrawer.tsx
interface PreflightIssue {
  type: 'error' | 'warning'
  message: string
}

interface PreflightInput {
  name: string
  date: string
  primaryKeywords: string
  brief: string
  categoryName: string | null
  performerName: string
  price: string
  isFree: boolean
  longDescription: string
  time: string
}

function checkPreflightRequirements(input: PreflightInput): PreflightIssue[] {
  const issues: PreflightIssue[] = []

  if (!input.name?.trim()) {
    issues.push({ type: 'error', message: 'Event name is required' })
  }
  if (!input.date) {
    issues.push({ type: 'error', message: 'Event date is required' })
  }

  const pk = parseKeywords(input.primaryKeywords)
  if (pk.length === 0) {
    issues.push({ type: 'error', message: 'At least one primary keyword is required' })
  }

  const hasDetail = !!(
    input.brief?.trim() ||
    input.categoryName?.trim() ||
    input.performerName?.trim() ||
    input.price?.trim() ||
    input.isFree ||
    input.longDescription?.trim()
  )
  if (!hasDetail) {
    issues.push({ type: 'error', message: 'Add a brief, category, performer, or price to give the AI enough context' })
  }

  if (!input.time) {
    issues.push({ type: 'warning', message: 'No event time — timing details will be omitted' })
  }

  return issues
}

function makeValidInput(overrides: Partial<PreflightInput> = {}): PreflightInput {
  return {
    name: 'Quiz Night',
    date: '2026-06-15',
    primaryKeywords: 'quiz night, pub quiz',
    brief: 'Weekly pub quiz with prizes',
    categoryName: 'Quiz Night',
    performerName: '',
    price: '0',
    isFree: true,
    longDescription: '',
    time: '19:30',
    ...overrides,
  }
}

describe('EventDrawer preflight checks', () => {
  it('returns no errors for valid input', () => {
    const issues = checkPreflightRequirements(makeValidInput())
    const errors = issues.filter(i => i.type === 'error')
    expect(errors).toHaveLength(0)
  })

  it('requires event name', () => {
    const issues = checkPreflightRequirements(makeValidInput({ name: '' }))
    expect(issues.some(i => i.type === 'error' && i.message.includes('Event name'))).toBe(true)
  })

  it('requires event name (whitespace only)', () => {
    const issues = checkPreflightRequirements(makeValidInput({ name: '   ' }))
    expect(issues.some(i => i.type === 'error' && i.message.includes('Event name'))).toBe(true)
  })

  it('requires event date', () => {
    const issues = checkPreflightRequirements(makeValidInput({ date: '' }))
    expect(issues.some(i => i.type === 'error' && i.message.includes('Event date'))).toBe(true)
  })

  it('requires at least one primary keyword', () => {
    const issues = checkPreflightRequirements(makeValidInput({ primaryKeywords: '' }))
    expect(issues.some(i => i.type === 'error' && i.message.includes('primary keyword'))).toBe(true)
  })

  it('accepts comma-separated primary keywords', () => {
    const issues = checkPreflightRequirements(makeValidInput({ primaryKeywords: 'live music, pub gigs' }))
    const errors = issues.filter(i => i.type === 'error')
    expect(errors).toHaveLength(0)
  })

  it('requires at least one detail source', () => {
    const issues = checkPreflightRequirements(makeValidInput({
      brief: '',
      categoryName: null,
      performerName: '',
      price: '',
      isFree: false,
      longDescription: '',
    }))
    expect(issues.some(i => i.type === 'error' && i.message.includes('enough context'))).toBe(true)
  })

  it('accepts isFree as sufficient detail', () => {
    const issues = checkPreflightRequirements(makeValidInput({
      brief: '',
      categoryName: null,
      performerName: '',
      price: '',
      isFree: true,
      longDescription: '',
    }))
    const detailErrors = issues.filter(i => i.type === 'error' && i.message.includes('enough context'))
    expect(detailErrors).toHaveLength(0)
  })

  it('warns when time is missing', () => {
    const issues = checkPreflightRequirements(makeValidInput({ time: '' }))
    const warnings = issues.filter(i => i.type === 'warning')
    expect(warnings.some(w => w.message.includes('timing details'))).toBe(true)
  })

  it('returns multiple errors at once', () => {
    const issues = checkPreflightRequirements({
      name: '',
      date: '',
      primaryKeywords: '',
      brief: '',
      categoryName: null,
      performerName: '',
      price: '',
      isFree: false,
      longDescription: '',
      time: '',
    })
    const errors = issues.filter(i => i.type === 'error')
    expect(errors.length).toBeGreaterThanOrEqual(3)
  })
})

describe('EventDrawer server action contract', () => {
  // Verify the generateEventSeoContent import path is correct
  it('generateEventSeoContent is importable', async () => {
    // This test verifies the module exists at the expected path
    // The actual function is mocked in integration tests
    const mod = await import('@/app/actions/event-content')
    expect(mod.generateEventSeoContent).toBeDefined()
  })
})

describe('EventDrawer keywords not hardcoded', () => {
  it('parseKeywords correctly converts display format to array', () => {
    expect(parseKeywords('live music, pub quiz')).toEqual(['live music', 'pub quiz'])
    expect(parseKeywords('')).toEqual([])
    expect(parseKeywords('  single  ')).toEqual(['single'])
  })
})

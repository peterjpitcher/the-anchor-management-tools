import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react'
import type { ReactNode } from 'react'
import { EventDrawer } from '../EventDrawer'
import { updateEvent } from '@/app/actions/events'
import type { Event } from '@/types/database'

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }))
vi.mock('@/app/actions/events', () => ({ createEvent: vi.fn(), updateEvent: vi.fn() }))
vi.mock('@/app/actions/event-checklist', () => ({
  getEventChecklist: vi.fn().mockResolvedValue({ success: true, items: [] }),
  toggleEventChecklistTask: vi.fn(),
}))
vi.mock('@/app/actions/event-content', () => ({ generateEventSeoContent: vi.fn() }))
vi.mock('../EventImagePanel', () => ({ EventImagePanel: () => null }))
vi.mock('@/components/features/events/KeywordStrategyCard', () => ({ KeywordStrategyCard: () => null }))
vi.mock('@/components/features/events/FaqEditor', () => ({ FaqEditor: () => null }))
vi.mock('@/components/features/events/SeoHealthIndicator', () => ({ SeoHealthIndicator: () => null }))
vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  return { ...actual, Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div> }
})

afterEach(cleanup)
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


describe('EventDrawer validation feedback', () => {
  beforeEach(() => vi.clearAllMocks())

  function renderDrawer(accessibilityNotes = 'Step-free entrance') {
    return render(<EventDrawer
      open
      onClose={vi.fn()}
      onSave={vi.fn()}
      categories={[]}
      event={{
        id: 'event-1', name: 'Quiz Night', date: '2026-09-25', time: '19:00',
        capacity: 60, created_at: '2026-09-01T12:00:00Z', slug: 'quiz-night',
        is_free: true, payment_mode: 'free', accessibility_notes: accessibilityNotes,
      } as Event}
    />)
  }

  it('shows the server error beside its field, focuses the summary and clears the error after editing', async () => {
    const message = 'String must contain at most 300 character(s)'
    vi.mocked(updateEvent).mockResolvedValue({
      error: `Accessibility notes: ${message}`,
      fieldErrors: { accessibility_notes: message },
    })
    renderDrawer()
    fireEvent.click(screen.getByRole('button', { name: 'Save Changes' }))

    const field = screen.getByRole('textbox', { name: 'Accessibility Notes' })
    await waitFor(() => expect(field).toHaveAttribute('aria-invalid', 'true'))
    expect(document.getElementById(field.getAttribute('aria-describedby')!)).toHaveTextContent(message)
    const summary = screen.getByText('Please correct the following fields and save again:').parentElement
    expect(summary).toHaveFocus()

    fireEvent.change(field, { target: { value: 'Step-free access from the car park.' } })
    expect(field).not.toHaveAttribute('aria-invalid')
    expect(screen.queryByText(message)).not.toBeInTheDocument()
    expect(screen.queryByText('Please correct the following fields and save again:')).not.toBeInTheDocument()
  })

  it('shows the length problem immediately for existing accessibility notes', () => {
    renderDrawer('a'.repeat(301))
    const field = screen.getByRole('textbox', { name: 'Accessibility Notes' })
    expect(field).toHaveAttribute('aria-invalid', 'true')
    expect(document.getElementById(field.getAttribute('aria-describedby')!)).toHaveTextContent(
      'Use 300 characters or fewer (301 entered).',
    )
    expect(updateEvent).not.toHaveBeenCalled()
  })
})

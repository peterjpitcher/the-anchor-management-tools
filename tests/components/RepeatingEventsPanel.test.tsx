import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { EventSeriesListItem } from '@/app/actions/event-series'

const actions = vi.hoisted(() => ({
  listEventSeries: vi.fn(),
  createEventSeries: vi.fn(),
  updateEventSeries: vi.fn(),
  skipEventSeriesDate: vi.fn(),
  unskipEventSeriesDate: vi.fn(),
  setEventSeriesPaused: vi.fn(),
  endEventSeries: vi.fn(),
}))
// The picture panel's storage client needs browser env vars; nothing here uploads.
vi.mock('@/components/providers/SupabaseProvider', () => ({ useSupabase: () => ({ storage: { from: () => ({}) } }) }))
vi.mock('@/app/actions/event-series', () => actions)

import { RepeatingEventsPanel, seriesToForm, toSeriesInput } from '@/app/(authenticated)/events/_components/RepeatingEventsPanel'

const occurrence = (date: string) => ({
  date, startTime: '19:00', endTime: '22:00', startsAt: `${date}T19:00:00.000Z`, endsAt: `${date}T22:00:00.000Z`,
})

const darts: EventSeriesListItem = {
  id: 'series-1', name: 'Ladies Darts Night', slug: 'ladies-darts-night', categoryId: null, weekday: 4,
  startTime: '19:00', endTime: '22:00', startsOn: '2026-12-03', endsOn: null,
  shortDescription: 'A friendly night of darts for women.', pagePath: '/ladies-darts-night', isFree: true,
  audienceNote: null, skipWhenClosed: true, status: 'active', googleCalendarEventId: null, createdAt: '', updatedAt: '',
  details: {
    brief: null, performerName: null, performerType: null, price: null, metaTitle: 'Ladies Darts Night | Thursdays',
    metaDescription: null, longDescription: null, highlights: ['Free to play'], primaryKeywords: ['ladies darts night'],
    secondaryKeywords: [], localSeoKeywords: [], imageAltText: null, accessibilityNotes: null, facebookEventName: null,
    facebookEventDescription: null, gbpEventTitle: null, gbpEventDescription: null, socialCopyWhatsapp: null,
  },
  images: { square: null, landscape: null, social: null, story: null, printPoster: null },
  skips: [{ skipDate: '2026-12-24', reason: 'Christmas Eve', replacedByEventId: null }],
  nextOccurrence: occurrence('2026-12-03'),
  upcoming: [occurrence('2026-12-03'), occurrence('2026-12-10'), occurrence('2026-12-17')],
  upcomingSkipped: [{ date: '2026-12-24', kind: 'manual', reason: 'Christmas Eve', replacedByEventId: null }],
}

beforeEach(() => {
  vi.clearAllMocks()
  actions.listEventSeries.mockResolvedValue({ success: true, data: { series: [darts], closedDays: [], today: '2026-11-26' } })
  actions.unskipEventSeriesDate.mockResolvedValue({ success: true, data: {} })
})

describe('RepeatingEventsPanel', () => {
  it('lists the night with its schedule and next date, the day name derived from the date', async () => {
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} />)
    expect(await screen.findByText('Ladies Darts Night')).toBeInTheDocument()
    expect(screen.getByText('Every Thursday, 7pm to 10pm')).toBeInTheDocument()
    expect(screen.getByText(/Next: Thursday 3 December/)).toBeInTheDocument()
  })

  it('opens on the repeating event whose night was clicked on the calendar, with its dates showing', async () => {
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} focusSeriesId="series-1" />)
    expect(await screen.findByText('Thursday 10 December')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide dates' })).toBeInTheDocument()
  })

  it('strikes through a skipped date, offers undo, and hands a running date to "make a full event"', async () => {
    const onMakeFullEvent = vi.fn()
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={onMakeFullEvent} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show the next 12 dates' }))

    const skipped = screen.getByText('Thursday 24 December')
    expect(skipped).toHaveClass('line-through')
    const skippedRow = skipped.closest('li') as HTMLElement
    expect(within(skippedRow).getByText('Skipped: Christmas Eve')).toBeInTheDocument()
    fireEvent.click(within(skippedRow).getByRole('button', { name: 'Undo' }))
    expect(actions.unskipEventSeriesDate).toHaveBeenCalledWith({ seriesId: 'series-1', date: '2026-12-24' })

    const running = screen.getByText('Thursday 10 December').closest('li') as HTMLElement
    fireEvent.click(within(running).getByRole('button', { name: 'Make this date a full event' }))
    expect(onMakeFullEvent).toHaveBeenCalledWith({ series: darts, date: '2026-12-10' })
  })

  it('tells the parent after a saved change, so the calendar reloads its nights', async () => {
    const onSeriesChanged = vi.fn()
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} onSeriesChanged={onSeriesChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show the next 12 dates' }))
    expect(onSeriesChanged).not.toHaveBeenCalled()

    const skippedRow = screen.getByText('Thursday 24 December').closest('li') as HTMLElement
    fireEvent.click(within(skippedRow).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(onSeriesChanged).toHaveBeenCalledTimes(1))
    expect(actions.listEventSeries).toHaveBeenCalledTimes(2)
  })

  it('does not tell the parent when a change is refused', async () => {
    actions.unskipEventSeriesDate.mockResolvedValue({ error: 'Not allowed' })
    const onSeriesChanged = vi.fn()
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} onSeriesChanged={onSeriesChanged} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Show the next 12 dates' }))
    const skippedRow = screen.getByText('Thursday 24 December').closest('li') as HTMLElement
    fireEvent.click(within(skippedRow).getByRole('button', { name: 'Undo' }))
    await waitFor(() => expect(actions.unskipEventSeriesDate).toHaveBeenCalled())
    expect(onSeriesChanged).not.toHaveBeenCalled()
  })

  it('shows no change controls without events:manage', async () => {
    render(<RepeatingEventsPanel categories={[]} canManage={false} onMakeFullEvent={vi.fn()} />)
    await screen.findByText('Ladies Darts Night')
    expect(screen.queryByRole('button', { name: 'New repeating event' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Skip a date' })).toBeNull()
  })

  it('previews the next six dates in the drawer from the same resolver', async () => {
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    const preview = await screen.findByRole('list', { name: 'Next six dates' })
    const items = within(preview).getAllByRole('listitem').map((li) => li.textContent)
    expect(items).toEqual([
      'Thursday 3 December',
      'Thursday 10 December',
      'Thursday 17 December',
      'Thursday 24 December',
      'Thursday 31 December',
      'Thursday 7 January',
    ])
    expect(within(preview).getByText('Thursday 24 December')).toHaveClass('line-through')
  })

  it('loads the saved details into the form and sends them back unchanged', () => {
    const input = toSeriesInput(seriesToForm(darts))
    expect(input.details).toMatchObject({
      metaTitle: 'Ladies Darts Night | Thursdays', highlights: ['Free to play'], primaryKeywords: ['ladies darts night'], price: null,
    })
  })

  it('shows the details sections and asks for a price only on a paid night', async () => {
    render(<RepeatingEventsPanel categories={[]} canManage onMakeFullEvent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit' }))
    for (const heading of ['Details', 'SEO and content', 'Promotion copy', 'Pictures']) {
      expect(screen.getByRole('heading', { name: heading })).toBeInTheDocument()
    }
    expect(screen.queryByLabelText(/Standard ticket price/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Free'))
    expect(screen.getByLabelText(/Standard ticket price/)).toBeInTheDocument()
  })
})

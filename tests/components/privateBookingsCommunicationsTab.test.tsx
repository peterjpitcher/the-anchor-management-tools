import { describe, expect, it, vi } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import {
  CommunicationsTab,
  type CommunicationsHistoryRow,
} from '@/components/private-bookings/CommunicationsTab'
import type { ScheduledSmsPreview } from '@/services/private-bookings/scheduled-sms'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}))

function historyRow(overrides: Partial<CommunicationsHistoryRow> = {}): CommunicationsHistoryRow {
  return {
    id: 'queue-1',
    created_at: '2026-04-18T10:00:00.000Z',
    trigger_type: 'booking_confirmed',
    template_key: 'private_booking_confirmed',
    status: 'sent',
    message_body: 'Hi Sam — you\'re all confirmed for 15 May 2026. Can\'t wait.',
    twilio_sid: 'SMxxxxxxxxxxxx',
    scheduled_for: null,
    ...overrides,
  }
}

function scheduledItem(overrides: Partial<ScheduledSmsPreview> = {}): ScheduledSmsPreview {
  return {
    trigger_type: 'balance_reminder_14day',
    expected_fire_at: '1 May 2026',
    preview_body: 'Hi Sam — two weeks to go. £1200 balance due by 8 May 2026.',
    suppression_reason: null,
    ...overrides,
  }
}

describe('CommunicationsTab', () => {
  it('renders SMS history in the order provided', () => {
    const history = [
      historyRow({ id: 'r1', created_at: '2026-04-18T10:00:00Z', trigger_type: 'booking_confirmed' }),
      historyRow({ id: 'r2', created_at: '2026-04-17T10:00:00Z', trigger_type: 'booking_created' }),
    ]

    render(<CommunicationsTab history={history} scheduled={[]} isDateTbd={false} />)

    const items = screen.getAllByRole('listitem')
    // first listitem corresponds to the first history row
    expect(within(items[0]).getByText('booking_confirmed')).toBeInTheDocument()
    expect(within(items[1]).getByText('booking_created')).toBeInTheDocument()
  })

  it('shows history empty state when no messages sent', () => {
    render(<CommunicationsTab history={[]} scheduled={[]} isDateTbd={false} />)
    expect(screen.getByText('No messages sent yet')).toBeInTheDocument()
  })

  it('renders scheduled list with resolved preview bodies', () => {
    const scheduled: ScheduledSmsPreview[] = [
      scheduledItem({
        trigger_type: 'balance_reminder_14day',
        preview_body: 'Hi Sam — two weeks to go. £1200 balance due by 8 May 2026.',
      }),
    ]

    render(<CommunicationsTab history={[]} scheduled={scheduled} isDateTbd={false} />)

    expect(screen.getByText('balance_reminder_14day')).toBeInTheDocument()
    expect(
      screen.getByText(/two weeks to go. £1200 balance due by 8 May 2026/),
    ).toBeInTheDocument()
    expect(screen.getByText('Eligible')).toBeInTheDocument()
  })

  it('labels suppressed scheduled items with their reason', () => {
    const scheduled: ScheduledSmsPreview[] = [
      scheduledItem({
        suppression_reason: 'feature_flag_disabled',
        expected_fire_at: null,
      }),
      scheduledItem({
        trigger_type: 'event_reminder_1d',
        suppression_reason: 'already_sent',
        expected_fire_at: null,
      }),
    ]

    render(<CommunicationsTab history={[]} scheduled={scheduled} isDateTbd={false} />)

    expect(
      screen.getByText("Won't send — feature disabled in production."),
    ).toBeInTheDocument()
    expect(screen.getByText('Already sent this cycle.')).toBeInTheDocument()
    // Both items show "Will not fire"
    expect(screen.getAllByText('Will not fire')).toHaveLength(2)
  })

  it('shows TBD-specific empty state when scheduled list is empty and date is TBD', () => {
    render(<CommunicationsTab history={[]} scheduled={[]} isDateTbd={true} />)

    expect(
      screen.getByText('No date-based reminders scheduled'),
    ).toBeInTheDocument()
    expect(
      screen.getByText(
        /Booking date is still to be confirmed/i,
      ),
    ).toBeInTheDocument()
  })

  it('shows generic empty state for scheduled when date is not TBD', () => {
    render(<CommunicationsTab history={[]} scheduled={[]} isDateTbd={false} />)

    expect(screen.getByText('Nothing scheduled')).toBeInTheDocument()
  })

  it('shows twilio SID on sent history rows only', () => {
    const history = [
      historyRow({ id: 'sent-row', status: 'sent', twilio_sid: 'SM-sent' }),
      historyRow({ id: 'failed-row', status: 'failed', twilio_sid: 'SM-failed' }),
    ]

    render(<CommunicationsTab history={history} scheduled={[]} isDateTbd={false} />)

    expect(screen.getByText(/SM-sent/)).toBeInTheDocument()
    expect(screen.queryByText(/SM-failed/)).not.toBeInTheDocument()
  })
})

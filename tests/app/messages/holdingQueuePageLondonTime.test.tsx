// The holding queue's received times, in both test zones.
//
// The page is a server component and the Vercel runtime runs in UTC. It printed received_at with
// toLocaleString('en-GB') and no zone, so during British Summer Time every message showed an hour
// early, and one received just after midnight showed the day before. It now prints through
// formatDateTimeInLondon, which keeps the same format but pins Europe/London, so the expected
// text below is the same whether `npm test` (London) or `npm run test:utc` (UTC) runs this file.
//
// Instants are written in UTC: 13:30 UTC on 26 September 2026 is 14:30 BST in London.
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getUnmatchedCommunicationsMock = vi.hoisted(() => vi.fn())

vi.mock('next/navigation', () => ({
  redirect: vi.fn(),
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/messages/holding',
}))
vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn().mockResolvedValue(true) }))
vi.mock('@/services/communications', () => ({
  CommunicationsService: { getUnmatchedCommunications: getUnmatchedCommunicationsMock },
}))
vi.mock('@/app/(authenticated)/messages/holding/_components/HoldingQueueActions', () => ({
  HoldingQueueActions: () => null,
}))

import HoldingQueuePage from '@/app/(authenticated)/messages/holding/page'

function unmatchedSms(id: string, receivedAt: string) {
  return {
    id,
    channel: 'sms',
    received_at: receivedAt,
    from_address: '+447700900123',
    to_address: '+447700900456',
    subject: null,
    body_text: 'Can I move my booking?',
    attachments: [],
    candidate_customer_ids: [],
  }
}

async function renderWithReceivedAt(receivedAt: string) {
  getUnmatchedCommunicationsMock.mockResolvedValue([unmatchedSms('msg-1', receivedAt)])
  return render(await HoldingQueuePage())
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('HoldingQueuePage received time', () => {
  it('shows London wall time during British Summer Time', async () => {
    await renderWithReceivedAt('2026-09-26T13:30:00Z')

    expect(screen.getByText('26/09/2026, 14:30:00')).toBeInTheDocument()
  })

  it('shows the London date for a message received just after midnight BST', async () => {
    // 00:30 BST on 27 September in London; still 23:30 on 26 September in UTC.
    await renderWithReceivedAt('2026-09-26T23:30:00Z')

    expect(screen.getByText('27/09/2026, 00:30:00')).toBeInTheDocument()
  })

  it('agrees in both zones in winter', async () => {
    await renderWithReceivedAt('2026-01-15T14:30:00Z')

    expect(screen.getByText('15/01/2026, 14:30:00')).toBeInTheDocument()
  })
})

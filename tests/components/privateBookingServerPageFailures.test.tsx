import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

/**
 * The page contract (docs/standards/UI_UX.md, States): a failed load keeps the page header and
 * tab row, shows the error, and is never shown as an empty list. These are the private bookings
 * server pages whose data read can throw.
 */

const mocks = vi.hoisted(() => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`)
  }),
  moduleActions: vi.fn(),
  checkUserPermission: vi.fn(),
  getQueue: vi.fn(),
  flag: vi.fn(),
  snapshot: vi.fn(),
}))

vi.mock('next/navigation', () => ({
  redirect: mocks.redirect,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/private-bookings/sms-queue',
}))
vi.mock('@/app/actions/rbac', () => ({
  getCurrentUserModuleActions: mocks.moduleActions,
  checkUserPermission: mocks.checkUserPermission,
}))
vi.mock('@/services/sms-queue', () => ({ SmsQueueService: { getQueue: mocks.getQueue } }))
vi.mock('@/lib/messaging/flags', () => ({ isMessagingFlagOn: mocks.flag }))
vi.mock('@/app/actions/privateBookingActions', () => ({
  approveSms: vi.fn(),
  rejectSms: vi.fn(),
  sendApprovedSms: vi.fn(),
}))
vi.mock('@/lib/analytics/private-booking-growth', () => ({
  loadPrivateBookingGrowthSnapshot: mocks.snapshot,
}))
vi.mock('@/app/(authenticated)/private-bookings/reports/_components/PrivateBookingGrowthReportClient', () => ({
  default: () => <p>Growth report body</p>,
}))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.moduleActions.mockResolvedValue({ actions: ['view', 'manage'] })
  mocks.checkUserPermission.mockResolvedValue(true)
  mocks.flag.mockResolvedValue(false)
  vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

describe('SMS queue page', () => {
  it('shows a failed queue read as an error, never as empty queues', async () => {
    mocks.getQueue.mockRejectedValue(new Error('connection reset'))
    const SmsQueuePage = (await import('@/app/(authenticated)/private-bookings/sms-queue/page')).default

    const html = renderToStaticMarkup(await SmsQueuePage())

    // Titled with the section's sidebar label; the tab row still carries the SMS Queue tab.
    expect(html).toMatch(/<h1[^>]*>Private Bookings<\/h1>/)
    expect(html).toContain('SMS Queue')
    expect(html).toContain('We could not load the SMS queue.')
    expect(html).not.toContain('No messages pending approval')
    expect(html).not.toContain('No approved messages ready to send')
  })

  it('shows the empty states when the queue really is empty', async () => {
    mocks.getQueue.mockResolvedValue([])
    const SmsQueuePage = (await import('@/app/(authenticated)/private-bookings/sms-queue/page')).default

    const html = renderToStaticMarkup(await SmsQueuePage())

    expect(html).not.toContain('We could not load the SMS queue.')
    expect(html).toContain('No messages pending approval')
    expect(html).toContain('No approved messages ready to send')
  })
})

describe('Private booking growth report page', () => {
  it('keeps the header and tab row and shows an error when the report cannot load', async () => {
    mocks.snapshot.mockRejectedValue(new Error('statement timeout'))
    const ReportsPage = (await import('@/app/(authenticated)/private-bookings/reports/page')).default

    const html = renderToStaticMarkup(await ReportsPage())

    expect(html).toMatch(/<h1[^>]*>Private Bookings<\/h1>/)
    expect(html).toContain('Growth report')
    expect(html).toContain('We could not load the growth report.')
    expect(html).toContain('href="/private-bookings/reports"')
    expect(html).not.toContain('Growth report body')
  })

  it('renders the report when the snapshot loads', async () => {
    mocks.snapshot.mockResolvedValue({ records: [] })
    const ReportsPage = (await import('@/app/(authenticated)/private-bookings/reports/page')).default

    const html = renderToStaticMarkup(await ReportsPage())

    expect(html).toContain('Growth report body')
    expect(html).not.toContain('We could not load the growth report.')
  })
})

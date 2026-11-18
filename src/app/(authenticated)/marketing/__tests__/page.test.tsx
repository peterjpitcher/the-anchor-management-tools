import type { ComponentProps, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/marketing-campaigns', () => ({
  listMarketingCampaigns: vi.fn(),
  getMarketingSettings: vi.fn(),
  getMarketingCampaignListStats: vi.fn(),
}))
const push = vi.hoisted(() => vi.fn())
vi.mock('next/navigation', () => ({ redirect: vi.fn(), useRouter: () => ({ push }) }))
vi.mock('../UnsubscribeEmailCard', () => ({ UnsubscribeEmailCard: () => null }))

// Keep semantic HTML while isolating this server page from app-shell providers.
vi.mock('@/ds', () => ({
  PageLayout: ({ children }: { children: ReactNode }) => <main>{children}</main>,
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  Alert: ({ title, children }: { title: string; children: ReactNode }) => <div role="alert">{title}{children}</div>,
  Button: ({ children, type }: { children: ReactNode; type?: 'submit' }) => <button type={type}>{children}</button>,
  LinkButton: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
  Input: ({ label, ...props }: ComponentProps<'input'> & { label: string }) => <label>{label}<input {...props} /></label>,
  Select: ({ label, children, ...props }: ComponentProps<'select'> & { label: string }) => <label>{label}<select {...props}>{children}</select></label>,
  Empty: ({ title, action }: { title: string; action: ReactNode }) => <div>{title}{action}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Table: ({ children }: { children: ReactNode }) => <table>{children}</table>,
  TableHeader: ({ children }: { children: ReactNode }) => <thead>{children}</thead>,
  TableBody: ({ children }: { children: ReactNode }) => <tbody>{children}</tbody>,
  TableRow: ({ children }: { children: ReactNode }) => <tr>{children}</tr>,
  TableHead: ({ children }: { children: ReactNode }) => <th>{children}</th>,
  TableCell: ({ children }: { children: ReactNode }) => <td>{children}</td>,
  // The DS pager, reduced to its two step buttons and its page line.
  TablePagination: ({ page, totalPages, onPageChange }: { page: number; totalPages: number; onPageChange: (page: number) => void }) => (
    <div>
      <button type="button" onClick={() => onPageChange(page - 1)}>Previous</button>
      <span>Page {page} of {totalPages}</span>
      <button type="button" onClick={() => onPageChange(page + 1)}>Next</button>
    </div>
  ),
}))

import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMarketingCampaignListStats, getMarketingSettings, listMarketingCampaigns } from '@/app/actions/marketing-campaigns'
import MarketingCampaignsPage from '../page'

const renderPage = async (params: Record<string, string | string[] | undefined> = {}) =>
  render(await MarketingCampaignsPage({ searchParams: Promise.resolve(params) }))

describe('marketing campaign list page', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    vi.mocked(checkUserPermission).mockResolvedValue(true)
    vi.mocked(listMarketingCampaigns).mockResolvedValue({ data: { campaigns: [], total: 0 } })
    vi.mocked(getMarketingSettings).mockResolvedValue({ error: 'Settings unavailable for test' })
    vi.mocked(redirect).mockImplementation((url) => { throw new Error(`Redirect: ${url}`) })
  })

  afterEach(cleanup)

  it('defaults to drafts and scheduled emails with earliest sends first', async () => {
    await renderPage()
    expect(listMarketingCampaigns).toHaveBeenCalledWith({
      page: 1, pageSize: 50, search: '', sort: 'scheduled_asc',
      audienceType: undefined, statuses: ['draft', 'scheduled'],
    })
    expect(screen.getByLabelText('Status')).toHaveValue('upcoming')
    expect(screen.getByLabelText('Sort by')).toHaveValue('scheduled_asc')
    expect(screen.getByText(/Showing scheduled and draft emails only/)).toBeInTheDocument()
  })

  it('passes explicit filters to the action and restores their form values', async () => {
    await renderPage({ status: 'completed', search: '  Christmas  ', audience: 'business', sort: 'name_desc' })
    expect(listMarketingCampaigns).toHaveBeenCalledWith({
      page: 1, pageSize: 50, search: 'Christmas', sort: 'name_desc',
      audienceType: 'business', statuses: ['completed'],
    })
    expect(screen.getByLabelText('Search campaigns')).toHaveValue('Christmas')
    expect(screen.getByLabelText('Status')).toHaveValue('completed')
    expect(screen.getByLabelText('Audience')).toHaveValue('business')
    expect(screen.getByLabelText('Sort by')).toHaveValue('name_desc')
  })

  it('uses a GET form with Apply and a reset to the default view', async () => {
    await renderPage()
    const form = screen.getByRole('form', { name: 'Campaign filters' })
    expect(form).toHaveAttribute('method', 'get')
    expect(form).toHaveAttribute('action', '/marketing')
    expect(screen.getByRole('button', { name: 'Apply' })).toHaveAttribute('type', 'submit')
    expect(screen.getByRole('link', { name: 'Reset' })).toHaveAttribute('href', '/marketing')
    expect(form.querySelector('[name="page"]')).toBeNull()
  })

  it('allows completed emails to be included through All statuses', async () => {
    await renderPage({ status: 'all' })
    expect(listMarketingCampaigns).toHaveBeenCalledWith(expect.objectContaining({ statuses: undefined }))
    expect(screen.getByLabelText('Status')).toHaveValue('all')
  })

  it('preserves search, audience, status and sort when paging either way', async () => {
    vi.mocked(listMarketingCampaigns).mockResolvedValue({ data: { campaigns: [], total: 125 } })
    await renderPage({ status: 'completed', search: 'Food & drink', audience: 'business', sort: 'oldest', page: '2' })
    for (const [name, page] of [['Previous', '1'], ['Next', '3']]) {
      push.mockClear()
      fireEvent.click(screen.getByRole('button', { name }))
      const href = push.mock.calls[0][0] as string
      const url = new URL(href, 'https://example.test')
      expect(url.pathname).toBe('/marketing')
      expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'completed', sort: 'oldest', page, search: 'Food & drink', audience: 'business' })
    }
    expect(screen.getByText('Page 2 of 3')).toBeInTheDocument()
  })

  it('redirects an out-of-range page to the final page without losing filters', async () => {
    vi.mocked(listMarketingCampaigns).mockResolvedValue({ data: { campaigns: [], total: 75 } })
    await expect(renderPage({ status: 'completed', search: 'Quiz', audience: 'customer', sort: 'newest', page: '99' })).rejects.toThrow('Redirect:')
    const href = vi.mocked(redirect).mock.calls[0][0]
    expect(Object.fromEntries(new URL(href, 'https://example.test').searchParams)).toEqual({
      status: 'completed', search: 'Quiz', audience: 'customer', sort: 'newest', page: '2',
    })
  })

  it('falls back to defaults for invalid query parameters', async () => {
    await renderPage({ status: 'invalid', audience: 'unknown', sort: 'bad', page: '-2' })
    expect(listMarketingCampaigns).toHaveBeenCalledWith(expect.objectContaining({
      page: 1, statuses: ['draft', 'scheduled'], audienceType: undefined, sort: 'scheduled_asc',
    }))
  })

  it('points only someone who can open Settings at the Settings tab when sending is off', async () => {
    vi.mocked(getMarketingSettings).mockResolvedValue({ data: { sendsEnabled: false } } as Awaited<ReturnType<typeof getMarketingSettings>>)
    await renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Turn sending back on in the Settings tab')

    cleanup()
    // The Settings tab is hidden without marketing:manage, so the warning must not send them there.
    vi.mocked(checkUserPermission).mockImplementation(async (_module, action) => action !== 'manage')
    await renderPage()
    expect(screen.getByRole('alert')).toHaveTextContent('Someone who manages marketing settings can turn it back on.')
    expect(screen.getByRole('alert')).not.toHaveTextContent('Settings tab')
  })

  it('redirects unauthorised requests before rendering or reading any results', async () => {
    // The list action runs in the same wave as the view check and refuses on its own
    // permission check; the page must still redirect rather than render anything.
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    vi.mocked(listMarketingCampaigns).mockResolvedValue({ error: 'Insufficient permissions' })
    await expect(renderPage()).rejects.toThrow('Redirect: /unauthorized')
    expect(getMarketingCampaignListStats).not.toHaveBeenCalled()
  })

  it('asks for results once, for the sent campaigns only, and shows them', async () => {
    const summary = (sent: number) => ({ recipients: sent + 1, pending: 0, sending: 0, sent, failed: 0, skipped: 1, needsReview: 0 })
    const item = (id: string, name: string, sent: number, status: 'completed' | 'draft') => ({
      id, name, subject: `${name} subject`, status, kind: 'one_off' as const, audienceType: 'customer' as const,
      scheduledFor: status === 'draft' ? null : '2026-10-01T09:00:00.000Z', createdAt: '2026-09-01T09:00:00.000Z', summary: summary(sent),
    })
    vi.mocked(listMarketingCampaigns).mockResolvedValue({
      data: { campaigns: [item('c1', 'October news', 200, 'completed'), item('c2', 'Draft idea', 0, 'draft'), item('c3', 'Quiz night', 40, 'completed')], total: 3 },
    })
    const stats = (delivered: number, opened: number, clicked: number, unsubscribed: number, sent: number) => ({
      delivered, opened, clicked, unsubscribed,
      rates: { deliveredRate: delivered / sent, openRate: opened / sent, clickRate: clicked / sent, bounceRate: 0, complaintRate: 0, unsubscribeRate: unsubscribed / sent },
    })
    vi.mocked(getMarketingCampaignListStats).mockResolvedValue({
      success: true,
      data: { c1: stats(190, 80, 10, 2, 200), c3: stats(40, 0, 4, 0, 40) },
    } as unknown as Awaited<ReturnType<typeof getMarketingCampaignListStats>>)

    await renderPage({ status: 'all' })

    expect(getMarketingCampaignListStats).toHaveBeenCalledTimes(1)
    expect(getMarketingCampaignListStats).toHaveBeenCalledWith(['c1', 'c3'])
    const rowOf = (name: string) => screen.getByRole('link', { name }).closest('tr') as HTMLElement
    expect(rowOf('October news')).toHaveTextContent('190')
    expect(rowOf('October news')).toHaveTextContent('80')
    expect(rowOf('Quiz night')).toHaveTextContent('Not tracked')
    expect(rowOf('Draft idea').textContent).toContain('-')
  })

  it('does not ask for results when nothing on the page has been sent', async () => {
    await renderPage()
    expect(getMarketingCampaignListStats).not.toHaveBeenCalled()
  })
})

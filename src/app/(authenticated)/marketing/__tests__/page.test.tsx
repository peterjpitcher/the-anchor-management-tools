import type { ComponentProps, ReactNode } from 'react'
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/app/actions/rbac', () => ({ checkUserPermission: vi.fn() }))
vi.mock('@/app/actions/marketing-campaigns', () => ({
  listMarketingCampaigns: vi.fn(),
  getMarketingSettings: vi.fn(),
  getMarketingCampaignStats: vi.fn(),
}))
vi.mock('next/navigation', () => ({ redirect: vi.fn() }))
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
}))

import { redirect } from 'next/navigation'
import { checkUserPermission } from '@/app/actions/rbac'
import { getMarketingSettings, listMarketingCampaigns } from '@/app/actions/marketing-campaigns'
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

  it('preserves search, audience, status and sort on both pagination links', async () => {
    vi.mocked(listMarketingCampaigns).mockResolvedValue({ data: { campaigns: [], total: 125 } })
    await renderPage({ status: 'completed', search: 'Food & drink', audience: 'business', sort: 'oldest', page: '2' })
    for (const [name, page] of [['Previous', '1'], ['Next', '3']]) {
      const href = screen.getByRole('link', { name }).getAttribute('href')!
      const query = new URL(href, 'https://example.test').searchParams
      expect(Object.fromEntries(query)).toEqual({ status: 'completed', sort: 'oldest', page, search: 'Food & drink', audience: 'business' })
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

  it('stops unauthorised requests before loading campaigns', async () => {
    vi.mocked(checkUserPermission).mockResolvedValue(false)
    await expect(renderPage()).rejects.toThrow('Redirect: /unauthorized')
    expect(listMarketingCampaigns).not.toHaveBeenCalled()
  })
})

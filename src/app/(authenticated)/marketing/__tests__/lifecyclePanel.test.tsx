import type { ComponentProps, ReactNode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

const setHoldout = vi.hoisted(() => vi.fn())
vi.mock('@/app/actions/marketing-campaigns', () => ({ setMarketingLifecycleHoldout: setHoldout }))

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }))
vi.mock('@/ds', () => ({
  Card: ({ children }: { children: ReactNode }) => <section>{children}</section>,
  CardHeader: ({ title, subtitle }: { title: string; subtitle?: string }) => <h2>{title} {subtitle}</h2>,
  CardBody: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Alert: ({ title, children }: { title: string; children: ReactNode }) => <div role="alert">{title}{children}</div>,
  Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
    <button type="button" onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Input: ({ label, rightElement: _right, ...props }: ComponentProps<'input'> & { label: string; rightElement?: ReactNode }) => (
    <label>{label}<input {...props} /></label>
  ),
  StatGrid: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  Stat: ({ label, value }: { label: string; value: ReactNode }) => <div>{label}: {value}</div>,
  Badge: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  toast,
}))

import { LifecyclePanel } from '../campaigns/[id]/LifecyclePanel'
import type { MarketingCampaign } from '@/types/marketing'
import type { LifecycleCampaignStats } from '@/services/marketing-lifecycle'

const CAMPAIGN = {
  id: 'c1',
  status: 'sending',
  kind: 'lifecycle',
  sendDays: [4],
  promoteAtLocal: '16:00',
  cooldownDays: 365,
  holdoutPercent: 20,
  audience: {
    includeTags: [],
    excludeTags: [],
    customerFilter: {
      rule: 'table_return_visit',
      touch: 1,
      days_since_anchor_min: 45,
      days_since_anchor_max: 180,
      include_no_shows: true,
      voucher_type_id: 'return-10',
      voucher_valid_days: 30,
    },
  },
} as unknown as MarketingCampaign

const STATS: LifecycleCampaignStats = {
  selected: 50,
  sent: 38,
  holdout: 10,
  bookedSinceSelection: 2,
  vouchersIssued: 38,
  vouchersRedeemed: 6,
  discountGivenPence: 3250,
  attributedBookings: 4,
  sentGroup: { matured30: 30, matured90: 0, booked30: 6, booked90: 0 },
  holdoutGroup: { matured30: 8, matured90: 0, booked30: 1, booked90: 0 },
}

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('LifecyclePanel', () => {
  it('says who it picks and when it sends', () => {
    render(<LifecyclePanel campaign={CAMPAIGN} stats={STATS} statsError={null} canSend onChanged={vi.fn()} />)
    expect(screen.getByText(/last table visit was 45 to 180 days ago/)).toBeTruthy()
    expect(screen.getByText('Thursday from 16:00')).toBeTruthy()
  })

  it('shows the sent group against the control group, and a dash until 90 days have passed', () => {
    render(<LifecyclePanel campaign={CAMPAIGN} stats={STATS} statsError={null} canSend onChanged={vi.fn()} />)
    expect(screen.getByText('6 of 30 (20%)')).toBeTruthy()
    expect(screen.getByText('1 of 8 (12.5%)')).toBeTruthy()
    expect(screen.getAllByText('-').length).toBe(2)
    expect(screen.getByText(/Discount given: £32.50/)).toBeTruthy()
  })

  it('saves a new control group share', async () => {
    setHoldout.mockResolvedValue({ success: true })
    const onChanged = vi.fn()
    render(<LifecyclePanel campaign={CAMPAIGN} stats={null} statsError={null} canSend onChanged={onChanged} />)

    fireEvent.change(screen.getByLabelText('Control group'), { target: { value: '0' } })
    fireEvent.click(screen.getByText('Save Control Group'))

    await waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(setHoldout).toHaveBeenCalledWith({ id: 'c1', holdoutPercent: 0 })
  })

  it('offers no control to someone without the send permission', () => {
    render(<LifecyclePanel campaign={CAMPAIGN} stats={null} statsError={null} canSend={false} onChanged={vi.fn()} />)
    expect(screen.queryByText('Save Control Group')).toBeNull()
  })
})

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { EventPromotionContentCard } from '@/components/features/events/EventPromotionContentCard'
import { generateEventPromotionContent } from '@/app/actions/event-content'
import type { EventMarketingLink } from '@/app/actions/event-marketing-links'

vi.mock('@/app/actions/event-content', () => ({ generateEventPromotionContent: vi.fn() }))
vi.mock('@/ds/primitives/Toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const eventId = 'd81512e7-5e99-48fd-a153-3400c2f6f009'
const links: EventMarketingLink[] = [
  { id: 'fb', channel: 'facebook', label: 'Facebook', type: 'digital', shortCode: 'fb123', shortUrl: 'https://l.the-anchor.pub/fb123', destinationUrl: 'https://www.the-anchor.pub/events/test?utm_source=facebook', utm: {}, clickCount: 0 },
  { id: 'gp', channel: 'google_business_profile', label: 'Google Business Profile', type: 'digital', shortCode: 'gp123', shortUrl: 'https://l.the-anchor.pub/gp123', destinationUrl: 'https://www.the-anchor.pub/events/test?utm_source=google_business', utm: {}, clickCount: 0 },
]
const mockGenerate = vi.mocked(generateEventPromotionContent)
const renderCard = () => render(<EventPromotionContentCard eventId={eventId} eventName="Cash Bingo" marketingLinks={links} />)

beforeEach(() => vi.resetAllMocks())

describe('event copy builder generation controls', () => {
  it('sends the chosen short link and destination, then discards stale copy after a link change', async () => {
    mockGenerate.mockResolvedValue({ success: true, data: { type: 'facebook_event', content: { name: 'Cash Bingo', description: 'A warm invitation.' }, warnings: [] } })
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Facebook Event Copy' }))
    expect(await screen.findByDisplayValue('A warm invitation.')).toBeVisible()
    expect(mockGenerate).toHaveBeenCalledWith({ eventId, contentType: 'facebook_event', ctaUrl: links[0].shortUrl, ctaDestinationUrl: links[0].destinationUrl })
    fireEvent.change(screen.getByLabelText('CTA link'), { target: { value: 'gp' } })
    await waitFor(() => expect(screen.queryByDisplayValue('A warm invitation.')).not.toBeInTheDocument())
  })

  it('shows GBP policy notices alongside checked copy and uses its own link', async () => {
    mockGenerate.mockResolvedValue({ success: true, data: { type: 'google_business_profile_event', content: { title: 'Cash Bingo', description: 'Your bingo invitation.' }, warnings: ['Check Google restrictions before publishing cash bingo.'] } })
    renderCard()
    fireEvent.change(screen.getByLabelText('Content type'), { target: { value: 'google_business_profile_event' } })
    fireEvent.click(screen.getByRole('button', { name: 'Generate Google Business Profile Event Copy' }))
    expect(await screen.findByText('Check Google restrictions before publishing cash bingo.')).toBeVisible()
    expect(screen.getByDisplayValue('Your bingo invitation.')).toBeVisible()
    expect(mockGenerate).toHaveBeenCalledWith({ eventId, contentType: 'google_business_profile_event', ctaUrl: links[1].shortUrl, ctaDestinationUrl: links[1].destinationUrl })
  })

  it('locks the channel and CTA while generating and shows a failed check without copy', async () => {
    let finish!: (result: Awaited<ReturnType<typeof generateEventPromotionContent>>) => void
    mockGenerate.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    renderCard()
    fireEvent.click(screen.getByRole('button', { name: 'Generate Facebook Event Copy' }))
    expect(screen.getByLabelText('Content type')).toBeDisabled()
    expect(screen.getByLabelText('CTA link')).toBeDisabled()
    await act(async () => finish({ success: false, error: 'The draft still needs correction: price conflicts with the event.' }))
    expect(await screen.findByText('The draft still needs correction: price conflicts with the event.')).toBeVisible()
    expect(screen.queryByRole('button', { name: 'Copy All' })).not.toBeInTheDocument()
    expect(screen.getByLabelText('Content type')).toBeEnabled()
  })

  it('preserves a saved draft while the initial default link is selected', async () => {
    render(<EventPromotionContentCard eventId={eventId} eventName="Cash Bingo" marketingLinks={links} facebookName="Saved bingo" facebookDescription="Previously saved description." />)
    expect(await screen.findByDisplayValue('Previously saved description.')).toBeVisible()
    expect(screen.getByLabelText('CTA link')).toHaveValue('fb')
  })
})

import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { KeywordStrategyCard } from '../KeywordStrategyCard'

function renderCard(props: Partial<Parameters<typeof KeywordStrategyCard>[0]> = {}) {
  const handlers = { onPrimaryChange: vi.fn(), onSecondaryChange: vi.fn(), onLocalChange: vi.fn() }
  render(
    <KeywordStrategyCard
      primaryKeywords=""
      secondaryKeywords=""
      localSeoKeywords=""
      {...handlers}
      {...props}
    />,
  )
  return handlers
}

describe('KeywordStrategyCard (spec 6.3.1)', () => {
  it('names the three tiers Focus, Supporting and Local', () => {
    renderCard()
    expect(screen.getByLabelText('Focus')).toBeInTheDocument()
    expect(screen.getByLabelText('Supporting')).toBeInTheDocument()
    expect(screen.getByLabelText('Local')).toBeInTheDocument()
    expect(screen.queryByText('Primary Keywords')).not.toBeInTheDocument()
    expect(screen.getByText(/Place names only/)).toBeInTheDocument()
  })

  it('offers the suggestion from the event name while Focus is empty, and fills it on click', () => {
    const { onPrimaryChange } = renderCard({ focusSuggestion: 'festive music bingo' })
    expect(screen.getByText(/festive music bingo/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Use this' }))
    expect(onPrimaryChange).toHaveBeenCalledWith('festive music bingo')
  })

  it('stops offering once staff have typed a focus phrase', () => {
    renderCard({ focusSuggestion: 'festive music bingo', primaryKeywords: 'christmas music bingo' })
    expect(screen.queryByRole('button', { name: 'Use this' })).not.toBeInTheDocument()
  })

  it('tells a category to leave Focus to each event', () => {
    renderCard({ forCategory: true })
    expect(screen.getByText(/Each event sets its own focus phrase/)).toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { cn } from '@/lib/utils'
import { GuestAlert } from '@/components/features/guest/GuestAlert'
import { GuestAmount } from '@/components/features/guest/GuestAmount'
import { GuestBadge } from '@/components/features/guest/GuestBadge'
import { GuestButton } from '@/components/features/guest/GuestButton'
import { GuestCard } from '@/components/features/guest/GuestCard'
import { GuestInput, GuestTextarea } from '@/components/features/guest/GuestControls'
import { DetailRow } from '@/components/features/guest/DetailRow'
import { GUEST_BADGE_TONE_CLASS, type GuestBadgeTone } from '@/components/features/guest/status-ui'
import * as styles from '@/components/features/guest/styles'

/**
 * The guest kit joins its class strings with `cn()`. That is only safe because src/lib/utils.ts
 * registers the guest tokens with tailwind-merge: without it `text-guest-body` reads as a colour
 * and one of the size or the colour is silently dropped. These tests render the real components
 * and check both survive, and that a later class of the same kind still replaces an earlier one.
 */

const classes = (value: string): string[] => value.split(/\s+/).filter(Boolean)

describe('the guest class strings survive cn()', () => {
  // Every export of styles.ts is a class string; the type keeps it that way.
  const entries: Array<[string, string]> = Object.entries(styles)

  it.each(entries)('%s keeps every class', (_name, value) => {
    expect(classes(cn(value))).toEqual(classes(value))
  })

  it.each(entries)('%s keeps every class beside a layout class', (_name, value) => {
    const merged = classes(cn('text-center mt-2', value))
    for (const name of classes(value)) expect(merged).toContain(name)
    expect(merged).toContain('text-center')
    expect(merged).toContain('mt-2')
  })
})

describe('guest components merge through cn()', () => {
  it('keeps the button label size and colour, and lets a caller width win', () => {
    render(
      <GuestButton fullWidth className="w-auto">
        Pay deposit
      </GuestButton>,
    )
    const button = screen.getByRole('button', { name: 'Pay deposit' })
    expect(button).toHaveClass('text-guest-control', 'text-guest-button-text', 'border-2', 'border-transparent', 'w-auto')
    expect(button).not.toHaveClass('w-full')
  })

  it('swaps the field border colour when invalid but keeps its width, size and focus border', () => {
    render(<GuestInput aria-label="Email" invalid />)
    const input = screen.getByRole('textbox', { name: 'Email' })
    expect(input).toHaveClass(
      'border-anchor-danger',
      'border-[1.5px]',
      'focus:border-anchor-gold-dark',
      'text-guest-control',
      'text-guest-text',
    )
    expect(input).not.toHaveClass('border-guest-border-strong')
  })

  it('keeps the resting border and the resize handle on a valid textarea', () => {
    render(<GuestTextarea aria-label="Notes" />)
    expect(screen.getByRole('textbox', { name: 'Notes' })).toHaveClass('border-guest-border-strong', 'resize-y')
  })

  it('lets a caller padding replace the card padding', () => {
    render(
      <GuestCard className="p-guest-xl">
        <p>Card body</p>
      </GuestCard>,
    )
    const card = screen.getByText('Card body').parentElement as HTMLElement
    expect(card).toHaveClass('p-guest-xl', 'rounded-guest-card', 'shadow-guest-card')
    expect(card).not.toHaveClass('p-5')
  })

  it.each(Object.keys(GUEST_BADGE_TONE_CLASS) as GuestBadgeTone[])('keeps the badge size and the %s colour', (tone) => {
    render(<GuestBadge tone={tone}>Status</GuestBadge>)
    const badge = screen.getByText('Status')
    expect(badge).toHaveClass('text-guest-note', 'leading-guest-flat', ...classes(GUEST_BADGE_TONE_CLASS[tone]))
  })

  it('keeps the alert body size beside its colour', () => {
    render(<GuestAlert tone="problem">Card declined</GuestAlert>)
    expect(screen.getByText('Card declined')).toHaveClass('text-guest-body', 'text-guest-text')
  })

  it('keeps a deadline value gold at the body size', () => {
    render(<DetailRow label="Offer expires" value="Friday 6pm" emphasis="deadline" />)
    expect(screen.getByText('Friday 6pm')).toHaveClass('text-guest-body', 'leading-guest-snug', 'text-guest-accent-text')
  })

  it('keeps the statement figure sizes beside its colour', () => {
    render(<GuestAmount label="Total due" value="£40.00" />)
    expect(screen.getByText('£40.00')).toHaveClass(
      'text-guest-amount',
      'sm:text-guest-amount-wide',
      'text-guest-text-strong',
      'font-anchor-display',
    )
  })
})

import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GuestBadge, guestBadgeToneForStatus } from '@/components/features/guest'

// The barrel re-exports GuestShell, which loads the guest webfonts, and
// next/font/google is a build-time transform with no loader under Vitest.
// Any test importing from '@/components/features/guest' needs this stub.
vi.mock('next/font/google', () => {
  const font = (): { variable: string; className: string } => ({
    variable: 'mock-font-variable',
    className: 'mock-font',
  })
  return { DM_Serif_Display: font, Outfit: font, Clicker_Script: font }
})

describe('guestBadgeToneForStatus', () => {
  it('maps the statuses these pages actually render', () => {
    for (const status of ['Confirmed', 'Completed', 'Seated', 'Paid']) {
      expect(guestBadgeToneForStatus(status)).toBe('success')
    }
    for (const status of ['Awaiting deposit', 'Pending', 'Pending Confirmation', 'Outstanding']) {
      expect(guestBadgeToneForStatus(status)).toBe('outstanding')
    }
    for (const status of ['Cancelled', 'No show', 'Failed']) {
      expect(guestBadgeToneForStatus(status)).toBe('danger')
    }
  })

  it('normalises the casing, spacing and underscores the database uses', () => {
    expect(guestBadgeToneForStatus('no_show')).toBe('danger')
    expect(guestBadgeToneForStatus('  CONFIRMED  ')).toBe('success')
    expect(guestBadgeToneForStatus('awaiting  deposit')).toBe('outstanding')
  })

  it('falls back to outline for anything it does not recognise', () => {
    // A status added to the database later must show up readable, not
    // mis-coloured and not blank.
    expect(guestBadgeToneForStatus('Awaiting kitchen sign off')).toBe('outline')
    expect(guestBadgeToneForStatus('')).toBe('outline')
  })
})

describe('GuestBadge', () => {
  it('renders every tone', () => {
    render(
      <>
        <GuestBadge tone="success">Confirmed</GuestBadge>
        <GuestBadge tone="outstanding">Awaiting deposit</GuestBadge>
        <GuestBadge tone="danger">Cancelled</GuestBadge>
        <GuestBadge tone="outline">Unknown</GuestBadge>
      </>
    )

    expect(screen.getByText('Confirmed').className).toContain('text-anchor-success')
    expect(screen.getByText('Awaiting deposit').className).toContain('text-guest-accent-text')
    expect(screen.getByText('Cancelled').className).toContain('text-anchor-danger')
    expect(screen.getByText('Unknown').className).toContain('border-guest-border-strong')
  })

  it('maps an unrecognised status to outline while preserving the humanised text', () => {
    const status = 'Awaiting kitchen sign off'
    render(<GuestBadge tone={guestBadgeToneForStatus(status)}>{status}</GuestBadge>)

    const badge = screen.getByText(status)
    expect(badge).toBeInTheDocument()
    expect(badge.className).toContain('border-guest-border-strong')
    expect(badge.className).not.toContain('text-anchor-success')
    expect(badge.className).not.toContain('text-anchor-danger')
  })

  it('hides the dot from assistive tech, because the text carries the status', () => {
    const { container } = render(
      <GuestBadge tone="success" dot>
        Confirmed
      </GuestBadge>
    )

    const dot = container.querySelector('[aria-hidden="true"]')
    expect(dot).not.toBeNull()
    expect(screen.getByText('Confirmed')).toHaveTextContent('Confirmed')
  })

  it('omits the dot unless asked', () => {
    const { container } = render(<GuestBadge tone="success">Confirmed</GuestBadge>)

    expect(container.querySelector('[aria-hidden="true"]')).toBeNull()
  })
})

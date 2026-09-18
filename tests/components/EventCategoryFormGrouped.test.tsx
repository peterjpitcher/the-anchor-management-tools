import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, within } from '@testing-library/react'

vi.mock('@/app/actions/event-images', () => ({
  uploadEventImage: vi.fn(),
  deleteEventImage: vi.fn(),
  deleteCategoryImage: vi.fn(),
}))

import { EventCategoryFormGrouped } from '@/components/features/events/EventCategoryFormGrouped'

function renderForm() {
  render(<EventCategoryFormGrouped category={null} onSubmit={vi.fn()} onCancel={vi.fn()} />)
}

function pressedIn(group: HTMLElement): string[] {
  return within(group)
    .getAllByRole('button')
    .filter((button) => button.getAttribute('aria-pressed') === 'true')
    .map((button) => button.getAttribute('title') ?? '')
}

// The pickers showed the chosen colour and icon only as a ring or border, so a screen reader
// could not tell which one was selected (accessibility review, 18 Sep 2026).
describe('EventCategoryFormGrouped colour and icon pickers', () => {
  it('names the colour picker and says which colour is selected', () => {
    renderForm()

    const colours = screen.getByRole('group', { name: 'Color' })
    expect(within(colours).getByRole('button', { name: 'Purple' })).toHaveAttribute('aria-pressed', 'true')
    expect(within(colours).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'false')
    expect(pressedIn(colours)).toEqual(['Purple'])
  })

  it('moves the selected state when another colour is picked', () => {
    renderForm()

    const colours = screen.getByRole('group', { name: 'Color' })
    fireEvent.click(within(colours).getByRole('button', { name: 'Green' }))

    expect(within(colours).getByRole('button', { name: 'Green' })).toHaveAttribute('aria-pressed', 'true')
    expect(pressedIn(colours)).toEqual(['Green'])
  })

  it('names the icon picker and says which icon is selected', () => {
    renderForm()

    const icons = screen.getByRole('group', { name: 'Icon' })
    expect(within(icons).getByRole('button', { name: 'Academic' })).toHaveAttribute('aria-pressed', 'true')
    expect(pressedIn(icons)).toEqual(['Academic'])

    fireEvent.click(within(icons).getByRole('button', { name: 'Games' }))

    expect(within(icons).getByRole('button', { name: 'Games' })).toHaveAttribute('aria-pressed', 'true')
    expect(pressedIn(icons)).toEqual(['Games'])
  })
})

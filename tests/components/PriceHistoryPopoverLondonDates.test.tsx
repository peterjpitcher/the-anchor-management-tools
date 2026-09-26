// An ingredient's price history, dated on the London clock.
//
// menu_ingredient_prices.effective_from is a timestamptz. The popover formatted it with the
// device's zone and default locale, so a price effective just after midnight BST showed the
// previous day on any device not set to London time.
//
// 23:30 UTC on 1 October 2026 is 00:30 BST on 2 October in London.
import { fireEvent, render, screen } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { PriceHistoryPopover } from '@/app/(authenticated)/menu-management/ingredients/_components/PriceHistoryPopover'

vi.mock('@/app/actions/menu-management', () => ({
  getMenuIngredientPrices: vi.fn(async () => ({
    data: [
      {
        id: 'price-1',
        pack_cost: 12.5,
        effective_from: '2026-10-01T23:30:00+00:00',
        supplier_name: null,
        supplier_sku: null,
        notes: null,
        created_at: '2026-10-01T23:30:00+00:00',
      },
    ],
  })),
}))

// The design-system Popover currently ignores onOpenChange, which is how this component loads
// its prices. Stand in a popover that honours it, so the test reaches the price rows.
vi.mock('@/ds', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/ds')>()
  const { useState } = await import('react')

  function StubPopover({
    trigger,
    children,
    onOpenChange,
  }: {
    trigger: ReactNode
    children: ReactNode
    onOpenChange?: (open: boolean) => void
  }) {
    const [open, setOpen] = useState(false)
    return (
      <div>
        <button
          type="button"
          onClick={() => {
            setOpen(true)
            onOpenChange?.(true)
          }}
        >
          {trigger}
        </button>
        {open ? children : null}
      </div>
    )
  }

  return { ...actual, Popover: StubPopover }
})

describe('PriceHistoryPopover, London dates', () => {
  it('dates a price by its London day', async () => {
    render(
      <PriceHistoryPopover ingredientId="ingredient-1" ingredientName="Beef mince" trigger="Prices" />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Prices' }))

    expect(await screen.findByText('Effective 02/10/2026')).toBeInTheDocument()
  })
})

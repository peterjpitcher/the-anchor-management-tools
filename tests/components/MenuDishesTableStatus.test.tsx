import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MenuDishesTable } from '@/app/(authenticated)/menu-management/_components/MenuDishesTable'

function makeDish(name: string, isActive: boolean) {
  return {
    id: name.toLowerCase().replaceAll(' ', '-'),
    name,
    selling_price: 12,
    portion_cost: 4,
    gp_pct: 2 / 3,
    target_gp_pct: 0.7,
    is_gp_alert: true,
    is_active: isActive,
    assignments: [],
    ingredients: [],
    recipes: [],
  }
}

describe('MenuDishesTable active status', () => {
  it('shows active status separately from costing status', () => {
    render(
      <MenuDishesTable
        dishes={[makeDish('Active Dish', true), makeDish('Inactive Dish', false)]}
        loadError={null}
        standardTarget={0.7}
      />,
    )

    expect(screen.getByRole('columnheader', { name: 'Active status' })).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Costing status' })).toBeInTheDocument()
    expect(screen.getAllByText('Active')).toHaveLength(1)
    expect(screen.getAllByText('Inactive')).toHaveLength(1)
  })
})

describe('MenuDishesTable below-target rows', () => {
  it('keeps the red tint on hover instead of the grey row hover', () => {
    render(
      <MenuDishesTable
        dishes={[{ ...makeDish('Cheap Dish', true), gp_pct: 0.5 }]}
        loadError={null}
        standardTarget={0.7}
      />,
    )

    const row = screen.getByText('Cheap Dish').closest('tr')
    expect(row).not.toBeNull()
    expect(row?.className).toContain('bg-danger-soft')
    expect(row?.className).toContain('hover:bg-danger-soft')
    expect(row?.className).not.toContain('hover:bg-surface-hover')
  })
})

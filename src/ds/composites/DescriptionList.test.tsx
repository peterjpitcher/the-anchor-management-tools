import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { DescriptionList } from './DescriptionList'

describe('DescriptionList', () => {
  it('renders semantic terms and descriptions', () => {
    const { container } = render(
      <DescriptionList
        items={[
          { key: 'name', label: 'Name', value: 'The Anchor' },
          { key: 'phone', label: 'Phone', value: null },
        ]}
      />,
    )

    expect(container.querySelector('dl')).toBeTruthy()
    expect(screen.getByText('Name').tagName).toBe('DT')
    expect(screen.getByText('The Anchor').tagName).toBe('DD')
    expect(screen.getByText('—').tagName).toBe('DD')
  })

  it('uses responsive column classes', () => {
    const { container } = render(
      <DescriptionList
        columns={3}
        items={[{ key: 'status', label: 'Status', value: 'Active' }]}
      />,
    )

    expect(container.querySelector('dl')?.className).toContain('lg:grid-cols-3')
  })
})

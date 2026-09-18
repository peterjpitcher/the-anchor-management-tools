import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import { Button } from './Button'

const sizes = ['xs', 'sm', 'md', 'lg'] as const

describe('Button', () => {
  it.each(sizes)('keeps a link button flush at size %s', (size) => {
    render(
      <Button variant="link" size={size}>
        View
      </Button>,
    )

    const classes = screen.getByRole('button', { name: 'View' }).className.split(' ')
    expect(classes).toContain('p-0')
    expect(classes).toContain('h-auto')
    expect(classes.some((name) => /^(px-|h-(6|btn-h))/.test(name))).toBe(false)
  })

  it('sizes a normal button from the tokens', () => {
    render(<Button>Save</Button>)

    const classes = screen.getByRole('button', { name: 'Save' }).className.split(' ')
    expect(classes).toEqual(expect.arrayContaining(['h-btn-h', 'px-3', 'text-ui', 'rounded-default']))
    expect(classes).toEqual(
      expect.arrayContaining(['focus-visible:outline-hidden', 'focus-visible:shadow-ring', 'max-shell:min-h-touch']),
    )
  })
})

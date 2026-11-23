import { readFileSync } from 'node:fs'
import path from 'node:path'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { BackToFrontOfHouse } from '../BackToFrontOfHouse'

// Owner request, 23 November 2026: the way back to Front of House must sit in the same place on
// every page the till opens. Each of these pages renders the shared button as its header action,
// and none of them uses PageLayout's backButton (which renders after the actions and would push
// the button along) or a hand-made back link of its own.
const TILL_PAGES = [
  'src/app/(authenticated)/checklists/page.tsx',
  'src/app/(authenticated)/vouchers/foh/page.tsx',
  'src/app/(authenticated)/table-bookings/foh/parking/page.tsx',
  'src/app/(authenticated)/table-bookings/[id]/sheet/page.tsx',
]

describe('Back to Front of House', () => {
  it('links to the floor screen', () => {
    render(<BackToFrontOfHouse />)
    expect(screen.getByRole('link', { name: 'Back to Front of House' })).toHaveAttribute('href', '/table-bookings/foh')
  })

  it.each(TILL_PAGES)('%s uses the shared button and no other back control', (file) => {
    const source = readFileSync(path.resolve(process.cwd(), file), 'utf8')
    expect(source).toContain('<BackToFrontOfHouse />')
    expect(source).toContain('showHeaderActionsOnMobile')
    expect(source).not.toMatch(/backButton=\{/)
    expect(source).not.toContain('Back to the floor')
    expect(source).not.toMatch(/href="\/table-bookings\/foh"/)
  })

  it('is the last header action on the booking sheet', () => {
    const source = readFileSync(path.resolve(process.cwd(), TILL_PAGES[3]), 'utf8')
    const backLinks = source.slice(source.indexOf('const backLinks'))
    expect(backLinks.indexOf('<BackToFrontOfHouse />')).toBeGreaterThan(backLinks.indexOf('backButton.label'))
    const actions = source.slice(source.indexOf('const headerActions'))
    expect(actions.indexOf('{backLinks}')).toBeGreaterThan(actions.indexOf('Download PDF'))
  })
})

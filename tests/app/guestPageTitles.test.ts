// Every guest page names its browser tab the same way: a short, static, non-personal title
// ending " - The Anchor". A page without one showed the staff app's own title to a guest.

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const ROOT = process.cwd()
const GUEST_ROOTS = [
  'src/app/g',
  'src/app/booking-portal',
  'src/app/recruitment/book',
  'src/app/legacy-link',
  'src/app/(feedback)',
]

function pagesUnder(dir: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) found.push(...pagesUnder(path))
    else if (entry === 'page.tsx') found.push(relative(ROOT, path))
  }
  return found
}

const PAGES = GUEST_ROOTS.flatMap((root) => pagesUnder(join(ROOT, root)))

describe('guest page titles', () => {
  it('finds the guest pages', () => {
    expect(PAGES.length).toBeGreaterThanOrEqual(15)
  })

  it.each(PAGES)('%s has a static title ending " - The Anchor"', (file) => {
    const source = readFileSync(join(ROOT, file), 'utf8')
    const match = source.match(/export const metadata = \{\s*title: '([^']+)',?\s*\}/)

    expect(match, 'no static metadata title').not.toBeNull()
    expect(match?.[1]).toMatch(/^[A-Z][^-]* - The Anchor$/)
  })
})

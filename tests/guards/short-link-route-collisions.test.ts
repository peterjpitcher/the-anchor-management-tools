import { readdirSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

import { PROTECTED_SHORT_LINK_SLUGS } from '@/lib/short-links/routing'

/**
 * A short code only reaches the redirector when no real app route shares its
 * name. vercel.json rewrites `/:code` to `/api/redirect/:code` on the short-link
 * hosts, but Vercel checks rewrites AFTER the filesystem, so `src/app/<code>`
 * wins and the page is served directly: the guest still lands somewhere sensible,
 * the click is never recorded, and nothing fails loudly.
 *
 * That already happened to the 'feedback' slug, which is why the live review ask
 * moved to 'review' (system_settings.google_review_link). This guard fails if
 * anyone adds a route that shadows a protected slug.
 */

const APP_DIR = path.join(process.cwd(), 'src', 'app')

// 'feedback' is shadowed by src/app/(feedback)/feedback and has been since before
// this guard existed. The URL still works for guests, it just cannot be counted,
// so the slug stays protected but is exempt here. Do not add to this list to make
// a failure go away: pick a different slug, or accept that it will never count.
const KNOWN_SHADOWED_SLUGS = new Set(['feedback'])

function isRouteGroup(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')')
}

/** Every path segment the app serves at the top level, flattening route groups. */
function collectTopLevelRouteSegments(dir: string): Set<string> {
  const segments = new Set<string>()

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    // Private folders (_components and friends) are not routable.
    if (entry.name.startsWith('_')) continue

    if (isRouteGroup(entry.name)) {
      for (const nested of collectTopLevelRouteSegments(path.join(dir, entry.name))) {
        segments.add(nested)
      }
      continue
    }

    segments.add(entry.name.toLowerCase())
  }

  return segments
}

describe('short-link slugs are not shadowed by app routes', () => {
  const routeSegments = collectTopLevelRouteSegments(APP_DIR)

  it('finds the real top-level routes', () => {
    // Sanity check on the crawler itself, so a bad glob cannot make the guard
    // below pass by finding nothing.
    expect(routeSegments.has('dashboard')).toBe(true)
    expect(routeSegments.has('feedback')).toBe(true)
    expect(routeSegments.size).toBeGreaterThan(20)
  })

  it.each([...PROTECTED_SHORT_LINK_SLUGS].filter((slug) => !KNOWN_SHADOWED_SLUGS.has(slug)))(
    'keeps the %s slug reachable by the redirector',
    (slug) => {
      expect(routeSegments.has(slug)).toBe(false)
    }
  )

  it('still shadows every slug listed as known-shadowed', () => {
    // If a route is deleted this fails, which is the prompt to reclaim the slug
    // and start counting its clicks again.
    for (const slug of KNOWN_SHADOWED_SLUGS) {
      expect(routeSegments.has(slug)).toBe(true)
    }
  })
})

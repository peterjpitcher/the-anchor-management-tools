// Single-segment paths on a short-link host (l.the-anchor.pub, vip-club.uk)
// that must NOT be treated as short codes.
//
// This is deliberately NOT a mirror of src/app's top-level routes, and padding
// it to match them would break things. Two callers depend on it:
//
//   - src/middleware.ts skips session handling for a short-code path. A real
//     route that is missing here therefore skips middleware, but the
//     (authenticated) layout redirects to /auth/login on its own, so an
//     omission costs nothing. Verified against production on 2026-09-23:
//     l.the-anchor.pub/mileage (absent here) and /dashboard (present) both 307
//     to the login page.
//   - src/lib/sms/link-shortening.ts leaves a URL alone when it already looks
//     like a short link. Listing a live short code here makes the shortener
//     shorten our own short link into a redirect chain, so the guest review
//     slugs below must never be added.
//
// The risk worth guarding is the opposite direction: a NEW top-level route that
// collides with an existing short code silently shadows it, because Vercel
// rewrites lose to the filesystem. That is what already happened to 'feedback'.
// tests/guards/short-link-route-collisions.test.ts catches the next one.
const RESERVED_TOP_LEVEL_ROUTES = new Set([
  // Next.js / static
  '_next',
  'static',
  'api',

  // Public routes
  'auth',
  'error',
  'privacy',
  'booking-confirmation',
  'booking-success',
  'table-booking',
  'parking',
  'login',
  'legacy-link',

  // Authenticated routes
  'cashing-up',
  'customers',
  'dashboard',
  'employees',
  'events',
  'invoices',
  'marketing',
  'menu-management',
  'messages',
  'performers',
  'private-bookings',
  'profile',
  'quotes',
  'receipts',
  'roles',
  'settings',
  'short-links',
  'table-bookings',
  'unauthorized',
  'users',

  // Short-link prefix
  'l',
])

// Short-link slugs that back critical customer-facing flows. They resolve like
// any other short code, but must never be deleted or repointed from the
// short-links UI, because every review-request SMS relies on them reaching the
// review funnel landing page.
//
// 'review' is the live review ask, held in `system_settings.google_review_link`
// and read by getGoogleReviewLink (src/lib/events/review-link.ts). Unlike
// 'feedback' it has a `created_by`, so it IS listed in the staff short-links UI
// and would otherwise be one click from deletion. 'feedback' is kept protected
// as well: it is still printed and shared, even though a real /feedback route
// means the host serves that page directly and its clicks are never counted.
export const PROTECTED_SHORT_LINK_SLUGS = new Set(['feedback', 'review'])

export function isProtectedShortLinkSlug(code: string | null | undefined): boolean {
  if (!code) return false
  return PROTECTED_SHORT_LINK_SLUGS.has(code.trim().toLowerCase())
}

const SHORT_CODE_REGEX = /^[a-z0-9-]{3,20}$/i

function normalizeHostname(hostname: string): string {
  return hostname.split(':')[0]?.trim().toLowerCase() || ''
}

export function isShortLinkHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname)
  return (
    normalized === 'vip-club.uk' ||
    normalized.endsWith('.vip-club.uk') ||
    normalized === 'the-anchor.pub' ||
    normalized.endsWith('.the-anchor.pub')
  )
}

function isShortCodeSegment(segment: string): boolean {
  const normalized = segment.trim().toLowerCase()
  if (!SHORT_CODE_REGEX.test(normalized)) return false
  return !RESERVED_TOP_LEVEL_ROUTES.has(normalized)
}

export function isShortLinkPath(pathname: string): boolean {
  const trimmed = pathname.endsWith('/') && pathname.length > 1 ? pathname.slice(0, -1) : pathname
  const parts = trimmed.split('/').filter(Boolean)

  if (parts.length === 1) {
    return isShortCodeSegment(parts[0])
  }

  if (parts.length === 2 && parts[0]?.toLowerCase() === 'l') {
    return isShortCodeSegment(parts[1])
  }

  return false
}


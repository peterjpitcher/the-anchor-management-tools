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

  // Authenticated routes
  'cashing-up',
  'customers',
  'dashboard',
  'employees',
  'events',
  'invoices',
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


/**
 * Where to send someone after they sign in. Pure and browser-safe: the sign-in action (server)
 * and the login screen (client) both use it.
 *
 * Every value here comes from the browser (a `next` query parameter, the `redirectedFrom`
 * parameter or the `post_login_redirect` cookie), so it is treated as hostile: only a path on
 * this site is ever returned, never a link that could send someone to another site after they
 * have just typed their password.
 */

/** The prefix a portal-only user's saved link must start with to be honoured at sign-in. */
const PORTAL_PATH_PREFIX = '/portal/'

/** Longer than any real link in the app; anything longer is refused rather than trimmed. */
const MAX_PATH_LENGTH = 2048

/** A made-up origin to resolve against: a result on any other origin was not a relative path. */
const RESOLVE_ORIGIN = 'https://sign-in.invalid'

const BACKSLASH = String.fromCharCode(92)

/** True when the text holds a control character (0 to 31, or 127) or any whitespace. */
function hasControlOrSpace(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index)
    if (code < 32 || code === 127) return true
  }
  return /\s/.test(value)
}

/** True when a browser reading `path` as a link would stay on this site. */
function staysOnThisSite(path: string): boolean {
  if (!path.startsWith('/') || path.startsWith('//') || path.startsWith(`/${BACKSLASH}`)) return false
  try {
    return new URL(path, RESOLVE_ORIGIN).origin === RESOLVE_ORIGIN
  } catch {
    return false
  }
}

/**
 * A same-site relative path (`/something?with=query#and-hash`), normalised, or null.
 *
 * Refused: anything that is not a string; empty or over-long values; anything not starting with
 * a single `/` (so `//evil.example`, `https://...`, `javascript:` and bare words all fail); any
 * backslash (browsers read `/\evil.example` as another site); control characters and whitespace;
 * and anything that does not resolve to this site.
 *
 * The normalised result is checked again before it is returned: removing dot segments can turn
 * a harmless-looking path into a link to another site (`/.//evil.example` and
 * `/a/..//evil.example` both normalise to `//evil.example`), and the result is what the router
 * follows.
 */
export function safeRelativePath(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (value.length === 0 || value.length > MAX_PATH_LENGTH) return null
  if (!staysOnThisSite(value)) return null
  if (value.includes(BACKSLASH) || hasControlOrSpace(value)) return null

  let url: URL
  try {
    url = new URL(value, RESOLVE_ORIGIN)
  } catch {
    return null
  }
  if (url.origin !== RESOLVE_ORIGIN) return null
  const result = `${url.pathname}${url.search}${url.hash}`
  return staysOnThisSite(result) ? result : null
}

/** `.` or `..` as a whole path segment, written plainly or percent-encoded. */
const DOT_SEGMENT = /(?:^|\/)(?:\.|%2e){1,2}(?:\/|$)/i
/** A percent-encoded slash or backslash, which some servers and proxies decode again. */
const ENCODED_SEPARATOR = /%(?:2f|5c)/i

/**
 * A saved portal link a portal-only user may land on after signing in (`/portal/training/...`),
 * or null. On top of `safeRelativePath`: the path itself (before the query) must start with
 * `/portal/` as written, with no `//`, no `.` or `..` segment and no encoded slash, so nothing
 * can climb out of the portal once the browser normalises it.
 */
export function safePortalNextPath(raw: unknown): string | null {
  const path = safeRelativePath(raw)
  if (!path || typeof raw !== 'string') return null

  const written = raw.trim()
  const writtenPathname = written.split(/[?#]/, 1)[0] ?? ''
  if (!writtenPathname.startsWith(PORTAL_PATH_PREFIX)) return null
  if (writtenPathname.includes('//')) return null
  if (DOT_SEGMENT.test(writtenPathname) || ENCODED_SEPARATOR.test(writtenPathname)) return null

  // The normalised form must still be inside the portal (belt and braces after the checks above).
  const pathname = path.split(/[?#]/, 1)[0] ?? ''
  if (!pathname.startsWith(PORTAL_PATH_PREFIX)) return null
  return path
}

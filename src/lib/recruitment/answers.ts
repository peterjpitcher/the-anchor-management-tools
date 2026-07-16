/**
 * Formatting for `recruitment_applications.availability`.
 *
 * The column is jsonb and its schema is `z.unknown()`, so any shape can be
 * persisted. The same value is handed verbatim to the AI scorer, which weights
 * evening/weekend availability heavily — so a shape the UI cannot render is a
 * shape the AI scores on but the hiring manager never sees. Everything with
 * content must therefore reach the screen, even if only as a generic dump.
 */

/** Nesting beyond this is dumped as JSON rather than walked. */
const MAX_DEPTH = 4

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeJson(value: unknown): string | null {
  try {
    const json = JSON.stringify(value)
    return json && json !== '{}' && json !== '[]' && json !== 'null' ? json : null
  } catch {
    return null
  }
}

/** `preferred_role` -> `Preferred role`, `startDate` -> `Start Date`. */
function humaniseKey(key: string): string {
  const spaced = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim()
  if (!spaced) return key
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

/** Non-empty trimmed string, or null. Used to decide whether a key is consumable. */
function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null
}

/** Renders any JSON value inline. Returns null only when there is nothing to show. */
function formatValue(value: unknown, depth = 0): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') return value.trim() || null
  // Booleans read as yes/no because these are answers to a person, not data.
  if (typeof value === 'boolean') return value ? 'yes' : 'no'
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (depth >= MAX_DEPTH) return safeJson(value)

  if (Array.isArray(value)) {
    const parts = value
      .map(entry => formatValue(entry, depth + 1))
      .filter((part): part is string => part !== null)
    return parts.length > 0 ? parts.join(', ') : null
  }

  if (isPlainObject(value)) {
    const parts = formatEntries(value, depth + 1)
    return parts.length > 0 ? parts.join(', ') : null
  }

  return safeJson(value)
}

/** `Label: value` for each key that has content. */
function formatEntries(source: Record<string, unknown>, depth: number): string[] {
  const lines: string[] = []
  for (const [key, entry] of Object.entries(source)) {
    const formatted = formatValue(entry, depth)
    if (formatted !== null) lines.push(`${humaniseKey(key)}: ${formatted}`)
  }
  return lines
}

export interface AvailabilityAnswer {
  /** Everything the candidate said about availability, or null if they said nothing. */
  availability: string | null
  /** Surfaced separately — the public form collects it but it has its own row. */
  preferredRole: string | null
}

/**
 * Prefers `raw`/`text` when present, and falls back to a readable dump for any
 * other shape. Keys that are not consumed as the primary answer are appended
 * rather than dropped, so an unrecognised shape degrades instead of vanishing.
 */
export function formatAvailabilityAnswer(value: unknown): AvailabilityAnswer {
  if (value === null || value === undefined) {
    return { availability: null, preferredRole: null }
  }

  // Strings, arrays and primitives have no known keys to prefer.
  if (!isPlainObject(value)) {
    return { availability: formatValue(value), preferredRole: null }
  }

  const consumed = new Set<string>()

  const preferredRole = readString(value.preferred_role)
  if (preferredRole !== null) consumed.add('preferred_role')

  // `raw` and `text` are aliases for the same answer, so a usable one suppresses
  // the other rather than being appended next to it. A key that does not hold a
  // usable string is left unconsumed and falls through to the generic dump, so a
  // non-string `raw` is still shown rather than lost.
  let primary: string | null = null
  for (const key of ['raw', 'text']) {
    const candidate = readString(value[key])
    if (candidate === null) continue
    if (primary === null) primary = candidate
    consumed.add(key)
  }

  const rest: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (!consumed.has(key)) rest[key] = entry
  }

  const restLines = formatEntries(rest, 1)
  const lines = primary !== null ? [primary, ...restLines] : restLines

  return {
    availability: lines.length > 0 ? lines.join('\n') : null,
    preferredRole,
  }
}

/**
 * Length limits of the varchar columns on `public.short_link_clicks`, as they stand in
 * production (information_schema, 21 Sep 2026). Every other column is text, uuid, inet,
 * jsonb or a timestamp and has no length limit.
 *
 * Postgres refuses the whole row (22001, value too long) when any one of these values is
 * over its limit, and the redirect handler has no second chance, so the click is lost.
 * Facebook ad links carry the full ad name in `utm_content`, up to 160 characters, and
 * those clicks were being dropped. Add any new varchar column here in the same change.
 */
export const SHORT_LINK_CLICK_COLUMN_LIMITS = {
  country: 2,
  city: 100,
  region: 100,
  device_type: 20,
  browser: 50,
  os: 50,
  utm_source: 100,
  utm_medium: 100,
  utm_campaign: 100,
  utm_content: 100,
} as const

// varchar(n) counts characters, not UTF-16 code units, so clip by code point. Slicing the
// raw string could split an emoji or other astral character in half.
function clipToLength(value: string, limit: number): string {
  const characters = Array.from(value)
  return characters.length > limit ? characters.slice(0, limit).join('') : value
}

/** Clip every limited value in a click row so the insert cannot fail on length. */
export function clipShortLinkClickRow<T extends Record<string, unknown>>(row: T): T {
  const clipped: Record<string, unknown> = { ...row }
  for (const [column, limit] of Object.entries(SHORT_LINK_CLICK_COLUMN_LIMITS)) {
    const value = clipped[column]
    if (typeof value === 'string') {
      clipped[column] = clipToLength(value, limit)
    }
  }
  return clipped as T
}

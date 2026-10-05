import { z } from 'zod'

// Attribution labels are the reporting hints a public booking request carries: UTM tags, click
// ids, the page the booking came from, and labels describing what was booked. They never decide
// whether a booking is made, so a bad one must never reject a booking. `z.string()` refuses a
// null, a number, an array or an object before any transform runs, and a schema failure on a
// booking route is a 400, so each label is cleaned BEFORE it is validated: anything of the wrong
// type, or blank, counts as not sent, and a long one is cut to its cap. The rejected input is
// never logged. Real booking details (who, what, when, how many) must not use these helpers.

const NUL = String.fromCharCode(0)

/** A text label: trimmed and cut to `cap`, or undefined when it is not usable text. */
export function cleanAttributionLabel(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = value.trim().slice(0, cap)
  if (!cleaned) return undefined
  // Postgres jsonb refuses a NUL, and a lone surrogate (which a cut through an emoji leaves
  // behind). Storing either would fail the whole analytics insert and lose the booking's event
  // along with the label, so the label alone is dropped.
  if (cleaned.includes(NUL) || !cleaned.isWellFormed()) return undefined
  return cleaned
}

// Advert click ids. Each one identifies a single person's click on a single advert, so it is
// never kept against a booking, whether sent as its own field or inside a page address.
const CLICK_ID_PARAMS = new Set(['fbclid', 'gclid', 'gbraid', 'wbraid', 'dclid', 'msclkid', 'ttclid', 'twclid'])

/** The address with any click id taken out of its query string. Untouched when it carries none. */
function withoutClickIds(value: string): string {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return value
  }
  const clickIdKeys = [...new Set(url.searchParams.keys())].filter((key) => CLICK_ID_PARAMS.has(key.toLowerCase()))
  if (clickIdKeys.length === 0) return value
  for (const key of clickIdKeys) url.searchParams.delete(key)
  return url.toString()
}

/**
 * A page address kept as a label: click ids removed, cleaned as text, then dropped unless it
 * still reads as a URL. The click ids go before the cut, so a long one cannot survive in part.
 */
export function cleanAttributionUrl(value: unknown, cap: number): string | undefined {
  if (typeof value !== 'string') return undefined
  const cleaned = cleanAttributionLabel(withoutClickIds(value), cap)
  if (!cleaned) return undefined
  return z.string().url().safeParse(cleaned).success ? cleaned : undefined
}

/** A price or value kept as a label: a finite number of zero or more, otherwise not sent. */
export function cleanAttributionNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined
}

type LenientString = z.ZodEffects<z.ZodOptional<z.ZodString>, string | undefined, unknown>
type LenientNumber = z.ZodEffects<z.ZodOptional<z.ZodNumber>, number | undefined, unknown>

export function attributionLabel(cap: number): LenientString {
  return z.preprocess((value) => cleanAttributionLabel(value, cap), z.string().optional())
}

export function attributionUrl(cap: number): LenientString {
  return z.preprocess((value) => cleanAttributionUrl(value, cap), z.string().optional())
}

export function attributionNumber(): LenientNumber {
  return z.preprocess((value) => cleanAttributionNumber(value), z.number().optional())
}

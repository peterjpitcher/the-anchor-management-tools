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

/** A page address kept as a label: cleaned as text, then dropped unless it still reads as a URL. */
export function cleanAttributionUrl(value: unknown, cap: number): string | undefined {
  const cleaned = cleanAttributionLabel(value, cap)
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

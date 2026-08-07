import { z } from 'zod'

/**
 * Parses a boolean that arrived through FormData.
 *
 * `z.coerce.boolean()` must never be used for this: FormData values are always
 * strings, and `Boolean("false")` is `true`, so an unticked checkbox sent as
 * `String(false)` silently arrives as true. That is how "non-billable" entries
 * were still being invoiced.
 *
 * Returns undefined for absent or empty values so callers keep control of the
 * default, and leaves anything unrecognised untouched so zod reports it rather
 * than guessing.
 */
export const formBooleanSchema = z.preprocess((value) => {
  if (value == null || value === '') return undefined
  if (typeof value === 'boolean') return value

  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase()
    if (normalized === 'true' || normalized === 'on' || normalized === 'yes' || normalized === '1') return true
    if (normalized === 'false' || normalized === 'off' || normalized === 'no' || normalized === '0') return false
  }

  return value
}, z.boolean().optional())

/** Same parsing, with an explicit default when the field is absent. */
export function formBooleanWithDefault(defaultValue: boolean) {
  return formBooleanSchema.transform((value) => value ?? defaultValue)
}

/**
 * Allergy information on a table booking, wherever the guest or staff happened to type it (BK-052).
 *
 * Neither booking form had an allergy box until October 2026, so allergies have mostly arrived in
 * the booking notes, where the allergy flag, the FOH timeline, the BOH list and the kitchen sheet
 * never looked. These helpers read all three places, and the screens mark a booking whose notes
 * mention an allergen as loudly as one with the allergy field filled in. A false alarm costs a
 * glance at the notes; a missed allergy can put someone in hospital, so the word list leans wide.
 */

/** The 14 UK allergens and the words people use for them, plus the general words for an allergy. */
const ALLERGY_PATTERN =
  /\b(allerg\w*|anaphyla\w*|epi-?pens?|coeliac|celiac|gluten|wheat|nuts?|peanuts?|tree ?nuts?|sesame|shellfish|crustaceans?|prawns?|molluscs?|mussels?|dairy|lactose|milk|eggs?|soya?|celery|mustard|lupin|sulph?ites?|sulfites?|fish|intoleran\w*)\b/i

/** True when free text mentions an allergy or one of the 14 allergens. */
export function mentionsAllergy(text: string | null | undefined): boolean {
  return typeof text === 'string' && ALLERGY_PATTERN.test(text)
}

/**
 * The allergy field as staff type it: one box, split on commas, semicolons and new lines, trimmed,
 * with blanks dropped. The same limits as the public booking API (up to 20 entries of 100
 * characters), so a staff booking and an online one store the same shape.
 */
export function parseAllergyList(text: string | null | undefined): string[] {
  if (typeof text !== 'string') return []
  return text
    .split(/[,;\n]/)
    .map((entry) => entry.trim().slice(0, 100))
    .filter((entry) => entry.length > 0)
    .slice(0, 20)
}

export type BookingNoteFacts = {
  allergies?: readonly string[] | null
  dietaryRequirements?: readonly string[] | null
  notes?: string | null
}

/**
 * What a booking row should be marked with: `allergy` when the allergy field is filled in or any
 * note mentions an allergen, `note` when there is any other note or dietary need, or null.
 */
export function bookingNoteMarker(facts: BookingNoteFacts): 'allergy' | 'note' | null {
  const allergies = (facts.allergies ?? []).filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
  const dietary = (facts.dietaryRequirements ?? []).filter((entry) => typeof entry === 'string' && entry.trim().length > 0)
  const notes = typeof facts.notes === 'string' ? facts.notes.trim() : ''
  if (allergies.length > 0 || mentionsAllergy(notes) || dietary.some((entry) => mentionsAllergy(entry))) return 'allergy'
  if (notes.length > 0 || dietary.length > 0) return 'note'
  return null
}

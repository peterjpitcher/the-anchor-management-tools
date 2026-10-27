import { Badge } from '@/ds'
import { bookingNoteMarker, type BookingNoteFacts } from '@/lib/table-bookings/allergy-words'

/**
 * "Allergy" in red when the booking's allergy field is filled in or a note mentions an allergen,
 * "Note" when it carries any other note or dietary need, nothing otherwise (BK-052). Shown on the
 * BOH list, so staff can see which bookings to open before service without opening every one.
 */
export function BookingNoteMarker(props: BookingNoteFacts) {
  const marker = bookingNoteMarker(props)
  if (!marker) return null
  return marker === 'allergy' ? <Badge tone="danger">Allergy</Badge> : <Badge tone="neutral">Note</Badge>
}

// BK-052: the BOH list marks a booking with an allergy (field or notes) in red, and any other note
// quietly, so staff know which bookings to open before service.

import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { BookingNoteMarker } from '@/components/features/table-bookings/BookingNoteMarker'

describe('BookingNoteMarker', () => {
  it('says Allergy when the allergy only arrived in the notes', () => {
    render(<BookingNoteMarker allergies={[]} notes="Severe nut allergy" />)
    expect(screen.getByText('Allergy')).toBeInTheDocument()
  })

  it('says Note for any other note', () => {
    render(<BookingNoteMarker notes="Birthday, cake at 9" />)
    expect(screen.getByText('Note')).toBeInTheDocument()
  })

  it('shows nothing on a booking with nothing to read', () => {
    const { container } = render(<BookingNoteMarker allergies={[]} dietaryRequirements={[]} notes={null} />)
    expect(container).toBeEmptyDOMElement()
  })
})

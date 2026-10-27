import { describe, expect, it } from 'vitest'
import { bookingNoteMarker, mentionsAllergy, parseAllergyList } from './allergy-words'

// BK-052: allergies have mostly arrived in the booking notes, so the screens read the notes too.
describe('mentionsAllergy', () => {
  it.each([
    'Severe nut allergy',
    'Coeliac, no bread please',
    'one guest is allergic to shellfish',
    'carries an EpiPen',
    'Lactose intolerant',
    'no sesame',
  ])('finds an allergy in "%s"', (text) => {
    expect(mentionsAllergy(text)).toBe(true)
  })

  it.each(['Birthday, cake at 9', 'Window table if possible', 'Donuts for dessert?', '', null])(
    'finds none in "%s"',
    (text) => {
      expect(mentionsAllergy(text)).toBe(false)
    },
  )
})

describe('parseAllergyList', () => {
  it('splits on commas, semicolons and new lines, and drops blanks', () => {
    expect(parseAllergyList(' peanuts, shellfish;\nmilk ,, ')).toEqual(['peanuts', 'shellfish', 'milk'])
  })

  it('keeps to the public API limits of 20 entries of 100 characters', () => {
    const list = parseAllergyList(Array.from({ length: 25 }, (_, index) => `${'x'.repeat(120)}${index}`).join(','))
    expect(list).toHaveLength(20)
    expect(list.every((entry) => entry.length === 100)).toBe(true)
  })

  it('reads nothing from nothing', () => {
    expect(parseAllergyList('')).toEqual([])
    expect(parseAllergyList(undefined)).toEqual([])
  })
})

describe('bookingNoteMarker', () => {
  it('marks an allergy from the field, the notes or the dietary list', () => {
    expect(bookingNoteMarker({ allergies: ['Peanuts'] })).toBe('allergy')
    expect(bookingNoteMarker({ notes: 'Nut allergy at table' })).toBe('allergy')
    expect(bookingNoteMarker({ dietaryRequirements: ['Gluten free'] })).toBe('allergy')
  })

  it('marks any other note or dietary need as a note', () => {
    expect(bookingNoteMarker({ notes: 'Birthday' })).toBe('note')
    expect(bookingNoteMarker({ dietaryRequirements: ['Vegetarian'] })).toBe('note')
  })

  it('marks nothing on a booking with nothing', () => {
    expect(bookingNoteMarker({ allergies: [' '], dietaryRequirements: [], notes: '  ' })).toBeNull()
    expect(bookingNoteMarker({})).toBeNull()
  })
})

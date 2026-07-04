import { describe, it, expect } from 'vitest'
import {
  MAX_MANUAL_BOOKING_SEATS,
  parseQuantityInput,
  summariseTicketBasket,
  validateSeatsInput,
  validateAttendeeNameList,
} from './manual-booking-helpers'

const types = [
  { id: 'type-regular', name: 'Regular', price: 15 },
  { id: 'type-under-18', name: 'Under 18', price: 8 },
]

describe('parseQuantityInput', () => {
  it('should treat empty input as zero', () => {
    expect(parseQuantityInput('')).toBe(0)
    expect(parseQuantityInput('  ')).toBe(0)
  })

  it('should parse whole numbers within range', () => {
    expect(parseQuantityInput('3')).toBe(3)
    expect(parseQuantityInput(String(MAX_MANUAL_BOOKING_SEATS))).toBe(MAX_MANUAL_BOOKING_SEATS)
  })

  it('should return null for out-of-range or non-numeric input', () => {
    expect(parseQuantityInput('21')).toBeNull()
    expect(parseQuantityInput('-1')).toBeNull()
    expect(parseQuantityInput('2.5')).toBeNull()
    expect(parseQuantityInput('abc')).toBeNull()
  })
})

describe('summariseTicketBasket', () => {
  it('should sum seats and money across types', () => {
    const summary = summariseTicketBasket(types, { 'type-regular': '2', 'type-under-18': '1' })
    expect(summary.error).toBeNull()
    expect(summary.totalSeats).toBe(3)
    expect(summary.totalAmount).toBe(38)
    expect(summary.lines).toEqual([
      { ticketTypeId: 'type-regular', name: 'Regular', quantity: 2, unitPrice: 15 },
      { ticketTypeId: 'type-under-18', name: 'Under 18', quantity: 1, unitPrice: 8 },
    ])
  })

  it('should omit zero-quantity lines', () => {
    const summary = summariseTicketBasket(types, { 'type-regular': '2', 'type-under-18': '' })
    expect(summary.lines).toHaveLength(1)
    expect(summary.lines[0].ticketTypeId).toBe('type-regular')
  })

  it('should error when no tickets are chosen', () => {
    const summary = summariseTicketBasket(types, {})
    expect(summary.error).toBe('Choose at least one ticket.')
    expect(summary.totalSeats).toBe(0)
  })

  it('should error instead of clamping when the total exceeds the maximum', () => {
    const summary = summariseTicketBasket(types, { 'type-regular': '15', 'type-under-18': '10' })
    expect(summary.error).toBe(`A booking can have at most ${MAX_MANUAL_BOOKING_SEATS} tickets.`)
    expect(summary.totalSeats).toBe(25)
  })

  it('should error on invalid quantity input', () => {
    const summary = summariseTicketBasket(types, { 'type-regular': '2.5' })
    expect(summary.error).toBe(`Quantities must be whole numbers between 0 and ${MAX_MANUAL_BOOKING_SEATS}.`)
  })
})

describe('validateSeatsInput', () => {
  it('should accept whole numbers between 1 and 20', () => {
    expect(validateSeatsInput('1')).toEqual({ seats: 1, error: null })
    expect(validateSeatsInput('20')).toEqual({ seats: 20, error: null })
  })

  it('should error instead of clamping when out of range', () => {
    expect(validateSeatsInput('0').error).toBe(`Seats must be between 1 and ${MAX_MANUAL_BOOKING_SEATS}.`)
    expect(validateSeatsInput('30').error).toBe(`Seats must be between 1 and ${MAX_MANUAL_BOOKING_SEATS}.`)
  })

  it('should error on empty or non-numeric input', () => {
    expect(validateSeatsInput('').error).toBe('Enter the number of seats.')
    expect(validateSeatsInput('two').error).toBe('Seats must be a whole number.')
  })
})

describe('validateAttendeeNameList', () => {
  it('should return no names when all inputs are blank', () => {
    expect(validateAttendeeNameList(['', '  ', ''], 3)).toEqual({ names: [], error: null })
  })

  it('should return trimmed names when every ticket is named', () => {
    expect(validateAttendeeNameList([' Amy Smith ', 'Bo Jones'], 2)).toEqual({
      names: ['Amy Smith', 'Bo Jones'],
      error: null,
    })
  })

  it('should enforce all-or-none naming', () => {
    const result = validateAttendeeNameList(['Amy Smith', ''], 2)
    expect(result.error).toBe('Add a name for every ticket, or leave them all blank.')
    expect(result.names).toEqual([])
  })

  it('should ignore name inputs beyond the seat count', () => {
    expect(validateAttendeeNameList(['Amy Smith', 'Bo Jones', 'Extra Person'], 2)).toEqual({
      names: ['Amy Smith', 'Bo Jones'],
      error: null,
    })
  })

  it('should reject names above the maximum length', () => {
    const result = validateAttendeeNameList(['a'.repeat(121)], 1)
    expect(result.error).toBe('Each name must be 120 characters or fewer.')
  })
})

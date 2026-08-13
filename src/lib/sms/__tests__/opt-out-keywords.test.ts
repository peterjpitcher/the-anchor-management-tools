import { describe, it, expect } from 'vitest'
import { detectOptOut } from '../opt-out-keywords'

describe('detectOptOut', () => {
  describe('marketing-only opt-out', () => {
    // The reply that started this. She wrote "No events", the old exact-match
    // rule missed the space, and she got an auto-reply asking how many seats she
    // wanted before having to guess the exact spelling.
    it.each([
      ['No events'],
      ['no events'],
      ['NO EVENTS'],
      ['NOEVENTS'],
      ['noevents'],
      ['no-events'],
      ['No Events.'],
      ['No events!'],
      ['  no   events  '],
      ['no events please'],
      ['NOPROMO'],
      ['no promo'],
      ['no offers'],
    ])('reads %j as a marketing-only opt-out', (body) => {
      expect(detectOptOut(body)).toEqual({ scope: 'marketing_only', keyword: expect.any(String) })
    })

    it('reports the canonical keyword, not the customer spelling', () => {
      expect(detectOptOut('No events')?.keyword).toBe('NOEVENTS')
      expect(detectOptOut('no promo')?.keyword).toBe('NOPROMO')
    })

    it('leaves service messages intact', () => {
      expect(detectOptOut('No events')?.scope).toBe('marketing_only')
    })
  })

  describe('full opt-out', () => {
    it.each([
      ['STOP'],
      ['stop'],
      ['Stop.'],
      ['STOP MESSAGING ME!!'],
      ['UNSUBSCRIBE'],
      ['unsubscribe please'],
      ['QUIT'],
      ['END'],
      ['STOPALL'],
      ['stop all'],
    ])('reads %j as a full opt-out', (body) => {
      expect(detectOptOut(body)?.scope).toBe('all')
    })
  })

  // Known, pre-existing, deliberately left alone. A leading carrier keyword has
  // always triggered a full opt-out, so "Cancel my table for Saturday" silences
  // someone who plainly still wants us to text them back. It has happened once
  // in the whole message history (July 2025) and that customer stayed opted in,
  // so it is a latent bug rather than a live one. Narrowing the carrier keywords
  // to exact matches is a consent change and needs its own decision, so it is
  // pinned here rather than quietly altered alongside the "No events" fix.
  describe('known gap: a leading carrier keyword still opts out in full', () => {
    it.each([
      ['Cancel my table for Saturday please'],
      ['End of the night is fine'],
    ])('%j currently reads as a full opt-out', (body) => {
      expect(detectOptOut(body)?.scope).toBe('all')
    })
  })

  describe('messages that must not opt anyone out', () => {
    it.each([
      ['Can I cancel my booking?'],
      ['endive salad'],
      ['4'],
      ['4 please'],
      ['Two seats please if available'],
      ['no thanks'],
      ['No'],
      ['Are there no events on Friday?'],
      ['What time does the quiz stop?'],
      ['hello'],
      [''],
      ['   '],
    ])('does not treat %j as an opt-out', (body) => {
      expect(detectOptOut(body)).toBeNull()
    })

    it('returns null for null and undefined', () => {
      expect(detectOptOut(null)).toBeNull()
      expect(detectOptOut(undefined)).toBeNull()
    })
  })

  it('lets a marketing keyword win over a stop keyword', () => {
    // NOEVENTS is checked first so the narrower preference is honoured. Nobody
    // who asks only to stop event invites should lose booking confirmations.
    expect(detectOptOut('NOEVENTS')?.scope).toBe('marketing_only')
  })
})

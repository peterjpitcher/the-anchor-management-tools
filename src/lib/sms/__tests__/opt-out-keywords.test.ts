import { describe, it, expect } from 'vitest'
import { buildInboundOptOutUpdate, detectOptOut } from '../opt-out-keywords'

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

  // CANCEL and END are ordinary English in a pub, so they only count as the
  // whole message. Carriers only require the bare keyword to be honoured, and
  // treating "Cancel my table for Saturday" as a full opt-out silenced the
  // booking confirmations of someone who was mid-conversation with us.
  describe('CANCEL and END only count as the whole message', () => {
    it.each([
      ['CANCEL'],
      ['cancel'],
      ['Cancel.'],
      ['END'],
      ['end'],
    ])('%j on its own is still a full opt-out', (body) => {
      expect(detectOptOut(body)?.scope).toBe('all')
    })

    it.each([
      ['Cancel my table for Saturday please'],
      ['Cancel my 4 please'],
      ['Can you cancel our booking'],
      ['End of the night is fine'],
      ['endive salad'],
    ])('%j is not an opt-out', (body) => {
      expect(detectOptOut(body)).toBeNull()
    })
  })

  describe('messages that must not opt anyone out', () => {
    it.each([
      ['Can I cancel my booking?'],
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

  // Requests in the guest's own words. Each of these is a real reply we stored and never acted on.
  describe('requests written in the guest\'s own words', () => {
    it.each([
      ['Please take me off your list, thanks', 'remove me'],
      ["Can you stop the spam I just wanted a job u didn't even have the decency to give a rejection message", 'stop messaging'],
      ['Please remove me from this mailing list', 'remove me'],
      ['Wrong number ', 'wrong number'],
      ['Please stop texting me', 'stop messaging'],
      ['Can you unsubscribe me', 'unsubscribe'],
      ["Don\u2019t text me again", 'do not contact'],
      ['No more messages please', 'no more messages'],
      ['Please opt me out', 'opt out'],
    ])('reads %j as a marketing-only opt-out for a manager to review', (body, phrase) => {
      expect(detectOptOut(body)).toEqual({ scope: 'marketing_only', keyword: 'PHRASE', phrase })
    })

    it('still treats a leading STOP as a full opt-out, not a phrase', () => {
      expect(detectOptOut('STOP MESSAGING ME!!')).toEqual({ scope: 'all', keyword: 'STOP' })
    })

    // Real replies that must not be read as a request to stop.
    it.each([
      ['Please cancel this reservation, I did not make it.,'],
      ['Sent to you in error'],
      ['No thank you'],
      ['Thank you Peter but we have made other plans now'],
      ['Oh my sister already booked the seats.'],
      ['Hi I need to cancel my table for Friday night please x'],
      ['Not sure if I am available this week for it to be honest mate, sorry!'],
      ['Can we remove one person from our booking?'],
    ])('does not treat %j as an opt-out', (body) => {
      expect(detectOptOut(body)).toBeNull()
    })
  })
})

describe('buildInboundOptOutUpdate', () => {
  const at = '2026-11-27T12:00:00.000Z'

  it('switches off marketing email with a marketing-only text opt-out', () => {
    expect(buildInboundOptOutUpdate('sms', 'marketing_only', at)).toEqual({
      marketing_sms_opt_in: false,
      marketing_sms_opted_out_at: at,
      marketing_email_opt_in: false,
      marketing_email_opted_out_at: at,
    })
  })

  it('switches off every text and marketing email with a full STOP, leaving service email alone', () => {
    const update = buildInboundOptOutUpdate('sms', 'all', at)
    expect(update).toMatchObject({
      sms_opt_in: false,
      sms_status: 'opted_out',
      marketing_sms_opt_in: false,
      marketing_email_opt_in: false,
      marketing_email_opted_out_at: at,
    })
    expect(update).not.toHaveProperty('email_status')
    expect(update).not.toHaveProperty('email_deactivated_at')
  })

  it('switches off marketing email for a WhatsApp opt-out too', () => {
    expect(buildInboundOptOutUpdate('whatsapp', 'marketing_only', at)).toMatchObject({
      marketing_whatsapp_opt_in: false,
      marketing_email_opted_out_at: at,
    })
  })
})

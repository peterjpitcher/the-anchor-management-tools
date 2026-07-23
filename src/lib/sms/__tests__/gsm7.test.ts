import { describe, it, expect } from 'vitest'
import {
  countSmsSegments,
  countSmsSeptets,
  isGsm7,
  normaliseToGsm7,
} from '../gsm7'

// Written as code points so the test cannot be silently "corrected" by an editor,
// and so it stays readable: these characters are near-identical by eye.
const CURLY_APOSTROPHE = String.fromCodePoint(0x2019)
const EM_DASH = String.fromCodePoint(0x2014)
const EN_DASH = String.fromCodePoint(0x2013)
const ELLIPSIS = String.fromCodePoint(0x2026)
const NBSP = String.fromCodePoint(0x00a0)

describe('isGsm7', () => {
  it('accepts the plain ASCII a message should be made of', () => {
    expect(isGsm7('The Anchor: Margaret, Music Bingo is on Fri 14 Aug, 7pm.')).toBe(true)
  })

  it('accepts pound signs and accented Latin, which are in the GSM-7 alphabet', () => {
    expect(isGsm7('Entry is £5 for José')).toBe(true)
  })

  it('rejects smart punctuation', () => {
    expect(isGsm7(`don${CURLY_APOSTROPHE}t`)).toBe(false)
    expect(isGsm7(`a ${EM_DASH} b`)).toBe(false)
    expect(isGsm7(`a ${EN_DASH} b`)).toBe(false)
    expect(isGsm7(ELLIPSIS)).toBe(false)
  })

  it('rejects emoji', () => {
    expect(isGsm7('see you there 🍻')).toBe(false)
  })
})

describe('normaliseToGsm7', () => {
  it('replaces a curly apostrophe with a straight one', () => {
    const input = `don${CURLY_APOSTROPHE}t be late`
    expect(normaliseToGsm7(input)).toBe("don't be late")
    expect(isGsm7(normaliseToGsm7(input))).toBe(true)
  })

  it('replaces long dashes with a hyphen', () => {
    expect(normaliseToGsm7(`a ${EM_DASH} b`)).toBe('a - b')
    expect(normaliseToGsm7(`a ${EN_DASH} b`)).toBe('a - b')
  })

  it('expands an ellipsis and normalises exotic spaces', () => {
    expect(normaliseToGsm7(`wait${ELLIPSIS}`)).toBe('wait...')
    expect(normaliseToGsm7(`a${NBSP}b`)).toBe('a b')
  })

  it('leaves already-safe text untouched', () => {
    const safe = 'The Anchor: how many seats? Text a number back, like 4.'
    expect(normaliseToGsm7(safe)).toBe(safe)
  })

  it('leaves characters it cannot safely map, so the message still sends', () => {
    expect(normaliseToGsm7('cheers 🍻')).toBe('cheers 🍻')
  })
})

describe('countSmsSeptets', () => {
  it('counts ordinary characters once', () => {
    expect(countSmsSeptets('hello')).toBe(5)
  })

  it('counts extended characters twice, because they need an escape', () => {
    expect(countSmsSeptets('[')).toBe(2)
    expect(countSmsSeptets('€')).toBe(2)
  })
})

describe('countSmsSegments', () => {
  it('fits 160 GSM-7 characters in one segment', () => {
    expect(countSmsSegments('a'.repeat(160))).toBe(1)
  })

  it('splits at 161, using the shorter 153 limit for concatenated parts', () => {
    expect(countSmsSegments('a'.repeat(161))).toBe(2)
    expect(countSmsSegments('a'.repeat(306))).toBe(2)
    expect(countSmsSegments('a'.repeat(307))).toBe(3)
  })

  it('drops to 70 characters per segment once any character is non-GSM', () => {
    // This is the bug the old length/160 formula hid: one stray character
    // more than doubles the real cost of an otherwise short message.
    const body = 'a'.repeat(69) + CURLY_APOSTROPHE
    expect(countSmsSegments(body)).toBe(1)
    expect(countSmsSegments('a'.repeat(70) + CURLY_APOSTROPHE)).toBe(2)
  })

  it('treats an empty body as one segment rather than zero', () => {
    expect(countSmsSegments('')).toBe(1)
  })

  it('confirms normalising a real promo body keeps it to a single segment', () => {
    const withSmartPunctuation =
      `The Anchor: Margaret, Music Bingo is on Fri 14 Aug, 7pm. Don${CURLY_APOSTROPHE}t be late ${EM_DASH} bring who you like. How many seats?`
    expect(countSmsSegments(withSmartPunctuation)).toBe(2)
    expect(countSmsSegments(normaliseToGsm7(withSmartPunctuation))).toBe(1)
  })
})

describe('accented event names', () => {
  // The venue runs fixtures with international team names. One non-GSM letter
  // triples the cost of the whole message, so these are folded to base letters.
  it.each([
    ['Curaçao', 'Curacao'],
    ['Perú', 'Peru'],
    ['Côte dIvoire', 'Cote dIvoire'],
    ['Bosnia i Hercegovina š', 'Bosnia i Hercegovina s'],
  ])('folds %j to %j', (input, expected) => {
    expect(normaliseToGsm7(input as string)).toBe(expected)
    expect(isGsm7(normaliseToGsm7(input as string))).toBe(true)
  })

  it('keeps a real fixture name to a single segment', () => {
    const body =
      'The Anchor: Margaret, World Cup 2026: Curaçao vs Ivory Coast, Sat 20 Jun, 8pm. How many seats? Text a number back, like 4.'
    expect(countSmsSegments(body)).toBeGreaterThan(1)
    expect(countSmsSegments(normaliseToGsm7(body))).toBe(1)
  })
})

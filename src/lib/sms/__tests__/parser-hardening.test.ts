import { describe, it, expect } from 'vitest'
import { parseSeatCount } from '@/lib/sms/reply-to-book'

const CURLY = String.fromCodePoint(0x2019)

describe('parseSeatCount hardening', () => {
  it.each([
    ['4', 4], ['4.', 4], ['4 please', 4], ['4 thanks', 4], ['12', 12],
    ['Two', 2], ['Four', 4], ['Two seats please if available', 2],
    ['just me', 1], ['can I have 3?', 3], ['table for 6', 6],
  ])('books %j as %i', (b, e) => expect(parseSeatCount(b as string)).toBe(e))

  // Equal repeated numbers: used to collapse and book half the party.
  it.each([
    ['2 adults 2 kids'], ['2 adults and 2 children'], ['4 adults 4 kids'],
    ['2 + 2'], ['3 of us and 3 kids'], ['3 adults 2 kids'],
    ['2 adults and two kids'],
  ])('refuses ambiguous party breakdown %j', (b) =>
    expect(parseSeatCount(b as string)).toBeNull())

  // Curly apostrophes: phones send U+2019 by default.
  it.each([
    [`Can${CURLY}t make it, 2 of us are away`],
    [`Won${CURLY}t make it, 3 of us away`],
    [`Don${CURLY}t book us in, 2 away`],
    ["Can't make it, 2 of us are away"],
    ['wont make it, 3 of us away'],
  ])('treats %j as a refusal', (b) => expect(parseSeatCount(b as string)).toBeNull())

  // Enthusiasm must not be mistaken for refusal.
  it.each([
    [`Can${CURLY}t wait, 4 please`, 4],
    ["Can't wait, 4 please", 4],
    ['sorry for the late reply, 4 please', 4],
    ['no problem, 4 of us', 4],
  ])('still books %j as %i', (b, e) => expect(parseSeatCount(b as string)).toBe(e))

  // Numbers that are not party sizes.
  it.each([
    ['9pm'], ['7.30pm'], ['see you at 7pm'], ['half 7'],
    ['07123456789'], ['+447123456789'], ['ring me on 07123456789'],
    ['22nd'], ['14/08'], ['I have a definite 4 and possibly another 4/5'],
    ['l8r'], ['0'], ['-2'],
  ])('does not read %j as a seat count', (b) => expect(parseSeatCount(b as string)).toBeNull())

  // Unsettled quantities go to a human. handleReplyToBook flags these for staff
  // and tells the customer, so refusing does not mean going silent on them.
  it.each([
    ['not sure on timing but put us down for 4'],
    ['4 or 5 of us'],
    ['about 6 I think'],
    ['possibly 4'],
  ])('refuses unsettled quantity %j', (b) => expect(parseSeatCount(b as string)).toBeNull())

  // Vague quantities go to a human rather than being guessed.
  it.each([['a couple'], ['a few of us'], ['couple of us']])(
    'refuses to guess %j', (b) => expect(parseSeatCount(b as string)).toBeNull())

  // Opt-out keywords must never book, with or without a space.
  it.each([['STOP'], ['STOP 2'], ['stop2'], ['unsubscribe 4'], ['Cancel my 4 please']])(
    'never books on opt-out %j', (b) => expect(parseSeatCount(b as string)).toBeNull())
})

import { describe, expect, it } from 'vitest'
import {
  disambiguatedNames,
  displayName,
  displayNameWithLegal,
  legalName,
  normalisePreferredName,
  preferredNameKey,
} from '../display-name'

describe('displayName', () => {
  it('prefers the preferred name', () => {
    expect(displayName({ first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy' })).toBe(
      'Mandy',
    )
  })

  it('falls back to the legal first name when none is set', () => {
    expect(displayName({ first_name: 'Peter', last_name: 'Pitcher' })).toBe('Peter')
    expect(displayName({ first_name: 'Peter', last_name: 'Pitcher', preferred_name: null })).toBe(
      'Peter',
    )
  })

  it('treats a blank preferred name as unset', () => {
    // The DB check constraint rejects blanks, but a stale row or an in-flight
    // form value must not render an employee as an empty string.
    expect(displayName({ first_name: 'Peter', preferred_name: '   ' })).toBe('Peter')
  })

  it('disambiguates two people with the same legal first name', () => {
    expect(displayName({ first_name: 'Jacob', last_name: 'Hambridge', preferred_name: 'Jacob H' })).toBe('Jacob H')
    expect(displayName({ first_name: 'Jacob', last_name: 'Williams', preferred_name: 'Jacob W' })).toBe('Jacob W')
  })

  it('never renders Unknown when any legal name exists', () => {
    expect(displayName({ last_name: 'Pitcher' })).toBe('Pitcher')
  })

  it('uses the fallback only when nothing at all is known', () => {
    expect(displayName({})).toBe('Unknown')
    expect(displayName({}, 'Team member')).toBe('Team member')
  })
})

describe('legalName', () => {
  it('ignores the preferred name entirely', () => {
    // Contracts and payroll depend on this staying the legal name.
    expect(legalName({ first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy' })).toBe(
      'Amanda Smith',
    )
  })
})

describe('displayNameWithLegal', () => {
  it('shows both so someone can be found by their paperwork', () => {
    expect(
      displayNameWithLegal({ first_name: 'Amanda', last_name: 'Smith', preferred_name: 'Mandy' }),
    ).toBe('Mandy (Amanda Smith)')
  })

  it('shows the legal name alone when no preferred name is set', () => {
    // Nobody has a preferred name on day one, so getting this wrong would have
    // rendered "Peter (Peter Pitcher)" for the entire employee list.
    expect(displayNameWithLegal({ first_name: 'Peter', last_name: 'Pitcher' })).toBe('Peter Pitcher')
    expect(displayNameWithLegal({ first_name: 'Peter', last_name: 'Pitcher', preferred_name: null })).toBe(
      'Peter Pitcher',
    )
    expect(displayNameWithLegal({ first_name: 'Peter', last_name: 'Pitcher', preferred_name: '  ' })).toBe(
      'Peter Pitcher',
    )
  })

  it('does not repeat a preferred name identical to the legal name', () => {
    expect(
      displayNameWithLegal({ first_name: 'Peter', last_name: 'Pitcher', preferred_name: 'Peter Pitcher' }),
    ).toBe('Peter Pitcher')
  })

  it('does not append an unknown legal name', () => {
    expect(displayNameWithLegal({ preferred_name: 'Mandy' })).toBe('Mandy')
  })
})

describe('disambiguatedNames', () => {
  it('adds a surname only to the people who clash', () => {
    const list = [
      { first_name: 'Jacob', last_name: 'Hambridge' },
      { first_name: 'Jacob', last_name: 'Williams' },
      { first_name: 'Peter', last_name: 'Pitcher' },
    ]

    expect(disambiguatedNames(list).map((r) => r.name)).toEqual([
      'Jacob Hambridge',
      'Jacob Williams',
      'Peter',
    ])
  })

  it('leaves distinct preferred names alone', () => {
    const list = [
      { first_name: 'Jacob', last_name: 'Hambridge', preferred_name: 'Jacob H' },
      { first_name: 'Jacob', last_name: 'Williams', preferred_name: 'Jacob W' },
    ]

    expect(disambiguatedNames(list).map((r) => r.name)).toEqual(['Jacob H', 'Jacob W'])
  })

  it('does not repeat a surname already inside the preferred name', () => {
    const list = [
      { first_name: 'Jacob', last_name: 'Hambridge', preferred_name: 'Jacob Hambridge' },
      { first_name: 'Jacob', last_name: 'Hambridge', preferred_name: 'Jacob Hambridge' },
    ]

    expect(disambiguatedNames(list).map((r) => r.name)).toEqual([
      'Jacob Hambridge',
      'Jacob Hambridge',
    ])
  })

  it('treats the clash case-insensitively', () => {
    const list = [
      { first_name: 'jacob', last_name: 'Hambridge' },
      { first_name: 'Jacob', last_name: 'Williams' },
    ]

    expect(disambiguatedNames(list).map((r) => r.name)).toEqual([
      'jacob Hambridge',
      'Jacob Williams',
    ])
  })

  it('copes with a missing surname rather than inventing a label', () => {
    const list = [{ first_name: 'Jacob' }, { first_name: 'Jacob', last_name: 'Williams' }]

    expect(disambiguatedNames(list).map((r) => r.name)).toEqual(['Jacob', 'Jacob Williams'])
  })
})

describe('preferred name normalisation', () => {
  it('trims, and treats blank as unset', () => {
    expect(normalisePreferredName('  Mandy  ')).toBe('Mandy')
    expect(normalisePreferredName('   ')).toBeNull()
    expect(normalisePreferredName(null)).toBeNull()
  })

  it('compares case-insensitively, matching the unique index', () => {
    expect(preferredNameKey('Mandy')).toBe(preferredNameKey('  mandy '))
    expect(preferredNameKey(null)).toBeNull()
  })
})

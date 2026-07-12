import { describe, it, expect } from 'vitest'
import {
  computeAgeAt,
  deriveInitials,
  deriveFullName,
  assembleWorkerAgreementData,
  type WorkerAgreementInput,
} from '@/lib/worker-agreement'

const baseInput: WorkerAgreementInput = {
  firstName: 'Alex',
  lastName: 'Taylor',
  address: '12 High Street, Staines',
  postCode: 'TW19 6AQ',
  dateOfBirth: '1990-01-01',
  jobTitle: 'Bar staff',
  employmentStartDate: '2026-08-01',
  agreementDate: '2026-07-12',
  hourlyRate: 11.44,
  nmwBandLabel: '23+',
  managerName: 'Peter Pitcher',
  managerEmail: 'peter@orangejelly.co.uk',
  logoUrl: 'data:image/png;base64,LOGO',
}

describe('computeAgeAt', () => {
  it('should return whole-year age on the given date', () => {
    expect(computeAgeAt('2008-07-12', '2026-07-12')).toBe(18)
  })

  it('should return 17 the day before the 18th birthday', () => {
    expect(computeAgeAt('2008-07-13', '2026-07-12')).toBe(17)
  })

  it('should return null when date of birth is missing', () => {
    expect(computeAgeAt(null, '2026-07-12')).toBeNull()
  })

  it('should return null when date of birth is unparseable', () => {
    expect(computeAgeAt('not-a-date', '2026-07-12')).toBeNull()
  })
})

describe('deriveInitials', () => {
  it('should build uppercase initials from first and last name', () => {
    expect(deriveInitials('peter', 'pitcher')).toBe('PP')
  })

  it('should cope with a missing part', () => {
    expect(deriveInitials('Alex', null)).toBe('A')
    expect(deriveInitials(null, null)).toBe('')
  })
})

describe('deriveFullName', () => {
  it('should join present parts and drop missing ones', () => {
    expect(deriveFullName('Alex', 'Taylor')).toBe('Alex Taylor')
    expect(deriveFullName('Alex', null)).toBe('Alex')
    expect(deriveFullName(null, null)).toBe('')
  })
})

describe('assembleWorkerAgreementData', () => {
  it('should merge an adult worker without the Young Worker Schedule', () => {
    const data = assembleWorkerAgreementData(baseInput)
    expect(data.workerName).toBe('Alex Taylor')
    expect(data.initials).toBe('AT')
    expect(data.workerAddress).toBe('12 High Street, Staines, TW19 6AQ')
    expect(data.hourlyRate).toBe('£11.44')
    expect(data.nmwBand).toBe('23+')
    expect(data.youngWorker).toBe('No')
    expect(data.includeYoungWorkerSchedule).toBe(false)
    expect(data.dobLine).toContain('(18+)')
    expect(data.year).toBe('2026')
    expect(data.managerEmail).toBe('peter@orangejelly.co.uk')
  })

  it('should include the Young Worker Schedule for a 17 year old', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, dateOfBirth: '2009-01-01' })
    expect(data.youngWorker).toBe('Yes')
    expect(data.includeYoungWorkerSchedule).toBe(true)
    expect(data.dobLine).toContain('(16–17)')
  })

  it('should treat exactly 18 on the agreement date as 18+ (schedule omitted)', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, dateOfBirth: '2008-07-12' })
    expect(data.includeYoungWorkerSchedule).toBe(false)
    expect(data.youngWorker).toBe('No')
  })

  it('should include the schedule the day before the 18th birthday', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, dateOfBirth: '2008-07-13' })
    expect(data.includeYoungWorkerSchedule).toBe(true)
  })

  it('should treat a missing date of birth as 18+ with a blank age line', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, dateOfBirth: null })
    expect(data.includeYoungWorkerSchedule).toBe(false)
    expect(data.youngWorker).toBe('No')
    expect(data.dobLine).toBe('')
  })

  it('should leave the hourly rate blank when no rate is resolved', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, hourlyRate: null })
    expect(data.hourlyRate).toBe('')
  })

  it('should build the address from post code alone when no address line exists', () => {
    const data = assembleWorkerAgreementData({ ...baseInput, address: null })
    expect(data.workerAddress).toBe('TW19 6AQ')
  })
})

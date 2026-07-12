import { differenceInYears, parseISO } from 'date-fns'
import { formatDateDdMmmmYyyy } from '@/lib/dateUtils'

/**
 * The manager who issues the worker agreement. Fixed to the owner so the
 * signature block and issuing details are consistent on every contract.
 */
export const AGREEMENT_ISSUING_MANAGER = {
  name: 'Peter Pitcher',
  email: 'peter@orangejelly.co.uk',
} as const

/**
 * Display-ready fields for the zero-hours casual worker agreement PDF.
 * Every string is the finished text that drops straight into the template;
 * an empty string renders as a blank fill-in line for completion by hand.
 */
export interface WorkerAgreementData {
  /** Agreement year, used in the document reference ANC/CWA/{year}/{initials} */
  year: string
  /** Worker initials, used in the document reference */
  initials: string
  /** Agreement date, e.g. "12 July 2026" */
  agreementDate: string
  /** Worker full legal name */
  workerName: string
  /** Worker home address (address line + post code) */
  workerAddress: string
  /** Date of birth + age category, e.g. "14 March 2008 (16–17)"; blank if DOB unknown */
  dobLine: string
  jobTitle: string
  /** Employment start date, e.g. "1 August 2026" */
  startDate: string
  /** Base hourly rate, e.g. "£11.44"; blank if no rate resolved */
  hourlyRate: string
  /** NMW age band / apprentice category label, e.g. "Under 18" */
  nmwBand: string
  /** Whether the Young Worker Schedule applies: "Yes" or "No" */
  youngWorker: string
  /** Manager issuing the agreement */
  managerName: string
  /** Email of the manager issuing the agreement */
  managerEmail: string
  /** Append Schedule 2 (Young Worker Schedule) — only when the worker is under 18 */
  includeYoungWorkerSchedule: boolean
  /** Header logo (data URI or URL) */
  logoUrl: string
}

/** Raw inputs, before display formatting. Kept pure so it can be unit tested. */
export interface WorkerAgreementInput {
  firstName: string | null
  lastName: string | null
  address: string | null
  postCode: string | null
  dateOfBirth: string | null // ISO date "YYYY-MM-DD"
  jobTitle: string | null
  employmentStartDate: string | null // ISO date
  agreementDate: string // ISO date — the day the agreement is issued
  hourlyRate: number | null
  nmwBandLabel: string | null
  managerName: string | null
  managerEmail: string | null
  logoUrl: string
}

/** Whole-year age of a person on a given date; null if DOB missing/unparseable. */
export function computeAgeAt(dateOfBirth: string | null, onDate: string): number | null {
  if (!dateOfBirth) return null
  const dob = parseISO(dateOfBirth)
  const on = parseISO(onDate)
  if (Number.isNaN(dob.getTime()) || Number.isNaN(on.getTime())) return null
  return differenceInYears(on, dob)
}

/** Uppercase initials from first + last name, e.g. "Peter", "Pitcher" -> "PP". */
export function deriveInitials(firstName: string | null, lastName: string | null): string {
  const first = (firstName ?? '').trim()
  const last = (lastName ?? '').trim()
  return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase()
}

/** Full name from first + last, collapsing missing parts. */
export function deriveFullName(firstName: string | null, lastName: string | null): string {
  return [firstName, lastName].map((p) => (p ?? '').trim()).filter(Boolean).join(' ')
}

/**
 * Assemble the display-ready agreement fields from raw inputs.
 *
 * The Young Worker Schedule (page 11) is included only when the worker is
 * under 18 on the agreement date. A missing date of birth is treated as 18+
 * (schedule omitted, age line left blank to complete by hand).
 */
export function assembleWorkerAgreementData(input: WorkerAgreementInput): WorkerAgreementData {
  const age = computeAgeAt(input.dateOfBirth, input.agreementDate)
  const isUnder18 = age !== null && age < 18

  const dobLine = input.dateOfBirth
    ? `${formatDateDdMmmmYyyy(input.dateOfBirth)} (${isUnder18 ? '16–17' : '18+'})`
    : ''

  const address = [input.address, input.postCode]
    .map((p) => (p ?? '').trim())
    .filter(Boolean)
    .join(', ')

  return {
    year: input.agreementDate.slice(0, 4),
    initials: deriveInitials(input.firstName, input.lastName),
    agreementDate: formatDateDdMmmmYyyy(input.agreementDate),
    workerName: deriveFullName(input.firstName, input.lastName),
    workerAddress: address,
    dobLine,
    jobTitle: (input.jobTitle ?? '').trim(),
    startDate: formatDateDdMmmmYyyy(input.employmentStartDate),
    hourlyRate: input.hourlyRate != null ? `£${input.hourlyRate.toFixed(2)}` : '',
    nmwBand: (input.nmwBandLabel ?? '').trim(),
    youngWorker: isUnder18 ? 'Yes' : 'No',
    managerName: (input.managerName ?? '').trim(),
    managerEmail: (input.managerEmail ?? '').trim(),
    includeYoungWorkerSchedule: isUnder18,
    logoUrl: input.logoUrl,
  }
}

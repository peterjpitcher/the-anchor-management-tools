/**
 * Recognising wage payments from the employee list, on our own server.
 *
 * A wage payment's bank description is a member of staff's name followed by the reference the
 * payroll run puts on every payment. These lines are classified here and never sent to OpenAI:
 * a staff name is personal data and there is nothing the model could add. Pure: nothing here
 * reads or writes.
 *
 * Before this, every new member of staff stayed unclassified until someone wrote a rule naming
 * them, and 20 such rules were seeded by migrations.
 */

export type PayrollEmployee = {
  id: string
  firstName: string
  lastName: string
  preferredName?: string | null
}

export type PayrollCheckReason =
  /** The name of a member of staff, without the payroll reference: an expense repaid, perhaps. */
  | 'name_without_reference'
  /** The name fits more than one member of staff. */
  | 'ambiguous_name'
  /** An initial and a surname with the payroll reference: probably wages, not certain. */
  | 'initial_only'
  /** The payroll reference with no name we know: someone missing from the employee list. */
  | 'reference_without_name'

export type PayrollRecognition =
  | { kind: 'none' }
  | { kind: 'wage'; employee: PayrollEmployee }
  | { kind: 'check'; reason: PayrollCheckReason; employees: PayrollEmployee[] }

/** The reference on every payment the payroll run makes. Taken from the payroll rules of 2026. */
export const DEFAULT_PAYROLL_REFERENCE = 'the anchor'

const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr', 'mx'])

function tokens(text: string | null | undefined): string[] {
  if (typeof text !== 'string') return []
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean)
}

function hasSequence(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false
  for (let start = 0; start <= haystack.length - needle.length; start += 1) {
    if (needle.every((token, index) => haystack[start + index] === token)) return true
  }
  return false
}

function firstNames(employee: PayrollEmployee): string[][] {
  return [tokens(employee.firstName), tokens(employee.preferredName)].filter((name) => name.length > 0)
}

function matchesFullName(description: string[], employee: PayrollEmployee): boolean {
  const last = tokens(employee.lastName)
  if (!last.length || !hasSequence(description, last)) return false
  return firstNames(employee).some((first) => hasSequence(description, first))
}

function matchesInitial(description: string[], employee: PayrollEmployee): boolean {
  const last = tokens(employee.lastName)
  if (!last.length || !hasSequence(description, last)) return false
  const initials = new Set(firstNames(employee).map((first) => first[0]?.[0]).filter(Boolean))
  return description.some((token) => token.length === 1 && initials.has(token))
}

/** Whether the text holds the full name of any member of staff. Used to keep names out of prompts. */
export function containsEmployeeName(text: string | null | undefined, employees: readonly PayrollEmployee[]): boolean {
  const description = tokens(text).filter((token) => !TITLES.has(token))
  if (!description.length) return false
  return employees.some((employee) => matchesFullName(description, employee))
}

/**
 * What a bank line looks like next to the employee list.
 *
 *  - `wage`: money out, one member of staff's full name, and the payroll reference. Certain.
 *  - `check`: it may be a wage payment, or it names a member of staff, and a person should look.
 *    Either way it is not sent to OpenAI.
 *  - `none`: nothing to do with staff.
 */
export function recognisePayrollPayment(
  details: string,
  direction: 'in' | 'out',
  employees: readonly PayrollEmployee[],
  reference: string = DEFAULT_PAYROLL_REFERENCE
): PayrollRecognition {
  const description = tokens(details).filter((token) => !TITLES.has(token))
  if (!description.length) return { kind: 'none' }

  const full = employees.filter((employee) => matchesFullName(description, employee))

  if (direction === 'in') {
    // Money from a member of staff is not wages, but it still carries their name.
    return full.length ? { kind: 'check', reason: 'name_without_reference', employees: full } : { kind: 'none' }
  }

  const referenceTokens = tokens(reference)
  const hasReference = referenceTokens.length > 0 && hasSequence(description, referenceTokens)

  if (full.length === 1) {
    return hasReference
      ? { kind: 'wage', employee: full[0] }
      : { kind: 'check', reason: 'name_without_reference', employees: full }
  }
  if (full.length > 1) {
    return { kind: 'check', reason: 'ambiguous_name', employees: full }
  }
  if (!hasReference) return { kind: 'none' }

  const initial = employees.filter((employee) => matchesInitial(description, employee))
  return initial.length
    ? { kind: 'check', reason: 'initial_only', employees: initial }
    : { kind: 'check', reason: 'reference_without_name', employees: [] }
}

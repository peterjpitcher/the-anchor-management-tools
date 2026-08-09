/**
 * How an employee is named on screen.
 *
 * Two names exist for a reason. `first_name`/`last_name` are the legal name and
 * must stay on contracts, payroll and right-to-work records. `preferred_name`
 * is what the team actually calls someone, and it is what every internal screen
 * should show: Amanda goes by Mandy, and two active Jacobs need to read as
 * Jacob H and Jacob W on a rota.
 *
 * Everything internal goes through these helpers so the app never says Amanda
 * on one screen and Mandy on the next. Official documents deliberately do not:
 * they call the legal-name builders directly.
 */

export interface EmployeeNameParts {
  first_name?: string | null
  last_name?: string | null
  preferred_name?: string | null
}

/**
 * The statuses under which an employee is still shown and still selectable:
 * rota, clock-in kiosk, checklist attribution, voucher staff picker.
 *
 * Preferred-name uniqueness is scoped to exactly these, because anyone visible
 * in a picker must be tellable apart from everyone else in it. Someone working
 * their notice is still on all of those screens.
 *
 * Must stay in step with the partial unique index in
 * supabase/migrations/20260809120000_employee_preferred_name.sql.
 */
export const SELECTABLE_EMPLOYEE_STATUSES = ['Active', 'Started Separation'] as const

function clean(value: string | null | undefined): string {
  return (value ?? '').trim()
}

/** The legal name, for contracts, payroll and official records. */
export function legalName(employee: EmployeeNameParts, fallback = 'Unknown'): string {
  const name = [clean(employee.first_name), clean(employee.last_name)].filter(Boolean).join(' ')
  return name || fallback
}

/**
 * The name to show anywhere inside the app. Falls back to the legal first name,
 * then the full legal name, so an employee with no preferred name set is never
 * rendered as "Unknown".
 */
export function displayName(employee: EmployeeNameParts, fallback = 'Unknown'): string {
  const preferred = clean(employee.preferred_name)
  if (preferred) return preferred

  const first = clean(employee.first_name)
  if (first) return first

  return legalName(employee, fallback)
}

/**
 * Display name with the legal name alongside, for screens where you need to
 * find someone by the name on their paperwork: the employee list, search
 * results, payroll-adjacent admin. Collapses to a single name when they match,
 * so "Mandy (Amanda Smith)" but just "Peter Pitcher" when nothing differs.
 */
export function displayNameWithLegal(employee: EmployeeNameParts, fallback = 'Unknown'): string {
  const preferred = clean(employee.preferred_name)
  const legal = legalName(employee, fallback)

  // No preferred name means there is nothing to disambiguate, so show the legal
  // name on its own. Comparing displayName to legalName instead would never
  // match (displayName falls back to the FIRST name only), and every one of the
  // 57 employees with no preferred name set would have read "Peter (Peter
  // Pitcher)" across the whole employee list.
  if (!preferred) return legal

  if (preferred === legal) return legal
  if (legal === fallback) return preferred

  return `${preferred} (${legal})`
}

/**
 * Normalised form used for the uniqueness check, matching the partial unique
 * index in 20260809120000_employee_preferred_name.sql. Keep the two in step:
 * the index is the real guard, this is what lets the form say so politely.
 */
export function normalisePreferredName(value: string | null | undefined): string | null {
  const trimmed = clean(value)
  return trimmed ? trimmed : null
}

export function preferredNameKey(value: string | null | undefined): string | null {
  const normalised = normalisePreferredName(value)
  return normalised ? normalised.toLowerCase() : null
}

/**
 * Display names for a list, with surnames added only where they are needed to
 * tell two people apart.
 *
 * Preferred names are unique among current staff, but most people will not have
 * one set, and `displayName` then falls back to the first name. Two Jacobs with
 * no preferred name would both read as "Jacob". In a picker that decides who
 * completed a food-safety check, choosing the wrong one puts the wrong name
 * against the record, so a clash must never be silent.
 *
 * Only the clashing entries gain a surname, so a list of distinct first names
 * stays short and readable.
 */
export function disambiguatedNames<T extends EmployeeNameParts>(
  employees: T[],
  fallback = 'Unknown',
): Array<{ employee: T; name: string }> {
  const counts = new Map<string, number>()
  for (const employee of employees) {
    const key = displayName(employee, fallback).toLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return employees.map((employee) => {
    const base = displayName(employee, fallback)
    if ((counts.get(base.toLowerCase()) ?? 0) < 2) return { employee, name: base }

    const surname = clean(employee.last_name)
    // No surname to fall back on, so leave it rather than inventing a label.
    if (!surname) return { employee, name: base }
    // Skip when the surname is already in the name, e.g. a preferred name of
    // "Jacob Hambridge", which would otherwise read "Jacob Hambridge Hambridge".
    if (base.toLowerCase().includes(surname.toLowerCase())) return { employee, name: base }

    return { employee, name: `${base} ${surname}` }
  })
}

import { displayNameWithLegal, type EmployeeNameParts } from '@/lib/employees/display-name'

/**
 * The title of an employee's page, and so the "Back to ..." label on the pages below it (edit).
 * Pure module, safe to import from server and client components.
 *
 * Preferred name first, legal name in brackets after it, so whoever is looking at the record can
 * still match it to a contract or payslip. Onboarding rows have no name yet, so the email address
 * stays the fallback. A preferred name on its own is enough to name someone.
 */
export function employeePageTitle(employee: EmployeeNameParts & { email_address: string }): string {
  const hasNameToShow = Boolean((employee.first_name && employee.last_name) || employee.preferred_name)
  return hasNameToShow ? displayNameWithLegal(employee, employee.email_address) : employee.email_address
}

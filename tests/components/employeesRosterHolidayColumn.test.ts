import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('employees roster holiday column', () => {
  it('shows holiday days instead of birthdays on the main roster table', () => {
    const employeesClient = readRepoFile('src/app/(authenticated)/employees/_components/EmployeesClient.tsx')

    expect(employeesClient).toContain('<TableHead>Holiday</TableHead>')
    expect(employeesClient).toContain('holiday_days_current_year ?? 0')
    expect(employeesClient).not.toContain('<TableHead>Birthday</TableHead>')
    expect(employeesClient).not.toContain('date_of_birth')
  })

  it('opens employee profiles from the whole row without a detail shelf', () => {
    const employeesClient = readRepoFile('src/app/(authenticated)/employees/_components/EmployeesClient.tsx')

    expect(employeesClient).toContain('href={`/employees/${emp.employee_id}`}')
    expect(employeesClient).toContain('onClick={() => router.push(`/employees/${emp.employee_id}`)}')
    expect(employeesClient).not.toContain('selectedEmployee')
    expect(employeesClient).not.toContain('setSelectedId')
    expect(employeesClient).not.toContain('View Profile')
  })
})

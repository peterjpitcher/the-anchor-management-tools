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
    const employeesClientPage = readRepoFile('src/app/(authenticated)/employees/EmployeesClientPage.tsx')

    expect(employeesClientPage).toContain("header: 'Holiday'")
    expect(employeesClientPage).toContain("key: 'holiday_days_current_year'")
    expect(employeesClientPage).toContain('holiday_days_current_year ?? 0')
    expect(employeesClientPage).not.toContain("header: 'Birthday'")
    expect(employeesClientPage).not.toContain("key: 'date_of_birth'")
  })
})

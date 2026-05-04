import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

function readRepoFile(path: string) {
  return readFileSync(resolve(repoRoot, path), 'utf8')
}

describe('holiday permission wiring', () => {
  it('uses leave permissions for rota holiday controls', () => {
    const rotaPage = readRepoFile('src/app/(authenticated)/rota/page.tsx')
    const rotaGrid = readRepoFile('src/app/(authenticated)/rota/RotaGrid.tsx')

    expect(rotaPage).toContain("checkUserPermission('leave', 'view'")
    expect(rotaPage).toContain("checkUserPermission('leave', 'create'")
    expect(rotaPage).toContain("checkUserPermission('leave', 'edit'")
    expect(rotaGrid).toContain('onBookHoliday={canCreateLeave')
    expect(rotaGrid).toContain('return canViewLeave && ld ?')
    expect(rotaGrid).toContain('canEdit={canEditLeave}')
    expect(rotaGrid).not.toContain('onBookHoliday={canEdit &&')
  })

  it('uses leave create permission for employee-profile holiday booking', () => {
    const employeePage = readRepoFile('src/app/(authenticated)/employees/[employee_id]/page.tsx')
    const holidaysTab = readRepoFile('src/components/features/employees/EmployeeHolidaysTab.tsx')

    expect(employeePage).toContain("checkUserPermission('leave', 'create'")
    expect(employeePage).toContain('canCreateLeave={canCreateLeave}')
    expect(holidaysTab).toContain('canCreateLeave: boolean')
    expect(holidaysTab).toContain('{canCreateLeave && !showBookForm &&')
    expect(holidaysTab).not.toContain('canEdit: boolean')
  })
})

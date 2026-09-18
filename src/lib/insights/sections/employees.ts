import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildEmployeesSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const employeesSection: SectionDefinition = {
  key: 'employees',
  title: 'Employees and compliance',
  path: '/employees',
  build: buildEmployeesSection,
}

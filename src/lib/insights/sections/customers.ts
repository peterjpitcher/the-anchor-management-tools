import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildCustomersSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const customersSection: SectionDefinition = {
  key: 'customers',
  title: 'Customers',
  path: '/customers',
  build: buildCustomersSection,
}

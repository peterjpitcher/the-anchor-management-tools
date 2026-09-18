import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildMaintenanceSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const maintenanceSection: SectionDefinition = {
  key: 'maintenance',
  title: 'Maintenance',
  path: '/maintenance',
  build: buildMaintenanceSection,
}

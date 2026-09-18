import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildChecklistsSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const checklistsSection: SectionDefinition = {
  key: 'checklists',
  title: 'Checklists',
  path: '/checklists/manage/insights',
  build: buildChecklistsSection,
}

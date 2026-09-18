import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildMarketingSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const marketingSection: SectionDefinition = {
  key: 'marketing',
  title: 'Marketing emails',
  path: '/marketing',
  build: buildMarketingSection,
}

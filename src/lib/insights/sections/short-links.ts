import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildShortLinksSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const shortLinksSection: SectionDefinition = {
  key: 'short_links',
  title: 'Short links',
  path: '/short-links/insights',
  build: buildShortLinksSection,
}

import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildEventsSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const eventsSection: SectionDefinition = {
  key: 'events',
  title: 'Hosted events',
  path: '/events',
  build: buildEventsSection,
}

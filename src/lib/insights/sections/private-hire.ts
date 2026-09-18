import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildPrivateHireSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const privateHireSection: SectionDefinition = {
  key: 'private_hire',
  title: 'Private hire',
  path: '/private-bookings',
  build: buildPrivateHireSection,
}

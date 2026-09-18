import type { SectionBuildResult, SectionContext, SectionDefinition } from '../types'

// Spec: tasks/spec-2026-09-18-weekly-insights-design.md. Placeholder until the section is built.
export async function buildCashingUpSection(_ctx: SectionContext): Promise<SectionBuildResult> {
  throw new Error('Section not implemented')
}

export const cashingUpSection: SectionDefinition = {
  key: 'cashing_up',
  title: 'Cashing up',
  path: '/cashing-up/dashboard',
  build: buildCashingUpSection,
}

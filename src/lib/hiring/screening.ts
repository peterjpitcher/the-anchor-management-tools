import type { ExperienceEvidenceQuote, ExperienceSignals } from './signals'

export interface RubricItem {
  key: string
  label: string
  essential: boolean
  weight: number
}

export type RubricEvidenceStatus = 'yes' | 'no' | 'unknown'

export interface RubricEvidence {
  rubricKey: string
  status: RubricEvidenceStatus
  contradiction: boolean
  evidenceQuotes?: ExperienceEvidenceQuote[]
}

const ONE_YEAR_IN_MONTHS = 12

export function buildBarExperienceEvidence({
  rubricItem,
  signals,
}: {
  rubricItem: RubricItem
  signals: ExperienceSignals
}): RubricEvidence {
  const hasOneYear = signals.barExperienceMonths >= ONE_YEAR_IN_MONTHS

  return {
    rubricKey: rubricItem.key,
    status: hasOneYear ? 'yes' : 'no',
    contradiction: false,
    evidenceQuotes: signals.barExperienceQuotes.length ? signals.barExperienceQuotes : undefined,
  }
}


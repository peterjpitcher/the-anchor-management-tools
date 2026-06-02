export type RetainerProjectLike = {
  is_retainer?: boolean | null
  retainer_period_yyyymm?: string | null
}

export function getEntryDatePeriod(entryDate: string): string {
  return entryDate.slice(0, 7)
}

export function isRetainerProjectForEntryDate(
  project: RetainerProjectLike,
  entryDate: string
): boolean {
  if (!project.is_retainer) return true
  return project.retainer_period_yyyymm === getEntryDatePeriod(entryDate)
}

export function isProjectSelectableForEntryDate(
  project: RetainerProjectLike,
  entryDate: string
): boolean {
  return !project.is_retainer || isRetainerProjectForEntryDate(project, entryDate)
}

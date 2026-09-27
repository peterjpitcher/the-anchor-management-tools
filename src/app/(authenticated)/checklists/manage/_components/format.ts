// Shared display helpers for the checklists management screens. Pure functions, no logic
// that touches the database. See tasks/checklists-discovery/spec.md v4 section 9.4.

/** A 0..1 rate (or null) rendered as a whole-number percentage. */
export function formatPercent(v: number | null | undefined): string {
  if (v == null) return 'n/a'
  return `${Math.round(v * 100)}%`
}

/** The live department rows (spec 3.1). Values match departments(name). */
export const DEPARTMENT_OPTIONS: { value: string; label: string }[] = [
  { value: 'bar', label: 'Bar' },
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'runner', label: 'Runner' },
  { value: 'host', label: 'Host' },
  { value: 'cleaning', label: 'Cleaning' },
]

export function departmentLabel(name: string | null): string {
  if (!name) return 'Inherit'
  const match = DEPARTMENT_OPTIONS.find((d) => d.value === name)
  return match ? match.label : name.charAt(0).toUpperCase() + name.slice(1)
}
